# Solo Accountability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a fitness client with no trainer schedule and be held to their own Verified
Commitments, so the roll call, geofence, escalation, and Morning Readiness screen work with nobody
watching — without letting them edit the record afterwards.

**Architecture:** `commitments` and `commitment_locations` use the 0136 dual-owner pattern
(nullable `team_id` + `practice_id`, `num_nonnulls(…) = 1`), and every RLS policy funnels through
one predicate. We add a third owner column `self_user_id`, widen the predicate, and fix the two
RPCs that assume an owner is an organisation. Two integrity guards (no delete, no self-excuse)
keep the Accountability number honest when the owner and the subject are the same person.

**Tech Stack:** Postgres 15 / Supabase (SQL migrations, security-definer RPCs, RLS), vanilla ES
modules in `proto/redesign-2026-07/` (the shipped WebView UI), `node --test` for pure modules,
`bash supabase/tests/run.sh` for the RLS suite.

**Spec:** `docs/superpowers/specs/2026-07-30-solo-accountability-design.md`

## Global Constraints

- **Migration guardrail.** Migrations in this repo are *authored and statically reviewed, NOT
  applied to live.* Every new migration ends with the standard comment. The founder applies via
  `supabase db push` then `npm run test:rls`. Never run `db push` yourself.
- **The proto is the shipped UI.** All client work happens in `proto/redesign-2026-07/`. Do not
  edit `src/screens/` — it is not what ships.
- **Never `git add -A`.** Another agent commits on this tree concurrently and will sweep your
  staged work. Stage explicit paths only. Re-check the branch (`git rev-parse --abbrev-ref HEAD`)
  before every commit; expected branch is `feat/premium-polish`.
- **Nothing here writes to `days` or touches the daily 0–100 score.** Verified Commitments produces
  its own Accountability number. If you find yourself importing `day.js` into `commitments.js`,
  stop — that import is banned by the module's header.
- **No athlete coordinate is ever persisted.** Geofence comparison happens on-device and reports a
  boolean. Do not add a lat/lng column to `commitment_responses`.
- **Grants are not implied by policies.** Migration 0013 revoked default grants. A perfect RLS
  policy still returns "permission denied for table" without an explicit
  `grant … to authenticated`. Every new write path must be exercised with a *real write* in the
  test suite, not just a policy check.
- **No product copy in commitment columns.** `title` / `message` / `action_label` hold the author's
  own words; the client supplies a render-time default when the column is null.
- **Exact new predicate name:** `commitment_owner_can_manage(p_team uuid, p_practice uuid, p_self uuid)`.
  The old `commitment_owner_is_staff(uuid, uuid)` must not survive anywhere in the repo.

---

## File Structure

| File | Responsibility |
|---|---|
| `supabase/migrations/0165_solo_commitments.sql` | **Create.** All schema, predicate, and RPC changes. Built up across Tasks 1–4; applied atomically by the founder afterwards. |
| `supabase/tests/solo_commitments_test.sql` | **Create.** RLS + integrity suite for the self-owner path. |
| `supabase/tests/run.sh` | **Modify.** Register the new test file. |
| `proto/redesign-2026-07/js/commitment-data.js` | **Modify.** Self-owner read/write path alongside the team/practice branches. |
| `proto/redesign-2026-07/js/screens/solo-commitments.js` | **Create.** The solo list + composer. Deliberately a separate file from `coach-commitments.js`, which is already 400+ lines and carries board/roster concerns a solo user has none of. |
| `proto/redesign-2026-07/js/screens/accountability.js` | **Modify.** Third copy branch + create button. |
| `proto/redesign-2026-07/js/ob2.js` | **Modify.** Remove the unbacked "supporter" paywall claim. |

---

## Task 1: Schema + the widened owner predicate

**Files:**
- Create: `supabase/migrations/0165_solo_commitments.sql`
- Test: `supabase/tests/solo_commitments_test.sql` (create), `supabase/tests/run.sh` (modify)

**Interfaces:**
- Consumes: `is_team_staff(uuid)`, `is_practice_staff(uuid)` (0055 / 0136).
- Produces: `commitment_owner_can_manage(p_team uuid, p_practice uuid, p_self uuid) returns boolean`;
  `commitments.self_user_id`, `commitment_locations.self_user_id` (both `uuid`, nullable).

**⚠ ORDER MATTERS — the old function is NOT dropped in this task.** Seven objects reference
`commitment_owner_is_staff`: policies `cl_read`, `cm_read`, `cl_staff_insert`, and functions
`instance_owner_is_staff`, `commitment_board`, `remind_missing`, `staff_set_response`,
`staff_excuse_athlete`, `ensure_commitment_instances`. Two different failure modes apply:

- **`language sql` functions and policies** (`commitment_board`, `instance_owner_is_staff`, the
  three policies) create a *hard* catalog dependency. `drop function` fails outright with
  `cannot drop function … because other objects depend on it`.
- **`language plpgsql` functions** (`remind_missing`, `staff_set_response`,
  `staff_excuse_athlete`, `ensure_commitment_instances`) resolve names at *execution* time. The
  drop succeeds and the function breaks silently at the next call — much worse.

So the drop lands at the very end of the migration, in Task 4, after every dependent has been
recreated. Do not add it here.

- [ ] **Step 1: Write the failing test**

Create `supabase/tests/solo_commitments_test.sql`. Follow the idiom in
`supabase/tests/rls_authz_test.sql` (transaction-wrapped, `set local role`, `raise exception` on a
failed assertion, rolled back at the end).

```sql
-- OnStandard — Solo Accountability (0165). Verifies the self-owner path end to end.
-- Run via: npm run test:rls
begin;

-- Fixtures: one solo user with no team and no practice.
insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'solo@test.local')
  on conflict (id) do nothing;
insert into profiles (id, full_name) values
  ('11111111-1111-1111-1111-111111111111', 'Solo Tester')
  on conflict (id) do nothing;

-- ---------------------------------------------------------------- schema
do $$
begin
  if not exists (select 1 from information_schema.columns
                  where table_name = 'commitments' and column_name = 'self_user_id') then
    raise exception 'FAIL: commitments.self_user_id missing';
  end if;
  if not exists (select 1 from information_schema.columns
                  where table_name = 'commitment_locations' and column_name = 'self_user_id') then
    raise exception 'FAIL: commitment_locations.self_user_id missing';
  end if;
  if not exists (select 1 from pg_proc where proname = 'commitment_owner_can_manage') then
    raise exception 'FAIL: commitment_owner_can_manage missing';
  end if;
end $$;

-- ---------------------------------------------------------------- one-owner constraint
-- Two owners must be rejected.
do $$
begin
  begin
    insert into commitments (team_id, self_user_id, type, title, audience_kind, starts_min)
    values (gen_random_uuid(), '11111111-1111-1111-1111-111111111111',
            'morning_roll_call', 'Bad', 'athlete', 300);
    raise exception 'FAIL: two owners were accepted';
  exception when check_violation then null;  -- expected
  end;
end $$;

-- Zero owners must be rejected.
do $$
begin
  begin
    insert into commitments (type, title, audience_kind, starts_min)
    values ('morning_roll_call', 'Bad', 'athlete', 300);
    raise exception 'FAIL: zero owners were accepted';
  exception when check_violation then null;  -- expected
  end;
end $$;

-- Exactly one (self) must be accepted.
insert into commitments (self_user_id, type, title, audience_kind, audience_value,
                         repeat_days, starts_min, respond_by_min)
values ('11111111-1111-1111-1111-111111111111', 'morning_roll_call', 'My Roll Call',
        'athlete', '11111111-1111-1111-1111-111111111111',
        '{0,1,2,3,4,5,6}'::smallint[], 300, 330);

-- ---------------------------------------------------------------- the predicate
do $$
begin
  if commitment_owner_can_manage(null, null, '11111111-1111-1111-1111-111111111111') then
    raise exception 'FAIL: predicate true for a self id that is not auth.uid()';
  end if;
end $$;

rollback;
```

