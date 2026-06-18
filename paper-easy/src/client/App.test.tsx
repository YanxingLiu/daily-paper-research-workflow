// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";

describe("App initialization", () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;

  afterEach(() => {
    if (root) {
      act(() => root?.unmount());
      root = null;
    }
    container?.remove();
    container = null;
    vi.unstubAllGlobals();
    window.localStorage.clear();
  });

  it("loads config and papers once on first render", async () => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const requests: string[] = [];
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => ({
        matches: false,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn()
      }))
    );
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        requests.push(url);

        if (url === "/api/config") {
          return Response.json({
            categories: ["cs.AI", "cs.CL"],
            authors: [],
            maxResults: 25,
            authorMaxResults: 10,
            huggingFaceMaxResults: 30,
            syncTime: "08:00",
            translationEnabled: false
          });
        }

        if (url.startsWith("/api/papers?")) {
          return Response.json({
            source: "arxiv",
            categories: ["cs.AI", "cs.CL"],
            requestedCount: 2,
            totalFetched: 0,
            totalUnique: 0,
            updatedAt: "2026-04-28T00:00:00.000Z",
            selectedDate: "2026-04-28",
            availableDates: ["2026-04-28"],
            papers: []
          });
        }

        return new Response("not found", { status: 404 });
      })
    );

    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(<App />);
    });

    await act(async () => {
      await waitFor(() => requests.some((url) => url.startsWith("/api/papers?")));
      await new Promise((resolve) => window.setTimeout(resolve, 50));
    });

    expect(requests.filter((url) => url === "/api/config")).toHaveLength(1);
    expect(requests.filter((url) => url.startsWith("/api/papers?"))).toHaveLength(1);
  });

  it("renders original and translated author affiliations", async () => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => ({
        matches: false,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn()
      }))
    );
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);

        if (url === "/api/config") {
          return Response.json({
            categories: ["cs.AI"],
            authors: [],
            maxResults: 25,
            authorMaxResults: 10,
            huggingFaceMaxResults: 30,
            syncTime: "08:00",
            translationEnabled: true
          });
        }

        if (url.startsWith("/api/papers?")) {
          return Response.json({
            source: "arxiv",
            categories: ["cs.AI"],
            requestedCount: 1,
            totalFetched: 1,
            totalUnique: 1,
            updatedAt: "2026-04-28T00:00:00.000Z",
            selectedDate: "2026-04-28",
            availableDates: ["2026-04-28"],
            papers: [
              {
                id: "2604.12345",
                versionedId: "2604.12345v1",
                title: "Mock Paper",
                summary: "Mock abstract.",
                authors: ["Ada Lovelace"],
                affiliations: ["Analytical Engine Institute"],
                published: "2026-04-23T12:00:00Z",
                updated: "2026-04-24T12:00:00Z",
                primaryCategory: "cs.AI",
                categories: ["cs.AI"],
                arxivUrl: "https://arxiv.org/abs/2604.12345",
                pdfUrl: "https://arxiv.org/pdf/2604.12345",
                translations: {
                  zh: {
                    language: "zh",
                    title: "模拟论文",
                    affiliations: ["解析机研究所"],
                    summary: "模拟摘要。"
                  }
                }
              }
            ]
          });
        }

        return new Response("not found", { status: 404 });
      })
    );

    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(<App />);
    });

    await act(async () => {
      await waitFor(() => container?.textContent?.includes("Affiliations: Analytical Engine Institute") ?? false);
    });

    const zhButton = [...(container?.querySelectorAll("button") ?? [])].find((button) => button.textContent === "中");
    await act(async () => {
      zhButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(container.textContent).toContain("作者单位: 解析机研究所");
  });

  it("loads and renders the Hugging Face daily view", async () => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    let paperQaRuns = 0;
    let paperQaBatchRuns = 0;
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => ({
        matches: false,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn()
      }))
    );
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);

        if (url === "/api/config") {
          return Response.json({
            categories: ["cs.AI"],
            authors: [],
            maxResults: 25,
            authorMaxResults: 10,
            huggingFaceMaxResults: 30,
            syncTime: "08:00",
            translationEnabled: false
          });
        }

        if (url.startsWith("/api/papers?")) {
          return Response.json({
            source: "arxiv",
            categories: ["cs.AI"],
            requestedCount: 1,
            totalFetched: 0,
            totalUnique: 0,
            updatedAt: "2026-04-28T00:00:00.000Z",
            selectedDate: "2026-04-28",
            availableDates: ["2026-04-28"],
            papers: []
          });
        }

        if (url.startsWith("/api/huggingface-papers?")) {
          return Response.json({
            source: "huggingface",
            requestedCount: 1,
            totalFetched: 1,
            totalUnique: 1,
            updatedAt: "2026-06-02T00:00:00.000Z",
            selectedDate: "2026-06-02",
            availableDates: ["2026-06-02"],
            papers: [
              {
                id: "2606.02437",
                versionedId: "2606.02437",
                title: "HF Mock Paper",
                summary: "HF mock abstract.",
                authors: ["Grace Hopper"],
                affiliations: [],
                published: "2026-06-01T00:00:00.000Z",
                updated: "2026-06-02T00:00:00.000Z",
                primaryCategory: "HF Daily",
                categories: ["HF Daily"],
                arxivUrl: "https://arxiv.org/abs/2606.02437",
                pdfUrl: "https://arxiv.org/pdf/2606.02437",
                huggingFaceUrl: "https://huggingface.co/papers/2606.02437",
                upvotes: 44,
                submittedBy: "Andrew Chen"
              }
            ]
          });
        }

        if (url.startsWith("/api/paper-qa?")) {
          return Response.json({
            paperId: "2606.02437",
            status: "idle",
            questions: ["这篇论文试图解决什么问题？"],
            answers: [],
            completedCount: 0,
            totalCount: 1,
            updatedAt: "2026-06-02T00:00:00.000Z"
          });
        }

        if (url === "/api/huggingface-paper-qa" && init?.method === "POST") {
          paperQaBatchRuns += 1;
          return Response.json({
            source: "huggingface",
            selectedDate: "2026-06-02",
            status: "complete",
            totalPapers: 1,
            completedPapers: 1,
            failedPapers: 0,
            completedQuestions: 1,
            totalQuestions: 1,
            updatedAt: "2026-06-02T00:00:00.000Z",
            results: [
              {
                paperId: "2606.02437",
                status: "complete",
                questions: ["这篇论文试图解决什么问题？"],
                answers: [
                  {
                    questionIndex: 0,
                    question: "这篇论文试图解决什么问题？",
                    answer: "批量 QA 已完成。",
                    updatedAt: "2026-06-02T00:00:00.000Z"
                  }
                ],
                completedCount: 1,
                totalCount: 1,
                updatedAt: "2026-06-02T00:00:00.000Z"
              }
            ]
          });
        }

        if (url === "/api/paper-qa" && init?.method === "POST") {
          paperQaRuns += 1;
          return Response.json({
            paperId: "2606.02437",
            status: "complete",
            questions: ["这篇论文试图解决什么问题？"],
            answers: [
              {
                questionIndex: 0,
                question: "这篇论文试图解决什么问题？",
                answer: "它试图解决 HF mock abstract 中描述的问题。",
                updatedAt: "2026-06-02T00:00:00.000Z"
              }
            ],
            completedCount: 1,
            totalCount: 1,
            updatedAt: "2026-06-02T00:00:00.000Z"
          });
        }

        return new Response("not found", { status: 404 });
      })
    );

    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(<App />);
    });

    await act(async () => {
      await waitFor(() => container?.textContent?.includes("huggingface-daily") ?? false);
    });

    const hfButton = [...(container?.querySelectorAll("button") ?? [])].find((button) => button.textContent === "huggingface-daily");
    await act(async () => {
      hfButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    await act(async () => {
      await waitFor(() => container?.textContent?.includes("HF Mock Paper") ?? false);
    });

    expect(container.textContent).toContain("Upvotes: 44");
    expect(container.textContent).toContain("Submitted: Andrew Chen");

    const qaAllButton = [...(container?.querySelectorAll("button") ?? [])].find((button) => button.textContent === "QA All");
    await act(async () => {
      qaAllButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    await act(async () => {
      await waitFor(() => container?.textContent?.includes("Paper QA complete") ?? false);
    });

    expect(container.textContent).toContain("1/1 papers, 1/1 answers");
    expect(paperQaBatchRuns).toBe(1);

    const qaButton = [...(container?.querySelectorAll("button") ?? [])].find((button) => button.textContent === "Paper QA");
    await act(async () => {
      qaButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    await act(async () => {
      await waitFor(() => container?.textContent?.includes("它试图解决 HF mock abstract 中描述的问题。") ?? false);
    });

    expect(paperQaRuns).toBe(1);
  });
});

async function waitFor(assertion: () => boolean, timeoutMs = 500) {
  const startedAt = Date.now();
  while (!assertion()) {
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error("Timed out waiting for condition");
    }
    await new Promise((resolve) => window.setTimeout(resolve, 10));
  }
}
