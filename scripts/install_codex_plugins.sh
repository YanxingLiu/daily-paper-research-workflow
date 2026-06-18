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

echo "Installed Codex plugins from the local daily-paper-workflow marketplace."

