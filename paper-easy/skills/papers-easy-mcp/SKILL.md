---
name: papers-easy-mcp
description: Use when querying or refreshing a deployed Papers Easy MCP server for arXiv daily papers, arXiv watched-author papers, or Hugging Face Daily Papers.
---

# Papers Easy MCP

Use this skill when a user wants an AI client to query or refresh a deployed Papers Easy site through MCP.

## Connection

- MCP endpoint path: `/mcp`
- Transport: Streamable HTTP
- Successful JSON request/response clients should send `Accept: application/json, text/event-stream`.
- Authentication header: `Authorization: Bearer $PAPERS_EASY_ADMIN_TOKEN`
- Compatible header: `X-Papers-Easy-Admin-Token: $PAPERS_EASY_ADMIN_TOKEN`

Never print or store the token value. Refer to `PAPERS_EASY_ADMIN_TOKEN` by name.

## Tools

- `get_arxiv_daily_papers`: read cached arXiv daily papers. Inputs: `categories?`, `date?`, `maxResults?`.
- `get_arxiv_author_papers`: read cached arXiv watched-author papers. Inputs: `authors?`, `maxResults?`.
- `get_huggingface_daily_papers`: read cached Hugging Face Daily Papers. Inputs: `date?`, `maxResults?`.
- `sync_papers`: explicitly refresh cached feeds. Inputs: `kind`, `date?`.

Read tools do not trigger sync. Call `sync_papers` first when freshness matters.

## Common Workflows

To query the latest cached Hugging Face Daily Papers, call `get_huggingface_daily_papers` with no date.

To query a specific Hugging Face date, call `get_huggingface_daily_papers` with `date` in `YYYY-MM-DD` format.

To query arXiv daily papers for specific categories, call `get_arxiv_daily_papers` with `categories` and optionally `date`.

To query watched authors, call `get_arxiv_author_papers` without `authors`, or pass a specific `authors` list.

To refresh data before reading, call `sync_papers` with `kind` set to one of `daily`, `authors`, `huggingface`, or `all`, then call the read tool.

## Troubleshooting

- `PAPERS_EASY_ADMIN_TOKEN must be configured`: set the server environment variable before enabling remote MCP access.
- `Missing admin token`: send the token in `Authorization` or `X-Papers-Easy-Admin-Token`.
- `Invalid admin token`: verify the client token matches `PAPERS_EASY_ADMIN_TOKEN`.
- `date must use YYYY-MM-DD format`: pass dates like `2026-06-09`.
- Empty `papers`: the cache may be empty; call `sync_papers` explicitly.
- Failed sync: inspect the returned `SyncRun.status` and `SyncRun.errorMessage`.
