# @homehub/worker-enrichment

Extracts entities and facts from observed events and writes to the memory graph.

- **Owner:** @memory-background
- **Milestone:** M3

Current status: **M0 stub**. The `src/handler.ts` export throws
`NotYetImplementedError`; `src/main.ts` wires env, tracing, Supabase,
the queue client, and a `/health` + `/ready` HTTP server, then idles
until SIGTERM. The owner fleshes out the real logic in the milestone above.

See `specs/05-agents/workers.md` for the worker catalog and
`specs/08-backend/workers.md` for deployment conventions.
