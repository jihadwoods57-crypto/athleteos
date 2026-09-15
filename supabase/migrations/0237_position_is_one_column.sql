-- 0237 — an athlete's position is one fact, read from one place.
--
-- THE BUG (founder 2026-09-15: "it has a fake position QB even though Jihad Woods is a
-- linebacker"). Two columns held the position: athlete_profiles.position, which the athlete
-- edits from their profile, and team_members.position, a SNAPSHOT copied once at join_team and
-- never updated (join_team's on-conflict only touched status). The coach's roster, the athlete
-- header, the position filter chips, the standards resolver (0142 athlete_governing_plan_style)
-- and the staff scope wall (0078) all read the snapshot. An athlete who joined as 'QB' and later
-- set 'LB' stayed a quarterback to their coach forever. No RPC let a coach correct it.
--
-- THE FIX, in three parts, all backward compatible:
--   1. team_members.position follows athlete_profiles.position: a trigger syncs every active
--      membership whenever the athlete's own position changes, and a one-time backfill catches
--      every membership that already drifted. Every reader of team_members.position is right
--      again without changing.
--   2. team_roster prefers the athlete's own column when it is set (belt and braces: the same
--      answer even if a trigger ever lapses).
--   3. coach_set_athlete_position lets active staff correct a position from the athlete card.
--      It writes athlete_profiles.position (the source), and the trigger carries it down.

-- 1. sync down --------------------------------------------------------------------------------
create or replace function public.tg_sync_position_to_memberships()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.position is distinct from old.position then
    update team_members set position = nullif(trim(new.position), '')
      where athlete_id = new.athlete_id and status = 'active';
  end if;
  return new;
end; $$;
drop trigger if exists trg_sync_position_to_memberships on public.athlete_profiles;
create trigger trg_sync_position_to_memberships
  after update of position on public.athlete_profiles
  for each row execute function public.tg_sync_position_to_memberships();

-- Backfill every drifted snapshot. Only where the athlete has actually set a position: a null
-- on the profile must not blank a membership the coach set at join time.
update team_members m
   set position = nullif(trim(ap.position), '')
  from athlete_profiles ap
 where ap.athlete_id = m.athlete_id
   and nullif(trim(ap.position), '') is not null
   and m.position is distinct from nullif(trim(ap.position), '');

-- 2. the roster reads the athlete's own column first --------------------------------------------
drop function if exists team_roster(uuid);
create or replace function team_roster(team uuid)
returns table (athlete_id uuid, athlete_name text, "position" text, joined_at timestamptz, room_id uuid)
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_team_staff(team) then
    raise exception 'not authorized for this team';
  end if;
  return query
    select m.athlete_id, p.full_name,
           coalesce(nullif(trim(ap.position), ''), m.position) as "position",
           m.joined_at, m.room_id
    from team_members m
    join profiles p on p.id = m.athlete_id
    left join athlete_profiles ap on ap.athlete_id = m.athlete_id
    where m.team_id = team and m.status = 'active'
      and not staff_scope_blocks(m.athlete_id)
    order by coalesce(p.full_name, ''), m.joined_at;
end; $$;
grant execute on function team_roster(uuid) to authenticated;

-- 3. staff may correct it ---------------------------------------------------------------------
create or replace function public.coach_set_athlete_position(p_athlete uuid, p_position text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_pos text := nullif(trim(p_position), '');
begin
  if v_pos is not null and length(v_pos) > 24 then
    raise exception 'position too long';
  end if;
  -- Active staff of a team the athlete is on, or the owner of a practice they are a client of.
  if not exists (
    select 1 from team_members m join team_staff s on s.team_id = m.team_id
     where m.athlete_id = p_athlete and m.status = 'active'
       and s.staff_id = auth.uid() and s.status = 'active'
  ) and not exists (
    select 1 from practice_clients pc join practices pr on pr.id = pc.practice_id
     where pc.athlete_id = p_athlete and pc.status = 'active' and pr.owner_id = auth.uid()
  ) then
    raise exception 'not authorized for this athlete';
  end if;
  insert into athlete_profiles (athlete_id, position) values (p_athlete, v_pos)
    on conflict (athlete_id) do update set position = excluded.position, updated_at = now();
  -- The trigger fires on UPDATE only; a fresh INSERT path syncs here.
  update team_members set position = v_pos where athlete_id = p_athlete and status = 'active';
end; $$;
revoke execute on function public.coach_set_athlete_position(uuid, text) from public, anon;
grant execute on function public.coach_set_athlete_position(uuid, text) to authenticated;
