-- OnStandard — Connected Standards (slice 1): the wearable-verified activity primitive.
--
-- WHAT THIS IS
-- A coach, trainer, or the athlete themselves defines a measurable activity requirement —
-- "10,000 steps Monday through Friday", "a 2.5 mile run before 7:00 PM", "12 miles this week" —
-- and the platform decides whether it was met from health data the athlete's phone already has.
-- Each dated occurrence becomes a connected_standard_instances row, and each athlete in the
-- audience gets exactly one connected_standard_results row carrying progress and a verdict.
--
-- WHY A NEW PRIMITIVE (and not requirement_sets.items)
-- requirement_sets (0055) models a STANDING obligation as a jsonb items array validated by
-- validate_requirement_items — one row per (book, scope), no per-athlete state. Connected
-- Standards needs per-athlete, per-period progress that changes all day long, a nine-value
-- verification verdict, and a weekly accumulation window. None of that fits inside an items
-- array, and bending requirement_sets to hold it would drag the SCORED day along with it.
-- This lands as its own primitive, mirroring Verified Commitments (0138) almost line for line.
--
-- ⚠ THE DAILY SCORE IS NOT TOUCHED BY THIS MIGRATION.
-- PROFILE_WEIGHTS (nutrition 50 / recovery 25 / commitment 15 / check-in 10) is a byte-exact port
-- between proto day.js and src/core/scoring.ts, proven equal by scripts/score-parity and clamped
-- by the 0041 evidence-ceiling trigger. Founder decision 2026-07-28: Connected Standards ships
-- TRACKED-NOT-SCORED, exactly as multi-domain completions (0112), training logs (0135) and
-- Verified Commitments (0138) did. Nothing here writes to days.
--   connected_standards.score_impact is authored NOW and read by NOTHING, so that turning scoring
--   on later is a code change rather than a migration against live rows.
--
-- ⚠ NO RAW HEALTH DATA IS EVER PERSISTED.
-- The device reads HealthKit / Health Connect locally, computes progress against the target the
-- coach set, and posts a NUMBER — "7,842 of 10,000" — through submit_activity_progress. There is
-- no samples table, no heart-rate column, no GPS route, nowhere to put a workout's coordinates.
-- This is the boolean-verdict doctrine of 0139's verify_arrival applied to activity: even a full
-- database compromise yields "reached 78% of a step goal", never a movement history.
--   progress_days is the ONE exception and is deliberately shaped: a per-day total for a weekly
--   standard's sparkline. Same granularity as progress_value, one row per day, nothing finer.
--
-- ⚠ A DEVICE FAILURE IS NOT A FAILURE OF THE ATHLETE.
-- The status vocabulary is copied from 0138 because it is already proven: 'awaiting_sync',
-- 'disconnected' and 'insufficient_data' drop OUT OF THE DENOMINATOR rather than counting as
-- misses. Nothing in this file can write 'missed' except staff_set_activity_result, deliberately
-- and attributably; the deadline cron in 0156 may write it only when a FRESH sync affirmatively
-- shows a shortfall. A dead battery must never be converted into a disciplinary record.
--
-- DUAL OWNER + A THIRD (0136 pattern, extended)
-- Every commitment carries nullable team_id + practice_id with num_nonnulls(…) = 1. Connected
-- Standards adds owner_athlete, because founder decision 2026-07-28 is that a solo user sets
-- their own standards with no coach involved. Three nullable owners, exactly one non-null.
--
-- WRITES ARE RPC-ONLY
-- No table below has an insert/update/delete policy or grant. Every mutation goes through a
-- security definer function so the SERVER stamps every timestamp — a client-supplied
-- "I hit 10,000 steps" is not a verification.
--
-- GUARDRAIL: authored + statically reviewed; NOT applied to live here. Founder applies via
-- `supabase db push` then `npm run test:rls`.

-- ---------------------------------------------------------------- the flag
-- ⚠ FAILS CLOSED — deliberately the opposite of vc_enabled (0141).
-- vc_enabled fails OPEN because Verified Commitments was already live when its kill switch was
-- added: a missing flag row there means "a restored backup", and silently disabling a shipped
-- feature would be the greater harm. Connected Standards has never shipped, so the greater harm
-- runs the other way — an un-seeded database must not start reading health data or pushing
-- reminders. No row → off. Turning it ON is the explicit act.
insert into public.feature_flags (name, description, default_on, kill_switch)
values ('connected_standards',
        'Connected Standards: wearable-verified activity requirements (steps, distance, workouts).',
        false, false)
on conflict (name) do nothing;

create or replace function cs_enabled(p_user uuid default auth.uid()) returns boolean
language sql stable security definer set search_path = public as $$
  select case
    when f.name is null    then false   -- no flag row → OFF (fail closed; see note above)
    when f.kill_switch     then false   -- beats every allowlist
    when f.default_on      then true
    when p_user = any(f.enabled_user_ids) then true
    else false
  end
  from (select 1) one
  left join public.feature_flags f on f.name = 'connected_standards';
$$;

