#!/usr/bin/env python3
"""Generate a stable Markdown daily paper brief from Paper Easy data.

Input JSON schema, intentionally small:

{
  "date": "2026-06-11",
  "topics": ["世界模型", "具身智能", "空间记忆", "多模态大语言模型"],
  "sources": [
    {"source": "arxiv", "date": "2026-06-11", "papers": [...]},
    {"source": "huggingface", "date": "2026-06-10", "papers": [...]}
  ],
  "selection": [
    {"index": 1, "topic": "多模态大语言模型", "relevance": "..."},
    {"index": 5, "topic": "具身智能", "also_topics": ["世界模型"]}
  ]
}

Paper indexes are 1-based by default. The script also accepts:

- "selected": {"世界模型": [1, 3], "具身智能": [{"index": 5, "relevance": "..."}]}
- "--selection selection.json" to keep selected indexes in a separate file.
- Selection by "id" instead of "index".

Output is always split into two sections:

1. 感兴趣论文
2. Hugging Face Daily Papers

When a Zotero sync report is available, selected papers include macOS Zotero
deep links such as zotero://select/library/items/ITEMKEY.

By default, the generated brief is written into the user's Obsidian vault:
6.论文笔记/DailyPapers/daily_paper_brief_YYYY-MM-DD.md. Pass --output - to
write to stdout instead.
"""

from __future__ import annotations

import argparse
import copy
import datetime as dt
import json
import os
import re
import sys
import urllib.parse
from pathlib import Path
from typing import Any


DEFAULT_TOPICS = ["世界模型", "具身智能", "空间记忆", "多模态大语言模型"]
NO_MATCH = "今日没有命中论文。"
ARXIV_ID_RE = re.compile(r"(?<!\d)(\d{4}\.\d{4,5})(?:v\d+)?(?!\d)")
DEFAULT_OBSIDIAN_VAULT = Path(os.environ.get("OBSIDIAN_VAULT", "~/Obsidian")).expanduser()
DEFAULT_OBSIDIAN_DAILY_PAPERS_DIR = Path(os.environ.get("OBSIDIAN_DAILY_PAPERS_DIR", "DailyPapers"))
DEFAULT_NOTE_CALLBACK_BASE_URL = "daily-paper-note://generate"
DEFAULT_NOTE_PROMPTS_DIR = Path("llm-for-zotero")


def load_json(path: str | None) -> Any:
    if not path or path == "-":
        return json.load(sys.stdin)
    with Path(path).open("r", encoding="utf-8") as handle:
        return json.load(handle)


def first_text(*values: Any) -> str:
    for value in values:
        if isinstance(value, str) and value.strip():
            return re.sub(r"\s+", " ", value.strip())
    return ""


def normalize_arxiv_id(value: str) -> str:
    match = ARXIV_ID_RE.search(value or "")
    return match.group(1) if match else ""


def arxiv_id_from_paper(paper: dict[str, Any]) -> str:
    candidates = [
        first_text(paper.get("id")),
        first_text(paper.get("versionedId")),
        first_text(paper.get("arxivId"), paper.get("arxiv_id")),
        first_text(paper.get("arxivUrl"), paper.get("arxiv_url")),
        first_text(paper.get("pdfUrl"), paper.get("pdf_url")),
        first_text(paper.get("url"), paper.get("link")),
    ]
    for candidate in candidates:
        arxiv_id = normalize_arxiv_id(candidate)
        if arxiv_id:
            return arxiv_id
    return ""


def list_text(values: Any) -> str:
    if isinstance(values, list):
        return "、".join(str(value).strip() for value in values if str(value).strip())
    if isinstance(values, str):
        return values.strip()
    return ""


def source_label(source: str) -> str:
    normalized = source.lower().strip()
    if normalized in {"arxiv", "arxiv_daily", "arxiv daily"}:
        return "arXiv Daily"
    if normalized in {"huggingface", "hf", "hf daily", "hugging face"}:
        return "Hugging Face Daily Papers"
    return source.strip() or "Unknown"


def source_date(block: dict[str, Any]) -> str:
    return first_text(
        block.get("date"),
        block.get("selectedDate"),
        block.get("source_date"),
        block.get("sourceDate"),
        block.get("requestedDate"),
    )