- [ ] **Step 2: Register the test and run it to verify it fails**

Add the new file to `supabase/tests/run.sh` alongside the existing entries (open the file and
follow its existing loop or explicit list — match whatever pattern is there).

Run: `npm run test:rls`
Expected: FAIL — `column "self_user_id" of relation "commitments" does not exist`.

If Docker is not running, start it first: `supabase start`. Per the project's local-RLS notes,
Docker works here and runs the real suite.

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/0165_solo_commitments.sql`:

```sql
-- OnStandard — Solo Accountability: a third owner for Verified Commitments.
-- Spec: docs/superpowers/specs/2026-07-30-solo-accountability-design.md
-- Plan: docs/superpowers/plans/2026-07-30-solo-accountability.md
--
-- WHAT THIS IS
-- A fitness client with no trainer and no team schedules their own commitments. 0138 gave every
-- table the 0136 dual-owner pattern (team_id | practice_id); this adds self_user_id as a third,
-- so the roll call, geofence, escalation ladder and Morning Readiness screen all work for someone
-- nobody else is watching.
--
-- ⚠ THE DAILY SCORE IS NOT TOUCHED. Verified Commitments keeps producing its own Accountability
-- number, exactly as it does for a coached athlete. Nothing here writes to days.
--
-- ⚠ INTEGRITY. When the owner IS the subject, two escape hatches open that a coached athlete does
-- not have. Both are closed here: a self-owner cannot delete a commitment (the cascade would erase
-- the miss record) and cannot excuse their own response. See upsert_commitment and
-- staff_set_response below. 'unverified' still covers genuine device failure, so honest misses are
-- never manufactured.
--
-- GUARDRAIL: authored + statically reviewed; NOT applied to live here. Founder applies via
-- `supabase db push` then `npm run test:rls`.

-- ---------------------------------------------------------------- schema
alter table commitments
  add column if not exists self_user_id uuid references profiles(id) on delete cascade;
alter table commitment_locations
  add column if not exists self_user_id uuid references profiles(id) on delete cascade;

alter table commitments drop constraint if exists commitments_one_owner;
alter table commitments add constraint commitments_one_owner
  check (num_nonnulls(team_id, practice_id, self_user_id) = 1);

alter table commitment_locations drop constraint if exists commitment_locations_one_owner;
alter table commitment_locations add constraint commitment_locations_one_owner
  check (num_nonnulls(team_id, practice_id, self_user_id) = 1);

create index if not exists cm_self on commitments (self_user_id, active)
  where self_user_id is not null;
create index if not exists cl_self on commitment_locations (self_user_id)
  where self_user_id is not null;

