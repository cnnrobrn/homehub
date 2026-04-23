# HomeHub shared reference (skill `_shared`)

HomeHub data lives in Supabase. Every sandbox has these env vars set by
the router at spawn time:

- `HOUSEHOLD_ID` — the family's UUID.
- `HOMEHUB_SUPABASE_URL` — e.g. `https://<project>.supabase.co`
- `HOMEHUB_SUPABASE_ANON_KEY` — public anon key; goes in `apikey:` header.
- `HOMEHUB_SUPABASE_JWT` — **household-scoped, short-lived** JWT minted
  by the router for THIS turn. Carries `sub=<user_id>`,
  `household_id=<this household>`, `role=authenticated`, and a
  ~10-minute expiry. Supabase RLS enforces the scope: queries against
  `household_id` rows the user isn't a member of come back empty.
- `HOMEHUB_CONVERSATION_ID`, `HOMEHUB_TURN_ID`, `HOMEHUB_MEMBER_ID`,
  `HOMEHUB_MEMBER_ROLE`.

## Auth pattern

Every PostgREST call uses two headers:

```
apikey:        $HOMEHUB_SUPABASE_ANON_KEY
Authorization: Bearer $HOMEHUB_SUPABASE_JWT
```

The `apikey` identifies the project; the `Authorization` bearer is the
household-scoped JWT. RLS takes over from there.

## Reading with curl (PostgREST)

```bash
curl -fsSL \
  -H "apikey: $HOMEHUB_SUPABASE_ANON_KEY" \
  -H "Authorization: Bearer $HOMEHUB_SUPABASE_JWT" \
  -H "Accept-Profile: app" \
  "$HOMEHUB_SUPABASE_URL/rest/v1/event?household_id=eq.$HOUSEHOLD_ID&order=starts_at.asc&limit=50"
```

## Writing with curl

```bash
curl -fsSL -X POST \
  -H "apikey: $HOMEHUB_SUPABASE_ANON_KEY" \
  -H "Authorization: Bearer $HOMEHUB_SUPABASE_JWT" \
  -H "Content-Profile: app" \
  -H "Content-Type: application/json" \
  -H "Prefer: return=representation" \
  -d '{"household_id":"'"$HOUSEHOLD_ID"'","title":"...","starts_at":"2026-05-01T09:00:00Z"}' \
  "$HOMEHUB_SUPABASE_URL/rest/v1/event"
```

## Hard rules

1. **Always include `household_id=eq.$HOUSEHOLD_ID`** on reads and
   `"household_id": "$HOUSEHOLD_ID"` on writes. RLS is the backstop,
   but explicit scope predicates double as documentation and keep
   queries fast.
2. **Never print or log `HOMEHUB_SUPABASE_JWT`.** It's short-lived but
   still grants write access for its TTL.
3. **Destructive ops (`DELETE`, bulk updates) require user
   confirmation.** Summarize what you'll change, ask "proceed?", then
   execute.
4. **For mutations that look like commitments** (booking, transferring
   money, canceling a subscription): write to `app.suggestion` with
   `status='pending'` instead of executing. The household approves in
   `/suggestions`.

## Built-in Food + Instacart Handoff

Every generic Hermes skill can rely on the baked `food` skill for meal
planning, pantry inventory, grocery lists, and Instacart handoff. The
safe pattern is:

1. Read meals and pantry from the `app` schema, scoped by
   `household_id`.
2. Create or update HomeHub grocery-list rows for low-stakes list
   management.
3. For "order this", "send to Instacart", or any checkout-like request,
   create a food suggestion or direct the user to the Food UI. The
   sandbox does **not** receive the Instacart API key.
4. If a list already has `external_url`, surface that URL as the
   Instacart link. Users sign in, choose a store, review items, and
   check out on Instacart.

Do not ask the user to "connect Instacart" through settings. HomeHub's
Instacart integration is app-configured with
`INSTACART_DEVELOPER_API_KEY`; member login happens on Instacart after
they open the generated shopping-list URL.

## Schemas

- `app` — user-facing data (event, transaction, meal, conversation, …)
- `mem` — memory graph (node, fact, episode, …)
- `sync` — integration state
- `audit` — provenance trail

Default `Accept-Profile` / `Content-Profile` to `app`. Use `mem` for
memory-graph queries.

## What if a query returns empty?

Could be RLS rejecting (wrong household), could be genuinely no rows.
Say so plainly: "I can't see anything for that" rather than guessing.
Don't try to bypass RLS — you can't, and trying is a red flag.
