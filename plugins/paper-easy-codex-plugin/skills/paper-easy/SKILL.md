---
name: paper-easy
description: Use when querying a local Paper Easy server for arXiv daily papers, watched-author papers, Hugging Face Daily Papers, or refreshing those cached feeds through MCP.
---

# Paper Easy

Use this skill to query the local Paper Easy MCP server.

## MCP Server

- Default MCP URL: `http://127.0.0.1:5174/mcp`
- The plugin connects directly to the local streamable HTTP MCP server.
- Configure the admin token in `PAPERS_EASY_ADMIN_TOKEN` before using MCP tools.

Never print or store token values.

## Tools

- `get_arxiv_daily_papers`: read cached arXiv daily papers. Inputs: `categories?`, `date?`, `maxResults?`.
- `get_arxiv_author_papers`: read cached arXiv watched-author papers. Inputs: `authors?`, `maxResults?`.
- `get_huggingface_daily_papers`: read cached Hugging Face Daily Papers. Inputs: `date?`, `maxResults?`.
- `sync_papers`: explicitly refresh cached feeds. Inputs: `kind`, `date?`.

Read tools do not trigger sync. Use `sync_papers` only when freshness matters.

## Common Requests

- "Show today's Hugging Face Daily Papers."
- "List watched-author papers from Paper Easy."
- "Get cached arXiv daily papers for `cs.AI`."
- "Refresh Hugging Face Daily Papers, then show the results."

## Troubleshooting

- `Missing Paper Easy admin token`: set `PAPERS_EASY_ADMIN_TOKEN`.
- `401 Missing admin token`: the remote server did not receive the token header.
- `date must use YYYY-MM-DD format`: pass dates like `2026-06-09`.
- Empty `papers`: the cache may be empty; call `sync_papers` explicitly if refresh is acceptable.
