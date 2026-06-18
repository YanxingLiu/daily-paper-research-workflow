import { XMLParser } from "fast-xml-parser";
import type { AuthorPapersResponse, FetchAuthorPapersOptions, FetchPapersOptions, Paper, PapersResponse } from "../shared/types";
import { fetchWithRetry, type FetchRetryOptions } from "./fetch";

export const DEFAULT_CATEGORIES = ["cs.AI", "cs.CL", "cs.CV", "cs.LG"];

const ARXIV_API_URL = "https://export.arxiv.org/api/query";
const CACHE_TTL_MS = 10 * 60 * 1000;

type CacheEntry<TResponse> = {
  expiresAt: number;
  response: TResponse;
};

const categoryCache = new Map<string, CacheEntry<PapersResponse>>();
const authorCache = new Map<string, CacheEntry<AuthorPapersResponse>>();

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  removeNSPrefix: false
});

export function normalizeArxivId(value: string): string {
  const raw = value.trim().replace(/^https?:\/\/arxiv\.org\/abs\//, "");
  return raw.replace(/v\d+$/i, "");
}

export function paperFromAtomEntry(entry: unknown, sourceCategory: string): Paper {
  const data = entry as Record<string, unknown>;
  const versionedId = String(data.id ?? "").trim().replace(/^https?:\/\/arxiv\.org\/abs\//, "");
  const id = normalizeArxivId(versionedId);
  const categories = collectCategories(data, sourceCategory);
  const primaryCategory = readTerm(data["arxiv:primary_category"]) ?? categories[0] ?? sourceCategory;

  return {
    id,
    versionedId,
    title: collapseWhitespace(String(data.title ?? "")),
    summary: collapseWhitespace(String(data.summary ?? "")),
    authors: collectAuthors(data.author),
    affiliations: collectAffiliations(data.author),
    published: String(data.published ?? ""),
    updated: String(data.updated ?? data.published ?? ""),
    primaryCategory,
    categories,
    arxivUrl: `https://arxiv.org/abs/${id}`,
    pdfUrl: `https://arxiv.org/pdf/${id}`
  };
}

export function dedupePapers(papers: Paper[]): Paper[] {
  const merged = new Map<string, Paper>();

  for (const paper of papers) {
    const id = normalizeArxivId(paper.id);
    const existing = merged.get(id);

    if (!existing) {
      merged.set(id, {
        ...paper,
        id,
        categories: sortUnique(paper.categories)
      });
      continue;
    }

    existing.categories = sortUnique([...existing.categories, ...paper.categories]);
    existing.affiliations = sortUnique([...existing.affiliations, ...paper.affiliations]);
    if (Date.parse(paper.updated) > Date.parse(existing.updated)) {
      existing.updated = paper.updated;
      existing.versionedId = paper.versionedId;
    }
  }

  return [...merged.values()];
}

export async function fetchPapersForCategories(options: FetchPapersOptions): Promise<PapersResponse> {
  const categories = options.categories.length > 0 ? options.categories : DEFAULT_CATEGORIES;
  const maxResults = clampMaxResults(options.maxResults);
  const cacheKey = `${sortUnique(categories).join(",")}:${maxResults}`;
  const cached = categoryCache.get(cacheKey);

  if (cached && cached.expiresAt > Date.now()) {
    return cached.response;
  }

  const fetchImpl = options.fetchImpl ?? fetch;
  const allPapers: Paper[] = [];
  const errors: Array<{ category: string; message: string }> = [];

  for (const category of categories) {
    try {
      allPapers.push(...(await fetchPapersForCategory(category, maxResults, fetchImpl)));
    } catch (error) {
      errors.push({ category, message: error instanceof Error ? error.message : "Unknown arXiv fetch error" });
    }
  }

  if (allPapers.length === 0 && errors.length > 0) {
    throw new Error(errors.map((error) => `${error.category}: ${error.message}`).join("; "));
  }

  const papers = dedupePapers(allPapers).sort((a, b) => Date.parse(b.published) - Date.parse(a.published));
  const response: PapersResponse = {
    updatedAt: new Date().toISOString(),
    source: "arxiv",
    categories,
    requestedCount: categories.length,
    totalFetched: allPapers.length,
    totalUnique: papers.length,
    papers,
    ...(errors.length > 0 ? { errors } : {})
  };

  categoryCache.set(cacheKey, { expiresAt: Date.now() + CACHE_TTL_MS, response });
  return response;
}

export async function fetchPapersForAuthors(options: FetchAuthorPapersOptions): Promise<AuthorPapersResponse> {
  const authors = sortUnique(options.authors.map(collapseWhitespace));
  const maxResults = clampMaxResults(options.maxResults);
  const cacheKey = `${authors.join(",")}:${maxResults}`;
  const cached = authorCache.get(cacheKey);

  if (cached && cached.expiresAt > Date.now()) {
    return cached.response;
  }

  if (authors.length === 0) {
    return {
      updatedAt: new Date().toISOString(),
      source: "arxiv",
      authors,
      requestedCount: 0,
      totalFetched: 0,
      totalUnique: 0,
      papers: []
    };
  }

  const fetchImpl = options.fetchImpl ?? fetch;
  const allPapers: Paper[] = [];
  const errors: Array<{ author: string; message: string }> = [];

  for (const author of authors) {
    try {
      allPapers.push(...(await fetchPapersForAuthor(author, maxResults, fetchImpl)));
    } catch (error) {
      errors.push({ author, message: error instanceof Error ? error.message : "Unknown arXiv fetch error" });
    }
  }

  if (allPapers.length === 0 && errors.length > 0) {
    throw new Error(errors.map((error) => `${error.author}: ${error.message}`).join("; "));
  }

  const papers = dedupePapers(allPapers).sort((a, b) => Date.parse(b.published) - Date.parse(a.published));
  const response: AuthorPapersResponse = {
    updatedAt: new Date().toISOString(),
    source: "arxiv",
    authors,
    requestedCount: authors.length,
    totalFetched: allPapers.length,
    totalUnique: papers.length,
    papers,
    ...(errors.length > 0 ? { errors } : {})
  };

  authorCache.set(cacheKey, { expiresAt: Date.now() + CACHE_TTL_MS, response });
  return response;
}

export function clearArxivCache(): void {
  categoryCache.clear();
  authorCache.clear();
}

export async function fetchPapersForCategory(
  category: string,
  maxResults: number,
  fetchImpl: typeof fetch = fetch,
  fetchOptions: Partial<FetchRetryOptions> = {}
): Promise<Paper[]> {
  const entries = await fetchCategoryEntries(category, clampMaxResults(maxResults), fetchImpl, fetchOptions);
  return entries.map((entry) => paperFromAtomEntry(entry, category));
}

export async function fetchPapersForAuthor(
  author: string,
  maxResults: number,
  fetchImpl: typeof fetch = fetch,
  fetchOptions: Partial<FetchRetryOptions> = {}
): Promise<Paper[]> {
  const entries = await fetchAuthorEntries(author, clampMaxResults(maxResults), fetchImpl, fetchOptions);
  return entries.map((entry) => paperFromAtomEntry(entry, ""));
}

function collapseWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function toArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined) {
    return [];
  }
  return Array.isArray(value) ? value : [value];
}

