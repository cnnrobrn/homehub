-- RLS: app.transaction

-- 1) Alice reads her transaction.
select public.act_as('11111111-1111-1111-1111-111111111111');
do $$
declare n int;
begin
  select count(*) into n from app.transaction where id = 'a0000007-0000-0000-0000-000000000000';
  perform public.rls_assert(n = 1, 'transaction: Alice reads her account transaction');
end $$;

-- 2) Bob cannot read House A transaction.
select public.act_as('33333333-3333-3333-3333-333333333333');
do $$
declare n int;
begin
  select count(*) into n from app.transaction where id = 'a0000007-0000-0000-0000-000000000000';
  perform public.rls_assert(n = 0, 'transaction: Bob cannot read House A transaction');
end $$;

-- 3) Adam with per-account `none` cannot read.
select public.act_as('22222222-2222-2222-2222-222222222222');
do $$
declare n int;
begin
  select count(*) into n from app.transaction where id = 'a0000007-0000-0000-0000-000000000000';
  perform public.rls_assert(n = 0, 'transaction: Adam with none account grant cannot read');
end $$;

-- 4) Adam cannot insert a transaction on an account he cannot write.
do $$
declare caught boolean := false;
begin
  begin
    insert into app.transaction
      (household_id, occurred_at, amount_cents, source, account_id)
    values
      ('aaaaaaa1-0000-0000-0000-000000000000', now(), -100, 'manual',
       'a0000001-0000-0000-0000-000000000000');
  exception when others then caught := true;
  end;
  perform public.rls_assert(caught, 'transaction: Adam cannot insert on denied account');
end $$;

select public.act_as_service();
