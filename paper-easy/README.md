# Paper Easy

Paper Easy is a small self-hosted paper reader and MCP server used by the daily paper workflow.

It provides:

- cached arXiv Daily papers by category
- cached watched-author arXiv papers
- cached Hugging Face Daily Papers
- optional AI translation / paper QA hooks
- authenticated MCP tools for Codex

## Local Development

```bash
cp .env.example .env
npm install
npm run server
```

The service reads `.env` itself. Do not `source .env` in shell; some values can contain spaces.

Default endpoints:

- Web app: `http://127.0.0.1:5174`
- Health: `http://127.0.0.1:5174/api/health`
- MCP: `http://127.0.0.1:5174/mcp`

MCP requests require `PAPERS_EASY_ADMIN_TOKEN`.

## Tests

```bash
npm run typecheck
npm test
```

