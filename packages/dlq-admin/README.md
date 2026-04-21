# @homehub/dlq-admin

Operator tooling for triaging the `sync.dead_letter` queue.

The worker runtime writes a row to `sync.dead_letter` when a message
exceeds its retry budget (see `packages/worker-runtime/src/queue/client.ts`).
This package exposes:

1. **Primitives** — `listDeadLetters`, `replayDeadLetter`, `purgeDeadLetter`.
   Imported by the `/ops/dlq` Server Component in the web app and by the
   CLI below.
2. **CLI** — `homehub-dlq` (aka `pnpm --filter @homehub/dlq-admin dlq`).

See `docs/ops/runbooks/dlq-replay.md` for the end-to-end triage flow.

## Usage — CLI

```bash
# Env: SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY
pnpm --filter @homehub/dlq-admin dlq list
pnpm --filter @homehub/dlq-admin dlq list --queue enrich_email --limit 25
pnpm --filter @homehub/dlq-admin dlq list --household 00000000-0000-0000-0000-000000000001

pnpm --filter @homehub/dlq-admin dlq replay <id>
pnpm --filter @homehub/dlq-admin dlq purge  <id>
```

Because the CLI uses the service-role key it bypasses RLS. Keep invocations
inside a Railway shell or a hardened operator workstation; do not wire this
into a long-running web surface.

## Usage — programmatic

```ts
import { listDeadLetters, replayDeadLetter, purgeDeadLetter } from '@homehub/dlq-admin';
import { createServiceClient, createQueueClient } from '@homehub/worker-runtime';

const supabase = createServiceClient(env);
const queues = createQueueClient(supabase);

const entries = await listDeadLetters(supabase, { householdId });
await replayDeadLetter(supabase, queues, entries[0].id);
await purgeDeadLetter(supabase, entries[0].id);
```

The web app wraps these primitives in server actions (`/ops/dlq`) and
enforces owner-only gating at the request boundary.
