# Row-Level Security

**Purpose.** Every row in HomeHub belongs to exactly one household, and Postgres — not the application — enforces that boundary.

**Scope.** The RLS policy template used across tables, plus the three non-obvious cases.

## The template

Every `app.*` and `mem.*` table carries `household_id uuid not null`. RLS is enabled on every such table with one read policy and one write policy:

```sql
-- read: member must belong to this household
create policy read on app.event
  for select using (
    household_id in (
      select household_id from app.member
      where user_id = auth.uid()
    )
  );

-- write: member must belong and must have write access for the segment
create policy write on app.event
  for all using (
    exists (
      select 1
      from app.member m
      join app.member_segment_grant g on g.member_id = m.id
      where m.household_id = app.event.household_id
        and m.user_id = auth.uid()
        and g.segment = app.event.segment
        and g.access = 'write'
    )
  );
```

Both policies are expressed as helper functions (`app.is_member(h)`, `app.can_write(h, segment)`) so the table-level policies stay short and the logic lives in one place.

## Service-role bypass

Background workers run with the service role key and bypass RLS. This is necessary (they must touch every household) and acceptable because:

- The service key never touches the browser.
- Every service-role query is traced in `audit.event` when it mutates.
- Workers filter by `household_id` explicitly in every query.

## Non-obvious cases

### 1. Per-account visibility (roommates)

A roommate should see shared utility bills but not a housemate's personal credit card. `app.account_grant` overrides segment-level grants for specific accounts:

```
account_grant(account_id, member_id, access)
```

`app.transaction` RLS joins through `account_grant` before falling back to `member_segment_grant`.

### 2. Child-safe financial views

Children have segment `none` for Financial by default. But they should see "allowance earned" or similar. Solution: a view `app.child_financial_view` that shows only transactions tagged `kid_visible: true`, with its own narrower RLS.

### 3. Memory graph isolation

`mem.node` and `mem.edge` are household-scoped. We intentionally do not allow cross-household entity merging even if two households know the same person. "Mom" in one household is a different node from "Mom" in another. Avoids accidental leaks.

## Testing RLS

- Every policy has an automated test that asserts:
  - A member of household A cannot SELECT from household B.
  - A member without `write` grant cannot INSERT into a segment they don't have access to.
  - A revoked member gets zero rows within one query of their grant being revoked.
- Tests run in CI against a seeded schema; see [`../11-testing/strategy.md`](../11-testing/strategy.md).

## Dependencies

- [`schema.md`](./schema.md)
- [`households.md`](./households.md)
- [`../09-security/threat-model.md`](../09-security/threat-model.md)

## Open questions

- Do we RLS the `audit.*` tables, or restrict them entirely to service role? Leaning: service-role-only, with a read-only view for owners.
