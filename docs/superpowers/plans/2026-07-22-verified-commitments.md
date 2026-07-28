# Verified Commitments Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a coach-facing system that verifies athletes acknowledge, arrive for, and complete scheduled responsibilities — Morning Roll Call plus location-verified arrival — without tracking anyone's movements.

**Architecture:** One new scheduling primitive (`commitments`) expanded lazily into dated `commitment_instances`, each producing one `commitment_responses` row per athlete carrying three timestamps. A pure, Node-testable engine (`proto/redesign-2026-07/js/commitments.js`) owns all recurrence, status, and scoring logic; screens render from it. Location verification is an optional layer that writes a verdict and a timestamp, never coordinates.

**Tech Stack:** Postgres/Supabase (RLS + `security definer` RPCs), vanilla ES modules in the proto WebView (the shipped UI), React Native + `expo-location` for the native bridge, `node --test` for pure modules, `bash supabase/tests/run.sh` for RLS.

**Spec:** [`docs/superpowers/specs/2026-07-22-verified-commitments-design.md`](../specs/2026-07-22-verified-commitments-design.md)

## Global Constraints

- **The daily 0–100 score is untouched.** Do not modify `PROFILE_WEIGHTS`, `computeComponents`, `scoreFor`, `evidenceCeiling`, or anything in `src/core/scoring.ts`. Verified Commitments produces a *separate* Accountability score.
- **No product copy on athlete-visible strings.** `title`, `message`, and `action_label` are coach-authored. The client may supply a *render-time* default for `action_label` (`I'm Up`) and `title` (the type label) when the column is null — never write those defaults to the database.
- **No coordinate is ever persisted.** No table in this feature has a lat/lng column for an athlete. Comparison happens on-device; only a verdict and timestamp are stored.
- **All timestamps come from the server clock** (`now()` inside the RPC). Never trust a client-supplied response time.
- **New tables need explicit `grant ... to authenticated`** — migration 0013 revoked defaults, and the RLS suite does not catch a missing grant. Every new table gets grants, and Task 3 adds a probe that would fail without them.
- **Dual owner on every new table:** `team_id uuid null references teams(id)` + `practice_id uuid null references practices(id)` with `check (num_nonnulls(team_id, practice_id) = 1)`, matching migration 0136. Trainers get this feature too.
- **Pure modules take no clock and no globals.** `commitments.js` imports nothing from `state.js`, touches no DOM, and receives `nowISO` as an argument — the same contract `requirements.js` and `notify-plan.js` hold.
- **Escape all interpolated strings in HTML** with `esc()` from `components.js`. `npm run lint:xss` enforces this and is part of `npm run verify`.
- **`npm run verify` must be green before each commit** (`lint:xss` → `typecheck` → `jest` → `test:proto` → `bundle`). Jest baseline is 2398 passing; RLS baseline is 275.
- **Commit with explicit paths** (`git add <path> <path>`), never `git add -A` — a concurrent agent may hold uncommitted work in this tree.
- Migration numbering continues from **0136**. Slice 1 is `0137`, slice 2 is `0138`.

---

## File Structure

**Created:**

| Path | Responsibility |
|---|---|
| `supabase/migrations/0138_verified_commitments.sql` | all five tables, RLS, grants, slice-1 RPCs |
| `supabase/migrations/0139_commitment_verification.sql` | arrival/completion RPCs + consent enforcement |
| `supabase/tests/verified_commitments_test.sql` | RLS + grant probes |
| `proto/redesign-2026-07/js/commitments.js` | **pure engine**: recurrence, times, status, scoring |
| `proto/redesign-2026-07/js/commitments.test.mjs` | Node tests for the engine |
| `proto/redesign-2026-07/js/commitment-data.js` | Supabase I/O + runtime cache |
| `proto/redesign-2026-07/js/screens/roll-call.js` | athlete detail: stages, dispute, history |
| `proto/redesign-2026-07/js/screens/coach-commitments.js` | coach board + roster breakdown |
| `proto/redesign-2026-07/js/screens/coach-commit-edit.js` | the composer |
| `proto/redesign-2026-07/js/screens/accountability.js` | Morning Readiness rollup |
| `src/lib/location/geofence.ts` | arm/disarm regions for a window; one-shot fix |
| `src/lib/location/index.ts` | permission state machine + capability probe |
| `src/lib/location/geofence.test.ts` | jest tests for arming selection |
| `plugins/withVerifiedCommitmentsWidget.js` | Expo config plugin for the iOS widget target |
| `ios-widget/` | WidgetKit extension sources |

**Modified:**

| Path | Change |
|---|---|
| `proto/redesign-2026-07/js/screens/home.js` | render the live commitment card in the existing stack |
| `proto/redesign-2026-07/js/screens/coach-home.js` | render the live board card |
| `proto/redesign-2026-07/js/screens/coach-create.js` | "Schedule a commitment" entry behind the `schedule` cap |
| `proto/redesign-2026-07/js/router.js` | four new routes |
| `proto/redesign-2026-07/js/notify-plan.js` | a `commitment` entry type |
| `proto/redesign-2026-07/js/screens/progress.js` | Accountability tile → `accountability` route |
| `proto/redesign-2026-07/js/screens/settings.js` | share-verified-discipline toggle |
| `src/proto/bridge.ts` | `LOCATION_*` message pair |
| `app.config.ts` | location permission strings + background mode |
| `package.json` | `expo-location` |

---

# SLICE 1 — Roll Call (ships over the air)

### Task 1: Schema — tables, RLS, grants

**Files:**
- Create: `supabase/migrations/0138_verified_commitments.sql`

**Interfaces:**
- Produces: tables `commitment_locations`, `commitments`, `commitment_instances`, `commitment_responses`, `verification_consent`; column `profiles.share_verified_discipline`; helper `commitment_owner_is_staff(uuid, uuid) returns boolean`.

- [ ] **Step 1: Write the migration header and the staff predicate**

The predicate collapses the dual-owner branch so every policy below reads identically. `is_team_staff` and `is_practice_staff` already exist (0055, 0136).

```sql
-- OnStandard — Verified Commitments (slice 1): the scheduling primitive + roll call.
-- Spec: docs/superpowers/specs/2026-07-22-verified-commitments-design.md
--
-- Dual-owner columns per 0136: a trainer's practice gets this exactly like a coach's team.
-- No table here stores a coordinate for an athlete. Location comparison happens on device;
-- what persists is a verdict and a timestamp.
--
-- GUARDRAIL: authored + statically reviewed; NOT applied to live here.

create or replace function commitment_owner_is_staff(p_team uuid, p_practice uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select (p_team is not null and is_team_staff(p_team))
      or (p_practice is not null and is_practice_staff(p_practice));
$$;
revoke all on function commitment_owner_is_staff(uuid, uuid) from public, anon;
grant execute on function commitment_owner_is_staff(uuid, uuid) to authenticated;
```

- [ ] **Step 2: Create `commitment_locations` and `commitments`**

Copy the DDL from spec §3.1 and §3.2 verbatim, then add indexes:

```sql
create index if not exists cl_team     on commitment_locations (team_id) where team_id is not null;
create index if not exists cl_practice on commitment_locations (practice_id) where practice_id is not null;
create index if not exists cm_team     on commitments (team_id, active) where team_id is not null;
create index if not exists cm_practice on commitments (practice_id, active) where practice_id is not null;
create index if not exists cm_linked   on commitments (linked_commitment_id) where linked_commitment_id is not null;
```

- [ ] **Step 3: Create `commitment_instances`, `commitment_responses`, `verification_consent`**

DDL from spec §3.3–§3.5 verbatim, plus:

```sql
create index if not exists ci_commit_date on commitment_instances (commitment_id, occurs_on desc);
create index if not exists ci_starts      on commitment_instances (starts_at);
create index if not exists cr_athlete     on commitment_responses (athlete_id, created_at desc);
create index if not exists cr_instance    on commitment_responses (instance_id);
create index if not exists vc_athlete     on verification_consent (athlete_id) where revoked_at is null;

alter table profiles add column if not exists
  share_verified_discipline boolean not null default false;
```

- [ ] **Step 4: Enable RLS and write the policies**

Reads are direct; **all writes go through the definer RPCs in Task 2**, so no table gets an insert/update policy. That is the 0055 idiom.

```sql
alter table commitment_locations  enable row level security;
alter table commitments           enable row level security;
alter table commitment_instances  enable row level security;
alter table commitment_responses  enable row level security;
alter table verification_consent  enable row level security;

drop policy if exists cl_read on commitment_locations;
create policy cl_read on commitment_locations for select
  using (commitment_owner_is_staff(team_id, practice_id));

-- Staff read their own book. An athlete reads a commitment only if they hold a response row
-- for one of its instances — which is precisely the set aimed at them.
drop policy if exists cm_read on commitments;
create policy cm_read on commitments for select
  using (
    commitment_owner_is_staff(team_id, practice_id)
    or exists (
      select 1 from commitment_instances i
      join commitment_responses r on r.instance_id = i.id
      where i.commitment_id = commitments.id and r.athlete_id = auth.uid()
    )
  );

drop policy if exists cin_read on commitment_instances;
create policy cin_read on commitment_instances for select
  using (
    exists (select 1 from commitments c where c.id = commitment_instances.commitment_id
              and commitment_owner_is_staff(c.team_id, c.practice_id))
    or exists (select 1 from commitment_responses r
              where r.instance_id = commitment_instances.id and r.athlete_id = auth.uid())
  );

-- The athlete sees ONLY their own row. Staff see their book's rows. There is no path
-- by which one athlete reads another athlete's response.
drop policy if exists cr_read on commitment_responses;
create policy cr_read on commitment_responses for select
  using (
    athlete_id = auth.uid()
    or exists (
      select 1 from commitment_instances i
      join commitments c on c.id = i.commitment_id
      where i.id = commitment_responses.instance_id
        and commitment_owner_is_staff(c.team_id, c.practice_id)
    )
  );

drop policy if exists vc_read on verification_consent;
create policy vc_read on verification_consent for select
  using (athlete_id = auth.uid() or (scope_team is not null and is_team_staff(scope_team)));
```

- [ ] **Step 5: Grants — the step whose absence fails silently**

```sql
grant select on commitment_locations, commitments, commitment_instances,
                commitment_responses, verification_consent to authenticated;
```

No `insert`/`update`/`delete` grants: writes are RPC-only by design.

- [ ] **Step 6: Verify the SQL parses**

Run: `npx supabase db lint --schema public` if the CLI is linked; otherwise confirm by reading that every `create table` has a matching `enable row level security`, a policy, and appears in the grant list.
Expected: no syntax errors, five tables covered.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/0138_verified_commitments.sql
git commit -m "feat(db): verified commitments schema — commitments, instances, responses, consent"
```

---

### Task 2: Schema — slice-1 RPCs

**Files:**
- Modify: `supabase/migrations/0138_verified_commitments.sql` (append)

**Interfaces:**
- Produces: `upsert_commitment(jsonb) returns uuid`, `ensure_commitment_instances(uuid, uuid, date, date) returns integer`, `commitment_board(uuid, uuid, date) returns jsonb`, `my_commitments(date, date) returns jsonb`, `ack_commitment(uuid) returns timestamptz`, `staff_set_response(uuid, text, text) returns void`, `remind_missing(uuid) returns integer`, `athlete_accountability(uuid, date, date) returns jsonb`, `verified_discipline(uuid, date, date) returns jsonb`.

- [ ] **Step 1: `upsert_commitment`**

Takes the whole row as jsonb so the client has one call for create and edit. Authorizes on the owner, validates the audience target belongs to the same owner, and refuses a `schedule`-capability-less caller by checking `team_staff.role`.

```sql
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
    select role into v_role from team_staff
     where team_id = v_team and staff_id = auth.uid() and active is not false;
    -- Mirrors CREATE_CAPS in staff-access.js: these roles hold 'schedule'.
    if coalesce(v_role,'head_coach') not in
       ('head_coach','coordinator','assistant','s_and_c','team_admin') then
      raise exception 'role % may not schedule commitments', v_role;
    end if;
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
    coalesce((select array_agg(x::smallint) from jsonb_array_elements_text(p->'repeat_days') x), '{}'),
    coalesce((p->>'starts_on')::date, (now() at time zone 'utc')::date),
    nullif(p->>'ends_on','')::date,
    coalesce(nullif(p->>'timezone',''), 'America/New_York'),
    (p->>'starts_min')::smallint, nullif(p->>'ends_min','')::smallint,
    nullif(p->>'respond_by_min','')::smallint, nullif(p->>'opens_min','')::smallint,
    nullif(p->>'location_id','')::uuid, nullif(p->>'arrive_by_min','')::smallint,
    coalesce(nullif(p->>'arrival_grace_min','')::smallint, 10),
    nullif(p->>'min_dwell_min','')::smallint,
    nullif(p->>'linked_commitment_id','')::uuid,
    coalesce((select array_agg(x::smallint) from jsonb_array_elements_text(p->'reminder_offsets_min') x), '{15,5}'),
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
```

- [ ] **Step 2: `commitment_audience(uuid) returns setof uuid`**

One place that answers "who is this for", so instance materialization and the board can never disagree.

```sql
create or replace function commitment_audience(p_commitment uuid) returns setof uuid
language plpgsql stable security definer set search_path = public as $$
declare c commitments;
begin
  select * into c from commitments where id = p_commitment;
  if not found then return; end if;

  if c.audience_kind = 'athlete' then
    return query select c.audience_value;
  elsif c.audience_kind = 'group' then
    return query select unnest(g.athlete_ids) from coach_groups g where g.id = c.audience_value;
  elsif c.audience_kind = 'room' then
    return query select tm.athlete_id from team_members tm
      where tm.team_id = c.team_id and tm.room_id = c.audience_value and tm.active is not false;
  else -- 'team' = the whole book
    if c.team_id is not null then
      return query select tm.athlete_id from team_members tm
        where tm.team_id = c.team_id and tm.active is not false;
    else
      return query select pc.client_id from practice_clients pc
        where pc.practice_id = c.practice_id and pc.active is not false;
    end if;
  end if;
