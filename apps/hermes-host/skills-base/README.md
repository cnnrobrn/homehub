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

The shared reference in `_shared/README.md` is part of the default
template every generic skill can use. It includes the food pantry →
grocery list → Instacart handoff rule: agents may manage HomeHub meal,
pantry, and grocery-list data, but Instacart checkout links are created
by HomeHub server code with the app API key and opened by the user on
Instacart.
