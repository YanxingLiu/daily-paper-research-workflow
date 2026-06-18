import type { PaperTranslation } from "../shared/types";
import type { TranslationConfig } from "./config";
import { fetchWithRetry, type FetchRetryOptions } from "./fetch";

export type TranslationRequest = {
  title: string;
  affiliations: string[];
  summary: string;
};

type ChatCompletionResponse = {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
};

export async function translatePaper(
  request: TranslationRequest,
  config: TranslationConfig,
  fetchImpl: typeof fetch = fetch,
  fetchOptions: Partial<FetchRetryOptions> = {}
): Promise<PaperTranslation> {
  if (!config.enabled || !config.apiKey) {
    throw new Error("AI translation is not configured");
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
              "You translate computer science research paper metadata into concise, faithful Simplified Chinese. Return JSON only."
          },
          {
            role: "user",
            content: JSON.stringify({
              instruction:
                "Translate the title, author affiliations, and abstract into Simplified Chinese. Preserve technical terms, method names, dataset names, equations, acronyms, organization acronyms, and citations when appropriate. Return affiliations as an array aligned with the input affiliations. Do not add commentary.",
              title: request.title,
              affiliations: request.affiliations,
              summary: request.summary,
              output_schema: { title: "string", affiliations: ["string"], summary: "string" }
            })
          }
        ]
      })
    },
    fetchImpl,
    fetchOptions
  );

  if (!response.ok) {
    throw new Error(`translation API returned ${response.status}`);
  }

  const body = (await response.json()) as ChatCompletionResponse;
  const content = body.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error("translation API returned an empty response");
  }

  const parsed = parseTranslationContent(content);
  if (request.affiliations.length > 0 && parsed.affiliations.length === 0) {
    throw new Error("translation API response is missing affiliations");
  }

  return {
    language: config.targetLanguage,
    title: parsed.title,
    ...(parsed.affiliations.length > 0 ? { affiliations: parsed.affiliations } : {}),
    summary: parsed.summary,
    updatedAt: new Date().toISOString()
  };
}

function resolveChatCompletionsUrl(baseUrl: string): string {
  const trimmed = baseUrl.replace(/\/+$/, "");
  if (trimmed.endsWith("/chat/completions")) {
    return trimmed;
  }
  return `${trimmed}/chat/completions`;
}

function parseTranslationContent(content: string): { title: string; affiliations: string[]; summary: string } {
  const cleaned = content
    .trim()
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```$/i, "")
    .trim();
  const parsed = JSON.parse(cleaned) as unknown;

  if (!parsed || typeof parsed !== "object") {
    throw new Error("translation API returned invalid JSON");
  }

  const data = parsed as Record<string, unknown>;
  const title = typeof data.title === "string" ? data.title.trim() : "";
  const affiliations = parseStringArray(data.affiliations);
  const summary = typeof data.summary === "string" ? data.summary.trim() : "";
  if (!title || !summary) {
    throw new Error("translation API response is missing title or summary");
  }

  return { title, affiliations, summary };
}

function parseStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((item) => (typeof item === "string" ? item.trim() : "")).filter(Boolean);
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed ? [trimmed] : [];
  }

  return [];
}
