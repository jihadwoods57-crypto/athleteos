# Roll Call Rebuilt Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild roll call around a live team board, a real one-tap lock-screen check-in, a 20-second coach setup with a week strip, a closing summary and history, plus an optional location check (map bubble, automatic walk-in, "I'm here"), all counting toward the daily score.

**Architecture:** Keep the proven engine (commitments / instances / responses, `rollcall_verdict`, the AlarmKit alarm, the push-to-start Live Activity, reminder and escalation crons). Add: one migration of read RPCs and a server-side distance check; Live Activity content with team data and a self-posting check-in intent; the restored location seam plus an `expo-maps` picker; and new proto screens (board, your day, setup, week strip, history) that replace the old ones.

**Tech Stack:** Supabase Postgres (plpgsql, RLS, Realtime), Deno edge functions (APNs Live Activity pushes, Expo push), Swift (ActivityKit, AlarmKit, AppIntents, WidgetKit), Expo SDK 57 (expo-location, expo-task-manager, expo-maps 57.0.3), the WebView proto (vanilla ES modules, no bundler).

**Spec:** `docs/superpowers/specs/2026-09-23-roll-call-rebuilt-design.md` (read the "Corrections after mapping the code" section first; it wins). Visual reference: https://claude.ai/artifact/VWQw2LKLnXneumgSxumZqK

## Global Constraints

- The shipped UI is `proto/redesign-2026-07/`; `src/` is native glue only. No bundler: every import must exist or it throws at tap time (`npm run lint:undef`).
- Founder decision 2026-09-23: location returns in THIS build, including "Always" + background region monitoring. Do not cut it for review risk; word the purpose strings plainly.
- Stop on the iOS alarm checks in (kept). The alarm's second button checks in AND opens the app on the board.
- Morning points: `NIGHT_SHIFT` (0.08) is ONE budget split evenly across assigned parts: wake-up, sleep, arrival. Food 0.82 never moves.
- Verdicts come from the server (`rollcall_verdict`); the client never re-derives one.
- Teammates see name, avatar, ack time, arrival time, verdict and order. Nothing else. Coordinates are never stored or shown.
- New places: radius 100 to 1000 m (the table allows 50; the saving function enforces 100).
- Migrations: next number is **0242**; idempotent (`create or replace`, `add column if not exists`); copy existing function bodies from the live definition (`select pg_get_functiondef('fn'::regproc)` via `npx supabase db query --linked "..."`, single line), never retype them.
- Edge-function prompt/template literals: no backticks inside prose. Deploy output says exit 0 even on a parse failure: read the tail.
- Swift files listed in `scripts/check-mirrors.mjs` (RollCallAttributes, RollCallCheckInIntent, RollCallWidget) must stay byte-identical between `modules/rollcall-live/ios/` and `targets/RollCallWidget/`; `npm run lint:mirror`.
- Design system: `DESIGN.md` incl. "Amendments · 2026-09-22" (tier colours, red = missed, amber = real warning, selection blue, no boxed-metric tiles). Proto CSS is one flat namespace; grep class names before minting. `focus.css` owns `::after`.
- Ratchets must not grow: `npm run lint:type lint:inline lint:space lint:dash lint:copy lint:xss lint:undef lint:mirror lint:boot`. New screens load lazily (`lazy(() => import(...))` in `js/screens/index.js`) so `lint:boot` does not grow.
- Never `git add -A` (a concurrent committer may share the tree); stage explicit paths. Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- The full gate is `npm run verify` (18 gates). Proto changes need `node scripts/build-proto-zip.mjs` before `verify:zip`/`verify:fresh` pass.

## File Structure

Server
- Create `supabase/migrations/0242_rollcall_rebuilt.sql`: team board RPC, history RPC, 10-minute open lead, server-side arrival distance, place saving with the 100 m floor, instance-bound ack code support columns, night-budget ceiling with arrival.
- Modify `supabase/functions/_shared/rollcall-live.ts` (+ `.test.ts`): content state gains `teamUp`, `teamTotal`, `place`, `points`; `answered` becomes an update, not an end.
- Modify `supabase/functions/_shared/rollcall-code.ts` (+ `.test.ts`): instance-window codes.
- Modify `supabase/functions/roll-call-ack/index.ts` + `logic.ts` (+ tests): accept window codes; update the athlete's card; fan out team-count updates.
- Modify `supabase/functions/commitment-reminders/*`: start the card at open (10 min lead) carrying the window code.
- Modify `supabase/functions/commitment-escalation/*`: closing summary push to coaches at close.

Native
- Modify `modules/rollcall-live/ios/{RollCallAttributes,RollCallCheckInIntent,RollCallWidget,RollCallAlarm,RollCallLiveModule}.swift` and mirrors in `targets/RollCallWidget/`.
- Restore `src/lib/location/index.ts`, `src/lib/location/geofence.ts` (from `8e7506bb^`), adapted to send coordinates.
- Create `src/lib/maps/placePicker.tsx`: native full-screen map modal (expo-maps) returning `{name, address, lat, lng, radius_m}`.
- Modify `src/proto/bridge.ts` (+ `bridge.test.ts`), `src/proto/ProtoApp.tsx`, `app.json`, `plugins/withRollCallLiveActivity.js`, `package.json`.

Proto
- Create `proto/redesign-2026-07/js/team-board.js`: pure board model (order, groups, place, counts) + markup builder.
- Create `proto/redesign-2026-07/js/screens/rollcall-board.js`: the Team Board screen (athlete and coach modes) + Your Day panel.
- Create `proto/redesign-2026-07/js/screens/rollcall-setup.js`: 4-answer setup, place step, week strip, history screen.
- Create `proto/redesign-2026-07/js/location.js`: WebView wrappers for the restored LOCATION_* and MAP_PICK bridge messages.
- Modify `js/commitment-data.js` (new loaders/writers), `js/plan-style.js`, `js/day.js`, `js/state.js` (arrival scoring), `js/screens/index.js` (routes), `js/screens/home.js`, `js/screens/roll-call.js`, `js/screens/coach-create.js`, `js/screens/coach.js`, `js/screens/coach-home.js`, `js/screens/coach-commitments.js`, `js/wake-face.js`, `css/screens.css`.
- Modify `src/core/scoringProfiles.ts`, `src/core/scoreIntegrity.ts` (score parity).
- Harness: `web/landing-src/lib/sb-stub.mjs`, `scripts/qc-capture.mjs`.
- Create `docs/go-live/ROLLCALL-DEVICE-TEST.md`.

---

### Task 1: Arrival joins the morning points budget (client + engine parity)

**Files:**
- Modify: `proto/redesign-2026-07/js/plan-style.js:159-186` (`weightsForAssigned`, `WEIGHT_CAPS`)
- Modify: `proto/redesign-2026-07/js/day.js:413-430` (add `arrivalParts`), `:497-560` (`computeComponents`, `weightsForDay`, `scoreFor`, `evidenceCeiling`), `:1099-1132` (`daySetArrival`, persisted as `checkin.arrival`)
- Modify: `proto/redesign-2026-07/js/state.js:240` (`computeScore` adds arrival)
- Modify: `src/core/scoringProfiles.ts:97-125`, `src/core/scoreIntegrity.ts:45,78,247-257`
- Test: `proto/redesign-2026-07/js/wakeup-score.test.mjs`, `src/core/scoreParity.test.ts`, `src/core/planStyleCaps.test.ts`

**Interfaces:**
- Produces: `weightsForAssigned(profile, {wakeup?, sleep?, arrival?})` returning weights incl. `arrival`; `arrivalParts(day) -> {score, assigned}`; `daySetArrival({assigned, verdict, lateMin}, userId)`; `DAY.arrival` persisted in `days.checkin.arrival`; `WEIGHT_CAPS.arrival = NIGHT_SHIFT`.

- [ ] **Step 1: Write the failing tests** (append to `proto/redesign-2026-07/js/wakeup-score.test.mjs`)

```js
test('arrival joins the morning budget: wake-up + arrival split 8 into 4 and 4', async () => {
  const { weightsForAssigned, NIGHT_SHIFT } = await import('./plan-style.js');
  const w = weightsForAssigned('athlete', { wakeup: true, arrival: true });
  assert.equal(Math.round(w.wakeup * 100), 4);
  assert.equal(Math.round(w.arrival * 100), 4);
  assert.equal(Math.round(w.nutrition * 100), 82);
  assert.equal(Math.round((w.recovery + w.checkin) * 100), Math.round((0.18 - NIGHT_SHIFT) * 100));
});
test('arrival alone takes the whole 8', async () => {
  const { weightsForAssigned } = await import('./plan-style.js');
  const w = weightsForAssigned('athlete', { arrival: true });
  assert.equal(Math.round(w.arrival * 100), 8);
  assert.equal(w.wakeup, 0);
});
test('arrivalParts scores like the wake-up: on time 100, late 50, missed 0, anything else leaves', async () => {
  const { arrivalParts } = await import('./day.js');
  assert.deepEqual(arrivalParts({ arrival: { assigned: true, verdict: 'on_standard' } }), { score: 100, assigned: true });
  assert.deepEqual(arrivalParts({ arrival: { assigned: true, verdict: 'late' } }), { score: 50, assigned: true });
  assert.deepEqual(arrivalParts({ arrival: { assigned: true, verdict: 'missed' } }), { score: 0, assigned: true });
  assert.deepEqual(arrivalParts({ arrival: { assigned: true, verdict: 'pending' } }), { score: 0, assigned: false });
  assert.deepEqual(arrivalParts({}), { score: 0, assigned: false });
});
```

