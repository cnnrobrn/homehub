"""
Per-turn wrapper invoked inside an E2B sandbox.

Reads the member message from env ($HOMEHUB_MEMBER_MESSAGE), invokes
`hermes chat` with the confirmed non-interactive flag set, streams
stdout to the process's stdout (which the E2B SDK's onStdout callback
relays back to the router), then persists ${HERMES_HOME} back to
Supabase Storage as a single tarball.
"""

from __future__ import annotations

import os
import subprocess
import sys
import tarfile
import tempfile
import urllib.request
import urllib.error
from pathlib import Path

HERMES_HOME = Path(os.environ.get("HERMES_HOME", "/root/.hermes"))
HERMES_BIN = Path("/opt/hermes-agent/venv/bin/hermes")
STORAGE_BUCKET = os.environ.get("HERMES_STORAGE_BUCKET", "hermes-state")
STORAGE_PATH = os.environ.get("HERMES_STORAGE_PATH")
SUPABASE_URL = os.environ.get("HOMEHUB_SUPABASE_URL")
SUPABASE_ANON_KEY = os.environ.get("HOMEHUB_SUPABASE_ANON_KEY")
SUPABASE_JWT = os.environ.get("HOMEHUB_SUPABASE_JWT")
CONV_ID = os.environ.get("HOMEHUB_CONVERSATION_ID", "")
DEFAULT_MODEL = os.environ.get("HERMES_DEFAULT_MODEL", "moonshotai/kimi-k2.6")
TOOLSETS = os.environ.get("HERMES_TOOLSETS", "skills")
MAX_TURNS = os.environ.get("HERMES_MAX_TURNS", "10")


def persist_state() -> None:
    """Tar ${HERMES_HOME} and upsert into Supabase Storage. Never raises."""
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
        try:
            os.unlink(tmp_path)
        except Exception:
            pass


def main() -> int:
    # Prefer env-passed message (E2B); stdin fallback for local / legacy.
    message = os.environ.get("HOMEHUB_MEMBER_MESSAGE", "") or sys.stdin.read()
    if not message.strip():
        print("[run_turn] empty message (HOMEHUB_MEMBER_MESSAGE and stdin both empty)", file=sys.stderr)
        return 2

    args = [
        str(HERMES_BIN),
        "chat",
        "-Q",
        "--provider", "openrouter",
        "--model", DEFAULT_MODEL,
        "--toolsets", TOOLSETS,
        "--continue", f"homehub-{CONV_ID}",
        "--pass-session-id",
        "--source", "homehub",
        "--max-turns", MAX_TURNS,
        "--yolo",
        "-q", message,
    ]

    override = os.environ.get("HERMES_CLI_ARGS")
    if override:
        import json
        args = [str(HERMES_BIN), *json.loads(override)]

    try:
        proc = subprocess.Popen(
            args,
            stdin=subprocess.DEVNULL,
            stdout=sys.stdout.fileno(),
            stderr=sys.stderr.fileno(),
            env=os.environ.copy(),
        )
        rc = proc.wait()
    finally:
        persist_state()

    return rc


if __name__ == "__main__":
    sys.exit(main())
