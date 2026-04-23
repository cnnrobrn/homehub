# HomeHub common skills (baked into the per-household Hermes image)

Every skill in this directory is copied into every family's
`${HERMES_HOME}/skills/base/` on container boot, then refreshed on every
restart. Per-family overlays live at `${HERMES_HOME}/skills/overlay/` and
are never touched by the image.

Skill format mirrors upstream Hermes Agent
(`github.com/NousResearch/hermes-agent/skills/`). Populate this directory
after the first local Hermes install reveals the expected schema. For
each HomeHub section there is a matching Claude Code skill at
`.claude/skills/<section>-section/` — the intent and surface overlap; the
Hermes skill is the runtime tool for the chat agent, the Claude Code
skill is the dev-time playbook for whoever's editing the code.
