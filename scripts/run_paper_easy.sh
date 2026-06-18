#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR/paper-easy"

if [ ! -f .env ]; then
  echo "Missing paper-easy/.env. Run ./scripts/bootstrap.sh first." >&2
  exit 1
fi

exec npm run server
