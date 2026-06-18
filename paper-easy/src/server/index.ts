import express, { type Express, type Response } from "express";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { AuthorPapersResponse } from "../shared/types";
import { getAdminAuthError } from "./auth";
import { getAppConfig, type AppConfig } from "./config";
import {
  FeedInputError,
  getArxivAuthorPapersFeed,
  getArxivDailyPapersFeed,
  getHuggingFaceDailyPapersFeed,
  parseDateKey,
  parseRequiredString,
  parseSyncKind
} from "./feedService";
import { mountMcpEndpoint } from "./mcp";
import type { PaperFullTextExtractor } from "./paperFullText";
import { loadPaperQaQuestions } from "./paperQa";
import { buildPaperQaResponse, isPaperQaRunActive, runHuggingFaceDailyPaperQa, startPaperQaRun } from "./paperQaService";
import { PaperStore } from "./store";
import { runSync, startDailyScheduler } from "./sync";

const DEFAULT_PORT = 5174;

type CreateAppOptions = {
  config?: AppConfig;
  store?: PaperStore;
  fetchImpl?: typeof fetch;
  syncIfEmpty?: boolean;
  paperFullTextExtractor?: PaperFullTextExtractor;
};

export function createApp(options: CreateAppOptions = {}): Express {
  const config = options.config ?? getAppConfig();
  const store = options.store ?? new PaperStore(config.databasePath);
  const syncIfEmpty = options.syncIfEmpty ?? !config.adminToken;
  const app = express();

  app.use(express.json());
  mountMcpEndpoint(app, { config, store, fetchImpl: options.fetchImpl });

  app.get("/api/health", (_request, response) => {
    response.json({ ok: true });
  });

  app.get("/api/config", (_request, response) => {
    response.json({
      categories: config.categories,
      authors: config.authors,
      maxResults: config.maxResults,
      authorMaxResults: config.authorMaxResults,
      huggingFaceMaxResults: config.huggingFaceMaxResults,
      syncTime: config.syncTime,
      translationEnabled: config.translation.enabled
    });
  });

  app.get("/api/sync/latest", (_request, response) => {
    response.json({ run: store.getLatestSyncRun() });
  });

  app.post("/api/sync", async (request, response) => {
    const authError = getAdminAuthError(request.headers, config.adminToken);
    if (authError) {
      response.status(authError.status).json({ error: authError.message });
      return;
    }

    try {
      const kind = parseSyncKind(request.body?.kind);
      const huggingFaceDate = parseDateKey(request.body?.date);
      const run = await runSync({
        kind,
        store,
        config,
        fetchImpl: options.fetchImpl,
        huggingFaceDate,
        paperFullTextExtractor: options.paperFullTextExtractor
      });
      if (run.status === "failed") {
        response.status(500).json({ run, error: run.errorMessage ?? "Sync failed" });
        return;
      }
      response.json({ run });
    } catch (error) {
      response.status(500).json({
        error: error instanceof Error ? error.message : "Unable to sync arXiv papers"
      });
    }
  });

  app.get("/api/papers", async (request, response) => {
    try {
      const data = await getArxivDailyPapersFeed({
        store,
        config,
        fetchImpl: options.fetchImpl,
        categories: request.query.categories,
        date: request.query.date,
        maxResults: request.query.maxResults,
        syncIfEmpty,
        paperFullTextExtractor: options.paperFullTextExtractor
      });
      response.json(data);
    } catch (error) {
      sendJsonError(response, error, "Unable to fetch arXiv papers");
    }
  });

  app.get("/api/author-papers", async (request, response) => {
    try {
      const data = await getArxivAuthorPapersFeed({
        store,
        config,
        fetchImpl: options.fetchImpl,
        authors: request.query.authors,
        maxResults: request.query.maxResults,
        syncIfEmpty,
        paperFullTextExtractor: options.paperFullTextExtractor
      });
      response.json(data);
    } catch (error) {
      sendJsonError(response, error, "Unable to fetch arXiv author papers");
    }
  });

  app.get("/api/huggingface-papers", async (request, response) => {
    try {
      const data = await getHuggingFaceDailyPapersFeed({
        store,
        config,
        fetchImpl: options.fetchImpl,
        date: request.query.date,
        maxResults: request.query.maxResults,
        syncIfEmpty,
        paperFullTextExtractor: options.paperFullTextExtractor
      });
      response.json(data);
    } catch (error) {
      sendJsonError(response, error, "Unable to fetch Hugging Face daily papers");
    }
  });

  app.get("/api/paper-qa", (request, response) => {
    try {
      const paperId = parseRequiredString(request.query.paperId);
      if (!paperId) {
        response.status(400).json({ error: "paperId is required" });
        return;
      }

      const paper = store.getPaper(paperId);
      if (!paper) {
        response.status(404).json({ error: "Paper was not found" });
        return;
      }

      const questions = loadPaperQaQuestions();
      response.json(buildPaperQaResponse(store, paper.id, questions, isPaperQaRunActive(store, paper.id)));
    } catch (error) {
      response.status(500).json({
        error: error instanceof Error ? error.message : "Unable to load paper QA"
      });
    }
  });

  app.post("/api/paper-qa", async (request, response) => {
    const authError = getAdminAuthError(request.headers, config.adminToken);
    if (authError) {
      response.status(authError.status).json({ error: authError.message });
      return;
    }

    try {
      const paperId = parseRequiredString(request.body?.paperId);
      if (!paperId) {
        response.status(400).json({ error: "paperId is required" });
        return;
      }

      const paper = store.getPaper(paperId);
      if (!paper) {
        response.status(404).json({ error: "Paper was not found" });
        return;
      }

      const force = request.body?.force === true;
      const data = await startPaperQaRun({
        paper,
        store,
        config,
        fetchImpl: options.fetchImpl,
        force,
        paperFullTextExtractor: options.paperFullTextExtractor
      });
      response.status(data.error ? 500 : 200).json(data);
    } catch (error) {
      response.status(500).json({
        error: error instanceof Error ? error.message : "Unable to run paper QA"
      });
    }
  });

  app.post("/api/huggingface-paper-qa", async (request, response) => {
    const authError = getAdminAuthError(request.headers, config.adminToken);
    if (authError) {
      response.status(authError.status).json({ error: authError.message });
      return;
    }

    try {
      const feed = await getHuggingFaceDailyPapersFeed({
        store,
        config,
        fetchImpl: options.fetchImpl,
        date: request.body?.date,
        maxResults: request.body?.maxResults,
        syncIfEmpty,
        paperFullTextExtractor: options.paperFullTextExtractor
      });

      const data = await runHuggingFaceDailyPaperQa({
        papers: feed.papers,
        selectedDate: feed.selectedDate,
        store,
        config,
        fetchImpl: options.fetchImpl,
        paperFullTextExtractor: options.paperFullTextExtractor
      });
      response.json(data);
    } catch (error) {
      sendJsonError(response, error, "Unable to run Hugging Face daily paper QA");
    }
  });

  app.get("/rss/arxiv-authors.xml", async (request, response) => {
    try {
      const feed = await getArxivAuthorPapersFeed({
        store,
        config,
        fetchImpl: options.fetchImpl,
        authors: request.query.authors,
        maxResults: request.query.maxResults,
        syncIfEmpty,
        paperFullTextExtractor: options.paperFullTextExtractor
      });

      response
        .status(200)
        .type("application/rss+xml; charset=utf-8")
        .send(
          buildAuthorRss({
            authors: feed.authors,
            papers: feed.papers,
            siteUrl: `${request.protocol}://${request.get("host") ?? "localhost"}`,
            feedPath: request.originalUrl
          })
        );
    } catch (error) {
      response
        .status(error instanceof FeedInputError ? error.status : 500)
        .type("text/plain")
        .send(error instanceof Error ? error.message : "Unable to render RSS feed");
    }
  });

  const distDir = path.resolve(process.cwd(), "dist");
  if (existsSync(distDir)) {
    app.use(express.static(distDir));
    app.get(/^\/(?!api\/).*/, (_request, response) => {
      response.sendFile(path.join(distDir, "index.html"));
    });
  }

  return app;
}