function collectAuthors(author: unknown): string[] {
  return toArray(author as Record<string, unknown> | Array<Record<string, unknown>> | undefined)
    .map((item) => collapseWhitespace(String(item.name ?? "")))
    .filter(Boolean);
}

function collectAffiliations(author: unknown): string[] {
  const affiliations = toArray(author as Record<string, unknown> | Array<Record<string, unknown>> | undefined).flatMap((item) =>
    toArray(item["arxiv:affiliation"]).map(readText).filter(Boolean)
  );

  return sortUnique(affiliations);
}

function collectCategories(data: Record<string, unknown>, sourceCategory: string): string[] {
  const categories = toArray(data.category as Record<string, unknown> | Array<Record<string, unknown>> | undefined)
    .map(readTerm)
    .filter((term): term is string => Boolean(term));

  return sortUnique([...categories, sourceCategory]);
}

function readTerm(value: unknown): string | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const term = (value as Record<string, unknown>)["@_term"];
  return typeof term === "string" && term.trim() ? term.trim() : undefined;
}

function readText(value: unknown): string {
  if (typeof value === "string") {
    return collapseWhitespace(value);
  }

  if (value && typeof value === "object") {
    const text = (value as Record<string, unknown>)["#text"];
    return typeof text === "string" ? collapseWhitespace(text) : "";
  }

  return "";
}

function sortUnique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

function clampMaxResults(value: number): number {
  if (!Number.isFinite(value)) {
    return 50;
  }
  return Math.min(Math.max(Math.trunc(value), 1), 200);
}

async function fetchCategoryEntries(
  category: string,
  maxResults: number,
  fetchImpl: typeof fetch,
  fetchOptions: Partial<FetchRetryOptions>
): Promise<Array<Record<string, unknown>>> {
  const url = new URL(ARXIV_API_URL);
  url.searchParams.set("search_query", `cat:${category}`);
  url.searchParams.set("start", "0");
  url.searchParams.set("max_results", String(maxResults));
  url.searchParams.set("sortBy", "submittedDate");
  url.searchParams.set("sortOrder", "descending");

  const response = await fetchWithRetry(url, {}, fetchImpl, fetchOptions);
  if (!response.ok) {
    throw new Error(`arXiv returned ${response.status}`);
  }

  const xml = await response.text();
  const parsed = parser.parse(xml) as { feed?: { entry?: Record<string, unknown> | Array<Record<string, unknown>> } };
  return toArray(parsed.feed?.entry);
}

async function fetchAuthorEntries(
  author: string,
  maxResults: number,
  fetchImpl: typeof fetch,
  fetchOptions: Partial<FetchRetryOptions>
): Promise<Array<Record<string, unknown>>> {
  const url = new URL(ARXIV_API_URL);
  url.searchParams.set("search_query", `au:"${escapeArxivPhrase(author)}"`);
  url.searchParams.set("start", "0");
  url.searchParams.set("max_results", String(maxResults));
  url.searchParams.set("sortBy", "submittedDate");
  url.searchParams.set("sortOrder", "descending");

  const response = await fetchWithRetry(url, {}, fetchImpl, fetchOptions);
  if (!response.ok) {
    throw new Error(`arXiv returned ${response.status}`);
  }

  const xml = await response.text();
  const parsed = parser.parse(xml) as { feed?: { entry?: Record<string, unknown> | Array<Record<string, unknown>> } };
  return toArray(parsed.feed?.entry);
}

function escapeArxivPhrase(value: string): string {
  return value.replace(/(["\\])/g, "\\$1");
}
