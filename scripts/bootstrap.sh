#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

need_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1" >&2
    exit 1
  fi
}

need_cmd node
need_cmd npm
need_cmd python3

if ! command -v codex >/dev/null 2>&1; then
  echo "Warning: codex CLI was not found on PATH. Install Codex before running the full workflow." >&2
fi

cd "$ROOT_DIR/paper-easy"
if [ ! -f .env ]; then
  cp .env.example .env
  python3 - <<'PY'
from pathlib import Path
import secrets

path = Path(".env")
text = path.read_text(encoding="utf-8")
token = "pe_" + secrets.token_urlsafe(32)
text = text.replace("PAPERS_EASY_ADMIN_TOKEN=\n", f"PAPERS_EASY_ADMIN_TOKEN={token}\n")
path.write_text(text, encoding="utf-8")
print("Created paper-easy/.env with a generated PAPERS_EASY_ADMIN_TOKEN.")
PY
else
  echo "paper-easy/.env already exists; leaving it unchanged."
fi

npm install
npm run typecheck

echo
echo "Bootstrap complete."
echo "Next:"
echo "  eval \"$(./scripts/print_paper_easy_token.sh)\""
echo "  ./scripts/install_codex_plugins.sh"
echo "  ./scripts/run_paper_easy.sh"
