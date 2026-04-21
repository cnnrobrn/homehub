# @homehub/worker-reconciler

Reconciles duplicate transactions (email vs budget app) and merges memory facts.

- **Owner:** @integrations + @memory-background
- **Milestone:** M3/M5

Current status: **M0 stub**. The `src/handler.ts` export throws
`NotYetImplementedError`; `src/main.ts` wires env, tracing, Supabase,
the queue client, and a `/health` + `/ready` HTTP server, then idles
until SIGTERM. The owner fleshes out the real logic in the milestone above.

See `specs/05-agents/workers.md` for the worker catalog and
`specs/08-backend/workers.md` for deployment conventions.
