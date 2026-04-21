#!/usr/bin/env bash
#
# cmux-launch.sh — staged launch of HomeHub agents in cmux windows.
#
# Usage:
#   ./scripts/cmux-launch.sh 1       # coordinator only
#   ./scripts/cmux-launch.sh 2       # add infra-platform
#   ./scripts/cmux-launch.sh 3       # add integrations, memory-background, frontend-chat
#   ./scripts/cmux-launch.sh all     # all five at once (not recommended before M0)
#
# Each stage is additive and idempotent — re-running a stage is safe.
#
# ──────────────────────────────────────────────────────────────────────
# cmux command syntax note
# ──────────────────────────────────────────────────────────────────────
# cmux CLI flags vary by distribution. This script tries a common pattern
# first (`cmux new-window --name <n> --cwd <dir> --cmd '<cmd>'`) and falls
# back to a tmux-style `new-window` + `send-keys` combination. If your
# cmux is different, edit CMUX_NEW_WINDOW below — everything else is
# agnostic.
# ──────────────────────────────────────────────────────────────────────

set -euo pipefail

# ─── config ────────────────────────────────────────────────────────────

STAGE="${1:-1}"

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPO_NAME="$(basename "${REPO_ROOT}")"
AGENTS_DIR="${REPO_ROOT}/scripts/agents"
TASKS_DIR="${REPO_ROOT}/tasks"

# Worktrees live at a sibling of the repo, not inside it.
WORKTREES_ROOT="$(dirname "${REPO_ROOT}")/${REPO_NAME}-worktrees"

SESSION_NAME="${SESSION_NAME:-homehub}"
CLAUDE_BIN="${CLAUDE_BIN:-claude}"
CMUX_BIN="${CMUX_BIN:-cmux}"

# Permission-mode flag for Claude Code. Combined with .claude/settings.json
# this should keep the prompt storm manageable without skipping safety.
CLAUDE_FLAGS="${CLAUDE_FLAGS:---permission-mode acceptEdits}"

# ─── helpers ───────────────────────────────────────────────────────────

die()   { printf '\033[31m✗ %s\033[0m\n' "$*" >&2; exit 1; }
info()  { printf '\033[36m▸ %s\033[0m\n' "$*"; }
ok()    { printf '\033[32m✓ %s\033[0m\n' "$*"; }
warn()  { printf '\033[33m! %s\033[0m\n' "$*" >&2; }

need()  {
  command -v "$1" >/dev/null 2>&1 || die "Missing required command: $1"
}

# CMUX_NEW_WINDOW <name> <cwd> <command-to-run>
CMUX_NEW_WINDOW() {
  local name="$1" cwd="$2" cmd="$3"

  # Skip if the window already exists (idempotent).
  if "${CMUX_BIN}" list-windows -t "${SESSION_NAME}" 2>/dev/null | grep -q "^[0-9]*:.*${name}"; then
    warn "Window '${name}' already exists in session '${SESSION_NAME}' — skipping."
    return 0
  fi

  # Variant 1: explicit flags (common in newer cmux forks).
  if "${CMUX_BIN}" new-window \
        --session "${SESSION_NAME}" \
        --name "${name}" \
        --cwd "${cwd}" \
        --cmd "${cmd}" 2>/dev/null; then
    return 0
  fi

  # Variant 2: tmux-style (cmux derived from tmux).
  "${CMUX_BIN}" new-window -t "${SESSION_NAME}" -n "${name}" -c "${cwd}" \
    && "${CMUX_BIN}" send-keys -t "${SESSION_NAME}:${name}" "${cmd}" Enter
}

# Build the command that starts a Claude Code agent with a briefing.
agent_cmd() {
  local briefing="$1"
  printf '%s %s --prompt-file %q' "${CLAUDE_BIN}" "${CLAUDE_FLAGS}" "${briefing}"
}

