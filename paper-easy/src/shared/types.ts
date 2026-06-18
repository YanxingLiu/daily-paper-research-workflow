export type Paper = {
  id: string;
  versionedId: string;
  title: string;
  summary: string;
  authors: string[];
  affiliations: string[];
  published: string;
  updated: string;
  primaryCategory: string;
  categories: string[];
  arxivUrl: string;
  pdfUrl: string;
  huggingFaceUrl?: string;
  upvotes?: number;
  submittedBy?: string;
  translations?: Record<string, PaperTranslation>;
};

export type PaperTranslation = {
  language: string;
  title: string;
  affiliations?: string[];
  summary: string;
  updatedAt?: string;
};

export type PaperQaAnswer = {
  questionIndex: number;
  question: string;
  answer: string;
  updatedAt?: string;
};

export type PaperQaResponse = {
  paperId: string;
  status: "idle" | "running" | "complete" | "partial";
  questions: string[];
  answers: PaperQaAnswer[];
  completedCount: number;
  totalCount: number;
  updatedAt: string;
  error?: string;
};

export type PaperQaBatchResponse = {
  source: "huggingface";
  selectedDate: string;
  status: "complete" | "partial";
  totalPapers: number;
  completedPapers: number;
  failedPapers: number;
  completedQuestions: number;
  totalQuestions: number;
  results: PaperQaResponse[];
  updatedAt: string;
  error?: string;
};

export type PapersResponse = {
  updatedAt: string;
  source: "arxiv";
  categories: string[];
  selectedDate?: string;
  availableDates?: string[];
  requestedCount: number;
  totalFetched: number;
  totalUnique: number;
  papers: Paper[];
  errors?: Array<{ category: string; message: string }>;
};

export type HuggingFacePapersResponse = {
  updatedAt: string;
  source: "huggingface";
  selectedDate: string;
  availableDates?: string[];
  requestedCount: number;
  totalFetched: number;
  totalUnique: number;
  papers: Paper[];
  errors?: Array<{ date: string; message: string }>;
};

export type AuthorPapersResponse = {
  updatedAt: string;
  source: "arxiv";
  authors: string[];
  requestedCount: number;
  totalFetched: number;
  totalUnique: number;
  papers: Paper[];
  errors?: Array<{ author: string; message: string }>;
};

export type FetchPapersOptions = {
  categories: string[];
  maxResults: number;
  fetchImpl?: typeof fetch;
};

export type FetchAuthorPapersOptions = {
  authors: string[];
  maxResults: number;
  fetchImpl?: typeof fetch;
};

export type FetchHuggingFacePapersOptions = {
  date: string;
  maxResults: number;
  fetchImpl?: typeof fetch;
};

export type SyncKind = "daily" | "authors" | "huggingface" | "all";

export type SyncRun = {
  id: number;
  kind: SyncKind;
  status: "running" | "success" | "failed";
  startedAt: string;
  finishedAt?: string;
  config: Record<string, unknown>;
  stats: Record<string, unknown>;
  errorMessage?: string;
};

export type AppConfigResponse = {
  categories: string[];
  authors: string[];
  maxResults: number;
  authorMaxResults: number;
  huggingFaceMaxResults: number;
  syncTime: string;
  translationEnabled: boolean;
};
