-- RLS: sync.provider_connection

-- 1) Alice reads House A connections.
select public.act_as('11111111-1111-1111-1111-111111111111');
do $$
declare n int;
begin
  select count(*) into n from sync.provider_connection
  where household_id = 'aaaaaaa1-0000-0000-0000-000000000000';
  perform public.rls_assert(n >= 1, 'provider_connection: Alice reads House A connections');
end $$;

-- 2) Bob cannot.
select public.act_as('33333333-3333-3333-3333-333333333333');
do $$
declare n int;
begin
  select count(*) into n from sync.provider_connection
  where household_id = 'aaaaaaa1-0000-0000-0000-000000000000';
  perform public.rls_assert(n = 0, 'provider_connection: Bob cannot read House A');
end $$;

-- 3) No authenticated INSERT (service-role only).
select public.act_as('11111111-1111-1111-1111-111111111111');
do $$
declare caught boolean := false;
begin
  begin
    insert into sync.provider_connection
      (household_id, member_id, provider, nango_connection_id)
    values
      ('aaaaaaa1-0000-0000-0000-000000000000',
       'aaaaaaa1-1111-0000-0000-000000000000', 'ynab', 'nango-ynab-1');
  exception when others then caught := true;
  end;
  perform public.rls_assert(caught, 'provider_connection: members cannot insert (service-role only)');
end $$;

select public.act_as_service();
