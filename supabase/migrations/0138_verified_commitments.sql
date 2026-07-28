-- OnStandard — Verified Commitments (slice 1): the scheduling primitive + Morning Roll Call.
-- Spec: docs/superpowers/specs/2026-07-22-verified-commitments-design.md
-- Plan: docs/superpowers/plans/2026-07-22-verified-commitments.md
--
-- WHAT THIS IS
-- A coach schedules a recurring responsibility (roll call, practice, study hall, rehab…) for the
-- whole team, a position group, an ad-hoc group, or one athlete. Each dated occurrence becomes a
-- commitment_instances row, and each athlete in the audience gets exactly one
-- commitment_responses row carrying three timestamps: acknowledged / arrived / completed.
--
-- WHY A NEW PRIMITIVE
-- OnStandard has never had a calendar. requirement_sets (0055) model a STANDING obligation with a
-- minute-of-day window; team_week_pattern (0100) marks weekdays training/rest. Neither can express
-- "Tuesday 6:00 AM, at the facility, these eleven athletes". Rather than bend requirement_sets
-- (whose items jsonb is validated by validate_requirement_items and feeds the SCORED day), this
-- lands as its own primitive so the scoring engine is untouched — see the note below.
--
-- ⚠ THE DAILY SCORE IS NOT TOUCHED BY THIS MIGRATION.
-- PROFILE_WEIGHTS (nutrition 50 / recovery 25 / commitment 15 / check-in 10) is a byte-exact port
-- between proto day.js and src/core/scoring.ts, proven equal by scripts/score-parity and clamped by
-- the server evidence-ceiling trigger. Founder decision 2026-07-22: Verified Commitments produces
-- its OWN Accountability score (athlete_accountability below), exactly as multi-domain completions
-- (0112) and training logs (0135) shipped tracked-not-scored. Nothing here writes to days.
--
-- ⚠ NO COORDINATE IS EVER PERSISTED FOR AN ATHLETE.
-- commitment_locations holds the COACH's scheduled place (a facility address the coach typed).
-- commitment_responses holds a verdict and a timestamp and nothing else — there is deliberately no
-- lat/lng column on it, and no movement-history table anywhere in this feature. Slice 2 compares
-- the athlete's position to the geofence ON DEVICE and reports a boolean.
--
-- DUAL OWNER (0136 pattern)
-- Every table carries nullable team_id + practice_id with a num_nonnulls(…) = 1 check, so a
-- trainer's practice gets this feature identically to a coach's team.
--
-- WRITES ARE RPC-ONLY
-- No table below has an insert/update/delete policy or grant. Every mutation goes through a
-- security definer function so the SERVER stamps every timestamp — a client-supplied "I woke at
-- 4:48" is not a verification. The RLS suite probes exactly this (verified_commitments_test.sql).
--
-- GUARDRAIL: authored + statically reviewed; NOT applied to live here. Founder applies via
-- `supabase db push` then `npm run test:rls`.

