# Security Notes

## What is intentionally excluded

The public repository should not contain:

- real `.env` files
- API keys or admin tokens
- Paper Easy SQLite databases
- Zotero SQLite databases
- Paper PDFs or local Zotero attachments
- generated `automation/work/` outputs
- generated note Markdown artifacts
- private deployment URLs, except the optional public hosted Paper Easy endpoint documented for read-only trial use

## Token handling

Paper Easy MCP requires `PAPERS_EASY_ADMIN_TOKEN`. Keep it in the shell
environment or in a local `.env` file that is ignored by git.

The Codex Paper Easy plugin reads only the environment variable name:

```json
{
  "bearer_token_env_var": "PAPERS_EASY_ADMIN_TOKEN"
}
```

It must not contain the token value.

## Zotero write boundary

The automation does not directly modify Zotero SQLite. It writes through:

- Zotero Connector
- Zotero local API
- Better BibTeX runtime helpers
- LM for Zotero `zotero_script` in write mode

This keeps the workflow recoverable and avoids corrupting Zotero's database.

## Recommended pre-push scan

```bash
rg -n "(sk-[A-Za-z0-9_-]+|ghp_[A-Za-z0-9_]+|glpat-[A-Za-z0-9_-]+|xox[baprs]-[A-Za-z0-9-]+|BEGIN [A-Z ]*PRIVATE KEY|PAPERS_EASY_ADMIN_TOKEN=.+|OPENAI_API_KEY=.+)" .
```

Expected matches should only be empty placeholders, documentation examples, or regex text in this file.

## Dependency audit

Run:

```bash
cd paper-easy
npm audit --omit=dev
```

At publication time, `npm audit fix` updates the production Vite chain to the latest compatible version. If npm reports a remaining low-severity `esbuild` development-server advisory, check whether it applies to your platform and usage. Avoid `npm audit fix --force` unless you are ready to validate breaking upgrades.
