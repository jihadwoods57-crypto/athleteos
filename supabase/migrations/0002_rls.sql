-- OnStandard — Phase 2 Row-Level Security + secure RPCs
-- Helpers are SECURITY DEFINER so policies can read the link tables without
-- recursing into their own RLS. search_path is locked to public.

-- ---------------------------------------------------------------- helpers
create or replace function is_self(athlete uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select auth.uid() = athlete;
$$;

create or replace function is_team_coach_of(athlete uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from team_members m
    join team_staff s on s.team_id = m.team_id
    where m.athlete_id = athlete and m.status = 'active'
      and s.staff_id = auth.uid() and s.status = 'active');
$$;

create or replace function is_trainer_of(athlete uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from practice_clients pc
    join practices p on p.id = pc.practice_id
    where pc.client_id = athlete and pc.status = 'active'
      and p.owner_id = auth.uid());
$$;

create or replace function is_guardian_of(athlete uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from guardianships g
    where g.athlete_id = athlete and g.guardian_id = auth.uid() and g.status = 'active');
$$;

-- can auth.uid() VIEW this athlete's data?
create or replace function can_view(athlete uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select is_self(athlete) or is_team_coach_of(athlete)
      or is_trainer_of(athlete) or is_guardian_of(athlete);
$$;

-- is auth.uid() active staff on this team? (for managing team rows)
create or replace function is_team_staff(team uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from team_staff s
    where s.team_id = team and s.staff_id = auth.uid() and s.status = 'active');
$$;

create or replace function owns_practice(practice uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from practices p where p.id = practice and p.owner_id = auth.uid());
$$;

-- are auth.uid() and `other` connected in either direction? (for reading profiles)
create or replace function connected(other uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select is_self(other) or can_view(other)
    or exists (select 1 from team_members m join team_staff s on s.team_id = m.team_id
               where m.athlete_id = auth.uid() and m.status='active'
                 and s.staff_id = other and s.status='active')
    or exists (select 1 from practice_clients pc join practices p on p.id = pc.practice_id
               where pc.client_id = auth.uid() and pc.status='active' and p.owner_id = other)
    or exists (select 1 from guardianships g
               where g.athlete_id = auth.uid() and g.guardian_id = other and g.status='active');
$$;

-- ---------------------------------------------------------------- enable RLS
alter table profiles          enable row level security;
alter table orgs              enable row level security;
alter table teams             enable row level security;
alter table practices         enable row level security;
alter table team_members      enable row level security;
alter table team_staff        enable row level security;
alter table practice_clients  enable row level security;
alter table guardianships     enable row level security;
alter table athlete_profiles  enable row level security;
alter table days              enable row level security;
alter table meals             enable row level security;
alter table checkins          enable row level security;
alter table threads           enable row level security;
alter table messages          enable row level security;

-- ---------------------------------------------------------------- profiles
create policy profiles_read on profiles for select using (connected(id));
create policy profiles_self_write on profiles for update using (id = auth.uid()) with check (id = auth.uid());

-- ---------------------------------------------------------------- athlete data: read = can_view, write = self
create policy ap_read   on athlete_profiles for select using (can_view(athlete_id));
create policy ap_write  on athlete_profiles for insert with check (is_self(athlete_id));
create policy ap_update on athlete_profiles for update using (is_self(athlete_id)) with check (is_self(athlete_id));
-- (coach edits targets/season_goal via coach_set_goals() RPC below — not a direct UPDATE)

create policy days_read   on days for select using (can_view(athlete_id));
create policy days_write  on days for insert with check (is_self(athlete_id));
create policy days_update on days for update using (is_self(athlete_id)) with check (is_self(athlete_id));
create policy days_delete on days for delete using (is_self(athlete_id));

create policy meals_read   on meals for select using (can_view(athlete_id));
create policy meals_write  on meals for insert with check (is_self(athlete_id));
create policy meals_update on meals for update using (is_self(athlete_id)) with check (is_self(athlete_id));
create policy meals_delete on meals for delete using (is_self(athlete_id));

create policy ci_read   on checkins for select using (can_view(athlete_id));
create policy ci_write  on checkins for insert with check (is_self(athlete_id));
create policy ci_update on checkins for update using (is_self(athlete_id)) with check (is_self(athlete_id));

-- ---------------------------------------------------------------- orgs / teams / practices
create policy orgs_read on orgs for select using (true);
create policy orgs_write on orgs for insert with check (created_by = auth.uid());

create policy teams_read on teams for select using (
  is_team_staff(id) or exists (select 1 from team_members m
    where m.team_id = teams.id and m.athlete_id = auth.uid() and m.status='active'));
create policy teams_create on teams for insert with check (created_by = auth.uid());
create policy teams_update on teams for update using (is_team_staff(id)) with check (is_team_staff(id));

create policy practices_read on practices for select using (
  owner_id = auth.uid() or exists (select 1 from practice_clients pc
    where pc.practice_id = practices.id and pc.client_id = auth.uid() and pc.status='active'));
create policy practices_write on practices for insert with check (owner_id = auth.uid());
create policy practices_update on practices for update using (owner_id = auth.uid());

-- ---------------------------------------------------------------- link tables
-- members visible to the athlete (their own) and team staff; managed by staff. Joining via RPC.
create policy tm_read   on team_members for select using (athlete_id = auth.uid() or is_team_staff(team_id));
create policy tm_manage on team_members for all using (is_team_staff(team_id)) with check (is_team_staff(team_id));

create policy ts_read   on team_staff for select using (staff_id = auth.uid() or is_team_staff(team_id));
create policy ts_manage on team_staff for all using (is_team_staff(team_id)) with check (is_team_staff(team_id));

create policy pc_read   on practice_clients for select using (client_id = auth.uid() or owns_practice(practice_id));
create policy pc_manage on practice_clients for all using (owns_practice(practice_id)) with check (owns_practice(practice_id));

create policy g_read   on guardianships for select using (athlete_id = auth.uid() or guardian_id = auth.uid());
create policy g_manage on guardianships for all using (guardian_id = auth.uid()) with check (guardian_id = auth.uid());

-- ---------------------------------------------------------------- messaging
create policy threads_rw on threads for all
  using (athlete_id = auth.uid() or counterpart_id = auth.uid())
  with check (athlete_id = auth.uid() or counterpart_id = auth.uid());

create policy messages_read on messages for select using (
  exists (select 1 from threads t where t.id = messages.thread_id
          and (t.athlete_id = auth.uid() or t.counterpart_id = auth.uid())));
create policy messages_write on messages for insert with check (
  sender_id = auth.uid() and exists (select 1 from threads t where t.id = thread_id
          and (t.athlete_id = auth.uid() or t.counterpart_id = auth.uid())));

-- ---------------------------------------------------------------- secure RPCs (join by code, coach goals)
-- Athletes join via code without read access to the codes table.
create or replace function join_team(code text, athlete_position text default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare t uuid;
begin
  select id into t from teams where join_code = code;
  if t is null then raise exception 'invalid team code'; end if;
  insert into team_members (team_id, athlete_id, position, status)
  values (t, auth.uid(), athlete_position, 'active')
  on conflict (team_id, athlete_id) do update set status = 'active';
  return t;
end; $$;

create or replace function join_practice(code text) returns uuid
language plpgsql security definer set search_path = public as $$
declare p uuid;
begin
  select id into p from practices where join_code = code;
  if p is null then raise exception 'invalid practice code'; end if;
  insert into practice_clients (practice_id, client_id, status, last_active_at)
  values (p, auth.uid(), 'active', now())
  on conflict (practice_id, client_id) do update set status = 'active';
  return p;
end; $$;

-- Coach (or trainer) adjusts an athlete's targets / season goal. Gated to overseers.
create or replace function coach_set_goals(athlete uuid, new_targets jsonb, new_season_goal jsonb) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not (is_team_coach_of(athlete) or is_trainer_of(athlete)) then
    raise exception 'not authorized to set goals for this athlete';
  end if;
  update athlete_profiles
     set targets = coalesce(new_targets, targets),
         season_goal = coalesce(new_season_goal, season_goal),
         updated_at = now()
   where athlete_id = athlete;
end; $$;

-- NOTE (optional hardening): the Athlete Score is computed by the pure TS engine in
-- src/core and stored on days.score. To prevent a tampered client posting a fake score,
-- add a BEFORE INSERT/UPDATE trigger (or edge function) that recomputes score from the raw
-- meals/tasks/checkin columns. Keep src/core as the canonical formula to avoid drift —
-- a Postgres reimplementation must be kept byte-for-byte in sync with computeDerived().
