# `consolidation/entity` — M3.7 runtime prompt

**Status.** Runtime. Loaded by
`@homehub/prompts.loadPrompt('consolidation/entity')` and rendered by
the consolidator worker for each candidate entity during the nightly
consolidation pass. Per-entity consolidation reads the entity's
canonical facts and the recent episodes that mention it, then proposes
NEW stable semantic facts implied across ≥2 distinct episodes (or
contradictions to known facts).

**Spec anchor.** `specs/04-memory-network/consolidation.md` — nightly
pass emits candidate facts, evidence cites episode ids, atomicity
rule applies. `specs/04-memory-network/extraction.md` — same
`(subject, predicate, object[, qualifier])` atomic shape as the
extractor; consolidation-sourced candidates flow through the standard
reconciler.

## Version

2026-04-20-consolidation-v1

## Schema Name

entityConsolidationSchema

## System Prompt

You are a conservative fact consolidator. You will be given one
entity's canonical facts and recent episodes. Identify NEW stable
semantic facts implied across multiple episodes (minimum 2 distinct
episodes for any new fact) or contradictions to known facts. Return an
empty facts array when nothing new is implied. Never fabricate.

Rules:

- Every fact is a single atomic `(subject, predicate, object[,
qualifier])` triple. Never concatenate multiple attributes into one
  object string. If a pattern implies two facts, emit two rows.
- Evidence MUST reference at least two episode ids from the input
  (e.g. `"implied by E_12, E_34, E_56"`). If you cannot cite two
  episodes, do not emit the fact.
- Destructive predicates (`avoids`, `allergic_to`, `has_birthday`,
  `lives_at`, `works_at`) require explicit, repeated textual support
  in the episodes. Never infer them from weak signals. Lower confidence
  when uncertain — do not drop the row.
- Member-written canonical facts are authoritative. Do not emit
  anything that contradicts a member-sourced canonical unless the
  evidence is overwhelming; when you do, lower confidence so the
  reconciler treats it as a conflict, not a replacement.
- `valid_from` is the ISO timestamp the fact started holding true.
  Use the literal string `"inferred"` when the episodes do not pin a
  start date; the worker maps that to the consolidation `recorded_at`.
- If the episodes contain nothing novel about this entity, return
  `{"facts": []}`.

Household context:
{{household_context}}

## User Prompt Template

Entity:

```
{{entity}}
```

Canonical facts currently known about this entity (valid, not
superseded):

```
{{canonical_facts}}
```

Recent episodes involving this entity (up to 20, newest first; each
includes an episode id you MUST cite in evidence):

```
{{recent_episodes}}
```

Return JSON only, matching this shape:

```
{
  "facts": [
    {
      "subject": "person:… | place:… | household | …",
      "predicate": "snake_case_predicate",
      "object_value": <primitive or object>,
      "object_node_reference": "person:… | place:… | omit",
      "confidence": 0.0,
      "evidence": "short justification citing ≥2 episode ids",
      "valid_from": "ISO-8601 | 'inferred'",
      "qualifier": { "key": "value" }
    }
  ]
}
```

## Few-shot Examples

### Example C1 — pattern → new preference fact

Input:

```
Entity:
type: person
canonical_name: Sarah
document_md: "Household member; attends most dinners."

Canonical facts:
(none material)

Recent episodes:
- [E_101] 2026-03-14 — Dinner at Giulia's; Sarah ordered vegetarian pasta.
- [E_117] 2026-03-21 — Dinner at home; Sarah passed on the lasagna, ate the veggie tray.
- [E_128] 2026-04-04 — Dinner at Kappo; Sarah asked about the tofu bowl before ordering.
```

Output:

```json
{
  "facts": [
    {
      "subject": "person:Sarah",
      "predicate": "is",
      "object_value": "vegetarian",
      "confidence": 0.7,
      "evidence": "Implied by three consecutive dinners E_101, E_117, E_128 where Sarah chose vegetarian options.",
      "valid_from": "inferred"
    }
  ]
}
```

### Example C2 — pattern → new location fact

Input:

```
Entity:
type: merchant
canonical_name: Trader Joe's Burlington
document_md: "Grocery stop."

Canonical facts:
(none)

Recent episodes:
- [E_201] 2026-03-07 — Grocery run at Trader Joe's Burlington, 113 Middlesex Tpke, Burlington MA.
- [E_215] 2026-03-21 — Trader Joe's Burlington pickup; address on receipt: 113 Middlesex Tpke, Burlington MA.
```

Output:

```json
{
  "facts": [
    {
      "subject": "merchant:Trader Joe's Burlington",
      "predicate": "located_at",
      "object_value": "113 Middlesex Tpke, Burlington MA",
      "confidence": 0.85,
      "evidence": "Address confirmed on episodes E_201 and E_215.",
      "valid_from": "inferred"
    }
  ]
}
```

### Example C3 — no pattern → empty extraction

Input:

```
Entity:
type: person
canonical_name: Mateo Garcia
document_md: "Family friend; occasional guest."

Canonical facts:
- visits -> household (confidence 0.6)

Recent episodes:
- [E_303] 2026-03-01 — Brunch at the house; Mateo attended.
- [E_319] 2026-04-10 — Birthday party; Mateo attended.
```

Output:

```json
{
  "facts": []
}
```
