---
name: memory
description: Read and write the household's long-term memory graph — facts, nodes (people/places/things), episodes, patterns, rules. Use when the user asks "what do you know about X", "remember that …", "forget …", or when another skill needs to retrieve context. All new facts are scoped to household_id.
version: 0.1.0
metadata:
  hermes:
    tags: [homehub, memory, knowledge]
    category: homehub
    requires_toolsets: [terminal]
required_environment_variables:
  - name: HOUSEHOLD_ID
  - name: HOMEHUB_SUPABASE_URL
  - name: HOMEHUB_SUPABASE_ANON_KEY
  - name: HOMEHUB_SUPABASE_JWT
---

# Memory

See `_shared`. Schema is `mem` (set `Accept-Profile: mem` and
`Content-Profile: mem`). Tables: `node`, `alias`, `edge`, `mention`,
`episode`, `fact`, `fact_candidate`, `pattern`, `rule`, `insight`.

## When to Use

- "What do you know about \_\_\_"
- "Remember \_\_\_"
- "Is there a pattern of \_\_\_"
- Cross-skill context retrieval before answering.

## Read

```bash
# Find a node by name
curl -fsSL \
  -H "apikey: $HOMEHUB_SUPABASE_ANON_KEY" \
  -H "Authorization: Bearer $HOMEHUB_SUPABASE_JWT" \
  -H "Accept-Profile: mem" \
  "$HOMEHUB_SUPABASE_URL/rest/v1/node?household_id=eq.$HOUSEHOLD_ID&name=ilike.*$QUERY*&limit=10"

# Facts about a node
curl -fsSL \
  -H "apikey: $HOMEHUB_SUPABASE_ANON_KEY" \
  -H "Authorization: Bearer $HOMEHUB_SUPABASE_JWT" \
  -H "Accept-Profile: mem" \
  "$HOMEHUB_SUPABASE_URL/rest/v1/fact?household_id=eq.$HOUSEHOLD_ID&subject_node_id=eq.$NODE_ID&deleted_at=is.null"
```

## Write

**New facts go to `fact_candidate`**, not `fact`, so the existing
approval/consolidation pipeline promotes them. Direct `fact` inserts
bypass conflict detection:

```bash
curl -fsSL -X POST \
  -H "apikey: $HOMEHUB_SUPABASE_ANON_KEY" \
  -H "Authorization: Bearer $HOMEHUB_SUPABASE_JWT" \
  -H "Content-Profile: mem" \
  -H "Content-Type: application/json" \
  -d "{\"household_id\":\"$HOUSEHOLD_ID\",\"subject_node_id\":\"$NODE_ID\",\"predicate\":\"$P\",\"object_text\":\"$O\",\"source\":\"chat-hermes\"}" \
  "$HOMEHUB_SUPABASE_URL/rest/v1/fact_candidate"
```

## Pitfalls

- **Embeddings are required for retrieval.** Writing to `fact` directly
  without an embedding breaks semantic search. Use `fact_candidate` and
  let the reflector/consolidator worker backfill.
- **Never hard-delete.** Set `deleted_at=now()`. Audit + provenance
  depend on the row surviving.
- **Conflict detection.** Before writing a new fact, check for a
  contradicting fact on the same `(subject_node_id, predicate)`.
  Surface the conflict, don't silently overwrite.
- `node_type` is check-constrained; new types require a migration.
