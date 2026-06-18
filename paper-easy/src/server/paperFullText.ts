import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import type pdfParse from "pdf-parse";
import type { Paper } from "../shared/types";
import { fetchWithRetry, type FetchRetryOptions } from "./fetch";

type PdfParse = typeof pdfParse;

const require = createRequire(import.meta.url);

export type PaperFullText = {
  text: string;
  sourceUrl: string;
  contentHash: string;
};

export type PaperFullTextExtractor = (
  paper: Paper,
  fetchImpl: typeof fetch,
  fetchOptions: Partial<FetchRetryOptions>
) => Promise<PaperFullText>;

export async function extractPaperFullText(
  paper: Paper,
  fetchImpl: typeof fetch = fetch,
  fetchOptions: Partial<FetchRetryOptions> = {}
): Promise<PaperFullText> {
  if (!paper.pdfUrl) {
    throw new Error("Paper PDF URL is missing");
  }

  const response = await fetchWithRetry(
    paper.pdfUrl,
    {
      headers: {
        Accept: "application/pdf"
      }
    },
    fetchImpl,
    fetchOptions
  );

  if (!response.ok) {
    throw new Error(`paper PDF returned ${response.status}`);
  }

  const pdfBytes = Buffer.from(await response.arrayBuffer());
  if (pdfBytes.byteLength === 0) {
    throw new Error("paper PDF was empty");
  }

  const result = await loadPdfParse()(pdfBytes);
  const text = normalizeExtractedText(result.text);
  if (!text) {
    throw new Error("paper PDF did not contain extractable text");
  }

  return {
    text,
    sourceUrl: paper.pdfUrl,
    contentHash: createHash("sha256").update(text).digest("hex")
  };
}

function loadPdfParse(): PdfParse {
  return require("pdf-parse/lib/pdf-parse.js") as PdfParse;
}

function normalizeExtractedText(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
