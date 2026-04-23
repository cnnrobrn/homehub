# Environments

**Purpose.** How dev, staging, and production differ and how we promote between them.

## Environments

| Env        | Frontend         | Supabase        | Railway           | Nango           | Data             |
|------------|------------------|-----------------|-------------------|-----------------|------------------|
| `local`    | `next dev`       | Local CLI stack | Docker compose    | Local Docker    | Seeded synthetic |
| `preview`  | Vercel preview   | Staging project | Staging services  | Staging Nango   | Staging snapshot |
| `staging`  | staging.homehub  | Staging project | Staging services  | Staging Nango   | Staging snapshot |
| `prod`     | homehub.ing + app.homehub.ing | Prod project    | Prod services     | Prod Nango      | Real user data   |

Preview deploys share the staging backend. This means preview UIs hit real data from staging — acceptable because staging is seeded, not copied from prod.

## Promotion

- **Code:** PR → preview (on Vercel, staging backend) → merge to `main` → staging deploy → manual promotion to prod.
- **Database migrations:** squashed and reviewed per PR; applied automatically to staging on merge; applied to prod after human approval in the deploy pipeline.
- **Secrets:** managed in each host's secret store (Vercel env, Railway variables, Supabase project settings). Never in the repo. Never copied between envs.

## Data boundaries

- **No prod data in staging.** Ever. If we need realistic data we generate synthetic, not copy.
- **No staging data in dev.** Dev uses the seeded fixture.
- **Support access to prod:** read-only via Supabase's audit-logged SQL runner, with named-user creds. No shared "admin" password.

## Feature flags

- Flag provider: likely PostHog or GrowthBook (TBD; see [`12-roadmap/v1-scope.md`](../12-roadmap/v1-scope.md) — may defer).
- Default flag values differ per env so staging can exercise unreleased paths.

## Cost envelope (rough v1 targets)

- Vercel Pro: one team, ~$20/mo base.
- Supabase Pro: ~$25/mo base + usage (storage, egress, compute).
- Railway: sized for ~10 worker processes; budget $50–150/mo depending on enrichment volume.
- OpenRouter: highly variable; metered per household and displayed internally to keep the feedback loop tight.

## Dependencies

- [`stack.md`](./stack.md)
- [`../10-operations/deployment.md`](../10-operations/deployment.md)

## Open questions

- Do we want an on-demand ephemeral env per developer for integration tests with real Nango? Nice to have; not required for v1.
