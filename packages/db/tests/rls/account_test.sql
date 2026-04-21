-- RLS: app.account

-- 1) Alice (owner, financial write, no `none` deny) reads her account.
select public.act_as('11111111-1111-1111-1111-111111111111');
do $$
declare n int;
begin
  select count(*) into n from app.account where id = 'a0000001-0000-0000-0000-000000000000';
  perform public.rls_assert(n = 1, 'account: Alice reads her account');
end $$;

-- 2) Bob (House B) cannot read House A accounts.
select public.act_as('33333333-3333-3333-3333-333333333333');
do $$
declare n int;
begin
  select count(*) into n from app.account where id = 'a0000001-0000-0000-0000-000000000000';
  perform public.rls_assert(n = 0, 'account: Bob cannot read House A account');
end $$;

-- 3) Adam has an explicit `none` per-account grant. Cannot read.
select public.act_as('22222222-2222-2222-2222-222222222222');
do $$
declare n int;
begin
  select count(*) into n from app.account where id = 'a0000001-0000-0000-0000-000000000000';
  perform public.rls_assert(n = 0, 'account: Adam with none per-account grant cannot read');
end $$;

-- 4) Adam cannot insert an account into House A (no write on financial, not owner).
do $$
declare caught boolean := false;
begin
  begin
    insert into app.account (household_id, kind, name)
    values ('aaaaaaa1-0000-0000-0000-000000000000', 'checking', 'Adam Secret');
  exception when others then caught := true;
  end;
  perform public.rls_assert(caught, 'account: non-owner without financial write cannot insert');
end $$;

select public.act_as_service();