-- ---------------------------------------------------------------- owner predicate
-- Collapses the three-way owner branch so every policy below reads identically. Mirrors
-- commitment_owner_is_staff (0138) with the personal owner folded in: for a self-set standard
-- the athlete IS the manager, so there is no staff to consult.
create or replace function cs_owner_can_manage(p_team uuid, p_practice uuid, p_athlete uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select (p_team    is not null and is_team_staff(p_team))
      or (p_practice is not null and is_practice_staff(p_practice))
      or (p_athlete is not null and p_athlete = auth.uid());
$$;

-- ---------------------------------------------------------------- standards (the definition)
-- CANONICAL UNITS. target_value is always stored in the metric's base unit so every comparison
-- in this file and in src/core/activity.ts is a plain numeric >=, never a unit-aware one:
--   steps            → count
--   distance         → METRES  (display_unit mi/km is a rendering choice, not a stored one)
--   workouts         → count of qualifying sessions
--   workout_minutes  → minutes
--   active_minutes   → minutes
--
-- deliberate_workout is the walk-three-miles / run-three-miles distinction the spec calls for:
-- false counts all ambient walking + running distance the platform reports for the period, true
-- counts only distance recorded inside a workout session. It is a distance-only modifier —
-- 'workouts' is inherently deliberate and 'steps' inherently ambient.
create table if not exists connected_standards (
  id                     uuid primary key default gen_random_uuid(),
  team_id                uuid references teams(id) on delete cascade,
  practice_id            uuid references practices(id) on delete cascade,
  owner_athlete          uuid references profiles(id) on delete cascade,

  title                  text not null check (char_length(trim(title)) between 1 and 60),
  note                   text check (note is null or char_length(note) <= 200),

  metric                 text not null check (metric in (
                           'steps','distance','workouts','workout_minutes','active_minutes')),
  target_value           numeric not null check (target_value > 0),
  display_unit           text not null check (display_unit in ('steps','mi','km','workouts','min')),
  deliberate_workout     boolean not null default false,
  -- a session shorter than this does not count toward 'workouts' / 'workout_minutes'. Null = any.
  workout_min_duration_min smallint check (workout_min_duration_min between 1 and 480),

  period                 text not null check (period in ('day','week')),
  -- JS getDay(): 0=Sun … 6=Sat. Ignored when period = 'week' (the week is the window).
  repeat_days            smallint[] not null default array[0,1,2,3,4,5,6]::smallint[]
                           check (repeat_days <@ array[0,1,2,3,4,5,6]::smallint[]),
  -- minute-of-day, matching every existing requirement window in the product. Null = end of period.
  deadline_min           smallint check (deadline_min between 0 and 1439),
  starts_on              date not null default (now() at time zone 'utc')::date,
  ends_on                date,
  timezone               text not null default 'America/New_York',

  -- audience_value is room_id (team_rooms, 0101) | group_id (coach_groups, 0071) | athlete_id;
  -- null for 'team' (the whole book) and for 'self' (the owner IS the audience).
  audience_kind          text not null check (audience_kind in ('team','room','group','athlete','self')),
  audience_value         uuid,

  -- the backup path when a watch dies. allow_manual is on by default because the feature must be
  -- usable by an athlete with no wearable at all — that is what makes slices 2-4 shippable
  -- before any native HealthKit code exists.
  allow_manual           boolean not null default true,
  manual_requires_approval boolean not null default false,

  reminder_offsets_min   smallint[] not null default '{}',

  -- ⚠ AUTHORED, READ BY NOTHING. v1 is tracked-not-scored (see the header). The column exists so
  -- that wiring scoring later is a code change, not a migration against live rows. Reserved shape:
  -- {"kind":"partial|all_or_nothing","weight":<int>}
  score_impact           jsonb,

  active                 boolean not null default true,
  created_by             uuid not null default auth.uid() references profiles(id),
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),

  constraint cs_one_owner check (num_nonnulls(team_id, practice_id, owner_athlete) = 1),
  -- owner_athlete is non-null EXACTLY when this is a self-set standard, and never otherwise.
  constraint cs_self_audience check ((owner_athlete is null) = (audience_kind <> 'self')),
  -- 'steps' and 'workouts' cannot be re-sourced; only distance has an ambient/deliberate choice.
  constraint cs_deliberate_is_distance check (not deliberate_workout or metric = 'distance'),
  constraint cs_unit_matches_metric check (
       (metric = 'steps'    and display_unit = 'steps')
    or (metric = 'distance' and display_unit in ('mi','km'))
    or (metric = 'workouts' and display_unit = 'workouts')
    or (metric in ('workout_minutes','active_minutes') and display_unit = 'min')),
  constraint cs_window check (ends_on is null or ends_on >= starts_on)
);
create index if not exists cs_team     on connected_standards (team_id, active) where team_id is not null;
create index if not exists cs_practice on connected_standards (practice_id, active) where practice_id is not null;
create index if not exists cs_personal on connected_standards (owner_athlete, active) where owner_athlete is not null;

-- ---------------------------------------------------------------- instances (dated occurrences)
-- Materialized lazily by ensure_connected_standard_instances — no nightly cron to fail silently.
-- The snapshots are the point: a coach who raises the target from 8,000 to 10,000 on Thursday has
-- not retroactively failed anyone for Monday, because Monday's instance still carries 8,000.
create table if not exists connected_standard_instances (
  id                   uuid primary key default gen_random_uuid(),
  standard_id          uuid not null references connected_standards(id) on delete cascade,
  period_start         date not null,
  period_end           date not null,          -- equal to period_start for a daily standard
  target_snapshot      numeric not null check (target_snapshot > 0),
  metric_snapshot      text not null,
  display_unit_snapshot text not null,
  deadline_at          timestamptz not null,
  status               text not null default 'scheduled' check (status in ('scheduled','cancelled')),
  note                 text check (note is null or char_length(note) <= 200),
  created_at           timestamptz not null default now(),
  unique (standard_id, period_start),
  constraint csi_period check (period_end >= period_start)
);
create index if not exists csi_standard_period on connected_standard_instances (standard_id, period_start desc);
create index if not exists csi_deadline        on connected_standard_instances (deadline_at);

