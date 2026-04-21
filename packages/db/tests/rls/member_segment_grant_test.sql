-- RLS: app.member_segment_grant

-- 1) Alice reads her own grants.
select public.act_as('11111111-1111-1111-1111-111111111111');
do $$
declare n int;
begin
  select count(*) into n from app.member_segment_grant
  where member_id = 'aaaaaaa1-1111-0000-0000-000000000000';
  perform public.rls_assert(n >= 5, 'member_segment_grant: Alice reads her own grants');
end $$;

-- 2) Alice cannot read Bob's grants (out of household).
do $$
declare n int;
begin
  select count(*) into n from app.member_segment_grant
  where member_id = 'bbbbbbb1-1111-0000-0000-000000000000';
  perform public.rls_assert(n = 0, 'member_segment_grant: Alice cannot read House B grants');
end $$;

-- 3) Adult (Adam) cannot insert a grant for himself.
select public.act_as('22222222-2222-2222-2222-222222222222');
do $$
declare caught boolean := false;
begin
  begin
    insert into app.member_segment_grant (member_id, segment, access)
    values ('aaaaaaa1-2222-0000-0000-000000000000', 'financial', 'write');
  exception when others then caught := true;
  end;
  perform public.rls_assert(caught, 'member_segment_grant: Adam cannot grant himself write');
end $$;

select public.act_as_service();
