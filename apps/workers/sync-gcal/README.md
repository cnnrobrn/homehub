# @homehub/worker-sync-gcal

Pulls Google Calendar events (webhook + hourly poll) and upserts them into `app.event`.

- **Owner:** `@integrations`
- **Milestone:** M2 (first provider E2E)
- **Consumes:** `sync_gcal` queue (`pgmq`).
- **Produces:** `enrich_event` queue messages after upsert.

Current status: **M0 stub**. The `src/handler.ts` export throws `NotYetImplementedError`; `src/main.ts` wires env, tracing, Supabase, the queue client, and a `/health` + `/ready` HTTP server, then idles until SIGTERM.

See `specs/05-agents/workers.md` and `specs/03-integrations/google-calendar.md` for the real behavior.
