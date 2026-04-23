---
name: chat
description: Read past conversations and turns. Use when the user references an earlier conversation ("you told me yesterday that …"), needs a summary of a past thread, or wants to know their own history. This skill reads only; chat turns are created by the /api/chat/stream route, not by the agent.
version: 0.1.0
metadata:
  hermes:
    tags: [homehub, chat, conversation, history]
    category: homehub
    requires_toolsets: [terminal]
required_environment_variables:
  - name: HOUSEHOLD_ID
  - name: HOMEHUB_SUPABASE_URL
  - name: HOMEHUB_SUPABASE_ANON_KEY
  - name: HOMEHUB_SUPABASE_JWT
  - name: HOMEHUB_CONVERSATION_ID
    required_for: same-thread references
---

# Chat

See `_shared`. Tables: `app.conversation`, `app.conversation_turn`,
`app.conversation_attachment`.

## When to Use

- Referring to something discussed earlier.
- Summarizing a past conversation.
- Disambiguating a reference ("the restaurant you mentioned").

## Read

```bash
# Turns in the current conversation
curl -fsSL \
  -H "apikey: $HOMEHUB_SUPABASE_ANON_KEY" \
  -H "Authorization: Bearer $HOMEHUB_SUPABASE_JWT" \
  -H "Accept-Profile: app" \
  "$HOMEHUB_SUPABASE_URL/rest/v1/conversation_turn?household_id=eq.$HOUSEHOLD_ID&conversation_id=eq.$HOMEHUB_CONVERSATION_ID&order=created_at.asc"
```

## Do NOT write

Turns are inserted by the `/api/chat/stream` route handler in HomeHub
before the agent loop even runs. If you find yourself wanting to insert
a `conversation_turn`, you're probably in the wrong layer — tell the
user what you want to say, don't persist it from a skill.

## Pitfalls

- `body_md` is markdown — don't double-escape.
- Attachments reference Supabase Storage paths; surface them via their
  URL, don't try to fetch the binary in-turn unless genuinely needed.
