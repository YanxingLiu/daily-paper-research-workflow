# 安装指引

## 给 Codex 安装

如果希望让 Codex 自动安装本工作流，请让 Codex 先阅读 [AI_INSTALL.md](AI_INSTALL.md)。那份文档是面向 AI agent 的安装指令，包含本地 Paper Easy 与 hosted Paper Easy 两种路径。

## 1. 准备 Paper Easy

```bash
./scripts/bootstrap.sh
```

脚本会：

- 检查 `node`、`npm`、`python3`
- 从 `paper-easy/.env.example` 创建 `paper-easy/.env`
- 自动生成一个 `PAPERS_EASY_ADMIN_TOKEN`
- 安装 npm 依赖并运行 TypeScript typecheck

启动服务：

```bash
eval "$(./scripts/print_paper_easy_token.sh)"
./scripts/run_paper_easy.sh
```

服务默认监听：

- Web: `http://127.0.0.1:5174`
- MCP: `http://127.0.0.1:5174/mcp`

如果不想本地部署 Paper Easy，可以使用 hosted 只读实例：

```text
https://paper-easy.liuyanxing.site:8443/
```

该服务无需 admin token 即可使用只读功能，但因为作者临近毕业搬家，主机可能会搬走，不保证长期可用。切换到 hosted 只读 MCP：

```bash
cp plugins/paper-easy-codex-plugin/.mcp.hosted.example.json \
  plugins/paper-easy-codex-plugin/.mcp.json
./scripts/install_codex_plugins.sh
```

## 2. 安装 Codex 插件

```bash
eval "$(./scripts/print_paper_easy_token.sh)"
./scripts/install_codex_plugins.sh
```

该脚本会把本仓库注册为本地 Codex marketplace，并安装：

- `paper-easy`
- `codex-obsidian`

Paper Easy 插件从环境变量 `PAPERS_EASY_ADMIN_TOKEN` 读取认证 token。不要把 token 写入插件文件。

在启动 Codex 前可以运行：

```bash
eval "$(./scripts/print_paper_easy_token.sh)"
```

这个命令只导出 token 到当前 shell，不把 token 写入仓库。

## 3. 准备 Zotero

需要安装并打开：

- Zotero Desktop
- Zotero Connector
- Better BibTeX for Zotero
- [llm-for-zotero](https://github.com/yilewang/llm-for-zotero)
- OpenAI 的 [Zotero Codex plugin](https://github.com/openai/plugins/tree/main/plugins/zotero)

Zotero 本地 API 默认使用：

```bash
export ZOTERO_LOCAL_BASE_URL=http://127.0.0.1:23119
```

工作流只通过 Zotero Connector、本地 API 和 LM for Zotero runtime 写入 Zotero，不直接修改 Zotero SQLite 数据库。

## 4. 安装按需 note URL handler

```bash
./scripts/install_note_url_handler.sh
```

安装后，Obsidian Markdown 中的链接类似：

```text
daily-paper-note://generate?date=2026-06-18&item=TNKKSN5C&prompt=Summarize
```

点击后会生成单篇论文、单个 prompt 的 Zotero note，不需要常驻后台服务。

## 5. 配置 Obsidian 输出

推荐使用环境变量：

```bash
export OBSIDIAN_VAULT="$HOME/Obsidian"
export OBSIDIAN_DAILY_PAPERS_DIR="DailyPapers"
```

也可以在运行 `04_daily_paper_brief.py` 时显式传 `--output`。
