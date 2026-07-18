-- OnStandard — staff-role vocabulary v2 (part 2 of 2): let a head coach mint and assign the
-- three new roles added in 0082. Only the allow-lists change; the bodies are otherwise identical
-- to 0078's. head_coach stays un-mintable/un-assignable (succession is out of v1). These roles
-- are non-readonly write staff, so is_write_staff already grants their scoped writes.
--
-- GUARDRAIL: authored for founder review — apply after 0082 with `supabase db push`, then
-- `npm run test:rls` (the suite's staff-role section probes minting + scoped visibility).

-- Mint an invite for any assignable (non-head-coach) staff role.
create or replace function create_staff_invite(p_team uuid, p_role text) returns text
language plpgsql security definer set search_path = public as $$
declare
  chars text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  c text; i int; taken bool;
begin
  if not is_head_coach_of(p_team) then
    raise exception 'Only the head coach can invite staff.';
  end if;
  if p_role not in ('assistant', 'coordinator', 'position_coach', 'nutritionist', 'readonly',
                    's_and_c', 'athletic_trainer', 'team_admin') then
    raise exception 'Invite role must be coordinator, position_coach, nutritionist, readonly, s_and_c, athletic_trainer, or team_admin.';
  end if;
  loop
    c := '';
    for i in 1..8 loop
      c := c || substr(chars, 1 + floor(random() * length(chars))::int, 1);
    end loop;
    select exists(select 1 from staff_invites where code = c) into taken;
    exit when not taken;
  end loop;
  insert into staff_invites (team_id, role, code, created_by)
  values (p_team, p_role::staff_role, c, auth.uid());
  return c;
end; $$;
revoke all on function create_staff_invite(uuid, text) from public, anon;
grant execute on function create_staff_invite(uuid, text) to authenticated;

-- Head coach re-roles a staff member (never the head-coach row, never to head_coach).
create or replace function set_staff_role(p_team uuid, p_staff uuid, p_role text)
returns boolean
language plpgsql security definer set search_path = public as $$
declare
  hit int;
begin
  if not is_head_coach_of(p_team) then
    raise exception 'Only the head coach can change roles.';
  end if;
  if p_role not in ('coordinator','position_coach','nutritionist','readonly','assistant',
                    's_and_c','athletic_trainer','team_admin') then
    raise exception 'Bad role.';
  end if;
  update team_staff set role = p_role::staff_role
   where team_id = p_team and staff_id = p_staff and status = 'active' and role <> 'head_coach';
  get diagnostics hit = row_count;
  return hit > 0;
end; $$;
revoke all on function set_staff_role(uuid, uuid, text) from public, anon;
grant execute on function set_staff_role(uuid, uuid, text) to authenticated;