-- ---------------------------------------------------------------- results (the heart)
-- One row per athlete per instance: how far they got, and the verdict.
--
-- THE NINE VERDICTS, and which of them count:
--   in_progress         syncing, target not reached, deadline ahead      → not yet counted
--   verified_complete   target reached, confirmed by health data          → counts, complete
--   completed_manually  athlete attested (optionally coach-approved)      → counts, complete
--   awaiting_review     manual entry waiting on staff                     → not yet counted
--   awaiting_sync       deadline passed, no fresh data                    → OUT of the denominator
--   disconnected        health access revoked / device removed            → OUT of the denominator
--   insufficient_data   the gap never resolved (48h, see 0156)            → OUT of the denominator
--   excused             staff removed the requirement for this period     → row dropped entirely
--   missed              fresh data affirmatively shows the shortfall      → counts, missed
create table if not exists connected_standard_results (
  id                uuid primary key default gen_random_uuid(),
  instance_id       uuid not null references connected_standard_instances(id) on delete cascade,
  athlete_id        uuid not null references profiles(id) on delete cascade,

  progress_value    numeric not null default 0 check (progress_value >= 0),
  -- per-day totals for a weekly standard's sparkline: {"2026-07-27": 8213, …}. Same granularity
  -- as progress_value. Deliberately not a sample stream — see the header.
  progress_days     jsonb check (progress_days is null or jsonb_typeof(progress_days) = 'object'),

  status            text not null default 'in_progress' check (status in (
                      'in_progress','verified_complete','completed_manually','awaiting_review',
                      'awaiting_sync','disconnected','insufficient_data','excused','missed')),
  verified_source   text check (verified_source in ('healthkit','health_connect','manual','staff')),
  completed_at      timestamptz,
  last_synced_at    timestamptz,
  device_connected  boolean,

  manual_note       text check (manual_note is null or char_length(manual_note) <= 200),
  manual_submitted_at timestamptz,
  reviewed_by       uuid references profiles(id),
  reviewed_at       timestamptz,

  excused_by        uuid references profiles(id),
  excused_at        timestamptz,
  excused_reason    text check (excused_reason is null or char_length(excused_reason) <= 120),
  corrected_by      uuid references profiles(id),
  corrected_at      timestamptz,
  disputed_at       timestamptz,
  dispute_note      text check (dispute_note is null or char_length(dispute_note) <= 200),

  reminder_sent_at  timestamptz,   -- claim-and-mark bookkeeping for 0156
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (instance_id, athlete_id)
);
create index if not exists csr_athlete  on connected_standard_results (athlete_id, created_at desc);
create index if not exists csr_instance on connected_standard_results (instance_id);
create index if not exists csr_open     on connected_standard_results (status)
  where status in ('in_progress','awaiting_sync','awaiting_review');

-- ---------------------------------------------------------------- consent
-- ⚠ A SEPARATE TABLE FROM verification_consent (0138), on purpose.
-- That table's kind CHECK is ('guardian','institutional') and its whole shape is scoped to
-- location verification. Widening it would mean a constraint migration plus an ambiguity about
-- which consent a row expresses. Health data is a different ask with a different blast radius,
-- so it gets its own record and can be revoked independently — an athlete may want their coach
-- to verify arrival at practice and still not want their step count read.
create table if not exists health_share_consent (
  id           uuid primary key default gen_random_uuid(),
  athlete_id   uuid not null references profiles(id) on delete cascade,
  kind         text not null check (kind in ('self','guardian')),
  granted_by   uuid not null references profiles(id),
  granted_at   timestamptz not null default now(),
  revoked_at   timestamptz,
  note         text check (note is null or char_length(note) <= 200)
);
create index if not exists hsc_athlete on health_share_consent (athlete_id) where revoked_at is null;

