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

See `_shared`. Tables: `app.suggestion`, `app.action`. Every `draft-write`
agent action lands here as `status='pending'`.

## When to Use

- Inbox queries: "what's pending?"
- Approving / dismissing a specific proposal.
- Final step of any skill that produces a commitment — write to
  `suggestion`, don't execute.

## Read pending

```bash
curl -fsSL \
  -H "apikey: $HOMEHUB_SUPABASE_ANON_KEY" \
  -H "Authorization: Bearer $HOMEHUB_SUPABASE_JWT" \
  -H "Accept-Profile: app" \
  "$HOMEHUB_SUPABASE_URL/rest/v1/suggestion?household_id=eq.$HOUSEHOLD_ID&status=eq.pending&expires_at=gt.$(date -u +%FT%TZ)&order=created_at.desc"
```

## Create a suggestion

```bash
curl -fsSL -X POST \
  -H "apikey: $HOMEHUB_SUPABASE_ANON_KEY" \
  -H "Authorization: Bearer $HOMEHUB_SUPABASE_JWT" \
  -H "Content-Profile: app" \
  -H "Content-Type: application/json" \
  -d "{
    \"household_id\":\"$HOUSEHOLD_ID\",
    \"segment\":\"financial\",
    \"status\":\"pending\",
    \"proposed_action\":$JSON_PAYLOAD,
    \"rationale\":\"$WHY\"
  }" \
  "$HOMEHUB_SUPABASE_URL/rest/v1/suggestion"
```

`proposed_action` shapes mirror the `propose*` tool schemas in HomeHub.

## Approve / dismiss

**Never update `status` directly.** That bypasses the approval-flow
side-effects. Instead, tell the user "I can propose this; approve it
in /suggestions" — the UI triggers the action-executor queue.

## Pitfalls

- Suggestions have a TTL (`expires_at`). Filter expired rows from the
  default inbox view.
- `proposed_action` is validated by the action-executor against the
  corresponding Zod schema at dispatch time — construct payloads that
  match those schemas exactly, or the executor will reject.
