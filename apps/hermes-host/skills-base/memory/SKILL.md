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
Use the `homehub` CLI; it injects household scope and chooses the
right schema.

## When to Use

- "What do you know about \_\_\_"
- "Remember \_\_\_"
- "Is there a pattern of \_\_\_"
- Cross-skill context retrieval before answering.

## Read

```bash
# Find a node by name
homehub memory nodes search --query "$QUERY" --limit 10
homehub memory nodes search --type person --query "$QUERY"

# Facts about a node
homehub memory facts list --subject-node-id "$NODE_ID" --current
```

## Write

**New facts go to `fact_candidate`**, not `fact`, so the existing
approval/consolidation pipeline promotes them. Direct `fact` inserts
bypass conflict detection:

```bash
homehub memory fact-candidates add \
  --subject-node-id "$NODE_ID" \
  --predicate "$P" \
  --object-text "$O" \
  --reason "member told Hermes in chat"
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
