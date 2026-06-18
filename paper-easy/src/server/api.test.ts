import request from "supertest";
import type { Response as SupertestResponse } from "supertest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { clearArxivCache } from "./arxiv";
import type { AppConfig } from "./config";
import { createApp } from "./index";
import type { PaperFullTextExtractor } from "./paperFullText";
import { PaperStore } from "./store";

const atomResponse = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" xmlns:arxiv="http://arxiv.org/schemas/atom">
  <entry>
    <id>http://arxiv.org/abs/2604.12345v1</id>
    <updated>2026-04-24T12:00:00Z</updated>
    <published>2026-04-23T12:00:00Z</published>
    <title>Mock Paper</title>
    <summary>Mock abstract.</summary>
    <author><name>Ada Lovelace</name><arxiv:affiliation>Analytical Engine Institute</arxiv:affiliation></author>
    <arxiv:primary_category term="cs.AI" />
    <category term="cs.AI" />
    <link href="http://arxiv.org/abs/2604.12345v1" rel="alternate" type="text/html"/>
  </entry>
</feed>`;

const laterAtomResponse = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" xmlns:arxiv="http://arxiv.org/schemas/atom">
  <entry>
    <id>http://arxiv.org/abs/2604.54321v1</id>
    <updated>2026-04-25T12:00:00Z</updated>
    <published>2026-04-25T12:00:00Z</published>
    <title>Later Mock Paper</title>
    <summary>Later mock abstract.</summary>
    <author><name>Ada Lovelace</name><arxiv:affiliation>Analytical Engine Institute</arxiv:affiliation></author>
    <arxiv:primary_category term="cs.AI" />
    <category term="cs.AI" />
    <link href="http://arxiv.org/abs/2604.54321v1" rel="alternate" type="text/html"/>
  </entry>
</feed>`;

const authorAtomResponse = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" xmlns:arxiv="http://arxiv.org/schemas/atom">
  <entry>
    <id>http://arxiv.org/abs/2604.67890v1</id>
    <updated>2026-04-26T12:00:00Z</updated>
    <published>2026-04-26T12:00:00Z</published>
    <title>Author Mock Paper</title>
    <summary>Author mock abstract.</summary>
    <author><name>Ada Lovelace</name><arxiv:affiliation>Analytical Engine Institute</arxiv:affiliation></author>
    <arxiv:primary_category term="cs.LG" />
    <category term="cs.LG" />
    <link href="http://arxiv.org/abs/2604.67890v1" rel="alternate" type="text/html"/>
  </entry>
