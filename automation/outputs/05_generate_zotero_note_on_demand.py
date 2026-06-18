#!/usr/bin/env python3
"""Generate daily paper notes and write them back to Zotero.

This script owns the deterministic note-generation workflow:

1. Read the Zotero sync report from ``02_sync_selected_papers_to_zotero.py``.
2. Read prompt ``.txt`` files under ``llm-for-zotero``.
3. Build exact JSONL note tasks with marker/prompt-hash deduplication.
4. For each task, fetch Zotero metadata and indexed PDF full text through the
   read-only local API.
5. Invoke ``codex exec --ephemeral`` with a clean prompt to generate the note
   Markdown in a temporary artifact directory.
6. Invoke ``codex exec --ephemeral`` again with a generated Zotero runtime JS
   writer. The nested Codex turn must run the LM-for-Zotero ``zotero_script``
   tool in write mode. The Python script never writes Zotero SQLite directly.
7. Append checkpoint events so interrupted runs can resume.

Generated note Markdown, writer JS, and writer JSON are temporary by default.
Pass ``--keep-artifacts`` when debugging if these files should be retained.
"""

from __future__ import annotations

import argparse
import concurrent.futures
import datetime as dt
import hashlib
import html
import json
import os
import re
import subprocess
import sys
import tempfile
import threading
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any


DEFAULT_BASE_URL = os.environ.get("ZOTERO_LOCAL_BASE_URL", "http://127.0.0.1:23119")
DEFAULT_CODEX_BIN = os.environ.get("CODEX_BIN", "codex")
LOCAL_USER = "/api/users/0"
API_HEADERS = {"Zotero-API-Version": "3"}
TEXT_LIMIT = 500
DEFAULT_FULLTEXT_CHARS = 60000
CHECKPOINT_LOCK = threading.Lock()


class NoteGenerationError(RuntimeError):
    pass


class HttpClient:
    def __init__(self, base_url: str = DEFAULT_BASE_URL, timeout: float = 30.0) -> None:
        self.base_url = base_url.rstrip("/")
        self.timeout = timeout

    def request(self, path: str, *, headers: dict[str, str] | None = None) -> tuple[int, dict[str, str], str]:
        try:
            req = urllib.request.Request(self.base_url + path, headers=headers or {})
            with urllib.request.urlopen(req, timeout=self.timeout) as response:
                return response.status, dict(response.headers.items()), response.read().decode("utf-8", "replace")
        except urllib.error.HTTPError as exc:
            body = exc.read().decode("utf-8", "replace")
            raise NoteGenerationError(f"GET {path} failed: status={exc.code} body={body[:TEXT_LIMIT]}") from exc
        except Exception as exc:
            raise NoteGenerationError(f"GET {path} failed: {exc}") from exc

    def api_text_with_headers(self, path: str) -> tuple[str, dict[str, str]]:
        api_path = path if path.startswith("/api") else f"/api{path}"
        status, headers, text = self.request(api_path, headers=API_HEADERS)
        if not (200 <= status < 300):
            raise NoteGenerationError(f"GET {api_path} failed: status={status}")
        return text, headers

    def api_json(self, path: str) -> Any:
        text, _ = self.api_text_with_headers(path)
        return json.loads(text or "null")


