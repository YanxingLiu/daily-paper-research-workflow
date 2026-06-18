# Codex 每日自动化 Prompt

每天生成一份今日论文 Markdown 简报。最终 Markdown 必须由本地脚本生成，不要手写或自由组织最终 Markdown。不要暴露任何 token 或凭据，不要直接修改 Zotero SQLite 数据库。

## 日期

以 Asia/Shanghai 日期为准：

- `today`：自动化运行当天，格式 `YYYY-MM-DD`
- `hf_date`：`today` 的前一天，格式 `YYYY-MM-DD`

work 文件名、Zotero 日期 collection、Obsidian 输出文件名都使用 `today`。Hugging Face Daily Papers 的数据内容使用 `hf_date`，因为早上 Hugging Face Daily Papers 通常尚未更新当天内容。

## 读取 Paper Easy

调用 Paper Easy：

- arXiv Daily papers 使用 `today`：`get_arxiv_daily_papers(date=today, maxResults=200)`
- Hugging Face Daily Papers 使用 `hf_date`：`get_huggingface_daily_papers(date=hf_date, maxResults=200)`

如果对应日期缓存为空或明显不是对应日期内容，可以对对应来源调用 `sync_papers` 刷新一次，然后重新读取同一个日期。不要把 Hugging Face 的 date 改回 `today`。

## AI 筛选 selected

将两个来源的原始 paper object 写入 raw JSON：

- `sources` 顺序固定为 arxiv 在前、huggingface 在后
- arxiv source block 写入 `date=today`
- huggingface source block 写入 `date=hf_date`
- 不要重写 `title`、`summary`、`translations`
- 保持 Paper Easy 返回的原始字段，尤其是 `translations.zh.title` 和 `translations.zh.summary`

raw JSON 格式：

```json
{
  "date": "YYYY-MM-DD(today)",
  "topics": ["世界模型", "具身智能", "空间记忆", "多模态大语言模型"],
  "sources": [
    {"source": "arxiv", "date": "YYYY-MM-DD(today)", "papers": []},
    {"source": "huggingface", "date": "YYYY-MM-DD(hf_date)", "papers": []}
  ],
  "selected": {
    "世界模型": [],
    "具身智能": [],
    "空间记忆": [],
    "多模态大语言模型": []
  }
}
```

只由 AI 负责筛选“感兴趣论文”并写入 `selected`。筛选主题固定为：

- 世界模型：world model、model-based dynamics、simulation、video prediction
- 具身智能：embodied AI、robotics、navigation、manipulation、VLA
- 空间记忆：spatial memory、map、3D scene memory、place recognition
- 多模态大语言模型：multimodal large language model、MLLM、VLM、vision-language、audio-language、video-language

规则：

- 只保留与上述主题明确相关的论文
- 不要为了凑数而泛化匹配；不确定时可以不选
- `index` 为 1-based，顺序是 arxiv papers 全部在前，然后 hf_date 的 huggingface papers

## 脚本流程

在 `automation/` 目录下执行：

```bash
python3 outputs/01_prepare_daily_paper_input.py \
  --input work/daily_paper_brief_raw_YYYY-MM-DD.json \
  --date YYYY-MM-DD \
  --output work/daily_paper_brief_input_YYYY-MM-DD.json \
  > work/daily_paper_brief_input_YYYY-MM-DD.summary.json

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

python3 outputs/04_daily_paper_brief.py \
  --input work/daily_paper_brief_input_YYYY-MM-DD.json \
  --zotero-sync-report work/zotero_sync_YYYY-MM-DD.json
```

如果 `zotero_sync_YYYY-MM-DD.json` 中的 `runtime_pdf_attachment_plan.count > 0`：

1. 读取 `result.runtime_pdf_attachment_plan.script_path` 指向的 JS 文件内容
2. 把文件内容原样作为 LM for Zotero `zotero_script` 的 `script` 参数执行
3. `zotero_script` 必须使用 `mode="write"`
4. 不要手写或改写这段 JS

最后读取 Obsidian 输出文件并把完整 Markdown 内容发给用户，不要额外改写格式。

