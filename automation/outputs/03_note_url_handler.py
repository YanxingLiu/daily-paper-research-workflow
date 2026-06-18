#!/usr/bin/env python3
"""Install and handle macOS URL callbacks for on-demand Zotero note generation.

The generated Daily Papers Markdown links use URLs such as:

    daily-paper-note://generate?date=2026-06-18&item=TNKKSN5C&prompt=Summarize

macOS dispatches that URL to a tiny AppleScript app installed by this script.
The app launches this handler once, and the handler starts
``05_generate_zotero_note_on_demand.py`` in the background for the requested
single Zotero item and prompt. No localhost daemon is required.
"""

from __future__ import annotations

import argparse
import json
import os
import plistlib
import re
import shutil
import subprocess
import sys
import urllib.parse
from dataclasses import dataclass
from pathlib import Path
from typing import Any


BASE_DIR = Path(__file__).resolve().parents[1]
WORK_DIR = BASE_DIR / "work"
DEFAULT_SCHEME = "daily-paper-note"
DEFAULT_APP_PATH = Path.home() / "Applications" / "DailyPaperNote.app"
DEFAULT_PROMPTS_DIR = BASE_DIR / "llm-for-zotero"
DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
ZOTERO_ITEM_KEY_RE = re.compile(r"^[A-Z0-9]{8}$")


@dataclass(frozen=True)
class NoteRequest:
    date: str
    item_key: str
    prompt_name: str
    force: bool = False
    overwrite_existing: bool = False


def safe_slug(value: str) -> str:
    return re.sub(r"[^A-Za-z0-9._-]+", "-", value.strip()).strip("-") or "value"


def load_json(path: Path) -> dict[str, Any] | None:
    if not path.exists():
        return None
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return None
    return value if isinstance(value, dict) else None


def prompt_exists(prompts_dir: Path, prompt_name: str) -> bool:
    return any(path.is_file() and path.stem == prompt_name for path in prompts_dir.rglob("*.txt"))


def resolve_prompts_dir(value: str | Path) -> Path:
    path = Path(value).expanduser()
    if not path.is_absolute():
        path = BASE_DIR / path
    return path.resolve()


def job_paths(date: str, item_key: str, prompt_name: str) -> tuple[str, Path, Path, Path, Path]:
    slug = safe_slug(f"{date}-{item_key}-{prompt_name}")
    return (
        slug,
        WORK_DIR / f"on_demand_note_{slug}.summary.json",
        WORK_DIR / f"on_demand_note_{slug}.log",
        WORK_DIR / f"on_demand_note_task_{slug}.jsonl",
        WORK_DIR / f"on_demand_note_{slug}.pid",
    )


def pid_is_running(pid_path: Path) -> tuple[bool, int | None]:
    if not pid_path.exists():
        return False, None
    try:
        pid = int(pid_path.read_text(encoding="utf-8").strip())
    except Exception:
        return False, None
    if pid <= 0:
        return False, pid
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False, pid
    except PermissionError:
        return True, pid
    return True, pid


def parse_note_url(url: str, expected_scheme: str) -> NoteRequest:
    parsed = urllib.parse.urlparse(url)
    if parsed.scheme != expected_scheme:
        raise ValueError(f"Unexpected URL scheme: {parsed.scheme!r}; expected {expected_scheme!r}.")

    action = parsed.netloc or parsed.path.strip("/").split("/", 1)[0]
    if action != "generate":
        raise ValueError(f"Unexpected URL action: {action!r}; expected 'generate'.")

    query = urllib.parse.parse_qs(parsed.query)

    def first(name: str) -> str:
        values = query.get(name)
        return values[0].strip() if values else ""

    date = first("date")
    item_key = first("item").upper()
    prompt_name = first("prompt")
    return NoteRequest(
        date=date,
        item_key=item_key,
        prompt_name=prompt_name,
        force=first("force") == "1",
        overwrite_existing=first("overwrite") == "1",
    )


def validate_request(request: NoteRequest, prompts_dir: Path) -> dict[str, str]:
    errors: dict[str, str] = {}
    if not DATE_RE.match(request.date):
        errors["date"] = "Expected YYYY-MM-DD."
    if not ZOTERO_ITEM_KEY_RE.match(request.item_key):
        errors["item"] = "Expected an 8-character Zotero item key."
    if not request.prompt_name:
        errors["prompt"] = "Missing prompt file stem."
    elif not prompt_exists(prompts_dir, request.prompt_name):
        errors["prompt"] = f"Prompt not found under {prompts_dir}: {request.prompt_name}"
    sync_report = WORK_DIR / f"zotero_sync_{request.date}.json"
    if not sync_report.exists():
        errors["sync_report"] = f"Missing sync report: {sync_report}"
    return errors