-- ---------------------------------------------------------------- staff predicate
-- Collapses the dual-owner branch so every policy below reads identically. Mirrors the shape of
-- is_practice_staff (0136), which itself mirrors is_team_staff (0055).
create or replace function commitment_owner_is_staff(p_team uuid, p_practice uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select (p_team is not null and is_team_staff(p_team))
      or (p_practice is not null and is_practice_staff(p_practice));
$$;
revoke all on function commitment_owner_is_staff(uuid, uuid) from public, anon;
grant execute on function commitment_owner_is_staff(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------- locations
-- Named, reusable places. The coach types an address once and reuses it forever.
-- radius_m floors at 50 because consumer GPS is not more accurate than that; a tighter radius
-- manufactures false negatives and would push honest athletes into 'unverified'.
create table if not exists commitment_locations (
  id           uuid primary key default gen_random_uuid(),
  team_id      uuid references teams(id) on delete cascade,
  practice_id  uuid references practices(id) on delete cascade,
  name         text not null check (char_length(trim(name)) between 1 and 60),
  address      text check (address is null or char_length(address) <= 200),
  lat          double precision not null check (lat between -90 and 90),
  lng          double precision not null check (lng between -180 and 180),
  radius_m     integer not null default 120 check (radius_m between 50 and 1000),
  created_by   uuid not null default auth.uid() references profiles(id),
  created_at   timestamptz not null default now(),
  archived_at  timestamptz,
  constraint commitment_locations_one_owner check (num_nonnulls(team_id, practice_id) = 1)
);
create index if not exists cl_team     on commitment_locations (team_id) where team_id is not null;
create index if not exists cl_practice on commitment_locations (practice_id) where practice_id is not null;

-- ---------------------------------------------------------------- commitments (the schedule)
-- title / message / action_label are the COACH'S WORDS. No product copy is ever written here:
-- the composer offers tappable starters that load into the field for editing, and the client
-- supplies a render-time default when a column is null. That keeps the column honest about
-- whether the coach actually chose the string.
create table if not exists commitments (
  id                    uuid primary key default gen_random_uuid(),
  team_id               uuid references teams(id) on delete cascade,
  practice_id           uuid references practices(id) on delete cascade,
  type                  text not null check (type in (
                          'morning_roll_call','practice','strength','speed','team_meeting',
                          'study_hall','tutoring','class','rehab','nutrition')),

  title                 text not null check (char_length(trim(title)) between 1 and 60),
  message               text check (message is null or char_length(message) <= 200),
  action_label          text check (action_label is null or char_length(action_label) <= 24),

  -- audience_value is room_id (team_rooms, 0101) | group_id (coach_groups, 0071) | athlete_id;
  -- null when audience_kind = 'team', which means the whole book.
  audience_kind         text not null check (audience_kind in ('team','room','group','athlete')),
  audience_value        uuid,

  repeat_days           smallint[] not null default '{}'      -- JS getDay(): 0=Sun … 6=Sat
                          check (repeat_days <@ array[0,1,2,3,4,5,6]::smallint[]),
  starts_on             date not null default (now() at time zone 'utc')::date,
  ends_on               date,
  timezone              text not null default 'America/New_York',

  -- minute-of-day, matching every existing requirement window in the product
  starts_min            smallint not null check (starts_min between 0 and 1439),
  ends_min              smallint check (ends_min between 0 and 1439),
  respond_by_min        smallint check (respond_by_min between 0 and 1439),
  opens_min             smallint check (opens_min between 0 and 1439),

  -- arrival verification; ALL nullable — a team meeting can skip location entirely
  location_id           uuid references commitment_locations(id) on delete set null,
  arrive_by_min         smallint check (arrive_by_min between 0 and 1439),
  arrival_grace_min     smallint not null default 10 check (arrival_grace_min between 0 and 120),
  min_dwell_min         smallint check (min_dwell_min between 0 and 480),

  -- what makes the roll-call card read "Practice at 6:00 AM"
  linked_commitment_id  uuid references commitments(id) on delete set null,
  reminder_offsets_min  smallint[] not null default '{15,5}',

  active                boolean not null default true,
  created_by            uuid not null default auth.uid() references profiles(id),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),

  constraint commitments_one_owner      check (num_nonnulls(team_id, practice_id) = 1),
  constraint commitments_window         check (ends_min is null or ends_min >= starts_min),
  constraint commitments_no_self_link   check (linked_commitment_id is distinct from id)
);
create index if not exists cm_team     on commitments (team_id, active) where team_id is not null;
create index if not exists cm_practice on commitments (practice_id, active) where practice_id is not null;
create index if not exists cm_linked   on commitments (linked_commitment_id) where linked_commitment_id is not null;

-- ---------------------------------------------------------------- instances (dated occurrences)
-- Materialized lazily by ensure_commitment_instances — no nightly cron to fail silently.
-- This table is where "practice moved to 6:30 today" and "cancelled Thursday" live, so a schedule
-- adjustment never has to mutate the standing rule and rewrite history.
create table if not exists commitment_instances (
  id                uuid primary key default gen_random_uuid(),
  commitment_id     uuid not null references commitments(id) on delete cascade,
  occurs_on         date not null,
  starts_at         timestamptz not null,
  ends_at           timestamptz,
  respond_by_at     timestamptz,
  arrive_by_at      timestamptz,
  status            text not null default 'scheduled' check (status in ('scheduled','cancelled')),
  message_override  text check (message_override is null or char_length(message_override) <= 200),
  note              text check (note is null or char_length(note) <= 200),
  created_at        timestamptz not null default now(),
  unique (commitment_id, occurs_on)
);
create index if not exists ci_commit_date on commitment_instances (commitment_id, occurs_on desc);
create index if not exists ci_starts      on commitment_instances (starts_at);

-- ---------------------------------------------------------------- responses (the heart)
-- One row per athlete per instance. Three timestamps and a verdict.
-- 'unverified' is NOT 'missed': a dead phone, a revoked permission, weak GPS indoors, or a session
-- moved to another field must never be silently converted into a failure. The scoring engine drops
-- unverified signals out of the denominator rather than counting them against the athlete.
create table if not exists commitment_responses (
  id                uuid primary key default gen_random_uuid(),
  instance_id       uuid not null references commitment_instances(id) on delete cascade,
  athlete_id        uuid not null references profiles(id) on delete cascade,

  acknowledged_at   timestamptz,
  arrived_at        timestamptz,
  completed_at      timestamptz,
  departed_at       timestamptz,

  arrival_source    text check (arrival_source in ('geofence','manual','staff')),
  status            text not null default 'pending' check (status in (
                      'pending','acknowledged','arrived','completed',
                      'missed','excused','unverified')),
  unverified_reason text check (unverified_reason is null or char_length(unverified_reason) <= 60),

  excused_by        uuid references profiles(id),
  excused_reason    text check (excused_reason is null or char_length(excused_reason) <= 120),
  corrected_by      uuid references profiles(id),
  corrected_at      timestamptz,
  disputed_at       timestamptz,
  dispute_note      text check (dispute_note is null or char_length(dispute_note) <= 200),

  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (instance_id, athlete_id)
);
create index if not exists cr_athlete  on commitment_responses (athlete_id, created_at desc);
create index if not exists cr_instance on commitment_responses (instance_id);

-- ---------------------------------------------------------------- consent
-- Slice 2 enforces this (0138). The table lands now so the shape ships once.
-- 'guardian' rides the existing guardian flow (0008); 'institutional' is an athletic director
-- asserting the signed paperwork a program already collects, and is written to admin_audit_log.
create table if not exists verification_consent (
  id           uuid primary key default gen_random_uuid(),
  athlete_id   uuid not null references profiles(id) on delete cascade,
  kind         text not null check (kind in ('guardian','institutional')),
  granted_by   uuid not null references profiles(id),
  granted_at   timestamptz not null default now(),
  revoked_at   timestamptz,
  scope_team   uuid references teams(id) on delete cascade,
  note         text check (note is null or char_length(note) <= 200)
);
create index if not exists vc_athlete on verification_consent (athlete_id) where revoked_at is null;

-- The athlete's own switch for the recruit-facing Verified Discipline profile (§9). Off by
-- default: aggregated consistency is never shared until the athlete turns it on.
alter table profiles add column if not exists
  share_verified_discipline boolean not null default false;

-- ---------------------------------------------------------------- RLS
-- READ policies only. Every write path is a definer RPC below.
alter table commitment_locations  enable row level security;
alter table commitments           enable row level security;
alter table commitment_instances  enable row level security;
alter table commitment_responses  enable row level security;
alter table verification_consent  enable row level security;

-- ⚠ RECURSION. The natural way to write these policies is for commitment_instances to ask
-- "does this athlete hold a response?" and for commitment_responses to ask "is this caller staff
-- over the parent instance?" — which makes each policy evaluate the other's table and Postgres
-- raises "infinite recursion detected in policy for relation commitment_instances". (The same
-- trap 0075 hit between meal_plans and plan_assignments.) The fix is these three SECURITY DEFINER
-- helpers: running as the table owner they bypass RLS, so no policy ever evaluates another
-- policy. The suite probes the boundary itself, not the mechanism, so the shortcut is safe.
create or replace function has_commitment_response(p_instance uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from commitment_responses r
                  where r.instance_id = p_instance and r.athlete_id = auth.uid());
$$;

create or replace function instance_owner_is_staff(p_instance uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from commitment_instances i
                   join commitments c on c.id = i.commitment_id
                  where i.id = p_instance
                    and commitment_owner_is_staff(c.team_id, c.practice_id));
$$;

create or replace function has_commitment_row(p_commitment uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from commitment_instances i
                   join commitment_responses r on r.instance_id = i.id
                  where i.commitment_id = p_commitment and r.athlete_id = auth.uid());
$$;

drop policy if exists cl_read on commitment_locations;
create policy cl_read on commitment_locations for select
  using (commitment_owner_is_staff(team_id, practice_id));

-- Staff read their own book. An athlete reads a commitment only when they hold a response row for
-- one of its instances — which is precisely the set aimed at them, and nothing else.
drop policy if exists cm_read on commitments;
create policy cm_read on commitments for select
  using (commitment_owner_is_staff(team_id, practice_id) or has_commitment_row(id));

drop policy if exists cin_read on commitment_instances;
create policy cin_read on commitment_instances for select
  using (instance_owner_is_staff(id) or has_commitment_response(id));

-- The athlete sees ONLY their own row. There is no path by which one athlete reads another
-- athlete's response — no public list, no leaderboard, nothing that embarrasses anyone.
drop policy if exists cr_read on commitment_responses;
create policy cr_read on commitment_responses for select
  using (athlete_id = auth.uid() or instance_owner_is_staff(instance_id));

drop policy if exists vc_read on verification_consent;
create policy vc_read on verification_consent for select
  using (athlete_id = auth.uid() or (scope_team is not null and is_team_staff(scope_team)));

-- ⚠ GRANTS. 0013 revoked defaults, and the RLS suite does NOT catch a missing grant — a policy
-- can be perfect while every read returns "permission denied for table". SELECT only: no
-- insert/update/delete grant exists anywhere in this feature, by design.
grant select on commitment_locations, commitments, commitment_instances,
                commitment_responses, verification_consent to authenticated;

-- ================================================================ RPCs

-- ---------------------------------------------------------------- upsert_commitment
-- One call for create and edit; the client sends the whole row as jsonb.
-- The role gate mirrors CREATE_CAPS in proto js/staff-access.js: head_coach, coordinator (and its
-- legacy 'assistant' spelling), s_and_c and team_admin hold 'schedule'. A position coach can SEE
-- their room's board but cannot schedule. A practice has one operator, so owns_practice suffices.
create or replace function upsert_commitment(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_team uuid; v_practice uuid; v_role text;
begin
  v_id       := nullif(p->>'id','')::uuid;
  v_team     := nullif(p->>'team_id','')::uuid;
  v_practice := nullif(p->>'practice_id','')::uuid;

  if not commitment_owner_is_staff(v_team, v_practice) then
    raise exception 'not authorized for this team or practice';
  end if;

  if v_team is not null then
    select role::text into v_role from team_staff
     where team_id = v_team and staff_id = auth.uid() and status = 'active';
    if coalesce(v_role, 'head_coach') not in
       ('head_coach','coordinator','assistant','s_and_c','team_admin') then
      raise exception 'role % may not schedule commitments', v_role;
    end if;
  end if;

  -- An EDIT must not be able to walk a commitment into another coach's book. This only applies
  -- when the id already exists: a client is free to mint the uuid for a NEW commitment, and an
  -- unconditional guard here would reject every such create.
  if v_id is not null
     and exists (select 1 from commitments where id = v_id)
     and not exists (
       select 1 from commitments c where c.id = v_id
         and c.team_id is not distinct from v_team
         and c.practice_id is not distinct from v_practice
     ) then
    raise exception 'commitment does not belong to this team or practice';
  end if;

  insert into commitments (
    id, team_id, practice_id, type, title, message, action_label,
    audience_kind, audience_value, repeat_days, starts_on, ends_on, timezone,
    starts_min, ends_min, respond_by_min, opens_min,
    location_id, arrive_by_min, arrival_grace_min, min_dwell_min,
    linked_commitment_id, reminder_offsets_min, active, created_by
  ) values (
    coalesce(v_id, gen_random_uuid()), v_team, v_practice,
    p->>'type', p->>'title', nullif(p->>'message',''), nullif(p->>'action_label',''),
    p->>'audience_kind', nullif(p->>'audience_value','')::uuid,
    coalesce((select array_agg(x::smallint) from jsonb_array_elements_text(p->'repeat_days') x), '{}'::smallint[]),
    coalesce((p->>'starts_on')::date, (now() at time zone 'utc')::date),
    nullif(p->>'ends_on','')::date,
    coalesce(nullif(p->>'timezone',''), 'America/New_York'),
    (p->>'starts_min')::smallint, nullif(p->>'ends_min','')::smallint,
    nullif(p->>'respond_by_min','')::smallint, nullif(p->>'opens_min','')::smallint,
    nullif(p->>'location_id','')::uuid, nullif(p->>'arrive_by_min','')::smallint,
    coalesce(nullif(p->>'arrival_grace_min','')::smallint, 10::smallint),
    nullif(p->>'min_dwell_min','')::smallint,
    nullif(p->>'linked_commitment_id','')::uuid,
    coalesce((select array_agg(x::smallint) from jsonb_array_elements_text(p->'reminder_offsets_min') x), '{15,5}'::smallint[]),
    coalesce((p->>'active')::boolean, true), auth.uid()
  )
  on conflict (id) do update set
    type = excluded.type, title = excluded.title, message = excluded.message,
    action_label = excluded.action_label, audience_kind = excluded.audience_kind,
    audience_value = excluded.audience_value, repeat_days = excluded.repeat_days,
    starts_on = excluded.starts_on, ends_on = excluded.ends_on, timezone = excluded.timezone,
    starts_min = excluded.starts_min, ends_min = excluded.ends_min,
    respond_by_min = excluded.respond_by_min, opens_min = excluded.opens_min,
    location_id = excluded.location_id, arrive_by_min = excluded.arrive_by_min,
    arrival_grace_min = excluded.arrival_grace_min, min_dwell_min = excluded.min_dwell_min,
    linked_commitment_id = excluded.linked_commitment_id,
    reminder_offsets_min = excluded.reminder_offsets_min,
    active = excluded.active, updated_at = now()
  returning id into v_id;

  return v_id;
end $$;

-- ---------------------------------------------------------------- commitment_audience
-- ONE place that answers "who is this for", so materialization and the board can never disagree
-- about the roster. 'room' resolves through team_members.room_id (0101), which already
-- auto-assigns a joining athlete from their position — so "Linebackers" needs nothing new.
create or replace function commitment_audience(p_commitment uuid) returns setof uuid
language plpgsql stable security definer set search_path = public as $$
declare c commitments;
begin
  select * into c from commitments where id = p_commitment;
  if not found then return; end if;

  if c.audience_kind = 'athlete' then
    return query select c.audience_value where c.audience_value is not null;
  elsif c.audience_kind = 'group' then
    return query select unnest(g.athlete_ids) from coach_groups g where g.id = c.audience_value;
  elsif c.audience_kind = 'room' then
    return query select tm.athlete_id from team_members tm
      where tm.team_id = c.team_id and tm.room_id = c.audience_value and tm.status = 'active';
  else
    if c.team_id is not null then
      return query select tm.athlete_id from team_members tm
        where tm.team_id = c.team_id and tm.status = 'active';
    else
      return query select pc.client_id from practice_clients pc
        where pc.practice_id = c.practice_id and pc.status = 'active';
    end if;
  end if;
end $$;

-- ---------------------------------------------------------------- ensure_commitment_instances
-- Lazily materializes instances + their pending response rows for a date window. Idempotent, so
-- every dashboard load can call it. Callable by staff AND by an athlete on their own book, because
-- the athlete's Home is often the first thing open at 4:30 AM — if only staff could materialize,
-- an athlete whose coach hadn't opened the app would see no card at all.
create or replace function ensure_commitment_instances(
  p_team uuid, p_practice uuid, p_from date, p_to date
) returns integer
language plpgsql security definer set search_path = public as $$
declare c commitments; d date; n integer := 0; v_inst uuid; v_last date;
begin
  if not commitment_owner_is_staff(p_team, p_practice)
     and not exists (select 1 from team_members
                      where athlete_id = auth.uid() and team_id = p_team and status = 'active')
     and not exists (select 1 from practice_clients
                      where client_id = auth.uid() and practice_id = p_practice and status = 'active')
  then
    raise exception 'not authorized';
  end if;

  if p_from is null or p_to is null or p_to < p_from then return 0; end if;
  if p_to - p_from > 62 then raise exception 'window too large'; end if;

  for c in select * from commitments
            where active
              and ((p_team is not null and team_id = p_team)
                or (p_practice is not null and practice_id = p_practice))
  loop
    d := greatest(p_from, c.starts_on);
    v_last := least(p_to, coalesce(c.ends_on, p_to));
    while d <= v_last loop
      if extract(dow from d)::smallint = any(c.repeat_days) then
        -- v_inst MUST be reset: `on conflict do nothing` returns no row, and a stale value from a
        -- previous iteration would re-seed responses against the wrong instance.
        v_inst := null;
        insert into commitment_instances (
          commitment_id, occurs_on, starts_at, ends_at, respond_by_at, arrive_by_at
        ) values (
          c.id, d,
          (d + make_interval(mins => c.starts_min::int)) at time zone c.timezone,
          case when c.ends_min is null then null
               else (d + make_interval(mins => c.ends_min::int)) at time zone c.timezone end,
          case when c.respond_by_min is null then null
               else (d + make_interval(mins => c.respond_by_min::int)) at time zone c.timezone end,
          case when c.arrive_by_min is null then null
               else (d + make_interval(mins => c.arrive_by_min::int)) at time zone c.timezone end
        )
        on conflict (commitment_id, occurs_on) do nothing
        returning id into v_inst;

        if v_inst is not null then
          insert into commitment_responses (instance_id, athlete_id)
          select v_inst, a from commitment_audience(c.id) a
          on conflict (instance_id, athlete_id) do nothing;
          n := n + 1;
        end if;
      end if;
      d := d + 1;
    end loop;
  end loop;
  return n;
end $$;

-- The athlete's own path into materialization. Home is often the first thing open at 4:30 AM,
-- and the client has no reason to know its team or practice uuid — it just needs today's card.
-- Loops both link types because an athlete can be on a team AND a trainer's client.
create or replace function ensure_my_commitment_instances(p_from date, p_to date) returns integer
language plpgsql security definer set search_path = public as $$
declare v_n integer := 0; t uuid; p uuid;
begin
  for t in select team_id from team_members
            where athlete_id = auth.uid() and status = 'active' loop
    v_n := v_n + ensure_commitment_instances(t, null, p_from, p_to);
  end loop;
  for p in select practice_id from practice_clients
            where client_id = auth.uid() and status = 'active' loop
    v_n := v_n + ensure_commitment_instances(null, p, p_from, p_to);
  end loop;
  return v_n;
end $$;

-- ---------------------------------------------------------------- ack_commitment
-- The wake-up response. The SERVER clock stamps it — a client-supplied time is not a verification.
-- coalesce() makes a double-tap idempotent: the first response stands, always.
create or replace function ack_commitment(p_instance uuid) returns timestamptz
language plpgsql security definer set search_path = public as $$
declare v_at timestamptz;
begin
  update commitment_responses
     set acknowledged_at = coalesce(acknowledged_at, now()),
         status = case when status in ('pending','missed') then 'acknowledged' else status end,
         updated_at = now()
   where instance_id = p_instance and athlete_id = auth.uid()
   returning acknowledged_at into v_at;
  if v_at is null then raise exception 'no commitment for you on this instance'; end if;
  return v_at;
end $$;

-- ---------------------------------------------------------------- commitment_board
-- The coach's live payload: every instance today with its full roster and response times.
create or replace function commitment_board(p_team uuid, p_practice uuid, p_on date)
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(x order by x->>'starts_at'), '[]'::jsonb) from (
    select jsonb_build_object(
      'instance_id', i.id, 'commitment_id', c.id, 'type', c.type,
      'title', c.title, 'message', coalesce(i.message_override, c.message),
      'action_label', c.action_label,
      'starts_at', i.starts_at, 'ends_at', i.ends_at,
      'respond_by_at', i.respond_by_at, 'arrive_by_at', i.arrive_by_at,
      'starts_min', c.starts_min, 'respond_by_min', c.respond_by_min,
      'instance_status', i.status,
      'audience_kind', c.audience_kind,
      'audience_label', case
        when c.audience_kind = 'room'  then (select r.label from team_rooms r where r.id = c.audience_value)
        when c.audience_kind = 'group' then (select g.name from coach_groups g where g.id = c.audience_value)
        when c.audience_kind = 'athlete' then (select p.full_name from profiles p where p.id = c.audience_value)
        else null end,
      'linked_title', (select l.title from commitments l where l.id = c.linked_commitment_id),
      'linked_starts_min', (select l.starts_min from commitments l where l.id = c.linked_commitment_id),
      'asks_arrival', (c.location_id is not null),
      'location_name', (select cl.name from commitment_locations cl where cl.id = c.location_id),
      'rows', (
        select coalesce(jsonb_agg(jsonb_build_object(
          'response_id', r.id, 'athlete_id', r.athlete_id, 'name', p.full_name,
          'status', r.status,
          'acknowledged_at', r.acknowledged_at, 'arrived_at', r.arrived_at,
          'completed_at', r.completed_at, 'arrival_source', r.arrival_source,
          'unverified_reason', r.unverified_reason, 'excused_reason', r.excused_reason,
          'corrected_by_name', (select p2.full_name from profiles p2 where p2.id = r.corrected_by),
          'disputed_at', r.disputed_at, 'dispute_note', r.dispute_note
        ) order by p.full_name), '[]'::jsonb)
        from commitment_responses r join profiles p on p.id = r.athlete_id
        where r.instance_id = i.id
      )
    ) as x
    from commitment_instances i
    join commitments c on c.id = i.commitment_id
    where i.occurs_on = p_on
      and ((p_team is not null and c.team_id = p_team)
        or (p_practice is not null and c.practice_id = p_practice))
      and commitment_owner_is_staff(c.team_id, c.practice_id)
  ) s;
$$;

-- ---------------------------------------------------------------- my_commitments
-- The athlete's own rows. Carries the minute-of-day fields too so the pure client engine can
-- decide visibility and reminder timing without a second round trip.
create or replace function my_commitments(p_from date, p_to date)
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(x order by x->>'starts_at'), '[]'::jsonb) from (
    select jsonb_build_object(
      'response_id', r.id, 'instance_id', i.id, 'occurs_on', i.occurs_on,
      'type', c.type, 'title', c.title,
      'message', coalesce(i.message_override, c.message),
      'action_label', c.action_label,
      'starts_at', i.starts_at, 'ends_at', i.ends_at,
      'respond_by_at', i.respond_by_at, 'arrive_by_at', i.arrive_by_at,
      'opens_min', c.opens_min, 'starts_min', c.starts_min, 'ends_min', c.ends_min,
      'respond_by_min', c.respond_by_min, 'arrive_by_min', c.arrive_by_min,
      'min_dwell_min', c.min_dwell_min, 'arrival_grace_min', c.arrival_grace_min,
      'reminder_offsets_min', c.reminder_offsets_min,
      'repeat_days', c.repeat_days, 'starts_on', c.starts_on, 'ends_on', c.ends_on,
      'instance_status', i.status,
      'linked_title', (select l.title from commitments l where l.id = c.linked_commitment_id),
      'linked_starts_min', (select l.starts_min from commitments l where l.id = c.linked_commitment_id),
      'asks_arrival', (c.location_id is not null),
      'location_name', (select cl.name from commitment_locations cl where cl.id = c.location_id),
      'coach_name', (select p.full_name from profiles p where p.id = c.created_by),
      'status', r.status, 'acknowledged_at', r.acknowledged_at,
      'arrived_at', r.arrived_at, 'completed_at', r.completed_at,
      'arrival_source', r.arrival_source, 'unverified_reason', r.unverified_reason,
      'disputed_at', r.disputed_at, 'excused_reason', r.excused_reason
    ) as x
    from commitment_responses r
    join commitment_instances i on i.id = r.instance_id
    join commitments c on c.id = i.commitment_id
    where r.athlete_id = auth.uid() and i.occurs_on between p_from and p_to
  ) s;
