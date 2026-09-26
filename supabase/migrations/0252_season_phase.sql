-- OnStandard 0252: the season phase (goals and eating plan, phase B, 2026-09-26).
--
-- Founder, 2026-09-26: the app needs to know what part of the season the team is in. A phase is
-- one of four words, and it belongs to the TEAM:
--   off   Off-season   (build)
--   pre   Pre-season   (ramp up)
--   in    In-season    (perform and recover)
--   post  Post-season  (recover and reset)
-- It nudges GOAL-DERIVED calories only (proto js/state.js goalDerivedTargets holds the table; the
-- device, the coach reconstruction and the Why screen all run that one function). Coach-set
-- numbers are never touched. The server never derives a calorie target at all (0193's evidence
-- ceiling refused a partial reimplementation of the engine, and every edge function reads the
-- targets the device pushes), so there is no second table here to drift.
--
-- 1. teams.season_phase + teams.season_phase_at. Null = not set, which behaves exactly as today.
--    WHO MAY SET IT is who may edit the team's standards: the staff roles proto
--    js/staff-access.js CREATE_CAPS gives 'standards' (head coach, coordinator and the legacy
--    'assistant' that folds into it, nutritionist, S&C, team admin). View-only staff, position
--    coaches and athletic trainers read it and never change it. teams_update (0002) lets ANY
--    active staffer update the row directly, readonly included, so the wall is a trigger on the
--    column rather than a policy: the RPC below and a direct update both go through it.
-- 2. athlete_profiles.season_phase: a SOLO athlete's own phase (no active team, no trainer). An
--    athlete on a team always uses the team's; a trainer's client has no season unless they are
--    also on a team. Written only through set_my_season_phase (self-only, refuses a team athlete
--    or a practice client). athlete_profiles is fenced by COLUMN grants (0103 select, 0210
--    insert/update, see 0231's hotfix), so the new column is added to the select wall here and
--    deliberately NOT to the write wall: the RPC is its only door.
-- 3. season_phase_for(athlete): the ONE resolution (team phase, else nothing for a practice
--    client, else their own), read by the athlete's device, the coach's reconstruction and the
--    edge functions, so all three agree on which phase applies.
--
-- Additive and idempotent. Safe before or after the client and functions that use it: both treat
-- the columns and RPCs as optional and fall back to "no phase", which is today's behaviour.

-- ---------------------------------------------------------------- 1. the team's phase
alter table public.teams add column if not exists season_phase text;
alter table public.teams add column if not exists season_phase_at timestamptz;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'teams_season_phase_valid') then
    alter table public.teams add constraint teams_season_phase_valid
      check (season_phase is null or season_phase in ('off', 'pre', 'in', 'post'));
  end if;
end $$;

comment on column public.teams.season_phase is
  'Season phase: off | pre | in | post, null = not set. Set by staff who may edit standards (can_set_team_phase); nudges goal-derived calories only (proto state.js). 0252.';
comment on column public.teams.season_phase_at is
  'When season_phase last changed. Stamped by trg_teams_season_phase_guard. 0252.';

/* The staff who may set it: the standards editors (staff-access.js CREATE_CAPS 'standards').
   Pinned against the client list by proto js/season-phase.test.mjs. */
create or replace function can_set_team_phase(t uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from team_staff s
    where s.team_id = t and s.staff_id = auth.uid() and s.status = 'active'
      and s.role::text in ('head_coach', 'coordinator', 'assistant', 'nutritionist', 's_and_c', 'team_admin')
  );
$$;
revoke all on function can_set_team_phase(uuid) from public, anon;
grant execute on function can_set_team_phase(uuid) to authenticated;

/* The wall on the column. A change by a signed-in user must come from a standards editor; the
   service role (auth.uid() null) is support. Every change is stamped. */
create or replace function teams_season_phase_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' and new.season_phase is not distinct from old.season_phase then
    new.season_phase_at := old.season_phase_at;   -- nobody back-dates the stamp
    return new;
  end if;
  if tg_op = 'INSERT' and new.season_phase is null then
    new.season_phase_at := null;
    return new;
  end if;
  if auth.uid() is not null and tg_op = 'UPDATE' and not can_set_team_phase(new.id) then
    raise exception 'only staff who edit the team standard can set the season' using errcode = '42501';
  end if;
  new.season_phase_at := now();
  return new;
end $$;
revoke all on function teams_season_phase_guard() from public, anon, authenticated;

drop trigger if exists trg_teams_season_phase_guard on public.teams;
create trigger trg_teams_season_phase_guard
  before insert or update of season_phase, season_phase_at on public.teams
  for each row execute function teams_season_phase_guard();

