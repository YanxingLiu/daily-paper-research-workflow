#!/usr/bin/env python3
"""Prepare the deterministic daily-paper input JSON.

Paper Easy access still happens in the automation through its MCP tool. This
script starts the local deterministic pipeline: it validates and normalizes the
JSON that contains Paper Easy's raw paper objects plus the AI-filled
``selected`` field.

It intentionally preserves paper objects as returned by Paper Easy. In
particular, it does not rewrite title/summary/translations fields.
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import sys
from pathlib import Path
from typing import Any


DEFAULT_TOPICS = ["世界模型", "具身智能", "空间记忆", "多模态大语言模型"]
SOURCE_ORDER = {"arxiv": 0, "huggingface": 1}


class InputPrepError(RuntimeError):
    pass


def load_json(path: str | None) -> Any:
    if not path or path == "-":
        return json.load(sys.stdin)
    with Path(path).open("r", encoding="utf-8") as handle:
        return json.load(handle)


def write_json(path: str, payload: Any) -> Path:
    output = Path(path).resolve()
    output.parent.mkdir(parents=True, exist_ok=True)
    with output.open("w", encoding="utf-8") as handle:
        json.dump(payload, handle, ensure_ascii=False, indent=2)
        handle.write("\n")
    return output


def parse_topics(raw: str | None) -> list[str]:
    if not raw:
        return list(DEFAULT_TOPICS)
    try:
        value = json.loads(raw)
    except json.JSONDecodeError:
        value = [part.strip() for part in raw.split(",")]
    if not isinstance(value, list):
        raise InputPrepError("--topics must be a JSON list or a comma-separated string.")
    topics = [str(item).strip() for item in value if str(item).strip()]
    if not topics:
        raise InputPrepError("At least one topic is required.")
    return topics


def normalize_source_name(source: str) -> str:
    normalized = source.strip().lower().replace(" ", "").replace("-", "").replace("_", "")
    if normalized in {"arxiv", "arxivdaily"}:
        return "arxiv"
    if normalized in {"hf", "hfdaily", "huggingface", "huggingfacedaily", "huggingfacedailypapers"}:
        return "huggingface"
    return source.strip() or "unknown"


def papers_from_file(path: str, source: str) -> dict[str, Any]:
    value = load_json(path)
    metadata: dict[str, Any] = {}
    if isinstance(value, list):
        papers = value
    elif isinstance(value, dict):
        papers = value.get("papers")
        if papers is None:
            papers = value.get("data")
        for key in ("date", "selectedDate", "source_date", "sourceDate", "requestedDate", "updatedAt"):
            if value.get(key):
                metadata[key] = value[key]
    else:
        papers = None
    if not isinstance(papers, list):
        raise InputPrepError(f"{path} must contain a paper list or an object with a papers list.")
    return {"source": normalize_source_name(source), **metadata, "papers": papers}


def empty_selected(topics: list[str]) -> dict[str, list[Any]]:
    return {topic: [] for topic in topics}


def normalize_selected(value: Any, topics: list[str]) -> Any:
    if value is None:
        return empty_selected(topics)
    if isinstance(value, dict):
        selected = {topic: [] for topic in topics}
        for topic, entries in value.items():
            values = entries if isinstance(entries, list) else [entries]
            selected.setdefault(str(topic), [])
            selected[str(topic)].extend(values)
        return selected
    if isinstance(value, list):
        return value
    raise InputPrepError("selected must be an object or a list.")


def source_sort_key(block: dict[str, Any]) -> tuple[int, str]:
    source = normalize_source_name(str(block.get("source") or block.get("name") or "unknown"))
    return (SOURCE_ORDER.get(source, 99), source)


def normalize_payload(payload: dict[str, Any], *, date: str | None, topics: list[str]) -> dict[str, Any]:
    if not isinstance(payload, dict):
        raise InputPrepError("Input payload must be a JSON object.")

    sources = payload.get("sources")
    if not isinstance(sources, list):
        raise InputPrepError("Input payload must include sources: [{source, papers}].")

    normalized_sources: list[dict[str, Any]] = []
    for block in sources:
        if not isinstance(block, dict):
            continue
        papers = block.get("papers")
        if not isinstance(papers, list):
            raise InputPrepError("Every source block must contain a papers list.")
        source = normalize_source_name(str(block.get("source") or block.get("name") or "unknown"))
        copied = dict(block)
        copied["source"] = source
        copied["papers"] = papers
        normalized_sources.append(copied)

    normalized_sources.sort(key=source_sort_key)
    selected = normalize_selected(payload.get("selected", payload.get("selection")), topics)
    return {
        "date": date or str(payload.get("date") or dt.date.today().isoformat()),
        "topics": topics,
        "sources": normalized_sources,
        "selected": selected,
    }


def build_from_parts(args: argparse.Namespace, topics: list[str]) -> dict[str, Any]:
    sources: list[dict[str, Any]] = []
    if args.arxiv_file:
        sources.append(papers_from_file(args.arxiv_file, "arxiv"))
    if args.huggingface_file:
        sources.append(papers_from_file(args.huggingface_file, "huggingface"))
    if not sources:
        raise InputPrepError("Provide --input or at least one source file.")

    selected = normalize_selected(load_json(args.selected_file) if args.selected_file else None, topics)
    return {
        "date": args.date or dt.date.today().isoformat(),
        "topics": topics,
        "sources": sorted(sources, key=source_sort_key),
        "selected": selected,
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Prepare daily Paper Easy input JSON.")
    parser.add_argument("--input", help="Complete input JSON. Use '-' for stdin.")
    parser.add_argument("--date", help="YYYY-MM-DD date to write into the output.")
    parser.add_argument("--topics", help="JSON list or comma-separated topic list.")
    parser.add_argument("--arxiv-file", help="Paper Easy arXiv paper JSON/list.")
    parser.add_argument("--huggingface-file", help="Paper Easy Hugging Face paper JSON/list.")
    parser.add_argument("--selected-file", help="Selected papers JSON object/list.")
    parser.add_argument("--output", required=True, help="Output daily input JSON path.")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    topics = parse_topics(args.topics)
    try:
        if args.input:
            payload = normalize_payload(load_json(args.input), date=args.date, topics=topics)
        else:
            payload = build_from_parts(args, topics)
        output = write_json(args.output, payload)
    except Exception as exc:
        print(json.dumps({"ok": False, "error": str(exc)}, ensure_ascii=False, indent=2))
        return 1

    counts = {block["source"]: len(block.get("papers", [])) for block in payload["sources"]}
    selected = payload.get("selected")
    selected_count = sum(len(v) for v in selected.values()) if isinstance(selected, dict) else len(selected or [])
    print(
        json.dumps(
            {
                "ok": True,
                "date": payload["date"],
                "output": str(output),
                "sources": counts,
                "topics": payload["topics"],
                "selected_entries": selected_count,
            },
            ensure_ascii=False,
            indent=2,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