-- Fail closed. is_minor() (0006) treats an unknown/NULL base_age as a minor, so an athlete who
-- never entered their age is protected by default rather than exposed by default. A minor needs
-- a GUARDIAN grant specifically — their own tap cannot authorize reading their health data.
create or replace function has_health_consent(p_athlete uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select case when is_minor(p_athlete) then
    exists (select 1 from health_share_consent c
             where c.athlete_id = p_athlete and c.kind = 'guardian' and c.revoked_at is null)
  else
    exists (select 1 from health_share_consent c
             where c.athlete_id = p_athlete and c.revoked_at is null)
  end;
$$;

create or replace function grant_health_consent(p_athlete uuid, p_kind text, p_note text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if p_kind not in ('self','guardian') then
    raise exception 'consent kind must be self or guardian';
  end if;

  if p_kind = 'self' then
    if p_athlete <> auth.uid() then
      raise exception 'only the athlete may grant their own health consent';
    end if;
    -- A minor cannot self-authorize. Their consent screen routes to the guardian request instead;
    -- this is the server half of that rule, so a client bug cannot open the gate.
    if is_minor(p_athlete) then
      raise exception 'a minor requires guardian consent to share health data';
    end if;
  else
    if not is_guardian_of(p_athlete) then
      raise exception 'only a verified guardian may grant guardian consent';
    end if;
  end if;

  insert into health_share_consent (athlete_id, kind, granted_by, note)
  values (p_athlete, p_kind, auth.uid(), nullif(left(coalesce(p_note,''),200),''))
  returning id into v_id;
  return v_id;
end $$;

-- Either the athlete or their guardian can pull the plug, at any time, without a coach's help.
create or replace function revoke_health_consent(p_athlete uuid) returns integer
language plpgsql security definer set search_path = public as $$
declare v_n integer;
begin
  if p_athlete <> auth.uid() and not is_guardian_of(p_athlete) then
    raise exception 'not authorized to revoke this athlete''s health consent';
  end if;
  update health_share_consent set revoked_at = now()
   where athlete_id = p_athlete and revoked_at is null;
  get diagnostics v_n = row_count;
  return coalesce(v_n, 0);
end $$;

-- ---------------------------------------------------------------- RLS
-- READ policies only. Every write path is a definer RPC below.
alter table connected_standards           enable row level security;
alter table connected_standard_instances  enable row level security;
alter table connected_standard_results    enable row level security;
alter table health_share_consent          enable row level security;

-- ⚠ RECURSION. The natural policy pair — instances asking "does this athlete hold a result?" and
-- results asking "is the caller staff over the parent instance?" — makes each policy evaluate the
-- other's table, and Postgres raises "infinite recursion detected in policy". Same trap 0075 hit
-- between meal_plans and plan_assignments, and 0138 hit here. These SECURITY DEFINER helpers run
-- as the table owner, bypass RLS, and break the cycle.
create or replace function has_cs_result(p_instance uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from connected_standard_results r
                  where r.instance_id = p_instance and r.athlete_id = auth.uid());
$$;

create or replace function cs_instance_owner_can_manage(p_instance uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from connected_standard_instances i
                   join connected_standards s on s.id = i.standard_id
                  where i.id = p_instance
                    and cs_owner_can_manage(s.team_id, s.practice_id, s.owner_athlete));
$$;

create or replace function has_cs_row(p_standard uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from connected_standard_instances i
                   join connected_standard_results r on r.instance_id = i.id
                  where i.standard_id = p_standard and r.athlete_id = auth.uid());
$$;

drop policy if exists cs_read on connected_standards;
create policy cs_read on connected_standards for select
  using (cs_owner_can_manage(team_id, practice_id, owner_athlete) or has_cs_row(id));

drop policy if exists csi_read on connected_standard_instances;
create policy csi_read on connected_standard_instances for select
  using (cs_instance_owner_can_manage(id) or has_cs_result(id));

-- The athlete sees ONLY their own row. No teammate's step count is reachable from here: there is
-- no leaderboard, no public list, nothing that turns a health metric into a ranking.
drop policy if exists csr_read on connected_standard_results;
create policy csr_read on connected_standard_results for select
  using (athlete_id = auth.uid() or cs_instance_owner_can_manage(instance_id));

-- A coach is deliberately NOT here. Whether an athlete consented to health reading is between the
-- athlete and their guardian; the coach learns only that a standard did or did not verify.
drop policy if exists hsc_read on health_share_consent;
create policy hsc_read on health_share_consent for select
  using (athlete_id = auth.uid() or is_guardian_of(athlete_id));

-- ⚠ GRANTS. 0013 revoked defaults, and the RLS suite does NOT catch a missing grant — a policy can
-- be perfect while every read returns "permission denied for table". SELECT only: no insert/update/
-- delete grant exists anywhere in this feature, by design.
grant select on connected_standards, connected_standard_instances,
                connected_standard_results, health_share_consent to authenticated;

-- ================================================================ RPCs

-- ---------------------------------------------------------------- create / update
-- One call for create and edit; the client sends the whole row as jsonb (upsert_commitment shape).
-- The role gate mirrors CREATE_CAPS in proto js/staff-access.js: head_coach, coordinator (and its
-- legacy 'assistant' spelling), s_and_c and team_admin may author. A position coach can SEE their
-- room's board but cannot set a standard.
create or replace function upsert_connected_standard(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_team uuid; v_practice uuid; v_owner uuid; v_role text;
begin
  v_id       := nullif(p->>'id','')::uuid;
  v_team     := nullif(p->>'team_id','')::uuid;
  v_practice := nullif(p->>'practice_id','')::uuid;
  v_owner    := nullif(p->>'owner_athlete','')::uuid;

  -- A coach must not be able to author into a feature that is switched off — they would sit there
  -- setting a standard that will never appear on anyone's Home.
  if not cs_enabled(auth.uid()) then
    raise exception 'connected standards are not enabled for this account';
  end if;

  if not cs_owner_can_manage(v_team, v_practice, v_owner) then
    raise exception 'not authorized for this team, practice or athlete';
  end if;

  if v_team is not null then
    select role::text into v_role from team_staff
     where team_id = v_team and staff_id = auth.uid() and status = 'active';
    if coalesce(v_role, 'head_coach') not in
       ('head_coach','coordinator','assistant','s_and_c','team_admin') then
      raise exception 'role % may not set connected standards', v_role;
    end if;
  end if;

  -- An EDIT must not walk a standard into another coach's book. Only applies when the id already
  -- exists: a client is free to mint the uuid for a NEW standard, and an unconditional guard here
  -- would reject every such create.
  if v_id is not null
     and exists (select 1 from connected_standards where id = v_id)
     and not exists (
       select 1 from connected_standards s where s.id = v_id
         and s.team_id       is not distinct from v_team
         and s.practice_id   is not distinct from v_practice
         and s.owner_athlete is not distinct from v_owner
     ) then
    raise exception 'standard does not belong to this team, practice or athlete';
  end if;

  insert into connected_standards (
    id, team_id, practice_id, owner_athlete, title, note,
    metric, target_value, display_unit, deliberate_workout, workout_min_duration_min,
    period, repeat_days, deadline_min, starts_on, ends_on, timezone,
    audience_kind, audience_value, allow_manual, manual_requires_approval,
    reminder_offsets_min, score_impact, active, created_by
  ) values (
    coalesce(v_id, gen_random_uuid()), v_team, v_practice, v_owner,
    p->>'title', nullif(p->>'note',''),
    p->>'metric', (p->>'target_value')::numeric, p->>'display_unit',
    coalesce((p->>'deliberate_workout')::boolean, false),
    nullif(p->>'workout_min_duration_min','')::smallint,
    p->>'period',
    coalesce((select array_agg(x::smallint) from jsonb_array_elements_text(p->'repeat_days') x),
             array[0,1,2,3,4,5,6]::smallint[]),
    nullif(p->>'deadline_min','')::smallint,
    coalesce((p->>'starts_on')::date, (now() at time zone 'utc')::date),
    nullif(p->>'ends_on','')::date,
    coalesce(nullif(p->>'timezone',''), 'America/New_York'),
    p->>'audience_kind', nullif(p->>'audience_value','')::uuid,
    coalesce((p->>'allow_manual')::boolean, true),
    coalesce((p->>'manual_requires_approval')::boolean, false),
    coalesce((select array_agg(x::smallint) from jsonb_array_elements_text(p->'reminder_offsets_min') x),
             '{}'::smallint[]),
    p->'score_impact',
    coalesce((p->>'active')::boolean, true), auth.uid()
  )
  on conflict (id) do update set
    title = excluded.title, note = excluded.note,
    metric = excluded.metric, target_value = excluded.target_value,
    display_unit = excluded.display_unit, deliberate_workout = excluded.deliberate_workout,
    workout_min_duration_min = excluded.workout_min_duration_min,
    period = excluded.period, repeat_days = excluded.repeat_days,
    deadline_min = excluded.deadline_min, starts_on = excluded.starts_on,
    ends_on = excluded.ends_on, timezone = excluded.timezone,
    audience_kind = excluded.audience_kind, audience_value = excluded.audience_value,
    allow_manual = excluded.allow_manual,
    manual_requires_approval = excluded.manual_requires_approval,
    reminder_offsets_min = excluded.reminder_offsets_min,
    score_impact = excluded.score_impact,
    active = excluded.active, updated_at = now()
  returning id into v_id;

  return v_id;
end $$;

create or replace function set_connected_standard_active(p_id uuid, p_active boolean)
returns void language plpgsql security definer set search_path = public as $$
declare v_ok boolean;
begin
  select cs_owner_can_manage(team_id, practice_id, owner_athlete) into v_ok
    from connected_standards where id = p_id;
  if not coalesce(v_ok, false) then raise exception 'not authorized'; end if;
  update connected_standards set active = p_active, updated_at = now() where id = p_id;
end $$;

-- ---------------------------------------------------------------- audience
-- ONE place that answers "who is this for", so materialization and the board can never disagree
-- about the roster. Mirrors commitment_audience (0138) with 'self' folded in.
create or replace function cs_audience(p_standard uuid) returns setof uuid
language plpgsql stable security definer set search_path = public as $$
declare s connected_standards;
begin
  select * into s from connected_standards where id = p_standard;
  if not found then return; end if;

  if s.audience_kind = 'self' then
    return query select s.owner_athlete where s.owner_athlete is not null;
  elsif s.audience_kind = 'athlete' then
    return query select s.audience_value where s.audience_value is not null;
  elsif s.audience_kind = 'group' then
    return query select unnest(g.athlete_ids) from coach_groups g where g.id = s.audience_value;
  elsif s.audience_kind = 'room' then
    return query select tm.athlete_id from team_members tm
      where tm.team_id = s.team_id and tm.room_id = s.audience_value and tm.status = 'active';
  else
    if s.team_id is not null then
      return query select tm.athlete_id from team_members tm
        where tm.team_id = s.team_id and tm.status = 'active';
    else
      return query select pc.client_id from practice_clients pc
        where pc.practice_id = s.practice_id and pc.status = 'active';
    end if;
  end if;
end $$;

-- ---------------------------------------------------------------- materialization
-- Internal: materializes ONE standard across a date window. No authorization of its own — every
-- caller below authorizes first. Not granted to anyone.
--
-- A weekly standard's period_start is the ISO Monday of the week (date_trunc('week', …)), so an
-- athlete who is added to a team mid-week joins the week already in progress rather than starting
-- a private week of their own.
create or replace function cs_materialize_standard(p_standard uuid, p_from date, p_to date)
returns integer
language plpgsql security definer set search_path = public as $$
declare s connected_standards; d date; n integer := 0; v_inst uuid;
        v_start date; v_end date; v_last date;
begin
  select * into s from connected_standards where id = p_standard and active;
  if not found then return 0; end if;
  if p_from is null or p_to is null or p_to < p_from then return 0; end if;

  d := greatest(p_from, s.starts_on);
  v_last := least(p_to, coalesce(s.ends_on, p_to));

  while d <= v_last loop
    v_start := null;
    if s.period = 'week' then
      v_start := date_trunc('week', d)::date;      -- Monday
      v_end   := v_start + 6;
    elsif extract(dow from d)::smallint = any(s.repeat_days) then
      v_start := d;
      v_end   := d;
    end if;

    if v_start is not null then
      -- v_inst MUST be reset: `on conflict do nothing` returns no row, and a stale value from a
      -- previous iteration would re-seed results against the wrong instance.
      v_inst := null;
      insert into connected_standard_instances (
        standard_id, period_start, period_end,
        target_snapshot, metric_snapshot, display_unit_snapshot, deadline_at
      ) values (
        s.id, v_start, v_end, s.target_value, s.metric, s.display_unit,
        (v_end + make_interval(mins => coalesce(s.deadline_min, 1439)::int)) at time zone s.timezone
      )
      on conflict (standard_id, period_start) do nothing
      returning id into v_inst;

      if v_inst is not null then
        insert into connected_standard_results (instance_id, athlete_id)
        select v_inst, a from cs_audience(s.id) a
        on conflict (instance_id, athlete_id) do nothing;
        n := n + 1;
      end if;
    end if;

    -- a weekly standard jumps a week at a time; a daily one walks day by day
    d := d + (case when s.period = 'week' then 7 else 1 end);
  end loop;

  -- Roster churn: seed results for anyone who joined the audience after an instance was created,
  -- and drop rows for anyone who left — but ONLY rows that never carried a signal. A result that
  -- has been synced, attested, excused or corrected is history and is never deleted.
  insert into connected_standard_results (instance_id, athlete_id)
  select i.id, a
    from connected_standard_instances i
    cross join lateral cs_audience(s.id) a
   where i.standard_id = s.id and i.period_start between p_from and p_to
  on conflict (instance_id, athlete_id) do nothing;

  delete from connected_standard_results r
   using connected_standard_instances i
   where r.instance_id = i.id
     and i.standard_id = s.id
     and i.period_start between p_from and p_to
     and r.status = 'in_progress'
     and r.progress_value = 0
     and r.last_synced_at is null
     and r.manual_submitted_at is null
     and r.corrected_by is null
     and r.athlete_id not in (select a from cs_audience(s.id) a);

  return n;
end $$;

-- The staff / member path. Callable by an athlete on their own book as well as by staff, because
-- Home is often the first thing open in the morning: if only staff could materialize, an athlete
-- whose coach had not opened the app would see no card at all.
create or replace function ensure_connected_standard_instances(
  p_team uuid, p_practice uuid, p_from date, p_to date
) returns integer
language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_n integer := 0;
begin
  if not cs_enabled(auth.uid()) then return 0; end if;

  if not cs_owner_can_manage(p_team, p_practice, null)
     and not exists (select 1 from team_members
                      where athlete_id = auth.uid() and team_id = p_team and status = 'active')
     and not exists (select 1 from practice_clients
                      where client_id = auth.uid() and practice_id = p_practice and status = 'active')
  then
    raise exception 'not authorized';
  end if;

  if p_from is null or p_to is null or p_to < p_from then return 0; end if;
  if p_to - p_from > 62 then raise exception 'window too large'; end if;

  for v_id in select id from connected_standards
               where active
                 and ((p_team is not null and team_id = p_team)
                   or (p_practice is not null and practice_id = p_practice))
  loop
    v_n := v_n + cs_materialize_standard(v_id, p_from, p_to);
  end loop;
  return v_n;
end $$;

-- The athlete's own path: every team, every practice, plus their personal standards. The client
-- has no reason to know its team or practice uuid — it just needs today's card.
create or replace function ensure_my_connected_standards(p_from date, p_to date) returns integer
language plpgsql security definer set search_path = public as $$
declare v_n integer := 0; t uuid; p uuid; v_id uuid;
begin
  if not cs_enabled(auth.uid()) then return 0; end if;
  if p_from is null or p_to is null or p_to < p_from then return 0; end if;
  if p_to - p_from > 62 then raise exception 'window too large'; end if;

  for t in select team_id from team_members
            where athlete_id = auth.uid() and status = 'active' loop
    v_n := v_n + ensure_connected_standard_instances(t, null, p_from, p_to);
  end loop;
  for p in select practice_id from practice_clients
            where client_id = auth.uid() and status = 'active' loop
    v_n := v_n + ensure_connected_standard_instances(null, p, p_from, p_to);
  end loop;
  for v_id in select id from connected_standards
               where active and owner_athlete = auth.uid() loop
    v_n := v_n + cs_materialize_standard(v_id, p_from, p_to);
  end loop;
  return v_n;
end $$;

-- ---------------------------------------------------------------- submit_activity_progress
-- The device half. The phone read HealthKit locally, applied the standard's rule, and is posting
-- a NUMBER. No sample, no route, no heart rate — see the header.
--
-- greatest() on both progress and sync time makes a re-read idempotent and makes an out-of-order
-- delivery harmless: a background wake carrying a stale window can never walk a total backwards.
create or replace function submit_activity_progress(
  p_instance uuid, p_progress numeric, p_synced_at timestamptz,
  p_source text default 'healthkit', p_progress_days jsonb default null,
  p_device_connected boolean default true
) returns text
language plpgsql security definer set search_path = public as $$
declare r connected_standard_results; i connected_standard_instances;
        v_status text; v_synced timestamptz; v_movable boolean;
begin
  if p_source not in ('healthkit','health_connect') then
    raise exception 'progress source must be a connected health platform';
  end if;
  if p_progress is null or p_progress < 0 then
    raise exception 'progress must be a non-negative number';
  end if;

  select * into r from connected_standard_results
   where instance_id = p_instance and athlete_id = auth.uid();
  if not found then raise exception 'no standard for you on this instance'; end if;

  -- ⚠ THE CONSENT GATE. Device-sourced writes require it; manual attestation below does not,
  -- because attesting to your own effort reads no health data at all. Fails closed for minors.
  if not has_health_consent(auth.uid()) then
    raise exception 'health data sharing has not been authorized for this athlete';
  end if;

  select * into i from connected_standard_instances where id = p_instance;
  if i.status = 'cancelled' then return r.status; end if;

  -- A client clock that is ahead, or a replayed old payload, must not become evidence.
  v_synced := least(coalesce(p_synced_at, now()), now());
  v_synced := greatest(v_synced, coalesce(r.last_synced_at, v_synced));

  -- Rows a device may move. 'excused' and 'completed_manually' are settled human decisions;
  -- anything a staff member corrected (corrected_by stamped) is theirs to own, not the watch's.
  v_movable := r.corrected_by is null and r.status in (
    'in_progress','awaiting_sync','disconnected','insufficient_data','missed','awaiting_review');

  v_status := r.status;
  if v_movable and greatest(r.progress_value, p_progress) >= i.target_snapshot then
    v_status := 'verified_complete';
  elsif v_movable and r.status in ('awaiting_sync','disconnected','insufficient_data')
        and v_synced >= i.deadline_at then
    -- fresh data arrived after the deadline and still falls short. The row is no longer "waiting
    -- on the device", but declaring a miss is 0156's job under its own rules — never a side
    -- effect of a sync. Park it where the cron can adjudicate it.
    v_status := 'awaiting_sync';
  end if;

  update connected_standard_results set
    progress_value   = greatest(progress_value, p_progress),
    progress_days    = coalesce(p_progress_days, progress_days),
    last_synced_at   = v_synced,
    device_connected = p_device_connected,
    status           = v_status,
    verified_source  = case when v_status = 'verified_complete' and r.status <> 'verified_complete'
                            then p_source else verified_source end,
    completed_at     = case when v_status = 'verified_complete'
                            then coalesce(completed_at, now()) else completed_at end,
    updated_at       = now()
  where id = r.id;

  return v_status;
end $$;

-- ---------------------------------------------------------------- submit_manual_activity
-- The backup path, and the reason this feature is usable before any native code exists.
-- A manual entry is NOT treated as dishonest — it is recorded as what it is, and the UI shows the
-- difference between "verified" and "reported" without editorializing about it.
create or replace function submit_manual_activity(p_instance uuid, p_note text default null)
returns text
language plpgsql security definer set search_path = public as $$
declare r connected_standard_results; i connected_standard_instances;
        s connected_standards; v_status text;
begin
  select * into r from connected_standard_results
   where instance_id = p_instance and athlete_id = auth.uid();
  if not found then raise exception 'no standard for you on this instance'; end if;

  select * into i from connected_standard_instances where id = p_instance;
  select * into s from connected_standards where id = i.standard_id;

  if not s.allow_manual then
    raise exception 'this standard does not accept manual completion';
  end if;
  if i.status = 'cancelled' then raise exception 'this period was cancelled'; end if;
  if r.status = 'excused' then return r.status; end if;
  -- A window, not a cliff: three days to log the run whose watch died, and no longer. Without a
  -- bound, a season's worth of missed standards could be back-filled on the last day.
  if now() > i.deadline_at + interval '72 hours' then
    raise exception 'too late to log this one manually';
  end if;

  v_status := case when s.manual_requires_approval then 'awaiting_review' else 'completed_manually' end;

  update connected_standard_results set
    status = v_status,
    verified_source = 'manual',
    manual_note = nullif(left(coalesce(p_note,''),200),''),
    manual_submitted_at = now(),
    completed_at = case when v_status = 'completed_manually'
                        then coalesce(completed_at, now()) else completed_at end,
    reviewed_by = null, reviewed_at = null,
    updated_at = now()
  where id = r.id;

  return v_status;
end $$;

-- ---------------------------------------------------------------- review_manual_activity
create or replace function review_manual_activity(
  p_result uuid, p_approve boolean, p_note text default null
) returns text
language plpgsql security definer set search_path = public as $$
declare v_ok boolean; v_deadline timestamptz; v_status text;
begin
  select cs_owner_can_manage(s.team_id, s.practice_id, s.owner_athlete), i.deadline_at
    into v_ok, v_deadline
    from connected_standard_results r
    join connected_standard_instances i on i.id = r.instance_id
    join connected_standards s on s.id = i.standard_id
   where r.id = p_result;
  if not coalesce(v_ok, false) then raise exception 'not authorized'; end if;

  -- A rejection is not a miss. Before the deadline the athlete can still go do the work; after it,
  -- the row returns to the queue the deadline cron adjudicates — it never lands on 'missed' here.
  v_status := case when p_approve then 'completed_manually'
                   when now() <= v_deadline then 'in_progress'
                   else 'awaiting_sync' end;

  update connected_standard_results set
    status = v_status,
    verified_source = case when p_approve then 'staff' else verified_source end,
    completed_at = case when p_approve then coalesce(completed_at, now()) else null end,
    reviewed_by = auth.uid(), reviewed_at = now(),
    manual_note = case when p_note is not null and length(trim(p_note)) > 0
                       then left(p_note, 200) else manual_note end,
    updated_at = now()
  where id = p_result;

  return v_status;
end $$;

-- ---------------------------------------------------------------- staff_set_activity_result
-- Excuse, or correct the athlete whose watch died. EVERY correction is attributed: corrected_by
-- and corrected_at are always stamped, so nothing in the coach UI can silently rewrite a record.
--
-- ⚠ THIS IS THE ONLY HUMAN PATH TO 'missed'. Not the device, not a rejected manual entry, not a
-- sync gap. A person decides, and their name is on it.
create or replace function staff_set_activity_result(p_result uuid, p_status text, p_reason text default null)
returns void language plpgsql security definer set search_path = public as $$
declare v_ok boolean;
begin
  if p_status not in ('missed','excused','verified_complete','in_progress') then
    raise exception 'bad status %', p_status;
  end if;

  select cs_owner_can_manage(s.team_id, s.practice_id, s.owner_athlete) into v_ok
    from connected_standard_results r
    join connected_standard_instances i on i.id = r.instance_id
    join connected_standards s on s.id = i.standard_id
   where r.id = p_result;
  if not coalesce(v_ok, false) then raise exception 'not authorized'; end if;

  update connected_standard_results set
    status = p_status,
    excused_by     = case when p_status = 'excused' then auth.uid() else excused_by end,
    excused_at     = case when p_status = 'excused' then now() else excused_at end,
    excused_reason = case when p_status = 'excused'
                          then nullif(left(coalesce(p_reason,''),120),'') else excused_reason end,
    verified_source = case when p_status = 'verified_complete' then 'staff' else verified_source end,
    completed_at   = case when p_status = 'verified_complete'
                          then coalesce(completed_at, now()) else completed_at end,
    corrected_by = auth.uid(), corrected_at = now(),
    updated_at = now()
  where id = p_result;
end $$;

-- ---------------------------------------------------------------- dispute
-- Flags, never rewrites. The athlete's objection is recorded next to the verdict and surfaced to
-- the coach; changing the verdict remains a staff act with a name on it.
create or replace function dispute_activity_result(p_result uuid, p_note text)
returns void language plpgsql security definer set search_path = public as $$
declare v_n integer;
begin
  update connected_standard_results set
    disputed_at = now(),
    dispute_note = nullif(left(coalesce(p_note,''),200),''),
    updated_at = now()
  where id = p_result and athlete_id = auth.uid();
  get diagnostics v_n = row_count;
  if v_n = 0 then raise exception 'no such result for you'; end if;
end $$;

-- ---------------------------------------------------------------- the athlete's payload
-- Carries the definition fields the pure client engine needs (target, unit, deadline, period) so
-- it can render progress and pace without a second round trip.
create or replace function my_connected_standards(p_from date, p_to date)
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(x order by x->>'period_start', x->>'title'), '[]'::jsonb) from (
    select jsonb_build_object(
      'result_id', r.id, 'instance_id', i.id, 'standard_id', s.id,
      'title', s.title, 'note', s.note,
      'metric', i.metric_snapshot, 'display_unit', i.display_unit_snapshot,
      'target', i.target_snapshot, 'progress', r.progress_value, 'progress_days', r.progress_days,
      'period', s.period, 'period_start', i.period_start, 'period_end', i.period_end,
      'deadline_at', i.deadline_at, 'instance_status', i.status,
      'deliberate_workout', s.deliberate_workout,
      'workout_min_duration_min', s.workout_min_duration_min,
      'status', r.status, 'verified_source', r.verified_source,
      'completed_at', r.completed_at, 'last_synced_at', r.last_synced_at,
      'device_connected', r.device_connected,
      'allow_manual', s.allow_manual, 'manual_requires_approval', s.manual_requires_approval,
      'manual_note', r.manual_note, 'manual_submitted_at', r.manual_submitted_at,
      'excused_reason', r.excused_reason, 'disputed_at', r.disputed_at,
      'source_kind', case when s.owner_athlete is not null then 'personal' else 'assigned' end,
      'owner_label', case
        when s.owner_athlete is not null then null
        when s.team_id is not null then (select t.name from teams t where t.id = s.team_id)
        else (select pr.name from practices pr where pr.id = s.practice_id) end
    ) as x
    from connected_standard_results r
    join connected_standard_instances i on i.id = r.instance_id
    join connected_standards s on s.id = i.standard_id
   where r.athlete_id = auth.uid()
     and i.period_start <= p_to and i.period_end >= p_from
  ) q;
$$;

-- ---------------------------------------------------------------- the coach's payload
-- ⚠ PRIVACY-MINIMAL BY CONSTRUCTION. Every athlete row carries a status and a PERCENTAGE of the
-- target the coach themselves set — never a raw step count, never a route, never a workout time.
-- The coach asked for 10,000 steps; they learn whether they got 10,000 steps. That is the whole
-- contract, and this function is structurally incapable of returning more.
create or replace function connected_standard_board(p_team uuid, p_practice uuid, p_on date)
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(x order by x->>'title'), '[]'::jsonb) from (
    select jsonb_build_object(
      'standard_id', s.id, 'instance_id', i.id, 'title', s.title,
      'metric', i.metric_snapshot, 'display_unit', i.display_unit_snapshot,
      'target', i.target_snapshot, 'period', s.period,
      'period_start', i.period_start, 'period_end', i.period_end,
      'deadline_at', i.deadline_at, 'instance_status', i.status,
      'audience_kind', s.audience_kind,
      'audience_label', case
        when s.audience_kind = 'room'    then (select rm.label from team_rooms rm where rm.id = s.audience_value)
        when s.audience_kind = 'group'   then (select g.name from coach_groups g where g.id = s.audience_value)
        when s.audience_kind = 'athlete' then (select p.full_name from profiles p where p.id = s.audience_value)
        else null end,
      'rows', (
        select coalesce(jsonb_agg(jsonb_build_object(
          'result_id', r.id, 'athlete_id', r.athlete_id, 'name', p.full_name,
          'status', r.status,
          -- capped at 100: "how far toward what I asked for", not a competition metric
          'progress_pct', least(100, floor(100.0 * r.progress_value / nullif(i.target_snapshot,0)))::int,
          'verified_source', r.verified_source,
          'last_synced_at', r.last_synced_at, 'device_connected', r.device_connected,
          'manual_note', r.manual_note, 'manual_submitted_at', r.manual_submitted_at,
          'excused_reason', r.excused_reason,
          'corrected_by_name', (select p2.full_name from profiles p2 where p2.id = r.corrected_by),
          'disputed_at', r.disputed_at, 'dispute_note', r.dispute_note
        ) order by p.full_name), '[]'::jsonb)
        from connected_standard_results r join profiles p on p.id = r.athlete_id
        where r.instance_id = i.id
      )
    ) as x
    from connected_standard_instances i
    join connected_standards s on s.id = i.standard_id
   where p_on between i.period_start and i.period_end
     and ((p_team is not null and s.team_id = p_team)
       or (p_practice is not null and s.practice_id = p_practice))
     and cs_owner_can_manage(s.team_id, s.practice_id, s.owner_athlete)
  ) q;
$$;

-- ---------------------------------------------------------------- function grants
-- cs_materialize_standard is deliberately absent: it performs no authorization of its own and is
-- reachable only from the two ensure_* functions above.
revoke all on function cs_materialize_standard(uuid, date, date) from public, anon, authenticated;

do $$ declare f text; begin
  foreach f in array array[
    'cs_enabled(uuid)',
    'cs_owner_can_manage(uuid,uuid,uuid)',
    'has_health_consent(uuid)',
    'grant_health_consent(uuid,text,text)',
    'revoke_health_consent(uuid)',
    'has_cs_result(uuid)',
    'cs_instance_owner_can_manage(uuid)',
    'has_cs_row(uuid)',
    'upsert_connected_standard(jsonb)',
    'set_connected_standard_active(uuid,boolean)',
    'cs_audience(uuid)',
    'ensure_connected_standard_instances(uuid,uuid,date,date)',
    'ensure_my_connected_standards(date,date)',
    'submit_activity_progress(uuid,numeric,timestamptz,text,jsonb,boolean)',
    'submit_manual_activity(uuid,text)',
    'review_manual_activity(uuid,boolean,text)',
    'staff_set_activity_result(uuid,text,text)',
    'dispute_activity_result(uuid,text)',
    'my_connected_standards(date,date)',
    'connected_standard_board(uuid,uuid,date)'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