</feed>`;

const translationResponse = {
  choices: [
    {
      message: {
        content: JSON.stringify({
          title: "模拟论文",
          affiliations: ["解析机研究所"],
          summary: "模拟摘要。"
        })
      }
    }
  ]
};

const paperQaQuestions = [
  "这篇论文试图解决什么问题？",
  "有哪些相关研究？",
  "论文如何解决这个问题？",
  "论文做了哪些实验？",
  "有什么可以进一步探索的点？",
  "总结下论文的主要内容。"
];

const huggingFaceDailyResponse = [
  {
    paper: {
      id: "2606.02437",
      title: "HF Mock Paper",
      summary: "HF mock abstract.",
      authors: [{ name: "Grace Hopper" }, { name: "Katherine Johnson" }],
      publishedAt: "2026-06-01T00:00:00.000Z",
      submittedOnDailyAt: "2026-06-02T00:00:00.000Z",
      upvotes: 44,
      submittedOnDailyBy: { fullname: "Andrew Chen", name: "anchen1011" }
    },
    publishedAt: "2026-05-31T20:00:00.000Z"
  }
];

describe("GET /api/papers", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    clearArxivCache();
  });

  it("returns deduplicated paper JSON for requested categories", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(atomResponse, { status: 200 }))
    );

    const fixture = createFixture();
    const response = await request(fixture.app).get("/api/papers?categories=cs.AI,cs.CV&maxResults=1");
    fixture.cleanup();

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      source: "arxiv",
      categories: ["cs.AI", "cs.CV"],
      requestedCount: 2,
      totalFetched: 1,
      totalUnique: 1
    });
    expect(response.body.papers[0]).toMatchObject({
      id: "2604.12345",
      title: "Mock Paper",
      affiliations: ["Analytical Engine Institute"],
      categories: ["cs.AI", "cs.CV"]
    });
  });

  it("returns a structured error when arXiv is unavailable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("nope", { status: 503 }))
    );

    const fixture = createFixture({ categories: ["cs.AI"] });
    const response = await request(fixture.app).get("/api/papers?categories=cs.AI&maxResults=1");
    fixture.cleanup();

    expect(response.status).toBe(500);
    expect(response.body.error).toContain("cs.AI");
  });

  it("returns papers for the selected daily archive date", async () => {
    let feed = atomResponse;
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(feed, { status: 200 }))
    );

    const fixture = createFixture({ categories: ["cs.AI"], maxResults: 10 });
    vi.setSystemTime(new Date("2026-04-24T08:00:00Z"));
    await request(fixture.app).post("/api/sync").send({ kind: "daily" });

    feed = laterAtomResponse;
    clearArxivCache();
    vi.setSystemTime(new Date("2026-04-25T08:00:00Z"));
    await request(fixture.app).post("/api/sync").send({ kind: "daily" });

    const firstDay = await request(fixture.app).get("/api/papers?categories=cs.AI&maxResults=10&date=2026-04-24");
    const latest = await request(fixture.app).get("/api/papers?categories=cs.AI&maxResults=10");
    fixture.cleanup();

    expect(firstDay.status).toBe(200);
    expect(firstDay.body).toMatchObject({
      selectedDate: "2026-04-24",
      availableDates: ["2026-04-25", "2026-04-24"]
    });
    expect(firstDay.body.papers).toHaveLength(1);
    expect(firstDay.body.papers[0]).toMatchObject({ id: "2604.12345", title: "Mock Paper" });

    expect(latest.body).toMatchObject({ selectedDate: "2026-04-25" });
    expect(latest.body.papers[0]).toMatchObject({ id: "2604.54321", title: "Later Mock Paper" });
  });
});

describe("GET /api/config", () => {
  it("does not expose local deployment details", async () => {
    const fixture = createFixture({
      adminToken: "secret-token",
      translation: {
        enabled: true,
        baseUrl: "https://api.example.test/v1",
        apiKey: "test-key",
        model: "private-model",
        targetLanguage: "zh",
        concurrency: 8,
        promptVersion: "test-prompt-v1",
        forceRefresh: false
      }
    });
    const response = await request(fixture.app).get("/api/config");
    fixture.cleanup();

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      categories: ["cs.AI", "cs.CV"],
      authors: [],
      maxResults: 1,
      authorMaxResults: 1,
      huggingFaceMaxResults: 1,
      syncTime: "08:00",
      translationEnabled: true
    });
    expect(response.body).not.toHaveProperty("databasePath");
    expect(response.body).not.toHaveProperty("translationModel");
    expect(response.body).not.toHaveProperty("translationConcurrency");
  });
});

describe("GET /api/huggingface-papers", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns Hugging Face daily papers for a selected date", async () => {
    const urls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: URL | RequestInfo) => {
        urls.push(String(url));
        return Response.json(huggingFaceDailyResponse);
      })
    );

    const fixture = createFixture({ huggingFaceMaxResults: 10 });
    const response = await request(fixture.app).get("/api/huggingface-papers?date=2026-06-02&maxResults=10");
    fixture.cleanup();

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      source: "huggingface",
      selectedDate: "2026-06-02",
      requestedCount: 1,
      totalFetched: 1,
      totalUnique: 1
    });
    expect(response.body.papers[0]).toMatchObject({
      id: "2606.02437",
      title: "HF Mock Paper",
      authors: ["Grace Hopper", "Katherine Johnson"],
      primaryCategory: "HF Daily",
      categories: ["HF Daily"],
      huggingFaceUrl: "https://huggingface.co/papers/2606.02437",
      upvotes: 44,
      submittedBy: "Andrew Chen"
    });
    expect(urls[0]).toContain("https://huggingface.co/api/daily_papers");
    expect(urls[0]).toContain("date=2026-06-02");
    expect(urls[0]).toContain("limit=10");
  });

  it("uses the same translation pipeline for Hugging Face daily sync", async () => {
    let translationRequests = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: URL | RequestInfo) => {
        if (String(url).includes("/chat/completions")) {
          translationRequests += 1;
          return new Response(JSON.stringify(translationResponse), { status: 200 });
        }
        return Response.json(huggingFaceDailyResponse);
      })
    );

    const fixture = createFixture({
      huggingFaceMaxResults: 10,
      translation: {
        enabled: true,
        baseUrl: "https://api.example.test/v1",
        apiKey: "test-key",
        model: "test-model",
        targetLanguage: "zh",
        concurrency: 1,
        promptVersion: "test-prompt-v1",
        forceRefresh: false
      }
    });
    const sync = await request(fixture.app).post("/api/sync").send({ kind: "huggingface", date: "2026-06-02" });
    const papers = await request(fixture.app).get("/api/huggingface-papers?date=2026-06-02&maxResults=10");
    fixture.cleanup();

    expect(sync.status).toBe(200);
    expect(sync.body.run.stats).toMatchObject({ translated: 1 });
    expect(translationRequests).toBe(1);
    expect(papers.body.papers[0].translations.zh).toMatchObject({
      title: "模拟论文",
      summary: "模拟摘要。"
    });
  });
});

describe("POST /api/sync authentication", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    clearArxivCache();
  });

  it("allows sync without a token when admin auth is disabled", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(atomResponse, { status: 200 }))
    );

    const fixture = createFixture({ categories: ["cs.AI"] });
    const response = await request(fixture.app).post("/api/sync").send({ kind: "daily" });
    fixture.cleanup();

    expect(response.status).toBe(200);
    expect(response.body.run).toMatchObject({ kind: "daily", status: "success" });
  });

  it("rejects sync without a token when admin auth is enabled", async () => {
    const fetchMock = vi.fn(async () => new Response(atomResponse, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const fixture = createFixture({ adminToken: "secret-token", categories: ["cs.AI"] });
    const response = await request(fixture.app).post("/api/sync").send({ kind: "daily" });
    fixture.cleanup();

    expect(response.status).toBe(401);
    expect(response.body.error).toContain("admin token");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("allows sync with a valid bearer admin token", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(atomResponse, { status: 200 }))
    );

    const fixture = createFixture({ adminToken: "secret-token", categories: ["cs.AI"] });
    const response = await request(fixture.app)
      .post("/api/sync")
      .set("Authorization", "Bearer secret-token")
      .send({ kind: "daily" });
    fixture.cleanup();

    expect(response.status).toBe(200);
    expect(response.body.run).toMatchObject({ kind: "daily", status: "success" });
  });
});

describe("MCP authentication", () => {
  it("rejects MCP requests when the server token is not configured", async () => {
    const fixture = createFixture({ adminToken: undefined });
    const response = await request(fixture.app).post("/mcp").send({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/list"
    });
    fixture.cleanup();

    expect(response.status).toBe(503);
    expect(response.body.error).toContain("PAPERS_EASY_ADMIN_TOKEN");
  });

  it("rejects MCP requests without a request token", async () => {
    const fixture = createFixture({ adminToken: "secret-token" });
    const response = await request(fixture.app).post("/mcp").send({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/list"
    });
    fixture.cleanup();

    expect(response.status).toBe(401);
    expect(response.body.error).toContain("Missing admin token");
  });

  it("rejects MCP requests with an invalid request token", async () => {
    const fixture = createFixture({ adminToken: "secret-token" });
    const response = await request(fixture.app)
      .post("/mcp")
      .set("Authorization", "Bearer wrong-token")
      .send({ jsonrpc: "2.0", id: 1, method: "tools/list" });
    fixture.cleanup();

    expect(response.status).toBe(403);
    expect(response.body.error).toContain("Invalid admin token");
  });
});

describe("MCP tools", () => {
  it("lists Papers Easy tools with bearer token auth", async () => {
    const fixture = createFixture({ adminToken: "secret-token" });
    const response = await request(fixture.app)
      .post("/mcp")
      .set("Accept", "application/json, text/event-stream")
      .set("Authorization", "Bearer secret-token")
      .send({ jsonrpc: "2.0", id: 1, method: "tools/list" });
    fixture.cleanup();

    expect(response.status).toBe(200);
    expect(response.body.result.tools.map((tool: { name: string }) => tool.name)).toEqual(
      expect.arrayContaining([
        "get_arxiv_daily_papers",
        "get_arxiv_author_papers",
        "get_huggingface_daily_papers",
        "sync_papers"
      ])
    );
  });

  it("accepts the Papers Easy admin token header for MCP", async () => {
    const fixture = createFixture({ adminToken: "secret-token" });
    const response = await request(fixture.app)
      .post("/mcp")
      .set("Accept", "application/json, text/event-stream")
      .set("X-Papers-Easy-Admin-Token", "secret-token")
      .send({ jsonrpc: "2.0", id: 1, method: "tools/list" });
    fixture.cleanup();

    expect(response.status).toBe(200);
    expect(response.body.result.tools.length).toBeGreaterThan(0);
  });

  it("read tools return cached-shape empty results without syncing", async () => {
    let fetchCalls = 0;
    const fixture = createFixture({ adminToken: "secret-token" }, {
      fetchImpl: async () => {
        fetchCalls += 1;
        return Response.json([]);
      }
    });

    const response = await request(fixture.app)
      .post("/mcp")
      .set("Accept", "application/json, text/event-stream")
      .set("Authorization", "Bearer secret-token")
      .send({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "get_huggingface_daily_papers", arguments: { date: "2026-06-02" } }
      });
    fixture.cleanup();

    expect(response.status).toBe(200);
    expect(fetchCalls).toBe(0);
    expect(JSON.stringify(response.body)).toContain("papers");
  });

  it("returns cached arXiv daily papers", async () => {
    const fixture = createFixture(
      { adminToken: "secret-token", categories: ["cs.AI"] },
      { fetchImpl: async () => new Response(atomResponse, { status: 200 }) }
    );
    await request(fixture.app)
      .post("/api/sync")
      .set("Authorization", "Bearer secret-token")
      .send({ kind: "daily" });

    const response = await request(fixture.app)
      .post("/mcp")
      .set("Accept", "application/json, text/event-stream")
      .set("Authorization", "Bearer secret-token")
      .send({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "get_arxiv_daily_papers", arguments: { categories: ["cs.AI"] } }
      });
    const data = readMcpJson<{ papers: Array<{ id: string; title: string }> }>(response);
    fixture.cleanup();

    expect(response.status).toBe(200);
    expect(data.papers[0]).toMatchObject({ id: "2604.12345", title: "Mock Paper" });
  });

  it("returns cached arXiv author papers", async () => {
    const fixture = createFixture(
      { adminToken: "secret-token", authors: ["Ada Lovelace"] },
      { fetchImpl: async () => new Response(authorAtomResponse, { status: 200 }) }
    );
    await request(fixture.app)
      .post("/api/sync")
      .set("Authorization", "Bearer secret-token")
      .send({ kind: "authors" });

    const response = await request(fixture.app)
      .post("/mcp")
      .set("Accept", "application/json, text/event-stream")
      .set("Authorization", "Bearer secret-token")
      .send({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "get_arxiv_author_papers", arguments: { authors: ["Ada Lovelace"] } }
      });
    const data = readMcpJson<{ papers: Array<{ id: string; title: string }> }>(response);
    fixture.cleanup();

    expect(response.status).toBe(200);
    expect(data.papers[0]).toMatchObject({ id: "2604.67890", title: "Author Mock Paper" });
  });

  it("returns cached Hugging Face daily papers", async () => {
    const fixture = createFixture(
      { adminToken: "secret-token" },
      { fetchImpl: async () => Response.json(huggingFaceDailyResponse) }
    );
    await request(fixture.app)
      .post("/api/sync")
      .set("Authorization", "Bearer secret-token")
      .send({ kind: "huggingface", date: "2026-06-02" });

    const response = await request(fixture.app)
      .post("/mcp")
      .set("Accept", "application/json, text/event-stream")
      .set("Authorization", "Bearer secret-token")
      .send({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "get_huggingface_daily_papers", arguments: { date: "2026-06-02" } }
      });
    const data = readMcpJson<{ papers: Array<{ id: string; title: string }> }>(response);
    fixture.cleanup();

    expect(response.status).toBe(200);
    expect(data.papers[0]).toMatchObject({ id: "2606.02437", title: "HF Mock Paper" });
  });

  it("syncs papers through the explicit MCP sync tool", async () => {
    const fixture = createFixture(
      { adminToken: "secret-token", categories: ["cs.AI"] },
      { fetchImpl: async () => new Response(atomResponse, { status: 200 }) }
    );
    const response = await request(fixture.app)
      .post("/mcp")
      .set("Accept", "application/json, text/event-stream")
      .set("Authorization", "Bearer secret-token")
      .send({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "sync_papers", arguments: { kind: "daily" } }
      });
    const data = readMcpJson<{ kind: string; status: string }>(response);
    fixture.cleanup();

    expect(response.status).toBe(200);
    expect(data).toMatchObject({ kind: "daily", status: "success" });
  });
});

describe("GET /api/author-papers", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    clearArxivCache();
  });

  it("returns deduplicated paper JSON for requested authors", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(atomResponse, { status: 200 }))
    );

    const fixture = createFixture({ authors: ["Ada Lovelace", "Alan Turing"] });
    const response = await request(fixture.app).get("/api/author-papers?authors=Ada%20Lovelace,Alan%20Turing&maxResults=1");
    fixture.cleanup();

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      source: "arxiv",
      authors: ["Ada Lovelace", "Alan Turing"],
      requestedCount: 2,
      totalFetched: 1,
      totalUnique: 1
    });
    expect(response.body.papers[0]).toMatchObject({
      id: "2604.12345",
      title: "Mock Paper",
      affiliations: ["Analytical Engine Institute"],
      categories: ["cs.AI"]
    });
  });

  it("requires at least one author", async () => {
    const fixture = createFixture({ authors: [] });
    const response = await request(fixture.app).get("/api/author-papers");
    fixture.cleanup();

    expect(response.status).toBe(400);
    expect(response.body.error).toContain("author");
  });

  it("runs a manual sync into the database", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(atomResponse, { status: 200 }))
    );

    const fixture = createFixture({ authors: ["Ada Lovelace"] });
    const response = await request(fixture.app).post("/api/sync").send({ kind: "all" });
    const papers = await request(fixture.app).get("/api/papers?categories=cs.AI&maxResults=10");
    fixture.cleanup();

    expect(response.status).toBe(200);
    expect(response.body.run).toMatchObject({
      kind: "all",
      status: "success"
    });
    expect(papers.body.papers[0]).toMatchObject({ id: "2604.12345" });
  });

  it("stores translated title and summary during sync", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: URL | RequestInfo) => {
        if (String(url).includes("/chat/completions")) {
          return new Response(JSON.stringify(translationResponse), { status: 200 });
        }
        return new Response(atomResponse, { status: 200 });
      })
    );

    const fixture = createFixture({
      categories: ["cs.AI"],
      translation: {
        enabled: true,
        baseUrl: "https://api.example.test/v1",
        apiKey: "test-key",
        model: "test-model",
        targetLanguage: "zh",
        concurrency: 2,
        promptVersion: "test-prompt-v1",
        forceRefresh: false
      }
    });
    const response = await request(fixture.app).post("/api/sync").send({ kind: "daily" });
    const papers = await request(fixture.app).get("/api/papers?categories=cs.AI&maxResults=10");
    fixture.cleanup();

    expect(response.status).toBe(200);
    expect(response.body.run.stats).toMatchObject({ translated: 1 });
    expect(papers.body.papers[0].translations.zh).toMatchObject({
      title: "模拟论文",
      affiliations: ["解析机研究所"],
      summary: "模拟摘要。"
    });
  });

  it("skips translation when cached metadata is still fresh", async () => {
    let translationRequests = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: URL | RequestInfo) => {
        if (String(url).includes("/chat/completions")) {
          translationRequests += 1;
          return new Response(JSON.stringify(translationResponse), { status: 200 });
        }
        return new Response(atomResponse, { status: 200 });
      })
    );

    const fixture = createFixture({
      categories: ["cs.AI"],
      translation: {
        enabled: true,
        baseUrl: "https://api.example.test/v1",
        apiKey: "test-key",
        model: "test-model",
        targetLanguage: "zh",
        concurrency: 1,
        promptVersion: "test-prompt-v1",
        forceRefresh: false
      }
    });

    await request(fixture.app).post("/api/sync").send({ kind: "daily" });
    await request(fixture.app).post("/api/sync").send({ kind: "daily" });
    fixture.cleanup();

    expect(translationRequests).toBe(1);
  });

  it("retranslates when source paper content changes", async () => {
    let feed = atomResponse;
    let translationRequests = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: URL | RequestInfo) => {
        if (String(url).includes("/chat/completions")) {
          translationRequests += 1;
          return new Response(JSON.stringify(translationResponse), { status: 200 });
        }
        return new Response(feed, { status: 200 });
      })
    );

    const fixture = createFixture({
      categories: ["cs.AI"],
      translation: {
        enabled: true,
        baseUrl: "https://api.example.test/v1",
        apiKey: "test-key",
        model: "test-model",
        targetLanguage: "zh",
        concurrency: 1,
        promptVersion: "test-prompt-v1",
        forceRefresh: false
      }
    });

    await request(fixture.app).post("/api/sync").send({ kind: "daily" });
    feed = atomResponse.replace("Mock abstract.", "Updated mock abstract.");
    await request(fixture.app).post("/api/sync").send({ kind: "daily" });
    fixture.cleanup();

    expect(translationRequests).toBe(2);
  });

  it("retranslates when translation model changes", async () => {
    let translationRequests = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: URL | RequestInfo) => {
        if (String(url).includes("/chat/completions")) {
          translationRequests += 1;
          return new Response(JSON.stringify(translationResponse), { status: 200 });
        }
        return new Response(atomResponse, { status: 200 });
      })
    );

    const fixture = createFixture({
      categories: ["cs.AI"],
      translation: {
        enabled: true,
        baseUrl: "https://api.example.test/v1",
        apiKey: "test-key",
        model: "test-model-a",
        targetLanguage: "zh",
        concurrency: 1,
        promptVersion: "test-prompt-v1",
        forceRefresh: false
      }
    });
    const nextApp = createApp({
      config: {
        ...fixture.config,
        translation: {
          ...fixture.config.translation,
          model: "test-model-b"
        }
      },
      store: fixture.store
    });

    await request(fixture.app).post("/api/sync").send({ kind: "daily" });
    await request(nextApp).post("/api/sync").send({ kind: "daily" });
    fixture.cleanup();

    expect(translationRequests).toBe(2);
  });

  it("renders an RSS feed for watched authors", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(atomResponse, { status: 200 }))
    );

    const fixture = createFixture({ authors: ["Ada Lovelace"] });
    const response = await request(fixture.app).get("/rss/arxiv-authors.xml");
    fixture.cleanup();

    expect(response.status).toBe(200);
    expect(response.headers["content-type"]).toContain("application/rss+xml");
    expect(response.text).toContain("<rss version=\"2.0\">");
    expect(response.text).toContain("<title>Mock Paper</title>");
    expect(response.text).toContain("<guid isPermaLink=\"false\">arxiv:2604.12345</guid>");
    expect(response.text).toContain("Ada Lovelace");
    expect(response.text).toContain("Analytical Engine Institute");
  });
});

describe("POST /api/paper-qa", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    clearArxivCache();
  });

  it("answers paper QA questions one at a time and caches each answer before the next question", async () => {
    const qaRequests: Array<Record<string, unknown>> = [];
    const qaModels: string[] = [];
    const cachedCountsBeforeQuestion: number[] = [];
    let activeQaRequests = 0;
    let maxActiveQaRequests = 0;
    let fixtureStore: PaperStore | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: URL | RequestInfo, init?: RequestInit) => {
        if (String(url).includes("/chat/completions")) {
          const payload = JSON.parse(String(init?.body)) as { messages: Array<{ content: string }>; model: string };
          const userPayload = JSON.parse(payload.messages[1].content) as Record<string, unknown>;
          if (!("current_question" in userPayload)) {
            return new Response(JSON.stringify(translationResponse), { status: 200 });
          }
          qaModels.push(payload.model);
          qaRequests.push(userPayload);
          cachedCountsBeforeQuestion.push(fixtureStore?.listPaperQaAnswers("2604.67890").length ?? -1);
          activeQaRequests += 1;
          maxActiveQaRequests = Math.max(maxActiveQaRequests, activeQaRequests);
          await new Promise((resolve) => setTimeout(resolve, 10));
          activeQaRequests -= 1;
          return new Response(
            JSON.stringify({
              choices: [{ message: { content: JSON.stringify({ answer: `回答 ${String(userPayload.current_question_number)}` }) } }]
            }),
            { status: 200 }
          );
        }
        return new Response(authorAtomResponse, { status: 200 });
      })
    );

    const fixture = createFixture({
      authors: ["Ada Lovelace"],
      translation: {
        enabled: false,
        baseUrl: "https://api.example.test/v1",
        model: "translation-model",
        targetLanguage: "zh",
        concurrency: 1,
        promptVersion: "test-prompt-v1",
        forceRefresh: false
      },
      paperQa: {
        enabled: true,
        baseUrl: "https://api.example.test/v1",
        apiKey: "qa-test-key",
        model: "paper-qa-model",
        concurrency: 3,
        batchConcurrency: 2
      }
    }, {
      paperFullTextExtractor: async (paper) => ({
        text: `Full text for ${paper.id}. The method uses retrieval over the entire PDF and evaluates on benchmark experiments.`,
        sourceUrl: paper.pdfUrl,
        contentHash: "test-full-text-hash"
      })
    });
    fixtureStore = fixture.store;

    await request(fixture.app).post("/api/sync").send({ kind: "authors" });
    const run = await request(fixture.app).post("/api/paper-qa").send({ paperId: "2604.67890" });
    const cached = await request(fixture.app).get("/api/paper-qa?paperId=2604.67890");
    const rerun = await request(fixture.app).post("/api/paper-qa").send({ paperId: "2604.67890" });
    fixture.cleanup();

    expect(run.status).toBe(200);
    expect(run.body).toMatchObject({ paperId: "2604.67890", status: "complete", completedCount: 6, totalCount: 6 });
    expect(cached.body.answers).toHaveLength(6);
    expect(rerun.status).toBe(200);
    expect(qaRequests).toHaveLength(6);
    expect(maxActiveQaRequests).toBe(1);
    expect(qaModels).toEqual(Array(6).fill("paper-qa-model"));
    expect(qaRequests.map((body) => body.current_question)).toEqual(paperQaQuestions);
    expect(cachedCountsBeforeQuestion).toEqual([0, 1, 2, 3, 4, 5]);
    for (const requestBody of qaRequests) {
      expect(requestBody).not.toHaveProperty("questions");
      expect(requestBody).not.toHaveProperty("all_questions");
      expect(requestBody.paper).toMatchObject({
        full_text: "Full text for 2604.67890. The method uses retrieval over the entire PDF and evaluates on benchmark experiments.",
        full_text_source_url: "https://arxiv.org/pdf/2604.67890"
      });
      expect(requestBody.output_schema).toMatchObject({ answer: "string" });
    }
  });

  it("runs paper QA for Hugging Face daily papers in one request", async () => {
    let qaRequests = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: URL | RequestInfo, init?: RequestInit) => {
        if (String(url).includes("/chat/completions")) {
          const payload = JSON.parse(String(init?.body)) as { messages: Array<{ content: string }> };
          const userPayload = JSON.parse(payload.messages[1].content) as Record<string, unknown>;
          qaRequests += 1;
          return new Response(
            JSON.stringify({
              choices: [{ message: { content: JSON.stringify({ answer: `HF 回答 ${String(userPayload.current_question_number)}` }) } }]
            }),
            { status: 200 }
          );
        }
        return Response.json(huggingFaceDailyResponse);
      })
    );

    const fixture = createFixture({
      huggingFaceMaxResults: 10,
      paperQa: {
        enabled: true,
        baseUrl: "https://api.example.test/v1",
        apiKey: "qa-test-key",
        model: "paper-qa-model",
        concurrency: 3,
        batchConcurrency: 2
      }
    }, {
      paperFullTextExtractor: async (paper) => ({
        text: `Full text for ${paper.id}.`,
        sourceUrl: paper.pdfUrl,
        contentHash: "test-hf-full-text-hash"
      })
    });

    const run = await request(fixture.app).post("/api/huggingface-paper-qa").send({ date: "2026-06-02" });
    const cached = await request(fixture.app).get("/api/paper-qa?paperId=2606.02437");
    fixture.cleanup();

    expect(run.status).toBe(200);
    expect(run.body).toMatchObject({
      source: "huggingface",
      selectedDate: "2026-06-02",
      status: "complete",
      totalPapers: 1,
      completedPapers: 1,
      failedPapers: 0,
      completedQuestions: 6,
      totalQuestions: 6
    });
    expect(run.body.results[0]).toMatchObject({ paperId: "2606.02437", status: "complete" });
    expect(cached.body.completedCount).toBe(6);
    expect(qaRequests).toBe(6);
  });

  it("persists paper QA run state while running and after completion", async () => {
    let releaseQa: () => void = () => undefined;
    let resolveQaStarted: () => void = () => undefined;
    const qaStarted = new Promise<void>((resolve) => {
      resolveQaStarted = resolve;
    });
    let qaRequests = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: URL | RequestInfo, init?: RequestInit) => {
        if (String(url).includes("/chat/completions")) {
          qaRequests += 1;
          const payload = JSON.parse(String(init?.body)) as { messages: Array<{ content: string }> };
          const userPayload = JSON.parse(payload.messages[1].content) as Record<string, unknown>;
          if (qaRequests === 1) {
            resolveQaStarted();
            await new Promise<void>((resolve) => {
              releaseQa = resolve;
            });
          }
          return new Response(
            JSON.stringify({
              choices: [{ message: { content: JSON.stringify({ answer: `回答 ${String(userPayload.current_question_number)}` }) } }]
            }),
            { status: 200 }
          );
        }
        return new Response(authorAtomResponse, { status: 200 });
      })
    );

    const fixture = createFixture({ authors: ["Ada Lovelace"], paperQa: { enabled: false, baseUrl: "", model: "", concurrency: 1, batchConcurrency: 1 } });
    await request(fixture.app).post("/api/sync").send({ kind: "authors" });
    const qaApp = createApp({
      config: {
        ...fixture.config,
        paperQa: {
          enabled: true,
          baseUrl: "https://api.example.test/v1",
          apiKey: "qa-test-key",
          model: "paper-qa-model",
          concurrency: 3,
          batchConcurrency: 2
        }
      },
      store: fixture.store,
      paperFullTextExtractor: async (paper) => ({
        text: `Full text for ${paper.id}.`,
        sourceUrl: paper.pdfUrl,
        contentHash: `full-text-${paper.id}`
      })
    });

    const runPromise = request(qaApp)
      .post("/api/paper-qa")
      .send({ paperId: "2604.67890" })
      .then((response) => response);
    await qaStarted;
    const getRun = () =>
      (fixture.store as unknown as {
        getPaperQaRun(paperId: string): { status: string; completedCount: number; totalCount: number; error?: string } | null;
      }).getPaperQaRun("2604.67890");

    try {
      expect(getRun()).toMatchObject({ status: "running", completedCount: 0, totalCount: 6 });
    } finally {
      releaseQa();
    }
    const run = await runPromise;
    expect(run.status).toBe(200);
    expect(getRun()).toMatchObject({ status: "complete", completedCount: 6, totalCount: 6 });
    fixture.cleanup();
  });

  it("reuses cached PDF full text when paper QA is forced to rerun", async () => {
    let extractorCalls = 0;
    let qaRequests = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: URL | RequestInfo, init?: RequestInit) => {
        if (String(url).includes("/chat/completions")) {
          qaRequests += 1;
          const payload = JSON.parse(String(init?.body)) as { messages: Array<{ content: string }> };
          const userPayload = JSON.parse(payload.messages[1].content) as Record<string, unknown>;
          return new Response(
            JSON.stringify({
              choices: [{ message: { content: JSON.stringify({ answer: `回答 ${String(userPayload.current_question_number)}` }) } }]
            }),
            { status: 200 }
          );
        }
        return new Response(authorAtomResponse, { status: 200 });
      })
    );

    const fixture = createFixture({ authors: ["Ada Lovelace"], paperQa: { enabled: false, baseUrl: "", model: "", concurrency: 1, batchConcurrency: 1 } });
    await request(fixture.app).post("/api/sync").send({ kind: "authors" });
    const qaApp = createApp({
      config: {
        ...fixture.config,
        paperQa: {
          enabled: true,
          baseUrl: "https://api.example.test/v1",
          apiKey: "qa-test-key",
          model: "paper-qa-model",
          concurrency: 3,
          batchConcurrency: 2
        }
      },
      store: fixture.store,
      paperFullTextExtractor: async (paper) => {
        extractorCalls += 1;
        return {
          text: `Full text for ${paper.id}.`,
          sourceUrl: paper.pdfUrl,
          contentHash: `full-text-${paper.id}`
        };
      }
    });

    const firstRun = await request(qaApp).post("/api/paper-qa").send({ paperId: "2604.67890" });
    const forcedRun = await request(qaApp).post("/api/paper-qa").send({ paperId: "2604.67890", force: true });
    fixture.cleanup();

    expect(firstRun.status).toBe(200);
    expect(forcedRun.status).toBe(200);
    expect(qaRequests).toBe(12);
    expect(extractorCalls).toBe(1);
  });
});

describe("POST /api/sync", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    clearArxivCache();
  });

  it("does not reuse a daily sync result for a concurrent authors sync request", async () => {
    let releaseDailyFetch: () => void = () => undefined;
    let resolveDailyStarted: () => void = () => undefined;
    const dailyStarted = new Promise<void>((resolve) => {
      resolveDailyStarted = resolve;
    });

    const fetchMock = vi.fn(async (url: URL | RequestInfo) => {
      const searchQuery = new URL(String(url)).searchParams.get("search_query") ?? "";
      if (searchQuery.startsWith("cat:")) {
        resolveDailyStarted();
        await new Promise<void>((resolve) => {
          releaseDailyFetch = resolve;
        });
        return new Response(atomResponse, { status: 200 });
      }

      if (searchQuery.startsWith("au:")) {
        return new Response(authorAtomResponse, { status: 200 });
      }

      return new Response("unexpected query", { status: 500 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const fixture = createFixture({
      categories: ["cs.AI"],
      authors: ["Ada Lovelace"],
      maxResults: 1,
      authorMaxResults: 1
    });

    const dailyRequest = request(fixture.app)
      .post("/api/sync")
      .send({ kind: "daily" })
      .then((response) => response);
    await dailyStarted;
    const authorsRequest = request(fixture.app)
      .post("/api/sync")
      .send({ kind: "authors" })
      .then((response) => response);
    await new Promise((resolve) => setTimeout(resolve, 20));
    releaseDailyFetch();

    const [dailyResponse, authorsResponse] = await Promise.all([dailyRequest, authorsRequest]);
    fixture.cleanup();

    expect(dailyResponse.status).toBe(200);
    expect(authorsResponse.status).toBe(200);
    expect(dailyResponse.body.run).toMatchObject({ kind: "daily", status: "success" });
    expect(authorsResponse.body.run).toMatchObject({ kind: "authors", status: "success" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("auto-runs paper QA for author and Hugging Face syncs but keeps arXiv daily manual", async () => {
    const qaRequestsByTitle = new Map<string, number>();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: URL | RequestInfo, init?: RequestInit) => {
        if (String(url).includes("/chat/completions")) {
          const payload = JSON.parse(String(init?.body)) as { messages: Array<{ content: string }> };
          const userPayload = JSON.parse(payload.messages[1].content) as { current_question_number: number; paper: { title: string } };
          qaRequestsByTitle.set(userPayload.paper.title, (qaRequestsByTitle.get(userPayload.paper.title) ?? 0) + 1);
          return new Response(
            JSON.stringify({
              choices: [{ message: { content: JSON.stringify({ answer: `回答 ${String(userPayload.current_question_number)}` }) } }]
            }),
            { status: 200 }
          );
        }

        if (String(url).includes("huggingface.co/api/daily_papers")) {
          return Response.json(huggingFaceDailyResponse);
        }

        const searchQuery = new URL(String(url)).searchParams.get("search_query") ?? "";
        if (searchQuery.startsWith("cat:")) {
          return new Response(atomResponse, { status: 200 });
        }
        if (searchQuery.startsWith("au:")) {
          return new Response(authorAtomResponse, { status: 200 });
        }

        return new Response("unexpected query", { status: 500 });
      })
    );

    const fixture = createFixture({
      categories: ["cs.AI"],
      authors: ["Ada Lovelace"],
      huggingFaceMaxResults: 10,
      paperQa: {
        enabled: true,
        baseUrl: "https://api.example.test/v1",
        apiKey: "qa-test-key",
        model: "paper-qa-model",
        concurrency: 3,
        batchConcurrency: 2
      }
    }, {
      paperFullTextExtractor: async (paper) => ({
        text: `Full text for ${paper.id}.`,
        sourceUrl: paper.pdfUrl,
        contentHash: `full-text-${paper.id}`
      })
    });

    const dailySync = await request(fixture.app).post("/api/sync").send({ kind: "daily" });
    const dailyQa = await request(fixture.app).get("/api/paper-qa?paperId=2604.12345");
    const authorSync = await request(fixture.app).post("/api/sync").send({ kind: "authors" });
    const authorQa = await request(fixture.app).get("/api/paper-qa?paperId=2604.67890");
    const huggingFaceSync = await request(fixture.app).post("/api/sync").send({ kind: "huggingface", date: "2026-06-02" });
    const huggingFaceQa = await request(fixture.app).get("/api/paper-qa?paperId=2606.02437");
    fixture.cleanup();

    expect(dailySync.status).toBe(200);
    expect(authorSync.status).toBe(200);
    expect(huggingFaceSync.status).toBe(200);
    expect(dailyQa.body).toMatchObject({ status: "idle", completedCount: 0 });
    expect(authorQa.body).toMatchObject({ status: "complete", completedCount: 6 });
    expect(huggingFaceQa.body).toMatchObject({ status: "complete", completedCount: 6 });
    expect(qaRequestsByTitle.get("Mock Paper") ?? 0).toBe(0);
    expect(qaRequestsByTitle.get("Author Mock Paper")).toBe(6);
    expect(qaRequestsByTitle.get("HF Mock Paper")).toBe(6);
  });

  it("reports a running sync run before the sync request finishes", async () => {
    let releaseFetch: () => void = () => undefined;
    let resolveFetchStarted: () => void = () => undefined;
    const fetchStarted = new Promise<void>((resolve) => {
      resolveFetchStarted = resolve;
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        resolveFetchStarted();
        await new Promise<void>((resolve) => {
          releaseFetch = resolve;
        });
        return new Response(atomResponse, { status: 200 });
      })
    );

    const fixture = createFixture({ categories: ["cs.AI"] });
    const syncRequest = request(fixture.app)
      .post("/api/sync")
      .send({ kind: "daily" })
      .then((response) => response);
    await fetchStarted;
    const running = await request(fixture.app).get("/api/sync/latest");
    releaseFetch();
    const finished = await syncRequest;
    const latest = await request(fixture.app).get("/api/sync/latest");
    fixture.cleanup();

    expect(running.body.run).toMatchObject({ kind: "daily", status: "running" });
    expect(finished.status).toBe(200);
    expect(latest.body.run).toMatchObject({ kind: "daily", status: "success" });
  });
});

function readMcpJson<T>(response: SupertestResponse): T {
  const content = response.body.result?.content;
  expect(Array.isArray(content)).toBe(true);
  expect(content[0]).toMatchObject({ type: "text" });
  return JSON.parse(content[0].text) as T;
}

function createFixture(
  overrides: Partial<AppConfig> = {},
  appOptions: { fetchImpl?: typeof fetch; paperFullTextExtractor?: PaperFullTextExtractor } = {}
) {
  const dir = mkdtempSync(path.join(tmpdir(), "papers-easy-"));
  const config: AppConfig = {
    categories: ["cs.AI", "cs.CV"],
    authors: [],
    maxResults: 1,
    authorMaxResults: 1,
    huggingFaceMaxResults: 1,
    databasePath: path.join(dir, "papers.easy.sqlite"),
    adminToken: undefined,
    syncTime: "08:00",
    autoSync: false,
    syncOnStart: false,
    fetchTimeoutMs: 20_000,
    fetchRetries: 2,
    fetchRetryBaseDelayMs: 0,
    arxivRequestDelayMs: 0,
    arxivUserAgent: "papers.easy/test",
    translation: {
      enabled: false,
      baseUrl: "https://api.openai.com/v1",
      model: "gpt-4o-mini",
      targetLanguage: "zh",
      concurrency: 1,
      promptVersion: "default",
      forceRefresh: false
    },
    paperQa: {
      enabled: false,
      baseUrl: "https://api.openai.com/v1",
      model: "gpt-4o-mini",
      concurrency: 3,
      batchConcurrency: 2
    },
    ...overrides
  };
  const store = new PaperStore(config.databasePath);

  return {
    app: createApp({ config, store, ...appOptions }),
    config,
    store,
    cleanup: () => {
      store.close();
      rmSync(dir, { recursive: true, force: true });
    }
  };
}
