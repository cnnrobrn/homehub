"""
Per-turn wrapper invoked inside an E2B sandbox.

Reads the member message from env ($HOMEHUB_MEMBER_MESSAGE), runs one
Hermes turn, streams structured response/thinking events to stdout,
then persists ${HERMES_HOME} back to Supabase Storage as a tarball.
"""

from __future__ import annotations

import contextlib
import inspect
import json
import os
import re
import subprocess
import sys
import tarfile
import tempfile
import threading
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any, Callable

HERMES_HOME = Path(os.environ.get("HERMES_HOME", "/tmp/hermes"))
HERMES_ROOT = Path(os.environ.get("HERMES_ROOT", "/opt/hermes-agent"))
HERMES_BIN = Path("/opt/hermes-agent/venv/bin/hermes")
STORAGE_BUCKET = os.environ.get("HERMES_STORAGE_BUCKET", "hermes-state")
STORAGE_PATH = os.environ.get("HERMES_STORAGE_PATH")
SUPABASE_URL = os.environ.get("HOMEHUB_SUPABASE_URL")
SUPABASE_ANON_KEY = os.environ.get("HOMEHUB_SUPABASE_ANON_KEY")
SUPABASE_JWT = os.environ.get("HOMEHUB_SUPABASE_JWT")
DEFAULT_MODEL = os.environ.get("HERMES_DEFAULT_MODEL", "moonshotai/kimi-k2.6")
DEFAULT_TOOLSETS = "skills,terminal"
TOOLSETS = os.environ.get("HERMES_TOOLSETS", DEFAULT_TOOLSETS)
MAX_TURNS = os.environ.get("HERMES_MAX_TURNS", "10")
MAX_CONTEXT_TURNS = int(os.environ.get("HOMEHUB_CONTEXT_TURNS", "20"))
MAX_CONTEXT_CHARS = int(os.environ.get("HOMEHUB_CONTEXT_CHARS", "12000"))
EVENT_PREFIX = "HOMEHUB_HERMES_EVENT "
EVENT_STDOUT = sys.stdout
EVENT_LOCK = threading.Lock()


def env_flag(name: str, default: bool) -> bool:
    raw = os.environ.get(name)
    if raw is None:
        return default
    return raw.strip().lower() not in {"0", "false", "no", "off"}


STREAM_THINKING = env_flag("HERMES_STREAM_THINKING", True)


def emit_event(event: dict[str, Any]) -> None:
    """Write one framed event line for the router to translate into SSE."""
    payload = json.dumps(event, ensure_ascii=False, separators=(",", ":"))
    with EVENT_LOCK:
        EVENT_STDOUT.write(f"{EVENT_PREFIX}{payload}\n")
        EVENT_STDOUT.flush()


class ThinkSplitter:
    """Split inline <think> style deltas away from visible answer text."""

    TAG_RE = re.compile(
        r"</?\s*(?:REASONING_SCRATCHPAD|think|thinking|reasoning|thought)\s*>",
        re.IGNORECASE,
    )

    def __init__(self, emit_answer: Callable[[str], None], emit_thinking: Callable[[str], None]):
        self._emit_answer = emit_answer
        self._emit_thinking = emit_thinking
        self._pending = ""
        self._in_thinking = False
        self.emitted_answer = False

    def feed(self, text: str) -> None:
        if not text:
            return
        self._pending += text
        while self._pending:
            match = self.TAG_RE.search(self._pending)
            if not match:
                last_lt = self._pending.rfind("<")
                if last_lt != -1 and ">" not in self._pending[last_lt:]:
                    chunk = self._pending[:last_lt]
                    self._pending = self._pending[last_lt:]
                else:
                    chunk = self._pending
                    self._pending = ""
                self._emit_chunk(chunk)
                return

            before = self._pending[: match.start()]
            self._emit_chunk(before)
            tag = match.group(0).strip().lower()
            self._in_thinking = not tag.startswith("</")
            self._pending = self._pending[match.end() :]

    def flush(self) -> None:
        if self._pending:
            self._emit_chunk(self._pending)
            self._pending = ""

    def _emit_chunk(self, chunk: str) -> None:
        if not chunk:
            return
        if self._in_thinking:
            if STREAM_THINKING:
                self._emit_thinking(chunk)
            return
        self.emitted_answer = True
        self._emit_answer(chunk)


