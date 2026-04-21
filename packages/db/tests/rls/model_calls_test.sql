-- RLS: app.model_calls
--
-- Service-role writes. Owners-only reads (exposes per-household spend).

-- 1) Service role can read (sanity).
select public.act_as_service();
do $$
declare n int;
begin
  select count(*) into n from app.model_calls;
  perform public.rls_assert(n >= 1, 'model_calls: service role reads');
end $$;

-- 2) Alice (owner of A) can read House A rows.
select public.act_as('11111111-1111-1111-1111-111111111111');
do $$
declare n int;
begin
  select count(*) into n from app.model_calls where household_id = 'aaaaaaa1-0000-0000-0000-000000000000';
  perform public.rls_assert(n >= 1, 'model_calls: owner Alice reads House A');
end $$;

-- 3) Adam (adult in A, non-owner) cannot read.
select public.act_as('22222222-2222-2222-2222-222222222222');
do $$
declare n int;
begin
  select count(*) into n from app.model_calls where household_id = 'aaaaaaa1-0000-0000-0000-000000000000';
  perform public.rls_assert(n = 0, 'model_calls: non-owner Adam cannot read');
end $$;

-- 4) Bob (owner of B) cannot read House A rows.
select public.act_as('33333333-3333-3333-3333-333333333333');
do $$
declare n int;
begin
  select count(*) into n from app.model_calls where household_id = 'aaaaaaa1-0000-0000-0000-000000000000';
  perform public.rls_assert(n = 0, 'model_calls: Bob cannot read House A');
end $$;

-- 5) No authenticated INSERT.
select public.act_as('11111111-1111-1111-1111-111111111111');
do $$
declare caught boolean := false;
begin
  begin
    insert into app.model_calls (household_id, task, model, cost_usd)
    values ('aaaaaaa1-0000-0000-0000-000000000000', 'test', 'm', 0);
  exception when others then caught := true;
  end;
  perform public.rls_assert(caught, 'model_calls: authenticated cannot INSERT');
end $$;

select public.act_as_service();