def notify(title: str, message: str, enabled: bool) -> None:
    if not enabled:
        return
    script = (
        "display notification "
        + json.dumps(message, ensure_ascii=False)
        + " with title "
        + json.dumps(title, ensure_ascii=False)
    )
    subprocess.run(["osascript", "-e", script], check=False, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def start_generation(
    request: NoteRequest,
    *,
    prompts_dir: Path,
    codex_timeout: float,
    notify_user: bool,
) -> dict[str, Any]:
    WORK_DIR.mkdir(parents=True, exist_ok=True)
    job_key, summary_path, log_path, tasks_path, pid_path = job_paths(
        request.date,
        request.item_key,
        request.prompt_name,
    )

    running, pid = pid_is_running(pid_path)
    if running:
        payload = {
            "ok": True,
            "status": "already_running",
            "job": job_key,
            "pid": pid,
            "summary_path": str(summary_path),
            "log_path": str(log_path),
        }
        notify("Daily Paper Note", f"{request.prompt_name} is already running for {request.item_key}.", notify_user)
        return payload

    existing_summary = load_json(summary_path)
    if existing_summary and existing_summary.get("ok") and not request.force and not request.overwrite_existing:
        payload = {
            "ok": True,
            "status": "already_completed",
            "job": job_key,
            "summary_path": str(summary_path),
            "summary": existing_summary,
        }
        notify("Daily Paper Note", f"{request.prompt_name} already exists for {request.item_key}.", notify_user)
        return payload

    command = [
        sys.executable,
        "outputs/05_generate_zotero_note_on_demand.py",
        "--date",
        request.date,
        "--sync-report",
        str(WORK_DIR / f"zotero_sync_{request.date}.json"),
        "--prompts-dir",
        str(prompts_dir),
        "--item-key",
        request.item_key,
        "--prompt-name",
        request.prompt_name,
        "--tasks-out",
        str(tasks_path),
        "--checkpoint",
        str(WORK_DIR / f"zotero_note_checkpoint_{request.date}.jsonl"),
        "--workers",
        "1",
        "--codex-timeout",
        str(codex_timeout),
    ]
    if request.overwrite_existing:
        command.append("--overwrite-existing")

    with summary_path.open("w", encoding="utf-8") as stdout, log_path.open("a", encoding="utf-8") as stderr:
        process = subprocess.Popen(
            command,
            cwd=BASE_DIR,
            stdout=stdout,
            stderr=stderr,
            text=True,
            start_new_session=True,
        )
    pid_path.write_text(f"{process.pid}\n", encoding="utf-8")

    payload = {
        "ok": True,
        "status": "started",
        "job": job_key,
        "pid": process.pid,
        "summary_path": str(summary_path),
        "log_path": str(log_path),
        "task_path": str(tasks_path),
        "command": command,
    }
    notify("Daily Paper Note", f"Started {request.prompt_name} for {request.item_key}.", notify_user)
    return payload


def install_url_handler(
    *,
    app_path: Path,
    python_bin: str,
    scheme: str,
) -> dict[str, Any]:
    app_path = app_path.expanduser().resolve()
    app_path.parent.mkdir(parents=True, exist_ok=True)

    handler_path = Path(__file__).resolve()
    executable_name = "DailyPaperNote"
    contents_dir = app_path / "Contents"
    macos_dir = contents_dir / "MacOS"
    resources_dir = contents_dir / "Resources"
    executable_path = macos_dir / executable_name
    swift_source_path = resources_dir / "DailyPaperNote.swift"
    plist = contents_dir / "Info.plist"

    if app_path.exists():
        shutil.rmtree(app_path)
    macos_dir.mkdir(parents=True, exist_ok=True)
    resources_dir.mkdir(parents=True, exist_ok=True)

    swift_source = f"""
import Cocoa

let repoPath = {json.dumps(str(BASE_DIR), ensure_ascii=False)}
let pythonPath = {json.dumps(str(Path(python_bin).resolve()), ensure_ascii=False)}
let handlerPath = {json.dumps(str(handler_path), ensure_ascii=False)}
let logPath = {json.dumps(str(WORK_DIR / "note_url_handler_app.log"), ensure_ascii=False)}

func shellQuote(_ value: String) -> String {{
    return "'" + value.replacingOccurrences(of: "'", with: "'\\\\''") + "'"
}}

func appleScriptString(_ value: String) -> String {{
    let escaped = value
        .replacingOccurrences(of: "\\\\", with: "\\\\\\\\")
        .replacingOccurrences(of: "\\"", with: "\\\\\\"")
        .replacingOccurrences(of: "\\n", with: "\\\\n")
    return "\\"" + escaped + "\\""
}}

func launchTerminal(urlText: String) {{
    let command = "cd \\(shellQuote(repoPath)) && \\(shellQuote(pythonPath)) \\(shellQuote(handlerPath)) \\(shellQuote(urlText)) --notify >> \\(shellQuote(logPath)) 2>&1; exit"
    let script = "tell application \\"Terminal\\"\\n    do script \\(appleScriptString(command))\\nend tell"
    let process = Process()
    process.executableURL = URL(fileURLWithPath: "/usr/bin/osascript")
    process.arguments = ["-e", script]
    try? process.run()
}}

final class AppDelegate: NSObject, NSApplicationDelegate {{
    private var handledURL = false

    func applicationWillFinishLaunching(_ notification: Notification) {{
        NSAppleEventManager.shared().setEventHandler(
            self,
            andSelector: #selector(handleGetURLEvent(_:withReplyEvent:)),
            forEventClass: AEEventClass(kInternetEventClass),
            andEventID: AEEventID(kAEGetURL)
        )
    }}

    func applicationDidFinishLaunching(_ notification: Notification) {{
        DispatchQueue.main.asyncAfter(deadline: .now() + 2.0) {{
            if !self.handledURL {{
                NSApp.terminate(nil)
            }}
        }}
    }}

    @objc func handleGetURLEvent(_ event: NSAppleEventDescriptor, withReplyEvent replyEvent: NSAppleEventDescriptor) {{
        handledURL = true
        if let urlText = event.paramDescriptor(forKeyword: AEKeyword(keyDirectObject))?.stringValue {{
            launchTerminal(urlText: urlText)
        }}
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) {{
            NSApp.terminate(nil)
        }}
    }}
}}

let app = NSApplication.shared
let delegate = AppDelegate()
app.setActivationPolicy(.accessory)
app.delegate = delegate
app.run()
"""
    swift_source_path.write_text(swift_source, encoding="utf-8")

    info_plist: dict[str, Any] = {
        "CFBundleDevelopmentRegion": "en",
        "CFBundleExecutable": executable_name,
        "CFBundleIdentifier": "com.local.daily-paper-note",
        "CFBundleInfoDictionaryVersion": "6.0",
        "CFBundleName": "DailyPaperNote",
        "CFBundlePackageType": "APPL",
        "CFBundleShortVersionString": "1.0",
        "CFBundleVersion": "1",
        "CFBundleURLTypes": [
            {
                "CFBundleTypeRole": "Viewer",
                "CFBundleURLName": "Daily Paper Note",
                "CFBundleURLSchemes": [scheme],
                "LSHandlerRank": "Owner",
            }
        ],
        "LSMinimumSystemVersion": "12.0",
        "LSUIElement": True,
        "NSAppleEventsUsageDescription": "DailyPaperNote uses Terminal to start on-demand Zotero note generation.",
    }
    with plist.open("wb") as handle:
        plistlib.dump(info_plist, handle, sort_keys=True)

    subprocess.run(
        ["swiftc", str(swift_source_path), "-o", str(executable_path), "-framework", "Cocoa"],
        check=True,
    )
    executable_path.chmod(0o755)
    subprocess.run(["codesign", "--force", "--deep", "--sign", "-", str(app_path)], check=False)

    lsregister = (
        "/System/Library/Frameworks/CoreServices.framework/Frameworks/"
        "LaunchServices.framework/Support/lsregister"
    )
    subprocess.run([lsregister, "-f", str(app_path)], check=True)
    return {
        "ok": True,
        "scheme": scheme,
        "app_path": str(app_path),
        "handler_path": str(handler_path),
        "python_bin": str(Path(python_bin).resolve()),
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Install or handle daily-paper-note:// URL callbacks.")
    parser.add_argument("url", nargs="?", help="daily-paper-note://generate?... URL to handle.")
    parser.add_argument("--install", action="store_true", help="Install/register the macOS URL handler app.")
    parser.add_argument("--app-path", default=str(DEFAULT_APP_PATH), help="Path for the generated .app bundle.")
    parser.add_argument("--python-bin", default=sys.executable, help="Python executable embedded in the .app handler.")
    parser.add_argument("--scheme", default=DEFAULT_SCHEME, help="URL scheme to register and handle.")
    parser.add_argument("--prompts-dir", default=str(DEFAULT_PROMPTS_DIR), help="Directory containing prompt .txt files.")
    parser.add_argument("--codex-timeout", type=float, default=900.0)
    parser.add_argument("--notify", action="store_true", help="Show a macOS notification for click-triggered jobs.")
    return parser.parse_args()


def main() -> int:
    args = parse_args()

    if args.install:
        payload = install_url_handler(
            app_path=Path(args.app_path),
            python_bin=args.python_bin,
            scheme=args.scheme,
        )
        print(json.dumps(payload, ensure_ascii=False, indent=2))
        return 0

    if not args.url:
        raise SystemExit("Provide a URL to handle, or pass --install to register the handler app.")

    prompts_dir = resolve_prompts_dir(args.prompts_dir)
    try:
        request = parse_note_url(args.url, args.scheme)
        errors = validate_request(request, prompts_dir)
        if errors:
            payload = {"ok": False, "errors": errors}
            notify("Daily Paper Note", "Invalid note generation link. See handler output.", args.notify)
            print(json.dumps(payload, ensure_ascii=False, indent=2))
            return 2
        payload = start_generation(
            request,
            prompts_dir=prompts_dir,
            codex_timeout=args.codex_timeout,
            notify_user=args.notify,
        )
        print(json.dumps(payload, ensure_ascii=False, indent=2))
        return 0
    except Exception as exc:
        payload = {"ok": False, "error": str(exc)}
        notify("Daily Paper Note", "Failed to handle note generation link.", args.notify)
        print(json.dumps(payload, ensure_ascii=False, indent=2))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