def persist_state() -> None:
    """Tar ${HERMES_HOME} and upsert into Supabase Storage. Never raises."""
    tmp_path: str | None = None
    if not (STORAGE_PATH and SUPABASE_URL and SUPABASE_ANON_KEY and SUPABASE_JWT):
        print("[run_turn] WARNING: missing Storage env; state NOT persisted", file=sys.stderr)
        return
    try:
        with tempfile.NamedTemporaryFile(suffix=".tar.gz", delete=False) as tmp:
            tmp_path = tmp.name
        with tarfile.open(tmp_path, "w:gz") as tar:
            tar.add(str(HERMES_HOME), arcname=".")
        url = f"{SUPABASE_URL}/storage/v1/object/{STORAGE_BUCKET}/{STORAGE_PATH}"
        with open(tmp_path, "rb") as body:
            data = body.read()
        req = urllib.request.Request(
            url,
            data=data,
            method="PUT",
            headers={
                "apikey": SUPABASE_ANON_KEY,
                "Authorization": f"Bearer {SUPABASE_JWT}",
                "Content-Type": "application/gzip",
                "x-upsert": "true",
            },
        )
        with urllib.request.urlopen(req, timeout=30) as resp:
            if resp.status >= 300:
                print(f"[run_turn] state persist HTTP {resp.status}", file=sys.stderr)
    except urllib.error.HTTPError as e:
        print(f"[run_turn] state persist HTTP error {e.code}: {e.reason}", file=sys.stderr)
    except Exception as e:  # noqa: BLE001
        print(f"[run_turn] state persist failed: {e}", file=sys.stderr)
    finally:
        if tmp_path:
            try:
                os.unlink(tmp_path)
            except Exception:
                pass


def prepare_runtime() -> None:
    """Prepare the per-turn runtime without rewriting household config."""
    os.environ["HERMES_YOLO_MODE"] = "1"
    HERMES_HOME.mkdir(parents=True, exist_ok=True)


def filtered_kwargs(callable_obj: Callable[..., Any], kwargs: dict[str, Any]) -> dict[str, Any]:
    try:
        params = inspect.signature(callable_obj).parameters
    except Exception:
        return kwargs
    return {key: value for key, value in kwargs.items() if key in params}


def load_conversation_history() -> list[dict[str, str]]:
    raw = os.environ.get("HOMEHUB_CONVERSATION_HISTORY", "")
    if not raw.strip():
        return []
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError as exc:
        print(f"[run_turn] invalid HOMEHUB_CONVERSATION_HISTORY JSON: {exc}", file=sys.stderr)
        return []
    if not isinstance(parsed, list):
        print("[run_turn] HOMEHUB_CONVERSATION_HISTORY was not a list", file=sys.stderr)
        return []

    history: list[dict[str, str]] = []
    for item in parsed[-MAX_CONTEXT_TURNS:]:
        if not isinstance(item, dict):
            continue
        role = item.get("role")
        body = item.get("body_md")
        created_at = item.get("created_at")
        if not isinstance(role, str) or not isinstance(body, str) or not body.strip():
            continue
        history.append(
            {
                "role": role,
                "body_md": body.strip(),
                "created_at": created_at if isinstance(created_at, str) else "",
            }
        )
    return history


def role_label(role: str) -> str:
    if role == "member":
        return "member"
    if role == "assistant":
        return "alfred"
    if role == "tool":
        return "tool"
    return role[:24] or "unknown"


def clip_context_text(text: str, max_chars: int = 1600) -> str:
    clean = re.sub(r"\s+", " ", text).strip()
    if len(clean) <= max_chars:
        return clean
    return clean[: max_chars - 1].rstrip() + "…"


def build_contextual_message(message: str, history: list[dict[str, str]]) -> str:
    if not history:
        return message

    lines = [
        "[HomeHub same-thread context]",
        "Previous turns from this exact chat are below, oldest to newest.",
        "Use them to resolve short follow-ups and references. Do not answer the context itself.",
        "",
    ]
    for turn in history:
        label = role_label(turn["role"])
        lines.append(f"{label}: {clip_context_text(turn['body_md'])}")

    lines.extend(
        [
            "",
            "[Current member message]",
            message,
        ]
    )
    contextual = "\n".join(lines)
    if len(contextual) <= MAX_CONTEXT_CHARS:
        return contextual

    # Keep the newest turns when the thread is too long.
    trimmed_history = history[:]
    while trimmed_history and len(contextual) > MAX_CONTEXT_CHARS:
        trimmed_history.pop(0)
        contextual = build_contextual_message(message, trimmed_history)
    return contextual


