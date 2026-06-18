#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DATE="${1:-}"
RAW_JSON="${2:-}"

if [ -z "$DATE" ] || [ -z "$RAW_JSON" ]; then
  echo "Usage: $0 YYYY-MM-DD path/to/daily_paper_brief_raw_YYYY-MM-DD.json" >&2
  exit 2
fi

cd "$ROOT_DIR/automation"
mkdir -p work

INPUT_JSON="work/daily_paper_brief_input_${DATE}.json"
SUMMARY_JSON="work/daily_paper_brief_input_${DATE}.summary.json"
SYNC_JSON="work/zotero_sync_${DATE}.json"
SYNC_LOG="work/zotero_sync_${DATE}.progress.log"
CHECKPOINT="work/zotero_sync_checkpoint_${DATE}.jsonl"
PDF_PLAN="work/zotero_attach_missing_pdfs_${DATE}.json"
PDF_SCRIPT="work/zotero_attach_missing_pdfs_${DATE}.js"

python3 outputs/01_prepare_daily_paper_input.py \
  --input "$RAW_JSON" \
  --date "$DATE" \
  --output "$INPUT_JSON" > "$SUMMARY_JSON"

SYNC_ARGS=()
if python3 outputs/02_sync_selected_papers_to_zotero.py \
  --input "$INPUT_JSON" \
  --yes \
  --workers "${ZOTERO_SYNC_WORKERS:-4}" \
  --checkpoint "$CHECKPOINT" \
  --progress \
  --runtime-pdf-plan-out "$PDF_PLAN" \
  --runtime-pdf-script-out "$PDF_SCRIPT" > "$SYNC_JSON" 2> "$SYNC_LOG"; then
  SYNC_ARGS=(--zotero-sync-report "$SYNC_JSON")
else
  echo "Warning: Zotero sync failed. See $SYNC_LOG. Continuing to generate the Markdown brief without Zotero links." >&2
fi

python3 outputs/04_daily_paper_brief.py \
  --input "$INPUT_JSON" \
  "${SYNC_ARGS[@]}"

echo "Prepared: $INPUT_JSON"
echo "Zotero sync report: $SYNC_JSON"
echo "If $PDF_PLAN contains missing PDFs, execute $PDF_SCRIPT through LM for Zotero zotero_script mode=write, then rerun PDF verification."
