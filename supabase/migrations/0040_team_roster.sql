-- OnStandard — the coach's ACTIVE roster read (names included).
--
-- THE HOLE: the live coach dashboard was projected purely from today's `days` rows
-- (fetchLinkedDays), so (a) an athlete who hadn't logged today was completely absent
-- from Roster / Needs Attention / KPIs — the SILENT athlete, the exact person an
-- accountability product exists to surface — and (b) active members' names were
-- unreadable (profiles_read requires the link, but the roster list never had the
-- member list to begin with), so real athletes rendered as "#a3f2". The only named
-- read was pending_team_requests — names existed in the inbox, then vanished on
-- approve.
--
-- THE FIX: the exact mirror of pending_team_requests (0024) for ACTIVE members,
-- gated to the team's active staff. The client merges this member list with today's
-- (and yesterday's) `days` rows: members without a row render "not logged", members
-- with one get their real name, position, and a real trend direction.
create or replace function team_roster(team uuid)
returns table (athlete_id uuid, athlete_name text, "position" text, joined_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_team_staff(team) then
    raise exception 'not authorized for this team';
  end if;
  return query
    select m.athlete_id, p.full_name, m.position, m.joined_at
    from team_members m join profiles p on p.id = m.athlete_id
    where m.team_id = team and m.status = 'active'
    order by coalesce(p.full_name, ''), m.joined_at;
end; $$;

-- The same hole existed for trainers, one step worse: the approve inbox flipped a
-- REAL practice_clients row to active, then the trainer had NO surface that could
-- ever show that client again ("approve into a void"). Mirror read for the book.
create or replace function practice_roster(practice uuid)
returns table (client_id uuid, client_name text, joined_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  if not owns_practice(practice) then
    raise exception 'not authorized for this practice';
  end if;
  return query
    select pc.client_id, p.full_name, pc.last_active_at
    from practice_clients pc join profiles p on p.id = pc.client_id
    where pc.practice_id = practice and pc.status = 'active'
    order by coalesce(p.full_name, ''), pc.last_active_at;
end; $$;

-- 0035 made new functions secure-by-default (no auto EXECUTE): grant the client role
-- explicitly, and belt-and-braces revoke the public/anon inheritance path.
revoke execute on function team_roster(uuid) from public, anon;
grant  execute on function team_roster(uuid) to authenticated;
revoke execute on function practice_roster(uuid) from public, anon;
grant  execute on function practice_roster(uuid) to authenticated;
