import { createHash } from "node:crypto";
import type { Paper, PaperQaBatchResponse, PaperQaResponse } from "../shared/types";
import { runWithConcurrency } from "./concurrency";
import type { AppConfig } from "./config";
import { extractPaperFullText, type PaperFullText, type PaperFullTextExtractor } from "./paperFullText";
import { answerPaperQaQuestion, loadPaperQaQuestions, PAPER_QA_PROMPT_VERSION } from "./paperQa";
import type { PaperStore } from "./store";

const activePaperQaRuns = new Map<string, Promise<PaperQaResponse>>();

type RunPaperQaOptions = {
  paper: Paper;
  store: PaperStore;
  config: AppConfig;
  fetchImpl?: typeof fetch;
  force: boolean;
  paperFullTextExtractor?: PaperFullTextExtractor;
};

export function isPaperQaRunActive(store: PaperStore, paperId: string): boolean {
  return activePaperQaRuns.has(activeRunKey(store, paperId));
}

export function startPaperQaRun(options: RunPaperQaOptions): Promise<PaperQaResponse> {
  const key = activeRunKey(options.store, options.paper.id);
  const existingRun = activePaperQaRuns.get(key);
  if (existingRun) {
    return existingRun;
  }

  const run = runPaperQa(options).finally(() => {
    if (activePaperQaRuns.get(key) === run) {
      activePaperQaRuns.delete(key);
    }
  });
  activePaperQaRuns.set(key, run);
  return run;
}

export async function runHuggingFaceDailyPaperQa({
  papers,
  selectedDate,
  store,
  config,
  fetchImpl = fetch,
  paperFullTextExtractor = extractPaperFullText
}: {
  papers: Paper[];
  selectedDate: string;
  store: PaperStore;
  config: AppConfig;
  fetchImpl?: typeof fetch;
  paperFullTextExtractor?: PaperFullTextExtractor;
}): Promise<PaperQaBatchResponse> {
  const resultsByPaperId = new Map<string, PaperQaResponse>();

  await runWithConcurrency(papers, config.paperQa.batchConcurrency, async (paper) => {
    const result = await startPaperQaRun({
      paper,
      store,
      config,
      fetchImpl,
      force: false,
      paperFullTextExtractor
    });
    resultsByPaperId.set(paper.id, result);
  });

  const results = papers
    .map((paper) => resultsByPaperId.get(paper.id))
    .filter((result): result is PaperQaResponse => Boolean(result));
  const completedPapers = results.filter((result) => result.status === "complete").length;
  const failedPapers = results.filter((result) => Boolean(result.error)).length;
  const completedQuestions = results.reduce((total, result) => total + result.completedCount, 0);
  const totalQuestions = results.reduce((total, result) => total + result.totalCount, 0);
  const status = failedPapers === 0 && completedPapers === results.length ? "complete" : "partial";

  return {
    source: "huggingface",
    selectedDate,
    status,
    totalPapers: papers.length,
    completedPapers,
    failedPapers,
    completedQuestions,
    totalQuestions,
    results,
    updatedAt: new Date().toISOString(),
    ...(failedPapers > 0 ? { error: `${failedPapers} paper QA run${failedPapers === 1 ? "" : "s"} failed` } : {})
  };
}