function sendJsonError(response: Response, error: unknown, fallback: string): void {
  response.status(error instanceof FeedInputError ? error.status : 500).json({
    error: error instanceof Error ? error.message : fallback
  });
}

function buildAuthorRss({
  authors,
  papers,
  siteUrl,
  feedPath
}: {
  authors: string[];
  papers: AuthorPapersResponse["papers"];
  siteUrl: string;
  feedPath: string;
}): string {
  const feedUrl = new URL(feedPath, siteUrl).toString();
  const title = `Papers Easy arXiv authors: ${authors.join(", ")}`;
  const description = `Latest arXiv papers for watched authors: ${authors.join(", ")}`;
  const items = papers
    .map((paper) => {
      const zh = paper.translations?.zh;
      const itemDescription = [
        `<p><strong>Authors:</strong> ${escapeXml(paper.authors.join(", ") || "Unknown")}</p>`,
        paper.affiliations.length > 0 ? `<p><strong>Affiliations:</strong> ${escapeXml(paper.affiliations.join(", "))}</p>` : "",
        zh ? `<p><strong>中文标题:</strong> ${escapeXml(zh.title)}</p>` : "",
        zh?.affiliations && zh.affiliations.length > 0
          ? `<p><strong>作者单位:</strong> ${escapeXml(zh.affiliations.join(", "))}</p>`
          : "",
        `<p>${escapeXml(paper.summary)}</p>`,
        zh ? `<p>${escapeXml(zh.summary)}</p>` : ""
      ].join("");

      return [
        "    <item>",
        `      <title>${escapeXml(paper.title)}</title>`,
        `      <link>${escapeXml(paper.arxivUrl)}</link>`,
        `      <guid isPermaLink="false">arxiv:${escapeXml(paper.id)}</guid>`,
        `      <pubDate>${formatRssDate(paper.published)}</pubDate>`,
        `      <description><![CDATA[${escapeCdata(itemDescription)}]]></description>`,
        `      <source url="${escapeXml(feedUrl)}">${escapeXml(title)}</source>`,
        ...paper.categories.map((category) => `      <category>${escapeXml(category)}</category>`),
        "    </item>"
      ].join("\n");
    })
    .join("\n");

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0">',
    "  <channel>",
    `    <title>${escapeXml(title)}</title>`,
    `    <link>${escapeXml(siteUrl)}</link>`,
    `    <description>${escapeXml(description)}</description>`,
    `    <lastBuildDate>${formatRssDate(new Date().toISOString())}</lastBuildDate>`,
    `    <ttl>60</ttl>`,
    items,
    "  </channel>",
    "</rss>"
  ].join("\n");
}

function formatRssDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? new Date().toUTCString() : date.toUTCString();
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function escapeCdata(value: string): string {
  return value.replace(/]]>/g, "]]]]><![CDATA[>");
}

function isDirectRun(): boolean {
  return process.argv[1] === fileURLToPath(import.meta.url);
}

if (isDirectRun()) {
  const config = getAppConfig();
  const store = new PaperStore(config.databasePath);
  startDailyScheduler(store, config);

  const port = Number(process.env.PORT ?? DEFAULT_PORT);
  createApp({ config, store }).listen(port, () => {
    console.log(`Papers Easy API listening on http://localhost:${port}`);
    console.log(`Papers Easy database at ${config.databasePath}`);
  });
}
