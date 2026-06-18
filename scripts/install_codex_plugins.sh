#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if ! command -v codex >/dev/null 2>&1; then
  echo "codex CLI is required to install Codex plugins." >&2
  exit 1
fi

codex plugin marketplace add "$ROOT_DIR" >/dev/null || true
codex plugin add paper-easy --marketplace daily-paper-workflow
codex plugin add codex-obsidian --marketplace daily-paper-workflow

if [ -f "$ROOT_DIR/.gitmodules" ]; then
  git -C "$ROOT_DIR" submodule update --init --recursive --depth 1 plugins/openai-plugins
fi

if [ -d "$ROOT_DIR/plugins/openai-plugins/.agents/plugins" ]; then
  codex plugin marketplace add "$ROOT_DIR/plugins/openai-plugins" >/dev/null || true
  if ! codex plugin list | grep -Eq 'zotero@openai-curated[[:space:]]+installed,'; then
    codex plugin add zotero --marketplace openai-curated
  fi
fi

echo "Installed Daily Paper Workflow Codex plugins and OpenAI Zotero plugin when available."