/* The coach's door: validates, writes, answers what it stored. */
create or replace function set_team_season_phase(p_team uuid, p_phase text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_at timestamptz;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  if not can_set_team_phase(p_team) then
    raise exception 'only staff who edit the team standard can set the season' using errcode = '42501';
  end if;
  if p_phase is not null and p_phase not in ('off', 'pre', 'in', 'post') then
    raise exception 'unknown season phase';
  end if;
  update teams set season_phase = p_phase where id = p_team returning season_phase_at into v_at;
  return jsonb_build_object('phase', p_phase, 'at', v_at);
end $$;
revoke all on function set_team_season_phase(uuid, text) from public, anon;
grant execute on function set_team_season_phase(uuid, text) to authenticated;

-- ---------------------------------------------------------------- 2. a solo athlete's own phase
alter table public.athlete_profiles add column if not exists season_phase text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'athlete_profiles_season_phase_valid') then
    alter table public.athlete_profiles add constraint athlete_profiles_season_phase_valid
      check (season_phase is null or season_phase in ('off', 'pre', 'in', 'post'));
  end if;
end $$;

-- Inside the 0103 select wall; NOT inside the 0210 write wall (set_my_season_phase is the door).
grant select (season_phase) on table public.athlete_profiles to authenticated;

comment on column public.athlete_profiles.season_phase is
  'A SOLO athlete''s own season phase (off | pre | in | post). Ignored whenever the athlete is on a team (the team''s phase applies) or is a practice client (no season). Written only by set_my_season_phase. 0252.';

create or replace function set_my_season_phase(p_phase text) returns text
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'not signed in'; end if;
  if p_phase is not null and p_phase not in ('off', 'pre', 'in', 'post') then
    raise exception 'unknown season phase';
  end if;
  if exists (select 1 from team_members m where m.athlete_id = v_uid and m.status = 'active') then
    raise exception 'your team sets the season' using errcode = '42501';
  end if;
  if exists (select 1 from practice_clients pc where pc.client_id = v_uid and pc.status = 'active') then
    raise exception 'a practice has no season' using errcode = '42501';
  end if;
  -- Athletes only (review 2026-09-26). A coach, trainer or parent calling this must not get an
  -- athlete_profiles row minted for them, so this UPDATES an existing athlete row and never inserts.
  if not exists (select 1 from profiles p where p.id = v_uid and p.primary_role = 'athlete')
     or not exists (select 1 from athlete_profiles ap where ap.athlete_id = v_uid) then
    raise exception 'only an athlete sets their own season' using errcode = '42501';
  end if;
  update athlete_profiles set season_phase = p_phase, updated_at = now() where athlete_id = v_uid;
  return p_phase;
end $$;
revoke all on function set_my_season_phase(text) from public, anon;
grant execute on function set_my_season_phase(text) to authenticated;

-- ---------------------------------------------------------------- 3. the one resolution
/* { phase, source: 'team' | 'self' | null, team_id, at, can_set_self }
   - on an active team: that team's phase (null when the team has not set one), never their own;
   - a practice client with no team: no season at all;
   - otherwise (solo): their own.
   Readable by the athlete, by staff who can view them (can_view carries the minor-consent gate
   and keeps guardians out, 0081), and by the service role (the edge functions). */
create or replace function season_phase_for(p_athlete uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_team uuid;
  v_phase text;
  v_at timestamptz;
  v_client boolean;
begin
  if p_athlete is null then return null; end if;
  if auth.uid() is not null and not (is_self(p_athlete) or can_view(p_athlete)) then
    return null;
  end if;
  select m.team_id, t.season_phase, t.season_phase_at into v_team, v_phase, v_at
    from team_members m join teams t on t.id = m.team_id
   where m.athlete_id = p_athlete and m.status = 'active'
   order by (t.season_phase is null), m.joined_at
   limit 1;
  if v_team is not null then
    -- The phase itself is needed for target parity (a viewer reconstructs the athlete's targets),
    -- but WHICH team set it, and when, is only for the athlete, the service role, or that team's
    -- own staff: a coach of the athlete's other team must not learn it (review 2026-09-26, P10).
    if auth.uid() is not null and not is_self(p_athlete) and not exists (
      select 1 from team_staff s where s.team_id = v_team and s.staff_id = auth.uid() and s.status = 'active'
    ) then
      v_team := null; v_at := null;
    end if;
    return jsonb_build_object('phase', v_phase, 'source', case when v_phase is null then null else 'team' end,
      'team_id', v_team, 'at', v_at, 'can_set_self', false);
  end if;
  select exists (select 1 from practice_clients pc where pc.client_id = p_athlete and pc.status = 'active') into v_client;
  if v_client then
    return jsonb_build_object('phase', null, 'source', null, 'team_id', null, 'at', null, 'can_set_self', false);
  end if;
  select ap.season_phase into v_phase from athlete_profiles ap where ap.athlete_id = p_athlete;
  return jsonb_build_object('phase', v_phase, 'source', case when v_phase is null then null else 'self' end,
    'team_id', null, 'at', null, 'can_set_self', true);
end $$;
revoke all on function season_phase_for(uuid) from public, anon;
grant execute on function season_phase_for(uuid) to authenticated, service_role;
