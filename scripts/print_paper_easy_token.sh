#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$ROOT_DIR/paper-easy/.env"

if [ ! -f "$ENV_FILE" ]; then
  echo "echo 'Missing paper-easy/.env. Run ./scripts/bootstrap.sh first.' >&2"
  exit 1
fi

python3 - "$ENV_FILE" <<'PY'
from pathlib import Path
import shlex
import sys

env_path = Path(sys.argv[1])
token = ""
for line in env_path.read_text(encoding="utf-8").splitlines():
    stripped = line.strip()
    if not stripped or stripped.startswith("#") or "=" not in stripped:
        continue
    key, value = stripped.split("=", 1)
    if key.strip() == "PAPERS_EASY_ADMIN_TOKEN":
        token = value.strip().strip('"').strip("'")
        break

if not token:
    raise SystemExit("PAPERS_EASY_ADMIN_TOKEN is missing in paper-easy/.env")

print(f"export PAPERS_EASY_ADMIN_TOKEN={shlex.quote(token)}")
PY
