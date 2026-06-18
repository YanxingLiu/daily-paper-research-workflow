import { createHash } from "node:crypto";
import type { Paper, SyncKind, SyncRun } from "../shared/types";
import { fetchPapersForAuthor, fetchPapersForCategory } from "./arxiv";
import { runWithConcurrency } from "./concurrency";
import type { AppConfig } from "./config";
import { fetchHuggingFaceDailyPapers, HUGGINGFACE_DAILY_SOURCE_KEY } from "./huggingface";
import type { PaperFullTextExtractor } from "./paperFullText";
import { startPaperQaRun } from "./paperQaService";
import type { PaperStore } from "./store";
import { translatePaper } from "./translator";

type TranslationSource = {
  title: string;
  affiliations: string[];
  summary: string;
};

export type SyncOptions = {
  kind: SyncKind;
  store: PaperStore;
  config: AppConfig;
  fetchImpl?: typeof fetch;
  huggingFaceDate?: string;
  paperFullTextExtractor?: PaperFullTextExtractor;
};

const activeSyncs = new Map<SyncKind, Promise<SyncRun>>();

export function runSync(options: SyncOptions): Promise<SyncRun> {
  const activeSync = activeSyncs.get(options.kind);
  if (activeSync) {
    return activeSync;
  }

  const sync = doSync(options).finally(() => {
    if (activeSyncs.get(options.kind) === sync) {
      activeSyncs.delete(options.kind);
    }
  });
  activeSyncs.set(options.kind, sync);
  return sync;
}

export function startDailyScheduler(store: PaperStore, config: AppConfig): NodeJS.Timeout | null {
  if (!config.autoSync) {
    return null;
  }

  if (config.syncOnStart) {
    void runSync({ kind: "all", store, config }).catch((error) => {
      console.error("Initial paper sync failed", error);
    });
  }

  const interval = setInterval(() => {
    const now = new Date();
    if (formatTime(now) !== config.syncTime) {
      return;
    }

    void runSync({ kind: "all", store, config }).catch((error) => {
      console.error("Scheduled paper sync failed", error);
    });
  }, 60_000);

  return interval;
}

