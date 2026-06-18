import type { AuthorPapersResponse, HuggingFacePapersResponse, PapersResponse, SyncKind } from "../shared/types";
import type { AppConfig } from "./config";
import { HUGGINGFACE_DAILY_SOURCE_KEY } from "./huggingface";
import type { PaperFullTextExtractor } from "./paperFullText";
import type { PaperStore } from "./store";
import { runSync } from "./sync";

export class FeedInputError extends Error {
  readonly status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = "FeedInputError";
    this.status = status;
  }
}

type FeedServiceOptions = {
  store: PaperStore;
  config: AppConfig;
  fetchImpl?: typeof fetch;
  paperFullTextExtractor?: PaperFullTextExtractor;
};

export async function getArxivDailyPapersFeed({
  store,
  config,
  fetchImpl,
  paperFullTextExtractor,
  categories: rawCategories,
  date: rawDate,
  maxResults: rawMaxResults,
  syncIfEmpty = false
}: FeedServiceOptions & {
  categories?: unknown;
  date?: unknown;
  maxResults?: unknown;
  syncIfEmpty?: boolean;
}): Promise<PapersResponse> {
  const categories = parseCategories(rawCategories, config.categories);
  const maxResults = parseMaxResults(rawMaxResults, config.maxResults);
  const requestedDate = parseOptionalDateInput(rawDate);

  let availableDates = store.listDailyDates(categories, 120);
  let selectedDate = requestedDate ?? availableDates[0];
  let papers = selectedDate ? store.listDailyPapers(categories, maxResults * categories.length, selectedDate) : [];

  if (papers.length === 0 && !requestedDate && syncIfEmpty) {
    const run = await runSync({ kind: "daily", store, config, fetchImpl, paperFullTextExtractor });
    if (run.status === "failed") {
      throw new Error(run.errorMessage ?? "Daily sync failed");
    }
    availableDates = store.listDailyDates(categories, 120);
    selectedDate = availableDates[0];
    papers = selectedDate ? store.listDailyPapers(categories, maxResults * categories.length, selectedDate) : [];
  }

  return {
    updatedAt: new Date().toISOString(),
    source: "arxiv",
    categories,
    ...(selectedDate ? { selectedDate } : {}),
    availableDates,
    requestedCount: categories.length,
    totalFetched: papers.length,
    totalUnique: papers.length,
    papers
  };
}

export async function getArxivAuthorPapersFeed({
  store,
  config,
  fetchImpl,
  paperFullTextExtractor,
  authors: rawAuthors,
  maxResults: rawMaxResults,
  syncIfEmpty = false
}: FeedServiceOptions & {
  authors?: unknown;
  maxResults?: unknown;
  syncIfEmpty?: boolean;
}): Promise<AuthorPapersResponse> {
  const authors = parseAuthors(rawAuthors, config.authors);
  if (authors.length === 0) {
    throw new FeedInputError("At least one author is required");
  }

  const maxResults = parseMaxResults(rawMaxResults, config.authorMaxResults);
  let papers = store.listAuthorPapers(authors, maxResults * authors.length);

  if (papers.length === 0 && syncIfEmpty) {
    const run = await runSync({ kind: "authors", store, config, fetchImpl, paperFullTextExtractor });
    if (run.status === "failed") {
      throw new Error(run.errorMessage ?? "Author sync failed");
    }
    papers = store.listAuthorPapers(authors, maxResults * authors.length);
  }

  return {
    updatedAt: new Date().toISOString(),
    source: "arxiv",
    authors,
    requestedCount: authors.length,
    totalFetched: papers.length,
    totalUnique: papers.length,
    papers
  };
}

export async function getHuggingFaceDailyPapersFeed({
  store,
  config,
  fetchImpl,
  paperFullTextExtractor,
  date: rawDate,
  maxResults: rawMaxResults,
  syncIfEmpty = false
}: FeedServiceOptions & {
  date?: unknown;
  maxResults?: unknown;
  syncIfEmpty?: boolean;
}): Promise<HuggingFacePapersResponse> {
  const requestedDate = parseOptionalDateInput(rawDate);
  const maxResults = parseMaxResults(rawMaxResults, config.huggingFaceMaxResults, 100);

  let availableDates = store.listHuggingFaceDailyDates(HUGGINGFACE_DAILY_SOURCE_KEY, 120);
  let selectedDate = requestedDate ?? availableDates[0] ?? todayDateKey();
  let papers = store.listHuggingFaceDailyPapers(HUGGINGFACE_DAILY_SOURCE_KEY, maxResults, selectedDate);

  if (papers.length === 0 && syncIfEmpty) {
    const run = await runSync({ kind: "huggingface", store, config, fetchImpl, huggingFaceDate: selectedDate, paperFullTextExtractor });
    if (run.status === "failed") {
      throw new Error(run.errorMessage ?? "Hugging Face sync failed");
    }
    availableDates = store.listHuggingFaceDailyDates(HUGGINGFACE_DAILY_SOURCE_KEY, 120);
    selectedDate = requestedDate ?? availableDates[0] ?? selectedDate;
    papers = store.listHuggingFaceDailyPapers(HUGGINGFACE_DAILY_SOURCE_KEY, maxResults, selectedDate);
  }

  return {
    updatedAt: new Date().toISOString(),
    source: "huggingface",
    selectedDate,
    availableDates,
    requestedCount: 1,
    totalFetched: papers.length,
    totalUnique: papers.length,
    papers
  };
}

export function parseCategories(value: unknown, fallback: string[]): string[] {
  const parsed = parseListInput(value);
  return parsed ? (parsed.length > 0 ? parsed : fallback) : fallback;
}

export function parseAuthors(value: unknown, fallback: string[]): string[] {
  return parseListInput(value) ?? fallback;
}

export function parseMaxResults(value: unknown, fallback: number, max = 200): number {
  const parsed = typeof value === "string" || typeof value === "number" ? Number(value) : Number.NaN;

  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return Math.min(Math.max(Math.trunc(parsed), 1), max);
}

export function parseRequiredString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export function parseSyncKind(value: unknown): SyncKind {
  return value === "daily" || value === "authors" || value === "huggingface" || value === "all" ? value : "all";
}

export function parseDateKey(value: unknown): string | undefined {
  if (typeof value !== "string" || value.trim() === "") {
    return undefined;
  }

  const date = value.trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : undefined;
}

export function todayDateKey(): string {
  return new Date().toISOString().slice(0, 10);
}

function parseOptionalDateInput(value: unknown): string | undefined {
  if (!hasInput(value)) {
    return undefined;
  }

  const parsed = parseDateKey(value);
  if (!parsed) {
    throw new FeedInputError("date must use YYYY-MM-DD format");
  }
  return parsed;
}

function hasInput(value: unknown): boolean {
  return typeof value === "string" ? value.trim() !== "" : value !== undefined && value !== null;
}

function parseListInput(value: unknown): string[] | undefined {
  if (Array.isArray(value)) {
    return value.map((item) => (typeof item === "string" ? item.trim() : "")).filter(Boolean);
  }

  if (typeof value === "string") {
    return value
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  }

  return undefined;
}
