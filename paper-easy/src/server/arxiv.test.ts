import { describe, expect, it, vi } from "vitest";
import { dedupePapers, fetchPapersForAuthors, normalizeArxivId, paperFromAtomEntry } from "./arxiv";
import type { Paper } from "../shared/types";

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
  </entry>
</feed>`;

describe("normalizeArxivId", () => {
  it("removes versions from modern arXiv abs urls", () => {
    expect(normalizeArxivId("http://arxiv.org/abs/2604.12345v2")).toBe("2604.12345");
  });

  it("removes versions from legacy arXiv ids", () => {
    expect(normalizeArxivId("cs/9901001v1")).toBe("cs/9901001");
  });

  it("keeps clean ids unchanged", () => {
    expect(normalizeArxivId("2604.12345")).toBe("2604.12345");
  });
});

describe("paperFromAtomEntry", () => {
  it("creates a paper from an Atom entry", () => {
    const paper = paperFromAtomEntry(
      {
        id: "http://arxiv.org/abs/2604.12345v1",
        title: "  A   Useful\nPaper ",
        summary: "  This paper solves a problem.\nIt works. ",
        published: "2026-04-23T12:00:00Z",
        updated: "2026-04-24T12:00:00Z",
        author: [
          { name: "Ada Lovelace", "arxiv:affiliation": "Analytical Engine Institute" },
          { name: "Alan Turing", "arxiv:affiliation": "Bletchley Park" }
        ],
        category: [{ "@_term": "cs.AI" }, { "@_term": "cs.CV" }],
        "arxiv:primary_category": { "@_term": "cs.AI" },
        link: [
          { "@_href": "https://arxiv.org/abs/2604.12345v1", "@_rel": "alternate" },
          { "@_href": "https://arxiv.org/pdf/2604.12345v1", "@_title": "pdf" }
        ]
      },
      "cs.CV"
    );

    expect(paper).toMatchObject({
      id: "2604.12345",
      versionedId: "2604.12345v1",
      title: "A Useful Paper",
      summary: "This paper solves a problem. It works.",
      authors: ["Ada Lovelace", "Alan Turing"],
      affiliations: ["Analytical Engine Institute", "Bletchley Park"],
      primaryCategory: "cs.AI",
      categories: ["cs.AI", "cs.CV"],
      arxivUrl: "https://arxiv.org/abs/2604.12345",
      pdfUrl: "https://arxiv.org/pdf/2604.12345"
    });
  });
});

describe("dedupePapers", () => {
  const basePaper: Paper = {
    id: "2604.12345",
    versionedId: "2604.12345v1",
    title: "Shared Paper",
    summary: "Abstract",
    authors: ["Ada Lovelace"],
    affiliations: ["Analytical Engine Institute"],
    published: "2026-04-23T12:00:00Z",
    updated: "2026-04-24T12:00:00Z",
    primaryCategory: "cs.AI",
    categories: ["cs.AI"],
    arxivUrl: "https://arxiv.org/abs/2604.12345",
    pdfUrl: "https://arxiv.org/pdf/2604.12345"
  };

  it("merges duplicate papers by normalized id", () => {
    const papers = dedupePapers([
      basePaper,
      {
        ...basePaper,
        versionedId: "2604.12345v2",
        categories: ["cs.CV", "cs.AI"],
        updated: "2026-04-25T12:00:00Z"
      },
      {
        ...basePaper,
        id: "2604.99999",
        versionedId: "2604.99999v1",
        title: "Another Paper",
        categories: ["cs.CL"]
      }
    ]);

    expect(papers).toHaveLength(2);
    expect(papers[0].id).toBe("2604.12345");
    expect(papers[0].categories).toEqual(["cs.AI", "cs.CV"]);
    expect(papers[0].updated).toBe("2026-04-25T12:00:00Z");
    expect(papers[1].id).toBe("2604.99999");
  });
});

describe("fetchPapersForAuthors", () => {
  it("queries arXiv by author and deduplicates matching papers", async () => {
    const urls: string[] = [];
    const fetchImpl = vi.fn(async (url: URL | RequestInfo) => {
      urls.push(String(url));
      return new Response(atomResponse, { status: 200 });
    }) as typeof fetch;

    const response = await fetchPapersForAuthors({
      authors: ["Ada Lovelace", "Alan Turing"],
      maxResults: 1,
      fetchImpl
    });

    expect(response).toMatchObject({
      source: "arxiv",
      authors: ["Ada Lovelace", "Alan Turing"],
      requestedCount: 2,
      totalFetched: 2,
      totalUnique: 1
    });
    expect(response.papers[0]).toMatchObject({
      id: "2604.12345",
      authors: ["Ada Lovelace"],
      affiliations: ["Analytical Engine Institute"],
      categories: ["cs.AI"]
    });
    expect(urls).toHaveLength(2);
    expect(urls[0]).toContain("search_query=au%3A%22Ada+Lovelace%22");
    expect(urls[1]).toContain("search_query=au%3A%22Alan+Turing%22");
  });
});
