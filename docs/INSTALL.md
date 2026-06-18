# 安装指引

## 给 Codex 安装

如果希望让 Codex 自动安装本工作流，请让 Codex 先阅读 [AI_INSTALL.md](AI_INSTALL.md)。那份文档是面向 AI agent 的安装指令，包含本地 Paper Easy 与 hosted Paper Easy 两种路径。

如果是新 clone，建议带上 submodule：

```bash
git clone --recurse-submodules https://github.com/YanxingLiu/daily-paper-research-workflow.git
```

已有 clone 可运行：

```bash
git submodule update --init --recursive
```

## 1. 准备 Paper Easy

Paper Easy 有三种后端选择：

- 方案 A：从源码本地部署，适合开发和长期自定义。
- 方案 B：用 Docker 本地部署，适合只想稳定运行后端、不想安装 Node 依赖。
- 方案 C：使用 hosted 只读实例，适合快速试用。

### 方案 A：从源码本地部署

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

### 方案 B：用 Docker 本地部署

也可以直接使用 GitHub Container Registry 镜像，不需要在本机安装 Paper Easy 的 Node 依赖：

```bash
export PAPERS_EASY_ADMIN_TOKEN="$(openssl rand -hex 24)"
mkdir -p paper-easy-data

docker run -d --name paper-easy --restart unless-stopped \
  -p 5174:5174 \
  -e PAPERS_EASY_ADMIN_TOKEN \
  -e PAPERS_EASY_DB_PATH=/app/data/papers.easy.sqlite \
  -v "$PWD/paper-easy-data:/app/data" \
  ghcr.io/yanxingliu/paper-easy:latest
```

Docker 方式仍然使用本地 MCP：

- Web: `http://127.0.0.1:5174`
- MCP: `http://127.0.0.1:5174/mcp`

安装 Codex 插件或启动 Codex 前，需要在同一个 shell 中保留这个 token：

```bash
./scripts/install_codex_plugins.sh
```

如果需要查看启动或缓存刷新日志，可以运行：

```bash
docker logs -f paper-easy
```

如果终端关闭后还要继续使用，请把这个 token 保存到你自己的密码管理器或 shell 配置里，不要提交到仓库。

### 方案 C：使用 hosted 只读实例

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

根据第 1 步选择的 Paper Easy 后端，先准备插件连接方式：

- 源码本地部署：运行 `eval "$(./scripts/print_paper_easy_token.sh)"`。
- Docker 本地部署：继续使用启动容器时的同一个 `PAPERS_EASY_ADMIN_TOKEN`。
- hosted 只读实例：先复制 `plugins/paper-easy-codex-plugin/.mcp.hosted.example.json` 到 `plugins/paper-easy-codex-plugin/.mcp.json`，不需要 token。

```bash
./scripts/install_codex_plugins.sh
```

该脚本会把本仓库注册为本地 Codex marketplace，并安装：

- `paper-easy`
- `codex-obsidian`，来自 `plugins/codex-obsidian` submodule
- `zotero@openai-curated`，来自 `plugins/openai-plugins/plugins/zotero`

使用本地 Paper Easy 时，Paper Easy 插件从环境变量 `PAPERS_EASY_ADMIN_TOKEN` 读取认证 token。不要把 token 写入插件文件。

如果是源码部署，在启动 Codex 前可以运行：

```bash
eval "$(./scripts/print_paper_easy_token.sh)"
```

这个命令只导出 token 到当前 shell，不把 token 写入仓库。Docker 部署则需要手动导出容器启动时使用的同一个 token。

## 3. 准备 Zotero

需要安装并打开：

- Zotero Desktop
- Zotero Connector
- Better BibTeX for Zotero
- [llm-for-zotero](https://github.com/yilewang/llm-for-zotero)
- OpenAI 的 [Zotero Codex plugin](https://github.com/openai/plugins/tree/main/plugins/zotero)，本仓库 submodule 路径是 `plugins/openai-plugins/plugins/zotero`
- [Codex Obsidian plugin](https://github.com/YanxingLiu/codex-obsidian)，本仓库 submodule 路径是 `plugins/codex-obsidian`

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
