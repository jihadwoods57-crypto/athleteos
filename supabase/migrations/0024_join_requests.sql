-- OnStandard — linking feature, Stage 2b: athlete-first discovery + join requests.
-- The "second door": an athlete searches their school, finds a discoverable team, and
-- requests to join; the coach approves (a plain status update, allowed by tm_manage).
-- Discovery + resolve must be SECURITY DEFINER because a non-member cannot read `teams`
-- (teams_read is staff/active-member only) — these return ONLY safe display columns.
--
-- GUARDRAIL: authored only; the founder applies it at go-live (like 0004+).

-- Head-coach display name for a team (safe column helper used by discovery/resolve).
create or replace function team_head_coach_name(team uuid) returns text
language sql stable security definer set search_path = public as $$
  select p.full_name
  from team_staff s join profiles p on p.id = s.staff_id
  where s.team_id = team and s.role = 'head_coach' and s.status = 'active'
  limit 1;
$$;

-- Discoverable teams at a school (athlete-first search). Only teams the coach opted in
-- (discoverable=true) are returned, and only safe display columns — never the join_code.
create or replace function discover_teams(org uuid)
returns table (id uuid, name text, sport text, coach_name text)
language sql stable security definer set search_path = public as $$
  select t.id, t.name, t.sport, team_head_coach_name(t.id)
  from teams t
  where t.org_id = org and t.discoverable
  order by t.name;
$$;

-- Resolve a join code to a confirm-screen preview (coach + school) WITHOUT joining, so
-- an athlete entering a code sees "Join Coach Davis · Eastside HS?" before committing.
create or replace function resolve_team_code(code text)
returns table (id uuid, name text, sport text, coach_name text, school text)
language sql stable security definer set search_path = public as $$
  select t.id, t.name, t.sport, team_head_coach_name(t.id),
         (select o.name from orgs o where o.id = t.org_id)
  from teams t
  where t.join_code = code;
$$;

-- Athlete requests to join a discoverable team → a 'pending' member row for auth.uid().
-- Requesting is only allowed on discoverable teams (else it could probe arbitrary team
-- ids). `on conflict do nothing` NEVER downgrades an already-active membership.
create or replace function request_join_team(team uuid, athlete_position text default null)
returns uuid
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then
    raise exception 'must be signed in to request to join';
  end if;
  if not exists (select 1 from teams t where t.id = team and t.discoverable) then
    raise exception 'this team is not open to join requests';
  end if;
  insert into team_members (team_id, athlete_id, position, status)
  values (team, auth.uid(), athlete_position, 'pending')
  on conflict (team_id, athlete_id) do nothing;
  return team;
end; $$;

-- Pending join requests for a team, with the requester's name (which the coach can't
-- read directly — RLS profiles_read requires an ACTIVE link, and a request is pending).
-- Gated to the team's active staff. Powers the coach's "Pending requests" inbox.
create or replace function pending_team_requests(team uuid)
returns table (athlete_id uuid, athlete_name text, position text, requested_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_team_staff(team) then
    raise exception 'not authorized for this team';
  end if;
  return query
    select m.athlete_id, p.full_name, m.position, m.joined_at
    from team_members m join profiles p on p.id = m.athlete_id
    where m.team_id = team and m.status = 'pending'
    order by m.joined_at desc;
end; $$;

-- NOTE: approve = `update team_members set status='active'` and decline = `delete`, both
-- already permitted to a team's staff by the tm_manage policy (0002) — no RPC needed.
