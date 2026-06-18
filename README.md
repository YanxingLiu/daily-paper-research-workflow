<p align="center">
  <img src="assets/logo.svg" width="148" alt="Daily Paper Research Workflow logo">
</p>

<h1 align="center">Daily Paper Research Workflow</h1>

<p align="center">
  <strong>A reproducible Codex + Paper Easy + Zotero + Obsidian workflow for turning daily AI paper feeds into an actionable research brief.</strong>
</p>

<p align="center">
  <a href="README.zh-CN.md">中文</a>
  ·
  <a href="docs/AI_INSTALL.md">AI install guide</a>
  ·
  <a href="docs/INSTALL.md">Manual install</a>
  ·
  <a href="docs/WORKFLOW.md">Workflow</a>
  ·
  <a href="docs/SECURITY.md">Security</a>
</p>

<p align="center">
  <a href="https://github.com/YanxingLiu/daily-paper-research-workflow"><img alt="GitHub repo" src="https://img.shields.io/badge/GitHub-daily--paper--workflow-24292f?logo=github"></a>
  <img alt="Platform" src="https://img.shields.io/badge/platform-macOS-lightgrey">
  <img alt="License" src="https://img.shields.io/badge/license-MIT-2f855a">
  <img alt="Codex" src="https://img.shields.io/badge/built%20for-Codex-5E4AE3">
</p>

![Daily Paper Research Workflow showcase](assets/showcase.png)

## Why This Exists

Daily paper feeds are useful, but they are noisy. This project packages a workflow that:

- reads daily arXiv and Hugging Face paper feeds through Paper Easy,
- asks Codex to do the only subjective step: theme-based paper selection,
- deterministically syncs selected papers and PDFs into Zotero,
- writes a consistent Markdown daily brief into Obsidian,
- adds one-click links for on-demand LM for Zotero notes instead of summarizing every paper upfront.

The goal is not to let an agent decide what is important for you. The goal is to remove repetitive paper triage work while keeping the final reading and judgment in your hands.

## What Is Included

| Path | Purpose |
| --- | --- |
| `paper-easy/` | Paper Easy source code for cached arXiv/Hugging Face feeds and the MCP endpoint. |
| `plugins/paper-easy-codex-plugin/` | Codex plugin for reading Paper Easy through MCP. |
| `plugins/codex-obsidian/` | Codex Obsidian plugin submodule, pointing to `YanxingLiu/codex-obsidian`. |
| `plugins/openai-plugins/` | OpenAI plugins monorepo submodule; the Zotero plugin is at `plugins/openai-plugins/plugins/zotero`. |
| `automation/` | Deterministic pipeline scripts, LM for Zotero prompts, and example inputs. |
| `scripts/` | Bootstrap, plugin install, Paper Easy startup, and macOS URL handler helpers. |
| `docs/` | Installation, AI-agent installation, workflow, and security notes. |

## Workflow

```mermaid
flowchart LR
  A[Paper Easy feeds] --> B[Codex selects topics]
  B --> C[01 prepare input JSON]
  C --> D[02 sync Zotero item + PDF]
  D --> E[04 write Obsidian brief]
  E --> F[Click LM for Zotero prompt link]
  F --> G[05 generate one Zotero note on demand]
```

Default interest topics:

- world models
- embodied intelligence
- spatial memory
- multimodal large language models

You can change the topics in the Codex automation prompt and input JSON.

## Quick Start

macOS is the primary target because the on-demand note action uses a custom `daily-paper-note://` URL handler.

```bash
git clone --recurse-submodules https://github.com/YanxingLiu/daily-paper-research-workflow.git
cd daily-paper-research-workflow

./scripts/bootstrap.sh
eval "$(./scripts/print_paper_easy_token.sh)"
./scripts/install_codex_plugins.sh
./scripts/install_note_url_handler.sh
./scripts/run_paper_easy.sh
```

`run_paper_easy.sh` starts the local Paper Easy server at `http://127.0.0.1:5174` and keeps the terminal occupied. Open another Codex session and ask Codex to follow `docs/CODEX_DAILY_AUTOMATION_PROMPT.md`.

If you want Codex to install the workflow for you, ask it to read:

```text
docs/AI_INSTALL.md
```

That file is written as an installation playbook for an AI coding agent.

## Paper Easy Backend Options

### Option A: Run Paper Easy Locally

This is recommended for long-term use. Local deployment gives you stable cache refresh, local configuration, and full control over the arXiv/Hugging Face feed settings.

Default endpoints:

- Web: `http://127.0.0.1:5174`
- MCP: `http://127.0.0.1:5174/mcp`

### Option B: Use the Hosted Read-Only Paper Easy

If you do not want to run the arXiv crawler locally, you can try my hosted Paper Easy instance:

```text
https://paper-easy.liuyanxing.site:8443/
```

Read-only tools do not require an admin token. The caveat is practical: I am close to graduation and moving, so the host machine may be moved and the service is not guaranteed to stay available.

To switch the Codex plugin to the hosted read-only MCP endpoint:

```bash
cp plugins/paper-easy-codex-plugin/.mcp.hosted.example.json \
  plugins/paper-easy-codex-plugin/.mcp.json
./scripts/install_codex_plugins.sh
```

Use hosted mode for quick trials of:

- `get_arxiv_daily_papers`
- `get_arxiv_author_papers`
- `get_huggingface_daily_papers`

Use local mode if you need reliable cache refresh or custom feed configuration.

## Requirements

- Node.js 20+ and npm
- Python 3.11+
- Codex CLI / Codex desktop environment
- Zotero Desktop with local API access
- Zotero Connector
- Better BibTeX for Zotero
- [llm-for-zotero](https://github.com/yilewang/llm-for-zotero)
- [OpenAI Zotero Codex plugin](https://github.com/openai/plugins/tree/main/plugins/zotero), included through the `plugins/openai-plugins` submodule
- [Codex Obsidian plugin](https://github.com/YanxingLiu/codex-obsidian), included through the `plugins/codex-obsidian` submodule
- Obsidian, optionally with the official Obsidian CLI

## Generated Brief

The final Markdown brief has two main sections:

1. Interested Papers
2. Hugging Face Daily Papers

Interested papers include:

- Chinese and English titles
- Chinese and English abstracts when available
- arXiv/PDF links
- Zotero deep links
- on-demand `LM for Zotero` prompt links such as `Summarize`, `Methodology`, `Experiments`, and `Limitations`

The Markdown is generated by `automation/outputs/04_daily_paper_brief.py`; the agent should not hand-write the final brief.

## Safety Boundaries

This repository intentionally does not include:

- real `.env` files
- API keys or admin tokens
- Paper Easy SQLite databases
- Zotero SQLite databases
- local PDFs or Zotero attachments
- generated `automation/work/` outputs
- generated note Markdown artifacts

The Zotero workflow does not directly modify Zotero's SQLite database. It writes through Zotero-supported surfaces such as Zotero Connector, the local API, Better BibTeX helpers, and LM for Zotero runtime scripts.

See [docs/SECURITY.md](docs/SECURITY.md) for the full security notes.

## Documentation

- [AI install guide](docs/AI_INSTALL.md): instructions for Codex or another local coding agent.
- [Manual install guide](docs/INSTALL.md): human-facing installation notes.
- [Daily automation prompt](docs/CODEX_DAILY_AUTOMATION_PROMPT.md): the prompt used to run the daily job.
- [Workflow details](docs/WORKFLOW.md): script-by-script pipeline notes.
- [Security notes](docs/SECURITY.md): token, artifact, and Zotero write boundaries.
