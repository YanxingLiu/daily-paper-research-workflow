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

## Hosted read-only endpoint

If you do not want to run Paper Easy locally, this repository also includes a
hosted read-only example:

```sh
cp .mcp.hosted.example.json .mcp.json
```

The hosted instance is:

```text
https://paper-easy.liuyanxing.site:8443/
```

It does not require an admin token for read-only tools. Availability is not
guaranteed long term because the host machine may move during graduation.

## Tools

- `get_arxiv_daily_papers`
- `get_arxiv_author_papers`
- `get_huggingface_daily_papers`
- `sync_papers`