-- ---------------------------------------------------------------- the owner predicate
-- Renamed from commitment_owner_is_staff. A function named _is_staff that returns true for someone
-- who is explicitly NOT staff is a lie inside a security-definer predicate; the new name says what
-- it actually answers. Self-ownership is the only branch that does not consult a roster.
create or replace function commitment_owner_can_manage(p_team uuid, p_practice uuid, p_self uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select (p_team is not null and is_team_staff(p_team))
      or (p_practice is not null and is_practice_staff(p_practice))
      or (p_self is not null and p_self = auth.uid());
$$;
revoke all on function commitment_owner_can_manage(uuid, uuid, uuid) from public, anon;
grant execute on function commitment_owner_can_manage(uuid, uuid, uuid) to authenticated;

-- ---------------------------------------------------------------- dependents, then the drop
-- ⚠ Every dependent is recreated BEFORE the old function is dropped. Postgres refuses to drop a
-- function while a policy depends on it.
create or replace function instance_owner_is_staff(p_instance uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from commitment_instances i
                   join commitments c on c.id = i.commitment_id
                  where i.id = p_instance
                    and commitment_owner_can_manage(c.team_id, c.practice_id, c.self_user_id));
$$;

drop policy if exists cl_read on commitment_locations;
create policy cl_read on commitment_locations for select
  using (commitment_owner_can_manage(team_id, practice_id, self_user_id));

drop policy if exists cm_read on commitments;
create policy cm_read on commitments for select
  using (commitment_owner_can_manage(team_id, practice_id, self_user_id) or has_commitment_row(id));

drop policy if exists cl_staff_insert on commitment_locations;
create policy cl_staff_insert on commitment_locations for insert
  with check (commitment_owner_can_manage(team_id, practice_id, self_user_id));

-- NOTE: commitment_owner_is_staff is NOT dropped here. commitment_board, remind_missing,
-- staff_set_response, staff_excuse_athlete and ensure_commitment_instances still reference it.
-- The drop is the LAST statement in this migration; see the end of the file.
```

- [ ] **Step 4: Reset the local database and run the test to verify it passes**

Run: `supabase db reset && npm run test:rls`
Expected: PASS. The reset is required — migrations are applied in order from scratch, and
`db reset` is the only way to pick up a brand-new file.

- [ ] **Step 5: Commit**

```bash
git rev-parse --abbrev-ref HEAD   # expect feat/premium-polish
git add supabase/migrations/0165_solo_commitments.sql supabase/tests/solo_commitments_test.sql supabase/tests/run.sh
git commit -m "feat(commitments): a solo user can own a commitment"
```

---

## Task 2: `upsert_commitment` accepts a self owner and refuses to delete

**Files:**
- Modify: `supabase/migrations/0165_solo_commitments.sql` (append)
- Test: `supabase/tests/solo_commitments_test.sql` (append)

**Interfaces:**
- Consumes: `commitment_owner_can_manage(uuid, uuid, uuid)` from Task 1.
- Produces: `upsert_commitment(p jsonb) returns uuid` — now accepts `p->>'self_user_id'`. When
  set, the server forces `audience_kind = 'athlete'` and `audience_value = auth.uid()`, and
  rejects `active = false` transitions only via the normal edit path (pausing is allowed; there is
  no delete path at all).

- [ ] **Step 1: Write the failing test**

Append to `supabase/tests/solo_commitments_test.sql`, before the final `rollback;`:

```sql
-- ---------------------------------------------------------------- upsert_commitment (self)
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

-- A solo user creates their own commitment.
do $$
declare v_id uuid;
begin
  v_id := upsert_commitment(jsonb_build_object(
    'self_user_id', '11111111-1111-1111-1111-111111111111',
    'type', 'morning_roll_call', 'title', '5 AM Club',
    'audience_kind', 'team',                      -- deliberately wrong; server must override
    'repeat_days', jsonb_build_array(1,2,3,4,5),
    'starts_min', 300, 'respond_by_min', 330));
  if v_id is null then raise exception 'FAIL: self upsert returned null'; end if;

  if not exists (select 1 from commitments
                  where id = v_id
                    and self_user_id = '11111111-1111-1111-1111-111111111111'
                    and audience_kind = 'athlete'
                    and audience_value = '11111111-1111-1111-1111-111111111111') then
    raise exception 'FAIL: server did not force the self audience';
  end if;
end $$;

-- A solo user may NOT claim a team they do not staff.
do $$
begin
  begin
    perform upsert_commitment(jsonb_build_object(
      'team_id', gen_random_uuid(),
      'type', 'morning_roll_call', 'title', 'Not mine',
      'audience_kind', 'team', 'starts_min', 300));
    raise exception 'FAIL: solo user scheduled into a team book';
  exception when others then
    if sqlerrm like 'FAIL:%' then raise; end if;   -- re-raise our own assertion
  end;
end $$;

-- Pausing is allowed.
do $$
declare v_id uuid;
begin
  select id into v_id from commitments
   where self_user_id = '11111111-1111-1111-1111-111111111111' limit 1;
  perform upsert_commitment(jsonb_build_object(
    'id', v_id, 'self_user_id', '11111111-1111-1111-1111-111111111111',
    'type', 'morning_roll_call', 'title', '5 AM Club',
    'audience_kind', 'athlete', 'starts_min', 300, 'active', false));
  if (select active from commitments where id = v_id) then
    raise exception 'FAIL: pause did not take';
  end if;
end $$;

-- Deleting is not possible: no delete grant and no delete policy exist on commitments.
do $$
begin
  if exists (select 1 from pg_policies
              where tablename = 'commitments' and cmd = 'DELETE') then
    raise exception 'FAIL: a delete policy exists on commitments';
  end if;
  if has_table_privilege('authenticated', 'commitments', 'DELETE') then
    raise exception 'FAIL: authenticated holds DELETE on commitments';
  end if;
end $$;

reset role;
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `supabase db reset && npm run test:rls`
Expected: FAIL — `FAIL: server did not force the self audience` (the current `upsert_commitment`
ignores `self_user_id` entirely and writes `audience_kind = 'team'`).

- [ ] **Step 3: Append the new `upsert_commitment` to the migration**

Append to `supabase/migrations/0165_solo_commitments.sql`:

```sql
-- ---------------------------------------------------------------- upsert_commitment
-- Recreated in full (replaces 0138's body). Adds the self-owner branch; every other line is
-- behaviourally identical to 0138.
--
-- ⚠ A SELF BOOK HAS EXACTLY ONE AUDIENCE. audience_kind/audience_value are FORCED server-side
-- rather than trusted, so a crafted payload cannot aim a self-owned commitment at a roster.
--
-- ⚠ NO DELETE PATH. commitments -> instances -> responses cascades, so deleting a commitment would
-- erase every miss recorded against it. There is no delete grant and no delete policy on this
-- table for anyone; a self-owner ends a commitment with active = false or ends_on, exactly as a
-- coached athlete's coach would.
create or replace function upsert_commitment(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_team uuid; v_practice uuid; v_self uuid; v_role text;
        v_audience_kind text; v_audience_value uuid;
begin
  v_id       := nullif(p->>'id','')::uuid;
  v_team     := nullif(p->>'team_id','')::uuid;
  v_practice := nullif(p->>'practice_id','')::uuid;
  v_self     := nullif(p->>'self_user_id','')::uuid;

  if num_nonnulls(v_team, v_practice, v_self) <> 1 then
    raise exception 'exactly one owner is required';
  end if;

  if not commitment_owner_can_manage(v_team, v_practice, v_self) then
    raise exception 'not authorized for this book';
  end if;

  -- Team books keep the 0138 role gate (mirrors CREATE_CAPS in proto js/staff-access.js).
  -- A self book has no roster and therefore no role to hold.
  if v_team is not null then
    select role::text into v_role from team_staff
     where team_id = v_team and staff_id = auth.uid() and status = 'active';
    if coalesce(v_role, 'head_coach') not in
       ('head_coach','coordinator','assistant','s_and_c','team_admin') then
      raise exception 'role % may not schedule commitments', v_role;
    end if;
  end if;

  -- A self book is always aimed at its owner. Forced, never trusted.
  if v_self is not null then
    v_audience_kind := 'athlete';
    v_audience_value := auth.uid();
  else
    v_audience_kind := p->>'audience_kind';
    v_audience_value := nullif(p->>'audience_value','')::uuid;
  end if;

  -- An EDIT must not walk a commitment into another book. Only applies when the id already
  -- exists: a client is free to mint the uuid for a NEW commitment.
  if v_id is not null
     and exists (select 1 from commitments where id = v_id)
     and not exists (
       select 1 from commitments c where c.id = v_id
         and c.team_id      is not distinct from v_team
         and c.practice_id  is not distinct from v_practice
         and c.self_user_id is not distinct from v_self
     ) then
    raise exception 'commitment does not belong to this book';
  end if;

  insert into commitments (
    id, team_id, practice_id, self_user_id, type, title, message, action_label,
    audience_kind, audience_value, repeat_days, starts_on, ends_on, timezone,
    starts_min, ends_min, respond_by_min, opens_min,
    location_id, arrive_by_min, arrival_grace_min, min_dwell_min,
    linked_commitment_id, reminder_offsets_min, active, escalation, created_by
  ) values (
    coalesce(v_id, gen_random_uuid()), v_team, v_practice, v_self,
    p->>'type', p->>'title', nullif(p->>'message',''), nullif(p->>'action_label',''),
    v_audience_kind, v_audience_value,
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
    coalesce((p->>'active')::boolean, true),
    -- Someone who schedules their own 5 AM roll call has already asked to be woken up, so the
    -- L2 breakthrough push defaults ON for a self book. A coach book keeps 0145's silent default.
    coalesce(p->'escalation', case when v_self is not null
                                   then '{"breakthrough": true}'::jsonb
                                   else '{}'::jsonb end),
    auth.uid()
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
    active = excluded.active, escalation = excluded.escalation, updated_at = now()
  returning id into v_id;

  return v_id;
end $$;
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `supabase db reset && npm run test:rls`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git rev-parse --abbrev-ref HEAD   # expect feat/premium-polish
git add supabase/migrations/0165_solo_commitments.sql supabase/tests/solo_commitments_test.sql
git commit -m "feat(commitments): self-owned upsert forces its own audience, cannot delete"
```

---

## Task 3: Materialization for a user with no team and no practice

**Files:**
- Modify: `supabase/migrations/0165_solo_commitments.sql` (append)
- Test: `supabase/tests/solo_commitments_test.sql` (append)

**Interfaces:**
- Consumes: `upsert_commitment` from Task 2, `commitment_audience(uuid)`, `vc_enabled()` (0141).
- Produces: `ensure_commitment_instances(p_team uuid, p_practice uuid, p_self uuid, p_from date, p_to date) returns integer`
  — **note the new 3rd parameter, which shifts the date arguments.** All callers must be updated.
  `ensure_my_commitment_instances(p_from date, p_to date) returns integer` — unchanged signature,
  new third loop.

**Why this task exists:** `ensure_my_commitment_instances` currently loops `team_members` then
`practice_clients`. A solo user is in neither, so without this the feature would appear to work —
commitments save fine — and then silently produce no card, ever.

- [ ] **Step 1: Write the failing test**

Append to `supabase/tests/solo_commitments_test.sql`, before the final `rollback;`:

```sql
-- ---------------------------------------------------------------- materialization
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

do $$
declare v_id uuid; v_n integer; v_from date := current_date; v_to date := current_date + 6;
begin
  v_id := upsert_commitment(jsonb_build_object(
    'self_user_id', '11111111-1111-1111-1111-111111111111',
    'type', 'morning_roll_call', 'title', 'Wake Up',
    'audience_kind', 'athlete',
    'repeat_days', jsonb_build_array(0,1,2,3,4,5,6),
    'starts_min', 300, 'respond_by_min', 330));

  v_n := ensure_my_commitment_instances(v_from, v_to);
  if v_n = 0 then
    raise exception 'FAIL: no instances materialized for a solo user';
  end if;

  if not exists (
    select 1 from commitment_instances i
      join commitments c on c.id = i.commitment_id
     where c.id = v_id and i.occurs_on between v_from and v_to) then
    raise exception 'FAIL: no instance rows for the solo commitment';
  end if;

  if not exists (
    select 1 from commitment_responses r
      join commitment_instances i on i.id = r.instance_id
     where i.commitment_id = v_id
       and r.athlete_id = '11111111-1111-1111-1111-111111111111') then
    raise exception 'FAIL: no response row seeded for the solo owner';
  end if;
end $$;

reset role;
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `supabase db reset && npm run test:rls`
Expected: FAIL — `FAIL: no instances materialized for a solo user`.

- [ ] **Step 3: Append the materialization changes**

Append to `supabase/migrations/0165_solo_commitments.sql`:

```sql
-- ---------------------------------------------------------------- materialization
-- Recreated in full (replaces 0141's body). Adds the self-owner branch; the flag check, the herd
-- guard, and the instance/response loop are otherwise byte-identical to 0141.
--
-- ⚠ SIGNATURE CHANGE. p_self is inserted BEFORE the dates, so the old 4-arg version must be
-- dropped and every caller updated. The old signature is dropped at the end of this block.
create or replace function ensure_commitment_instances(
  p_team uuid, p_practice uuid, p_self uuid, p_from date, p_to date
) returns integer
language plpgsql security definer set search_path = public as $$
declare c commitments; d date; n integer := 0; v_inst uuid; v_last date;
begin
  if not vc_enabled() then return 0; end if;

  if not commitment_owner_can_manage(p_team, p_practice, p_self)
     and not exists (select 1 from team_members
                      where athlete_id = auth.uid() and team_id = p_team and status = 'active')
     and not exists (select 1 from practice_clients
                      where client_id = auth.uid() and practice_id = p_practice and status = 'active')
  then
    raise exception 'not authorized';
  end if;

  if p_from is null or p_to is null or p_to < p_from then return 0; end if;
  if p_to - p_from > 62 then raise exception 'window too large'; end if;

  -- ⚠ HERD GUARD. TRY, never wait (see 0141). The lock key now includes the self owner so two
  -- different solo users never contend on the same key.
  if not pg_try_advisory_xact_lock(
       hashtext('vc:' || coalesce(p_team, p_practice, p_self)::text)) then
    return 0;
  end if;

  for c in select * from commitments
            where active
              and ((p_team is not null and team_id = p_team)
                or (p_practice is not null and practice_id = p_practice)
                or (p_self is not null and self_user_id = p_self))
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

drop function if exists ensure_commitment_instances(uuid, uuid, date, date);

-- The athlete's own path into materialization. Loops all three link types, because a person can be
-- on a team AND a trainer's client AND still keep commitments of their own.
create or replace function ensure_my_commitment_instances(p_from date, p_to date) returns integer
language plpgsql security definer set search_path = public as $$
declare v_n integer := 0; t uuid; p uuid;
begin
  for t in select team_id from team_members
            where athlete_id = auth.uid() and status = 'active' loop
    v_n := v_n + ensure_commitment_instances(t, null, null, p_from, p_to);
  end loop;
  for p in select practice_id from practice_clients
            where client_id = auth.uid() and status = 'active' loop
    v_n := v_n + ensure_commitment_instances(null, p, null, p_from, p_to);
  end loop;
  -- The self book. Unconditional: cheap when the user owns nothing (the inner loop finds no rows).
  v_n := v_n + ensure_commitment_instances(null, null, auth.uid(), p_from, p_to);
  return v_n;
end $$;
```

- [ ] **Step 4: Update the remaining caller**

`commitment_board` in `0141_commitment_production.sql` does not call
`ensure_commitment_instances`, but `proto/redesign-2026-07/js/commitment-data.js:154` does, with
the old 4-argument shape. Leave the client alone for now — Task 5 updates it. Confirm no other SQL
caller exists:

Run: `grep -rn "ensure_commitment_instances" supabase/`
Expected: matches only in `0138`, `0140`, `0141`, and the new `0165`. If a call site in an edge
function appears, update it to the 5-argument form in this step.

- [ ] **Step 5: Run the test to verify it passes**

Run: `supabase db reset && npm run test:rls`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git rev-parse --abbrev-ref HEAD   # expect feat/premium-polish
git add supabase/migrations/0165_solo_commitments.sql supabase/tests/solo_commitments_test.sql
git commit -m "fix(commitments): materialize instances for a user with no team or practice"
```

---

## Task 4: No self-excuse

**Files:**
- Modify: `supabase/migrations/0165_solo_commitments.sql` (append)
- Test: `supabase/tests/solo_commitments_test.sql` (append)

**Interfaces:**
- Consumes: everything from Tasks 1–3.
- Produces: `staff_set_response(p_response uuid, p_status text, p_reason text) returns void` —
  now refuses when the owning commitment is self-owned.

**Why an explicit guard rather than the predicate:** `commitment_owner_can_manage` returns *true*
for a self-owner, which is correct for scheduling and wrong for correcting. Relying on the
predicate alone would silently hand every solo user an undo button on their own misses. The guard
is written as `c.self_user_id is null` so that it fails closed if the predicate is ever widened
again.

- [ ] **Step 1: Write the failing test**

Append to `supabase/tests/solo_commitments_test.sql`, before the final `rollback;`:

```sql
-- ---------------------------------------------------------------- no self-excuse
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

do $$
declare v_id uuid; v_resp uuid;
begin
  v_id := upsert_commitment(jsonb_build_object(
    'self_user_id', '11111111-1111-1111-1111-111111111111',
    'type', 'strength', 'title', 'Lift',
    'audience_kind', 'athlete',
    'repeat_days', jsonb_build_array(0,1,2,3,4,5,6),
    'starts_min', 360));
  perform ensure_my_commitment_instances(current_date, current_date);

  select r.id into v_resp
    from commitment_responses r
    join commitment_instances i on i.id = r.instance_id
   where i.commitment_id = v_id limit 1;
  if v_resp is null then raise exception 'FAIL: no response row to test against'; end if;

  begin
    perform staff_set_response(v_resp, 'excused', 'felt tired');
    raise exception 'FAIL: a solo user excused their own miss';
  exception when others then
    if sqlerrm like 'FAIL:%' then raise; end if;   -- re-raise our own assertion
  end;

  if (select status from commitment_responses where id = v_resp) = 'excused' then
    raise exception 'FAIL: response was excused despite the raise';
  end if;
end $$;

reset role;
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `supabase db reset && npm run test:rls`
Expected: FAIL — `FAIL: a solo user excused their own miss`.

- [ ] **Step 3: Append the guard**

Append to `supabase/migrations/0165_solo_commitments.sql`:

```sql
-- ---------------------------------------------------------------- staff_set_response
-- Recreated in full (replaces 0138's body). One new guard; the update statement is unchanged.
--
-- ⚠ NO SELF-EXCUSE. commitment_owner_can_manage returns true for a self-owner — correct for
-- scheduling, wrong for correcting. Without this guard every solo user would hold an undo button
-- on their own misses and the Accountability number would mean nothing. Written as
-- `self_user_id is null` so it fails CLOSED if the predicate is ever widened again.
--
-- Genuine failure is already handled without this hatch: 'unverified' covers a dead phone, a
-- revoked permission, weak GPS indoors, or a session moved elsewhere, and unverified rows leave
-- the denominator rather than counting as failures.
create or replace function staff_set_response(p_response uuid, p_status text, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
declare v_ok boolean;
begin
  if p_status not in ('pending','acknowledged','arrived','completed','missed','excused','unverified')
  then raise exception 'bad status %', p_status; end if;

  select commitment_owner_can_manage(c.team_id, c.practice_id, c.self_user_id)
         and c.self_user_id is null
    into v_ok
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

-- ---------------------------------------------------------------- staff_excuse_athlete (0140)
-- The bulk excuse path takes only p_team / p_practice, so a self book can never be its target.
-- Its predicate call is updated for the new signature and pinned to null so the shape is explicit.
create or replace function staff_excuse_athlete(
  p_athlete uuid, p_from date, p_to date, p_reason text,
  p_team uuid default null, p_practice uuid default null
) returns integer
language plpgsql security definer set search_path = public as $$
declare v_n integer := 0;
begin
  if p_from is null or p_to is null or p_to < p_from then
    raise exception 'invalid date range';
  end if;
  if p_to - p_from > 366 then raise exception 'range too large'; end if;
  if not commitment_owner_can_manage(p_team, p_practice, null) then
    raise exception 'not authorized for this team or practice';
  end if;

  insert into athlete_exceptions (team_id, practice_id, athlete_id, starts_on, ends_on, reason)
  values (p_team, p_practice, p_athlete, p_from, p_to,
          nullif(left(coalesce(p_reason, ''), 120), ''));

  update commitment_responses r
     set status = 'excused',
         excused_by = auth.uid(),
         excused_reason = nullif(left(coalesce(p_reason, ''), 120), ''),
         corrected_by = auth.uid(), corrected_at = now(),
         updated_at = now()
    from commitment_instances i
    join commitments c on c.id = i.commitment_id
   where r.instance_id = i.id
     and r.athlete_id = p_athlete
     and i.occurs_on between p_from and p_to
     and ((p_team is not null and c.team_id = p_team)
       or (p_practice is not null and c.practice_id = p_practice));
  get diagnostics v_n = row_count;
  return coalesce(v_n, 0);
end $$;
```

- [ ] **Step 4: Recreate the last two dependents, then drop the old predicate**

These are the remaining references. `commitment_board` is `language sql`, so it holds a hard
catalog dependency and the drop *fails* without this. `remind_missing` is `plpgsql`, so the drop
would succeed and then break it silently at the next call — the worse of the two.

Append to `supabase/migrations/0165_solo_commitments.sql`:

```sql
-- ---------------------------------------------------------------- commitment_board
-- Recreated from 0141 solely to move off the 2-arg predicate. Behaviour is unchanged: the board is
-- a staff surface, and a self-owned commitment has no board to appear on (p_team and p_practice are
-- both null for a solo user, so the where-clause matches nothing).
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
      'timezone', c.timezone,
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
      and commitment_owner_can_manage(c.team_id, c.practice_id, c.self_user_id)
      and vc_enabled()
  ) s;
$$;
```

Now open `supabase/migrations/0138_verified_commitments.sql` at line ~607 and read
`remind_missing` in full. Copy its body into 0165 verbatim, changing only its authorization line
from `commitment_owner_is_staff(c.team_id, c.practice_id)` to
`commitment_owner_can_manage(c.team_id, c.practice_id, c.self_user_id)`. Do not paraphrase the
rest of the body — copy it.

Then append the drop as the final statement of the migration:

```sql
-- ---------------------------------------------------------------- retire the old predicate
-- Last statement in the file: every dependent above has been recreated against the 3-arg version.
drop function if exists commitment_owner_is_staff(uuid, uuid);
```

Finally, assert it is gone. Append to `supabase/tests/solo_commitments_test.sql` before the
`rollback;`:

```sql
do $$
begin
  if exists (select 1 from pg_proc where proname = 'commitment_owner_is_staff') then
    raise exception 'FAIL: old commitment_owner_is_staff still exists';
  end if;
end $$;
```

Then sweep the source: `grep -rn "commitment_owner_is_staff" supabase/`
Expected: matches only inside the historical migrations `0138`, `0140`, `0141`, `0153` (leave
them — they define the old world and are superseded at apply time) and the single `drop function`
line in `0165`.

- [ ] **Step 5: Run the full suite to verify it passes**

Run: `supabase db reset && npm run test:rls && npm test`
Expected: PASS on both. `npm test` (jest) confirms nothing in `src/core` regressed.

- [ ] **Step 6: Commit**

```bash
git rev-parse --abbrev-ref HEAD   # expect feat/premium-polish
git add supabase/migrations/0165_solo_commitments.sql supabase/tests/solo_commitments_test.sql
git commit -m "feat(commitments): a solo owner cannot excuse their own miss"
```

---

## Task 5: Client data layer

**Files:**
- Modify: `proto/redesign-2026-07/js/commitment-data.js`

**Interfaces:**
- Consumes: RPCs `upsert_commitment` (now accepts `self_user_id`), `ensure_commitment_instances`
  (now 5-arg).
- Produces: `loadMyCommitments(force)` → `Promise<Array>` of the caller's own self-owned
  commitment rows; `saveSelfCommitment(payload)` → `Promise<string|null>` returning the new id;
  `setSelfCommitmentActive(commitment, active)` → `Promise<string|null>`.

- [ ] **Step 1: Read the existing module and locate the three touch points**

Run: `grep -n "saveCommitment\|loadCommitments\|ensure_commitment_instances" proto/redesign-2026-07/js/commitment-data.js`

You are looking at roughly lines 154, 169–181, and 204–212. Read the surrounding 20 lines of each
before editing — this module's contract is *every call is best-effort and degrades to an empty
result rather than throwing*, and your additions must match it.

- [ ] **Step 2: Add the self-owner cache slot**

In the `RTC` object near the top, add alongside the existing entries:

```js
  selfCommitments: [], selfCommitmentsAt: 0,
```

- [ ] **Step 3: Add the three self-owner functions**

Append near the other write helpers (after `saveCommitment`):

```js
/* ---------------------------------------------------------------- self-owned (solo) */

/** Every standing commitment this user owns themselves. Separate from loadCommitments(), which
 *  takes a team or practice id — a solo user has neither. Includes paused ones: the manage screen
 *  has to be able to find and resume them. */
export async function loadMyCommitments(force = false) {
  const c = sb(); if (!c) return RTC.selfCommitments;
  if (!force && RTC.selfCommitments.length && Date.now() - RTC.selfCommitmentsAt < FRESH_MS) {
    return RTC.selfCommitments;
  }
  try {
    const uid = (c.auth && c.auth.user && c.auth.user()) ? c.auth.user().id : null;
    const { data: sess } = uid ? { data: null } : await c.auth.getUser();
    const me = uid || (sess && sess.user && sess.user.id);
    if (!me) return RTC.selfCommitments;
    const { data, error } = await c.from('commitments')
      .select('*').eq('self_user_id', me)
      .order('active', { ascending: false }).order('starts_min');
    if (error) return RTC.selfCommitments;
    RTC.selfCommitments = data || [];
    RTC.selfCommitmentsAt = Date.now();
    return RTC.selfCommitments;
  } catch { return RTC.selfCommitments; }
}

/** Create or edit a commitment this user owns. The server forces the audience to the caller, so
 *  the payload never carries audience_kind / audience_value. */
export async function saveSelfCommitment(payload) {
  const c = sb(); if (!c) return null;
  try {
    const { data: sess } = await c.auth.getUser();
    const me = sess && sess.user && sess.user.id;
    if (!me) return null;
    const { data, error } = await c.rpc('upsert_commitment', {
      p: { ...payload, self_user_id: me, team_id: null, practice_id: null },
    });
    if (error) return null;
    RTC.selfCommitmentsAt = 0;   // force the next read
    return data || null;
  } catch { return null; }
}

/** Pause or resume. There is deliberately no delete: the cascade would erase the miss record. */
export async function setSelfCommitmentActive(commitment, active) {
  return saveSelfCommitment({ ...commitment, active: !!active });
}
```

- [ ] **Step 4: Fix the `ensure_commitment_instances` call for the new signature**

At line ~154 the coach board calls the 4-argument form. Change it to pass `null` for the new
`p_self` parameter:

```js
      await c.rpc('ensure_commitment_instances', {
        p_team: team, p_practice: practice, p_self: null, p_from: day, p_to: day });
```

Leave the `ensure_my_commitment_instances` call at line ~66 alone — its signature did not change.

- [ ] **Step 5: Verify nothing else calls the old shape**

Run: `grep -rn "ensure_commitment_instances" proto/ src/`
Expected: exactly one match, the line you just edited (plus `ensure_my_commitment_instances`, a
different function — do not change those).

- [ ] **Step 6: Run the proto tests**

Run: `npm run test:proto`
Expected: PASS. (This module has no direct test; the run confirms no import-time breakage across
the proto module graph.)

- [ ] **Step 7: Commit**

```bash
git rev-parse --abbrev-ref HEAD   # expect feat/premium-polish
git add proto/redesign-2026-07/js/commitment-data.js
git commit -m "feat(commitments): client data layer for self-owned commitments"
```

---

## Task 6: The solo composer screen

**Files:**
- Create: `proto/redesign-2026-07/js/screens/solo-commitments.js`
- Modify: whichever module registers screens (find it with the grep in Step 1)

**Interfaces:**
- Consumes: `loadMyCommitments`, `saveSelfCommitment`, `setSelfCommitmentActive` from Task 5;
  `TYPE_LABEL` from `../commitments.js`.
- Produces: two screen objects, `soloCommitments` (list) and `soloCommitEdit` (composer),
  registered at routes `solo-commitments` and `solo-commit-edit`.

**Why a new file:** `coach-commitments.js` is already 400+ lines and carries the board, the roster
rows, the audience picker, and staff-permission gating — none of which exist for a solo user.
Trimming it in place would tangle two audiences in one file.

- [ ] **Step 1: Find the screen registry and read the composer you are trimming**

Run: `grep -rn "coachCommitEdit" proto/redesign-2026-07/js/ | grep -v coach-commitments.js`

That tells you which module imports and registers screens. Then read
`proto/redesign-2026-07/js/screens/coach-commitments.js` lines 268–460 — `TYPES`,
`editCommitment`, `coachCommitManage`, and `coachCommitEdit`. Your composer is that one with the
audience picker and the staff gate removed.

- [ ] **Step 2: Write the screen**

Create `proto/redesign-2026-07/js/screens/solo-commitments.js`. Match the idiom of the
surrounding screens exactly: a default-exported or named object with `tab`, `render()`, and
`mount(root)`.

**⚠ Animate in `render()`, not `mount()`.** `__render()` re-runs `mount()`, so any state you
initialise in `mount` replays on every repaint. This has caused three separate replay bugs in this
codebase. Screen-state resets belong in `render()`.

```js
/* OnStandard — Solo commitments. The list + composer for a user who owns their own book.
   Separate from coach-commitments.js: no board, no roster, no audience picker, no staff gate —
   the audience is the author, and the server enforces that.

   ⚠ There is no delete. commitments -> instances -> responses cascades, so deleting would erase
   the miss record. Ending a commitment means pausing it or setting an end date. */
import { icon } from '../icons.js';
import { backHead, esc } from '../components.js';
import { TYPE_LABEL } from '../commitments.js';
import { loadMyCommitments, saveSelfCommitment, setSelfCommitmentActive } from '../commitment-data.js';

/* The types a solo user can schedule for themselves. Team-shaped types (team_meeting, practice,
   tutoring, class) are omitted — nobody is convening them. */
const SOLO_TYPES = ['morning_roll_call', 'strength', 'speed', 'rehab', 'nutrition', 'study_hall'];

const DAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

let ROWS = null;           // null = loading, [] = genuinely empty
let DRAFT = null;          // the composer's working row

const hhmm = (min) => {
  const h = Math.floor(min / 60), m = min % 60;
  const ampm = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, '0')} ${ampm}`;
};

export const soloCommitments = {
  tab: 'progress',
  render() {
    const rows = ROWS || [];
    const loading = ROWS === null;
    ROWS = ROWS;  // no reset here; the loader owns it

    const card = (r) => `
      <section class="card pad" style="margin-bottom:10px;${r.active ? '' : 'opacity:.55'}">
        <div style="display:flex;align-items:center;gap:10px">
          <div class="req-icon b" style="width:34px;height:34px">${icon('clock', 15)}</div>
          <div style="flex:1">
            <div class="tt">${esc(r.title)}</div>
            <div class="ts">${esc(TYPE_LABEL[r.type] || r.type)} · ${esc(hhmm(r.starts_min))}${r.active ? '' : ' · paused'}</div>
          </div>
          <button class="chip" data-edit="${esc(r.id)}">Edit</button>
        </div>
      </section>`;

    return `
    ${backHead('Your commitments', 'You set these. They hold you to them.', 'accountability')}
    ${loading ? '<section class="card pad"><div class="ts">Loading…</div></section>'
      : rows.length ? rows.map(card).join('')
      : `<div class="sidebox">
           <div class="req-icon b" style="width:38px;height:38px">${icon('clock', 17)}</div>
           <div><div class="tt">Nothing scheduled yet</div>
           <div class="ts">Schedule a wake-up, a lift, or a session. You will be asked to confirm it at the time — and the record keeps score whether you do or not.</div></div>
         </div>`}
    <div style="height:12px"></div>
    <button class="btn" id="solo-new" style="width:100%">${icon('plus', 18)} Schedule a commitment</button>
    <div class="ts" style="padding:12px 2px 0;text-align:center">
      You can pause a commitment, but you cannot delete its record. That is the point.
    </div>`;
  },
  async mount(root) {
    const nu = root.querySelector('#solo-new');
    if (nu) nu.addEventListener('click', () => { DRAFT = null; window.__go('solo-commit-edit'); });
    root.querySelectorAll('[data-edit]').forEach((b) => b.addEventListener('click', () => {
      DRAFT = (ROWS || []).find((r) => r.id === b.getAttribute('data-edit')) || null;
      window.__go('solo-commit-edit');
    }));
    if (ROWS === null) {
      ROWS = await loadMyCommitments();
      if (window.__render) window.__render();
    }
  },
};

export const soloCommitEdit = {
  tab: 'progress',
  render() {
    const d = DRAFT || { type: 'morning_roll_call', title: '', repeat_days: [1, 2, 3, 4, 5], starts_min: 300, active: true };
    return `
    ${backHead(d.id ? 'Edit commitment' : 'New commitment', 'The audience is you', 'solo-commitments')}
    <section class="card pad">
      <div class="eyebrow">What is it</div>
      <div style="display:flex;flex-wrap:wrap;gap:6px;padding-bottom:12px">
        ${SOLO_TYPES.map((t) => `<button class="chip ${d.type === t ? 'on' : ''}" data-type="${t}">${esc(TYPE_LABEL[t])}</button>`).join('')}
      </div>
      <input id="solo-title" class="ob-input" placeholder="Name it in your own words" maxlength="60" value="${esc(d.title || '')}" />
    </section>
    <div style="height:10px"></div>
    <section class="card pad">
      <div class="eyebrow">When</div>
      <div style="display:flex;gap:6px;padding-bottom:12px">
        ${DAYS.map((lbl, i) => `<button class="chip ${(d.repeat_days || []).includes(i) ? 'on' : ''}" data-day="${i}" style="flex:1">${lbl}</button>`).join('')}
      </div>
      <input id="solo-time" class="ob-input" type="time" value="${String(Math.floor((d.starts_min || 300) / 60)).padStart(2, '0')}:${String((d.starts_min || 300) % 60).padStart(2, '0')}" />
    </section>
    <div style="height:10px"></div>
    <button class="btn green" id="solo-save" style="width:100%">Save</button>
    ${d.id ? `<div style="height:8px"></div>
      <button class="btn" id="solo-pause" style="width:100%">${d.active ? 'Pause this' : 'Resume this'}</button>` : ''}`;
  },
  mount(root) {
    const d = DRAFT || { type: 'morning_roll_call', title: '', repeat_days: [1, 2, 3, 4, 5], starts_min: 300, active: true };
    DRAFT = d;

    root.querySelectorAll('[data-type]').forEach((b) => b.addEventListener('click', () => {
      d.type = b.getAttribute('data-type');
      if (window.__render) window.__render();
    }));
    root.querySelectorAll('[data-day]').forEach((b) => b.addEventListener('click', () => {
      const i = Number(b.getAttribute('data-day'));
      d.repeat_days = (d.repeat_days || []).includes(i)
        ? d.repeat_days.filter((x) => x !== i)
        : [...(d.repeat_days || []), i].sort();
      if (window.__render) window.__render();
    }));

    const title = root.querySelector('#solo-title');
    if (title) title.addEventListener('input', () => { d.title = title.value; });
    const time = root.querySelector('#solo-time');
    if (time) time.addEventListener('change', () => {
      const [h, m] = time.value.split(':').map(Number);
      d.starts_min = (h * 60) + m;
    });

    const save = root.querySelector('#solo-save');
    if (save) save.addEventListener('click', async () => {
      if (!d.title.trim() || !(d.repeat_days || []).length) return;
      save.disabled = true;
      const ok = await saveSelfCommitment({
        id: d.id || null, type: d.type, title: d.title.trim(),
        repeat_days: d.repeat_days, starts_min: d.starts_min,
        respond_by_min: Math.min(1439, d.starts_min + 30),
        active: d.active !== false,
      });
      save.disabled = false;
      if (ok) { ROWS = null; DRAFT = null; window.__go('solo-commitments'); }
    });

    const pause = root.querySelector('#solo-pause');
    if (pause) pause.addEventListener('click', async () => {
      pause.disabled = true;
      const ok = await setSelfCommitmentActive(d, !d.active);
      pause.disabled = false;
      if (ok) { ROWS = null; DRAFT = null; window.__go('solo-commitments'); }
    });
  },
};
```

- [ ] **Step 3: Register the two routes**

In the module you found in Step 1, import and register alongside the existing entries:

```js
import { soloCommitments, soloCommitEdit } from './screens/solo-commitments.js';
```

and add `'solo-commitments': soloCommitments,` and `'solo-commit-edit': soloCommitEdit,` to the
route table, matching the surrounding formatting exactly.

- [ ] **Step 4: Verify it loads**

Run: `npm run test:proto`
Expected: PASS — confirms the new module parses and its imports resolve.

- [ ] **Step 5: Commit**

```bash
git rev-parse --abbrev-ref HEAD   # expect feat/premium-polish
git add proto/redesign-2026-07/js/screens/solo-commitments.js
git commit -m "feat(commitments): solo composer screen"
```

Stage the registry file too — substitute its real path for `<registry>`:

```bash
git add proto/redesign-2026-07/js/<registry>.js
git commit --amend --no-edit
```

---

## Task 7: Accountability screen copy + entry point

**Files:**
- Modify: `proto/redesign-2026-07/js/screens/accountability.js:36-57`

**Interfaces:**
- Consumes: `soloCommitments` route from Task 6.
- Produces: no new exports; the screen gains a third copy branch.

**The problem:** both copy sites assume someone else scheduled the commitment. Line 42–44 says
*"When a roll call, a lift, or a study hall is scheduled for you"* and line 54 says *"across every
commitment your coach scheduled"*. For a solo user, both name a person who does not exist.

- [ ] **Step 1: Read the current branches**

Run: `sed -n '28,60p' proto/redesign-2026-07/js/screens/accountability.js`

Note the existing shape: `S.coach.hasCoach ? <coached copy> : <passive copy>`. You are turning
each two-way branch into a three-way one. `S.coach.hasCoach` stays the first test; the new
distinction is between a solo user (owns their own book) and someone waiting on a coach.

- [ ] **Step 2: Add the solo import and helper**

At the top of the file, alongside the existing imports:

```js
import { loadMyCommitments } from '../commitment-data.js';
```

And below the `let LOADED_FOR = null;` line:

```js
/* Whether this user owns any commitments themselves. Drives the copy: a solo user schedules their
   own, so "scheduled for you" would name a person who does not exist. Loaded alongside ROWS. */
let SELF_OWNED = false;
```

- [ ] **Step 3: Replace the empty state**

Replace the block at lines 36–45 with:

```js
    if (!loading && !rows.length) {
      const who = S.coach.hasCoach
        ? `When your ${esc(S.coach.noun)} schedules a roll call, a lift, or a study hall`
        : 'When you schedule a wake-up, a lift, or a session';
      return `
      ${backHead('Morning Readiness', 'Verified commitments', 'progress')}
      <div class="sidebox">
        <div class="req-icon b" style="width:38px;height:38px">${icon('clock', 17)}</div>
        <div><div class="tt">Nothing to show yet</div>
        <div class="ts">${who}, your responses and arrivals build this record. It's separate from your daily score.</div></div>
      </div>
      ${S.coach.hasCoach ? '' : `
      <div style="height:12px"></div>
      <button class="btn" data-go="solo-commitments" style="width:100%">${icon('plus', 18)} Schedule your own</button>`}`;
    }
```

- [ ] **Step 4: Replace the headline subtitle**

Replace the `<div class="ts" style="padding-top:8px">…</div>` at line 54 with:

```js
      <div class="ts" style="padding-top:8px">Accountability across every commitment ${S.coach.hasCoach ? `your ${esc(S.coach.noun)} scheduled` : SELF_OWNED ? 'you scheduled' : 'scheduled for you'}</div>
```

- [ ] **Step 5: Load the flag**

Find the existing loader that sets `ROWS` (search for `LOADED_FOR`) and set `SELF_OWNED`
alongside it:

```js
      SELF_OWNED = (await loadMyCommitments()).length > 0;
```

- [ ] **Step 6: Add a manage entry point for solo users**

At the end of the non-empty `render()` return, before the closing backtick, append:

```js
    ${S.coach.hasCoach ? '' : `
    <div style="height:12px"></div>
    <button class="btn" data-go="solo-commitments" style="width:100%">Manage your commitments</button>`}
```

- [ ] **Step 7: Verify**

Run: `npm run test:proto`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git rev-parse --abbrev-ref HEAD   # expect feat/premium-polish
git add proto/redesign-2026-07/js/screens/accountability.js
git commit -m "feat(accountability): honest copy and an entry point when nobody else schedules"
```

---

## Task 8: Remove the unbacked "supporter" paywall claim

**Files:**
- Modify: `proto/redesign-2026-07/js/ob2.js:372-375`

**Interfaces:** none. Copy only.

**Why:** the Individual card sells *"one connected supporter"* and Individual Plus sells
*"unlimited supporters"*. `grep -rn "supporter" .` finds the word only in onboarding copy and two
docs — there is no implementation anywhere, and the canonical `pricing.ts` blurb says *"on your
own."* Charging a $10/mo upgrade for unlimited instances of a feature that does not exist is the
same class of unsupported claim already stripped out of the marketing site. Building supporters
properly is its own spec; this task only stops selling it.

- [ ] **Step 1: Confirm the claim is still unbacked**

Run: `grep -rn "supporter" --include=*.js --include=*.ts proto/ src/ supabase/`
Expected: matches ONLY in `proto/redesign-2026-07/js/ob2.js`,
`proto/redesign-2026-07/js/screens/ob2-athlete.js`, and
`proto/redesign-2026-07/js/screens/ob2-parent.js` — all copy, no implementation. If you find a
real implementation, STOP and report it; the premise of this task is wrong.

- [ ] **Step 2: Rewrite the two subtitles**

In `proto/redesign-2026-07/js/ob2.js`, replace the `individual` and `individual_plus` `sub` values:

```js
    { id: 'individual', name: 'Individual', monthly: '$14.99', annual: '$126', annualPer: '$10.50', save: 'Save $54', tag: '7-day free trial',
      sub: 'Daily Score, AI meal analysis, streaks, and your own verified commitments.' },
    { id: 'individual_plus', name: 'Individual Plus', monthly: '$24.99', annual: '$210', annualPer: '$17.50', save: 'Save $90',
      sub: 'Everything in Individual plus your full history, trends, and portable record.' },
```

Both replacements describe things that exist: verified commitments ship in Tasks 1–7, and the
portable record is the `individual_plus` blurb already in `pricing.ts`.

- [ ] **Step 3: Check the other two files**

Run: `grep -n "supporter" proto/redesign-2026-07/js/screens/ob2-athlete.js proto/redesign-2026-07/js/screens/ob2-parent.js`

Read each match in context. If it is a plan subtitle, apply the same treatment. If it is narrative
copy about a parent or coach watching (which IS implemented — the parent flow is real), leave it.

- [ ] **Step 4: Verify the pricing parity test still passes**

Run: `npx jest obPlanPricingParity`
Expected: PASS. That test locks ids, prices, names, seats, trials, and overage — not subtitles,
which is exactly why subtitle edits are safe here. If it fails, you changed a locked field; revert
and change only `sub`.

- [ ] **Step 5: Commit**

```bash
git rev-parse --abbrev-ref HEAD   # expect feat/premium-polish
git add proto/redesign-2026-07/js/ob2.js
git commit -m "fix(paywall): stop selling connected supporters, which do not exist"
```

---

## Task 9: Full verification

**Files:** none modified.

- [ ] **Step 1: Run every suite**

```bash
supabase db reset
npm run test:rls
npm test
npm run test:proto
```

Expected: PASS on all four. Record the actual output — do not claim success without it.

- [ ] **Step 2: Confirm the daily score is untouched**

Run: `npx tsx scripts/score-parity` (check the exact script name with
`node -e "console.log(Object.keys(require('./package.json').scripts))"` if it is registered
differently).
Expected: parity holds. Verified Commitments must not have moved the 0–100 score by a single point.

- [ ] **Step 3: Confirm no coordinate column was added**

Run: `grep -n "lat\|lng" supabase/migrations/0165_solo_commitments.sql`
Expected: no matches. Athlete coordinates are never persisted.

- [ ] **Step 4: Report**

Summarise: which migrations need applying (`0165`), that the founder must run
`supabase db push` then `npm run test:rls` against prod, and that the proto changes need an OTA to
reach devices.

---

## Self-Review Notes

**Spec coverage:** schema (T1), predicate rename + call sites (T1, T4 sweep), `upsert_commitment`
(T2), `ensure_my_commitment_instances` (T3), escalation default (T2, in the insert), no-delete
(T2), no-self-excuse (T4), client data layer (T5), composer (T6), accountability copy (T7),
testing (T9). The spec's "upgrade path" section requires no code — it falls out of the predicate,
and T4's test covers the cross-book cases.

**Ordering bug caught and fixed during review:** the first draft dropped
`commitment_owner_is_staff` at the end of Task 1. That would have failed outright —
`commitment_board` is `language sql` and holds a hard catalog dependency — and worse, the plpgsql
dependents (`remind_missing`, `staff_set_response`, `staff_excuse_athlete`,
`ensure_commitment_instances`) would have dropped cleanly and then broken at their next call, with
no error until runtime. The drop is now the last statement in the migration, in Task 4 Step 4,
after all nine dependents are recreated.

**Remaining risk:** Task 4 Step 4 asks the implementer to hand-copy `remind_missing` from 0138
rather than reproducing it here, because its body is long and unchanged apart from one line.
That is the one place this plan asks someone to transcribe rather than paste. If it is wrong, the
RLS suite in Step 5 catches it.
