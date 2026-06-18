# Paper Easy Codex Plugin

Codex plugin for querying a local Paper Easy MCP server.

## MCP

The plugin connects to the local streamable HTTP MCP endpoint exposed by
`paper-easy`:

```text
http://127.0.0.1:5174/mcp
```

Set the admin token in the environment before using MCP tools:

```sh
export PAPERS_EASY_ADMIN_TOKEN="..."
```

Do not commit token values to this repository. If you deploy Paper Easy to a
remote host, edit `.mcp.json` locally and keep that deployment URL private when
needed.

## Tools

- `get_arxiv_daily_papers`
- `get_arxiv_author_papers`
- `get_huggingface_daily_papers`
- `sync_papers`
