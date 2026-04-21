-- RLS: app.account_grant

-- 1) Alice (write financial, owner) reads an account_grant row for her account.
select public.act_as('11111111-1111-1111-1111-111111111111');
do $$
declare n int;
begin
  select count(*) into n from app.account_grant
  where account_id = 'a0000001-0000-0000-0000-000000000000';
  perform public.rls_assert(n >= 1, 'account_grant: Alice reads her account grants');
end $$;

-- 2) Bob cannot read House A account grants.
select public.act_as('33333333-3333-3333-3333-333333333333');
do $$
declare n int;
begin
  select count(*) into n from app.account_grant
  where account_id = 'a0000001-0000-0000-0000-000000000000';
  perform public.rls_assert(n = 0, 'account_grant: Bob cannot read House A account grants');
end $$;

-- 3) Non-owner (Adam) cannot grant himself write access.
select public.act_as('22222222-2222-2222-2222-222222222222');
do $$
declare caught boolean := false;
begin
  begin
    insert into app.account_grant (account_id, member_id, access)
    values ('a0000001-0000-0000-0000-000000000000',
            'aaaaaaa1-2222-0000-0000-000000000000', 'write');
  exception when others then caught := true;
  end;
  perform public.rls_assert(caught, 'account_grant: non-owner Adam cannot grant himself write');
end $$;

select public.act_as_service();