end $$;
```

- [ ] **Step 3: `ensure_commitment_instances`**

Lazily materializes instances and their pending response rows for a date window. Idempotent — safe to call on every dashboard load.

```sql
create or replace function ensure_commitment_instances(
  p_team uuid, p_practice uuid, p_from date, p_to date
) returns integer
language plpgsql security definer set search_path = public as $$
declare c commitments; d date; n integer := 0; v_inst uuid;
begin
  if not commitment_owner_is_staff(p_team, p_practice)
     and not exists (select 1 from team_members where athlete_id = auth.uid() and team_id = p_team)
     and not exists (select 1 from practice_clients where client_id = auth.uid() and practice_id = p_practice)
  then raise exception 'not authorized'; end if;

  if p_to - p_from > 62 then raise exception 'window too large'; end if;

  for c in select * from commitments
            where active
              and ((p_team is not null and team_id = p_team)
                or (p_practice is not null and practice_id = p_practice))
  loop
    d := greatest(p_from, c.starts_on);
    while d <= least(p_to, coalesce(c.ends_on, p_to)) loop
      if extract(dow from d)::smallint = any(c.repeat_days) then
        insert into commitment_instances (
          commitment_id, occurs_on, starts_at, ends_at, respond_by_at, arrive_by_at
        ) values (
          c.id, d,
          (d + make_interval(mins => c.starts_min)) at time zone c.timezone,
          case when c.ends_min is null then null
               else (d + make_interval(mins => c.ends_min)) at time zone c.timezone end,
          case when c.respond_by_min is null then null
               else (d + make_interval(mins => c.respond_by_min)) at time zone c.timezone end,
          case when c.arrive_by_min is null then null
               else (d + make_interval(mins => c.arrive_by_min)) at time zone c.timezone end
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
```

`(d + make_interval(...)) at time zone c.timezone` converts a local wall clock to the correct UTC instant and is DST-correct — this is why `timezone` is stored per commitment.

- [ ] **Step 4: `ack_commitment` — server clock only**

```sql
create or replace function ack_commitment(p_instance uuid) returns timestamptz
language plpgsql security definer set search_path = public as $$
declare v_at timestamptz := now();
begin
  update commitment_responses
     set acknowledged_at = coalesce(acknowledged_at, v_at),
         status = case when status in ('pending','missed') then 'acknowledged' else status end,
         updated_at = now()
   where instance_id = p_instance and athlete_id = auth.uid()
   returning acknowledged_at into v_at;
  if v_at is null then raise exception 'no commitment for you on this instance'; end if;
  return v_at;
end $$;
```

`coalesce` makes a double-tap idempotent: the first time stands.

- [ ] **Step 5: `commitment_board`, `my_commitments`, `staff_set_response`, `remind_missing`**

```sql
create or replace function commitment_board(p_team uuid, p_practice uuid, p_on date)
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(x order by x->>'starts_at'), '[]'::jsonb) from (
    select jsonb_build_object(
      'instance_id', i.id, 'commitment_id', c.id, 'type', c.type,
      'title', c.title, 'message', coalesce(i.message_override, c.message),
      'action_label', c.action_label, 'starts_at', i.starts_at,
      'respond_by_at', i.respond_by_at, 'arrive_by_at', i.arrive_by_at,
      'instance_status', i.status,
      'linked_title', (select l.title from commitments l where l.id = c.linked_commitment_id),
      'linked_starts_min', (select l.starts_min from commitments l where l.id = c.linked_commitment_id),
      'asks_arrival', (c.location_id is not null),
      'rows', (
        select coalesce(jsonb_agg(jsonb_build_object(
          'response_id', r.id, 'athlete_id', r.athlete_id,
          'name', p.full_name, 'status', r.status,
          'acknowledged_at', r.acknowledged_at, 'arrived_at', r.arrived_at,
          'completed_at', r.completed_at, 'arrival_source', r.arrival_source,
          'excused_reason', r.excused_reason, 'disputed_at', r.disputed_at
        ) order by p.full_name), '[]'::jsonb)
        from commitment_responses r join profiles p on p.id = r.athlete_id
        where r.instance_id = i.id
      )
    ) as x
    from commitment_instances i join commitments c on c.id = i.commitment_id
    where i.occurs_on = p_on
      and ((p_team is not null and c.team_id = p_team)
        or (p_practice is not null and c.practice_id = p_practice))
      and commitment_owner_is_staff(c.team_id, c.practice_id)
  ) s;
$$;

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
      'opens_min', c.opens_min, 'starts_min', c.starts_min,
      'respond_by_min', c.respond_by_min, 'min_dwell_min', c.min_dwell_min,
      'instance_status', i.status,
      'linked_title', (select l.title from commitments l where l.id = c.linked_commitment_id),
      'linked_starts_min', (select l.starts_min from commitments l where l.id = c.linked_commitment_id),
      'asks_arrival', (c.location_id is not null),
      'location_name', (select cl.name from commitment_locations cl where cl.id = c.location_id),
      'status', r.status, 'acknowledged_at', r.acknowledged_at,
      'arrived_at', r.arrived_at, 'completed_at', r.completed_at,
      'arrival_source', r.arrival_source, 'disputed_at', r.disputed_at,
      'excused_reason', r.excused_reason
    ) as x
    from commitment_responses r
    join commitment_instances i on i.id = r.instance_id
    join commitments c on c.id = i.commitment_id
    where r.athlete_id = auth.uid() and i.occurs_on between p_from and p_to
  ) s;
$$;

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
    excused_reason = case when p_status = 'excused' then left(coalesce(p_reason,''),120) else excused_reason end,
    corrected_by = auth.uid(), corrected_at = now(),
    acknowledged_at = case when p_status in ('acknowledged','arrived','completed')
                           then coalesce(acknowledged_at, now()) else acknowledged_at end,
    arrived_at   = case when p_status in ('arrived','completed')
                        then coalesce(arrived_at, now()) else arrived_at end,
    completed_at = case when p_status = 'completed' then coalesce(completed_at, now()) else completed_at end,
    arrival_source = case when p_status in ('arrived','completed')
                          then coalesce(arrival_source, 'staff') else arrival_source end,
    updated_at = now()
  where id = p_response;
end $$;

-- Writes one notification per non-responder. Push delivery rides the existing send-push
-- function, which reads the notifications table.
create or replace function remind_missing(p_instance uuid) returns integer
language plpgsql security definer set search_path = public as $$
declare v_ok boolean; v_title text; v_n integer;
begin
  select commitment_owner_is_staff(c.team_id, c.practice_id), c.title into v_ok, v_title
    from commitment_instances i join commitments c on c.id = i.commitment_id
   where i.id = p_instance;
  if not coalesce(v_ok, false) then raise exception 'not authorized'; end if;

  insert into notifications (user_id, kind, title, body)
  select r.athlete_id, 'commitment_reminder', v_title, 'Your coach is waiting on your response.'
    from commitment_responses r
   where r.instance_id = p_instance and r.status = 'pending';
  get diagnostics v_n = row_count;
  return v_n;
end $$;
```

- [ ] **Step 6: `athlete_accountability` and `verified_discipline`**

Both delegate the weighting to SQL so the coach dashboard and any server consumer agree with the client engine. The client engine (Task 5) is the source of truth for *display*; these are for aggregates over ranges too large to ship to the client.

```sql
create or replace function athlete_accountability(p_athlete uuid, p_from date, p_to date)
returns jsonb language sql stable security definer set search_path = public as $$
  with rows as (
    select r.status, r.acknowledged_at, r.arrived_at, r.completed_at,
           i.respond_by_at, i.arrive_by_at,
           (c.respond_by_min is not null) as asks_ack,
           (c.location_id is not null)    as asks_arrival,
           (c.type <> 'morning_roll_call') as asks_completion
      from commitment_responses r
      join commitment_instances i on i.id = r.instance_id
      join commitments c on c.id = i.commitment_id
     where r.athlete_id = p_athlete
       and i.occurs_on between p_from and p_to
       and i.status = 'scheduled'
       and r.status <> 'excused'
       and (r.athlete_id = auth.uid()
            or commitment_owner_is_staff(c.team_id, c.practice_id))
  )
  select jsonb_build_object(
    'wake_done',      count(*) filter (where asks_ack and acknowledged_at is not null),
    'wake_total',     count(*) filter (where asks_ack),
    'arrival_done',   count(*) filter (where asks_arrival and arrived_at is not null
                                        and (arrive_by_at is null or arrived_at <= arrive_by_at)),
    'arrival_total',  count(*) filter (where asks_arrival and status <> 'unverified'),
    'complete_done',  count(*) filter (where asks_completion and completed_at is not null),
    'complete_total', count(*) filter (where asks_completion and status <> 'unverified'),
    'earned', coalesce(sum(
        (case when asks_ack and acknowledged_at is not null then 10 else 0 end) +
        (case when asks_arrival and status <> 'unverified' and arrived_at is not null
                   and (arrive_by_at is null or arrived_at <= arrive_by_at) then 30 else 0 end) +
        (case when asks_completion and status <> 'unverified' and completed_at is not null then 60 else 0 end)
      ), 0),
    'possible', coalesce(sum(
        (case when asks_ack then 10 else 0 end) +
        (case when asks_arrival and status <> 'unverified' then 30 else 0 end) +
        (case when asks_completion and status <> 'unverified' then 60 else 0 end)
      ), 0)
  ) from rows;
