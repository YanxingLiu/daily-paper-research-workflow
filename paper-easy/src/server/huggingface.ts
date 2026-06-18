import type { FetchHuggingFacePapersOptions, HuggingFacePapersResponse, Paper } from "../shared/types";
import { fetchWithRetry, type FetchRetryOptions } from "./fetch";

const HUGGINGFACE_DAILY_API_URL = "https://huggingface.co/api/daily_papers";
export const HUGGINGFACE_DAILY_SOURCE_KEY = "huggingface-daily";

type HuggingFaceDailyEntry = {
  paper?: {
    id?: unknown;
    title?: unknown;
    summary?: unknown;
    authors?: unknown;
    publishedAt?: unknown;
    submittedOnDailyAt?: unknown;
    upvotes?: unknown;
    submittedOnDailyBy?: unknown;
  };
  title?: unknown;
  summary?: unknown;
  publishedAt?: unknown;
  submittedBy?: unknown;
  numUpvotes?: unknown;
};

export async function fetchHuggingFaceDailyPapers(
  options: FetchHuggingFacePapersOptions,
  fetchOptions: Partial<FetchRetryOptions> = {}
): Promise<HuggingFacePapersResponse> {
  const date = parseDateKey(options.date) ?? toDateKey(new Date());
  const maxResults = clampMaxResults(options.maxResults);
  const fetchImpl = options.fetchImpl ?? fetch;
  const entries = await fetchHuggingFaceDailyEntries(date, maxResults, fetchImpl, fetchOptions);
  const papers = entries
    .map((entry) => paperFromHuggingFaceEntry(entry, date))
    .filter((paper) => paper.id.length > 0 && paper.title.length > 0);

  return {
    updatedAt: new Date().toISOString(),
    source: "huggingface",
    selectedDate: date,
    requestedCount: 1,
    totalFetched: papers.length,
    totalUnique: papers.length,
    papers
  };
}

export function paperFromHuggingFaceEntry(entry: HuggingFaceDailyEntry, selectedDate: string): Paper {
  const paper = entry.paper ?? {};
  const id = collapseWhitespace(String(paper.id ?? ""));
  const title = collapseWhitespace(String(paper.title ?? entry.title ?? ""));
  const summary = collapseWhitespace(String(paper.summary ?? entry.summary ?? ""));
  const huggingFaceUrl = `https://huggingface.co/papers/${encodeURIComponent(id)}`;
  const arxivUrl = isArxivId(id) ? `https://arxiv.org/abs/${id}` : huggingFaceUrl;
  const pdfUrl = isArxivId(id) ? `https://arxiv.org/pdf/${id}` : huggingFaceUrl;
  const published = String(paper.publishedAt ?? entry.publishedAt ?? `${selectedDate}T00:00:00.000Z`);
  const updated = String(paper.submittedOnDailyAt ?? entry.publishedAt ?? `${selectedDate}T00:00:00.000Z`);
  const upvotes = readNumber(paper.upvotes) ?? readNumber(entry.numUpvotes);
  const submittedBy = readUserName(entry.submittedBy) ?? readUserName(paper.submittedOnDailyBy);

  return {
    id,
    versionedId: id,
    title,
    summary,
    authors: collectAuthorNames(paper.authors),
    affiliations: [],
    published,
    updated,
    primaryCategory: "HF Daily",
    categories: ["HF Daily"],
    arxivUrl,
    pdfUrl,
    huggingFaceUrl,
    ...(upvotes !== undefined ? { upvotes } : {}),
    ...(submittedBy ? { submittedBy } : {})
  };
}

async function fetchHuggingFaceDailyEntries(
  date: string,
  maxResults: number,
  fetchImpl: typeof fetch,
  fetchOptions: Partial<FetchRetryOptions>
): Promise<HuggingFaceDailyEntry[]> {
  const url = new URL(HUGGINGFACE_DAILY_API_URL);
  url.searchParams.set("date", date);
  url.searchParams.set("limit", String(maxResults));

  const response = await fetchWithRetry(url, {}, fetchImpl, fetchOptions);
  if (!response.ok) {
    throw new Error(`Hugging Face returned ${response.status}`);
  }

  const data = (await response.json()) as unknown;
  return Array.isArray(data) ? (data as HuggingFaceDailyEntry[]) : [];
}

function collectAuthorNames(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => {
      if (typeof item === "string") {
        return collapseWhitespace(item);
      }
      if (item && typeof item === "object") {
        const name = (item as Record<string, unknown>).name;
        return typeof name === "string" ? collapseWhitespace(name) : "";
      }
      return "";
    })
    .filter(Boolean);
}

function readUserName(value: unknown): string | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const data = value as Record<string, unknown>;
  for (const key of ["fullname", "name", "user"]) {
    const name = data[key];
    if (typeof name === "string" && name.trim()) {
      return collapseWhitespace(name);
    }
  }
  return undefined;
}

function readNumber(value: unknown): number | undefined {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : undefined;
}

function isArxivId(value: string): boolean {
  return /^(\d{4}\.\d{4,5}|[a-z-]+(?:\.[A-Z]{2})?\/\d{7})(v\d+)?$/i.test(value);
}

function parseDateKey(value: string): string | undefined {
  const trimmed = value.trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(trimmed) ? trimmed : undefined;
}

function toDateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function clampMaxResults(value: number): number {
  if (!Number.isFinite(value)) {
    return 30;
  }
  return Math.min(Math.max(Math.trunc(value), 1), 100);
}

function collapseWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}