# Ensure a worktree exists for a specialist.
ensure_worktree() {
  local agent="$1"
  local branch="agent/${agent}"
  local wt_dir="${WORKTREES_ROOT}/${agent}"

  mkdir -p "${WORKTREES_ROOT}"

  # Already exists?
  if [[ -d "${wt_dir}/.git" ]] || git -C "${REPO_ROOT}" worktree list --porcelain | grep -q "^worktree ${wt_dir}$"; then
    info "Worktree for ${agent} already exists at ${wt_dir}."
    return 0
  fi

  # Does the branch exist locally? Create from main if not.
  if ! git -C "${REPO_ROOT}" show-ref --verify --quiet "refs/heads/${branch}"; then
    info "Creating branch ${branch} from main…"
    git -C "${REPO_ROOT}" branch "${branch}" main
  fi

  info "Adding worktree ${wt_dir} on ${branch}…"
  git -C "${REPO_ROOT}" worktree add "${wt_dir}" "${branch}"
}

# Ensure the cmux session exists.
ensure_session() {
  if ! "${CMUX_BIN}" has-session -t "${SESSION_NAME}" 2>/dev/null; then
    info "Creating cmux session '${SESSION_NAME}'…"
    "${CMUX_BIN}" new-session -d -s "${SESSION_NAME}" -c "${REPO_ROOT}"
  fi
}

# ─── preflight ─────────────────────────────────────────────────────────

need "${CMUX_BIN}"
need "${CLAUDE_BIN}"
need git

[[ -d "${AGENTS_DIR}" ]] || die "Missing ${AGENTS_DIR}"
[[ -d "${TASKS_DIR}"  ]] || die "Missing ${TASKS_DIR}"
[[ -d "${REPO_ROOT}/.git" ]] || die "Not a git repository. Run \`git init\` from the repo root first (or let the coordinator bootstrap it)."

for f in coordinator.md infra-platform.md integrations.md memory-background.md frontend-chat.md OPERATIONS.md; do
  [[ -f "${AGENTS_DIR}/${f}" ]] || die "Missing briefing: ${AGENTS_DIR}/${f}"
done

# ─── stage launchers ───────────────────────────────────────────────────

launch_coordinator() {
  info "Stage 1 — coordinator"
  ensure_session

  # The coordinator works on main, in the repo root — no worktree.
  CMUX_NEW_WINDOW "coordinator" "${REPO_ROOT}" "$(agent_cmd "${AGENTS_DIR}/coordinator.md")"
  ok "coordinator window spawned."
  echo
  echo "→ Attach:  ${CMUX_BIN} attach -t ${SESSION_NAME}"
  echo "→ When the coordinator reports \"M0 ready for dispatch\" in tasks/review.md, run:"
  echo "    ./scripts/cmux-launch.sh 2"
}

launch_infra_platform() {
  info "Stage 2 — add infra-platform"
  ensure_session
  ensure_worktree "infra-platform"

  CMUX_NEW_WINDOW "infra-platform" "${WORKTREES_ROOT}/infra-platform" \
    "$(agent_cmd "${AGENTS_DIR}/infra-platform.md")"
  ok "infra-platform window spawned."
  echo
  echo "→ Specialist works on branch agent/infra-platform in ${WORKTREES_ROOT}/infra-platform"
  echo "→ Hand-off via PR; coordinator reviews on main."
  echo "→ When M0 is \"all [x]\" in tasks/todo.md, run:"
  echo "    ./scripts/cmux-launch.sh 3"
}

launch_remaining() {
  info "Stage 3 — add integrations, memory-background, frontend-chat"
  ensure_session

  for agent in integrations memory-background frontend-chat; do
    ensure_worktree "${agent}"
    CMUX_NEW_WINDOW "${agent}" "${WORKTREES_ROOT}/${agent}" \
      "$(agent_cmd "${AGENTS_DIR}/${agent}.md")"
    ok "${agent} window spawned."
  done

  echo
  echo "→ All specialists are live. Coordinator reviews PRs on main."
  echo "→ Watch cmux: ${CMUX_BIN} attach -t ${SESSION_NAME}"
}

# ─── dispatch ──────────────────────────────────────────────────────────

case "${STAGE}" in
  1)   launch_coordinator ;;
  2)   launch_infra_platform ;;
  3)   launch_remaining ;;
  all) launch_coordinator
       launch_infra_platform
       launch_remaining ;;
  *)   die "Unknown stage: ${STAGE} (use 1, 2, 3, or all)" ;;
esac
