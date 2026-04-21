-- RLS: app.household_invitation

-- 1) Alice (owner of A) reads invitations for House A.
select public.act_as('11111111-1111-1111-1111-111111111111');
do $$
declare n int;
begin
  select count(*) into n from app.household_invitation
  where household_id = 'aaaaaaa1-0000-0000-0000-000000000000';
  perform public.rls_assert(n >= 1, 'invitation: Alice reads House A invitations');
end $$;

-- 2) Bob (owner of B) cannot read House A invitations.
select public.act_as('33333333-3333-3333-3333-333333333333');
do $$
declare n int;
begin
  select count(*) into n from app.household_invitation
  where household_id = 'aaaaaaa1-0000-0000-0000-000000000000';
  perform public.rls_assert(n = 0, 'invitation: Bob cannot read House A invitations');
end $$;

-- 3) Adult (Adam) cannot create invitations even for his own household.
select public.act_as('22222222-2222-2222-2222-222222222222');
do $$
declare caught boolean := false;
begin
  begin
    insert into app.household_invitation
      (household_id, email, role, token_hash, expires_at, invited_by)
    values
      ('aaaaaaa1-0000-0000-0000-000000000000', 'bad@test', 'adult',
       'hash-adam', now() + interval '7 days',
       'aaaaaaa1-2222-0000-0000-000000000000');
  exception when others then caught := true;
  end;
  perform public.rls_assert(caught, 'invitation: Adam (non-owner) cannot create invitations');
end $$;

select public.act_as_service();