def run_hermes_programmatic(message: str) -> int:
    """Run Hermes through its internal API so streaming callbacks stay enabled."""
    prepare_runtime()
    if str(HERMES_ROOT) not in sys.path:
        sys.path.insert(0, str(HERMES_ROOT))

    def emit_answer(delta: str) -> None:
        emit_event({"type": "token", "delta": delta})

    def emit_thinking(delta: str) -> None:
        if STREAM_THINKING:
            emit_event({"type": "thinking", "delta": delta})

    splitter = ThinkSplitter(emit_answer=emit_answer, emit_thinking=emit_thinking)

    with contextlib.redirect_stdout(sys.stderr):
        from cli import HermesCLI  # type: ignore

        ctor_kwargs = filtered_kwargs(
            HermesCLI,
            {
                "model": DEFAULT_MODEL,
                "toolsets": [t.strip() for t in TOOLSETS.split(",") if t.strip()],
                "provider": "openrouter",
                "api_key": os.environ.get("OPENROUTER_API_KEY"),
                "base_url": os.environ.get("HERMES_BASE_URL"),
                "max_turns": int(MAX_TURNS),
                "verbose": env_flag("HERMES_VERBOSE", False),
                "compact": True,
                "resume": None,
                "checkpoints": False,
                "pass_session_id": True,
                "ignore_rules": False,
                "source": "homehub",
                "yolo": True,
            },
        )
        cli = HermesCLI(**ctor_kwargs)

        ensure_credentials = getattr(cli, "_ensure_runtime_credentials", None)
        if callable(ensure_credentials) and not ensure_credentials():
            emit_event(
                {
                    "type": "error",
                    "message": "Hermes runtime credentials are not configured",
                    "code": "hermes_credentials",
                }
            )
            return 1

        turn_route: dict[str, Any] = {
            "model": DEFAULT_MODEL,
            "runtime": None,
            "request_overrides": None,
            "signature": None,
        }
        resolve_route = getattr(cli, "_resolve_turn_agent_config", None)
        if callable(resolve_route):
            resolved = resolve_route(message)
            if isinstance(resolved, dict):
                turn_route.update(resolved)
                if (
                    turn_route.get("signature")
                    and turn_route.get("signature") != getattr(cli, "_active_agent_route_signature", None)
                ):
                    cli.agent = None

        init_agent = getattr(cli, "_init_agent")
        init_kwargs = filtered_kwargs(
            init_agent,
            {
                "model_override": turn_route.get("model"),
                "runtime_override": turn_route.get("runtime"),
                "request_overrides": turn_route.get("request_overrides"),
            },
        )
        if not init_agent(**init_kwargs):
            emit_event(
                {
                    "type": "error",
                    "message": "Hermes agent initialization failed",
                    "code": "hermes_init",
                }
            )
            return 1

        agent = cli.agent
        agent.quiet_mode = True
        agent.suppress_status_output = True
        agent.stream_delta_callback = splitter.feed
        agent.reasoning_callback = emit_thinking if STREAM_THINKING else None
        agent.thinking_callback = lambda text: emit_event(
            {"type": "thinking_status", "message": text}
        ) if text else None
        agent.status_callback = lambda text: emit_event({"type": "status", "message": text})
        agent.tool_gen_callback = lambda tool: emit_event(
            {"type": "tool_generation", "tool": tool}
        )

        history = load_conversation_history()
        result = agent.run_conversation(
            user_message=build_contextual_message(message, history),
            conversation_history=getattr(cli, "conversation_history", []),
        )

    splitter.flush()
    final_response = result.get("final_response", "") if isinstance(result, dict) else str(result)
    if final_response and not splitter.emitted_answer:
        splitter.feed(final_response)
        splitter.flush()
    if isinstance(result, dict) and result.get("failed"):
        return 1
    return 0


def run_cli_fallback(message: str) -> int:
    contextual_message = build_contextual_message(message, load_conversation_history())
    args = [
        str(HERMES_BIN),
        "chat",
        "-Q",
        "--provider",
        "openrouter",
        "--model",
        DEFAULT_MODEL,
        "--toolsets",
        TOOLSETS,
        "--pass-session-id",
        "--source",
        "homehub",
        "--max-turns",
        MAX_TURNS,
        "--yolo",
        "-q",
        contextual_message,
    ]

    override = os.environ.get("HERMES_CLI_ARGS")
    if override:
        args = [str(HERMES_BIN), *json.loads(override)]

    proc = subprocess.Popen(
        args,
        stdin=subprocess.DEVNULL,
        stdout=EVENT_STDOUT.fileno(),
        stderr=sys.stderr.fileno(),
        env=os.environ.copy(),
    )
    return proc.wait()


def main() -> int:
    message = os.environ.get("HOMEHUB_MEMBER_MESSAGE", "") or sys.stdin.read()
    if not message.strip():
        print("[run_turn] empty message (HOMEHUB_MEMBER_MESSAGE and stdin both empty)", file=sys.stderr)
        return 2

    try:
        rc = run_hermes_programmatic(message)
    except Exception as e:  # noqa: BLE001
        print(f"[run_turn] programmatic Hermes failed, falling back to CLI: {e}", file=sys.stderr)
        rc = run_cli_fallback(message)
    finally:
        persist_state()

    return rc


if __name__ == "__main__":
    sys.exit(main())
