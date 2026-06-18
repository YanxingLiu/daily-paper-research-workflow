# 工作流说明

## 输入 JSON

每日 raw JSON 由 Codex 从 Paper Easy 取数后生成。结构固定为：

```json
{
  "date": "YYYY-MM-DD",
  "topics": ["世界模型", "具身智能", "空间记忆", "多模态大语言模型"],
  "sources": [
    {"source": "arxiv", "date": "YYYY-MM-DD", "papers": []},
    {"source": "huggingface", "date": "YYYY-MM-DD", "papers": []}
  ],
  "selected": {
    "世界模型": [],
    "具身智能": [],
    "空间记忆": [],
    "多模态大语言模型": []
  }
}
```

`sources[*].papers` 必须保持 Paper Easy 返回的原始 paper object，不要重写 `title`、`summary`、`translations` 字段。

## 01 准备输入

```bash
cd automation
python3 outputs/01_prepare_daily_paper_input.py \
  --input work/daily_paper_brief_raw_YYYY-MM-DD.json \
  --date YYYY-MM-DD \
  --output work/daily_paper_brief_input_YYYY-MM-DD.json \
  > work/daily_paper_brief_input_YYYY-MM-DD.summary.json
```

## 02 同步 Zotero/PDF

```bash
python3 outputs/02_sync_selected_papers_to_zotero.py \
  --input work/daily_paper_brief_input_YYYY-MM-DD.json \
  --yes \
  --workers 4 \
  --checkpoint work/zotero_sync_checkpoint_YYYY-MM-DD.jsonl \
  --progress \
  --runtime-pdf-plan-out work/zotero_attach_missing_pdfs_YYYY-MM-DD.json \
  --runtime-pdf-script-out work/zotero_attach_missing_pdfs_YYYY-MM-DD.js \
  > work/zotero_sync_YYYY-MM-DD.json \
  2> work/zotero_sync_YYYY-MM-DD.progress.log
```

如果报告中存在 runtime PDF plan，需要把生成的 JS 原样交给 LM for Zotero 的 `zotero_script`，并使用 `mode="write"` 执行。

## 03 安装/处理 URL 回调

安装一次即可：

```bash
python3 outputs/03_note_url_handler.py --install
```

后续点击 `daily-paper-note://generate?...` 时，macOS 会启动这个 handler，再由 handler 调用 `05_generate_zotero_note_on_demand.py`。

## 04 生成 Obsidian 简报

```bash
python3 outputs/04_daily_paper_brief.py \
  --input work/daily_paper_brief_input_YYYY-MM-DD.json \
  --zotero-sync-report work/zotero_sync_YYYY-MM-DD.json
```

输出路径默认由 `OBSIDIAN_VAULT` 和 `OBSIDIAN_DAILY_PAPERS_DIR` 决定。也可以显式传：

```bash
--output /path/to/vault/DailyPapers/daily_paper_brief_YYYY-MM-DD.md
```

## 05 按需生成 Zotero note

通常不需要手动运行。调试时可直接执行：

```bash
python3 outputs/05_generate_zotero_note_on_demand.py \
  --date YYYY-MM-DD \
  --item-key ZOTERO_ITEM_KEY \
  --prompt-name Summarize
```

prompt 文件位于 `automation/llm-for-zotero/prompts/*.txt`。文件名 stem 是 note 名称，文件内容是唯一的任务说明。

