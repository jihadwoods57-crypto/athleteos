-- OnStandard — staff & collaborators (coach-profile deep upgrade + WS5.4 groundwork).
-- The head coach invites assistants and a nutritionist/dietitian onto the team staff with
-- single-use codes. Staff join an EXISTING team instead of minting their own; every staff
-- member passes is_staff_of_team() so the 0055 standards editor and rosters just work.
--
-- GUARDRAIL: authored by direction of the founder 2026-07-14; apply with supabase db push.

alter type staff_role add value if not exists 'nutritionist';

create table if not exists staff_invites (
  id         uuid primary key default gen_random_uuid(),
  team_id    uuid not null references teams(id) on delete cascade,
  role       staff_role not null default 'assistant',
  code       text not null unique,
  created_by uuid not null references profiles(id),
  created_at timestamptz not null default now(),
  used_by    uuid references profiles(id),
  used_at    timestamptz
);
alter table staff_invites enable row level security;
create policy staff_invites_read on staff_invites for select using (is_staff_of_team(team_id));
grant select on staff_invites to authenticated;

create or replace function is_head_coach_of(t uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from team_staff s
    where s.team_id = t and s.staff_id = auth.uid() and s.role = 'head_coach' and s.status = 'active'
  );
$$;
revoke all on function is_head_coach_of(uuid) from public;
grant execute on function is_head_coach_of(uuid) to authenticated;

-- Head coach mints a single-use staff code (same unambiguous alphabet as join codes).
create or replace function create_staff_invite(p_team uuid, p_role text) returns text
language plpgsql security definer set search_path = public as $$
declare
  chars text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  c text; i int; taken bool;
begin
  if not is_head_coach_of(p_team) then
    raise exception 'Only the head coach can invite staff.';
  end if;
  if p_role not in ('assistant', 'nutritionist') then
    raise exception 'Invite role must be assistant or nutritionist.';
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
revoke all on function create_staff_invite(uuid, text) from public;
grant execute on function create_staff_invite(uuid, text) to authenticated;

-- A signed-in coach-account redeems a staff code → active team_staff row (single use).
create or replace function join_staff(p_code text) returns table (team_id uuid, team_name text, staff_role text)
language plpgsql security definer set search_path = public as $$
declare
  inv record;
begin
  select * into inv from staff_invites si
   where si.code = upper(trim(p_code)) and si.used_by is null
   limit 1;
  if inv is null then
    raise exception 'That staff code is not valid (or was already used).';
  end if;
  insert into team_staff (team_id, staff_id, role, status)
  values (inv.team_id, auth.uid(), inv.role, 'active')
  on conflict (team_id, staff_id) do update set role = excluded.role, status = 'active';
  update staff_invites set used_by = auth.uid(), used_at = now() where id = inv.id;
  return query select t.id, t.name, inv.role::text from teams t where t.id = inv.team_id;
end; $$;
revoke all on function join_staff(text) from public;
grant execute on function join_staff(text) to authenticated;

-- Head coach removes a staff member (never themselves / never the head coach row).
create or replace function revoke_staff(p_team uuid, p_staff uuid) returns boolean
language plpgsql security definer set search_path = public as $$
declare
  hit int;
begin
  if not is_head_coach_of(p_team) then
    raise exception 'Only the head coach can remove staff.';
  end if;
  delete from team_staff
   where team_id = p_team and staff_id = p_staff and role <> 'head_coach';
  get diagnostics hit = row_count;
  return hit > 0;
end; $$;
revoke all on function revoke_staff(uuid, uuid) from public;
grant execute on function revoke_staff(uuid, uuid) to authenticated;

-- Staff roster with display names (profiles RLS would block a client-side join).
create or replace function team_staff_list(p_team uuid)
returns table (staff_id uuid, role text, status text, name text)
language sql stable security definer set search_path = public as $$
  select s.staff_id, s.role::text, s.status,
         coalesce(nullif(trim(p.coach_display_name), ''), p.full_name, 'Staff') as name
  from team_staff s left join profiles p on p.id = s.staff_id
  where s.team_id = p_team and is_staff_of_team(p_team)
  order by (s.role = 'head_coach') desc, p.full_name;
$$;
revoke all on function team_staff_list(uuid) from public;
grant execute on function team_staff_list(uuid) to authenticated;
