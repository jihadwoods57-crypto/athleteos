-- OnStandard — Requirements Engine (WS3 of the coach-experience overhaul, founder-approved
-- 2026-07-14; spec: docs/superpowers/specs/2026-07-14-coach-experience-overhaul-design.md).
--
-- Two primitives:
--   requirement_sets        — the STANDING standard, scoped team-wide / position-room /
--                             per-athlete. Resolution precedence (client): athlete > position
--                             > team > the built-in catalog. Items are catalog-shaped JSONB,
--                             validated inside the founder-ratified rails (meals 1–6/day,
--                             lifts 0–7/week, proof always one of the real proof types).
--   requirement_assignments — ONE-OFF dated obligations (the coach + button). Fanned out one
--                             row per athlete by a definer RPC so RLS stays row-simple and
--                             each athlete carries their own status.
--
-- The scoring formula is untouched (DECISION-MEMO D3): coaches set the WORK, src/core keeps
-- the score. All writes go through SECURITY DEFINER RPCs (0027 pattern) — no direct inserts.
--
-- GUARDRAIL: authored only; the founder applies it at go-live (like 0004+).

-- ---------------------------------------------------------------- staff predicate
-- 0002's is_team_coach_of(athlete) keys on an ATHLETE; set/assignment checks key on a TEAM.
create or replace function is_staff_of_team(t uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from team_staff s
    where s.team_id = t and s.staff_id = auth.uid() and s.status = 'active'
  );
$$;
revoke all on function is_staff_of_team(uuid) from public;
grant execute on function is_staff_of_team(uuid) to authenticated;

-- ---------------------------------------------------------------- requirement_sets
create table if not exists requirement_sets (
  id          uuid primary key default gen_random_uuid(),
  team_id     uuid not null references teams(id) on delete cascade,
  scope_kind  text not null check (scope_kind in ('team','position','athlete')),
  scope_value text,          -- null (team) | position string | athlete uuid-as-text
  items       jsonb not null,
  created_by  uuid not null references profiles(id),
  updated_at  timestamptz not null default now(),
  constraint requirement_sets_scope_shape check (
    (scope_kind = 'team' and scope_value is null)
    or (scope_kind <> 'team' and scope_value is not null
        and length(scope_value) between 1 and 40)
  )
);
-- one active set per (team, scope); expression index so team-scope (null) is unique too
create unique index if not exists requirement_sets_unique_scope
  on requirement_sets (team_id, scope_kind, coalesce(scope_value, ''));

-- Items shape guard — the honesty rails live in the DB, not just the client.
-- Each item: { id, title, kind, proof } (+ optional freq/window/note the client understands).
-- kind counts enforce the founder-ratified rails: meals 1–6 per day, lifts 0–7 per week.
create or replace function validate_requirement_items(items jsonb) returns boolean
language plpgsql immutable as $$
declare
  it jsonb; meals int := 0; lifts int := 0;
begin
  if items is null or jsonb_typeof(items) <> 'array' then return false; end if;
  if jsonb_array_length(items) < 1 or jsonb_array_length(items) > 24 then return false; end if;
  for it in select * from jsonb_array_elements(items) loop
    if jsonb_typeof(it) <> 'object' then return false; end if;
    if not (it ? 'id' and it ? 'title' and it ? 'kind' and it ? 'proof') then return false; end if;
    if length(it->>'id') > 40 or length(it->>'title') > 80 then return false; end if;
    if (it->>'proof') not in ('photo','form','scale','counter','check') then return false; end if;
    if (it->>'kind') not in ('meal','lift','hydration','recovery','weigh','checkin','custom') then return false; end if;
    if (it->>'kind') = 'meal' then meals := meals + 1; end if;
    if (it->>'kind') = 'lift' then lifts := lifts + 1; end if;
  end loop;
  return meals between 1 and 6 and lifts between 0 and 7;
end; $$;
revoke all on function validate_requirement_items(jsonb) from public;
grant execute on function validate_requirement_items(jsonb) to authenticated;

alter table requirement_sets
  add constraint requirement_sets_items_valid check (validate_requirement_items(items));

alter table requirement_sets enable row level security;
-- Staff and active members read; ALL writes go through set_team_requirements() below
-- (table grants are select-only, so there is no direct write path to police).
create policy req_sets_staff_read on requirement_sets
  for select using (is_staff_of_team(team_id));
create policy req_sets_member_read on requirement_sets
  for select using (exists (
    select 1 from team_members tm
    where tm.team_id = requirement_sets.team_id
      and tm.athlete_id = auth.uid() and tm.status = 'active'
  ));

