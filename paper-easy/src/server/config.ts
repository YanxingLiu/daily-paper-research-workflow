import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { DEFAULT_CATEGORIES } from "./arxiv";

export type AppConfig = {
  categories: string[];
  authors: string[];
  maxResults: number;
  authorMaxResults: number;
  huggingFaceMaxResults: number;
  databasePath: string;
  adminToken?: string;
  syncTime: string;
  autoSync: boolean;
  syncOnStart: boolean;
  fetchTimeoutMs: number;
  fetchRetries: number;
  fetchRetryBaseDelayMs: number;
  arxivRequestDelayMs: number;
  arxivUserAgent: string;
  translation: TranslationConfig;
  paperQa: PaperQaConfig;
};

export type TranslationConfig = {
  enabled: boolean;
  baseUrl: string;
  apiKey?: string;
  model: string;
  targetLanguage: string;
  concurrency: number;
  promptVersion: string;
  forceRefresh: boolean;
};

export type PaperQaConfig = {
  enabled: boolean;
  baseUrl: string;
  apiKey?: string;
  model: string;
  concurrency: number;
  batchConcurrency: number;
};

let dotenvLoaded = false;

export function getAppConfig(): AppConfig {
  loadDotEnv();

  const categories = parseList(firstEnv("PAPERS_EASY_CATEGORIES", "ARXIV_CATEGORIES"));
  const authors = parseList(firstEnv("PAPERS_EASY_AUTHORS", "ARXIV_AUTHORS"));

  const translation = getTranslationConfig();

  return {
    categories: categories.length > 0 ? categories : DEFAULT_CATEGORIES,
    authors,
    maxResults: parsePositiveInteger(process.env.PAPERS_EASY_MAX_RESULTS, 50, 200),
    authorMaxResults: parsePositiveInteger(process.env.PAPERS_EASY_AUTHOR_MAX_RESULTS, 50, 200),
    huggingFaceMaxResults: parsePositiveInteger(process.env.PAPERS_EASY_HUGGINGFACE_MAX_RESULTS, 30, 100),
    databasePath: path.resolve(process.cwd(), process.env.PAPERS_EASY_DB_PATH ?? "./data/papers.easy.sqlite"),
    adminToken: firstEnv("PAPERS_EASY_ADMIN_TOKEN"),
    syncTime: process.env.PAPERS_EASY_SYNC_TIME ?? "08:00",
    autoSync: parseBoolean(process.env.PAPERS_EASY_AUTO_SYNC, true),
    syncOnStart: parseBoolean(process.env.PAPERS_EASY_SYNC_ON_START, true),
    fetchTimeoutMs: parsePositiveInteger(process.env.PAPERS_EASY_FETCH_TIMEOUT_MS, 20_000, 120_000),
    fetchRetries: parseNonNegativeInteger(process.env.PAPERS_EASY_FETCH_RETRIES, 2, 10),
    fetchRetryBaseDelayMs: parseNonNegativeInteger(process.env.PAPERS_EASY_FETCH_RETRY_BASE_DELAY_MS, 500, 60_000),
    arxivRequestDelayMs: parseNonNegativeInteger(process.env.PAPERS_EASY_ARXIV_REQUEST_DELAY_MS, 3_000, 60_000),
    arxivUserAgent: process.env.PAPERS_EASY_ARXIV_USER_AGENT ?? "papers.easy/1.0 (self-hosted arXiv reader)",
    translation,
    paperQa: getPaperQaConfig(translation)
  };
}

function getTranslationConfig(): TranslationConfig {
  const apiKey = firstEnv("PAPERS_EASY_OPENAI_API_KEY", "OPENAI_API_KEY");
  const enabled = parseBoolean(process.env.PAPERS_EASY_AI_TRANSLATION_ENABLED, Boolean(apiKey));

  return {
    enabled: enabled && Boolean(apiKey),
    baseUrl: firstEnv("PAPERS_EASY_OPENAI_BASE_URL", "OPENAI_BASE_URL") ?? "https://api.openai.com/v1",
    apiKey,
    model: firstEnv("PAPERS_EASY_OPENAI_MODEL", "PAPERS_EASY_OPENAI_MODELNAME", "OPENAI_MODEL", "OPENAI_MODELNAME") ?? "gpt-4o-mini",
    targetLanguage: process.env.PAPERS_EASY_TRANSLATION_LANGUAGE ?? "zh",
    concurrency: parsePositiveInteger(process.env.PAPERS_EASY_TRANSLATION_CONCURRENCY, 1, 16),
    promptVersion: process.env.PAPERS_EASY_TRANSLATION_PROMPT_VERSION ?? "2026-04-29.v1",
    forceRefresh: parseBoolean(process.env.PAPERS_EASY_TRANSLATION_FORCE_REFRESH, false)
  };
}

function getPaperQaConfig(translation: TranslationConfig): PaperQaConfig {
  const apiKey = firstEnv("PAPERS_EASY_PAPER_QA_OPENAI_API_KEY", "PAPERS_EASY_OPENAI_API_KEY", "OPENAI_API_KEY") ?? translation.apiKey;
  const enabled = parseBoolean(process.env.PAPERS_EASY_PAPER_QA_ENABLED, translation.enabled);

  return {
    enabled: enabled && Boolean(apiKey),
    baseUrl: firstEnv("PAPERS_EASY_PAPER_QA_OPENAI_BASE_URL", "PAPERS_EASY_OPENAI_BASE_URL", "OPENAI_BASE_URL") ?? translation.baseUrl,
    apiKey,
    model: firstEnv("PAPERS_EASY_PAPER_QA_MODEL", "PAPERS_EASY_PAPER_QA_OPENAI_MODEL") ?? translation.model,
    concurrency: parsePositiveInteger(process.env.PAPERS_EASY_PAPER_QA_CONCURRENCY, 3, 16),
    batchConcurrency: parsePositiveInteger(process.env.PAPERS_EASY_PAPER_QA_BATCH_CONCURRENCY, 2, 8)
  };
}

function loadDotEnv(): void {
  if (dotenvLoaded) {
    return;
  }
  dotenvLoaded = true;

  const envPath = path.resolve(process.cwd(), ".env");
  if (!existsSync(envPath)) {
    return;
  }

  const lines = readFileSync(envPath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex <= 0) {
      continue;
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    const value = unquoteEnvValue(trimmed.slice(separatorIndex + 1).trim());
    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
}

function firstEnv(...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = process.env[key];
    if (value?.trim()) {
      return value;
    }
  }
  return undefined;
}

function parseList(value: string | undefined): string[] {
  if (!value) {
    return [];
  }

  return [...new Set(value.split(/[,;\n]/).map((item) => item.trim()).filter(Boolean))];
}

function parsePositiveInteger(value: string | undefined, fallback: number, max: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return Math.min(Math.max(Math.trunc(parsed), 1), max);
}

function parseNonNegativeInteger(value: string | undefined, fallback: number, max: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return Math.min(Math.max(Math.trunc(parsed), 0), max);
}

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (!value) {
    return fallback;
  }

  return !["0", "false", "no", "off"].includes(value.trim().toLowerCase());
}

function unquoteEnvValue(value: string): string {
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  return value;
}
