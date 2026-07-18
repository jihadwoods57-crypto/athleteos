# Coach OS Slice E — Insights v1 + Grouped Coach Notifications — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship Slice E of the Coach OS spec (docs/superpowers/specs/2026-07-16-coach-os-design.md §Slice E): the Insights tab's "This week" slot filled with deterministic plain-language trends (what changed, athletes to watch, most-missed requirement, weekly-vs-monthly, honest-thin intervention outcomes) backed by two new team-scoped SQL RPCs; and grouped coach notifications from a new pure planner `js/coach-notify-plan.js` (morning briefing · evening recap · hourly summary · immediate critical · quiet hours · my-room-only), delivered over the existing local-notification bridge.

**Architecture:** All UI in the shipped proto WebView (`proto/redesign-2026-07/` — NOT `src/screens`). **Insights**: migration `0076` adds two `security definer` RPCs modeled byte-for-byte on `team_roster` (0040: `is_team_staff(team)` gate, `returns table`, grant to authenticated + revoke from public/anon) — `team_day_rollup` (athlete-day grain over a caller-supplied window) and `team_intervention_outcomes` (per-intervention before/after score windows). A NEW pure engine `js/insights.js` (no clock, no DOM, no fetch — the status.js discipline) turns rollup rows + the client's already-resolved requirement sets into deterministic sentences and lists; the screen stays a thin render over it. **Timezone rule:** the RPCs take `p_today date` from the CALLER (coach-device-local) and bucket on the stored athlete-local `days.date`/`meals.day_date` values — never server `current_date` (the 0037 pattern's skew, flagged since Slice A). Boundary athletes may shift ±1 day across timezones; copy stays week-granular so this is honest. **Check-in visibility:** the rollup derives check-in completion from BOTH `days.checkin->>'submitted'` (proto writes here) AND the `checkins` table (RN writes here) — closing the phantom-Sunday data gap server-side. **Notifications**: a NEW pure planner `js/coach-notify-plan.js` (sibling of `notify-plan.js`; REUSES its exported `inQuiet`/`normalizePrefs`) plans grouped alert slots from the `entriesFor(scope)` snapshot + coach prefs, and `state.js syncNotifications()` gains a coach branch: when `RT.authRole === 'coach'`, the coach plan REPLACES the athlete-derived plan in the single `window.OnStandardNative.notify.sync([...])` post (cancel-all semantics — one array per device; this also FIXES the latent bug where a coach's device schedules generic athlete meal reminders from the default catalog). Coach prefs live in `RT.coachNotifPrefs` (localStorage via RT/save, wiped on account switch like everything else); a coach notifications screen hangs off coach-profile.

**Tech Stack:** Vanilla-JS ES modules (proto WebView), Supabase (Postgres RPCs, migration 0076), Jest 30 (TS tests in `src/core/` importing proto JS via `// @ts-ignore`), `npm run verify` gate.

## Global Constraints

- **Branch:** worktree branch off `compliance-fixes` (NOT master). One migration: `supabase/migrations/0076_coach_os_slice_e.sql`. Forward-only, idempotent (0055 idiom). Applied to live by the ORCHESTRATOR after review + the RLS gate (disposable project, direct session-mode connection — NOT `db query --linked` for catalog-sensitive checks); task subagents never touch live.
- **RPC security:** `language plpgsql stable security definer set search_path = public`; FIRST statement `if not is_team_staff(p_team) then raise exception 'not authorized for this team'; end if;`; `grant execute ... to authenticated; revoke all on function ... from public, anon;` — the 0040 `team_roster` model exactly.
- **Timezone rule (binding):** no `current_date`/`now()` date-bucketing in the new RPCs — every window boundary derives from the `p_today date` parameter. Client passes `todayISO()` (roles.js:10). Document the ±1-day athlete-local skew in the migration header, don't hide it.
- **Pure engines take time/data from callers.** No `Date.now()`/`new Date()` inside `js/insights.js` or `js/coach-notify-plan.js` (except `new Date(isoString)` parsing of row timestamps). JSDoc-typed defaults on optional params (Jest allowJs).
- **Deterministic honesty.** Every Insights sentence and notification body is computed from real rows by plain code — no AI, no invented numbers, no scoring formulas in copy. Intervention outcomes UNLOCK only at ≥14 days of intervention history (count of distinct `day`s since first intervention); honest empty state before that ("Intervention tracking started <date> — outcomes unlock after two weeks of history.").
- **Planner invariants (from notify-plan.js, binding):** never plan a slot for excused athletes (`status.key === 'excused'`) or completed requirements (`on_standard` rows / done items); quiet hours via the SHARED `inQuiet` (import it from `./notify-plan.js` — do not fork it); nothing breaks quiet hours except (optionally) immediate-critical when the coach pref allows; plan items use the EXACT native shape `{id, fireAtMin, dayOffset, immediate, stage, route, title, body}` (state.js:614-621 converts to `{id, atISO, title, body, route}`); dedupe/idempotence rides the existing `RT._lastPlan` `samePlan()` mechanism.
- **One sync array per device.** Never add a second `notify.sync` call — the seam is inside `syncNotifications()` (state.js:598), coach branch replaces the athlete plan. `_wipeUserScopedState`'s empty-plan post (state.js:1073-1075) must keep covering coaches unchanged.
- **XSS:** every athlete name/requirement title rendered into Insights HTML goes through `esc()` (lint:xss gate). Notification title/body strings go to the native layer, not HTML — no esc there, but no user-controlled markup either.
- **Dark tokens, existing classes** (`.card`, `.lrow`, `.eyebrow`, `.co-seg`/`.co-chip`, `avatarHead`, the coach-insights standing-bar motif). Blue→teal score-only, green status-only.
- **After any proto change** in a task: run the affected Jest suites. `node scripts/build-proto-zip.mjs` + full `npm run verify` once at the end (Task 7).
- **Commits:** small, per task, `feat(coach-os): …` / `test(coach-os): …`.

## Deliberate deferrals (do NOT build these)

- **Server-push delivery of coach summaries** (hourly cron edge fn riding the 0044 pg_cron mechanism, immediate-critical server push): v1 is client-planned local notifications, honest about snapshot staleness. The pg_cron seam is documented for a later slice.
- **A coach bell/in-app notifications feed** (`avatarHead` has no bell; the athlete `#notifications` screen isn't coach-linked): grouped alerts already land as Inbox rows (Slice D); local notifications cover delivery. A coach bell is a ticket, not Slice E.
- **Per-athlete timezone normalization** (no `profiles.timezone` column exists): the ±1-day boundary skew is documented, not solved.
- **Coach prefs server persistence** beyond the existing `profiles.notifications_opt_out` (0067): `RT.coachNotifPrefs` is device-local like `RT.notifPrefs`.
- **Wiring check-in done-ness into the live coach STATUS engine** (the runsOn Sunday mitigation stays as-is): Slice E gives check-in compliance to INSIGHTS via the rollup; touching status.js precedence is out of scope.
- **AI narration over the brief** (`assist` daily_brief task exists): spec says plain-language deterministic sentences; AI narration is a later garnish.

## Known landmines (carry into implementation)

- `interventions.day` is COACH-device-local (client overrides the UTC default — roles.js:469); `days.date` is ATHLETE-device-local. The outcomes RPC joins across two local calendars — use a ±1-day-tolerant window (the before/after windows are 7 days; a 1-day edge blur is acceptable and documented).
- `fetchLinkedDaysSince` selects only `athlete_id,date,score,grade,tasks` and 7 days — do NOT widen it (the roster path stays cheap); Insights gets its own RPC-backed fetch.
- The coach device currently schedules ATHLETE reminders (syncNotifications is role-agnostic, S.exec derives from the default catalog for a coach's empty day) — the coach branch in Task 5 must fully replace that plan for coaches, and the tomorrow pre-schedule block must also be skipped/replaced for coaches.
- `entriesFor` returns `null` while loading — the planner/screen must tolerate it.

---

### Task 1: Migration 0076 — `team_day_rollup` + `team_intervention_outcomes` RPCs + RLS probes

**Files:**
- Create: `supabase/migrations/0076_coach_os_slice_e.sql`
- Modify: `supabase/tests/rls_authz_test.sql` (append probes BEFORE section 8 — the revocation section; the Slice C lesson)

**Interfaces:**
- Consumes: `is_team_staff(uuid)` (0002:44), tables `days` (0001:136), `meals` (0001:156), `checkins` (0001:174), `coach_interventions` (0071), `team_members` (0001:80).
- Produces:
  - `team_day_rollup(p_team uuid, p_from date, p_to date)` returns table `(athlete_id uuid, day date, "position" text, score int, meals_logged int, tasks_done text[], checkin_done boolean, weight_logged boolean)` — one row per active team member per day IN THE WINDOW WHERE ANY DATA EXISTS (no generate_series padding; the client engine pads).
  - `team_intervention_outcomes(p_team uuid, p_from date)` returns table `(intervention_id uuid, athlete_id uuid, kind text, tier text, day date, score_before numeric, score_after numeric, days_before int, days_after int)` — per intervention since p_from: avg score over `[day-7, day-1]` and `[day+1, day+7]` with the count of days present in each window (client judges significance; NULL avg when a window is empty).

- [ ] **Step 1: Write the migration.** Header comment: purpose, the 0040 security model, and the timezone rule verbatim ("window boundaries come from p_from/p_to (caller-local); days.date/meals.day_date are athlete-device-local dates; interventions.day is coach-device-local — a documented ±1-day cross-timezone blur, acceptable at week granularity"). Body:

```sql
create or replace function team_day_rollup(p_team uuid, p_from date, p_to date)
returns table (
  athlete_id uuid, day date, "position" text, score int,
  meals_logged int, tasks_done text[], checkin_done boolean, weight_logged boolean
)
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_team_staff(p_team) then
    raise exception 'not authorized for this team';
  end if;
  if p_to < p_from or p_to - p_from > 62 then
    raise exception 'window must be 0-62 days';
  end if;
  return query
  select
    d.athlete_id,
    d.date as day,
    tm.position,
    d.score,
    coalesce((select count(*)::int from meals m
              where m.athlete_id = d.athlete_id and m.day_date = d.date), 0) as meals_logged,
    coalesce((select array_agg(t->>'id') from jsonb_array_elements(d.tasks) t
              where (t->>'done')::boolean), '{}') as tasks_done,
    (coalesce(d.checkin->>'submitted','') <> ''
      or exists (select 1 from checkins c
                 where c.athlete_id = d.athlete_id
                   and c.submitted_at::date between d.date - 6 and d.date)) as checkin_done,
    (d.current_weight is not null) as weight_logged
  from days d
  join team_members tm on tm.team_id = p_team and tm.athlete_id = d.athlete_id and tm.status = 'active'
  where d.date between p_from and p_to;
end $$;
revoke all on function team_day_rollup(uuid, date, date) from public, anon;
grant execute on function team_day_rollup(uuid, date, date) to authenticated;

create or replace function team_intervention_outcomes(p_team uuid, p_from date)
returns table (
  intervention_id uuid, athlete_id uuid, kind text, tier text, day date,
  score_before numeric, score_after numeric, days_before int, days_after int
)
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_team_staff(p_team) then
    raise exception 'not authorized for this team';
  end if;
  return query
  select
    ci.id, ci.athlete_id, ci.kind, ci.tier, ci.day,
    (select avg(d.score) from days d where d.athlete_id = ci.athlete_id
      and d.date between ci.day - 7 and ci.day - 1 and d.score is not null),
    (select avg(d.score) from days d where d.athlete_id = ci.athlete_id
      and d.date between ci.day + 1 and ci.day + 7 and d.score is not null),
    (select count(*)::int from days d where d.athlete_id = ci.athlete_id
      and d.date between ci.day - 7 and ci.day - 1 and d.score is not null),
    (select count(*)::int from days d where d.athlete_id = ci.athlete_id
      and d.date between ci.day + 1 and ci.day + 7 and d.score is not null)
  from coach_interventions ci
  where ci.team_id = p_team and ci.day >= p_from;
end $$;
revoke all on function team_intervention_outcomes(uuid, date) from public, anon;
grant execute on function team_intervention_outcomes(uuid, date) to authenticated;
```

Verify column/type facts against the live migrations before finalizing (days.tasks jsonb array of `{id,done}`; checkins has `submitted_at timestamptz` + `week text` — the `submitted_at::date between d.date-6 and d.date` window approximates "this week" without parsing the week text format; `coach_interventions.day` is `date`). If `checkins.week` has a parseable canonical format (check how `src/lib/supabase/queries.ts` builds it), prefer matching on it and note the choice.

- [ ] **Step 2: Append RLS probes** to `supabase/tests/rls_authz_test.sql` (match its actor/section structure; INSERT BEFORE section 8):
1. coach_1 can call `team_day_rollup(T1, ...)` and gets rows for T1 athletes only.
2. coach_2 (other team) calling `team_day_rollup(T1, ...)` raises 'not authorized'.
3. athlete A calling it raises (athletes are not team_staff).
4. Window guard: a >62-day window raises.
5. Same authorized/unauthorized pair for `team_intervention_outcomes`.
6. Rollup checkin_done true when the seeded day has `checkin->>'submitted'` set (seed one such day as superuser).

- [ ] **Step 3:** State plainly in the report that the probes were NOT executed locally (no local DB) — the orchestrator runs the gate. Do NOT apply anything to live.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/0076_coach_os_slice_e.sql supabase/tests/rls_authz_test.sql
git commit -m "feat(coach-os): 0076 — team_day_rollup + team_intervention_outcomes RPCs (caller-local windows, is_team_staff gated)"
```

---

### Task 2: roles.js fetchers + pure `js/insights.js` engine

**Files:**
- Create: `proto/redesign-2026-07/js/insights.js`
- Modify: `proto/redesign-2026-07/js/roles.js` (two RPC wrappers)
- Test: `src/core/insights.test.ts` (new)

**Interfaces:**
- Consumes: rollup rows `{athlete_id, day, position, score, meals_logged, tasks_done, checkin_done, weight_logged}`; outcome rows `{intervention_id, athlete_id, kind, tier, day, score_before, score_after, days_before, days_after}`; roster rows `{athleteId, name, position}`; resolved requirement items per athlete (the client already resolves sets via `resolveRequirementSet`/`catalogFromItems` — the engine receives a `reqsByAthlete` map `{athleteId: [{id,title,kind,required,freq}]}`); `todayISO` string; `nowMs`.
- Produces (all pure, exported from `js/insights.js`):
  - `weekWindows(todayISO)` → `{ thisFrom, thisTo, prevFrom, prevTo, monthFrom }` (ISO strings; this week = last 7 days ending today; prev = the 7 before; month = last 28).
  - `weeklyBrief({rollup, roster, todayISO})` → `{ lines: [{text, dir: 'up'|'down'|'flat'}], byRoom: [{room, completionDelta, text}] }` — completion % (meals_logged vs a simple per-day denominator from reqsByAthlete meal count when provided, else logged-any), average score delta, check-in compliance delta; by-room lines only for rooms with ≥2 athletes and a nonzero delta ("Meal completion improved 12%, but lunch compliance declined in the LB room" style — real numbers only).
  - `athletesToWatch({rollup, roster, todayISO})` → `{ decliners: [{athleteId, name, slope, text}], disengaging: [{athleteId, name, gapDays, text}], recoverers: [] }` — decliners = worst 7-day score slopes (≥3 scored days required); disengaging = largest no-data gaps ending today (≥3 days); recoverers filled by outcomes below.
  - `mostMissed({rollup, reqsByAthlete, todayISO})` → `[{reqId, title, missedCount, text}]` — per required daily item: days in window where the athlete had ANY data but the req id is absent from tasks_done (meal reqs may map to meals_logged count when tasks lack meal ids — state the rule in a comment and keep it deterministic).
  - `weekVsMonth({rollup, todayISO})` → `{ weekAvg, monthAvg, text }`.
  - `interventionOutcomes({outcomes, roster, todayISO})` → `{ unlocked: boolean, sinceISO, text?, byKind?: [{kind, n, avgLift}], recoverers: [{athleteId, name, lift}] }` — unlocked only when the span from earliest `day` to todayISO ≥ 14 days AND ≥5 outcomes with both windows non-empty (`days_before>0 && days_after>0`); recoverers = athletes with avgLift ≥ +5.
  - Every `text` is a complete deterministic sentence; percentages rounded to whole numbers; no sentence emitted when the underlying n is 0 (silence over noise).
- roles.js wrappers (follow the rpc idiom, best-effort `[]`):

```js
export async function fetchTeamDayRollup(teamId, fromISO, toISO) {
  const c = sb(); if (!c || !teamId) return [];
  try {
    const { data, error } = await c.rpc('team_day_rollup', { p_team: teamId, p_from: fromISO, p_to: toISO });
    return error ? [] : (data || []);
  } catch { return []; }
}
export async function fetchInterventionOutcomes(teamId, fromISO) {
  const c = sb(); if (!c || !teamId) return [];
  try {
    const { data, error } = await c.rpc('team_intervention_outcomes', { p_team: teamId, p_from: fromISO });
    return error ? [] : (data || []);
  } catch { return []; }
}
```

- [ ] **Step 1: Write the failing tests** — fixture-driven, in the coachStatus.test.ts style. Cover at minimum: weekWindows boundaries; weeklyBrief computes a completion delta from two weeks of rollup rows and emits a by-room line only where the room qualifies; a decliner with a clean negative slope is found and a 2-scored-day athlete is NOT; disengaging gap counting; mostMissed counts absent req ids only on days with data; weekVsMonth averages; interventionOutcomes stays LOCKED under 14 days or <5 qualifying outcomes and unlocks with correct avgLift; empty inputs → empty outputs, never throws; determinism (same input twice → deep-equal output).
- [ ] **Step 2: Run — FAIL** (module missing). **Step 3: Implement** `js/insights.js` (pure; header comment naming the athlete-local-date blur and the silence-over-noise rule) + the two roles wrappers.
- [ ] **Step 4:** `npx jest src/core/insights.test.ts` green; full `npx jest src/core` green. **Step 5: Commit**

```bash
git add proto/redesign-2026-07/js/insights.js proto/redesign-2026-07/js/roles.js src/core/insights.test.ts
git commit -m "feat(coach-os): pure insights engine — weekly brief, watch lists, most-missed, outcomes (deterministic)"
```

---

### Task 3: Insights screen — fill the "This week" slot

**Files:**
- Modify: `proto/redesign-2026-07/js/screens/coach-insights.js`
- Modify: `proto/redesign-2026-07/js/coach-data.js` OR a module cache in the screen (match the ANN_CACHE/loadInboxData idiom) for the rollup/outcomes fetch

**Interfaces:**
- Consumes: `insights.js` engine (Task 2), `fetchTeamDayRollup`/`fetchInterventionOutcomes`, `CD`/`entriesFor`/`getScope`, `resolveRequirementSet`/`catalogFromItems` (for `reqsByAthlete`), `todayISO` (roles.js), `esc`, the existing standing-bar + today lines (KEEP them — the screen gains sections, loses nothing).
- Produces: a rebuilt lower half: **This week** (brief lines + by-room), **Athletes to watch** (three compact lists; tapping a name → `coach-athlete/<id>`), **Most missed**, **Week vs month**, **Are interventions working?** (locked/unlocked honest states). A scope note: sections compute over the coach's CURRENT scope (`getScope()`), reusing `scopeFilter` semantics by filtering rollup rows to the scoped athlete ids client-side; the header states the scope ("Entire team" / "LB room").

- [ ] **Step 1: Loader.** Module cache `INSIGHTS_DATA {teamId, rollup, outcomes}` + `loadInsights(teamId, force)`: `weekWindows(todayISO())` → fetch rollup for `monthFrom..today` (one fetch covers week+prev+month) + outcomes for `today-56d`; re-render guarded to `#coach-insights`. Called from `mount` after `loadCoachRoster()`.
- [ ] **Step 2: Render.** Sections from the engine outputs; every dynamic string through `esc()`; skeleton while `entriesFor`/cache null; honest empty states per section (a new team sees "Trends unlock as history builds" — the EXISTING copy — until the rollup has ≥2 days of data). Names tappable (`data-go="coach-athlete/<esc id>"`).
- [ ] **Step 3:** No unit test for the screen (established rule) — the engine is tested; smoke covers the render. Full `npx jest src/core` green; `npm run lint:xss` clean.
- [ ] **Step 4: Commit**

```bash
git add proto/redesign-2026-07/js/screens/coach-insights.js proto/redesign-2026-07/js/coach-data.js
git commit -m "feat(coach-os): Insights v1 — weekly brief, watch lists, most-missed, outcomes on real RPC data"
```

---

### Task 4: Pure `js/coach-notify-plan.js` planner

**Files:**
- Create: `proto/redesign-2026-07/js/coach-notify-plan.js`
- Test: `src/core/coachNotifyPlan.test.ts` (new)

**Interfaces:**
- Consumes: `entries` = `[{row: {athleteId, name}, status: {key, openItems: [{id, title, dueMin, state}]}}]` (the `entriesFor(scope)` shape); `interventions` = today's `[{athlete_id, kind, reason_key}]`; prefs (below); `nowMin`, `dateISO`; `lastAlertKeys` = string[] (signatures present at the previous sync).
- Produces:
  - `DEFAULT_COACH_NOTIF_PREFS = { enabled: true, briefing: true, briefingAt: 7*60+30, recap: true, recapAt: 20*60+30, hourly: false, immediateCritical: true, allowCriticalInQuiet: true, quietFrom: 22*60, quietTo: 7*60, myRoomOnly: false }` (myRoomOnly is CONSUMED by the caller choosing which scope's entries to pass — the planner itself is scope-agnostic; the field lives here so prefs round-trip as one object).
  - `normalizeCoachPrefs(p)` (defaults-merging, like `normalizePrefs`).
  - `alertKeys(entries)` → sorted string[] of grouped-alert signatures (e.g. `overdue:lunch:3`) — the caller persists these to detect NEW criticals between syncs.
  - `planCoachNotifications({ nowMin, dateISO, entries, interventions, prefs, lastAlertKeys })` → plan items in the EXACT notify-plan native shape `{id, fireAtMin, dayOffset, immediate, stage, route, title, body}`. Rules:
    - Filter out entries with `status.key === 'excused'` or `'on_standard'`; drop athletes with a today-intervention matching the same reason (the priority.js dedupe idea — an athlete the coach already nudged/handled today doesn't re-alert).
    - **Grouped window alerts**: group remaining overdue `openItems` by item id → for each group with n≥1, one slot at `max(nowMin+15, latest dueMin+30)` — title `"${n} athlete${n===1?'':'s'} missed ${title}"` (n===1 uses the athlete's name: `"Devin missed Lunch"`), body listing up to 3 first names + "and N more", route `coach-inbox`, stage `due`.
    - **Morning briefing** (pref `briefing`, at `briefingAt`, only if `briefingAt > nowMin`): title `"Morning read"`, body from the snapshot: `"${overdueN} overdue from yesterday · ${dueTodayN} due today. Open for the latest."` — the "Open for the latest" suffix is the honesty marker for snapshot staleness. Route `coach-home`. Stage `open`.
    - **Evening recap** (pref `recap`, at `recapAt`, only if future): `"Evening recap"` / `"${onN} finished on standard · ${openN} still open."` Route `coach-insights`. Stage `open`.
    - **Hourly summary** (pref `hourly`): at most the next 3 hourly marks (`nowMin` rounded up to :00) while there are unhandled overdue items — each `"${totalOverdue} requirement${s} overdue across ${athleteN} athletes"`, route `coach-inbox`, stage `soon`. (Every app open re-plans, so staleness self-corrects; cap 3 keeps a dead phone from stacking spam.)
    - **Immediate critical** (pref `immediateCritical`): if `alertKeys(entries)` contains a key NOT in `lastAlertKeys` whose group is `overdue` with n≥2, emit ONE `immediate: true` item summarizing the new critical group. Never more than one immediate per plan.
    - **Quiet hours**: import `inQuiet` from `./notify-plan.js`. Non-immediate slots falling in quiet hours SHIFT to `quietTo` (morning edge) if that's still before the slot's relevance expires (briefing/recap/hourly shift; window alerts shift only if `quietTo` is within 3h of the original slot, else drop). Immediate-critical fires regardless ONLY when `prefs.allowCriticalInQuiet !== false` — default true via DEFAULT prefs; otherwise it becomes a normal slot at `quietTo`.
    - `enabled: false` → `[]` always. Cap: max 8 items/plan, priority immediate > due > soon > open, earliest-first within rank (mirror notify-plan's cap idiom).
    - IDs deterministic: `cn-<stage>-<key>` so `samePlan()` dedupe works.
- [ ] **Step 1: Write the failing tests** (notifyPlan.test.ts style — fixtures + describe blocks): excused/on_standard filtered; intervention-dedupe; grouping counts + n===1 name form; briefing/recap only when future + honest suffix; hourly capped at 3 and absent when no overdue; immediate only on a NEW key vs lastAlertKeys and only one; quiet-hour shifts (briefing inside quiet → quietTo) and window-alert drop-vs-shift; enabled:false → []; cap at 8 with rank order; determinism; the exact native shape (every item has the 8 fields, fireAtMin 0-1439 or immediate).
- [ ] **Step 2: FAIL → implement → GREEN.** Full `npx jest src/core` green. **Step 3: Commit**

```bash
git add proto/redesign-2026-07/js/coach-notify-plan.js src/core/coachNotifyPlan.test.ts
git commit -m "feat(coach-os): coach-notify-plan — pure grouped-alert planner (briefing/recap/hourly/immediate, quiet hours)"
```

---

### Task 5: Wire the coach plan into `syncNotifications` + prefs plumbing

**Files:**
- Modify: `proto/redesign-2026-07/js/state.js` (`syncNotifications` coach branch, `RT.coachNotifPrefs` in DEFAULT_RT, `setCoachNotifPrefs` action, `_lastCoachAlertKeys`)
- Test: `src/core/coachNotifySync.test.ts` (new — the sync-branch logic, with the same JSDOM/lazy-require pattern used by existing state.js-touching tests; if state.js proves untestable this way, test the extracted pure helper instead and say so)

**Interfaces:**
- Consumes: `planCoachNotifications`/`alertKeys`/`normalizeCoachPrefs`/`DEFAULT_COACH_NOTIF_PREFS` (Task 4); `entriesFor`/`getScope` (coach-data.js); `CD.extras.interventions`; the existing sync mechanics (`RT._lastPlan`, `samePlan`, the `N.notify.sync` post at state.js:614).
- Produces:
  - `RT.coachNotifPrefs: null` in DEFAULT_RT (normalized on read); `RT._lastCoachAlertKeys: []`.
  - `act.setCoachNotifPrefs(patch)` — merge + `save()` + re-sync (mirror `setNotifPrefs` at state.js:638; also mirror `enabled` to `profiles.notifications_opt_out` — same column, one opt-out per user).
  - In `syncNotifications()`: when `RT.authRole === 'coach'` (or `'trainer'`? NO — coach only; trainers keep current behavior), REPLACE the athlete-derived plan AND skip the tomorrow athlete pre-schedule: build `entries = entriesFor(prefs.myRoomOnly ? getScope() : {kind:'team', value:null})` (tolerate null → post `[]` and return, leaving `_lastPlan` unset so the next trigger retries), `plan = planCoachNotifications({nowMin, dateISO: todayISO, entries, interventions: CD.extras?.interventions || [], prefs, lastAlertKeys: RT._lastCoachAlertKeys || []})`, then update `RT._lastCoachAlertKeys = alertKeys(entries)`, and post through the SAME `N.notify.sync(...)` conversion block (absolute times from today's date + fireAtMin/dayOffset). A coach tomorrow-preview: plan tomorrow's briefing slot only (`dayOffset: 1` briefing item) — nothing else is knowable.
  - `myRoomOnly` semantics: `true` → the coach's saved scope (`getScope()`, which defaults to their position room per coach-data.js:104-108); `false` → whole team.
- [ ] **Step 1:** Read `syncNotifications` + `hydrateDay` + `_wipeUserScopedState` fully; place the coach branch so the wipe path and the `_lastPlan` dedupe still work identically. Coach-data must be loaded for entries — if `CD` is empty at first sync, post nothing and rely on the next trigger (loadCoachRoster completion should trigger a sync — add a `syncNotifications()` call at the end of `loadCoachRoster`'s success path in coach-data.js IF no existing trigger covers a coach's data-arrival; check first).
- [ ] **Step 2:** Tests: coach role produces coach-plan items (no athlete meal reminders); athlete role unchanged (regression-pin an athlete-shaped sync still emits the athlete plan); entries-null → empty post + retry-able; alert-keys persistence drives the immediate-critical diff across two syncs.
- [ ] **Step 3:** Full `npx jest src/core` green (the exec/notify existing suites must not regress). **Step 4: Commit**

```bash
git add proto/redesign-2026-07/js/state.js proto/redesign-2026-07/js/coach-data.js src/core/coachNotifySync.test.ts
git commit -m "feat(coach-os): coach devices schedule the coach plan, not athlete reminders — synced over the same bridge"
```

---

### Task 6: Coach notifications settings UI

**Files:**
- Modify: `proto/redesign-2026-07/js/screens/settings.js` (new export `coachNotifSettings`) OR a new small screen file — match whichever the file's size/idiom suggests; register in `screens/index.js` as `'coach-notif-settings'`
- Modify: `proto/redesign-2026-07/js/screens/roles.js` (coachProfile settings section: add the row)

**Interfaces:**
- Consumes: `RT.coachNotifPrefs` via `normalizeCoachPrefs`, `act.setCoachNotifPrefs`, the `seg()` toggle idiom from `notifSettings` (settings.js:384-397), `backHead`.
- Produces: `#coach-notif-settings` — rows: Master (On/Off, mirrors opt-out), Morning briefing (Off/7:00/7:30/8:00), Evening recap (Off/8:00/8:30/9:00 PM), Hourly summary (On/Off), Immediate critical (On/Off), Quiet hours (9 PM/10 PM/11 PM start — reuse the athlete quiet chips), My room only (On/Off; sub-copy states it follows the coach's scope). Honest sub-copy on the header: "Planned on this phone from your latest roster view — open the app for the live picture." A `coach-profile` settings row: `data-go="coach-notif-settings"`, "Notifications · Briefings, alerts, quiet hours".
- [ ] **Step 1:** Implement render + mount (seg toggles → `setCoachNotifPrefs`; every change re-syncs via the action). **Step 2:** lint:xss clean; full `npx jest src/core` green (no unit test — toggle wiring; smoke covers it). **Step 3: Commit**

```bash
git add proto/redesign-2026-07/js/screens/settings.js proto/redesign-2026-07/js/screens/index.js proto/redesign-2026-07/js/screens/roles.js
git commit -m "feat(coach-os): coach notification preferences — briefing/recap/hourly/critical/quiet/my-room"
```

---

### Task 7: Ship gate — proto zip, full verify, browser smoke

**Files:** `assets/proto.zip` + `src/proto/protoVersion.ts` (generated)

- [ ] **Step 1:** `node scripts/build-proto-zip.mjs`; **Step 2:** `npm run verify` — all green, fix forward anything red and report it.
- [ ] **Step 3: Browser smoke** (the established recipe: serve `proto/redesign-2026-07` on :8127; mutate live modules in ONE evaluate — `RT.userId/authRole='coach'/profile`; fake `window.sb` thenable Proxy keyed by table/rpc name — seed `team_day_rollup` rpc with ~3 weeks of rollup rows across 2 positions incl. a decliner + a disengaged athlete + missed-lunch days, `team_intervention_outcomes` with both a locked (thin) and an unlocked-shaped dataset in two passes, roster/team_members/requirement_sets; `loadCoachRoster(true)`; hash-navigate only, ~500ms waits). Walk + screenshot into `.superpowers/sdd/smoke/`:
  1. `#coach-insights` — This-week brief lines render with real deltas; by-room line present; Athletes-to-watch lists the seeded decliner/disengaged names; Most-missed shows lunch; Week-vs-month renders; outcomes section shows the LOCKED honest state with the thin dataset, then (second pass with richer stub) the unlocked byKind/avgLift.
  2. `#coach-notif-settings` — all toggle rows render; flipping one persists (re-navigate and confirm).
  3. Evaluate-call the planner directly in-page (`import('./js/coach-notify-plan.js')`) with a snapshot from the stub roster to confirm a grouped "N athletes missed Lunch" item and the briefing slot — and confirm via the state module that a coach-role `syncNotifications` posts coach items (stub `window.OnStandardNative.notify.sync` to capture the array; assert no athlete meal-reminder ids).
  4. Screenshot each; note stub artifacts honestly.
- [ ] **Step 4: Commit** `git add assets/proto.zip src/proto/protoVersion.ts && git commit -m "chore(coach-os): proto zip — slice E"`

---

## Self-Review (done at write time)

- **Spec coverage:** What-changed-this-week deterministic sentences incl. by-room ✔ (T2/T3). Athletes to watch: decliners/disengaging/recoverers ✔ (T2; recoverers from outcomes). Most-missed ✔. Weekly-vs-monthly ✔. Intervention outcomes honest-thin with ≥2-week unlock ✔. "2–3 SQL RPCs aggregating days/meals/requirement_assignments/coach_interventions server-side" — 2 RPCs over days/meals/checkins/coach_interventions; requirement_assignments intentionally not aggregated (assignment history is per-athlete UI already; noted as a deferral if the reviewer disagrees). Grouped notifications: pure planner sibling ✔ (T4), never completed/excused ✔, quiet hours ✔ (shared inQuiet), prefs menu incl. my-room-only ✔ (T5/T6), avatar→notifications ✔ (coach-profile row).
- **Landmines carried:** timezone rule is a global constraint + migration-header doc; check-in dual-source in the rollup; coach-device athlete-reminder bug fixed by the T5 branch; entriesFor-null tolerated in T5.
- **Type consistency:** rollup/outcome row shapes identical across T1 SQL, T2 engine params, T3 loader; plan-item shape identical to notify-plan's native contract (T4/T5); `alertKeys` produced T4, persisted/consumed T5. `DEFAULT_COACH_NOTIF_PREFS.allowCriticalInQuiet` — referenced in T4 quiet rules but missing from the defaults object → ADD it there (`allowCriticalInQuiet: true`); fixed inline here so implementers see one canonical object.
- **Honest unknowns with verify-then-adjust instructions:** checkins.week format (T1), whether a coach-data load already triggers a sync (T5 Step 1), settings screen placement (T6), state.js testability under Jest (T5 test note).
