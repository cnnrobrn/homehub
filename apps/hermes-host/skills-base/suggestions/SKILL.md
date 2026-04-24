---
name: suggestions
description: List, summarize, and approve/dismiss pending suggestions in the Decisions inbox. Use when the user asks "what needs my attention", "show me my inbox", or wants to approve/dismiss a proposed action. Also the canonical target when any skill needs human sign-off on a commitment.
version: 0.1.0
metadata:
  hermes:
    tags: [homehub, suggestions, approval, inbox]
    category: homehub
    requires_toolsets: [terminal]
required_environment_variables:
  - name: HOUSEHOLD_ID
  - name: HOMEHUB_SUPABASE_URL
  - name: HOMEHUB_SUPABASE_ANON_KEY
  - name: HOMEHUB_SUPABASE_JWT
---

# Suggestions

See `_shared`. Tables: `app.suggestion`, `app.action`. Every commitment
proposal lands here as `status='pending'`. Use the `homehub` CLI.

## When to Use

- Inbox queries: "what's pending?"
- Approving / dismissing a specific proposal.
- Final step of any skill that produces a commitment — write to
  `suggestion`, don't execute.

## Read pending

```bash
homehub suggestions list --status pending
homehub suggestions list --segment food --status pending
```

## Create a suggestion

```bash
homehub suggestions create \
  --segment financial \
  --kind propose_transfer \
  --title "$TITLE" \
  --rationale "$WHY" \
  --preview-json "$PREVIEW_JSON"
```

For food checkout handoffs, prefer
`kind='propose_grocery_order'`, `segment='food'`, and
`preview.provider='instacart'` when the user asks to send groceries to
Instacart. Do not call Instacart directly from the sandbox; HomeHub
server code creates the provider `external_url` after approval/configured
handoff.

## Approve / dismiss

**Never update `status` directly.** That bypasses the approval-flow
side-effects. Instead, tell the user "I can propose this; approve it
in /suggestions" — the UI triggers the action-executor queue.

## Pitfalls

- Suggestions have a TTL (`expires_at`). Filter expired rows from the
  default inbox view.
- `preview` is validated by downstream action code when executed.
  Construct payloads that match the corresponding action shape as
  closely as possible, or the executor may reject.
