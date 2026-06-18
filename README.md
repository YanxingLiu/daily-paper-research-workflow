# Daily Paper Research Workflow

一个可本地复现的每日论文工作流：从 Paper Easy 读取 arXiv Daily 和 Hugging Face Daily Papers，用 Codex 做主题筛选，把感兴趣论文同步到 Zotero/PDF，再生成 Obsidian Markdown 简报。简报中的每篇感兴趣论文会带 Zotero 深链和按需触发 LM for Zotero note 的链接。

这个仓库包含：

- `paper-easy/`：Paper Easy 服务源码，提供网页、缓存、arXiv/Hugging Face 抓取和 MCP endpoint。
- `plugins/paper-easy-codex-plugin/`：Codex 访问 Paper Easy MCP 的插件。
- `plugins/codex-obsidian/`：Obsidian Codex 插件副本，上游为 <https://github.com/greg-asher/codex-obsidian>。
- `automation/`：每日论文流水线脚本、LM for Zotero prompts 和示例输入。
- `scripts/`：本地安装、启动和 URL handler 安装脚本。

如果你希望让 Codex 直接帮你安装这个工作流，可以把仓库交给 Codex，然后让它阅读 [docs/AI_INSTALL.md](docs/AI_INSTALL.md)。这份 Markdown 是专门给 AI agent 看的安装指令；Codex 读完后可以按里面的步骤完成本机安装和验证。

## 快速开始

macOS 上推荐按下面顺序执行：

```bash
git clone https://github.com/YanxingLiu/daily-paper-research-workflow.git
cd daily-paper-research-workflow

./scripts/bootstrap.sh
eval "$(./scripts/print_paper_easy_token.sh)"
./scripts/install_codex_plugins.sh
./scripts/install_note_url_handler.sh
./scripts/run_paper_easy.sh
```

`run_paper_easy.sh` 会占用前台终端并启动 `http://127.0.0.1:5174`。`eval "$(./scripts/print_paper_easy_token.sh)"` 只把 Paper Easy MCP token 导出到当前 shell，不会打印 token 明文。另开一个 Codex 会话后，就可以让 Codex 使用 Paper Easy 插件读取每日论文，并按 `docs/CODEX_DAILY_AUTOMATION_PROMPT.md` 里的流程生成简报。

## Paper Easy 后端选择

推荐本地部署 Paper Easy，这样可以稳定抓取、刷新缓存，并按自己的方向配置 arXiv/Hugging Face 数据源。

如果你不想本地部署爬取 arXiv 论文的 Paper Easy，也可以使用我部署好的只读实例：

```text
https://paper-easy.liuyanxing.site:8443/
```

因为我临近毕业搬家，主机可能会搬走，所以这个 hosted 服务不保证长期可用。它无需 admin token 即可使用所有只读功能。切换方法：

```bash
cp plugins/paper-easy-codex-plugin/.mcp.hosted.example.json \
  plugins/paper-easy-codex-plugin/.mcp.json
./scripts/install_codex_plugins.sh
```

hosted 只读模式适合快速试用 `get_arxiv_daily_papers`、`get_arxiv_author_papers`、`get_huggingface_daily_papers`。如果需要刷新缓存或长期稳定使用，建议本地部署。

## 外部依赖

- Node.js 20+ 和 npm
- Python 3.11+
- Codex CLI / Codex 桌面环境
- Zotero Desktop，并启用本地 API
- Zotero Connector，用于导入论文和 PDF
- Better BibTeX for Zotero，用于 collection scanAUX
- [llm-for-zotero](https://github.com/yilewang/llm-for-zotero)，用于把 Codex 生成的 note 写入 Zotero，也负责按需生成论文阅读 note。
- OpenAI 的 [Zotero Codex plugin](https://github.com/openai/plugins/tree/main/plugins/zotero)，用于让 Codex 操作本地 Zotero library。
- Obsidian，可选安装官方 Obsidian CLI

## 工作流概览

1. Paper Easy 缓存并暴露 arXiv Daily 和 Hugging Face Daily Papers。
2. Codex 使用 Paper Easy MCP 读取论文列表，只负责筛选主题并填写 `selected`。
3. `01_prepare_daily_paper_input.py` 固化输入 JSON。
4. `02_sync_selected_papers_to_zotero.py` 把命中论文同步到 Zotero collection，并处理 PDF。
5. `03_note_url_handler.py` 安装 `daily-paper-note://` macOS URL handler。
6. `04_daily_paper_brief.py` 生成 Obsidian Markdown 简报。
7. 点击简报里的 LM for Zotero 链接时，`05_generate_zotero_note_on_demand.py` 对单篇论文、单个 prompt 生成 Zotero note。

默认关注主题是：

- 世界模型
- 具身智能
- 空间记忆
- 多模态大语言模型

修改主题时，改 Codex prompt 和输入 JSON 的 `topics` 即可。

## 安全文档

这个仓库故意不包含：

- `.env` 真实配置
- Paper Easy SQLite 数据库
- Zotero 数据库或任何 Zotero SQLite 写入逻辑
- 历史 `work/` 输出、checkpoint、日志和 note artifact
- 私有部署域名或 token

详细说明见 [docs/SECURITY.md](docs/SECURITY.md)。
