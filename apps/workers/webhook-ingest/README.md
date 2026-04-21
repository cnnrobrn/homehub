# @homehub/worker-webhook-ingest

The single public HTTP ingress for all provider webhooks. Terminates the POST, verifies the provider's HMAC, and enqueues a fan-out message for the matching `sync-*` worker.

- **Owner:** `@integrations`
- **Milestone:** M2 (first provider wired: Google Calendar)

Current status: **M0 stub**. `/health` and `/ready` are live; every `POST /webhooks/:provider` route returns `501 Not Implemented`. The HMAC verifier in `src/hmac.ts` is a throwing stub so @integrations has a clear slot to fill when wiring each provider.

Routes (planned):

- `POST /webhooks/gcal` — M2
- `POST /webhooks/gmail` — M4
- `POST /webhooks/plaid` — M5
- `POST /webhooks/instacart` — M6

See `specs/03-integrations/*.md` per provider.
