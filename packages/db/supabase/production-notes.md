# Supabase — production auth configuration

This document lists the Supabase dashboard / CLI settings that differ between
local / staging and production. Local-only knobs in `config.toml` (such as
`auth.enable_signup = true`) are intentional for ergonomics and cannot be
"flipped" from the repo — production auth is configured via the Supabase
dashboard or the `supabase settings` CLI, which writes to the linked project.

## Invitation-only signup (M1-B)

Production must reject any signup for an email that was not invited into a
household via `app.household_invitation`. We enforce this in two layers:

1. **Database layer** — every `app.*` RLS policy denies reads and writes for a
   user with no `app.member` row. A user who signs up with an unmatched email
   ends up with an `auth.users` row but zero application data surface. This is
   the backstop; it works even if the dashboard flag below is misconfigured.
2. **Auth layer** — the Supabase project-level `auth.enable_signup` flag gates
   who can create an `auth.users` row in the first place. We leave this
   `true` locally so the magic-link verification path creates the row on first
   click; in production we flip it to `false`.

### How to flip the flag in production

Set it via the Supabase dashboard (Project → Authentication → Providers → Email)
or via the CLI against the linked project:

```shell
# Requires a linked project (supabase link --project-ref <ref>) and an access
# token with admin scope. The CLI writes to Supabase's project config API.
supabase --experimental auth update \
  --project-ref <prod-ref> \
  --enable-signup false
```

(If the `supabase auth update` command is not yet GA in your CLI version, use
the dashboard — it's the same setting.)

### What the frontend needs

With `enable_signup = false`, an invitee still needs to get an
`auth.users` row before `acceptInvitationAction` can attach them to a
household. The flow is:

- The owner calls `inviteMemberAction` and gets back `{ invitationId, token,
expiresAt }`. `@frontend-chat` renders a signup URL (`/invite?token=…`).
- The invitee visits the URL and requests a magic link for their email. With
  `enable_signup = false`, Supabase rejects the link unless that email has
  already been admin-invited. We therefore pair the flag flip with a hook
  that pre-creates the `auth.users` row when `inviteMemberAction` runs. The
  Supabase Admin API `createUser` (service-role only) is the standard way —
  it lands a row without triggering an email, and the user can then verify
  via magic link normally.
- The magic link sets the session cookie. The frontend calls
  `acceptInvitationAction`, which consumes the token and creates the
  `app.member` row.

The admin-create-user step lives in `@homehub/auth-server` next to the
existing `inviteMember` flow. It is **not** implemented in M1-B — the
recommendation for M1 staging is to keep `enable_signup = true` so the
magic-link side works without an admin pre-create, then bundle both the
flag flip and the admin pre-create in the same M1-C / M2 landing.

## Related files

- `packages/db/supabase/config.toml` — local Supabase stack (M1-A): keeps
  `enable_signup = true`. Do not change here to alter prod.
- `packages/auth-server/src/household/flows.ts` — `inviteMember` and
  `acceptInvitation` rely on the invite-gate; if signup is closed without
  the admin pre-create, magic-link verification fails.
- `specs/09-security/auth.md` — the canonical auth spec.