def source_label_with_date(block: dict[str, Any]) -> str:
    label = source_label(first_text(block.get("source"), block.get("name")))
    date = source_date(block)
    return f"{label}（{date}）" if date else label


def normalized_source(source: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", source.lower()).strip()


def is_huggingface_source(source: str) -> bool:
    normalized = normalized_source(source)
    return normalized in {
        "hf",
        "hf daily",
        "huggingface",
        "hugging face",
        "hugging face daily",
        "hugging face daily papers",
    }


def canonical_key(paper: dict[str, Any]) -> str:
    paper_id = first_text(paper.get("id"), paper.get("versionedId"))
    if paper_id:
        return f"id:{re.sub(r'v\\d+$', '', paper_id)}"
    arxiv_url = first_text(paper.get("arxivUrl"), paper.get("arxiv_url"))
    if arxiv_url:
        return f"arxiv:{arxiv_url.rstrip('/')}"
    title = first_text(paper.get("title"), paper.get("english_title"), paper.get("title_en"))
    return f"title:{title.lower()}"


def zotero_select_url(item_key: str) -> str:
    return f"zotero://select/library/items/{item_key}"


def note_callback_url(base_url: str, date: str, item_key: str, prompt_name: str) -> str:
    query = urllib.parse.urlencode({"date": date, "item": item_key, "prompt": prompt_name})
    cleaned = base_url.strip().rstrip("/")
    parsed = urllib.parse.urlparse(cleaned)
    if parsed.scheme in {"http", "https"} and parsed.path in {"", "/"}:
        cleaned = f"{cleaned}/generate"
    separator = "&" if "?" in cleaned else "?"
    return f"{cleaned}{separator}{query}"


def discover_note_prompt_names(prompts_dir: str | Path) -> list[str]:
    path = Path(prompts_dir)
    if not path.exists():
        return []
    names = {
        prompt_path.stem.strip()
        for prompt_path in path.rglob("*.txt")
        if prompt_path.is_file() and prompt_path.stem.strip()
    }
    return sorted(names)


def zotero_report_lookup(report_payload: Any) -> dict[str, str]:
    result = report_payload.get("result") if isinstance(report_payload, dict) else None
    if not isinstance(result, dict):
        result = report_payload if isinstance(report_payload, dict) else {}
    actions = result.get("actions")
    if not isinstance(actions, list):
        return {}

    lookup: dict[str, str] = {}
    for action in actions:
        if not isinstance(action, dict):
            continue
        item_key = first_text(
            action.get("zotero_item_key"),
            action.get("zoteroItemKey"),
            action.get("item_key"),
            action.get("itemKey"),
        )
        if not item_key:
            continue

        arxiv_id = normalize_arxiv_id(first_text(action.get("arxiv_id"), action.get("arxivId"), action.get("id")))
        if arxiv_id:
            lookup[f"arxiv:{arxiv_id}"] = item_key
            lookup[f"id:{arxiv_id}"] = item_key

        title = first_text(action.get("title"))
        if title:
            lookup[f"title:{title.lower()}"] = item_key
    return lookup


def default_zotero_sync_report_path(input_path: str, payload: dict[str, Any]) -> Path | None:
    if input_path == "-":
        return None
    date = first_text(payload.get("date"), payload.get("selectedDate")) or dt.date.today().isoformat()
    return Path(input_path).resolve().parent / f"zotero_sync_{date}.json"


def brief_date(payload: dict[str, Any]) -> str:
    return first_text(payload.get("date"), payload.get("selectedDate")) or dt.date.today().isoformat()


def default_obsidian_output_path(args: argparse.Namespace, payload: dict[str, Any]) -> Path:
    vault = Path(args.obsidian_vault).expanduser()
    daily_dir = Path(args.obsidian_dir)
    if daily_dir.is_absolute():
        return daily_dir / f"daily_paper_brief_{brief_date(payload)}.md"
    return vault / daily_dir / f"daily_paper_brief_{brief_date(payload)}.md"


def load_zotero_lookup(path: str | None, input_path: str, payload: dict[str, Any]) -> dict[str, str]:
    report_path: Path | None
    if path:
        report_path = Path(path).resolve()
    else:
        report_path = default_zotero_sync_report_path(input_path, payload)
    if report_path is None or not report_path.exists():
        return {}
    return zotero_report_lookup(load_json(str(report_path)))


def zotero_item_key_for_paper(paper: dict[str, Any], zotero_lookup: dict[str, str]) -> str:
    explicit = first_text(
        paper.get("zotero_item_key"),
        paper.get("zoteroItemKey"),
        paper.get("zoteroKey"),
        paper.get("itemKey"),
    )
    if explicit:
        return explicit

    arxiv_id = arxiv_id_from_paper(paper)
    if arxiv_id and zotero_lookup.get(f"arxiv:{arxiv_id}"):
        return zotero_lookup[f"arxiv:{arxiv_id}"]

    paper_id = first_text(paper.get("id"), paper.get("versionedId"))
    if paper_id:
        normalized_id = re.sub(r"v\d+$", "", paper_id)
        if zotero_lookup.get(f"id:{normalized_id}"):
            return zotero_lookup[f"id:{normalized_id}"]

    title = paper_title_en(paper)
    if title and zotero_lookup.get(f"title:{title.lower()}"):
        return zotero_lookup[f"title:{title.lower()}"]
    return ""


def iter_source_blocks(payload: Any) -> list[dict[str, Any]]:
    if not isinstance(payload, dict):
        raise TypeError("Input JSON must be an object with a sources list.")

    sources = payload.get("sources")
    if not isinstance(sources, list):
        raise ValueError("Input JSON must include sources: [{\"source\": ..., \"papers\": [...]}].")
    return [block for block in sources if isinstance(block, dict)]


def flatten_papers(payload: Any) -> tuple[list[dict[str, Any]], dict[int, dict[str, Any]], dict[str, dict[str, Any]]]:
    papers: list[dict[str, Any]] = []
    index_lookup: dict[int, dict[str, Any]] = {}
    id_lookup: dict[str, dict[str, Any]] = {}
    key_lookup: dict[str, dict[str, Any]] = {}
    next_index = 1

    for block in iter_source_blocks(payload):
        source = source_label(first_text(block.get("source"), block.get("name")))
        for raw_paper in block.get("papers", []):
            if not isinstance(raw_paper, dict):
                continue
            raw_index = raw_paper.get("index", raw_paper.get("idx"))
            try:
                index = int(raw_index) if raw_index is not None else next_index
            except (TypeError, ValueError):
                index = next_index
            next_index = max(next_index, index + 1)

            key = canonical_key(raw_paper)
            if key in key_lookup:
                paper = key_lookup[key]
                paper["__indexes"].append(index)
                if source not in paper["__sources"]:
                    paper["__sources"].append(source)
                merge_missing_fields(paper, raw_paper)
            else:
                paper = copy.deepcopy(raw_paper)
                paper["__index"] = index
                paper["__indexes"] = [index]
                paper["__sources"] = [source]
                key_lookup[key] = paper
                papers.append(paper)

            index_lookup[index] = paper
            paper_id = first_text(raw_paper.get("id"), raw_paper.get("versionedId"))
            if paper_id:
                id_lookup[paper_id] = paper
                id_lookup[re.sub(r"v\d+$", "", paper_id)] = paper

    return papers, index_lookup, id_lookup


def merge_missing_fields(target: dict[str, Any], source: dict[str, Any]) -> None:
    for key, value in source.items():
        if key.startswith("__"):
            continue
        if key not in target or target[key] in (None, "", [], {}):
            target[key] = copy.deepcopy(value)
        elif key == "translations" and isinstance(target.get(key), dict) and isinstance(value, dict):
            for lang, translation in value.items():
                target[key].setdefault(lang, translation)
        elif key in {"huggingFaceUrl", "arxivUrl", "pdfUrl"} and value and not target.get(key):
            target[key] = value


def collect_huggingface_daily_papers(
    payload: dict[str, Any], flattened_papers: list[dict[str, Any]]
) -> list[dict[str, Any]]:
    by_key = {canonical_key(paper): paper for paper in flattened_papers}
    papers: list[dict[str, Any]] = []
    seen: set[str] = set()

    for block in iter_source_blocks(payload):
        label = source_label(first_text(block.get("source"), block.get("name")))
        if not is_huggingface_source(label):
            continue
        for raw_paper in block.get("papers", []):
            if not isinstance(raw_paper, dict):
                continue
            key = canonical_key(raw_paper)
            if key in seen:
                continue
            seen.add(key)
            papers.append(by_key.get(key, raw_paper))
    return papers


def huggingface_source_date(payload: dict[str, Any]) -> str:
    for block in iter_source_blocks(payload):
        label = source_label(first_text(block.get("source"), block.get("name")))
        if is_huggingface_source(label):
            return source_date(block)
    return ""


def parse_selection_entries(selection_data: Any) -> list[dict[str, Any]]:
    if not selection_data:
        return []

    if isinstance(selection_data, dict):
        entries: list[dict[str, Any]] = []
        for topic, value in selection_data.items():
            values = value if isinstance(value, list) else [value]
            for item in values:
                if isinstance(item, dict):
                    entry = dict(item)
                    entry.setdefault("topic", topic)
                else:
                    entry = {"index": item, "topic": topic}
                entries.append(entry)
        return entries

    if isinstance(selection_data, list):
        entries = []
        for item in selection_data:
            if isinstance(item, dict):
                if isinstance(item.get("indexes"), list):
                    for index in item["indexes"]:
                        entry = dict(item)
                        entry.pop("indexes", None)
                        entry["index"] = index
                        entries.append(entry)
                else:
                    entries.append(dict(item))
            else:
                entries.append({"index": item})
        return entries

    raise TypeError("Selection must be a list or an object.")


def topic_values(entry: dict[str, Any], known_topics: list[str]) -> tuple[str, list[str]]:
    raw_topics = entry.get("topics")
    if raw_topics is None and entry.get("topic"):
        raw_topics = [entry["topic"]]
    if isinstance(raw_topics, str):
        topics = [raw_topics]
    elif isinstance(raw_topics, list):
        topics = [str(topic).strip() for topic in raw_topics if str(topic).strip()]
    else:
        topics = []

    primary = topics[0] if topics else "未分类"
    if primary not in known_topics:
        known_topics.append(primary)

    also = [topic for topic in topics[1:] if topic != primary]
    extra = entry.get("also_topics", entry.get("alsoTopics"))
    if isinstance(extra, str):
        extra = [extra]
    if isinstance(extra, list):
        also.extend(str(topic).strip() for topic in extra if str(topic).strip() and str(topic).strip() != primary)

    deduped_also: list[str] = []
    for topic in also:
        if topic not in deduped_also:
            deduped_also.append(topic)
        if topic not in known_topics:
            known_topics.append(topic)
    return primary, deduped_also


def resolve_selection(
    payload: dict[str, Any],
    selection_payload: Any | None,
    index_lookup: dict[int, dict[str, Any]],
    id_lookup: dict[str, dict[str, Any]],
    topics: list[str],
) -> list[dict[str, Any]]:
    selection_data = selection_payload
    if selection_data is None:
        selection_data = payload.get("selection", payload.get("selected", payload.get("selected_papers")))

    selected: list[dict[str, Any]] = []
    selected_keys: set[str] = set()
    for entry in parse_selection_entries(selection_data):
        paper: dict[str, Any] | None = None
        if "index" in entry:
            try:
                paper = index_lookup.get(int(entry["index"]))
            except (TypeError, ValueError):
                paper = None
        if paper is None and "id" in entry:
            paper = id_lookup.get(str(entry["id"]))
        if paper is None and "paper_id" in entry:
            paper = id_lookup.get(str(entry["paper_id"]))
        if paper is None:
            continue

        key = canonical_key(paper)
        primary_topic, also_topics = topic_values(entry, topics)
        relevance = first_text(entry.get("relevance"), entry.get("reason"), entry.get("why"))
        if key in selected_keys:
            for item in selected:
                if item["key"] == key:
                    if primary_topic not in item["topics"]:
                        item["topics"].append(primary_topic)
                    for topic in also_topics:
                        if topic not in item["topics"]:
                            item["topics"].append(topic)
                    if relevance and not item.get("relevance"):
                        item["relevance"] = relevance
                    break
            continue

        selected_keys.add(key)
        selected.append(
            {
                "key": key,
                "paper": paper,
                "primary_topic": primary_topic,
                "topics": [primary_topic, *also_topics],
                "relevance": relevance,
            }
        )
    return selected


def zh_translation(paper: dict[str, Any]) -> dict[str, Any]:
    translations = paper.get("translations")
    if isinstance(translations, dict):
        zh = translations.get("zh") or translations.get("zh-CN") or translations.get("zh_cn")
        if isinstance(zh, dict):
            return zh
    return {}


def paper_field(paper: dict[str, Any], *keys: str) -> str:
    return first_text(*(paper.get(key) for key in keys))


def paper_title_en(paper: dict[str, Any]) -> str:
    return paper_field(paper, "title", "title_en", "englishTitle", "english_title")


def paper_title_zh(paper: dict[str, Any]) -> str:
    zh = zh_translation(paper)
    return first_text(zh.get("title"), paper.get("title_zh"), paper.get("zhTitle"), paper_title_en(paper))


def paper_summary_en(paper: dict[str, Any]) -> str:
    return paper_field(paper, "summary", "abstract", "abstract_en", "englishSummary", "english_summary")


def paper_summary_zh(paper: dict[str, Any]) -> str:
    zh = zh_translation(paper)
    return first_text(zh.get("summary"), paper.get("summary_zh"), paper.get("abstract_zh"), paper_summary_en(paper))


def link_lines(
    paper: dict[str, Any],
    zotero_lookup: dict[str, str] | None = None,
    *,
    date: str = "",
    note_prompt_names: list[str] | None = None,
    note_callback_base_url: str = "",
) -> list[str]:
    arxiv_url = paper_field(paper, "arxivUrl", "arxiv_url")
    pdf_url = paper_field(paper, "pdfUrl", "pdf_url")
    hf_url = paper_field(paper, "huggingFaceUrl", "huggingfaceUrl", "hfUrl")
    generic_url = paper_field(paper, "url", "link")
    zotero_key = zotero_item_key_for_paper(paper, zotero_lookup or {})

    lines = []
    if arxiv_url:
        lines.append(f"- 论文链接：[arXiv]({arxiv_url})")
    elif generic_url:
        lines.append(f"- 论文链接：[{generic_url}]({generic_url})")
    elif pdf_url:
        lines.append(f"- 论文链接：[PDF]({pdf_url})")
    else:
        lines.append("- 论文链接：暂无")

    if pdf_url:
        lines.append(f"- PDF：[PDF]({pdf_url})")
    if hf_url:
        lines.append(f"- Hugging Face：[Daily Paper]({hf_url})")
    if zotero_key:
        lines.append(f"- Zotero：[打开 Zotero]({zotero_select_url(zotero_key)})")
        prompt_names = note_prompt_names or []
        if date and note_callback_base_url and prompt_names:
            prompt_links = [
                f"[{prompt_name}]({note_callback_url(note_callback_base_url, date, zotero_key, prompt_name)})"
                for prompt_name in prompt_names
            ]
            lines.append(f"- LM for Zotero：{'、'.join(prompt_links)}")
    return lines


def blockquote(text: str) -> str:
    cleaned = text.strip()
    if not cleaned:
        return "> 暂无"
    paragraphs = [part.strip() for part in re.split(r"\n\s*\n", cleaned) if part.strip()]
    return "\n>\n".join("\n".join(f"> {line.strip()}" for line in paragraph.splitlines()) for paragraph in paragraphs)


def metadata_value(value: str) -> str:
    return value if value else "暂无"


def markdown_heading(level: int, text: str) -> str:
    level = max(1, min(level, 6))
    return f"{'#' * level} {text}"


def clip_text(text: str, limit: int = 520) -> str:
    cleaned = re.sub(r"\s+", " ", text.strip())
    if not cleaned:
        return "暂无"
    if len(cleaned) <= limit:
        return cleaned
    return cleaned[:limit].rstrip(" ,.;，。") + "..."


def render_paper(
    item: dict[str, Any],
    number: int,
    heading_level: int = 3,
    zotero_lookup: dict[str, str] | None = None,
    date: str = "",
    note_prompt_names: list[str] | None = None,
    note_callback_base_url: str = "",
) -> str:
    paper = item["paper"]
    title_zh = paper_title_zh(paper)
    title_en = paper_title_en(paper)
    authors = metadata_value(list_text(paper.get("authors")))
    categories = metadata_value(list_text(paper.get("categories")) or paper_field(paper, "primaryCategory"))
    sources = "、".join(paper.get("__sources", [])) or "Unknown"
    indexes = "、".join(str(index) for index in paper.get("__indexes", [paper.get("__index")]) if index is not None)
    related_topics = "、".join(item["topics"])
    relevance = item.get("relevance") or f"匹配主题：{related_topics}"

    lines = [
        markdown_heading(heading_level, f"{number}. {title_zh}"),
        "",
        f"- 当日索引：{indexes}",
        f"- 中文标题：{title_zh}",
        f"- 英文标题：{metadata_value(title_en)}",
        f"- 作者：{authors}",
        f"- 来源：{sources}",
        f"- 分类/标签：{categories}",
        *link_lines(
            paper,
            zotero_lookup,
            date=date,
            note_prompt_names=note_prompt_names,
            note_callback_base_url=note_callback_base_url,
        ),
        f"- 相关主题：{related_topics}",
        f"- 相关性：{relevance}",
        "",
        "**中文摘要**",
        "",
        blockquote(paper_summary_zh(paper)),
        "",
        "**English Abstract**",
        "",
        blockquote(paper_summary_en(paper)),
    ]
    return "\n".join(lines)


def render_huggingface_daily_paper(paper: dict[str, Any], number: int) -> str:
    title_zh = paper_title_zh(paper)
    title_en = paper_title_en(paper)
    authors = metadata_value(list_text(paper.get("authors")))
    categories = metadata_value(list_text(paper.get("categories")) or paper_field(paper, "primaryCategory"))
    indexes = "、".join(str(index) for index in paper.get("__indexes", [paper.get("__index")]) if index is not None)

    lines = [
        markdown_heading(3, f"{number}. {title_zh}"),
        "",
        f"- 当日索引：{metadata_value(indexes)}",
        f"- 中文标题：{title_zh}",
        f"- 英文标题：{metadata_value(title_en)}",
        f"- 作者：{authors}",
        f"- 分类/标签：{categories}",
        *link_lines(paper),
        f"- 中文摘要：{clip_text(paper_summary_zh(paper))}",
        f"- English Abstract: {clip_text(paper_summary_en(paper))}",
    ]
    return "\n".join(lines)


def append_topic_sections(
    lines: list[str],
    selected: list[dict[str, Any]],
    topics: list[str],
    grouped: dict[str, list[dict[str, Any]]],
    topic_heading_level: int,
    paper_heading_level: int,
    zotero_lookup: dict[str, str] | None = None,
    date: str = "",
    note_prompt_names: list[str] | None = None,
    note_callback_base_url: str = "",
) -> None:
    if not selected:
        lines.extend(
            [
                "今日已检查 arXiv Daily 与 Hugging Face Daily Papers；没有命中这些主题的论文。",
                "",
            ]
        )

    for topic in topics:
        lines.extend([markdown_heading(topic_heading_level, topic), ""])
        papers = grouped.get(topic, [])
        if not papers:
            lines.extend([NO_MATCH, ""])
            continue
        for number, item in enumerate(papers, start=1):
            lines.extend(
                [
                    render_paper(
                        item,
                        number,
                        heading_level=paper_heading_level,
                        zotero_lookup=zotero_lookup,
                        date=date,
                        note_prompt_names=note_prompt_names,
                        note_callback_base_url=note_callback_base_url,
                    ),
                    "",
                ]
            )


def render_markdown(
    payload: dict[str, Any],
    selected: list[dict[str, Any]],
    topics: list[str],
    flattened_papers: list[dict[str, Any]] | None = None,
    zotero_lookup: dict[str, str] | None = None,
    note_prompt_names: list[str] | None = None,
    note_callback_base_url: str = "",
) -> str:
    date = first_text(payload.get("date"), payload.get("selectedDate")) or dt.date.today().isoformat()
    if flattened_papers is None:
        flattened_papers = flatten_papers(payload)[0]
    hf_daily_papers = collect_huggingface_daily_papers(payload, flattened_papers)

    source_names = []
    for block in iter_source_blocks(payload):
        label = source_label_with_date(block)
        if label not in source_names:
            source_names.append(label)
    if not source_names:
        source_names = ["arXiv Daily", "Hugging Face Daily Papers"]

    grouped: dict[str, list[dict[str, Any]]] = {topic: [] for topic in topics}
    for item in selected:
        grouped.setdefault(item["primary_topic"], []).append(item)

    hf_date = huggingface_source_date(payload)
    hf_count_line = (
        f"- Hugging Face Daily Papers（{hf_date}）：{len(hf_daily_papers)} 篇"
        if hf_date
        else f"- Hugging Face Daily Papers：{len(hf_daily_papers)} 篇"
    )

    lines = [
        f"# 每日论文简报（{date}）",
        "",
        f"- 数据来源：{'、'.join(source_names)}",
        f"- 筛选主题：{'、'.join(topics)}",
        f"- 命中论文：{len(selected)} 篇",
        hf_count_line,
        "",
    ]

    lines.extend(["## 感兴趣论文", ""])
    append_topic_sections(
        lines,
        selected,
        topics,
        grouped,
        topic_heading_level=3,
        paper_heading_level=4,
        zotero_lookup=zotero_lookup,
        date=date,
        note_prompt_names=note_prompt_names,
        note_callback_base_url=note_callback_base_url,
    )
    lines.extend(["## Hugging Face Daily Papers", ""])
    if hf_date:
        lines.extend([f"- 数据日期：{hf_date}", ""])
    if not hf_daily_papers:
        lines.extend(["今日 Hugging Face Daily Papers 暂无内容。", ""])
    else:
        for number, paper in enumerate(hf_daily_papers, start=1):
            lines.extend([render_huggingface_daily_paper(paper, number), ""])

    return "\n".join(lines).rstrip() + "\n"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Generate a Markdown daily paper brief.")
    parser.add_argument("--input", "-i", required=True, help="Paper Easy data JSON. Use '-' for stdin.")
    parser.add_argument("--selection", "-s", help="Optional selected-index JSON. Overrides selection in --input.")
    parser.add_argument(
        "--zotero-sync-report",
        help=(
            "Optional Zotero sync report JSON. If omitted, the script tries "
            "zotero_sync_<date>.json next to --input."
        ),
    )
    parser.add_argument(
        "--obsidian-vault",
        default=str(DEFAULT_OBSIDIAN_VAULT),
        help="Obsidian vault path used when --output is omitted.",
    )
    parser.add_argument(
        "--obsidian-dir",
        default=str(DEFAULT_OBSIDIAN_DAILY_PAPERS_DIR),
        help="Vault-relative DailyPapers directory used when --output is omitted.",
    )
    parser.add_argument(
        "--output",
        "-o",
        help=(
            "Output Markdown path. Defaults to the Obsidian DailyPapers path. "
            "Use '-' for stdout."
        ),
    )
    parser.add_argument(
        "--note-callback-base-url",
        default=DEFAULT_NOTE_CALLBACK_BASE_URL,
        help=(
            "URL action base used for on-demand LM for Zotero note links. "
            "Defaults to daily-paper-note://generate."
        ),
    )
    parser.add_argument(
        "--note-prompts-dir",
        default=str(DEFAULT_NOTE_PROMPTS_DIR),
        help="Directory containing llm-for-zotero .txt prompts. File stems become link labels.",
    )
    parser.add_argument(
        "--disable-note-actions",
        action="store_true",
        help="Do not render on-demand LM for Zotero note-generation links.",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    payload = load_json(args.input)
    if not isinstance(payload, dict):
        raise TypeError("Input JSON must be an object with sources, topics, and selected.")
    selection_payload = load_json(args.selection) if args.selection else None

    topics = payload.get("topics")
    if isinstance(topics, list):
        topic_order = [str(topic).strip() for topic in topics if str(topic).strip()]
    else:
        topic_order = list(DEFAULT_TOPICS)
    if not topic_order:
        topic_order = list(DEFAULT_TOPICS)

    flattened_papers, index_lookup, id_lookup = flatten_papers(payload)
    selected = resolve_selection(payload, selection_payload, index_lookup, id_lookup, topic_order)
    zotero_lookup = load_zotero_lookup(args.zotero_sync_report, args.input, payload)
    prompt_names = [] if args.disable_note_actions else discover_note_prompt_names(args.note_prompts_dir)
    note_callback_base_url = "" if args.disable_note_actions else args.note_callback_base_url
    markdown = render_markdown(
        payload,
        selected,
        topic_order,
        flattened_papers,
        zotero_lookup,
        note_prompt_names=prompt_names,
        note_callback_base_url=note_callback_base_url,
    )

    if args.output == "-":
        sys.stdout.write(markdown)
    else:
        output_path = Path(args.output) if args.output else default_obsidian_output_path(args, payload)
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_text(markdown, encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