def utc_now_iso() -> str:
    return dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def sha256_text(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def slugify(value: str) -> str:
    slug = re.sub(r"[^A-Za-z0-9._-]+", "-", value.strip()).strip("-")
    return slug or "note"


def first_text(*values: Any) -> str:
    for value in values:
        if isinstance(value, str) and value.strip():
            return re.sub(r"\s+", " ", value.strip())
    return ""


def load_json(path: str) -> Any:
    if path == "-":
        return json.load(sys.stdin)
    with Path(path).open("r", encoding="utf-8") as handle:
        return json.load(handle)


def load_jsonl(path: Path) -> list[dict[str, Any]]:
    tasks: list[dict[str, Any]] = []
    if not path.exists():
        return tasks
    with path.open("r", encoding="utf-8") as handle:
        for line in handle:
            line = line.strip()
            if not line:
                continue
            value = json.loads(line)
            if isinstance(value, dict):
                tasks.append(value)
    return tasks


def append_jsonl(path: Path, event: dict[str, Any]) -> None:
    with CHECKPOINT_LOCK:
        path.parent.mkdir(parents=True, exist_ok=True)
        with path.open("a", encoding="utf-8") as handle:
            handle.write(json.dumps(event, ensure_ascii=False, sort_keys=True) + "\n")
            handle.flush()


def read_completed_task_ids(path: Path | None) -> set[str]:
    completed: set[str] = set()
    if path is None or not path.exists():
        return completed
    with path.open("r", encoding="utf-8") as handle:
        for line in handle:
            line = line.strip()
            if not line:
                continue
            try:
                event = json.loads(line)
            except json.JSONDecodeError:
                continue
            if event.get("event") == "note_completed" and first_text(event.get("task_id")):
                completed.add(first_text(event.get("task_id")))
    return completed


def discover_prompt_files(prompts_dir: Path) -> list[dict[str, str]]:
    if not prompts_dir.exists():
        raise NoteGenerationError(f"Prompt directory does not exist: {prompts_dir}")
    prompts: list[dict[str, str]] = []
    for path in sorted(prompts_dir.rglob("*.txt")):
        if not path.is_file():
            continue
        prompt = path.read_text(encoding="utf-8").strip()
        if not prompt:
            continue
        prompts.append(
            {
                "note_name": path.stem.strip(),
                "prompt_path": str(path.resolve()),
                "prompt": prompt,
                "prompt_sha256": sha256_text(prompt),
            }
        )
    if not prompts:
        raise NoteGenerationError(f"No non-empty .txt prompt files found under {prompts_dir}")
    return prompts


def sync_actions(sync_report: dict[str, Any]) -> list[dict[str, Any]]:
    result = sync_report.get("result") if isinstance(sync_report.get("result"), dict) else sync_report
    actions = result.get("actions") if isinstance(result, dict) else None
    if not isinstance(actions, list):
        raise NoteGenerationError("Sync report must contain result.actions.")
    deduped: list[dict[str, Any]] = []
    seen: set[str] = set()
    for action in actions:
        if not isinstance(action, dict):
            continue
        item_key = first_text(action.get("zotero_item_key"))
        if not item_key or item_key in seen:
            continue
        seen.add(item_key)
        deduped.append(action)
    return deduped


def item_children(client: HttpClient, item_key: str) -> list[dict[str, Any]]:
    children: list[dict[str, Any]] = []
    start = 0
    limit = 100
    quoted_key = urllib.parse.quote(item_key)
    while True:
        params = urllib.parse.urlencode({"include": "data", "limit": limit, "start": start})
        text, headers = client.api_text_with_headers(f"{LOCAL_USER}/items/{quoted_key}/children?{params}")
        batch = json.loads(text or "[]")
        if not isinstance(batch, list):
            raise NoteGenerationError(f"Unexpected Zotero children response for item {item_key}")
        children.extend(child for child in batch if isinstance(child, dict))

        total_raw = headers.get("Total-Results")
        total = int(total_raw) if total_raw and total_raw.isdigit() else None
        start += limit
        if total is not None and start >= total:
            break
        if total is None and len(batch) < limit:
            break
    return children


TAG_RE = re.compile(r"<[^>]+>")


def note_plain_text(note_html: str) -> str:
    text = re.sub(r"</(?:p|div|h[1-6]|li|br)>", "\n", note_html)
    text = TAG_RE.sub("", text)
    return html.unescape(text)


def existing_note_matches(children: list[dict[str, Any]], note_name: str, prompt_sha: str, marker: str) -> bool:
    for child in children:
        data = child.get("data") if isinstance(child.get("data"), dict) else {}
        if data.get("itemType") != "note":
            continue
        raw_note = first_text(data.get("note"))
        text = note_plain_text(raw_note)
        if marker in raw_note and prompt_sha in raw_note:
            return True
        if marker in text and prompt_sha in text:
            return True
        first_line = first_text(*(line for line in text.splitlines()[:3]))
        if first_line == note_name and f"prompt_sha256: {prompt_sha}" in text:
            return True
    return False


def make_task(date: str, action: dict[str, Any], prompt_info: dict[str, str]) -> dict[str, Any]:
    item_key = first_text(action.get("zotero_item_key"))
    note_name = prompt_info["note_name"]
    prompt_sha = prompt_info["prompt_sha256"]
    task_id_raw = f"{date}:{item_key}:{note_name}:{prompt_sha[:12]}"
    marker = f"daily-paper-note:{note_name}:{prompt_sha[:12]}"
    return {
        "task_id": slugify(task_id_raw),
        "date": date,
        "libraryID": 1,
        "zotero_item_key": item_key,
        "arxiv_id": first_text(action.get("arxiv_id")),
        "title": first_text(action.get("title")),
        "bibtex_key": first_text(action.get("bibtex_key")),
        "note_name": note_name,
        "note_marker": marker,
        "prompt_path": prompt_info["prompt_path"],
        "prompt": prompt_info["prompt"],
        "prompt_sha256": prompt_sha,
        "content_header": (
            f"# {note_name}\n\n"
            f"<!-- {marker} -->\n"
            f"<!-- date: {date} -->\n"
            f"<!-- zotero_item_key: {item_key} -->\n"
            f"<!-- prompt_sha256: {prompt_sha} -->\n\n"
        ),
    }


def prepare_tasks(args: argparse.Namespace, client: HttpClient) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    if args.tasks:
        tasks = load_jsonl(Path(args.tasks))
        return tasks, {"tasks_from": str(Path(args.tasks).resolve()), "tasks": len(tasks)}

    if not args.date:
        raise NoteGenerationError("--date is required when --tasks is not provided")
    if not args.sync_report:
        raise NoteGenerationError("--sync-report is required when --tasks is not provided")

    sync_report = load_json(args.sync_report)
    actions = sync_actions(sync_report)
    prompts = discover_prompt_files(Path(args.prompts_dir))
    item_key_filter = {first_text(value) for value in (args.item_key or []) if first_text(value)}
    prompt_name_filter = {first_text(value) for value in (args.prompt_name or []) if first_text(value)}
    if item_key_filter:
        actions = [
            action
            for action in actions
            if first_text(action.get("zotero_item_key")) in item_key_filter
        ]
    if prompt_name_filter:
        prompts = [
            prompt
            for prompt in prompts
            if first_text(prompt.get("note_name")) in prompt_name_filter
        ]
    checkpoint_path = Path(args.checkpoint).resolve() if args.checkpoint else None
    completed = read_completed_task_ids(checkpoint_path) if args.resume else set()

    tasks: list[dict[str, Any]] = []
    skipped_existing = 0
    skipped_checkpoint = 0
    for action in actions:
        children = item_children(client, first_text(action.get("zotero_item_key")))
        for prompt_info in prompts:
            task = make_task(args.date, action, prompt_info)
            if task["task_id"] in completed:
                skipped_checkpoint += 1
                continue
            if not args.overwrite_existing and existing_note_matches(
                children,
                task["note_name"],
                task["prompt_sha256"],
                task["note_marker"],
            ):
                skipped_existing += 1
                continue
            tasks.append(task)
            if args.limit is not None and len(tasks) >= args.limit:
                break
        if args.limit is not None and len(tasks) >= args.limit:
            break

    if args.tasks_out:
        tasks_out = Path(args.tasks_out).resolve()
        tasks_out.parent.mkdir(parents=True, exist_ok=True)
        with tasks_out.open("w", encoding="utf-8") as handle:
            for task in tasks:
                handle.write(json.dumps(task, ensure_ascii=False, sort_keys=True) + "\n")
    else:
        tasks_out = None

    return tasks, {
        "date": args.date,
        "sync_report": str(Path(args.sync_report).resolve()),
        "prompts_dir": str(Path(args.prompts_dir).resolve()),
        "item_key_filter": sorted(item_key_filter),
        "prompt_name_filter": sorted(prompt_name_filter),
        "tasks_out": str(tasks_out) if tasks_out else None,
        "checkpoint": str(checkpoint_path) if checkpoint_path else None,
        "items": len(actions),
        "prompts": len(prompts),
        "tasks": len(tasks),
        "skipped_existing": skipped_existing,
        "skipped_checkpoint": skipped_checkpoint,
    }


def choose_pdf_attachment(children: list[dict[str, Any]]) -> dict[str, Any] | None:
    attachments = []
    for child in children:
        data = child.get("data") if isinstance(child.get("data"), dict) else {}
        if data.get("itemType") == "attachment":
            attachments.append(child)
    for child in attachments:
        data = child.get("data") if isinstance(child.get("data"), dict) else {}
        haystack = " ".join(
            first_text(data.get(key)).lower()
            for key in ("contentType", "title", "url", "filename")
        )
        if "pdf" in haystack:
            return child
    return attachments[0] if attachments else None


def clip_middle(text: str, limit: int) -> str:
    if limit <= 0 or len(text) <= limit:
        return text
    head = max(1, int(limit * 0.7))
    tail = max(1, limit - head)
    return (
        text[:head].rstrip()
        + "\n\n[... full text truncated by 05_generate_zotero_note_on_demand.py ...]\n\n"
        + text[-tail:].lstrip()
    )


def fetch_evidence(client: HttpClient, task: dict[str, Any], fulltext_chars: int) -> dict[str, Any]:
    item_key = task["zotero_item_key"]
    item = client.api_json(f"{LOCAL_USER}/items/{urllib.parse.quote(item_key)}?include=data")
    item_data = item.get("data") if isinstance(item, dict) and isinstance(item.get("data"), dict) else {}
    children = item_children(client, item_key)
    pdf = choose_pdf_attachment(children)
    fulltext: dict[str, Any] = {}
    if pdf:
        pdf_data = pdf.get("data") if isinstance(pdf.get("data"), dict) else {}
        pdf_key = first_text(pdf.get("key"), pdf_data.get("key"))
        if pdf_key:
            try:
                fulltext = client.api_json(f"{LOCAL_USER}/items/{urllib.parse.quote(pdf_key)}/fulltext")
            except Exception as exc:
                fulltext = {"error": str(exc)}

    content = first_text(fulltext.get("content")) if isinstance(fulltext, dict) else ""
    return {
        "item": {
            "key": item_key,
            "title": first_text(item_data.get("title"), task.get("title")),
            "abstractNote": first_text(item_data.get("abstractNote")),
            "date": first_text(item_data.get("date")),
            "url": first_text(item_data.get("url")),
            "extra": first_text(item_data.get("extra")),
            "itemType": first_text(item_data.get("itemType")),
        },
        "pdf": {
            "key": first_text(pdf.get("key")) if pdf else "",
            "title": first_text((pdf.get("data") or {}).get("title")) if pdf else "",
            "indexedPages": fulltext.get("indexedPages") if isinstance(fulltext, dict) else None,
            "totalPages": fulltext.get("totalPages") if isinstance(fulltext, dict) else None,
            "error": fulltext.get("error") if isinstance(fulltext, dict) else None,
        },
        "fulltext_excerpt": clip_middle(content, fulltext_chars),
        "fulltext_chars_available": len(content),
        "fulltext_chars_used": min(len(content), fulltext_chars) if fulltext_chars > 0 else len(content),
    }


def codex_base_cmd(args: argparse.Namespace, output_path: Path) -> list[str]:
    cmd = [
        args.codex_bin,
        "--ask-for-approval",
        "never",
        "exec",
        "--ephemeral",
        "--skip-git-repo-check",
        "-C",
        str(Path.cwd()),
        "--output-last-message",
        str(output_path),
    ]
    if args.codex_model:
        cmd.extend(["-m", args.codex_model])
    return cmd


def run_codex(args: argparse.Namespace, prompt: str, output_path: Path, *, read_only: bool) -> str:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    cmd = codex_base_cmd(args, output_path)
    if read_only:
        cmd.extend(["--sandbox", "read-only"])
    cmd.append("-")
    completed = subprocess.run(
        cmd,
        input=prompt,
        text=True,
        capture_output=True,
        timeout=args.codex_timeout,
        check=False,
    )
    if completed.returncode != 0:
        stderr = completed.stderr[-4000:] if completed.stderr else ""
        stdout = completed.stdout[-4000:] if completed.stdout else ""
        raise NoteGenerationError(
            f"codex exec failed with code {completed.returncode}\nSTDOUT:\n{stdout}\nSTDERR:\n{stderr}"
        )
    if not output_path.exists():
        raise NoteGenerationError(f"codex exec did not write output file: {output_path}")
    return output_path.read_text(encoding="utf-8")


def generation_prompt(task: dict[str, Any], evidence: dict[str, Any]) -> str:
    task_without_prompt = dict(task)
    prompt_text = task_without_prompt.pop("prompt", "")
    return f"""你是一个单篇论文 Zotero 阅读笔记生成器。你运行在干净上下文里。

硬性规则：
- 不要调用任何工具。
- 不要写文件，不要写 Zotero。
- 只输出最终 Markdown note 正文，不要输出解释、前后缀、代码块围栏。
- Markdown note 必须以 content_header 原样开头。
- 正文的具体问题、结构、粒度、语言和篇幅完全由 task.prompt 决定。
- 不要把某一种 note 类型的结构套用到所有 prompt 上；除非 task.prompt 明确要求，否则不要额外强制固定章节或固定问题。
- 如果 task.prompt 没有指定格式，使用清晰的 Markdown 小节组织，并尽量给出有证据支撑的充分细节。
- 如果证据里没有某个数值或细节，明确写“原文证据未显示”，不要编造。
- 可以引用 task JSON 和 PDF 全文摘录中的信息，但不要输出与 task.prompt 无关的泛泛总结。

task.prompt：
{prompt_text}

content_header，必须逐字放在输出开头：
{task['content_header']}

task JSON：
```json
{json.dumps(task_without_prompt, ensure_ascii=False, indent=2)}
```

Zotero 元数据与全文证据：
```json
{json.dumps({k: v for k, v in evidence.items() if k != 'fulltext_excerpt'}, ensure_ascii=False, indent=2)}
```

PDF 全文摘录：
```text
{evidence.get('fulltext_excerpt') or '未获取到 PDF 全文。'}
```
"""


FENCE_RE = re.compile(r"^```(?:markdown|md)?\s*(.*?)\s*```$", re.DOTALL)
INLINE_CODE_PLACEHOLDER = "\u0000CODE{}\u0000"
HTML_PLACEHOLDER = "\u0000HTML{}\u0000"


def clean_generated_note(raw: str, task: dict[str, Any]) -> str:
    text = raw.strip()
    fence = FENCE_RE.match(text)
    if fence:
        text = fence.group(1).strip()
    header = task["content_header"]
    if header in text:
        text = text[text.index(header) :]
    elif text.startswith(f"# {task['note_name']}"):
        text = header + text.split("\n", 1)[1].lstrip()
    else:
        text = header + text
    return text.rstrip() + "\n"


LATEX_REPLACEMENTS = {
    r"\alpha": "α",
    r"\beta": "β",
    r"\gamma": "γ",
    r"\delta": "δ",
    r"\epsilon": "ε",
    r"\varepsilon": "ε",
    r"\theta": "θ",
    r"\lambda": "λ",
    r"\mu": "μ",
    r"\pi": "π",
    r"\phi": "φ",
    r"\varphi": "φ",
    r"\tau": "τ",
    r"\omega": "ω",
    r"\cdot": "·",
    r"\times": "×",
    r"\leq": "≤",
    r"\geq": "≥",
    r"\neq": "≠",
    r"\approx": "≈",
    r"\in": "∈",
    r"\sum": "Σ",
    r"\min": "min",
    r"\max": "max",
    r"\left": "",
    r"\right": "",
}


def latex_to_display_text(value: str) -> str:
    text = value.strip()
    for source, target in LATEX_REPLACEMENTS.items():
        text = text.replace(source, target)
    text = re.sub(r"\\([A-Za-z]+)", r"\1", text)
    text = re.sub(r"\{([^{}]+)\}", r"\1", text)
    text = text.replace(r"\|", "|")
    text = text.replace(r"\_", "_")
    text = text.replace(r"\,", " ")
    text = text.replace("\\", "")
    text = re.sub(r"\s+", " ", text).strip()
    return text


def render_inline(markdown_text: str) -> str:
    code_values: list[str] = []

    def store_code(match: re.Match[str]) -> str:
        code_values.append(f"<code>{html.escape(match.group(1))}</code>")
        return INLINE_CODE_PLACEHOLDER.format(len(code_values) - 1)

    text = re.sub(r"`([^`]+)`", store_code, markdown_text)

    html_values: list[str] = []

    def store_html(value: str) -> str:
        html_values.append(value)
        return HTML_PLACEHOLDER.format(len(html_values) - 1)

    def display_math(match: re.Match[str]) -> str:
        formula = latex_to_display_text(match.group(1))
        return store_html(f"<code>{html.escape(formula)}</code>")

    text = re.sub(r"\\\((.+?)\\\)", display_math, text)
    text = re.sub(r"\$(.+?)\$", display_math, text)
    text = html.escape(text)
    text = re.sub(r"\*\*(.+?)\*\*", r"<strong>\1</strong>", text)
    text = re.sub(r"(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)", r"<em>\1</em>", text)
    for idx, value in enumerate(code_values):
        text = text.replace(html.escape(INLINE_CODE_PLACEHOLDER.format(idx)), value)
        text = text.replace(INLINE_CODE_PLACEHOLDER.format(idx), value)
    for idx, value in enumerate(html_values):
        text = text.replace(html.escape(HTML_PLACEHOLDER.format(idx)), value)
        text = text.replace(HTML_PLACEHOLDER.format(idx), value)
    return text


def is_table_separator(line: str) -> bool:
    stripped = line.strip()
    return bool(re.match(r"^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?$", stripped))


def split_table_row(line: str) -> list[str]:
    stripped = line.strip()
    if stripped.startswith("|"):
        stripped = stripped[1:]
    if stripped.endswith("|"):
        stripped = stripped[:-1]
    return [cell.strip() for cell in stripped.split("|")]


def markdown_to_html(markdown: str) -> str:
    lines = markdown.splitlines()
    html_lines: list[str] = []
    in_list = False
    list_type: str | None = None
    paragraph: list[str] = []
    in_code_block = False
    code_lines: list[str] = []
    in_display_math = False
    math_lines: list[str] = []
    i = 0

    def flush_paragraph() -> None:
        nonlocal paragraph
        if paragraph:
            html_lines.append(f"<p>{render_inline(' '.join(paragraph))}</p>")
            paragraph = []

    def close_list() -> None:
        nonlocal in_list, list_type
        if in_list:
            html_lines.append(f"</{list_type or 'ul'}>")
            in_list = False
            list_type = None

    def open_list(kind: str) -> None:
        nonlocal in_list, list_type
        if in_list and list_type != kind:
            close_list()
        if not in_list:
            html_lines.append(f"<{kind}>")
            in_list = True
            list_type = kind

    while i < len(lines):
        line = lines[i]
        stripped = line.strip()
        if in_code_block:
            if stripped.startswith("```"):
                html_lines.append(f"<pre><code>{html.escape(chr(10).join(code_lines))}</code></pre>")
                code_lines = []
                in_code_block = False
            else:
                code_lines.append(line)
            i += 1
            continue
        if in_display_math:
            if stripped == r"\]":
                html_lines.append(f"<p><code>{html.escape(latex_to_display_text(chr(10).join(math_lines)))}</code></p>")
                math_lines = []
                in_display_math = False
            else:
                math_lines.append(stripped)
            i += 1
            continue
        if stripped.startswith("```"):
            flush_paragraph()
            close_list()
            in_code_block = True
            code_lines = []
            i += 1
            continue
        if stripped == r"\[":
            flush_paragraph()
            close_list()
            in_display_math = True
            math_lines = []
            i += 1
            continue
        single_line_math = re.match(r"^\\\[(.+?)\\\]$", stripped)
        if single_line_math:
            flush_paragraph()
            close_list()
            html_lines.append(f"<p><code>{html.escape(latex_to_display_text(single_line_math.group(1)))}</code></p>")
            i += 1
            continue
        if (
            "|" in stripped
            and i + 1 < len(lines)
            and is_table_separator(lines[i + 1])
        ):
            flush_paragraph()
            close_list()
            headers = split_table_row(stripped)
            html_lines.append("<table><thead><tr>")
            for header in headers:
                html_lines.append(f"<th>{render_inline(header)}</th>")
            html_lines.append("</tr></thead><tbody>")
            i += 2
            while i < len(lines) and "|" in lines[i].strip() and lines[i].strip():
                cells = split_table_row(lines[i])
                html_lines.append("<tr>")
                for cell in cells:
                    html_lines.append(f"<td>{render_inline(cell)}</td>")
                html_lines.append("</tr>")
                i += 1
            html_lines.append("</tbody></table>")
            continue
        if not stripped:
            flush_paragraph()
            close_list()
            i += 1
            continue
        if stripped.startswith("<!--") and stripped.endswith("-->"):
            flush_paragraph()
            close_list()
            html_lines.append(stripped)
            i += 1
            continue
        heading = re.match(r"^(#{1,6})\s+(.+)$", stripped)
        if heading:
            flush_paragraph()
            close_list()
            level = len(heading.group(1))
            html_lines.append(f"<h{level}>{render_inline(heading.group(2))}</h{level}>")
            i += 1
            continue
        item = re.match(r"^[-*]\s+(.+)$", stripped)
        if item:
            flush_paragraph()
            open_list("ul")
            html_lines.append(f"<li>{render_inline(item.group(1))}</li>")
            i += 1
            continue
        ordered_item = re.match(r"^\d+[.)]\s+(.+)$", stripped)
        if ordered_item:
            flush_paragraph()
            open_list("ol")
            html_lines.append(f"<li>{render_inline(ordered_item.group(1))}</li>")
            i += 1
            continue
        paragraph.append(stripped)
        i += 1

    if in_code_block:
        html_lines.append(f"<pre><code>{html.escape(chr(10).join(code_lines))}</code></pre>")
    if in_display_math:
        html_lines.append(f"<p><code>{html.escape(latex_to_display_text(chr(10).join(math_lines)))}</code></p>")
    flush_paragraph()
    close_list()
    return "\n".join(html_lines)


def note_writer_script(task: dict[str, Any], note_html: str, *, overwrite_existing: bool = False) -> str:
    return f"""// Generated by 05_generate_zotero_note_on_demand.py. Do not edit by hand.
const TASK = {json.dumps(task, ensure_ascii=False)};
const NOTE_HTML = {json.dumps(note_html, ensure_ascii=False)};
const OVERWRITE_EXISTING = {json.dumps(overwrite_existing)};

function firstText(...values) {{
  for (const value of values) {{
    if (typeof value === "string" && value.trim()) {{
      return value.replace(/\\s+/g, " ").trim();
    }}
  }}
  return "";
}}

function existingNoteMatches(note) {{
  const raw = firstText(note.getNote ? note.getNote() : note.getField("note"));
  return raw.includes(TASK.note_marker) && raw.includes(TASK.prompt_sha256);
}}

const parent = Zotero.Items.getByLibraryAndKey(TASK.libraryID || 1, TASK.zotero_item_key);
if (!parent) {{
  throw new Error(`Parent item not found: ${{TASK.zotero_item_key}}`);
}}

const noteIDs = typeof parent.getNotes === "function" ? parent.getNotes() : [];
for (const noteID of noteIDs) {{
  const note = Zotero.Items.get(noteID);
  if (note && existingNoteMatches(note)) {{
    if (OVERWRITE_EXISTING) {{
      env.snapshot(note);
      const previousNote = firstText(note.getNote ? note.getNote() : note.getField("note"));
      note.setNote(NOTE_HTML);
      await note.saveTx();
      env.addUndoStep(async () => {{
        const updated = Zotero.Items.get(note.id);
        if (updated) {{
          updated.setNote(previousNote);
          await updated.saveTx();
        }}
      }});
      env.log(JSON.stringify({{
        ok: true,
        skipped: false,
        updated: true,
        noteID: note.id,
        noteKey: note.key,
        parentID: parent.id,
        parentKey: parent.key,
        chars: NOTE_HTML.length
      }}));
      return;
    }}
    env.log(JSON.stringify({{
      ok: true,
      skipped: true,
      reason: "NOTE_ALREADY_EXISTS",
      noteID: note.id,
      noteKey: note.key,
      parentID: parent.id,
      parentKey: parent.key
    }}));
    return;
  }}
}}

env.snapshot(parent);
const note = new Zotero.Item("note");
note.libraryID = parent.libraryID;
note.parentID = parent.id;
note.setNote(NOTE_HTML);
const noteID = await note.saveTx();
env.addUndoStep(async () => {{
  const created = Zotero.Items.get(noteID);
  if (created) {{
    await created.eraseTx();
  }}
}});
env.log(JSON.stringify({{
  ok: true,
  skipped: false,
  noteID,
  noteKey: note.key,
  parentID: parent.id,
  parentKey: parent.key,
  chars: NOTE_HTML.length
}}));
"""


def writer_prompt(script: str) -> str:
    return f"""你只需要执行一个 Zotero runtime 写入脚本。

要求：
- 使用 LM for Zotero / Zotero 插件的 zotero_script 工具。
- 参数 mode 必须是 \"write\"。
- description 使用 \"Create daily paper reading note\"。
- script 参数必须是下面 JS 的原文，不要改写。
- 不要使用 note_write。
- 不要直接修改 SQLite。
- 执行完成后，最终回复只输出工具日志中的 JSON 对象；不要添加解释文字。

JS script:
```javascript
{script}
```
"""


JSON_OBJECT_RE = re.compile(r"\{.*\}", re.DOTALL)


def parse_json_object(text: str) -> dict[str, Any]:
    stripped = text.strip()
    try:
        value = json.loads(stripped)
    except json.JSONDecodeError:
        match = JSON_OBJECT_RE.search(stripped)
        if not match:
            raise NoteGenerationError(f"Could not parse JSON from Codex writer output: {stripped[:TEXT_LIMIT]}")
        value = json.loads(match.group(0))
    if not isinstance(value, dict):
        raise NoteGenerationError("Codex writer output JSON must be an object.")
    return value


def cleanup_artifacts(args: argparse.Namespace, *paths: Path) -> None:
    if args.keep_artifacts:
        return
    for path in paths:
        try:
            path.unlink(missing_ok=True)
        except OSError:
            pass


def process_task(args: argparse.Namespace, client: HttpClient, task: dict[str, Any], notes_dir: Path) -> dict[str, Any]:
    checkpoint_path = Path(args.checkpoint).resolve() if args.checkpoint else None
    if checkpoint_path:
        append_jsonl(checkpoint_path, {"event": "note_started", "task_id": task["task_id"], "timestamp": utc_now_iso()})

    evidence = fetch_evidence(client, task, args.fulltext_chars)
    note_path = notes_dir / f"{task['task_id']}.md"
    raw_note = run_codex(args, generation_prompt(task, evidence), note_path, read_only=True)
    note_markdown = clean_generated_note(raw_note, task)
    note_path.write_text(note_markdown, encoding="utf-8")

    if args.write_mode == "none":
        cleanup_artifacts(args, note_path)
        return {
            "ok": True,
            "task_id": task["task_id"],
            "written": False,
            "artifact_retained": bool(args.keep_artifacts),
            "note_path": str(note_path) if args.keep_artifacts else None,
            "chars": len(note_markdown),
        }

    script = note_writer_script(task, markdown_to_html(note_markdown), overwrite_existing=args.overwrite_existing)
    script_path = notes_dir / f"{task['task_id']}.write.js"
    script_path.write_text(script, encoding="utf-8")
    writer_output_path = notes_dir / f"{task['task_id']}.write.json"
    writer_output = run_codex(args, writer_prompt(script), writer_output_path, read_only=True)
    writer_result = parse_json_object(writer_output)
    if not writer_result.get("ok"):
        raise NoteGenerationError(f"Zotero note writer failed: {writer_result}")

    note_id = str(writer_result.get("noteID") or "")
    if checkpoint_path:
        append_jsonl(
            checkpoint_path,
            {
                "event": "note_completed",
                "task_id": task["task_id"],
                "timestamp": utc_now_iso(),
                "note_id": note_id,
                "note_key": writer_result.get("noteKey"),
                "skipped": bool(writer_result.get("skipped")),
            },
        )

    cleanup_artifacts(args, note_path, script_path, writer_output_path)

    return {
        "ok": True,
        "task_id": task["task_id"],
        "written": True,
        "note_id": note_id,
        "note_key": writer_result.get("noteKey"),
        "skipped": bool(writer_result.get("skipped")),
        "artifact_retained": bool(args.keep_artifacts),
        "note_path": str(note_path) if args.keep_artifacts else None,
        "script_path": str(script_path) if args.keep_artifacts else None,
        "chars": len(note_markdown),
    }


def record_task_failure(args: argparse.Namespace, failures: list[dict[str, Any]], task: dict[str, Any], exc: Exception) -> None:
    failure = {"task_id": task.get("task_id"), "error": str(exc)}
    failures.append(failure)
    if args.checkpoint:
        append_jsonl(
            Path(args.checkpoint).resolve(),
            {
                "event": "note_failed",
                "task_id": task.get("task_id"),
                "timestamp": utc_now_iso(),
                "error": str(exc),
            },
        )


def process_tasks(
    args: argparse.Namespace,
    client: HttpClient,
    tasks: list[dict[str, Any]],
    notes_dir: Path,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    results: list[dict[str, Any]] = []
    failures: list[dict[str, Any]] = []
    workers = max(1, int(args.workers or 1))

    if workers == 1 or len(tasks) <= 1:
        for task in tasks:
            try:
                results.append(process_task(args, client, task, notes_dir))
            except Exception as exc:
                record_task_failure(args, failures, task, exc)
                if not args.continue_on_error:
                    raise
        return results, failures

    with concurrent.futures.ThreadPoolExecutor(max_workers=workers) as executor:
        future_to_task = {
            executor.submit(process_task, args, client, task, notes_dir): task
            for task in tasks
        }
        for future in concurrent.futures.as_completed(future_to_task):
            task = future_to_task[future]
            try:
                results.append(future.result())
            except Exception as exc:
                record_task_failure(args, failures, task, exc)
                if not args.continue_on_error:
                    raise
    return results, failures


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Generate Zotero notes for synced daily papers.")
    parser.add_argument("--date")
    parser.add_argument("--sync-report")
    parser.add_argument("--prompts-dir", default="llm-for-zotero")
    parser.add_argument(
        "--item-key",
        action="append",
        help="Restrict prepared tasks to one Zotero parent item key. Can be repeated.",
    )
    parser.add_argument(
        "--prompt-name",
        action="append",
        help="Restrict prepared tasks to one prompt file stem, for example Summarize. Can be repeated.",
    )
    parser.add_argument("--tasks", help="Existing task JSONL. If omitted, tasks are prepared from --sync-report.")
    parser.add_argument("--tasks-out", help="Write prepared tasks JSONL.")
    parser.add_argument("--checkpoint")
    parser.add_argument(
        "--notes-dir",
        help="Artifact directory for generated Markdown notes and writer JS when --keep-artifacts is set.",
    )
    parser.add_argument(
        "--keep-artifacts",
        action="store_true",
        help="Keep generated note Markdown, writer JS, and writer JSON artifacts for debugging.",
    )
    parser.add_argument("--base-url", default=DEFAULT_BASE_URL)
    parser.add_argument("--timeout", type=float, default=30.0)
    parser.add_argument("--limit", type=int)
    parser.add_argument("--overwrite-existing", action="store_true")
    parser.add_argument("--no-resume", action="store_false", dest="resume")
    parser.add_argument("--fulltext-chars", type=int, default=DEFAULT_FULLTEXT_CHARS)
    parser.add_argument("--codex-bin", default=DEFAULT_CODEX_BIN)
    parser.add_argument("--codex-model")
    parser.add_argument("--codex-timeout", type=float, default=900.0)
    parser.add_argument("--write-mode", choices=["codex", "none"], default="codex")
    parser.add_argument("--workers", type=int, default=1, help="Number of note tasks to process concurrently.")
    parser.add_argument("--dry-run", action="store_true", help="Prepare tasks only; do not invoke Codex.")
    parser.add_argument("--continue-on-error", action="store_true", default=True)
    parser.set_defaults(resume=True)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    client = HttpClient(args.base_url, timeout=args.timeout)
    try:
        tasks, prep_summary = prepare_tasks(args, client)
        if args.dry_run:
            print(json.dumps({"ok": True, "dry_run": True, "prepare": prep_summary}, ensure_ascii=False, indent=2))
            return 0

        date = args.date or (tasks[0].get("date") if tasks else dt.date.today().isoformat())
        if args.keep_artifacts:
            notes_dir = Path(args.notes_dir or f"work/zotero_note_artifacts_{date}").resolve()
            notes_dir.mkdir(parents=True, exist_ok=True)
            results, failures = process_tasks(args, client, tasks, notes_dir)
            notes_dir_summary = str(notes_dir)
        else:
            with tempfile.TemporaryDirectory(prefix=f"zotero_note_artifacts_{date}_") as temp_dir:
                notes_dir = Path(temp_dir).resolve()
                results, failures = process_tasks(args, client, tasks, notes_dir)
            notes_dir_summary = None

        print(
            json.dumps(
                {
                    "ok": not failures,
                    "prepare": prep_summary,
                    "artifacts_retained": bool(args.keep_artifacts),
                    "notes_dir": notes_dir_summary,
                    "workers": max(1, int(args.workers or 1)),
                    "processed": len(results),
                    "failed": len(failures),
                    "results": results,
                    "failures": failures,
                },
                ensure_ascii=False,
                indent=2,
            )
        )
        return 0 if not failures else 1
    except Exception as exc:
        print(json.dumps({"ok": False, "error": str(exc)}, ensure_ascii=False, indent=2))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