And in `src/core/scoreParity.test.ts` add:

```ts
test('arrival weights match between proto and engine for every profile', async () => {
  const proto = await import('../../proto/redesign-2026-07/js/plan-style.js');
  for (const p of ['athlete', 'general', 'gain']) {
    for (const a of [{ arrival: true }, { wakeup: true, arrival: true }, { wakeup: true, sleep: true, arrival: true }]) {
      expect(weightsForAssigned(p as never, a)).toEqual(proto.weightsForAssigned(p, a));
    }
  }
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `node scripts/node-test.mjs "proto/redesign-2026-07/js/wakeup-score.test.mjs"` and `npx jest src/core/scoreParity.test.ts`
Expected: FAIL (`arrivalParts` not exported; `w.arrival` undefined).

- [ ] **Step 3: Implement**

In `plan-style.js` replace the body of `weightsForAssigned`:

```js
export function weightsForAssigned(profile, assigned = {}) {
  const base = weightsFor(null, profile);
  const parts = ['wakeup', 'sleep', 'arrival'];
  const n = parts.filter((k) => assigned[k]).length;
  if (!n || !NIGHT_SHIFT) return { ...base, wakeup: 0, sleep: 0, arrival: 0 };
  // ONE morning/night budget (NIGHT_SHIFT) split evenly across whatever the coach assigned:
  // wake-up, sleep standard, arrival (2026-09-23). Taken half from recovery, half from the
  // check-in, so nutrition's 82 never moves and the day always sums to 1.
  const each = NIGHT_SHIFT / n;
  const half = NIGHT_SHIFT / 2;
  const out = { ...base, recovery: base.recovery - half, checkin: base.checkin - half };
  for (const k of parts) out[k] = assigned[k] ? each : 0;
  return out;
}
```

Add `arrival: NIGHT_SHIFT` to `WEIGHT_CAPS` and include `'arrival'` in the `keys` list in `weightsWithinCaps`.

In `day.js` add next to `wakeupParts`:

```js
/** The coach-assigned arrival (location check). Same rule and same reasons as wakeupParts. */
export function arrivalParts(day) {
  const a = day && day.arrival;
  if (!a || !a.assigned) return { score: 0, assigned: false };
  switch (String(a.verdict || '')) {
    case 'on_standard': return { score: 100, assigned: true };
    case 'late': return { score: 50, assigned: true };
    case 'missed': return { score: 0, assigned: true };
    default: return { score: 0, assigned: false };
  }
}
```

Then, following exactly how `wakeup` is threaded: `computeComponents` adds `arrival` and `arrivalAssigned`; `weightsForDay` passes `arrival: c.arrivalAssigned`; `scoreFor` adds `(w.arrival||0)*c.arrival`; `evidenceCeiling` adds `w.arrival*100` when assigned; add `daySetArrival(a, userId)` mirroring `daySetWakeup` and persist as `checkin.arrival` beside `checkin.wakeup`. In `state.js:240` add `(w.arrival||0)*(c.arrival||0)`. Mirror the same in `src/core/scoringProfiles.ts` and in `scoreIntegrity.ts` (`MAX_SUBSCORE_WEIGHT.arrival = NIGHT_SHIFT`; `evidenceFromDayRow` reads `ci.arrival.verdict`; `nightAssigned`/`nightEarned` include arrival).

- [ ] **Step 4: Run tests**

Run: `node scripts/node-test.mjs "proto/redesign-2026-07/js/**/*.test.mjs"` and `npx jest src/core/scoreParity.test.ts src/core/planStyleCaps.test.ts src/core/scoreIntegrity.test.ts`
Expected: PASS (all existing wake-up tests still pass: a wake-up-only day is unchanged).

- [ ] **Step 5: Commit**

```bash
git add proto/redesign-2026-07/js/plan-style.js proto/redesign-2026-07/js/day.js proto/redesign-2026-07/js/state.js proto/redesign-2026-07/js/wakeup-score.test.mjs src/core/scoringProfiles.ts src/core/scoreIntegrity.ts src/core/scoreParity.test.ts src/core/planStyleCaps.test.ts
git commit -m "feat(score): arrival joins the morning budget (wake-up + arrival split 8 into 4/4)"
```

---

### Task 2: Migration 0242, part A: team board, history, 10-minute open, night ceiling

**Files:**
- Create: `supabase/migrations/0242_rollcall_rebuilt.sql`
- Test: `supabase/tests/rls_authz_test.sql` (append a `-- 0242` section)

**Interfaces:**
- Produces:
  - `rollcall_team_board(p_instance uuid) returns jsonb`: `{instance_id, title, coach_name, starts_at, respond_by_at, closes_at, arrive_by_at, asks_arrival, location_name, total, up, arrived, rows:[{athlete_id, name, avatar_path, acknowledged_at, arrived_at, verdict, arrival_verdict, place}]}` ordered by `acknowledged_at nulls last, name`. Caller must be a responder on the instance OR staff of its owner.
  - `rollcall_history(p_commitment uuid, p_days int default 30) returns jsonb`: `{team_on_time_pct, team_trend, athletes:[{athlete_id, name, avatar_path, mornings, on_time, late, missed, on_time_pct, trend, streak, first_up}]}`, staff only.
  - `rollcall_opens_at(...)` returns `starts_at - 10 min` for `morning_roll_call` when `opens_min` is null.
  - `clamp_day_score_to_evidence()` night budget counts `checkin->'arrival'` as an assigned part.

- [ ] **Step 1: Write the failing SQL tests** (append to `supabase/tests/rls_authz_test.sql`, reusing its `_ok`, `_as`, `_try`, `_superuser` helpers and the 0211/0215 roll-call fixtures `_rc_*`)

```sql
-- 0242 roll call rebuilt
select _superuser();
select _ok((select rollcall_opens_at('morning_roll_call', now() + interval '5 min', now(), 360::smallint, null)) = now() - interval '10 min',
  '0242: a wake-up opens 10 minutes before its start');
select _as('22222222-0000-0000-0000-000000000001'); -- athlete A on the roll-call team
select _ok((select jsonb_array_length(rollcall_team_board((select id from _rc_next))->'rows')) >= 2,
  '0242: an athlete on the roll call sees the whole team board');
select _ok(not ((rollcall_team_board((select id from _rc_next))->'rows'->0) ? 'lat'),
  '0242: the board carries no coordinates');
select _as('33333333-0000-0000-0000-000000000009'); -- athlete on another team
select _ok(_try($f$ select rollcall_team_board((select id from _rc_next)) $f$) <> 'ok',
  '0242: an outsider cannot read another team''s board');
select _as('11111111-0000-0000-0000-000000000001'); -- staff
select _ok((rollcall_history((select commitment_id from _rc_next), 30) ? 'athletes'),
  '0242: staff read the history');
select _as('22222222-0000-0000-0000-000000000001');
select _ok(_try($f$ select rollcall_history((select commitment_id from _rc_next), 30) $f$) <> 'ok',
  '0242: athletes cannot read the history');
```

(If the fixture ids differ, read the existing 0211 section at `rls_authz_test.sql:1419` and use the same athlete/staff/instance fixtures; do not invent new users.)

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test:rls` (needs the local Supabase stack: `npx supabase start`).
Expected: FAIL: functions do not exist.

- [ ] **Step 3: Write the migration**

Start the file with a header comment explaining the spec + corrections. Then:

