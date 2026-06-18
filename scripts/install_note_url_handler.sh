#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR/automation"

python3 outputs/03_note_url_handler.py --install

echo "Installed daily-paper-note:// URL handler."

