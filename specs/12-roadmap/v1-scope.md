# v1 Scope

**Purpose.** A firm line between "shipping" and "later." Use this as the tie-breaker.

## In scope for v1

- One household shape supported well: couple or family with 2–5 members.
- Providers: **Google Calendar, Gmail, one budgeting app (YNAB or Monarch), one grocery provider (Instacart or export)**.
- All four segments with all three slices — none skipped, even if thin.
- Memory graph with enrichment on all ingest paths.
- Suggestions with approval flow for: meal swaps, grocery orders, calendar mirrors, Gmail drafts, reach-outs.
- Daily + weekly summaries; alerts across segments.
- MCP surface (`mcp-homehub-core`) usable from Claude Desktop / equivalent.
- Dashboards, backup, export, basic audit UI.

## Out of scope for v1

- iCal / Outlook / iCloud providers.
- Mobile-native apps.
- Voice interface.
- Group households merging.
- Multi-currency.
- Public API.
- Direct money movement outside of what a provider supports.
- Automated message sends (only drafts).
- Ticket/flight/hotel booking via HomeHub.
- Smart-home device integration (reserved for `mcp-local-devices` post-v1).
- Custom model fine-tuning per household.

## Sharp edges we accept in v1

- Subscription price-change detection may miss yearly renewals in the first year of use (baseline data insufficient).
- Non-connected member planning works but is clunky — the UI doesn't yet distinguish them beautifully.
- Roommate per-account visibility exists in data model but UI surfaces for it are minimal.
- Meal nutrition is best-effort; no authoritative source.

## Definition of done for v1

A household in the Martins archetype can:

1. Sign up, invite a partner, connect Google + budgeting + grocery.
2. See a unified Today view on day one that feels useful.
3. Receive at least one genuinely useful suggestion in the first week (meal swap or grocery order likely wins here).
4. Plan and execute a grocery run end-to-end through HomeHub.
5. Never lose data, never see another household's data.

If all five hold across 5–10 private beta households for two weeks, we ship.

## Dependencies

- [`milestones.md`](./milestones.md)
- Every spec under `specs/` is implicitly constrained by this scope.