async function doSync({
  kind,
  store,
  config,
  fetchImpl = fetch,
  huggingFaceDate: requestedHuggingFaceDate,
  paperFullTextExtractor
}: SyncOptions): Promise<SyncRun> {
  const run = store.createSyncRun(kind, {
    categories: config.categories,
    authors: config.authors,
    maxResults: config.maxResults,
    authorMaxResults: config.authorMaxResults,
    huggingFaceMaxResults: config.huggingFaceMaxResults
  });

  const startedAt = new Date().toISOString();
  const seenIds = new Set<string>();
  const papersToTranslate = new Map<string, TranslationSource>();
  const papersToAutoQa = new Map<string, Paper>();
  const errors: Array<{ sourceType: string; sourceKey: string; message: string }> = [];
  const translationErrors: Array<{ paperId: string; message: string }> = [];
  const paperQaErrors: Array<{ paperId: string; message: string }> = [];
  let totalFetched = 0;
  let sourceCount = 0;
  let translated = 0;
  let skippedTranslations = 0;
  let paperQaQueued = 0;
  let paperQaCompleted = 0;
  let paperQaSkipped = 0;
  let arxivRequestCount = 0;
  const fetchOptions = {
    timeoutMs: config.fetchTimeoutMs,
    retries: config.fetchRetries,
    retryBaseDelayMs: config.fetchRetryBaseDelayMs
  };
  const huggingFaceDate = resolveHuggingFaceDate(requestedHuggingFaceDate);
  const arxivFetchOptions = {
    ...fetchOptions,
    userAgent: config.arxivUserAgent
  };
  const waitBeforeArxivRequest = async () => {
    if (arxivRequestCount > 0 && config.arxivRequestDelayMs > 0) {
      await delay(config.arxivRequestDelayMs);
    }
    arxivRequestCount += 1;
  };

  try {
    if (kind === "daily" || kind === "all") {
      for (const category of config.categories) {
        sourceCount += 1;
        try {
          await waitBeforeArxivRequest();
          const papers = await fetchPapersForCategory(category, config.maxResults, fetchImpl, arxivFetchOptions);
          totalFetched += papers.length;
          for (const paper of papers) {
            seenIds.add(paper.id);
            papersToTranslate.set(paper.id, {
              title: paper.title,
              affiliations: paper.affiliations,
              summary: paper.summary
            });
            store.upsertPaper(paper, [{ sourceType: "daily", sourceKey: category }], startedAt);
          }
        } catch (error) {
          errors.push({ sourceType: "daily", sourceKey: category, message: toMessage(error) });
        }
      }
    }

    if (kind === "authors" || kind === "all") {
      for (const author of config.authors) {
        sourceCount += 1;
        try {
          await waitBeforeArxivRequest();
          const papers = await fetchPapersForAuthor(author, config.authorMaxResults, fetchImpl, arxivFetchOptions);
          totalFetched += papers.length;
          for (const paper of papers) {
            seenIds.add(paper.id);
            papersToTranslate.set(paper.id, {
              title: paper.title,
              affiliations: paper.affiliations,
              summary: paper.summary
            });
            papersToAutoQa.set(paper.id, paper);
            store.upsertPaper(paper, [{ sourceType: "author", sourceKey: author }], startedAt);
          }
        } catch (error) {
          errors.push({ sourceType: "author", sourceKey: author, message: toMessage(error) });
        }
      }
    }

    if (kind === "huggingface" || kind === "all") {
      sourceCount += 1;
      try {
        const response = await fetchHuggingFaceDailyPapers(
          {
            date: huggingFaceDate,
            maxResults: config.huggingFaceMaxResults,
            fetchImpl
          },
          fetchOptions
        );
        totalFetched += response.papers.length;
        for (const paper of response.papers) {
          seenIds.add(paper.id);
          papersToTranslate.set(paper.id, {
            title: paper.title,
            affiliations: paper.affiliations,
            summary: paper.summary
          });
          papersToAutoQa.set(paper.id, paper);
          store.upsertPaper(
            paper,
            [{ sourceType: "huggingface", sourceKey: HUGGINGFACE_DAILY_SOURCE_KEY, snapshotDate: response.selectedDate }],
            startedAt
          );
        }
      } catch (error) {
        errors.push({ sourceType: "huggingface", sourceKey: huggingFaceDate, message: toMessage(error) });
      }
    }

    if (config.translation.enabled) {
      const translationQueue = [...papersToTranslate].filter(([paperId]) => {
        const freshness = translationFreshness(papersToTranslate.get(paperId)!, config);
        if (
          !config.translation.forceRefresh &&
          store.hasFreshTranslation(paperId, config.translation.targetLanguage, freshness)
        ) {
          skippedTranslations += 1;
          return false;
        }
        return true;
      });

      await runWithConcurrency(translationQueue, config.translation.concurrency, async ([paperId, paper]) => {
        try {
          const translation = await translatePaper(paper, config.translation, fetchImpl, fetchOptions);
          const provider = "openai-compatible";
          store.upsertTranslation(paperId, translation, provider, config.translation.model, translationFreshness(paper, config));
          translated += 1;
        } catch (error) {
          translationErrors.push({ paperId, message: toMessage(error) });
        }
      });
    }

    if (config.paperQa.enabled && papersToAutoQa.size > 0) {
      const paperQaQueue = [...papersToAutoQa.values()];
      paperQaQueued = paperQaQueue.length;

      await runWithConcurrency(paperQaQueue, config.paperQa.batchConcurrency, async (paper) => {
        try {
          const result = await startPaperQaRun({
            paper,
            store,
            config,
            fetchImpl,
            force: false,
            paperFullTextExtractor
          });
          if (result.error) {
            paperQaErrors.push({ paperId: paper.id, message: result.error });
          } else if (result.status === "complete") {
            paperQaCompleted += 1;
          } else {
            paperQaSkipped += 1;
          }
        } catch (error) {
          paperQaErrors.push({ paperId: paper.id, message: toMessage(error) });
        }
      });
    }

    const stats = {
      sourceCount,
      totalFetched,
      totalUnique: seenIds.size,
      translated,
      skippedTranslations,
      paperQaQueued,
      paperQaCompleted,
      paperQaSkipped,
      fetchTimeoutMs: config.fetchTimeoutMs,
      fetchRetries: config.fetchRetries,
      arxivRequestDelayMs: config.arxivRequestDelayMs,
      errors,
      ...(translationErrors.length > 0 ? { translationErrors } : {}),
      ...(paperQaErrors.length > 0 ? { paperQaErrors } : {})
    };

    if (sourceCount > 0 && errors.length === sourceCount && totalFetched === 0) {
      return store.finishSyncRun(run.id, "failed", stats, errors.map((error) => `${error.sourceKey}: ${error.message}`).join("; "));
    }

    return store.finishSyncRun(run.id, "success", stats);
  } catch (error) {
    return store.finishSyncRun(
      run.id,
      "failed",
      {
        sourceCount,
        totalFetched,
        totalUnique: seenIds.size,
        translated,
        skippedTranslations,
        paperQaQueued,
        paperQaCompleted,
        paperQaSkipped,
        fetchTimeoutMs: config.fetchTimeoutMs,
        fetchRetries: config.fetchRetries,
        arxivRequestDelayMs: config.arxivRequestDelayMs,
        errors,
        ...(translationErrors.length > 0 ? { translationErrors } : {}),
        ...(paperQaErrors.length > 0 ? { paperQaErrors } : {})
      },
      toMessage(error)
    );
  }
}

function translationFreshness(paper: TranslationSource, config: AppConfig) {
  const provider = "openai-compatible";
  return {
    sourceContentHash: sourceContentHash(paper),
    provider,
    model: config.translation.model,
    promptVersion: config.translation.promptVersion
  };
}

function sourceContentHash(paper: TranslationSource): string {
  return createHash("sha256")
    .update(JSON.stringify({ title: paper.title, affiliations: paper.affiliations, summary: paper.summary }))
    .digest("hex");
}

function resolveHuggingFaceDate(value: string | undefined): string {
  return parseDateKey(value) ?? new Date().toISOString().slice(0, 10);
}

function parseDateKey(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }

  const trimmed = value.trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(trimmed) ? trimmed : undefined;
}

function formatTime(date: Date): string {
  const hour = String(date.getHours()).padStart(2, "0");
  const minute = String(date.getMinutes()).padStart(2, "0");
  return `${hour}:${minute}`;
}

function toMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown sync error";
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