-- Staff upsert helper (WS5 Plan editor lands on this; usable from SQL today).
create or replace function set_team_requirements(
  p_team uuid, p_scope_kind text, p_scope_value text, p_items jsonb
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  set_id uuid;
begin
  if not is_staff_of_team(p_team) then
    raise exception 'Only team staff can set requirements.';
  end if;
  insert into requirement_sets (team_id, scope_kind, scope_value, items, created_by)
  values (p_team, p_scope_kind, nullif(p_scope_value, ''), p_items, auth.uid())
  on conflict (team_id, scope_kind, coalesce(scope_value, ''))
  do update set items = excluded.items, created_by = excluded.created_by, updated_at = now()
  returning id into set_id;
  return set_id;
end; $$;
revoke all on function set_team_requirements(uuid, text, text, jsonb) from public;
grant execute on function set_team_requirements(uuid, text, text, jsonb) to authenticated;

-- ---------------------------------------------------------------- requirement_assignments
create table if not exists requirement_assignments (
  id          uuid primary key default gen_random_uuid(),
  team_id     uuid not null references teams(id) on delete cascade,
  athlete_id  uuid not null references profiles(id) on delete cascade,
  title       text not null check (length(trim(title)) between 2 and 80),
  note        text check (note is null or length(note) <= 280),
  proof       text not null default 'check' check (proof in ('photo','form','scale','counter','check')),
  due_at      timestamptz,
  due_label   text check (due_label is null or length(due_label) <= 40),
  status      text not null default 'open' check (status in ('open','done','cancelled')),
  done_at     timestamptz,
  created_by  uuid not null references profiles(id),
  created_at  timestamptz not null default now()
);
create index if not exists requirement_assignments_athlete
  on requirement_assignments (athlete_id, status, created_at desc);
create index if not exists requirement_assignments_team
  on requirement_assignments (team_id, created_at desc);

alter table requirement_assignments enable row level security;
-- Read: the athlete their own, staff their team's. ALL writes via the definer RPCs below —
-- no direct insert/update policies, so a client can never forge or edit rows (0027 pattern).
create policy req_asg_read on requirement_assignments
  for select using (athlete_id = auth.uid() or is_staff_of_team(team_id));

-- The + button: fan out one row per matched athlete, notify each (0027 notify()).
create or replace function assign_requirement(
  p_team uuid, p_scope_kind text, p_scope_value text,
  p_title text, p_proof text default 'check',
  p_due_at timestamptz default null, p_due_label text default null,
  p_note text default null
) returns int
language plpgsql security definer set search_path = public as $$
declare
  n int := 0; ath record;
begin
  if not is_staff_of_team(p_team) then
    raise exception 'Only team staff can assign.';
  end if;
  if p_scope_kind not in ('team','position','athlete') then
    raise exception 'Bad scope.';
  end if;
  for ath in
    select tm.athlete_id from team_members tm
    where tm.team_id = p_team and tm.status = 'active'
      and (p_scope_kind = 'team'
        or (p_scope_kind = 'position' and upper(coalesce(tm.position, '')) = upper(coalesce(p_scope_value, '')))
        or (p_scope_kind = 'athlete' and tm.athlete_id = p_scope_value::uuid))
  loop
    insert into requirement_assignments
      (team_id, athlete_id, title, note, proof, due_at, due_label, created_by)
    values
      (p_team, ath.athlete_id, trim(p_title), nullif(trim(coalesce(p_note, '')), ''),
       coalesce(p_proof, 'check'), p_due_at, nullif(trim(coalesce(p_due_label, '')), ''), auth.uid());
    perform notify(ath.athlete_id, 'assignment',
      'New from your coach: ' || trim(p_title),
      coalesce(nullif(trim(coalesce(p_due_label, '')), ''), 'On your list now'));
    n := n + 1;
  end loop;
  return n;
end; $$;
revoke all on function assign_requirement(uuid, text, text, text, text, timestamptz, text, text) from public;
grant execute on function assign_requirement(uuid, text, text, text, text, timestamptz, text, text) to authenticated;

-- Athlete completes their own OPEN assignment; anything else is a no-op (returns false).
create or replace function complete_assignment(p_id uuid) returns boolean
language plpgsql security definer set search_path = public as $$
declare
  hit int;
begin
  update requirement_assignments
     set status = 'done', done_at = now()
   where id = p_id and athlete_id = auth.uid() and status = 'open';
  get diagnostics hit = row_count;
  return hit > 0;
end; $$;
revoke all on function complete_assignment(uuid) from public;
grant execute on function complete_assignment(uuid) to authenticated;

-- Staff cancels an open assignment (mis-fire, athlete excused).
create or replace function cancel_assignment(p_id uuid) returns boolean
language plpgsql security definer set search_path = public as $$
declare
  hit int;
begin
  update requirement_assignments ra
     set status = 'cancelled'
   where ra.id = p_id and ra.status = 'open' and is_staff_of_team(ra.team_id);
  get diagnostics hit = row_count;
  return hit > 0;
end; $$;
revoke all on function cancel_assignment(uuid) from public;
grant execute on function cancel_assignment(uuid) to authenticated;

-- ---------------------------------------------------------------- table grants (0005 lesson)
-- RLS decides rows; roles still need table-level privileges. Select only — writes are RPC-only.
grant select on requirement_sets to authenticated;
grant select on requirement_assignments to authenticated;
