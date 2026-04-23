#!/bin/bash
# Entrypoint for an E2B sandbox running one Hermes chat turn.
#
# Env set by apps/hermes-router at Sandbox.create time:
#   HOUSEHOLD_ID                    family scope
#   HERMES_STORAGE_BUCKET           Supabase Storage bucket (default: hermes-state)
#   HERMES_STORAGE_PATH             object path (e.g. <household_id>/state.tar.gz)
#   HOMEHUB_SUPABASE_URL            Supabase project URL
#   HOMEHUB_SUPABASE_ANON_KEY       public anon key (goes in apikey: header)
#   HOMEHUB_SUPABASE_JWT            household-scoped short-lived JWT — RLS
#                                   enforces that `split_part(name,'/',1)`
#                                   equals the household_id claim
#   HOMEHUB_MEMBER_MESSAGE          the member's chat message (passed as env
#                                   since E2B commands.run can't pipe stdin)
#   HERMES_SHARED_SECRET, OPENROUTER_API_KEY, HERMES_DEFAULT_MODEL,
#   HOMEHUB_CONVERSATION_ID, HOMEHUB_TURN_ID, HOMEHUB_MEMBER_ID, HOMEHUB_MEMBER_ROLE
#
# Lifecycle per turn:
#   1. Hydrate ${HERMES_HOME} from Supabase Storage (fetch and untar;
#      404 on first turn is expected and fine).
#   2. Refresh baked skills under ${HERMES_HOME}/skills/base/.
#   3. First-boot .env hydration.
#   4. Run `hermes chat` for this single turn (run_turn.py).
#   5. Persist ${HERMES_HOME} back to Supabase Storage (tar → PUT).
#   6. Exit. E2B destroys the VM.
#
# Transfer format is a single tarball per turn (not rsync). Reasoning:
#   - HomeHub state is small (MB-scale), not worth per-file round-trips.
#   - One HTTP call each way beats listing + diffing N files.
#   - Atomic snapshot semantics — either the turn's state persists or
#     it doesn't; no partial-update corruption.

set -euo pipefail

: "${HERMES_HOME:=/tmp/hermes}"
: "${HOUSEHOLD_ID:?HOUSEHOLD_ID must be set}"
: "${HERMES_STORAGE_BUCKET:=hermes-state}"
: "${HERMES_STORAGE_PATH:?HERMES_STORAGE_PATH must be set}"
: "${HOMEHUB_SUPABASE_URL:?HOMEHUB_SUPABASE_URL must be set}"
: "${HOMEHUB_SUPABASE_ANON_KEY:?HOMEHUB_SUPABASE_ANON_KEY must be set}"
: "${HOMEHUB_SUPABASE_JWT:?HOMEHUB_SUPABASE_JWT must be set}"

STORAGE_URL="${HOMEHUB_SUPABASE_URL}/storage/v1/object/${HERMES_STORAGE_BUCKET}/${HERMES_STORAGE_PATH}"

# ── Step 1: hydrate from Supabase Storage ────────────────────────────
mkdir -p "$HERMES_HOME"
# Use --fail-with-body to get non-zero on 404. Swallow the 404 — a
# household's first turn has no prior state.
HTTP_STATUS=$(curl -sS -o /tmp/state.tar.gz \
  -w '%{http_code}' \
  -H "apikey: ${HOMEHUB_SUPABASE_ANON_KEY}" \
  -H "Authorization: Bearer ${HOMEHUB_SUPABASE_JWT}" \
  "${STORAGE_URL}" || true)
if [ "${HTTP_STATUS}" = "200" ]; then
    tar xzf /tmp/state.tar.gz -C "$HERMES_HOME" || true
elif [ "${HTTP_STATUS}" = "404" ] || [ "${HTTP_STATUS}" = "400" ]; then
    : # first turn — expected
else
    echo "[entrypoint] WARNING: state hydrate returned HTTP ${HTTP_STATUS}" >&2
fi
rm -f /tmp/state.tar.gz

# ── Step 2: refresh baked skills ─────────────────────────────────────
mkdir -p \
    "$HERMES_HOME/skills" \
    "$HERMES_HOME/skills/overlay" \
    "$HERMES_HOME/sessions" \
    "$HERMES_HOME/memories" \
    "$HERMES_HOME/logs" \
    "$HERMES_HOME/cron" \
    "$HERMES_HOME/hooks"