$$;

-- ---------------------------------------------------------------- staff_set_response
-- Excuse, or manually correct the kid whose phone died. EVERY correction is attributed:
-- corrected_by + corrected_at are always stamped, so nothing in the coach UI can silently
-- rewrite an athlete's record.
create or replace function staff_set_response(p_response uuid, p_status text, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
declare v_ok boolean;
begin
  if p_status not in ('pending','acknowledged','arrived','completed','missed','excused','unverified')
  then raise exception 'bad status %', p_status; end if;

  select commitment_owner_is_staff(c.team_id, c.practice_id) into v_ok
    from commitment_responses r
    join commitment_instances i on i.id = r.instance_id
    join commitments c on c.id = i.commitment_id
   where r.id = p_response;
  if not coalesce(v_ok, false) then raise exception 'not authorized'; end if;

  update commitment_responses set
    status = p_status,
    excused_by     = case when p_status = 'excused' then auth.uid() else excused_by end,
    excused_reason = case when p_status = 'excused'
                          then nullif(left(coalesce(p_reason,''),120),'') else excused_reason end,
    unverified_reason = case when p_status = 'unverified'
                          then nullif(left(coalesce(p_reason,''),60),'') else unverified_reason end,
    corrected_by = auth.uid(), corrected_at = now(),
    acknowledged_at = case when p_status in ('acknowledged','arrived','completed')
                           then coalesce(acknowledged_at, now()) else acknowledged_at end,
    arrived_at      = case when p_status in ('arrived','completed')
                           then coalesce(arrived_at, now()) else arrived_at end,
    completed_at    = case when p_status = 'completed'
                           then coalesce(completed_at, now()) else completed_at end,
    arrival_source  = case when p_status in ('arrived','completed')
                           then coalesce(arrival_source, 'staff') else arrival_source end,
    updated_at = now()
  where id = p_response;
end $$;

-- ---------------------------------------------------------------- remind_missing
-- Reaches ONLY athletes who have not responded. The coach never counts replies and never calls
-- anyone out in a group chat. Push delivery rides the existing send-push function, which reads
-- the notifications table (0027).
create or replace function remind_missing(p_instance uuid) returns integer
language plpgsql security definer set search_path = public as $$
declare v_ok boolean; v_title text; v_n integer;
begin
  select commitment_owner_is_staff(c.team_id, c.practice_id), c.title into v_ok, v_title
    from commitment_instances i join commitments c on c.id = i.commitment_id
   where i.id = p_instance;
  if not coalesce(v_ok, false) then raise exception 'not authorized'; end if;

  insert into notifications (user_id, kind, title, body)
  select r.athlete_id, 'commitment_reminder', v_title,
         'Your coach is still waiting on your response.'
    from commitment_responses r
   where r.instance_id = p_instance and r.status = 'pending';
  get diagnostics v_n = row_count;
  return coalesce(v_n, 0);
end $$;

-- ---------------------------------------------------------------- accountability
-- The weighted rollup: acknowledge 10 / arrive on time 30 / complete 60 (founder weighting —
-- small, moderate, greatest). Mirrors accountability() in proto js/commitments.js, which is the
-- source of truth for DISPLAY; this exists for ranges too large to ship to the client.
--
-- Two rules encoded here that matter more than the arithmetic:
--   1. A missed wake-up does NOT cascade. Each signal is scored independently, so sleeping through
--      roll call but standing on the field at 5:50 loses 10 and keeps 90.
--   2. 'excused' leaves the row entirely; 'unverified' removes only the signals it could not
--      verify. Neither is ever counted as a failure.
--
-- ⚠ AUTHORIZATION LIVES IN THE CALLERS, NOT HERE. accountability_raw does NO auth check and is
-- deliberately NOT granted to authenticated — only the two definer functions below call it.
-- Filtering rows by auth.uid() *inside* this computation was the original shape and was wrong:
-- verified_discipline (which gates on the athlete's own share switch) would then have every row
-- filtered away for the very recruiter it had just authorized, and silently return nulls. Two
-- different gates, two different callers, one shared arithmetic.
create or replace function accountability_raw(p_athlete uuid, p_from date, p_to date)
returns jsonb language sql stable security definer set search_path = public as $$
  with r as (
    select cr.status, cr.acknowledged_at, cr.arrived_at, cr.completed_at,
           ci.arrive_by_at,
           (c.respond_by_min is not null or c.type = 'morning_roll_call') as asks_ack,
           (c.location_id is not null)                                    as asks_arrival,
           (c.type <> 'morning_roll_call')                                as asks_completion,
           (cr.status <> 'unverified')                                    as verified
      from commitment_responses cr
      join commitment_instances ci on ci.id = cr.instance_id
      join commitments c on c.id = ci.commitment_id
     where cr.athlete_id = p_athlete
       and ci.occurs_on between p_from and p_to
       and ci.status = 'scheduled'
       and cr.status <> 'excused'
  ), s as (
    select *,
      (arrived_at is not null and (arrive_by_at is null or arrived_at <= arrive_by_at)) as on_time
    from r
  )
  select jsonb_build_object(
    'wake_done',      count(*) filter (where asks_ack and acknowledged_at is not null),
    'wake_total',     count(*) filter (where asks_ack),
    'arrival_done',   count(*) filter (where asks_arrival and verified and on_time),
    'arrival_total',  count(*) filter (where asks_arrival and verified),
    'complete_done',  count(*) filter (where asks_completion and verified and completed_at is not null),
    'complete_total', count(*) filter (where asks_completion and verified),
    'earned', coalesce(sum(
        (case when asks_ack and acknowledged_at is not null then 10 else 0 end) +
        (case when asks_arrival and verified and on_time then 30 else 0 end) +
        (case when asks_completion and verified and completed_at is not null then 60 else 0 end)), 0),
    'possible', coalesce(sum(
        (case when asks_ack then 10 else 0 end) +
        (case when asks_arrival and verified then 30 else 0 end) +
        (case when asks_completion and verified then 60 else 0 end)), 0)
  ) from s;
$$;

-- The athlete themselves, or staff who can already see this athlete (can_view — 0002/0081,
-- which covers team coach, trainer and guardian). Anyone else gets nothing.
create or replace function athlete_accountability(p_athlete uuid, p_from date, p_to date)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not can_view(p_athlete) then
    raise exception 'not authorized to read this athlete''s accountability';
  end if;
  return accountability_raw(p_athlete, p_from, p_to);
end $$;

-- ---------------------------------------------------------------- verified_discipline
-- The recruit-facing aggregate. Percentages and counts ONLY: this function is structurally
-- incapable of returning an event, a location, a class name, a time of day, or a schedule.
-- Gated on the ATHLETE'S OWN switch — nobody else can turn sharing on.
create or replace function verified_discipline(p_athlete uuid, p_from date, p_to date)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare a jsonb; v_share boolean;
begin
  select share_verified_discipline into v_share from profiles where id = p_athlete;
  if p_athlete <> auth.uid() and not coalesce(v_share, false) then
    raise exception 'this athlete has not shared their discipline profile';
  end if;

  a := accountability_raw(p_athlete, p_from, p_to);

  return jsonb_build_object(
    'on_time_arrival_pct', case when (a->>'arrival_total')::int > 0
      then round(100.0 * (a->>'arrival_done')::int / (a->>'arrival_total')::int) else null end,
    'commitments_completed', (a->>'complete_done')::int,
    'morning_response_pct', case when (a->>'wake_total')::int > 0
      then round(100.0 * (a->>'wake_done')::int / (a->>'wake_total')::int) else null end,
    'accountability_pct', case when (a->>'possible')::int > 0
      then round(100.0 * (a->>'earned')::int / (a->>'possible')::int) else null end
  );
end $$;

-- ---------------------------------------------------------------- function grants
-- accountability_raw is deliberately absent: it performs no authorization of its own and is
-- reachable only from the two definer functions above.
revoke all on function accountability_raw(uuid, date, date) from public, anon, authenticated;

do $$ declare f text; begin
  foreach f in array array[
    'upsert_commitment(jsonb)',
    'commitment_audience(uuid)',
    'has_commitment_response(uuid)',
    'instance_owner_is_staff(uuid)',
    'has_commitment_row(uuid)',
    'ensure_commitment_instances(uuid,uuid,date,date)',
    'ensure_my_commitment_instances(date,date)',
    'commitment_board(uuid,uuid,date)',
    'my_commitments(date,date)',
    'ack_commitment(uuid)',
    'staff_set_response(uuid,text,text)',
    'remind_missing(uuid)',
    'athlete_accountability(uuid,date,date)',
    'verified_discipline(uuid,date,date)'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
