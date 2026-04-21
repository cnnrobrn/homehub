-- RLS: app.email_attachment
--
-- The read gate joins through app.email so the same segment check that
-- governs email visibility governs attachment visibility.

-- 1) Alice reads all of House A's attachments.
select public.act_as('11111111-1111-1111-1111-111111111111');
do $$
declare n int;
begin
  select count(*) into n from app.email_attachment
  where household_id = 'aaaaaaa1-0000-0000-0000-000000000000';
  perform public.rls_assert(n >= 2, 'email_attachment: Alice reads all House A attachments');
end $$;

-- 2) Bob (House B) cannot read House A's attachments.
select public.act_as('33333333-3333-3333-3333-333333333333');
do $$
declare n int;
begin
  select count(*) into n from app.email_attachment
  where household_id = 'aaaaaaa1-0000-0000-0000-000000000000';
  perform public.rls_assert(n = 0, 'email_attachment: Bob cannot read House A attachments');
end $$;

-- 3) Adam can read the attachment on the 'system' email but not the
--    attachment on the 'financial' email (segment inherited from the
--    parent email row).
select public.act_as('22222222-2222-2222-2222-222222222222');
do $$
declare n int;
begin
  -- Attachment on system email — visible.
  select count(*) into n from app.email_attachment
  where id = 'a0000033-0000-0000-0000-000000000000';
  perform public.rls_assert(n = 1,
    'email_attachment: Adam reads attachment on system email');

  -- Attachment on financial email — hidden.
  select count(*) into n from app.email_attachment
  where id = 'a0000032-0000-0000-0000-000000000000';
  perform public.rls_assert(n = 0,
    'email_attachment: Adam cannot read attachment on financial email');
end $$;

-- 4) Alice (owner, full grants) cannot INSERT into app.email_attachment.
--    Writes are service-role only.
select public.act_as('11111111-1111-1111-1111-111111111111');
do $$
declare caught boolean := false;
begin
  begin
    insert into app.email_attachment
      (household_id, email_id, filename, storage_path)
    values
      ('aaaaaaa1-0000-0000-0000-000000000000',
       'a0000030-0000-0000-0000-000000000000',
       'sneaky.pdf',
       'aaaaaaa1-0000-0000-0000-000000000000/email/a0000030-0000-0000-0000-000000000000/sneaky');
  exception when others then caught := true;
  end;
  perform public.rls_assert(caught,
    'email_attachment: authenticated cannot INSERT (service-role only)');
end $$;

-- 5) Adam cannot DELETE an attachment he can read.
select public.act_as('22222222-2222-2222-2222-222222222222');
do $$
declare affected int;
begin
  delete from app.email_attachment
  where id = 'a0000033-0000-0000-0000-000000000000';
  get diagnostics affected = row_count;
  perform public.rls_assert(affected = 0,
    'email_attachment: Adam cannot DELETE readable attachment');
end $$;

select public.act_as_service();
