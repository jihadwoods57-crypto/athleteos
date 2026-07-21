-- OnStandard — room assignment (T-04 slice 2): put athletes IN rooms.
--
-- Slice 1 (0087) created the room object. This adds the membership link and the assignment
-- lifecycle: team_members.room_id, auto-assignment by position on join, a staff reassignment RPC,
-- and room_id on the team_roster read so the coach view can resolve a room-scoped standard.
--
-- PARITY: every existing member has room_id NULL, and the client resolves a room-scoped standard
-- only when room_id is set (falling back to the raw position exactly as before). So nothing about
-- any current athlete's scored day changes until a coach actually assigns rooms.
--
-- Deliberately NOT here (slice 3): a room-scoped-standard editor UI, staff-owner scoping of who can
-- reassign, and the Needs-Assignment count as a server view (it's client-derived for now).
--
-- GUARDRAIL: authored + statically reviewed; NOT applied to live here (founder applies via
-- `supabase db push` + `npm run test:rls` at the next go-live batch). Forward-only, idempotent.

-- The athlete's assigned room. on delete set null: deleting a room un-assigns its members (they
-- fall back to position-based resolution), never cascades away the membership.
alter table team_members add column if not exists room_id uuid references team_rooms(id) on delete set null;
create index if not exists team_members_room on team_members(room_id) where room_id is not null;

-- Slug a position string to a room key the same way the client does (rooms.js slugifyRoomKey):
-- lowercase, non-alphanumerics → single dashes, trimmed, capped at 40. Used to auto-map a joining
-- athlete's position to a room.
create or replace function slug_room_key(s text) returns text
language sql immutable set search_path = public as $$
  select left(trim(both '-' from regexp_replace(lower(coalesce(s, '')), '[^a-z0-9]+', '-', 'g')), 40);
$$;

-- join_team, extended: after the athlete joins, auto-assign them to the room whose key matches their
-- position slug (if such a room exists and they aren't already assigned). Everything else is the
-- 0080 behavior verbatim (expiry check, upsert, return the team id).
create or replace function join_team(code text, athlete_position text default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare t uuid; exp timestamptz;
begin
  select id, join_code_expires_at into t, exp from teams where join_code = code;
  if t is null then raise exception 'invalid team code'; end if;
  if exp is not null and exp < now() then
    raise exception 'this team code has expired — ask your coach for a new one';
  end if;
  insert into team_members (team_id, athlete_id, position, status)
  values (t, auth.uid(), athlete_position, 'active')
  on conflict (team_id, athlete_id) do update set status = 'active';
  -- Auto-assign by position, only when unassigned (never clobber a manual reassignment on re-join).
  update team_members tm set room_id = r.id
    from team_rooms r
    where tm.team_id = t and tm.athlete_id = auth.uid()
      and tm.room_id is null
      and r.team_id = t and r.key = slug_room_key(athlete_position)
      and slug_room_key(athlete_position) <> '';
  return t;
end; $$;

-- Staff reassignment: move an athlete to a room on the coach's team, or null to un-assign. Coach-only
-- (must be the athlete's active team coach), and the room must belong to that same team.
create or replace function assign_athlete_room(p_athlete uuid, p_room uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_team uuid;
begin
  if not is_team_coach_of(p_athlete) then
    raise exception 'not authorized to assign this athlete';
  end if;
  select m.team_id into v_team
    from team_members m
    join team_staff s on s.team_id = m.team_id
    where m.athlete_id = p_athlete and m.status = 'active'
      and s.staff_id = auth.uid() and s.status = 'active'
    limit 1;
  if v_team is null then raise exception 'no shared team with this athlete'; end if;
  if p_room is not null and not exists (select 1 from team_rooms where id = p_room and team_id = v_team) then
    raise exception 'room is not on this team';
  end if;
  update team_members set room_id = p_room where athlete_id = p_athlete and team_id = v_team;
end; $$;

grant execute on function assign_athlete_room(uuid, uuid) to authenticated;

-- team_roster now carries room_id so the coach view can resolve a room-scoped standard and render
-- room membership. Additive: supabase-js keys results by column name, so existing callers ignore it.
create or replace function team_roster(team uuid)
returns table (athlete_id uuid, athlete_name text, "position" text, joined_at timestamptz, room_id uuid)
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_team_staff(team) then
    raise exception 'not authorized for this team';
  end if;
  return query
    select m.athlete_id, p.full_name, m.position, m.joined_at, m.room_id
    from team_members m join profiles p on p.id = m.athlete_id
    where m.team_id = team and m.status = 'active'
      and not staff_scope_blocks(m.athlete_id)
    order by coalesce(p.full_name, ''), m.joined_at;
end; $$;