```sql
-- 1. Open 10 minutes before the start (was: at the start). Copy the live body of
--    rollcall_opens_at (0212:84) first, then change ONLY the morning default.
create or replace function rollcall_opens_at(p_type text, p_starts_at timestamptz, p_respond_by_at timestamptz,
  p_starts_min smallint, p_opens_min smallint) returns timestamptz language sql immutable as $$
  select case
    when p_type = 'morning_roll_call' and p_opens_min is null then p_starts_at - interval '10 minutes'
    else commitment_opens_at(p_starts_at, p_respond_by_at, p_starts_min, p_opens_min)
  end
$$;

-- 2. The team board. SECURITY DEFINER because cr_read limits an athlete to their own row;
--    this returns ONLY roster-safe fields, and only to someone on the instance or its staff.
create or replace function rollcall_team_board(p_instance uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare i commitment_instances; c commitments; v_now timestamptz := now(); v_out jsonb;
begin
  select * into i from commitment_instances where id = p_instance;
  if not found then raise exception 'no_instance'; end if;
  select * into c from commitments where id = i.commitment_id;
  if not (exists (select 1 from commitment_responses r where r.instance_id = p_instance and r.athlete_id = auth.uid())
          or commitment_owner_is_staff(c.team_id, c.practice_id)) then
    raise exception 'not_authorized';
  end if;
  with rows as (
    select r.athlete_id, p.full_name as name, p.avatar_path, r.acknowledged_at, r.arrived_at,
      rollcall_verdict(r.status, r.acknowledged_at, coalesce(i.respond_by_at, i.starts_at),
        rollcall_closes_at(c.type, i.respond_by_at, i.starts_at, i.ends_at), v_now,
        r.ack_source, r.sync_review, r.review_resolution) as verdict,
      case when c.location_id is null then null
           when r.arrived_at is null then case when v_now > rollcall_closes_at(c.type, i.respond_by_at, i.starts_at, i.ends_at) then 'missed' else 'pending' end
           when r.arrived_at <= coalesce(i.arrive_by_at, i.starts_at) + make_interval(mins => coalesce(c.arrival_grace_min, 10)) then 'on_standard'
           else 'late' end as arrival_verdict
    from commitment_responses r join profiles p on p.id = r.athlete_id
    where r.instance_id = p_instance
  ), ordered as (
    select *, case when acknowledged_at is null then null
                   else row_number() over (partition by (acknowledged_at is null) order by acknowledged_at) end as place
    from rows
  )
  select jsonb_build_object(
    'instance_id', i.id, 'title', c.title,
    'coach_name', (select full_name from profiles where id = c.created_by),
    'starts_at', i.starts_at, 'respond_by_at', i.respond_by_at,
    'closes_at', rollcall_closes_at(c.type, i.respond_by_at, i.starts_at, i.ends_at),
    'arrive_by_at', i.arrive_by_at, 'asks_arrival', c.location_id is not null,
    'location_name', (select name from commitment_locations where id = c.location_id),
    'total', (select count(*) from rows where verdict <> 'excused'),
    'up', (select count(*) from rows where acknowledged_at is not null),
    'arrived', (select count(*) from rows where arrived_at is not null),
    'rows', coalesce((select jsonb_agg(jsonb_build_object(
        'athlete_id', athlete_id, 'name', name, 'avatar_path', avatar_path,
        'acknowledged_at', acknowledged_at, 'arrived_at', arrived_at,
        'verdict', verdict, 'arrival_verdict', arrival_verdict, 'place', place)
      order by acknowledged_at nulls last, name) from ordered), '[]'::jsonb)
  ) into v_out;
  return v_out;
end $$;
```

