# AI 安装指令

这份文档是给 Codex 或其他本地 AI coding agent 看的安装指南。用户可以把整个仓库交给 Codex，并明确要求：“请阅读 `docs/AI_INSTALL.md`，然后在我的本机安装 Daily Paper Research Workflow。”

## 安装目标

在本机完成以下能力：

- Paper Easy 可被 Codex 读取，用于获取 arXiv Daily Papers 和 Hugging Face Daily Papers
- Codex 安装 `paper-easy` 和 `codex-obsidian` 两个本仓库提供的插件
- Zotero 可接收选中的论文条目和 PDF
- Obsidian 可接收每日 Markdown 简报
- Markdown 中的 `daily-paper-note://` 链接可按需生成 LM for Zotero note

## 安全边界

- 不要打印、提交或写入真实 token。
- 不要直接修改 Zotero SQLite 数据库。
- 不要提交 `.env`、`automation/work/`、PDF、SQLite、日志、checkpoint 或生成的 Markdown artifact。
- 如果用户已经有未提交改动，先运行 `git status --short` 并说明改动范围，不要静默覆盖。

## 前置依赖

检查：

```bash
node --version
npm --version
python3 --version
codex --version
```

同时提醒用户安装并打开：

- Zotero Desktop
- Zotero Connector
- Better BibTeX for Zotero
- [llm-for-zotero](https://github.com/yilewang/llm-for-zotero)
- OpenAI 的 [Zotero Codex plugin](https://github.com/openai/plugins/tree/main/plugins/zotero)
- Obsidian

## 初始化 submodule

OpenAI Zotero Codex plugin 以 submodule 形式放在本仓库：

```text
plugins/openai-plugins/plugins/zotero
```

安装前确保 submodule 已初始化：

```bash
git submodule update --init --recursive
```

## 选择 Paper Easy 后端

### 方案 A：本地部署，推荐

本地部署可以完整使用只读、刷新缓存和本地自定义配置。

```bash
./scripts/bootstrap.sh
eval "$(./scripts/print_paper_easy_token.sh)"
./scripts/install_codex_plugins.sh
./scripts/install_note_url_handler.sh
```

启动 Paper Easy：

```bash
./scripts/run_paper_easy.sh
```

保持该命令运行。它会启动：

- Web: `http://127.0.0.1:5174`
- MCP: `http://127.0.0.1:5174/mcp`

### 方案 B：使用作者部署的 hosted Paper Easy，只读快捷模式

如果用户不想本地部署爬取 arXiv 论文的 Paper Easy，可以使用作者部署好的实例：

```text
https://paper-easy.liuyanxing.site:8443/
```

注意：因为作者临近毕业搬家，主机可能会搬走，所以这个服务不保证长期可用。hosted 模式无需 admin token 即可使用所有只读功能。

切换 Codex 插件到 hosted 只读 MCP：

```bash
cp plugins/paper-easy-codex-plugin/.mcp.hosted.example.json \
  plugins/paper-easy-codex-plugin/.mcp.json
./scripts/install_codex_plugins.sh
./scripts/install_note_url_handler.sh
```

`install_codex_plugins.sh` 会安装本仓库的 `paper-easy`、`codex-obsidian`，并在 submodule 可用时安装 OpenAI 的 `zotero@openai-curated`。

hosted 只读模式下，不要依赖 `sync_papers` 刷新缓存；只使用：

- `get_arxiv_daily_papers`
- `get_arxiv_author_papers`
- `get_huggingface_daily_papers`

如果需要稳定刷新或自定义抓取配置，改用本地部署方案。

## 配置 Obsidian 输出

如果用户提供 vault 路径，设置：

```bash
export OBSIDIAN_VAULT="/path/to/ObsidianVault"
export OBSIDIAN_DAILY_PAPERS_DIR="DailyPapers"
```

如果用户没有提供，询问用户要写入哪个 Obsidian vault。

## 检查 Zotero

Zotero 本地 API 默认是：

```bash
export ZOTERO_LOCAL_BASE_URL=http://127.0.0.1:23119
```

检查 Zotero 是否运行：

```bash
curl -fsS http://127.0.0.1:23119/api/users/0/items?limit=1 >/dev/null
```

如果失败，提醒用户打开 Zotero，并确认 OpenAI Zotero plugin / Zotero 本地 API 已可用。

## 验证脚本

```bash
python3 -m py_compile automation/outputs/*.py
bash -n scripts/*.sh
```

如果本地部署 Paper Easy，再运行：

```bash
cd paper-easy
npm run typecheck
npm test
```

## 安装完成后的说明

告诉用户：

- 本地 Paper Easy 方案需要保持 `./scripts/run_paper_easy.sh` 运行。
- hosted Paper Easy 方案不需要本地 Paper Easy 服务，但可用性取决于作者主机。
- 每日自动化 prompt 在 `docs/CODEX_DAILY_AUTOMATION_PROMPT.md`。
- 具体脚本流程在 `docs/WORKFLOW.md`。
- 人类安装说明在 `docs/INSTALL.md`。
