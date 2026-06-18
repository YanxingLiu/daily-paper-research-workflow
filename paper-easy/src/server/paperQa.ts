import { readFileSync } from "node:fs";
import path from "node:path";
import type { Paper } from "../shared/types";
import type { PaperQaConfig } from "./config";
import { fetchWithRetry, type FetchRetryOptions } from "./fetch";

export const PAPER_QA_PROMPT_VERSION = "2026-06-02.v1";

type ChatCompletionResponse = {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
};

export type PaperQaQuestionRequest = {
  paper: Paper;
  fullText: string;
  fullTextSourceUrl: string;
  question: string;
  questionIndex: number;
  totalQuestions: number;
};

export function loadPaperQaQuestions(filePath = path.resolve(process.cwd(), "docs/paper_qa.md")): string[] {
  const content = readFileSync(filePath, "utf8");
  return content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.replace(/^Q\d+\s*[:：]\s*/i, "").trim())
    .filter(Boolean);
}

export async function answerPaperQaQuestion(
  request: PaperQaQuestionRequest,
  config: PaperQaConfig,
  fetchImpl: typeof fetch = fetch,
  fetchOptions: Partial<FetchRetryOptions> = {}
): Promise<string> {
  if (!config.enabled || !config.apiKey) {
    throw new Error("AI paper QA is not configured");
  }

  const response = await fetchWithRetry(
    resolveChatCompletionsUrl(config.baseUrl),
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: config.model,
        temperature: 0,
        messages: [
          {
            role: "system",
            content:
              "You answer one paper-reading question at a time in concise Simplified Chinese. Use only the provided paper metadata, abstract, and full text. If the provided text does not contain enough evidence, say so briefly. Return JSON only."
          },
          {
            role: "user",
            content: JSON.stringify({
              instruction:
                "Answer only the single question in current_question. Do not answer other questions from the paper QA checklist. Do not add unsupported claims.",
              current_question_number: request.questionIndex + 1,
              total_questions: request.totalQuestions,
              current_question: request.question,
              paper: {
                title: request.paper.title,
                authors: request.paper.authors,
                affiliations: request.paper.affiliations,
                abstract: request.paper.summary,
                full_text: request.fullText,
                full_text_source_url: request.fullTextSourceUrl,
                categories: request.paper.categories,
                published: request.paper.published,
                arxiv_url: request.paper.arxivUrl,
                huggingface_url: request.paper.huggingFaceUrl
              },
              output_schema: { answer: "string" }
            })
          }
        ]
      })
    },
    fetchImpl,
    fetchOptions
  );

  if (!response.ok) {
    throw new Error(`paper QA API returned ${response.status}`);
  }

  const body = (await response.json()) as ChatCompletionResponse;
  const content = body.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error("paper QA API returned an empty response");
  }

  return parseAnswerContent(content);
}

function resolveChatCompletionsUrl(baseUrl: string): string {
  const trimmed = baseUrl.replace(/\/+$/, "");
  if (trimmed.endsWith("/chat/completions")) {
    return trimmed;
  }
  return `${trimmed}/chat/completions`;
}

function parseAnswerContent(content: string): string {
  const cleaned = content
    .trim()
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```$/i, "")
    .trim();
  const parsed = JSON.parse(cleaned) as unknown;

  if (!parsed || typeof parsed !== "object") {
    throw new Error("paper QA API returned invalid JSON");
  }

  const answer = (parsed as Record<string, unknown>).answer;
  if (typeof answer !== "string" || !answer.trim()) {
    throw new Error("paper QA API response is missing answer");
  }

  return answer.trim();
}
