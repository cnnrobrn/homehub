-- RLS: app.household
--
-- Fixtures: House A (Alice owner), House B (Bob owner).
--   Alice: 11111111-...  /  aaaaaaa1-0000-... (household id)
--   Bob:   33333333-...  /  bbbbbbb1-0000-... (household id)

-- 1) Alice reads House A. Expect exactly 1 row.
select public.act_as('11111111-1111-1111-1111-111111111111');
do $$
declare n int;
begin
  select count(*) into n from app.household where id = 'aaaaaaa1-0000-0000-0000-000000000000';
  perform public.rls_assert(n = 1, 'household: Alice can read House A');
end $$;

-- 2) Alice cannot read House B. Expect 0 rows.
do $$
declare n int;
begin
  select count(*) into n from app.household where id = 'bbbbbbb1-0000-0000-0000-000000000000';
  perform public.rls_assert(n = 0, 'household: Alice cannot read House B');
end $$;

-- 3) Non-owner (Adam, adult) cannot UPDATE House A. Expect 0 rows affected.
select public.act_as('22222222-2222-2222-2222-222222222222');
do $$
declare n int;
begin
  update app.household set name = 'pwned' where id = 'aaaaaaa1-0000-0000-0000-000000000000';
  get diagnostics n = row_count;
  perform public.rls_assert(n = 0, 'household: non-owner Adam cannot update House A');
end $$;

-- 4) Owner (Alice) CAN update House A.
select public.act_as('11111111-1111-1111-1111-111111111111');
do $$
declare n int;
begin
  update app.household set settings = settings || '{"tz":"America/New_York"}'::jsonb
  where id = 'aaaaaaa1-0000-0000-0000-000000000000';
  get diagnostics n = row_count;
  perform public.rls_assert(n = 1, 'household: owner Alice can update House A');
end $$;

select public.act_as_service();