export async function runPaperQa({
  paper,
  store,
  config,
  fetchImpl = fetch,
  force,
  paperFullTextExtractor = extractPaperFullText
}: RunPaperQaOptions): Promise<PaperQaResponse> {
  const questions = loadPaperQaQuestions();
  const fetchOptions = {
    timeoutMs: config.fetchTimeoutMs,
    retries: config.fetchRetries,
    retryBaseDelayMs: config.fetchRetryBaseDelayMs
  };
  const paperFetchOptions = {
    ...fetchOptions,
    userAgent: config.arxivUserAgent
  };
  let errorMessage: string | undefined;
  let fullText: PaperFullText;
  store.startPaperQaRun(paper.id, questions.length);

  try {
    fullText = await loadPaperFullText(paper, store, paperFullTextExtractor, fetchImpl, paperFetchOptions);
  } catch (error) {
    errorMessage = error instanceof Error ? error.message : "Unable to extract paper full text";
    store.finishPaperQaRun(paper.id, "failed", 0, errorMessage);
    return buildPaperQaResponse(store, paper.id, questions, false, errorMessage);
  }

  const questionQueue = questions
    .map((question, questionIndex) => ({
      question,
      questionIndex,
      freshness: paperQaFreshness(paper, fullText, question, config)
    }))
    .filter(({ questionIndex, freshness }) => force || !store.hasFreshPaperQaAnswer(paper.id, questionIndex, freshness));

  store.updatePaperQaRunProgress(paper.id, countCurrentAnswers(store, paper.id, questions));
  for (const { question, questionIndex, freshness } of questionQueue) {
    try {
      const answer = await answerPaperQaQuestion(
        { paper, fullText: fullText.text, fullTextSourceUrl: fullText.sourceUrl, question, questionIndex, totalQuestions: questions.length },
        config.paperQa,
        fetchImpl,
        fetchOptions
      );
      store.upsertPaperQaAnswer(paper.id, questionIndex, question, answer, "openai-compatible", config.paperQa.model, freshness);
      store.updatePaperQaRunProgress(paper.id, countCurrentAnswers(store, paper.id, questions));
    } catch (error) {
      errorMessage = `Q${questionIndex + 1}: ${error instanceof Error ? error.message : "Unable to answer paper QA question"}`;
      break;
    }
  }

  const completedCount = countCurrentAnswers(store, paper.id, questions);
  const runStatus = errorMessage ? (completedCount > 0 ? "partial" : "failed") : completedCount === questions.length ? "complete" : "partial";
  store.finishPaperQaRun(paper.id, runStatus, completedCount, errorMessage);
  return buildPaperQaResponse(store, paper.id, questions, false, errorMessage);
}

export function buildPaperQaResponse(
  store: PaperStore,
  paperId: string,
  questions: string[],
  running: boolean,
  error?: string
): PaperQaResponse {
  const answers = store
    .listPaperQaAnswers(paperId)
    .filter((answer) => answer.questionIndex < questions.length && answer.question === questions[answer.questionIndex]);
  const completedCount = answers.length;
  const persistedRun = store.getPaperQaRun(paperId);
  const status =
    running || persistedRun?.status === "running"
      ? "running"
      : completedCount === 0
        ? "idle"
        : completedCount === questions.length && !error
          ? "complete"
          : "partial";

  return {
    paperId,
    status,
    questions,
    answers,
    completedCount,
    totalCount: questions.length,
    updatedAt: new Date().toISOString(),
    ...(error ? { error } : {})
  };
}

function paperQaFreshness(paper: Paper, fullText: PaperFullText, question: string, config: AppConfig) {
  return {
    sourceContentHash: createHash("sha256")
      .update(
        JSON.stringify({
          title: paper.title,
          authors: paper.authors,
          affiliations: paper.affiliations,
          summary: paper.summary,
          fullTextHash: fullText.contentHash,
          fullTextSourceUrl: fullText.sourceUrl
        })
      )
      .digest("hex"),
    questionHash: createHash("sha256").update(question).digest("hex"),
    provider: "openai-compatible",
    model: config.paperQa.model,
    promptVersion: PAPER_QA_PROMPT_VERSION
  };
}

async function loadPaperFullText(
  paper: Paper,
  store: PaperStore,
  paperFullTextExtractor: PaperFullTextExtractor,
  fetchImpl: typeof fetch,
  paperFetchOptions: Parameters<PaperFullTextExtractor>[2]
): Promise<PaperFullText> {
  const cached = store.getCachedPaperFullText(paper);
  if (cached) {
    return cached;
  }

  const fullText = await paperFullTextExtractor(paper, fetchImpl, paperFetchOptions);
  store.upsertPaperFullTextCache(paper, fullText);
  return fullText;
}

function countCurrentAnswers(store: PaperStore, paperId: string, questions: string[]): number {
  return store
    .listPaperQaAnswers(paperId)
    .filter((answer) => answer.questionIndex < questions.length && answer.question === questions[answer.questionIndex]).length;
}

function activeRunKey(store: PaperStore, paperId: string): string {
  return `${store.databasePath}:${paperId}`;
}
