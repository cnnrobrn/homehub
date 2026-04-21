# Conversations — Data Model

**Purpose.** How chat conversations are stored, how they become memory, and how they relate to the rest of the schema.

## Tables

### `app.conversation`
```
id              uuid pk
household_id    uuid → app.household
title           text            # auto-generated after first exchange
created_by      uuid → app.member
created_at      timestamptz
last_message_at timestamptz
pinned          bool default false
archived_at     timestamptz null
```

### `app.conversation_turn`
```
id                uuid pk
conversation_id   uuid → app.conversation
household_id      uuid            # denormalized for RLS convenience
author_member_id  uuid → app.member null   # null for assistant turns
role              text check in ('member','assistant','tool','system')
body_md           text
tool_calls        jsonb null       # [{tool, args, result, started_at, ended_at}...]
citations         jsonb null       # [{type,'fact'|'episode'|'node', id}]
created_at        timestamptz
model             text null        # assistant turns only
input_tokens      int null
output_tokens     int null
cost_cents        real null
no_memory_write   bool default false   # whisper mode
```

### `app.conversation_attachment`
```
id                uuid pk
conversation_id   uuid → app.conversation
turn_id           uuid → app.conversation_turn
storage_path      text
mime_type         text
processed_as      text null    # e.g. 'receipt','note'
created_at        timestamptz
```

### `app.conversation_share`
Per-member visibility overrides. Not used in v1 (all household-visible); reserved for v1.1 member-private threads.

## Relationship to memory

Conversations feed memory in three ways:

1. **Turns → fact candidates.** Member messages go through the extraction pipeline like any other source (see [`../04-memory-network/extraction.md`](../04-memory-network/extraction.md)). Conversation is a `source_type`.
2. **Conversations → episodes.** When a conversation reaches a natural stopping point (inactive for N minutes, or archived), a summary job creates a `mem.episode` with the conversation as its source. The episode's participants include the member(s) who spoke and any referenced entities.
3. **Citation backpointers.** Every citation in an assistant turn creates a `mem.mention` row, letting the graph browser show "this fact was cited in this conversation."

## RLS

- `app.conversation`: row-level security keyed on `household_id`; read requires membership in the household.
- `app.conversation_turn`: same, via denormalized `household_id`.
- No per-member privacy in v1 within a household. Surface is labelled "shared" in the UI to make expectations unambiguous.

## Titling

The assistant's first response carries a `title_hint` tool call (special direct-write) that sets the conversation title. If not set within 2 exchanges, a summarizer job titles it from the first member message.

## Archival & retention

- Archived conversations still contribute to memory (the episodes stay).
- Conversations themselves retained per [`../09-security/data-retention.md`](../09-security/data-retention.md) — default indefinite; household can set a retention window.

## Streaming persistence

Streaming turns are persisted incrementally so a refresh mid-stream resumes where it left off. Commit pattern:

1. Turn row created `created_at = now(), body_md = ''`.
2. Every ~500ms, body is upserted with the accumulated text.
3. Final commit writes tool_calls, citations, tokens, cost.

## Dependencies

- [`overview.md`](./overview.md)
- [`agent-loop.md`](./agent-loop.md)
- [`../02-data-model/schema.md`](../02-data-model/schema.md)
- [`../09-security/data-retention.md`](../09-security/data-retention.md)
- [`../04-memory-network/extraction.md`](../04-memory-network/extraction.md)

## Open questions

- Index on `(conversation_id, created_at)` — obvious. Add a GIN on `citations` once the graph-browser back-references become a usage pattern.
- Member-private conversations: design sketched above, build in v1.1.
- Should the assistant's internal reasoning tokens (when the model provider exposes them) be stored? No — expensive, of ambiguous value, and privacy-surface-expanding.