$$;

-- Percentages and counts ONLY. Structurally cannot return an event, a location, a class name,
-- a time of day, or a schedule. Gated on the athlete's own share switch.
create or replace function verified_discipline(p_athlete uuid, p_from date, p_to date)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare a jsonb; v_share boolean;
begin
  select share_verified_discipline into v_share from profiles where id = p_athlete;
  if p_athlete <> auth.uid() and not coalesce(v_share, false) then
    raise exception 'this athlete has not shared their discipline profile';
  end if;
  a := athlete_accountability(p_athlete, p_from, p_to);
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
```

- [ ] **Step 7: Function grants**

```sql
do $$ declare f text; begin
  foreach f in array array[
    'upsert_commitment(jsonb)','commitment_audience(uuid)',
    'ensure_commitment_instances(uuid,uuid,date,date)','commitment_board(uuid,uuid,date)',
    'my_commitments(date,date)','ack_commitment(uuid)',
    'staff_set_response(uuid,text,text)','remind_missing(uuid)',
    'athlete_accountability(uuid,date,date)','verified_discipline(uuid,date,date)'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
```

- [ ] **Step 8: Commit**

```bash
git add supabase/migrations/0138_verified_commitments.sql
git commit -m "feat(db): verified commitments RPCs — schedule, materialize, board, ack, accountability"
```

---

### Task 3: RLS probes

**Files:**
- Create: `supabase/tests/verified_commitments_test.sql`
- Modify: `supabase/tests/run.sh` (add the file to the run list)

- [ ] **Step 1: Read the existing suite to match its harness idiom**

Run: `sed -n '1,60p' supabase/tests/rls_authz_test.sql` and `cat supabase/tests/run.sh`
Expected: understand how the suite sets `request.jwt.claims` to impersonate a user and how it reports pass/fail.

- [ ] **Step 2: Write the probes**

Five assertions, each one guarding a promise in the spec:

1. **Athlete isolation** — as athlete B, `select count(*) from commitment_responses where athlete_id = <A>` returns 0.
2. **Staff scope** — as a coach of team X, `commitment_board(<team Y>, null, today)` raises or returns `[]`.
3. **Grants gotcha** — as an athlete, a direct `insert into commitment_responses` fails, while `ack_commitment(<their instance>)` succeeds.
4. **Server clock** — after `ack_commitment`, `acknowledged_at` is within 5 seconds of `now()`.
5. **Idempotent materialization** — calling `ensure_commitment_instances` twice for the same window leaves exactly one instance per commitment per date.

- [ ] **Step 3: Run the suite**

Run: `npm run test:rls`
Expected: baseline 275 assertions plus 5 new, all passing. Docker must be running (`supabase start`).

- [ ] **Step 4: Commit**

```bash
git add supabase/tests/verified_commitments_test.sql supabase/tests/run.sh
git commit -m "test(rls): verified commitments — athlete isolation, staff scope, grants, server clock"
```

---

### Task 4: Pure engine — recurrence, times, status

**Files:**
- Create: `proto/redesign-2026-07/js/commitments.js`
- Test: `proto/redesign-2026-07/js/commitments.test.mjs`

**Interfaces:**
- Produces:
  - `TYPE_LABEL: Record<string,string>`
  - `occursOn(commitment, dateISO): boolean`
  - `opensMinFor(commitment): number`
  - `deriveCommitment(row, nowISO): { stage, status, statusColor, title, message, actionLabel, contextLine, deadlineLine, canAck, canArrive, canComplete, visible, collapsed, confirmLine }`
  - `boardCounts(rows): { total, responded, awaiting, excused, unverified }`
  - `missingFrom(rows): Array<row>`

`row` is one element of `my_commitments` / `commitment_board.rows`. `nowISO` is always an argument — the module holds no clock.

- [ ] **Step 1: Write the failing tests**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { occursOn, opensMinFor, deriveCommitment, boardCounts, missingFrom, TYPE_LABEL } from './commitments.js';

const rollCall = {
  type: 'morning_roll_call', title: 'Morning Roll Call',
  message: 'Everyone up? Ready to rise and conquer?', action_label: null,
  repeat_days: [1, 2, 3, 4, 5], starts_on: '2026-07-01', ends_on: null,
  starts_min: 285, respond_by_min: 315, opens_min: null,
  linked_title: 'Practice', linked_starts_min: 360, asks_arrival: false,
  starts_at: '2026-07-22T08:45:00Z', respond_by_at: '2026-07-22T09:15:00Z',
  status: 'pending', acknowledged_at: null, arrived_at: null, completed_at: null,
};

test('occursOn honours repeat days and the date range', () => {
  assert.equal(occursOn(rollCall, '2026-07-22'), true);   // Wednesday
  assert.equal(occursOn(rollCall, '2026-07-25'), false);  // Saturday
  assert.equal(occursOn({ ...rollCall, starts_on: '2026-08-01' }, '2026-07-22'), false);
  assert.equal(occursOn({ ...rollCall, ends_on: '2026-07-01' }, '2026-07-22'), false);
});

test('opensMinFor falls back to respond_by minus an hour, floored at midnight', () => {
  assert.equal(opensMinFor(rollCall), 255);
  assert.equal(opensMinFor({ ...rollCall, opens_min: 240 }), 240);
  assert.equal(opensMinFor({ ...rollCall, respond_by_min: 30 }), 0);
  assert.equal(opensMinFor({ ...rollCall, respond_by_min: null, starts_min: 600 }), 540);
});

test('an untouched roll call before its deadline is actionable', () => {
  const d = deriveCommitment(rollCall, '2026-07-22T08:50:00Z');
  assert.equal(d.stage, 'open');
  assert.equal(d.canAck, true);
  assert.equal(d.visible, true);
  assert.equal(d.actionLabel, "I'm Up");            // render-time default, not persisted
  assert.equal(d.contextLine, 'Practice at 6:00 AM');
});

test('the coach action label wins over the default', () => {
  const d = deriveCommitment({ ...rollCall, action_label: 'Rise Up' }, '2026-07-22T08:50:00Z');
  assert.equal(d.actionLabel, 'Rise Up');
});

test('an acknowledged roll call collapses to a confirmation with the exact time', () => {
  const d = deriveCommitment(
    { ...rollCall, status: 'acknowledged', acknowledged_at: '2026-07-22T08:48:00Z' },
    '2026-07-22T08:52:00Z');
  assert.equal(d.stage, 'acknowledged');
  assert.equal(d.collapsed, true);
  assert.equal(d.canAck, false);
  assert.match(d.confirmLine, /Checked in at 4:48 AM/);
});

test('past the deadline with no response reads missed, and the card stops asking', () => {
  const d = deriveCommitment(rollCall, '2026-07-22T09:30:00Z');
  assert.equal(d.stage, 'missed');
  assert.equal(d.canAck, false);
});

test('an unverified response never reads as missed', () => {
  const d = deriveCommitment({ ...rollCall, status: 'unverified' }, '2026-07-22T09:30:00Z');
  assert.equal(d.stage, 'unverified');
  assert.notEqual(d.stage, 'missed');
});

test('board counts split responded, awaiting, excused and unverified', () => {
  const rows = [
    { status: 'acknowledged' }, { status: 'arrived' }, { status: 'completed' },
    { status: 'pending' }, { status: 'pending' },
    { status: 'excused' }, { status: 'unverified' },
  ];
  assert.deepEqual(boardCounts(rows),
    { total: 7, responded: 3, awaiting: 2, excused: 1, unverified: 1 });
  assert.equal(missingFrom(rows).length, 2);
});

test('every commitment type has a label', () => {
  for (const t of ['morning_roll_call','practice','strength','speed','team_meeting',
                   'study_hall','tutoring','class','rehab','nutrition']) {
    assert.equal(typeof TYPE_LABEL[t], 'string');
  }
});
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test proto/redesign-2026-07/js/commitments.test.mjs`
Expected: FAIL — `Cannot find module './commitments.js'`.

- [ ] **Step 3: Implement the engine**

Key decisions baked in:
- `fmtClock(iso, tzOffsetMinutes)` renders in the athlete's local zone; the tests use UTC-4 implicitly by passing ISO strings whose local rendering the test asserts. Reuse `fmtMin` from `requirements.js` for minute-of-day rendering so time formatting stays one implementation.
- `stage` is one of `hidden | open | acknowledged | awaiting_arrival | arrived | completed | missed | excused | unverified`.
- `unverified` and `excused` short-circuit before any deadline comparison — a missing signal is never converted into a failure.

```js
/* OnStandard — Verified Commitments engine (pure; no imports from state, no DOM, no clock).
   Every function takes what it needs as an argument, exactly like requirements.js and
   notify-plan.js, so node --test can exercise it directly. */
import { fmtMin } from './requirements.js';

export const TYPE_LABEL = {
  morning_roll_call: 'Morning Roll Call', practice: 'Practice',
  strength: 'Strength Workout', speed: 'Speed Session', team_meeting: 'Team Meeting',
  study_hall: 'Study Hall', tutoring: 'Tutoring', class: 'Class Commitment',
  rehab: 'Rehab', nutrition: 'Nutrition Appointment',
};

const DEFAULT_ACTION = { morning_roll_call: "I'm Up" };
const dowOf = (dateISO) => new Date(String(dateISO) + 'T12:00:00').getDay();

export function occursOn(c, dateISO) {
  if (!c || !Array.isArray(c.repeat_days) || !c.repeat_days.length) return false;
  if (c.starts_on && dateISO < c.starts_on) return false;
  if (c.ends_on && dateISO > c.ends_on) return false;
  return c.repeat_days.map(Number).includes(dowOf(dateISO));
}

export function opensMinFor(c) {
  if (c && typeof c.opens_min === 'number') return c.opens_min;
  const anchor = (c && typeof c.respond_by_min === 'number') ? c.respond_by_min
               : (c && typeof c.starts_min === 'number') ? c.starts_min : 0;
  return Math.max(0, anchor - 60);
}
```

`deriveCommitment` then resolves, in order: `excused` → `unverified` → `completed` → `arrived` → `acknowledged` → deadline comparison (`missed`) → window comparison (`open` / `hidden`). Render-time defaults come from `DEFAULT_ACTION[c.type] || 'Mark done'` and `c.title || TYPE_LABEL[c.type]`. `contextLine` is built from `linked_title` + `fmtMin(linked_starts_min)`; when there is no link it falls back to the commitment's own start time.

- [ ] **Step 4: Run to verify pass**

Run: `node --test proto/redesign-2026-07/js/commitments.test.mjs`
Expected: PASS, 9 tests.

- [ ] **Step 5: Commit**

```bash
git add proto/redesign-2026-07/js/commitments.js proto/redesign-2026-07/js/commitments.test.mjs
git commit -m "feat(proto): verified commitments engine — recurrence, stages, board counts"
```

---

### Task 5: Pure engine — accountability scoring

**Files:**
- Modify: `proto/redesign-2026-07/js/commitments.js`
- Modify: `proto/redesign-2026-07/js/commitments.test.mjs`

**Interfaces:**
- Produces: `WEIGHTS = { ack: 10, arrival: 30, completion: 60 }`, `signalsAsked(row)`, `accountability(rows)`, `morningReadiness(rows)`, `commitmentStreak(rows, todayISO)`.

- [ ] **Step 1: Write the failing tests**

These encode the founder's rules literally.

```js
import { accountability, morningReadiness, commitmentStreak, WEIGHTS, signalsAsked } from './commitments.js';

const inst = (o) => ({
  type: 'practice', respond_by_min: 315, asks_arrival: true,
  arrive_by_at: '2026-07-22T09:50:00Z', status: 'pending',
  acknowledged_at: null, arrived_at: null, completed_at: null, occurs_on: '2026-07-22', ...o,
});

test('weights are small / moderate / greatest', () => {
  assert.equal(WEIGHTS.ack, 10);
  assert.equal(WEIGHTS.arrival, 30);
  assert.equal(WEIGHTS.completion, 60);
});

test('a roll call asks for a response but never for completion', () => {
  assert.deepEqual(signalsAsked(inst({ type: 'morning_roll_call', asks_arrival: false })),
    { ack: true, arrival: false, completion: false });
});

test('a commitment with no location does not ask for arrival', () => {
  assert.deepEqual(signalsAsked(inst({ asks_arrival: false })),
    { ack: true, arrival: false, completion: true });
});

test('a perfect commitment scores 100 percent', () => {
  const r = accountability([inst({
    acknowledged_at: '2026-07-22T08:48:00Z',
    arrived_at: '2026-07-22T09:43:00Z',
    completed_at: '2026-07-22T11:05:00Z', status: 'completed' })]);
  assert.equal(r.earned, 100);
  assert.equal(r.possible, 100);
  assert.equal(r.pct, 100);
});

test('a missed wake-up does not cascade — arriving and finishing keeps 90', () => {
  const r = accountability([inst({
    acknowledged_at: null,
    arrived_at: '2026-07-22T09:43:00Z',
    completed_at: '2026-07-22T11:05:00Z', status: 'completed' })]);
  assert.equal(r.earned, 90);
  assert.equal(r.possible, 100);
  assert.equal(r.pct, 90);
});

test('arriving after the arrival deadline earns nothing for arrival', () => {
  const r = accountability([inst({
    acknowledged_at: '2026-07-22T08:48:00Z',
    arrived_at: '2026-07-22T10:30:00Z', status: 'arrived' })]);
  assert.equal(r.earned, 10);
});

test('excused leaves the denominator entirely', () => {
  const r = accountability([inst({ status: 'excused' }), inst({
    acknowledged_at: '2026-07-22T08:48:00Z', arrived_at: '2026-07-22T09:43:00Z',
    completed_at: '2026-07-22T11:05:00Z', status: 'completed' })]);
  assert.equal(r.possible, 100);
  assert.equal(r.pct, 100);
});

test('unverified removes only the signals it could not verify', () => {
  const r = accountability([inst({
    acknowledged_at: '2026-07-22T08:48:00Z', status: 'unverified' })]);
  assert.equal(r.possible, 10);
  assert.equal(r.earned, 10);
  assert.equal(r.pct, 100);
});

test('an empty range reports null rather than a fake zero', () => {
  assert.equal(accountability([]).pct, null);
});

test('morning readiness reports the three lines the coach reads', () => {
  const rows = [
    inst({ acknowledged_at: '2026-07-22T08:48:00Z', arrived_at: '2026-07-22T09:43:00Z',
           completed_at: '2026-07-22T11:05:00Z', status: 'completed' }),
    inst({ acknowledged_at: null, arrived_at: '2026-07-22T09:43:00Z',
           completed_at: '2026-07-22T11:05:00Z', status: 'completed' }),
  ];
  const m = morningReadiness(rows);
  assert.deepEqual(m.wake, { done: 1, total: 2 });
  assert.deepEqual(m.arrival, { done: 2, total: 2 });
  assert.deepEqual(m.completion, { done: 2, total: 2 });
});

test('the streak counts clean days, skips empty days, and breaks on a real miss', () => {
  const clean = (d) => inst({ occurs_on: d, asks_arrival: false, type: 'morning_roll_call',
                              acknowledged_at: d + 'T08:48:00Z', status: 'acknowledged' });
  const miss  = (d) => inst({ occurs_on: d, asks_arrival: false, type: 'morning_roll_call',
                              acknowledged_at: null, status: 'missed' });
  // 2026-07-19 is a Sunday with no commitments — it must not break the streak.
  assert.equal(commitmentStreak(
    [clean('2026-07-22'), clean('2026-07-21'), clean('2026-07-20'), clean('2026-07-18')],
    '2026-07-22'), 4);
  assert.equal(commitmentStreak([clean('2026-07-22'), miss('2026-07-21')], '2026-07-22'), 1);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test proto/redesign-2026-07/js/commitments.test.mjs`
Expected: FAIL — `accountability is not a function`.

- [ ] **Step 3: Implement**

```js
export const WEIGHTS = { ack: 10, arrival: 30, completion: 60 };

/** Which signals this commitment actually asks for. A roll call is a wake-up: it asks for a
 *  response, and for arrival only when the coach attached a location. It never asks for
 *  "completion" — pressing the button IS the whole commitment. */
export function signalsAsked(row) {
  return {
    ack: row.respond_by_min != null || row.type === 'morning_roll_call',
    arrival: !!row.asks_arrival,
    completion: row.type !== 'morning_roll_call',
  };
}

const onTime = (row) => row.arrived_at != null &&
  (!row.arrive_by_at || new Date(row.arrived_at) <= new Date(row.arrive_by_at));

export function accountability(rows) {
  let earned = 0, possible = 0;
  for (const r of rows || []) {
    if (r.status === 'excused') continue;              // out of the denominator entirely
    const asks = signalsAsked(r);
    const verified = r.status !== 'unverified';        // unverified drops only what it touched
    if (asks.ack) { possible += WEIGHTS.ack; if (r.acknowledged_at) earned += WEIGHTS.ack; }
    if (asks.arrival && verified) { possible += WEIGHTS.arrival; if (onTime(r)) earned += WEIGHTS.arrival; }
    if (asks.completion && verified) { possible += WEIGHTS.completion; if (r.completed_at) earned += WEIGHTS.completion; }
  }
  return { earned, possible, pct: possible ? Math.round((earned / possible) * 100) : null };
}
```

`morningReadiness` counts the same three signals as `{done, total}` pairs. `commitmentStreak`
walks back day by day from `todayISO`: a day with no rows is skipped, a day whose every
non-excused row met every asked signal increments, anything else stops the walk.

- [ ] **Step 4: Run to verify pass**

Run: `node --test proto/redesign-2026-07/js/commitments.test.mjs`
Expected: PASS, 20 tests.

- [ ] **Step 5: Commit**

```bash
git add proto/redesign-2026-07/js/commitments.js proto/redesign-2026-07/js/commitments.test.mjs
git commit -m "feat(proto): accountability scoring — 10/30/60, no cascade, excused and unverified excluded"
```

---

### Task 6: Data layer

**Files:**
- Create: `proto/redesign-2026-07/js/commitment-data.js`

**Interfaces:**
- Produces: `VC` (runtime cache `{ mine: [], board: [], locations: [], loadedAt: null }`), `loadMine(force)`, `loadBoard(dateISO, force)`, `loadLocations(force)`, `saveCommitment(payload)`, `ackCommitment(instanceId)`, `setResponse(responseId, status, reason)`, `remindMissing(instanceId)`, `loadAccountability(athleteId, fromISO, toISO)`.

- [ ] **Step 1: Read the pattern to copy**

Run: `sed -n '1,60p' proto/redesign-2026-07/js/coach-data.js`
Expected: see how it wraps `sb.rpc(...)`, caches, and degrades to `[]` rather than throwing.

- [ ] **Step 2: Implement, mirroring that pattern exactly**

Every loader calls `ensure_commitment_instances` for its window first, then the read RPC. Failures return empty and set a `VC.error` flag — a screen never throws on a cold network.

- [ ] **Step 3: Verify it loads without a session**

Run: `npm run test:proto`
Expected: PASS — the module must not execute Supabase calls at import time.

- [ ] **Step 4: Commit**

```bash
git add proto/redesign-2026-07/js/commitment-data.js
git commit -m "feat(proto): verified commitments data layer"
```

---

### Task 7: Athlete surfaces

**Files:**
- Create: `proto/redesign-2026-07/js/screens/roll-call.js`
- Modify: `proto/redesign-2026-07/js/screens/home.js`
- Modify: `proto/redesign-2026-07/js/router.js`

- [ ] **Step 1: Add the routes**

`roll-call`, `accountability`, `coach-commitments`, `coach-commit-edit`. Follow the existing registration block in `router.js` and the `nav:` convention (`home` for athlete screens, `operator` for coach screens).

- [ ] **Step 2: Render the card on Home**

Insert into the existing card stack (read `home.js:454` — the four-zone layout) so the commitment card sits with the other requirement cards and inherits their visual language. Card contents come entirely from `deriveCommitment`:

- header = `d.title` (coach-authored)
- body = `d.message` when present, escaped with `esc()`
- context = `d.contextLine` (*"Practice at 6:00 AM"*)
- deadline = `d.deadlineLine` (*"Respond by 5:15 AM"*)
- primary button = `d.actionLabel`, shown only when `d.canAck`
- when `d.collapsed`, render only `d.confirmLine` (*"Checked in at 4:48 AM"*)
- a three-dot stage strip: Acknowledged → Arrived → Completed

Tapping the card body opens `roll-call`; tapping the button calls `ackCommitment` and re-renders optimistically.

- [ ] **Step 3: Build the detail screen**

`roll-call.js` shows the full stage history with exact times, the honesty line (*"Location verifies your phone arrived — not that the work got done"*) when the commitment asks for arrival, and the **Something wrong?** dispute action.

- [ ] **Step 4: Verify**

Run: `npm run lint:xss && npm run test:proto`
Expected: PASS — every interpolated coach string escaped.

- [ ] **Step 5: Commit**

```bash
git add proto/redesign-2026-07/js/screens/roll-call.js proto/redesign-2026-07/js/screens/home.js proto/redesign-2026-07/js/router.js
git commit -m "feat(proto): athlete roll call card + detail screen"
```

---

### Task 8: Coach surfaces

**Files:**
- Create: `proto/redesign-2026-07/js/screens/coach-commitments.js`
- Create: `proto/redesign-2026-07/js/screens/coach-commit-edit.js`
- Modify: `proto/redesign-2026-07/js/screens/coach-home.js`
- Modify: `proto/redesign-2026-07/js/screens/coach-create.js`

- [ ] **Step 1: The live board card on coach Home**

```
Morning Roll Call · Linebackers · Practice at 6:00 AM
9 of 11 Up          2 awaiting response
```
Counts come from `boardCounts`. Renders only when today has at least one instance.

- [ ] **Step 2: The roster breakdown screen**

Missing athletes first (from `missingFrom`), then responded with exact times. Actions: **Remind Missing Athletes** (`remindMissing`), per-athlete **Excuse** and **Mark manually** (`setResponse`). Every correction shows who made it.

- [ ] **Step 3: The composer**

Fields in order: type, title (prefilled with `TYPE_LABEL[type]`, editable), message (free text, 200 chars, with tappable *starters* that load into the field — never auto-persisted), action label, audience (team / position group from `team_rooms` / group from `coach_groups` / individual), repeat days, start time, respond-by, linked commitment, location, arrival window, minimum time, reminder offsets.

Gate entry on `allowedCreateKeys(role).includes('schedule')` from `staff-access.js`.

- [ ] **Step 4: Verify**

Run: `npm run lint:xss && npm run test:proto && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add proto/redesign-2026-07/js/screens/coach-commitments.js proto/redesign-2026-07/js/screens/coach-commit-edit.js proto/redesign-2026-07/js/screens/coach-home.js proto/redesign-2026-07/js/screens/coach-create.js
git commit -m "feat(proto): coach commitment board, roster breakdown, composer"
```

---

### Task 9: Notifications + Accountability screen

**Files:**
- Modify: `proto/redesign-2026-07/js/notify-plan.js`
- Create: `proto/redesign-2026-07/js/screens/accountability.js`
- Modify: `proto/redesign-2026-07/js/screens/progress.js`
- Modify: `proto/redesign-2026-07/js/screens/settings.js`
- Test: `proto/redesign-2026-07/js/commitments.test.mjs`

- [ ] **Step 1: Write the failing notification test**

```js
test('a coach-scheduled commitment reminder survives quiet hours and ignores the daily cap', () => {
  const entries = commitmentReminders(
    [{ instance_id: 'i1', title: 'Morning Roll Call', respond_by_min: 315,
       reminder_offsets_min: [15, 5], status: 'pending' }],
    { quietFrom: 22 * 60, quietTo: 7 * 60, allowDeadline: true, enabled: true });
  assert.equal(entries.length, 2);
  assert.ok(entries.every(e => e.stage === 'commitment' && e.exemptFromCap === true));
  assert.deepEqual(entries.map(e => e.at).sort((a, b) => a - b), [300, 310]);
});

test('an already-acknowledged commitment schedules nothing', () => {
  assert.equal(commitmentReminders(
    [{ instance_id: 'i1', respond_by_min: 315, reminder_offsets_min: [15],
       status: 'acknowledged' }], { enabled: true }).length, 0);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test proto/redesign-2026-07/js/commitments.test.mjs`
Expected: FAIL — `commitmentReminders is not a function`.

- [ ] **Step 3: Implement `commitmentReminders` in `commitments.js` and wire it into `notify-plan.js`**

A new `commitment` stage that bypasses `inQuiet()` and the per-pressure daily cap — a 4:45 AM roll call is a scheduled event the coach set, not a nudge. Reminders are emitted only for rows still `pending`.

- [ ] **Step 4: Build the Accountability screen**

```
Morning Readiness · 92%
Wake responses     18/20
On-time arrivals   19/20
Completed sessions 20/20
```
Plus the streak, a 7/30-day toggle, and a plain line stating this is separate from the daily score. Link it from Progress. Add the `share_verified_discipline` toggle to Settings with copy naming exactly what a recruiter can and cannot see.

- [ ] **Step 5: Run the full verification**

Run: `npm run verify`
Expected: PASS — jest ≥ 2398, proto tests green, bundle succeeds.

- [ ] **Step 6: Commit**

```bash
git add proto/redesign-2026-07/js/commitments.js proto/redesign-2026-07/js/notify-plan.js proto/redesign-2026-07/js/commitments.test.mjs proto/redesign-2026-07/js/screens/accountability.js proto/redesign-2026-07/js/screens/progress.js proto/redesign-2026-07/js/screens/settings.js
git commit -m "feat(proto): commitment reminders + Morning Readiness rollup"
```

---

# SLICE 2 — Location-verified arrival (needs a native build)

### Task 10: Arrival RPCs + consent enforcement

**Files:**
- Create: `supabase/migrations/0139_commitment_verification.sql`
- Modify: `supabase/tests/verified_commitments_test.sql`

**Interfaces:**
- Produces: `verify_arrival(uuid, text, boolean) returns jsonb`, `complete_commitment(uuid, text) returns timestamptz`, `dispute_response(uuid, text) returns void`, `grant_verification_consent(uuid, text, uuid, text) returns uuid`, `revoke_verification_consent(uuid) returns void`, `has_verification_consent(uuid) returns boolean`.

- [ ] **Step 1: Consent predicate and grant/revoke**

`has_verification_consent(athlete)` returns true when the athlete is 18+ **or** an unrevoked
`verification_consent` row exists. Age comes from `athlete_profiles.birth_date`; a null birth
date is treated as a minor (fail closed).

- [ ] **Step 2: `verify_arrival`**

Refuses when consent is missing. Clamps the stamped time into
`[arrive_by_at - 4h, coalesce(ends_at, starts_at + 3h) + 1h]` so a delayed OS delivery cannot
write a nonsense timestamp. `p_within = false` writes `status = 'unverified'` with a reason —
**never** `missed`.

- [ ] **Step 3: `complete_commitment` and `dispute_response`**

Completion requires either an `arrived_at` plus satisfied `min_dwell_min`, or a manual tap.
Dispute sets `disputed_at` and surfaces the row in the coach's board.

- [ ] **Step 4: Add three RLS probes**

Consent missing → `verify_arrival` raises; consent granted → succeeds; revoked → raises again.

- [ ] **Step 5: Run and commit**

Run: `npm run test:rls`
Expected: 275 + 8 passing.

```bash
git add supabase/migrations/0139_commitment_verification.sql supabase/tests/verified_commitments_test.sql
git commit -m "feat(db): arrival verification RPCs + minor consent gate"
```

---

### Task 11: Native dependency and permissions

**Files:**
- Modify: `package.json`, `app.config.ts`

- [ ] **Step 1: Read the current Expo docs for the installed SDK**

Per `AGENTS.md`, read `https://docs.expo.dev/versions/v56.0.0/sdk/location/` **before writing any code** — the location API and background-task registration have changed across SDKs.

- [ ] **Step 2: Install**

Run: `npx expo install expo-location`
Expected: a version matching the Expo 57 line lands in `package.json`.

- [ ] **Step 3: Add permission strings**

iOS `NSLocationWhenInUseUsageDescription` and `NSLocationAlwaysAndWhenInUseUsageDescription`, both naming the actual purpose: *"OnStandard confirms you arrived at scheduled team commitments. It only checks during a scheduled event window and never records where you go."* Android `ACCESS_FINE_LOCATION` + `ACCESS_BACKGROUND_LOCATION`. iOS background mode `location`.

- [ ] **Step 4: Verify the config still builds**

Run: `npm run typecheck && npx expo config --type public > /dev/null`
Expected: no errors; the permission strings appear in the resolved config.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json app.config.ts
git commit -m "chore(native): add expo-location with scoped permission copy"
```

---

### Task 12: Geofence manager + bridge

**Files:**
- Create: `src/lib/location/geofence.ts`, `src/lib/location/index.ts`
- Test: `src/lib/location/geofence.test.ts`
- Modify: `src/proto/bridge.ts`

**Interfaces:**
- Produces: `selectArmable(instances, nowMs, cap?): Instance[]`, `armGeofences(instances)`, `disarmAll()`, `oneShotFix(target)`, bridge messages `LOCATION_AVAILABLE`, `LOCATION_PERMISSION`, `LOCATION_ARM`, `LOCATION_EVENT`, `LOCATION_FIX`.

- [ ] **Step 1: Write the failing test for arming selection**

```ts
import { selectArmable, GEOFENCE_CAP } from './geofence';

const at = (iso: string) => ({ id: iso, startsAt: iso, endsAt: null, lat: 28.6, lng: -81.2, radiusM: 120 });

test('the cap leaves headroom under the iOS 20-region limit', () => {
  expect(GEOFENCE_CAP).toBe(16);
});

test('only instances inside the arming window are armed, nearest first', () => {
  const now = Date.parse('2026-07-22T09:00:00Z');
  const picked = selectArmable([
    at('2026-07-22T09:30:00Z'),   // in window
    at('2026-07-22T20:00:00Z'),   // too far out
    at('2026-07-22T04:00:00Z'),   // already over
  ], now);
  expect(picked.map(p => p.id)).toEqual(['2026-07-22T09:30:00Z']);
});

test('more than the cap arms the nearest 16 and reports the remainder', () => {
  const now = Date.parse('2026-07-22T09:00:00Z');
  const many = Array.from({ length: 20 }, (_, i) =>
    at(new Date(now + (i + 1) * 60_000).toISOString()));
  expect(selectArmable(many, now)).toHaveLength(GEOFENCE_CAP);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx jest src/lib/location/geofence.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`selectArmable` is pure and takes `nowMs`. Arming window is `startsAt - 2h` to
`coalesce(endsAt, startsAt + 3h) + 30m`, per spec §7. `armGeofences` calls the Expo API and is
never unit-tested against the OS — the pure selector carries the logic worth testing.

- [ ] **Step 4: Add the bridge messages**

Mirror the `HEALTH_*` pattern in `bridge.ts` exactly: a capability probe the WebView can ask
for, a permission request that resolves to a state, an arm command carrying instances, and an
inbound event the WebView receives on a crossing.

- [ ] **Step 5: Run and commit**

Run: `npm run typecheck && npx jest src/lib/location`
Expected: PASS.

```bash
git add src/lib/location src/proto/bridge.ts
git commit -m "feat(native): temporary geofence manager + location bridge"
```

---

### Task 13: Athlete arrival experience

**Files:**
- Modify: `proto/redesign-2026-07/js/screens/roll-call.js`, `js/screens/home.js`, `js/commitment-data.js`
- Create: `proto/redesign-2026-07/js/screens/location-consent.js`

- [ ] **Step 1: The permission explainer**

A screen shown **before** any OS dialog, stating in plain language: what is checked, when
(only during a scheduled window), what is stored (a verdict and a time, never a location), who
sees it (their coach), and how to turn it off. For a minor, this screen routes to the guardian
request instead of the OS prompt.

- [ ] **Step 2: Arrival and completion in the card**

The card becomes the arrival card at `arrive_by_at - 30m`. With background permission granted it
self-resolves; otherwise an **I'm here** button calls `oneShotFix` then `verify_arrival`.

- [ ] **Step 3: Honest states**

Every failure renders *"Couldn't verify"* plus the reason and an **I was there** button calling
`dispute_response`. The word "missed" never appears on a verification failure.

- [ ] **Step 4: Verify**

Run: `npm run verify`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add proto/redesign-2026-07/js/screens/location-consent.js proto/redesign-2026-07/js/screens/roll-call.js proto/redesign-2026-07/js/screens/home.js proto/redesign-2026-07/js/commitment-data.js
git commit -m "feat(proto): arrival verification, consent explainer, dispute path"
```

---

# SLICE 3 — Widgets and the recruit profile

### Task 14: Verified Discipline profile surface

**Files:**
- Create: `proto/redesign-2026-07/js/screens/verified-discipline.js`
- Modify: `proto/redesign-2026-07/js/screens/settings.js`, `js/router.js`

- [ ] **Step 1: Build the athlete-facing preview**

Shows exactly what a recruiter would see, with a line stating what is withheld. The share
toggle sits on this screen too, so the athlete never enables sharing without seeing the payload.

- [ ] **Step 2: Verify the RPC refuses an unshared profile**

Add an RLS probe: as a second user, `verified_discipline(<athlete>, ...)` raises while
`share_verified_discipline` is false, and returns only percentage keys when true.

- [ ] **Step 3: Run and commit**

Run: `npm run test:rls && npm run verify`

```bash
git add proto/redesign-2026-07/js/screens/verified-discipline.js proto/redesign-2026-07/js/screens/settings.js proto/redesign-2026-07/js/router.js supabase/tests/verified_commitments_test.sql
git commit -m "feat: athlete-controlled Verified Discipline profile"
```

---

### Task 15: iOS interactive widget

**Files:**
- Create: `plugins/withVerifiedCommitmentsWidget.js`, `ios-widget/`
- Modify: `app.config.ts`

- [ ] **Step 1: Read the current Expo config-plugin and App Group docs**

Per `AGENTS.md`, read the Expo 56/57 docs on config plugins and app extensions before writing
Swift. The widget reads a shared App Group container the RN side writes on each board refresh.

- [ ] **Step 2: Write the shared-state writer**

The app writes `{ up, total, awaiting, instanceId, actionLabel }` into the App Group on every
commitment refresh, so the widget renders without a network call.

- [ ] **Step 3: Author the WidgetKit target**

Coach widget: `9/11 UP` + `2 awaiting response`. Athlete widget: the coach's `action_label` as
an `AppIntent` button that calls `ack_commitment`. Tapping either deep-links into the app.

- [ ] **Step 4: Verify what can be verified on this machine**

Run: `npm run typecheck && npx expo prebuild --platform ios --no-install` if a macOS machine is
available.
Expected on Windows: `prebuild` produces the target scaffolding but **cannot compile Swift**.
Record this in the commit body — compilation and device testing require macOS/Xcode.

- [ ] **Step 5: Commit**

```bash
git add plugins/withVerifiedCommitmentsWidget.js ios-widget app.config.ts
git commit -m "feat(ios): Verified Commitments Home/Lock Screen widget target"
```

---

### Task 16: Close out

- [ ] **Step 1: Full verification**

Run: `npm run verify && npm run test:rls`
Expected: jest ≥ 2398, proto tests green, RLS ≥ 283, bundle succeeds.

- [ ] **Step 2: Write the go-live note**

`docs/go-live/VERIFIED-COMMITMENTS.md`: which slice ships OTA vs. needs a build, the migrations
to apply (`0138`, `0139`), the App Store review note justifying background location, and the
founder switches (institutional consent, per-team enablement).

- [ ] **Step 3: Commit**

```bash
git add docs/go-live/VERIFIED-COMMITMENTS.md
git commit -m "docs(go-live): Verified Commitments rollout notes"
```

---

## Self-Review

**Spec coverage:** §3 tables → Task 1; §3.6 RPCs → Tasks 2, 10; §4 client files → Tasks 4–9; §5 athlete → Tasks 7, 13; §6 coach → Task 8; §7 location → Tasks 10–13; §8 scoring → Task 5; §9 recruit profile → Tasks 2 (`verified_discipline`), 14; §10 privacy table → Tasks 1 (RLS), 10 (consent), 13 (explainer, dispute); §11 slices → task grouping; §12 verification → Tasks 3, 16.

**Type consistency:** `deriveCommitment`, `boardCounts`, `missingFrom`, `signalsAsked`,
`accountability`, `morningReadiness`, `commitmentStreak`, `commitmentReminders`, `selectArmable`
are used under these exact names everywhere they appear. Response rows carry the same keys in
`my_commitments`, `commitment_board.rows`, and every engine test fixture.

**Known gap, deliberate:** Task 15 cannot be compiled or device-tested on Windows. The plugin
and target are authored; building them requires macOS/Xcode, and that is recorded in the task
and in the go-live note rather than silently skipped.