if [ -d /opt/hermes-skills-base ]; then
    mkdir -p "$HERMES_HOME/skills/base"
    if command -v rsync >/dev/null 2>&1; then
        rsync -a --delete /opt/hermes-skills-base/ "$HERMES_HOME/skills/base/"
    else
        rm -rf "$HERMES_HOME/skills/base"
        cp -R /opt/hermes-skills-base "$HERMES_HOME/skills/base"
    fi
fi

# ── Step 3: first-boot .env hydration (preserved across turns) ───────
if [ ! -f "$HERMES_HOME/.env" ]; then
    {
        echo "# Auto-generated on first boot. Safe to edit — preserved across turns."
        [ -n "${OPENROUTER_API_KEY:-}" ]   && echo "OPENROUTER_API_KEY=${OPENROUTER_API_KEY}"
        [ -n "${HERMES_DEFAULT_MODEL:-}" ] && echo "HERMES_DEFAULT_MODEL=${HERMES_DEFAULT_MODEL}"
        [ -n "${HOMEHUB_SUPABASE_URL:-}" ] && echo "HOMEHUB_SUPABASE_URL=${HOMEHUB_SUPABASE_URL}"
        [ -n "${HOMEHUB_SUPABASE_ANON_KEY:-}" ] && \
            echo "HOMEHUB_SUPABASE_ANON_KEY=${HOMEHUB_SUPABASE_ANON_KEY}"
        echo "HOUSEHOLD_ID=${HOUSEHOLD_ID}"
    } > "$HERMES_HOME/.env"
fi

if [ ! -f "$HERMES_HOME/SOUL.md" ]; then
    cat > "$HERMES_HOME/SOUL.md" <<'SOUL'
# You are the organizer for this household.

You keep the household's life in order: calendar, money, food, people,
plans. Think of yourself as a trustworthy person who knows how this
house runs. Works for a couple, a family of five, or one person living
alone — same job, different scale.

## Voice

Short sentences. Say the thing.

No "I'd be happy to" or "Let me help you with that" — just do it, or
say why you can't. Skip "certainly", "absolutely", "great question",
"I understand", "it's important to note". Skip the opening summary and
the closing recap. If the answer is one line, it's one line.

Don't bullet-list when a sentence works. Don't hedge what you're sure
of. Don't pretend to be sure when you aren't — "I don't know who paid
that" is a better answer than a plausible guess.

Talk to a nine-year-old the way you'd talk to a nine-year-old. Talk to
a grandparent the way you'd talk to a grandparent. Don't explain things
people already know.

## How you work

Low-stakes stuff — adding to a grocery list, marking a meal planned,
noting who's picking up who — just do it and tell them you did.

Commitments — moving money, booking a reservation, cancelling a
subscription, anything that would irritate someone if it happened
without asking — go to the approvals inbox. Propose it, explain why in
one line, let a human hit confirm.

When someone's rushed, be faster. When someone's thinking out loud,
match the pace and don't push.

When you make a mistake, say so plainly and fix it. Don't apologize
three times.

## What you remember

You have memory of this household — people, places, patterns,
preferences, prior decisions. Use it. "Last time you booked a trip in
April you stayed at the Marriott" is more useful than asking them to
re-tell their preferences.

You don't have memory of other households. Every query you run goes
through this family's scope.

## This file is yours

The household can edit this to change how you sound. Speak the way they
want.
SOUL
fi

# ── Step 4/5: run the turn, then persist ─────────────────────────────
export VIRTUAL_ENV=/opt/hermes-agent/venv
export PATH="/opt/hermes-agent/venv/bin:${PATH}"

MODE="${1:-run-turn}"

case "$MODE" in
    run-turn)
        # run_turn.py also persists state to Supabase Storage on exit,
        # so we don't need to do it here. It re-reads the env vars we
        # set above.
        exec python /opt/hermes-host/server/run_turn.py
        ;;
    serve)
        exec python /opt/hermes-host/server/main.py
        ;;
    *)
        echo "unknown mode: $MODE" >&2
        exit 2
        ;;
esac