(Check `profiles.avatar_path`'s real column name with `select column_name from information_schema.columns where table_name='profiles'` and use it. Check `arrival_grace_min` exists on `commitments` (0138); it does per the code map.)

```sql
-- 3. History: per athlete over the last N occurrences of this roll call. Staff only.
create or replace function rollcall_history(p_commitment uuid, p_days int default 30) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare c commitments; v_days int := greatest(1, least(coalesce(p_days, 30), 90)); v_out jsonb;
begin
  select * into c from commitments where id = p_commitment;
  if not found or not commitment_owner_is_staff(c.team_id, c.practice_id) then raise exception 'not_authorized'; end if;
  with occ as (
    select i.* from commitment_instances i
    where i.commitment_id = p_commitment and i.status <> 'cancelled' and coalesce(i.skipped, false) = false
      and i.occurs_on between current_date - v_days and current_date
      and now() > rollcall_closes_at(c.type, i.respond_by_at, i.starts_at, i.ends_at)
  ), v as (
    select r.athlete_id, o.occurs_on,
      rollcall_verdict(r.status, r.acknowledged_at, coalesce(o.respond_by_at, o.starts_at),
        rollcall_closes_at(c.type, o.respond_by_at, o.starts_at, o.ends_at), now(),
        r.ack_source, r.sync_review, r.review_resolution) as verdict,
      r.acknowledged_at = min(r.acknowledged_at) over (partition by o.id) as first_up
    from occ o join commitment_responses r on r.instance_id = o.id
  ), per as (
    select athlete_id,
      count(*) filter (where verdict in ('on_standard','late','missed')) as mornings,
      count(*) filter (where verdict = 'on_standard') as on_time,
      count(*) filter (where verdict = 'late') as late,
      count(*) filter (where verdict = 'missed') as missed,
      count(*) filter (where first_up) as first_up,
      count(*) filter (where verdict = 'on_standard' and occurs_on > current_date - (v_days / 2)) as on_time_recent,
      count(*) filter (where verdict in ('on_standard','late','missed') and occurs_on > current_date - (v_days / 2)) as mornings_recent,
      count(*) filter (where verdict = 'on_standard' and occurs_on <= current_date - (v_days / 2)) as on_time_early,
      count(*) filter (where verdict in ('on_standard','late','missed') and occurs_on <= current_date - (v_days / 2)) as mornings_early
    from v group by athlete_id
  )
  select jsonb_build_object(
    'team_on_time_pct', (select round(100.0 * sum(on_time) / nullif(sum(mornings), 0)) from per),
    'athletes', coalesce((select jsonb_agg(jsonb_build_object(
      'athlete_id', per.athlete_id, 'name', p.full_name, 'avatar_path', p.avatar_path,
      'mornings', mornings, 'on_time', on_time, 'late', late, 'missed', missed, 'first_up', first_up,
      'on_time_pct', round(100.0 * on_time / nullif(mornings, 0)),
      'trend', round(100.0 * on_time_recent / nullif(mornings_recent, 0)) - round(100.0 * on_time_early / nullif(mornings_early, 0)),
      'streak', (select count(*) from (
          select verdict, row_number() over (order by occurs_on desc) as rn,
                 sum(case when verdict <> 'on_standard' then 1 else 0 end) over (order by occurs_on desc) as breaks
          from v v2 where v2.athlete_id = per.athlete_id and v2.verdict in ('on_standard','late','missed')) s where s.breaks = 0)
    ) order by round(100.0 * on_time / nullif(mornings, 0)) asc nulls last, p.full_name)
    from per join profiles p on p.id = per.athlete_id), '[]'::jsonb)
  ) into v_out;
  return v_out;
end $$;
```

4. The night ceiling: fetch the live body of `clamp_day_score_to_evidence` (latest in `0234_sleep_standard_ceiling.sql:31`) with `pg_get_functiondef`, paste it, and add `checkin->'arrival'` to the assigned/earned night parts exactly as `wakeup` is read (assigned when `->>'assigned' = 'true'`; earned full when verdict is `on_standard` or `late`, matching today's server rule for the wake-up).

Grants block at the end:

```sql
do $$ declare f text; begin
  foreach f in array array['rollcall_team_board(uuid)','rollcall_history(uuid,int)'] loop
    execute format('revoke all on function %s from public', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
```

- [ ] **Step 4: Run tests**

Run: `npx supabase db reset` (local) then `npm run test:rls`
Expected: the 0242 section passes and no earlier section regresses.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/0242_rollcall_rebuilt.sql supabase/tests/rls_authz_test.sql
git commit -m "feat(rollcall): team board + history RPCs, 10-minute open, arrival in the night ceiling (0242)"
```

---

### Task 3: Migration 0242, part B: arrival checked by distance on the server; places ≥ 100 m

**Files:**
- Modify: `supabase/migrations/0242_rollcall_rebuilt.sql` (append)
- Test: `supabase/tests/rls_authz_test.sql` (0242 section)

**Interfaces:**
- Produces:
  - `verify_arrival_at(p_instance uuid, p_source text, p_lat double precision, p_lng double precision, p_accuracy_m double precision) returns jsonb` → `{ok, within, distance_m}`. `p_source in ('geofence','manual')`. Computes haversine distance to the instance's place; `within = distance_m <= radius_m + least(coalesce(p_accuracy_m,0), 75)`. Calls the existing `verify_arrival(p_instance, p_source, within, reason)` so every existing gate and write stays one code path. Never stores coordinates.
  - `save_commitment_place(p jsonb) returns uuid`: insert/update `commitment_locations` for the caller's team/practice; raises `radius_min` when `radius_m < 100`, `radius_max` when `> 1000`.

- [ ] **Step 1: Failing tests**

```sql
select _superuser();
select _ok(round(_haversine_m(28.60, -81.20, 28.60, -81.20)) = 0, '0242: zero distance');
select _ok(abs(_haversine_m(28.6000, -81.2000, 28.6009, -81.2000) - 100) < 3, '0242: ~100 m north is ~100 m');
select _as('11111111-0000-0000-0000-000000000001');
select _ok(_try($f$ select save_commitment_place('{"name":"Too small","lat":28.6,"lng":-81.2,"radius_m":60}'::jsonb) $f$) like '%radius_min%',
  '0242: new places cannot be smaller than 100 m');
select _ok(_try($f$ select save_commitment_place('{"name":"Weight room","lat":28.6,"lng":-81.2,"radius_m":150}'::jsonb) $f$) = 'ok',
  '0242: staff save a 150 m place');
-- athlete on an instance with that place, standing 400 m away:
select _as('22222222-0000-0000-0000-000000000001');
select _ok((verify_arrival_at((select id from _rc_place_next), 'manual', 28.6036, -81.2, 10)->>'within')::boolean = false,
  '0242: 400 m away is not within a 150 m bubble');
select _ok((verify_arrival_at((select id from _rc_place_next), 'manual', 28.6005, -81.2, 10)->>'within')::boolean = true,
  '0242: 55 m away is within');
```

(Create the `_rc_place_next` fixture in the test's own setup block: a roll call like `_rc_next` whose commitment has `location_id` set to the saved place and `arrive_by_min` set. Follow the 0215 fixture pattern.)

- [ ] **Step 2: Run to verify it fails**: `npm run test:rls` → FAIL (functions missing).

- [ ] **Step 3: Implement** (append to 0242)

```sql
create or replace function _haversine_m(lat1 double precision, lng1 double precision, lat2 double precision, lng2 double precision)
returns double precision language sql immutable as $$
  select 2 * 6371000 * asin(sqrt(
    power(sin(radians(lat2 - lat1) / 2), 2) +
    cos(radians(lat1)) * cos(radians(lat2)) * power(sin(radians(lng2 - lng1) / 2), 2)))
$$;

create or replace function verify_arrival_at(p_instance uuid, p_source text, p_lat double precision,
  p_lng double precision, p_accuracy_m double precision) returns jsonb
language plpgsql security definer set search_path = public as $$
declare loc commitment_locations; v_dist double precision; v_within boolean; v_res jsonb;
begin
  if p_lat is null or p_lng is null or p_lat not between -90 and 90 or p_lng not between -180 and 180 then
    raise exception 'bad_position';
  end if;
  select l.* into loc from commitment_instances i join commitments c on c.id = i.commitment_id
    join commitment_locations l on l.id = c.location_id where i.id = p_instance;
  if not found then raise exception 'no_place'; end if;
  v_dist := _haversine_m(p_lat, p_lng, loc.lat, loc.lng);
  -- A GPS fix is a circle, not a point: forgive up to 75 m of the phone's own stated error.
  v_within := v_dist <= loc.radius_m + least(greatest(coalesce(p_accuracy_m, 0), 0), 75);
  v_res := verify_arrival(p_instance, p_source, v_within,
    case when v_within then null else format('%s m from %s', round(v_dist), loc.name) end);
  return coalesce(v_res, '{}'::jsonb) || jsonb_build_object('within', v_within, 'distance_m', round(v_dist));
end $$;

create or replace function save_commitment_place(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_team uuid := nullif(p->>'team_id','')::uuid; v_practice uuid := nullif(p->>'practice_id','')::uuid;
  v_r int := (p->>'radius_m')::int;
begin
  if v_r is null or v_r < 100 then raise exception 'radius_min'; end if;
  if v_r > 1000 then raise exception 'radius_max'; end if;
  if v_team is null and v_practice is null then
    select team_id into v_team from team_members where user_id = auth.uid() and role in ('coach','owner','staff') limit 1;
  end if;
  if not commitment_owner_is_staff(v_team, v_practice) then raise exception 'not_authorized'; end if;
  if (p->>'id') is not null then
    update commitment_locations set name = left(p->>'name', 60), address = left(p->>'address', 200),
      lat = (p->>'lat')::float8, lng = (p->>'lng')::float8, radius_m = v_r
      where id = (p->>'id')::uuid and (team_id = v_team or practice_id = v_practice) returning id into v_id;
  else
    insert into commitment_locations (team_id, practice_id, name, address, lat, lng, radius_m, created_by)
    values (v_team, v_practice, left(p->>'name', 60), left(p->>'address', 200), (p->>'lat')::float8, (p->>'lng')::float8, v_r, auth.uid())
    returning id into v_id;
  end if;
  return v_id;
end $$;
```

(Verify `team_members` column names/roles before relying on the fallback; if the proto always sends `team_id`/`practice_id`, drop the fallback.) Add both functions to the grants block.

- [ ] **Step 4: Run**: `npx supabase db reset && npm run test:rls` → PASS.
- [ ] **Step 5: Commit**: `git add supabase/migrations/0242_rollcall_rebuilt.sql supabase/tests/rls_authz_test.sql && git commit -m "feat(rollcall): arrival verified by distance on the server; new places at least 100 m"`

---

### Task 4: Window-bound check-in code + Live Activity team content (server)

**Files:**
- Modify: `supabase/functions/_shared/rollcall-code.ts` (+ `rollcall-code.test.ts`)
- Modify: `supabase/functions/_shared/rollcall-live.ts` (+ `rollcall-live.test.ts`)
- Modify: `supabase/functions/roll-call-ack/{index.ts,logic.ts,logic.test.ts}`
- Modify: `supabase/functions/commitment-reminders/{index.ts,logic.ts,logic.test.ts}`
- Modify: `supabase/functions/commitment-escalation/{index.ts,logic.ts,logic.test.ts}`

**Interfaces:**
- Produces:
  - `signWindowCode(secret, {instanceId, athleteId, opensMs, closesMs}) -> string` and `verifyRollCallCode` accepting it: valid when `opensMs - 15min <= now <= closesMs + 10min` regardless of `iatMs`. Kind stays `'athlete'`; add claim `w: 1`.
  - `LiveContentState` gains `teamUp: number`, `teamTotal: number`, `place: number | null`, `points: number | null`.
  - `LiveAttributes` gains `ackCode: string` (the window code) and `ackUrl: string` (`${SUPABASE_URL}/functions/v1/roll-call-ack`).
  - `liveAnsweredUpdate(state)` → an `update` payload (phase `answered`, no dismissal) replacing the old `end` on ack.
  - `teamCountUpdates(instanceId, board)` in `roll-call-ack/logic.ts`: returns the list of `{athleteId, state}` updates to send after a check-in, throttled to one per athlete per 60 s by `rollcall_live_tokens.last_update_at` (add the column in 0242: `alter table rollcall_live_tokens add column if not exists last_update_at timestamptz`).
  - `closingSummary(board) -> {title, body}` in `commitment-escalation/logic.ts`: `"Roll call closed: 10 of 12 on time"` / `"Tyrek was late (6:08). Tommy and Ray missed. Tap to nudge them."`.

- [ ] **Step 1: Failing tests** (Jest `.test.ts` next to each file; import style `from './logic'`)

```ts
// rollcall-code.test.ts
test('a window code verifies anywhere inside the window, days after it was signed', async () => {
  const opensMs = Date.UTC(2026, 8, 25, 10, 50), closesMs = Date.UTC(2026, 8, 25, 11, 30);
  const code = await signWindowCode('s', { instanceId: 'i', athleteId: 'a', opensMs, closesMs });
  const r = await verifyRollCallCode('s', code, 'athlete', { nowMs: Date.UTC(2026, 8, 25, 11, 1) });
  expect(r.ok).toBe(true);
});
test('a window code is refused after the window', async () => {
  const opensMs = Date.UTC(2026, 8, 25, 10, 50), closesMs = Date.UTC(2026, 8, 25, 11, 30);
  const code = await signWindowCode('s', { instanceId: 'i', athleteId: 'a', opensMs, closesMs });
  const r = await verifyRollCallCode('s', code, 'athlete', { nowMs: Date.UTC(2026, 8, 25, 12, 0) });
  expect(r).toEqual({ ok: false, reason: 'expired' });
});

// rollcall-live.test.ts
test('answered is an update that keeps the card, not an end', () => {
  const p = liveAnsweredUpdate({ phase: 'answered', deadlineEpoch: 1, closesEpoch: 2, checkedInEpoch: 1, line: "You're up · 4th", teamUp: 6, teamTotal: 12, place: 4, points: 8 });
  expect(p.aps.event).toBe('update');
  expect(p.aps['dismissal-date']).toBeUndefined();
  expect(p.aps['content-state'].teamUp).toBe(6);
});

// commitment-escalation/logic.test.ts
test('closing summary names the late and the missed', () => {
  const s = closingSummary({ total: 12, rows: [
    ...Array(10).fill({ verdict: 'on_standard', name: 'X' }),
    { verdict: 'late', name: 'Tyrek Malone', acknowledged_at: '2026-09-25T10:08:00Z', late_label: '6:08' },
    { verdict: 'missed', name: 'Tommy Vargas' }, ] });
  expect(s.title).toBe('Roll call closed: 10 of 12 on time');
  expect(s.body).toContain('Tyrek was late (6:08)');
  expect(s.body).toContain('Tommy missed');
});
```

(Match `verifyRollCallCode`'s real signature in `rollcall-code.ts`; if it has no `nowMs` option, add one as an optional last parameter defaulting to `Date.now()` so tests are deterministic.)

- [ ] **Step 2: Run to verify fail**: `npx jest supabase/functions/_shared supabase/functions/roll-call-ack supabase/functions/commitment-escalation supabase/functions/commitment-reminders` → FAIL.

- [ ] **Step 3: Implement**
  - `rollcall-code.ts`: `signWindowCode` signs `{instanceId, subjectId: athleteId, deadlineMs: closesMs, iatMs: opensMs, w: 1}` with kind `athlete`; `verifyRollCallCode` for `w: 1` checks `iatMs - 15*60e3 <= now <= deadlineMs + 10*60e3` and skips the iat-age rule.
  - `rollcall-live.ts`: extend the two types (defaults `teamUp: 0, teamTotal: 0, place: null, points: null` so old callers compile); add `liveAnsweredUpdate`; `liveStartPayload` includes `ackCode` and `ackUrl` in `attributes`.
  - `commitment-reminders`: start the card at open (0242 moved opens to 10 min before; the reminder claim already fires at open for the `initial` phase: verify in `logic.ts` and adjust `phaseFor` if it keys on start). Sign a window code per athlete (`opensMs` = open, `closesMs` = close) and put it in the start attributes.
  - `roll-call-ack`: on success, fetch `rollcall_team_board` via service RPC (add a service-only wrapper `rollcall_team_board_svc(p_instance)` in 0242 that skips the auth check and is granted only to `service_role`), send the athlete `liveAnsweredUpdate` with `place`, `points` (8 × share, from the day's assigned parts; pass `points` from the commitment: 8 when wake-up alone, 4 when it asks arrival too), then `teamCountUpdates` to teammates' `update` tokens.
  - `commitment-escalation`: in the close sweep, after ending cards, build `closingSummary` from `rollcall_team_board_svc` and push to the commitment's creator + team coaches (same recipient query and Expo push shape as the existing digest; category `COACH_DIGEST_CATEGORY`, data `{route: 'rollcall-board/<instance>?focus=missed'}`), once per instance (guard with a `summary_sent_at` column on `commitment_instances`, added in 0242).

- [ ] **Step 4: Run tests**: the Jest command above + `npm run test:fn` → PASS.
- [ ] **Step 5: Commit**: stage the modified function files, tests and 0242; `git commit -m "feat(rollcall): window-bound check-in codes, live team counts on the lock screen, closing summary"`

---

### Task 5: Native iOS: the card shows the team and checks in by itself

**Files:**
- Modify: `modules/rollcall-live/ios/RollCallAttributes.swift` (+ mirror `targets/RollCallWidget/RollCallAttributes.swift`)
- Modify: `modules/rollcall-live/ios/RollCallCheckInIntent.swift` (+ mirror)
- Modify: `modules/rollcall-live/ios/RollCallWidget.swift` (+ mirror)
- Modify: `modules/rollcall-live/ios/RollCallAlarm.swift` (`WakeUpMetadata` carries `ackCode`, `ackUrl`; secondary intent opens the board)
- Modify: `modules/rollcall-live/index.ts`, `src/lib/notify/wakeAlarms.ts` (pass `ackCode`/`ackUrl` when scheduling)
- Test: `src/lib/notify/wakeAlarms.test.ts`, `npm run lint:mirror`

**Interfaces:**
- Consumes: Task 4's attributes `ackCode`, `ackUrl` and content fields `teamUp`, `teamTotal`, `place`, `points`.
- Produces: `RollCallCheckInIntent.perform()` POSTs `{code, tapped_at}` to `ackUrl` (timeout 8 s) and ALSO records to `RollCallPendingStore` (the app drains and de-dupes; the server's first tap stands).

- [ ] **Step 1: Failing test** (`src/lib/notify/wakeAlarms.test.ts`)

```ts
test('scheduling a dated alarm passes the window code so Stop can check in with the app closed', async () => {
  const calls: unknown[] = [];
  mockNative({ scheduleWakeAlarmAt: (...a: unknown[]) => { calls.push(a); } });
  await syncWakeAlarms([{ instanceId: 'i1', hour: 6, minute: 0, at: Date.UTC(2026, 8, 25, 10, 0), title: 'Roll call', buttonLabel: "I'm Up", ackCode: 'c0de', ackUrl: 'https://x/functions/v1/roll-call-ack' }]);
  expect(JSON.stringify(calls)).toContain('c0de');
});
```

(Follow the file's existing mocking helper; rename `mockNative` to whatever it uses.)

- [ ] **Step 2: Run**: `npx jest src/lib/notify/wakeAlarms.test.ts` → FAIL.

- [ ] **Step 3: Implement**
  - `RollCallAttributes.ContentState`: add `var teamUp: Int = 0`, `var teamTotal: Int = 0`, `var place: Int? = nil`, `var points: Int? = nil` (defaults keep old pushes decodable). Static attributes: add `var ackCode: String? = nil`, `var ackUrl: String? = nil`.
  - `RollCallCheckInIntent.perform()`:

```swift
func perform() async throws -> some IntentResult {
  let at = Date()
  RollCallPendingStore.record(instanceId: instanceId, at: at)   // fallback, drained by the app
  if let code = ackCode, let url = URL(string: ackUrl ?? "") {
    var req = URLRequest(url: url, timeoutInterval: 8)
    req.httpMethod = "POST"
    req.setValue("application/json", forHTTPHeaderField: "Content-Type")
    let iso = ISO8601DateFormatter().string(from: at)
    req.httpBody = try? JSONSerialization.data(withJSONObject: ["code": code, "tapped_at": iso])
    _ = try? await URLSession.shared.data(for: req)   // the server's first tap stands; failures fall back to the drain
  }
  return .result()
}
```

  Add `@Parameter var ackCode: String?` and `@Parameter var ackUrl: String?` to the intent; the widget and alarm construct it with the attributes' values.
  - `RollCallWidget` lock screen: under the clock, one row: `"\(teamUp) of \(teamTotal) up"` (hidden when `teamTotal == 0`); answered phase headline `"You're up · \(ordinal(place))"` and line `"+\(points) to today's score"` when present. Keep within the 160 pt height budget; no custom fonts.
  - `RollCallAlarm`: `WakeUpMetadata` gains `ackCode`, `ackUrl`; `stopIntent` = `RollCallCheckInIntent(instanceId:, ackCode:, ackUrl:)`; `RollCallAttackDayIntent` (secondary, `openAppWhenRun = true`) records + posts the same way and the app opens on `#rollcall-board/<instanceId>` (read the drained tap's instance in `ProtoApp.tsx` foreground handler and navigate the WebView).
  - `index.ts` + `wakeAlarms.ts`: thread `ackCode`/`ackUrl` through `scheduleWakeAlarmAt`. The proto gets them from `my_commitments` rows: add `ack_code` to `my_commitments` output in 0242 (signed server-side is impossible in SQL with the edge secret; instead add an edge function route `roll-call-ack?mint=1` that returns window codes for the caller's upcoming instances with a valid JWT, and have `wake-alarms.js` fetch them before `syncWakeAlarms`). Mirror the three Swift files.

- [ ] **Step 4: Run**: `npx jest src/lib/notify src/proto/bridge.test.ts && npm run lint:mirror` → PASS. Native compile is verified in Task 13's build.
- [ ] **Step 5: Commit**: stage the Swift files (both copies), `modules/rollcall-live/index.ts`, `src/lib/notify/wakeAlarms.ts`, the test, and the `roll-call-ack` mint route; `git commit -m "feat(rollcall-native): lock-screen card shows the team and checks in with the app closed"`

---

### Task 6: Restore location (automatic walk-in + "I'm here"), now verified by distance

**Files:**
- Restore: `src/lib/location/index.ts`, `src/lib/location/geofence.ts` via `git show 8e7506bb^:src/lib/location/index.ts > src/lib/location/index.ts` (same for `geofence.ts`), then adapt.
- Modify: `app.json` (expo-location plugin with `locationAlwaysAndWhenInUsePermission` and `locationWhenInUsePermission` strings, `isIosBackgroundLocationEnabled: true`; `UIBackgroundModes: ["location"]`), `package.json` (`expo-location` SDK 57 version via `npx expo install expo-location`)
- Modify: `src/proto/bridge.ts` (+ `bridge.test.ts`): restore `LOCATION_AVAILABLE`, `LOCATION_PERMISSION {background}`, `LOCATION_ARM`, `LOCATION_DISARM`, `LOCATION_CHECK {instanceId}` from `8e7506bb^:src/proto/bridge.ts`
- Modify: `src/proto/ProtoApp.tsx` (register the geofence task at module scope again, as before 8e7506bb)
- Test: `src/lib/location/geofence.test.ts` (restore from `8e7506bb^` if it existed; else write), `app.config.test.ts`

**Interfaces:**
- Consumes: Task 3's `verify_arrival_at`.
- Produces: `reportArrival(instanceId, source, coords)` calls `rpc('verify_arrival_at', {p_instance, p_source, p_lat, p_lng, p_accuracy_m})`; the geofence Enter event takes one `getCurrentPositionAsync({accuracy: Balanced})` and reports it; `checkArrival(instanceId)` (the "I'm here" path) does the same with `source: 'manual'`. `window.OnStandardNative.location.{available, request, arm, disarm, check}` in the proto.

- [ ] **Step 1: Failing tests**

```ts
// src/lib/location/geofence.test.ts
test('an Enter event reports a position, never a bare yes', async () => {
  const rpc = jest.fn().mockResolvedValue({ data: { within: true }, error: null });
  await handleRegionEvent({ eventType: 'enter', region: { identifier: 'inst-1' } }, { rpc, position: async () => ({ coords: { latitude: 28.6, longitude: -81.2, accuracy: 12 } }) });
  expect(rpc).toHaveBeenCalledWith('verify_arrival_at', { p_instance: 'inst-1', p_source: 'geofence', p_lat: 28.6, p_lng: -81.2, p_accuracy_m: 12 });
});
// app.config.test.ts
test('location purpose strings are present and plain', () => {
  const ios = (appJson as any).expo.ios;
  expect(ios.infoPlist.NSLocationAlwaysAndWhenInUseUsageDescription).toMatch(/check you in when you arrive/i);
  expect(ios.infoPlist.UIBackgroundModes).toContain('location');
});
```

(Extract the task body into an exported `handleRegionEvent(event, deps)` so it is testable; the TaskManager task calls it.)

- [ ] **Step 2: Run**: `npx jest src/lib/location app.config.test.ts` → FAIL.
- [ ] **Step 3: Implement**: restore, then replace every `verify_arrival` call with `verify_arrival_at` + coords; purpose strings: When-in-use: "OnStandard checks you in when you arrive where your coach asked you to be. Your location is only checked against that place and is never shared." Always: "So your arrival counts even when the app is closed, OnStandard checks you in when you walk into the place your coach set. It only watches that place during the check-in window, and never shares where you are." Keep `record_departure` on Exit. Restore the 5 bridge messages and the shim namespace.
- [ ] **Step 4: Run**: `npx jest src/lib/location src/proto app.config.test.ts && npm run typecheck` → PASS.
- [ ] **Step 5: Commit**: stage the restored/modified files; `git commit -m "feat(location): restore walk-in check-in, now verified by distance on the server (founder 2026-09-23)"`

---

### Task 7: The coach's map (expo-maps place picker)

**Files:**
- Modify: `package.json` (`npx expo install expo-maps` → 57.0.3)
- Create: `src/lib/maps/placePicker.tsx` (full-screen modal: AppleMaps.View on iOS, GoogleMaps.View on Android; search via `Location.geocodeAsync(query)`; a circle overlay; radius slider 100 to 1000 m in 25 m steps plus a drag handle; name field; Save/Cancel)
- Create: `src/lib/maps/radius.ts` (+ `radius.test.ts`): `clampRadius(m) -> 100..1000 step 25`, `metersLabel(m)`
- Modify: `src/proto/bridge.ts` (+ test): `MAP_PICK {initial?: {lat,lng,radius_m,name}}` → resolves `{lat, lng, radius_m, name, address} | null`
- Modify: `src/proto/ProtoApp.tsx`: render `<PlacePicker>` when a `MAP_PICK` is pending

**Interfaces:**
- Produces: proto calls `window.OnStandardNative.maps.pick(initial)` → `Promise<Place|null>`.

- [ ] **Step 1: Failing test** (`src/lib/maps/radius.test.ts`)

```ts
import { clampRadius, metersLabel } from './radius';
test('the bubble is never smaller than a building or larger than a campus', () => {
  expect(clampRadius(40)).toBe(100);
  expect(clampRadius(137)).toBe(125);
  expect(clampRadius(5000)).toBe(1000);
});
test('labels read like a coach says them', () => {
  expect(metersLabel(150)).toBe('150 m');
  expect(metersLabel(1000)).toBe('1 km');
});
```

- [ ] **Step 2: Run**: `npx jest src/lib/maps` → FAIL.
- [ ] **Step 3: Implement** `radius.ts`:

```ts
export const RADIUS_MIN = 100, RADIUS_MAX = 1000, RADIUS_STEP = 25;
export function clampRadius(m: number): number {
  const v = Math.round((Number.isFinite(m) ? m : RADIUS_MIN) / RADIUS_STEP) * RADIUS_STEP;
  return Math.min(RADIUS_MAX, Math.max(RADIUS_MIN, v));
}
export function metersLabel(m: number): string {
  return m >= 1000 ? `${+(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`;
}
```

Then the picker (read the expo-maps 57 docs at https://docs.expo.dev/versions/v57.0.0/sdk/maps/ for `AppleMaps.View` props: `cameraPosition`, `circles`, `onMapClick`), the bridge message and the shim `maps.pick`.
- [ ] **Step 4: Run**: `npx jest src/lib/maps src/proto && npm run typecheck` → PASS.
- [ ] **Step 5: Commit**: `git commit -m "feat(maps): coach draws the check-in bubble on a real map"` (stage package.json, lockfile, src/lib/maps, bridge, ProtoApp).

---

### Task 8: Proto data layer + pure board model

**Files:**
- Modify: `proto/redesign-2026-07/js/commitment-data.js`
- Create: `proto/redesign-2026-07/js/team-board.js`, `proto/redesign-2026-07/js/team-board.test.mjs`
- Create: `proto/redesign-2026-07/js/location.js`
- Modify: `web/landing-src/lib/sb-stub.mjs` (stubs for `rollcall_team_board`, `rollcall_history`, `verify_arrival_at`, `save_commitment_place`)

**Interfaces:**
- Produces (commitment-data.js): `loadTeamBoard(instanceId, force) -> board|null`, `subscribeTeamBoard(instanceId, onChange) -> unsubscribe` (same `liveWatch` + poll fallback as `subscribeBoard`, 8 s while open), `loadRollcallHistory(commitmentId, days=30)`, `arriveAt(instanceId, source, coords)` → `verify_arrival_at`, `savePlace(place)` → `save_commitment_place`, and the test seam `seedTeamBoardForHarness(instanceId, board)` (same shape as `seedMineForHarness`: writes the per-instance cache `loadTeamBoard` reads).
- Produces (team-board.js): `boardModel(board, selfId, nowISO)` → `{upCount, total, arrivedCount, firstUp:{name,time}|null, me:{place, verdict}|null, groups:{up:[], late:[], waiting:[], missed:[], excused:[]}, closed:boolean, asksArrival}`; `ordinal(n)` ('1st','2nd','3rd','4th'...); `boardHtml(model, {coach:boolean})`.
- Produces (location.js): `locationAvailable()`, `requestLocation(background)`, `imHere(instanceId)` → `{within, distance_m}|{error}`, `pickPlace(initial)`.

- [ ] **Step 1: Failing tests** (`team-board.test.mjs`)

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { boardModel, ordinal } from './team-board.js';

const B = { total: 5, up: 3, closes_at: '2026-09-25T10:30:00Z', asks_arrival: false, rows: [
  { athlete_id: 'd', name: 'DeShawn Cole', acknowledged_at: '2026-09-25T09:52:00Z', verdict: 'on_standard', place: 1 },
  { athlete_id: 'm', name: 'Marcus Reed', acknowledged_at: '2026-09-25T10:01:00Z', verdict: 'on_standard', place: 2 },
  { athlete_id: 't', name: 'Tyrek Malone', acknowledged_at: '2026-09-25T10:08:00Z', verdict: 'late', place: 3 },
  { athlete_id: 'v', name: 'Tommy Vargas', acknowledged_at: null, verdict: 'pending', place: null },
  { athlete_id: 'x', name: 'Ray Gomez', acknowledged_at: null, verdict: 'excused', place: null } ] };

test('groups follow the verdict, in arrival order', () => {
  const m = boardModel(B, 'm', '2026-09-25T10:10:00Z');
  assert.deepEqual(m.groups.up.map((r) => r.athlete_id), ['d', 'm']);
  assert.deepEqual(m.groups.late.map((r) => r.athlete_id), ['t']);
  assert.deepEqual(m.groups.waiting.map((r) => r.athlete_id), ['v']);
  assert.equal(m.firstUp.name, 'DeShawn');
  assert.deepEqual(m.me, { place: 2, verdict: 'on_standard' });
  assert.equal(m.closed, false);
});
test('after close, the not-up are missed', () => {
  const m = boardModel({ ...B, rows: B.rows.map((r) => r.athlete_id === 'v' ? { ...r, verdict: 'missed' } : r) }, 'm', '2026-09-25T10:31:00Z');
  assert.deepEqual(m.groups.missed.map((r) => r.athlete_id), ['v']);
  assert.equal(m.closed, true);
});
test('ordinals', () => {
  assert.deepEqual([1, 2, 3, 4, 11, 12, 13, 21, 22].map(ordinal), ['1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st', '22nd']);
});
test('the markup never contains coordinates and escapes names', async () => {
  const { boardHtml } = await import('./team-board.js');
  const html = boardHtml(boardModel({ ...B, rows: [{ ...B.rows[0], name: '<img onerror=1>' }] }, 'm', '2026-09-25T10:10:00Z'), { coach: false });
  assert.doesNotMatch(html, /<img onerror/);
  assert.doesNotMatch(html, /lat|lng/);
});
```

- [ ] **Step 2: Run**: `node scripts/node-test.mjs "proto/redesign-2026-07/js/team-board.test.mjs"` → FAIL.
- [ ] **Step 3: Implement** `team-board.js`:

```js
import { esc } from './components.js';

export function ordinal(n) {
  const s = ['th', 'st', 'nd', 'rd'], v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}
const first = (name) => String(name || '').trim().split(/\s+/)[0] || '';
const clock = (iso) => (iso ? new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '');

export function boardModel(board, selfId, nowISO) {
  const rows = Array.isArray(board && board.rows) ? board.rows : [];
  const closed = !!(board && board.closes_at && nowISO > board.closes_at);
  const groups = { up: [], late: [], waiting: [], missed: [], excused: [] };
  for (const r of rows) {
    const v = r.verdict;
    if (v === 'on_standard') groups.up.push(r);
    else if (v === 'late') groups.late.push(r);
    else if (v === 'missed') groups.missed.push(r);
    else if (v === 'excused') groups.excused.push(r);
    else groups.waiting.push(r);
  }
  const byTime = (a, b) => String(a.acknowledged_at || '').localeCompare(String(b.acknowledged_at || ''));
  groups.up.sort(byTime); groups.late.sort(byTime);
  const firstRow = rows.filter((r) => r.acknowledged_at).sort(byTime)[0] || null;
  const mine = rows.find((r) => r.athlete_id === selfId) || null;
  return {
    upCount: rows.filter((r) => r.acknowledged_at).length,
    total: rows.filter((r) => r.verdict !== 'excused').length,
    arrivedCount: rows.filter((r) => r.arrived_at).length,
    firstUp: firstRow ? { name: first(firstRow.name), time: clock(firstRow.acknowledged_at) } : null,
    me: mine ? { place: mine.place || null, verdict: mine.verdict } : null,
    groups, closed, asksArrival: !!(board && board.asks_arrival), selfId,
  };
}
```

`boardHtml(model, {coach})` renders: hero (`<span class="rb-n">${upCount}</span> of ${total} up`, Archivo only for the number is NOT allowed: this is not the daily score, use the body face 800), "First up" line, tile grid for `up` (face via `data-avatar-uid` + initials fallback, first name, `ordinal(place) · time`, `.me` on self), then labelled groups Late (amber), Not up yet (neutral), Missed (red, only when `closed`), Excused (muted). With `asksArrival`, each tile adds "here 6:41" / "not here". Coach mode: tiles are `<button data-rb-athlete="id">`. Every name through `esc`. Classes prefixed `rb-` (grep first: `grep -rn "\.rb-" proto/redesign-2026-07/css` must be empty).

`location.js`: thin promise wrappers over `window.OnStandardNative.location.*` and `.maps.pick`, each resolving `null`/`{error:'unavailable'}` when the bridge is absent (browser preview).

- [ ] **Step 4: Run**: `node scripts/node-test.mjs "proto/redesign-2026-07/js/team-board.test.mjs" && npm run lint:undef && npm run lint:xss` → PASS.
- [ ] **Step 5: Commit**: `git commit -m "feat(rollcall): team board model and data layer"` (stage the 4 proto files + sb-stub).

---

### Task 9: The Team Board screen and "Your day" (athlete + coach)

**Files:**
- Create: `proto/redesign-2026-07/js/screens/rollcall-board.js`
- Modify: `proto/redesign-2026-07/js/screens/index.js` (route `'rollcall-board': lazy(() => import('./rollcall-board.js'))`)
- Modify: `proto/redesign-2026-07/css/screens.css` (`rb-*` block)
- Modify: `proto/redesign-2026-07/js/screens/roll-call.js` (a wake-up detail now redirects to `#rollcall-board/<id>`), `js/wake-face.js` (after I'm Up → `#rollcall-board/<id>`), `js/screens/home.js` (the roll-call card opens the board)
- Test: `proto/redesign-2026-07/js/rollcall-board.test.mjs` (DOM-shim render pattern from `rollcall-detail.test.mjs`)

**Interfaces:**
- Consumes: Task 8 (`loadTeamBoard`, `subscribeTeamBoard`, `boardModel`, `boardHtml`, `imHere`), Task 1 (`daySetArrival`), existing `ackCommitment`, `remindMissing`, `pingAthlete`, `setResponse`, exec (`S.exec`) for "what's next".
- Produces: route `rollcall-board/<instanceId>`; `?day` sub-view `rollcall-board/<id>/day` (the swipe target); coach mode when `RT.authRole` is an operator.

- [ ] **Step 1: Failing test** (`rollcall-board.test.mjs`, copy the DOM shim block from `rollcall-detail.test.mjs` verbatim)

```js
test('athlete board: my tile is marked, first up is named, breakfast shows when it closes', async () => {
  const cd = await import('./commitment-data.js');
  cd.seedTeamBoardForHarness('i1', BOARD);            // add this seam in Task 8's commitment-data.js
  const st = await import('./state.js'); st.RT.userId = 'm'; st.RT.authRole = 'athlete';
  const screen = (await import('./screens/rollcall-board.js')).default;
  const html = screen.render({ sub: 'i1' });
  assert.match(html, /First up: DeShawn/);
  assert.match(html, /class="[^"]*rb-tile[^"]*me/);
  const day = screen.render({ sub: 'i1/day' });
  assert.match(day, /Breakfast closes/);
  assert.doesNotMatch(day, /Log breakfast/);
});
test('coach board: faces are buttons and "Nudge everyone not up" exists while open', async () => {
  const st = await import('./state.js'); st.RT.authRole = 'coach';
  const screen = (await import('./screens/rollcall-board.js')).default;
  const html = screen.render({ sub: 'i1' });
  assert.match(html, /data-rb-athlete="v"/);
  assert.match(html, /Nudge everyone not up/);
});
```

- [ ] **Step 2: Run**: `node scripts/node-test.mjs "proto/redesign-2026-07/js/rollcall-board.test.mjs"` → FAIL.
- [ ] **Step 3: Implement** `rollcall-board.js` (default export `{ tab: 'home', hideTabs: false, render({sub}), mount(root, {sub}) }`):
  - header: `backHead('Roll call', '<Today · 6:00 AM · Coach Brooks>', 'home')`
  - athlete, window open and not checked in: a full-width `.btn.primary` "I'm Up" (calls `ackCommitment`, then re-renders; on first success `navigator.vibrate?.(10)`), and, when `asksArrival` and not arrived, "I'm here" (`imHere`) with the result line ("You're 400 m from the weight room" on a miss, via `sayStatus`).
  - `boardHtml(model, {coach})`, subscribe in `mount` via `subscribeTeamBoard`, unsubscribe in `window.__screenCleanup`.
  - "Your day" (`sub` ends with `/day`, reached by a horizontal swipe using `gestures.js` or the "Your day ›" link): coach's message bubble (instance `message`), "+N banked" when the athlete's verdict is on time/late (N from the day's assigned share, 8 or 4), then the day's open items from `S.exec` rendered as rows; the breakfast/meal row's sub reads `Closes ${dueLabel}` and has NO log button (founder change). One footnote: "We'll remind you before breakfast closes." (the reminder is the existing meal reminder; do not add a new one).
  - coach mode: tile → sheet (existing `.sheet` pattern, one overlay guard) with **Nudge** (`pingAthlete`) and **Override** (`setResponse` with a required reason, reuse the reason input from `coach-commitments.js`); while open, a `.action-bar` with **Nudge everyone not up** (`remindMissing`); `?focus=missed` scrolls to the Missed group.
- [ ] **Step 4: Run**: the test above + `node scripts/node-test.mjs "proto/redesign-2026-07/js/**/*.test.mjs"` + the 8 lints → PASS. Render `node scripts/qc-capture.mjs --full --themes dark,light --port 9391 --out rb rollcall-board` (add shots `rollcall-board-athlete`, `rollcall-board-day`, `rollcall-board-coach`, `rollcall-board-closed` to `SHOTS` in `scripts/qc-capture.mjs` using a `pre` that calls `seedTeamBoardForHarness`), look at all four in both themes.
- [ ] **Step 5: Commit**: `git commit -m "feat(rollcall): the live team board and your day, for athletes and coaches"`

---

### Task 10: Coach setup in four answers, place step, arrival-only, week strip

**Files:**
- Create: `proto/redesign-2026-07/js/screens/rollcall-setup.js` (screens `rollcallNew`, `rollcallWeek`, `rollcallHistory` as named exports; default = `rollcallWeek`)
- Modify: `proto/redesign-2026-07/js/screens/index.js` (routes `rollcall-new`, `rollcall-week`, `rollcall-history`)
- Modify: `proto/redesign-2026-07/js/screens/coach-wakeup.js` (keep `wakeupPayload`; export it unchanged for reuse)
- Test: `proto/redesign-2026-07/js/rollcall-setup.test.mjs`

**Interfaces:**
- Consumes: `wakeupPayload(d, owner, kind, tz)` (coach-wakeup.js:132), `saveCommitment`, `setInstanceSchedule`, `notifyScheduleChange`, `loadUpcoming`, `pickPlace`, `savePlace`, `loadRollcallHistory`.
- Produces: `setupPayload(draft, owner, kind, tz)`: `wakeupPayload` + `location_id`, `arrive_by_min`, `arrival_grace_min` (default 10); arrival-only drafts set `escalation.alarm = false` and `starts_min = arrive_by_min`, `title` "At <place>". Validation: at least one day; time set; arrival-only needs a place.

- [ ] **Step 1: Failing tests**

```js
test('four answers make a valid roll call with the defaults behind "Change"', async () => {
  const { setupPayload, blankSetup } = await import('./screens/rollcall-setup.js');
  const d = { ...blankSetup(), starts_min: 360, repeat_days: [1, 2, 3, 4, 5], audience_kind: 'team' };
  const p = setupPayload(d, 'team-1', 'team', 'America/New_York');
  assert.equal(p.type, 'morning_roll_call');
  assert.equal(p.respond_by_min, 365);   // 5-minute grace default
  assert.equal(p.ends_min, 390);         // 30-minute close default
  assert.equal(p.location_id, null);
});
test('adding a place carries arrive-by; arrival-only turns the alarm off', async () => {
  const { setupPayload, blankSetup } = await import('./screens/rollcall-setup.js');
  const p = setupPayload({ ...blankSetup(), mode: 'arrival', location_id: 'loc1', arrive_by_min: 930, repeat_days: [1, 3, 5] }, 'team-1', 'team', 'UTC');
  assert.equal(p.location_id, 'loc1');
  assert.equal(p.arrive_by_min, 930);
  assert.equal(p.escalation.alarm, false);
  assert.equal(p.starts_min, 930);
});
test('the week strip marks moved and cancelled days', async () => {
  const { weekStrip } = await import('./screens/rollcall-setup.js');
  const html = weekStrip([{ occurs_on: '2026-09-23', starts_min: 300, moved: true }, { occurs_on: '2026-09-27', skipped: true }], '2026-09-22');
  assert.match(html, /5:00/);
  assert.match(html, /Off/);
});
```

- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement**
  - `rollcall-new`: four fields (time as the existing time input pattern from coach-wakeup.js, days as `.chip` row, who as `.chip` row with the existing audience picker from `audience.js`, alarm as `std-switch`), a one-line "On standard until 6:05, missed at 6:30. Change" that expands grace/close/message (reuse coach-wakeup's `windowCells`), **"Also check they're at a place"** row → `pickPlace()` → `savePlace()` → shows place name + radius + arrive-by time; a mode toggle "Wake-up / Arrival only / Both" as a segmented control (3 options = segment per DESIGN.md). Primary `.btn.primary` "Start roll call" → `saveCommitment(setupPayload(...))` → `#rollcall-week`.
  - `rollcall-week`: `weekStrip(upcoming, todayISO)` (7 cells, moved days blue-outlined, skipped "Off"); tap → sheet: **Move this morning** (time input → `setInstanceSchedule(id, {startsMin})` + `notifyScheduleChange`), **Cancel this morning** (`{skipped:true}`), **Undo** when changed. Below: today's live board link, "History", "Edit roll call" (opens `rollcall-new` prefilled via `editWakeup(rule)` then mapped into the setup draft).
  - `rollcall-history`: `loadRollcallHistory(id, 30)`; team on-time % hero (body face, not Archivo), "Needs attention" (on_time_pct < 80 or trend < 0) then "Reliable"; rows via existing `sparkline`-like mini line (reuse `components.js sparkline` with per-morning 100/50/0 points), rate coloured by `scoreColor(rate)`, streak and first-up counts.
- [ ] **Step 4: Run** tests + lints + render shots `rollcall-new`, `rollcall-new-place`, `rollcall-week`, `rollcall-history` (add to qc SHOTS with coach seeds) in both themes; look at them.
- [ ] **Step 5: Commit**: `git commit -m "feat(rollcall): 20-second setup, place + arrival, week strip, history"`

---

### Task 11: One way in per role; retire the old surfaces

**Files:**
- Modify: `proto/redesign-2026-07/js/screens/coach-create.js:28-31` (one "Roll call" entry → `rollcall-new`)
- Modify: `proto/redesign-2026-07/js/screens/coach.js:2691` ("Change the roll call" → `rollcall-week`), `js/screens/coach-home.js` (`wakeupHomeCard` opens `rollcall-board/<today>`), `js/screens/coach-commitments.js` (`wakeupBoard` for `morning_roll_call` redirects to `rollcall-board/<id>`; manage screen's roll call button → `rollcall-new`), `js/screens/wakeup-morning.js` (redirect to the board)
- Modify: `proto/redesign-2026-07/js/screens/index.js`: keep `coach-wakeup-new`/`coach-wakeup-edit`/`roll-call`/`wakeup-morning` routes as redirects (deep links in old notifications must still land)
- Test: `proto/redesign-2026-07/js/route-reachability.test.mjs`, `rollcall-composer.test.mjs`, `rollcall-detail.test.mjs` (update pins that asserted old routes, with a comment)

- [ ] **Step 1: Failing test** (append to `route-reachability.test.mjs`)

```js
test('every old roll call entry lands on the rebuilt screens', async () => {
  const idx = await import('./screens/index.js');
  for (const r of ['rollcall-board', 'rollcall-new', 'rollcall-week', 'rollcall-history']) assert.ok(idx.SCREENS[r] || idx.default[r], r);
  const create = readFileSync(join(HERE, 'screens', 'coach-create.js'), 'utf8');
  assert.match(create, /data-go="rollcall-new"/);
  assert.doesNotMatch(create, /coach-wakeup-new/);
});
```

(Use the file's existing way of reading the route table.)
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** the redirects: each old screen's `render` returns `''` and sets `location.hash` to the new route (same pattern as `coachWakeupNew`'s transient redirect at coach-wakeup.js:165).
- [ ] **Step 4: Run** all proto tests + lints; capture `coach-home`, `coach-commitments`, `home-roll-call-late`, `roll-call-open`, `wake-face` and confirm each lands on the new surfaces.
- [ ] **Step 5: Commit**: `git commit -m "refactor(rollcall): one way in per role; old roll call screens redirect to the rebuilt ones"`

---

### Task 12: Harness, device test script, docs

**Files:**
- Modify: `web/landing-src/lib/sb-stub.mjs` (board/history/place fixtures used by the shots above), `scripts/qc-capture.mjs` (the new SHOTS)
- Create: `docs/go-live/ROLLCALL-DEVICE-TEST.md`
- Modify: `DESIGN.md` (amendment: team board, `rb-*`, record numbers not in Archivo), `TASKS.md` (section for this feature)

- [ ] **Step 1**: Write `ROLLCALL-DEVICE-TEST.md`: two phones (coach iPad + athlete iPhone on iOS 26.1+), numbered steps with expected results:
  1. Coach: new roll call for 3 minutes from now, alarm on, place = where you are (150 m), arrive-by = 5 minutes from now.
  2. Athlete: lock the phone. Expect the lock-screen card within 1 minute of the open (10 min lead: set the time 11 minutes ahead instead if testing the lead).
  3. Tap I'm Up on the card with the app closed. Expect the card to read "You're up · 1st", and the coach's board to light the face within 10 s.
  4. Alarm fires at the start: press Stop. Expect no second check-in, card unchanged.
  5. Walk out of the bubble and back in (or toggle airplane mode off near the place): expect "here" on the coach's board.
  6. Decline "Always": use "I'm here" inside and outside the bubble; expect within / "N m from <place>".
  7. Wait past close: expect the coach's summary push naming the missed.
  8. Open History: expect today's morning counted.
- [ ] **Step 2**: Run `npm run verify` → 18/18. Capture all roll call shots dark + light at 390 and 820 (`--full`), diff `report.json` defects against `qc/base` (no new TAP/CLIP/CONTRAST/ERR/OVERFLOW), look at every screen.
- [ ] **Step 3: Commit**: `git commit -m "docs(rollcall): device test script, harness shots, design amendment"`

---

### Task 13: Ship (lead only, founder-authorized)

- [ ] Apply 0242 to prod: `npx supabase db push` (read the migration list first; verify with single-line `npx supabase db query --linked "select proname from pg_proc where proname in ('rollcall_team_board','rollcall_history','verify_arrival_at','save_commitment_place','_haversine_m')"`).
- [ ] Deploy functions: `npx supabase functions deploy roll-call-ack commitment-reminders commitment-escalation` and read each tail; smoke-test with the anon key expecting each function's own 4xx.
- [ ] `npm run check:review` (env gate 5/5 must hold).
- [ ] `node scripts/build-proto-zip.mjs`, content-verify, commit, push.
- [ ] Native build: `npx eas-cli@latest build --platform ios --profile production` then `eas submit --latest` (the preflight refuses untracked files; build from a clean tree). Attach the build to version 1.0 in App Store Connect only after the device test passes.
- [ ] OTA for the proto: `npx eas-cli@latest update --branch production --environment production --message "..."`; verify both live manifests carry the zip md5.
- [ ] Run `docs/go-live/ROLLCALL-DEVICE-TEST.md` with the founder on TestFlight.
