"""
HTTP wrapper around a local Hermes Agent installation.

Routed traffic: hermes-router (always-on Railway service) -> this service
(per-household Railway service) -> into Hermes internals.

Contract:
  POST /chat/stream   SSE stream of agent events for one turn
  GET  /health        liveness probe for Railway health checks + router

The router authenticates with a shared secret (HERMES_SHARED_SECRET) so
every family's service only accepts traffic from the router, never
directly from the public internet. Railway injects the secret via env.

Hermes is invoked by spawning `hermes` as a subprocess in "single-turn"
mode and piping the member message in; output lines are parsed and
re-emitted as SSE events. We do this instead of importing `hermes_cli`
as a library because:
  - Hermes's public surface is a CLI, not a stable Python API; coupling
    to internals would break on upgrade.
  - Subprocess isolation means a crash in one turn does not take down
    the whole service.
  - Hermes already owns its own session/memory state under
    ${HERMES_HOME}; we just hand it a turn.

The subprocess's stdout is line-delimited JSON (hermes --format json);
each line becomes one SSE event. Errors go to a terminal `error` event.
"""

from __future__ import annotations

import asyncio
import json
import os
import secrets
from pathlib import Path
from typing import AsyncIterator

from fastapi import FastAPI, Header, HTTPException, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
from sse_starlette.sse import EventSourceResponse

from run_turn import build_contextual_message

HERMES_HOME = Path(os.environ.get("HERMES_HOME", "/tmp/hermes"))
HERMES_BIN = Path("/opt/hermes-agent/venv/bin/hermes")
SHARED_SECRET = os.environ.get("HERMES_SHARED_SECRET", "")
HOUSEHOLD_ID = os.environ.get("HOUSEHOLD_ID", "")

app = FastAPI(title="hermes-host", version="0.1.0")


class ConversationHistoryTurn(BaseModel):
    role: str = Field(..., min_length=1)
    body_md: str = Field(..., min_length=1)
    created_at: str = Field("")


class ChatTurnRequest(BaseModel):
    conversation_id: str = Field(..., min_length=1)
    turn_id: str = Field(..., min_length=1)
    member_id: str = Field(..., min_length=1)
    message: str = Field(..., min_length=1, max_length=8000)
    member_role: str = Field("adult")
    conversation_history: list[ConversationHistoryTurn] = Field(default_factory=list)


def _require_router(auth_header: str | None) -> None:
    """Accept traffic only from our router (or anyone with the secret)."""
    if not SHARED_SECRET:
        raise HTTPException(500, "HERMES_SHARED_SECRET not configured")
    if not auth_header or not auth_header.startswith("Bearer "):
        raise HTTPException(401, "missing bearer")
    presented = auth_header.removeprefix("Bearer ").strip()
    if not secrets.compare_digest(presented, SHARED_SECRET):
        raise HTTPException(401, "bad secret")


@app.get("/health")
async def health() -> JSONResponse:
    ok = HERMES_BIN.exists() and HERMES_HOME.exists()
    return JSONResponse(
        {
            "ok": ok,
            "household_id": HOUSEHOLD_ID,
            "hermes_home": str(HERMES_HOME),
        },
        status_code=200 if ok else 503,
    )


async def _stream_turn(body: ChatTurnRequest) -> AsyncIterator[dict]:
    """Spawn a one-shot Hermes CLI turn and yield SSE events as it runs.

    CLI contract (confirmed from the Hermes docs at
    hermes-agent.nousresearch.com/docs/reference/cli-commands):

      hermes chat \\
          -q "<message>"              # one-shot non-interactive prompt
          -Q                           # quiet: no banner/spinner/previews
          --provider openrouter        # force OpenRouter (we set API key
                                       # in the .env, Hermes picks it up)
          --model $HERMES_DEFAULT_MODEL
          --toolsets skills            # enable skills + whatever else
          --continue homehub-<conv_id> # resume session by name
          --pass-session-id            # put the session id in the system
                                       # prompt so skills can correlate
          --source homehub             # session-source tag for filtering
          --max-turns 10               # bound tool-calling iterations
          --yolo                       # skip approval prompts (we run
                                       # headless; approvals aren't
                                       # answerable from stdin here)

    With -Q the CLI prints only the response text to stdout. We stream
    it line-for-line as `agent_line` events and mark end with `done`.
    Override the exact invocation via HERMES_CLI_ARGS (JSON list) if
    the upstream CLI changes flags without an image rebuild.
    """
    env = os.environ.copy()
    env["HERMES_HOME"] = str(HERMES_HOME)
    env["HOMEHUB_CONVERSATION_ID"] = body.conversation_id
    env["HOMEHUB_TURN_ID"] = body.turn_id
    env["HOMEHUB_MEMBER_ID"] = body.member_id
    env["HOMEHUB_MEMBER_ROLE"] = body.member_role
    history = [turn.model_dump() for turn in body.conversation_history]
    env["HOMEHUB_CONVERSATION_HISTORY"] = json.dumps(history)
    contextual_message = build_contextual_message(body.message, history)

    default_model = os.environ.get("HERMES_DEFAULT_MODEL", "moonshotai/kimi-k2.6")
    toolsets = os.environ.get("HERMES_TOOLSETS", "skills")
    max_turns = os.environ.get("HERMES_MAX_TURNS", "10")
    override = os.environ.get("HERMES_CLI_ARGS")
    if override:
        args = json.loads(override)
    else:
        args = [
            "chat",
            "-Q",
            "--provider", "openrouter",
            "--model", default_model,
            "--toolsets", toolsets,
            "--pass-session-id",
            "--source", "homehub",
            "--max-turns", max_turns,
            "--yolo",
            "-q", contextual_message,
        ]

    proc = await asyncio.create_subprocess_exec(
        str(HERMES_BIN),
        *args,
        env=env,
        stdin=asyncio.subprocess.DEVNULL,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    assert proc.stdout and proc.stderr

    yield {"event": "start", "data": json.dumps({"turn_id": body.turn_id})}

    while True:
        line = await proc.stdout.readline()
        if not line:
            break
        text = line.decode("utf-8", errors="replace").rstrip("\n")
        if not text:
            continue
        try:
            parsed = json.loads(text)
            yield {"event": "agent_event", "data": json.dumps(parsed)}
        except json.JSONDecodeError:
            yield {"event": "agent_line", "data": json.dumps({"text": text})}

    rc = await proc.wait()
    stderr_bytes = await proc.stderr.read()
    if rc != 0:
        yield {
            "event": "error",
            "data": json.dumps(
                {
                    "returncode": rc,
                    "stderr": stderr_bytes.decode("utf-8", errors="replace")[:4000],
                }
            ),
        }
    yield {"event": "done", "data": json.dumps({"returncode": rc})}


@app.post("/chat/stream")
async def chat_stream(
    body: ChatTurnRequest,
    request: Request,
    authorization: str | None = Header(default=None),
) -> EventSourceResponse:
    _require_router(authorization)
    return EventSourceResponse(_stream_turn(body))
