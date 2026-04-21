-- RLS: app.conversation + app.conversation_turn + app.conversation_attachment

-- 1) Alice reads House A conversation.
select public.act_as('11111111-1111-1111-1111-111111111111');
do $$
declare n int;
begin
  select count(*) into n from app.conversation where id = 'a0000012-0000-0000-0000-000000000000';
  perform public.rls_assert(n = 1, 'conversation: Alice reads House A conversation');
end $$;

-- 2) Bob cannot read.
select public.act_as('33333333-3333-3333-3333-333333333333');
do $$
declare n int;
begin
  select count(*) into n from app.conversation where household_id = 'aaaaaaa1-0000-0000-0000-000000000000';
  perform public.rls_assert(n = 0, 'conversation: Bob cannot read House A conversation');
end $$;

-- 3) Adam (member of A, not the author) can READ the conversation but cannot
--    update/delete it (author-only write).
select public.act_as('22222222-2222-2222-2222-222222222222');
do $$
declare n int;
begin
  select count(*) into n from app.conversation where id = 'a0000012-0000-0000-0000-000000000000';
  perform public.rls_assert(n = 1, 'conversation: Adam can read Alice''s conversation');
  update app.conversation set title = 'Hijacked' where id = 'a0000012-0000-0000-0000-000000000000';
  get diagnostics n = row_count;
  perform public.rls_assert(n = 0, 'conversation: non-author Adam cannot update');
end $$;

-- 4) Adam can insert a MEMBER conversation_turn authored by himself,
--    but cannot insert one authored by Alice.
do $$
declare n int;
declare caught boolean := false;
begin
  insert into app.conversation_turn
    (conversation_id, household_id, author_member_id, role, body_md)
  values
    ('a0000012-0000-0000-0000-000000000000',
     'aaaaaaa1-0000-0000-0000-000000000000',
     'aaaaaaa1-2222-0000-0000-000000000000', -- Adam's member id
     'member', 'I vote pizza');
  get diagnostics n = row_count;
  perform public.rls_assert(n = 1, 'conversation_turn: Adam inserts his own member turn');

  begin
    insert into app.conversation_turn
      (conversation_id, household_id, author_member_id, role, body_md)
    values
      ('a0000012-0000-0000-0000-000000000000',
       'aaaaaaa1-0000-0000-0000-000000000000',
       'aaaaaaa1-1111-0000-0000-000000000000', -- Alice's member id
       'member', 'Impersonation attempt');
  exception when others then caught := true;
  end;
  perform public.rls_assert(caught, 'conversation_turn: Adam cannot impersonate Alice');
end $$;

-- 5) Adam cannot insert an assistant turn (service-role only).
do $$
declare caught boolean := false;
begin
  begin
    insert into app.conversation_turn (conversation_id, household_id, role, body_md)
    values ('a0000012-0000-0000-0000-000000000000',
            'aaaaaaa1-0000-0000-0000-000000000000', 'assistant', 'fake');
  exception when others then caught := true;
  end;
  perform public.rls_assert(caught, 'conversation_turn: members cannot insert assistant turns');
end $$;

select public.act_as_service();
