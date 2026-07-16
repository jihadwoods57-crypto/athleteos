# Coach OS — Slice A Implementation Plan (nav · Home · Roster · core schema)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the coach's roster-feed dashboard with a coach operating system: five new tabs (Home · Roster · Create · Inbox · Insights), a priority-ranked Home command center with mark-handled, a dedicated Roster tab with statuses/filters/groups/bulk actions, and the backing tables (interventions, groups, exceptions, staff scope).

**Architecture:** Pure deterministic engines (`js/status.js`, `js/priority.js`) compute statuses and the ranked queue from real data — tested in Jest exactly like `notify-plan.js`. Screens are thin renderers over a shared coach data cache (`js/coach-data.js`). Three new tables + scope columns ride one migration, RLS-guarded by the existing `is_team_staff()` helper. `can_view()` is NOT touched (it carries 0050 minor-consent logic; scope *enforcement* lands in Slice F with the scoped roles).

**Tech Stack:** Vanilla-JS proto WebView (`proto/redesign-2026-07`), supabase-js + RLS, Jest (ts-jest, allowJs), Supabase CLI migrations.

## Global Constraints

- The shipped UI is `proto/redesign-2026-07/` — never `src/screens` (legacy donor).
- **Never narrated fiction:** every number/status/sentence computed from real rows; unknown = honest empty/loading/offline state (three distinct states, see `coach.js:97-142`).
- All cross-user text through `esc()` (components.js) — athlete names, positions, notes.
- Data helpers in `js/roles.js` are best-effort: return `[]`/`null`/`{error:true}` per the file-top comment idiom; never throw to a screen.
- Migrations: forward-only, idempotent (`create table if not exists`, guarded `do $$` blocks), applied via `supabase db push --linked` (needs `dangerouslyDisableSandbox: true`; docker warning harmless; `.env` bare-token line must stay commented).
- Blue→teal signature stays on score surfaces (`var(--ring-a/b/c)` gradient, `coach.js:106`); green is status-only. Dark tokens only.
- Scoring formula stays in `src/core` — coaches set requirements, never weights (D3 rails).
- After any proto change: `node scripts/build-proto-zip.mjs` then `npm run verify`. Full suite (1771+ tests) stays green.
- Commit after every task (branch: work on `master` unless founder says otherwise — check `git status` first; a concurrent committer may be active, never `git add -A`).

## Existing interfaces you will consume (verified 2026-07-16)

- `roles.loadCoachRoster()` → `{ teams:[{id,name}], rows:[{athleteId,name,unit,score,loggedToday,flag,logs,note}] }`, throws `'roster-fetch-failed'` on outage (`js/roles.js:468-488`).
- `roles.fetchLinkedDaysSince(sinceISO)` → `[{athlete_id,date,score,grade,tasks}]` (`roles.js:27-30`). `tasks` = `[{id,title,done,...}]`.
- `roles.fetchTeamActivity(sinceISO, limit)` → meal rows `{id,athlete_id,day_date,type,photo_path,name,protein,kcal,quality,logged_at}` (`roles.js:126-134`).
- `roles.fetchRequirementSets(teamId)` (`roles.js:273-276`) + `resolveRequirementSet(sets, position, athleteId)` from `js/requirements.js` → resolved items with `{id,title,proof,required,window:{open,due}}` (minutes-of-day; same shape as `src/core/notifyPlan.test.ts:6-15`).
- `roles.nudgePush(athleteId, title, body)` (`roles.js:360-363`), `roles.assignRequirement({...})` (`roles.js:331`).
- `is_team_staff(team uuid)` SQL helper (`0002_rls.sql:44-48`).
- `titleHead(title, sub)` / `backHead(title, sub, fallback)` / `esc()` (`js/components.js:183-203`).
- Router: `NAVS`, `ROOT_TAB`, tab id conventions (`js/router.js:9-29,81-85`); screens register in `js/screens/index.js`; a screen module = `{ nav, tab, render({sub,S}), mount(root)? }`.
- State: `RT.userId`, `RT.authRole`, `RT.coachNudged`, `S.greeting`, `S.coachIdentity.handle` (state.js). `act.markNudged(id)` exists (used `coach.js:230`).
- Jest pattern for proto modules: `// @ts-ignore` + direct ESM import from `../../proto/redesign-2026-07/js/<mod>.js` in a `src/core/*.test.ts` file (`src/core/notifyPlan.test.ts:1-4`).

---

### Task 1: Migration `0071_coach_os_core.sql` — interventions, groups, exceptions, staff scope

**Files:**
- Create: `supabase/migrations/0071_coach_os_core.sql`

**Interfaces:**
- Produces tables `coach_interventions`, `coach_groups`, `athlete_exceptions`; columns `team_staff.scope_kind`, `team_staff.scope_value`. Later tasks read/write them via roles.js helpers (Task 2).

- [ ] **Step 1: Write the migration**

```sql
-- OnStandard — Coach OS slice A core (spec: docs/superpowers/specs/2026-07-16-coach-os-design.md).
-- One slice, one migration (0055 idiom). Forward-only, idempotent.
--
-- coach_interventions: every coach action on an athlete (nudge/message/assign/handled).
--   Drives the Home priority queue (a handled reason leaves the queue) AND is the raw
--   data for Insights "did the intervention work?" later. Coach-side only — athletes
--   never read it (there is deliberately NO athlete-facing policy).
-- coach_groups: named custom athlete groups (scope selector, roster filters, bulk targets).
-- athlete_exceptions: excused windows (travel/injury/absence). Athlete READS their own
--   (their app shows "Excused"); only staff write.
-- team_staff scope columns: WHERE a staff member's responsibility ends (null = whole team).
--   Enforcement in can_view() lands in Slice F with the scoped roles — 0050's consent
--   logic makes that surgery its own reviewed change. Columns land now so groups/UI
--   and Slice F have the shape.

create table if not exists coach_interventions (
  id          uuid primary key default gen_random_uuid(),
  team_id     uuid not null references teams(id) on delete cascade,
  athlete_id  uuid not null,
  coach_id    uuid not null default auth.uid(),
  kind        text not null check (kind in ('nudge','message','assign','handled')),
  reason_key  text,                          -- priority signature, e.g. 'overdue:breakfast+lunch'
  tier        text check (tier in ('critical','below','due_soon')),
  day         date not null default (now() at time zone 'utc')::date,
  note        text,
  created_at  timestamptz not null default now()
);
create index if not exists ci_team_day  on coach_interventions (team_id, day desc);
create index if not exists ci_athlete   on coach_interventions (athlete_id, created_at desc);
alter table coach_interventions enable row level security;
drop policy if exists ci_staff_rw on coach_interventions;
create policy ci_staff_rw on coach_interventions
  for all using (is_team_staff(team_id))
  with check (is_team_staff(team_id) and coach_id = auth.uid());

create table if not exists coach_groups (
  id          uuid primary key default gen_random_uuid(),
  team_id     uuid not null references teams(id) on delete cascade,
  name        text not null check (char_length(name) between 1 and 40),
  athlete_ids uuid[] not null default '{}',
  created_by  uuid not null default auth.uid(),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists cg_team on coach_groups (team_id);
alter table coach_groups enable row level security;
drop policy if exists cg_staff_rw on coach_groups;
create policy cg_staff_rw on coach_groups
  for all using (is_team_staff(team_id))
  with check (is_team_staff(team_id));

create table if not exists athlete_exceptions (
  id          uuid primary key default gen_random_uuid(),
  team_id     uuid not null references teams(id) on delete cascade,
  athlete_id  uuid not null,
  starts_on   date not null default (now() at time zone 'utc')::date,
  ends_on     date not null default (now() at time zone 'utc')::date,
  reason      text check (reason is null or char_length(reason) <= 120),
  created_by  uuid not null default auth.uid(),
  created_at  timestamptz not null default now(),
  check (ends_on >= starts_on)
);
create index if not exists ae_team_window on athlete_exceptions (team_id, starts_on, ends_on);
alter table athlete_exceptions enable row level security;
drop policy if exists ae_staff_rw on athlete_exceptions;
create policy ae_staff_rw on athlete_exceptions
  for all using (is_team_staff(team_id))
  with check (is_team_staff(team_id));
drop policy if exists ae_athlete_read on athlete_exceptions;
create policy ae_athlete_read on athlete_exceptions
  for select using (athlete_id = auth.uid());

do $$ begin
  if not exists (select 1 from information_schema.columns
                 where table_name = 'team_staff' and column_name = 'scope_kind') then
    alter table team_staff add column scope_kind text
      check (scope_kind is null or scope_kind in ('position','group'));
    alter table team_staff add column scope_value text;
  end if;
end $$;

comment on table coach_interventions is
  'Every coach action on an athlete. kind=handled clears a priority card; all kinds feed Insights intervention-outcome analysis.';
```

- [ ] **Step 2: Apply to live**

Run (Bash, `dangerouslyDisableSandbox: true`): `supabase db push --linked`
Expected: `Applying migration 0071_coach_os_core.sql... Finished supabase db push.` (docker warning harmless)

- [ ] **Step 3: Verify the tables exist and RLS is on**

Run: `supabase db query --linked "select relname, relrowsecurity from pg_class where relname in ('coach_interventions','coach_groups','athlete_exceptions')"`
Expected: three rows, all `relrowsecurity = t`

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/0071_coach_os_core.sql
git commit -m "feat(coach-os): interventions, groups, exceptions, staff scope schema (0071, applied)"
```

---

### Task 2: roles.js data helpers for the new tables + richer roster load

**Files:**
- Modify: `proto/redesign-2026-07/js/roles.js` (append after the requirements section, ~line 348; extend `loadCoachRoster` at 468-488)
- Test: `src/core/coachRosterRow.test.ts`

**Interfaces:**
- Produces (all best-effort, roles.js idiom):
  - `logIntervention({teamId, athleteId, kind, reasonKey, tier, note})` → `boolean`
  - `fetchTodayInterventions(teamId)` → `[{athlete_id,kind,reason_key,tier,created_at}]`
  - `fetchCoachGroups(teamId)` → `[{id,name,athlete_ids}]`
  - `saveCoachGroup(teamId, {id?, name, athleteIds})` → `{ok, error?}`
  - `deleteCoachGroup(id)` → `boolean`
  - `fetchActiveExceptions(teamId)` → `[{id,athlete_id,starts_on,ends_on,reason}]` (covering today)
  - `saveAthleteException(teamId, athleteId, startsOn, endsOn, reason)` → `{ok, error?}`
  - `endAthleteException(id)` → `boolean`
  - `fetchMyStaffScope(teamId)` → `{kind,value}|null`
  - `loadCoachRoster()` rows gain: `scoreHistory:[{date,score}]` (7 days, oldest→newest), `lastMealAt` (ISO|null), `tasks` (today's day tasks array), `position` (alias of unit)

- [ ] **Step 1: Write the failing test for the enriched roster row**

`src/core/coachRosterRow.test.ts`:
```typescript
// Enriched roster projection (Coach OS slice A) — pure merge, no client needed.
// @ts-ignore
import { buildRosterRow } from '../../proto/redesign-2026-07/js/roles.js';

const member = { athlete_id: 'a1', athlete_name: 'Devin Cole', position: 'LB' };
const day = { athlete_id: 'a1', date: '2026-07-16', score: 55, tasks: [{ id: 'breakfast', done: true }, { id: 'lunch', done: false }] };

test('row carries tasks, history and lastMealAt for the status/priority engines', () => {
  const hist = [{ date: '2026-07-15', score: 70 }, { date: '2026-07-16', score: 55 }];
  const r = buildRosterRow(member, day, { scoreHistory: hist, lastMealAt: '2026-07-16T12:10:00Z' });
  expect(r.tasks).toHaveLength(2);
  expect(r.scoreHistory).toEqual(hist);
  expect(r.lastMealAt).toBe('2026-07-16T12:10:00Z');
  expect(r.position).toBe('LB');
});

test('extras are optional — legacy two-arg calls unchanged', () => {
  const r = buildRosterRow(member, day);
  expect(r.score).toBe(55);
  expect(r.scoreHistory).toEqual([]);
  expect(r.lastMealAt).toBeNull();
});
```

- [ ] **Step 2: Run it — expect FAIL**

Run: `npx jest src/core/coachRosterRow.test.ts`
Expected: FAIL (`tasks`/`scoreHistory` undefined)

- [ ] **Step 3: Implement**

In `roles.js`, change `buildRosterRow` signature and returned object (`roles.js:449-465`):

```js
export function buildRosterRow(member, dayRow, extras = {}) {
  const name = member.athlete_name || 'Athlete';
  const logged = !!dayRow;
  const score = logged && dayRow.score != null ? dayRow.score : null;
  const tasks = (dayRow && Array.isArray(dayRow.tasks)) ? dayRow.tasks : [];
  const done = tasks.filter(t => t && t.done).length;
  return {
    athleteId: member.athlete_id,
    name, unit: member.position || '', position: member.position || '',
    score, loggedToday: logged,
    flag: logged ? tierFlag(score) : 'r',
    logs: logged && tasks.length ? `${done}/${tasks.length}` : (logged ? 'Logged' : '—'),
    note: logged
      ? (score != null ? (score >= 80 ? 'On standard today' : 'Logged · below the bar') : 'Logged today')
      : 'No logs today',
    tasks,
    scoreHistory: extras.scoreHistory || [],
    lastMealAt: extras.lastMealAt || null,
  };
}
```

In `loadCoachRoster` (`roles.js:468-488`): fetch 7 days instead of 1, plus recent meals for last-activity; build per-athlete extras:

```js
export async function loadCoachRoster() {
  const teams = await fetchMyTeams();
  if (teams.error) throw new Error('roster-fetch-failed');
  if (!teams.length) return { teams: [], rows: [] };
  const [perTeam, days, recentMeals] = await Promise.all([
    Promise.all(teams.map(t => fetchTeamRoster(t.id))),
    fetchLinkedDaysSince(daysAgoISO(7)),
    fetchTeamActivity(daysAgoISO(2), 400),
  ]);
  const today = todayISO();
  const dayByAthlete = {}, histByAthlete = {}, lastMealBy = {};
  for (const d of days) {
    if (d.date === today) dayByAthlete[d.athlete_id] = d;
    (histByAthlete[d.athlete_id] = histByAthlete[d.athlete_id] || []).push({ date: d.date, score: d.score });
  }
  for (const h of Object.values(histByAthlete)) h.sort((a, b) => a.date < b.date ? -1 : 1);
  for (const m of recentMeals) {
    if (!lastMealBy[m.athlete_id] || m.logged_at > lastMealBy[m.athlete_id]) lastMealBy[m.athlete_id] = m.logged_at;
  }
  const seen = new Set(); const rows = [];
  for (const members of perTeam) {
    for (const m of members) {
      if (seen.has(m.athlete_id)) continue; seen.add(m.athlete_id);
      rows.push(buildRosterRow(m, dayByAthlete[m.athlete_id], {
        scoreHistory: histByAthlete[m.athlete_id] || [],
        lastMealAt: lastMealBy[m.athlete_id] || null,
      }));
    }
  }
  rows.sort((a, b) => (b.score ?? -1) - (a.score ?? -1));
  return { teams, rows };
}
```

Append the new-table helpers after the requirements section (~line 348), following the file's best-effort idiom exactly:

```js
/* ---------------- Coach OS core (0071): interventions, groups, exceptions ---------------- */
/** Log a coach action (nudge/message/assign/handled). The queue and Insights both read this. */
export async function logIntervention({ teamId, athleteId, kind, reasonKey, tier, note }) {
  const c = sb(); if (!c || !teamId || !athleteId || !kind) return false;
  try {
    const { error } = await c.from('coach_interventions').insert({
      team_id: teamId, athlete_id: athleteId, kind,
      reason_key: reasonKey || null, tier: tier || null, note: note || null,
    });
    return !error;
  } catch { return false; }
}
/** Today's interventions for the team (priority queue filters on these). Best-effort []. */
export async function fetchTodayInterventions(teamId) {
  const c = sb(); if (!c || !teamId) return [];
  try {
    const { data } = await c.from('coach_interventions')
      .select('athlete_id,kind,reason_key,tier,created_at')
      .eq('team_id', teamId).eq('day', todayISO()).limit(400);
    return data || [];
  } catch { return []; }
}
export async function fetchCoachGroups(teamId) {
  const c = sb(); if (!c || !teamId) return [];
  try { const { data } = await c.from('coach_groups').select('id,name,athlete_ids').eq('team_id', teamId).order('name'); return data || []; } catch { return []; }
}
export async function saveCoachGroup(teamId, { id, name, athleteIds }) {
  const c = sb(); if (!c || !teamId) return { ok: false, error: 'You need a connection for this.' };
  try {
    const row = { team_id: teamId, name, athlete_ids: athleteIds || [], updated_at: new Date().toISOString() };
    const q = id ? c.from('coach_groups').update(row).eq('id', id) : c.from('coach_groups').insert(row);
    const { error } = await q;
    return error ? { ok: false, error: error.message || 'Could not save the group.' } : { ok: true };
  } catch (e) { return { ok: false, error: (e && e.message) || 'Could not save the group.' }; }
}
export async function deleteCoachGroup(id) {
  const c = sb(); if (!c || !id) return false;
  try { const { error } = await c.from('coach_groups').delete().eq('id', id); return !error; } catch { return false; }
}
/** Exceptions whose window covers today. Best-effort []. */
export async function fetchActiveExceptions(teamId) {
  const c = sb(); if (!c || !teamId) return [];
  try {
    const t = todayISO();
    const { data } = await c.from('athlete_exceptions')
      .select('id,athlete_id,starts_on,ends_on,reason')
      .eq('team_id', teamId).lte('starts_on', t).gte('ends_on', t);
    return data || [];
  } catch { return []; }
}
export async function saveAthleteException(teamId, athleteId, startsOn, endsOn, reason) {
  const c = sb(); if (!c || !teamId || !athleteId) return { ok: false, error: 'You need a connection for this.' };
  try {
    const { error } = await c.from('athlete_exceptions').insert({
      team_id: teamId, athlete_id: athleteId, starts_on: startsOn, ends_on: endsOn, reason: reason || null,
    });
    return error ? { ok: false, error: error.message || 'Could not mark that.' } : { ok: true };
  } catch (e) { return { ok: false, error: (e && e.message) || 'Could not mark that.' }; }
}
export async function endAthleteException(id) {
  const c = sb(); if (!c || !id) return false;
  try {
    const y = new Date(); y.setDate(y.getDate() - 1);
    const { error } = await c.from('athlete_exceptions').update({ ends_on: iso(y) }).eq('id', id);
    return !error;
  } catch { return false; }
}
/** The signed-in staff member's own scope on this team. null = whole team (default). */
export async function fetchMyStaffScope(teamId) {
  const c = sb(); if (!c || !teamId) return null;
  try {
    const uid = (await c.auth.getUser()).data.user.id;
    const { data } = await c.from('team_staff').select('scope_kind,scope_value')
      .eq('team_id', teamId).eq('staff_id', uid).maybeSingle();
    return (data && data.scope_kind) ? { kind: data.scope_kind, value: data.scope_value } : null;
  } catch { return null; }
}
```

- [ ] **Step 4: Run the test + existing roster-dependent suites**

Run: `npx jest src/core/coachRosterRow.test.ts src/core/copilot.test.ts`
Expected: PASS (copilot consumes roster rows — confirms no shape regression)

- [ ] **Step 5: Commit**

```bash
git add proto/redesign-2026-07/js/roles.js src/core/coachRosterRow.test.ts
git commit -m "feat(coach-os): intervention/group/exception data helpers + 7-day roster projection"
```

---

### Task 3: `js/status.js` — the seven deterministic athlete statuses

**Files:**
- Create: `proto/redesign-2026-07/js/status.js`
- Test: `src/core/coachStatus.test.ts`

**Interfaces:**
- Consumes roster rows from Task 2 (`tasks`, `score`, `loggedToday`, `lastMealAt`) + resolved requirement items (`{id,required,window:{open,due},title}`) + active exceptions.
- Produces:
  - `athleteStatus({ nowMin, row, reqs, excused })` → `{ key, label, detail, openItems:[{id,title,dueMin,state}] }` where `key ∈ 'excused'|'overdue'|'needs_review'|'below_standard'|'due_soon'|'no_activity'|'on_standard'`
  - `teamPulse(rows, statuses)` → `{ avg, deltaVsYesterday, onStandard, dueSoon, overdue, completionPct }`
  - `STATUS_META` — `{key: {label, color}}` used by both new screens.

- [ ] **Step 1: Write the failing tests**

`src/core/coachStatus.test.ts`:
```typescript
// Coach OS statuses — deterministic, precedence-ordered (spec §Roster statuses).
// @ts-ignore
import { athleteStatus, teamPulse, STATUS_META } from '../../proto/redesign-2026-07/js/status.js';

const req = (id: string, open: number, due: number) => ({ id, title: id, required: true, proof: 'photo', window: { open, due } });
const REQS = [req('breakfast', 420, 570), req('lunch', 720, 840), req('dinner', 1080, 1230)];
const row = (over: object = {}) => ({
  athleteId: 'a1', name: 'Devin', score: null, loggedToday: false,
  tasks: [], lastMealAt: null, scoreHistory: [], ...over,
});

test('excused wins over everything', () => {
  const s = athleteStatus({ nowMin: 900, row: row(), reqs: REQS, excused: true });
  expect(s.key).toBe('excused');
});
test('overdue: a required item past due and not done', () => {
  const s = athleteStatus({ nowMin: 900, row: row({ loggedToday: true, tasks: [{ id: 'breakfast', done: true }, { id: 'lunch', done: false }] }), reqs: REQS, excused: false });
  expect(s.key).toBe('overdue');
  expect(s.detail).toMatch(/lunch/i);
});
test('due soon: within 60 min of an open required item', () => {
  const s = athleteStatus({ nowMin: 800, row: row({ loggedToday: true, score: 85, tasks: [{ id: 'breakfast', done: true }, { id: 'lunch', done: false }] }), reqs: REQS, excused: false });
  expect(s.key).toBe('due_soon');
});
test('below standard: everything logged on time but score < 80', () => {
  const s = athleteStatus({ nowMin: 700, row: row({ loggedToday: true, score: 55, tasks: [{ id: 'breakfast', done: true }] }), reqs: REQS, excused: false });
  expect(s.key).toBe('below_standard');
});
test('no activity: nothing today and no meal inside 24h', () => {
  const s = athleteStatus({ nowMin: 700, row: row(), reqs: REQS, excused: false });
  expect(s.key).toBe('no_activity');
});
test('on standard', () => {
  const s = athleteStatus({ nowMin: 700, row: row({ loggedToday: true, score: 92, tasks: [{ id: 'breakfast', done: true }] }), reqs: REQS, excused: false });
  expect(s.key).toBe('on_standard');
});
test('teamPulse: counts + completion + delta from history', () => {
  const rows = [
    row({ athleteId: 'a1', score: 90, loggedToday: true, scoreHistory: [{ date: '2026-07-15', score: 80 }, { date: '2026-07-16', score: 90 }], tasks: [{ id: 'breakfast', done: true }] }),
    row({ athleteId: 'a2', score: 50, loggedToday: true, scoreHistory: [{ date: '2026-07-15', score: 70 }, { date: '2026-07-16', score: 50 }], tasks: [{ id: 'breakfast', done: false }] }),
  ];
  const statuses = { a1: { key: 'on_standard' }, a2: { key: 'overdue' } };
  const p = teamPulse(rows, statuses, '2026-07-16');
  expect(p.avg).toBe(70);
  expect(p.deltaVsYesterday).toBe(-5);   // (80+70)/2=75 yesterday → 70 today
  expect(p.onStandard).toBe(1);
  expect(p.overdue).toBe(1);
  expect(p.completionPct).toBe(50);      // 1 of 2 tasks done
});
test('every status key has display meta', () => {
  for (const k of ['excused', 'overdue', 'needs_review', 'below_standard', 'due_soon', 'no_activity', 'on_standard']) {
    expect(STATUS_META[k].label).toBeTruthy();
  }
});
```

- [ ] **Step 2: Run — expect FAIL** (`Cannot find module '../../proto/.../status.js'`)

Run: `npx jest src/core/coachStatus.test.ts`

- [ ] **Step 3: Implement `proto/redesign-2026-07/js/status.js`**

```js
/* Coach OS athlete statuses — PURE (no imports, no DOM, no fetch): testable like notify-plan.js.
   One athlete → one status, precedence-ordered so the roster chip is never ambiguous:
   excused > overdue > needs_review > below_standard > due_soon > no_activity > on_standard.
   Every input is real data (day row, resolved requirement windows, exception rows) —
   an unknown score/window degrades to the safest honest answer, never an invented one. */

export const STATUS_META = {
  excused:        { label: 'Excused',        color: 'var(--text-3)' },
  overdue:        { label: 'Overdue',        color: 'var(--red)' },
  needs_review:   { label: 'Needs review',   color: 'var(--amber-bright)' },
  below_standard: { label: 'Below standard', color: 'var(--red)' },
  due_soon:       { label: 'Due soon',       color: 'var(--amber-bright)' },
  no_activity:    { label: 'No activity',    color: 'var(--red)' },
  on_standard:    { label: 'On standard',    color: 'var(--green-bright)' },
};
const DUE_SOON_MIN = 60;

/** Open required items with their due state at `nowMin`. Done-ness comes from day.tasks. */
function openItems(nowMin, row, reqs) {
  const doneById = {};
  for (const t of (row.tasks || [])) if (t && t.done) doneById[t.id] = true;
  const out = [];
  for (const r of (reqs || [])) {
    if (!r || !r.required || doneById[r.id]) continue;
    const due = r.window && typeof r.window.due === 'number' ? r.window.due : null;
    const open = r.window && typeof r.window.open === 'number' ? r.window.open : 0;
    let state = 'ready';
    if (due != null && nowMin > due) state = 'overdue';
    else if (due != null && nowMin >= due - DUE_SOON_MIN && nowMin >= open) state = 'due_soon';
    else if (nowMin < open) state = 'upcoming';
    out.push({ id: r.id, title: r.title || r.id, dueMin: due, state });
  }
  return out;
}

/** true when the latest meal is older than 24h AND nothing is logged today. */
function noActivity24h(row) {
  if (row.loggedToday) return false;
  if (!row.lastMealAt) return true;
  return (Date.now() - new Date(row.lastMealAt).getTime()) > 24 * 3600 * 1000;
}

export function athleteStatus({ nowMin, row, reqs, excused, needsReview }) {
  const items = openItems(nowMin, row, reqs);
  const overdue = items.filter(i => i.state === 'overdue');
  const dueSoon = items.filter(i => i.state === 'due_soon');
  const mk = (key, detail) => ({ key, label: STATUS_META[key].label, detail, openItems: items });
  if (excused) return mk('excused', 'Excused today');
  if (overdue.length) return mk('overdue', `${overdue.map(i => i.title).join(' and ')} overdue`);
  if (needsReview) return mk('needs_review', 'A log is waiting on your review');
  if (row.loggedToday && row.score != null && row.score < 80) return mk('below_standard', `Scored ${row.score} today`);
  if (dueSoon.length) {
    const next = dueSoon.reduce((a, b) => (a.dueMin ?? 9999) <= (b.dueMin ?? 9999) ? a : b);
    return mk('due_soon', `${next.title} window closes in ${Math.max(0, (next.dueMin ?? nowMin) - nowMin)} minutes`);
  }
  if (noActivity24h(row)) return mk('no_activity', 'No activity in the last day');
  if (row.loggedToday) return mk('on_standard', 'On standard today');
  return mk('no_activity', 'Nothing logged yet today');
}

/** Aggregate pulse over VISIBLE (scope-filtered) rows. dateISO = today, for the delta. */
export function teamPulse(rows, statuses, dateISO) {
  const scored = rows.filter(r => r.score != null);
  const avg = scored.length ? Math.round(scored.reduce((a, r) => a + r.score, 0) / scored.length) : null;
  let ySum = 0, yN = 0;
  for (const r of rows) {
    const h = (r.scoreHistory || []).filter(x => x.date < dateISO && x.score != null);
    if (h.length) { ySum += h[h.length - 1].score; yN++; }
  }
  const yAvg = yN ? Math.round(ySum / yN) : null;
  let done = 0, total = 0;
  for (const r of rows) for (const t of (r.tasks || [])) { total++; if (t && t.done) done++; }
  const count = (k) => rows.filter(r => statuses[r.athleteId] && statuses[r.athleteId].key === k).length;
  return {
    avg,
    deltaVsYesterday: (avg != null && yAvg != null) ? avg - yAvg : null,
    onStandard: count('on_standard'),
    dueSoon: count('due_soon'),
    overdue: count('overdue') + count('no_activity'),
    completionPct: total ? Math.round((done / total) * 100) : null,
  };
}
```

- [ ] **Step 4: Run — expect PASS**

Run: `npx jest src/core/coachStatus.test.ts`

- [ ] **Step 5: Commit**

```bash
git add proto/redesign-2026-07/js/status.js src/core/coachStatus.test.ts
git commit -m "feat(coach-os): deterministic seven-status engine + team pulse (pure, tested)"
```

---

### Task 4: `js/priority.js` — the ranked Coach Priorities queue with mark-handled

**Files:**
- Create: `proto/redesign-2026-07/js/priority.js`
- Test: `src/core/coachPriority.test.ts`

**Interfaces:**
- Consumes: per-athlete `{row, status}` (Task 3 shapes) + today's interventions (Task 2 shape).
- Produces:
  - `reasonKey(status)` → stable signature string, e.g. `'overdue:breakfast+lunch'`
  - `buildPriorities({ nowMin, entries, interventions })` → ranked `[{athleteId, name, unit, tier, reasons:[string], detail, score, suggestedAction:{kind,label}, reasonKey, mealId?}]`
  - Tiers: `'critical'` (overdue ≥ 2 items OR overdue + no-activity-24h) · `'below'` · `'due_soon'`.
  - A card is EXCLUDED when any intervention today matches `athlete_id` + `reason_key` (any kind — handled or acted-on both clear it).

- [ ] **Step 1: Write the failing tests**

`src/core/coachPriority.test.ts`:
```typescript
// Coach Priorities ranking — deterministic, mark-handled-aware (spec §Coach Priorities).
// @ts-ignore
import { buildPriorities, reasonKey } from '../../proto/redesign-2026-07/js/priority.js';

const status = (key: string, openIds: string[] = [], detail = '') => ({
  key, detail, label: key,
  openItems: openIds.map(id => ({ id, title: id, dueMin: 840, state: key === 'overdue' ? 'overdue' : 'due_soon' })),
});
const entry = (id: string, key: string, over: object = {}, openIds: string[] = []) => ({
  row: { athleteId: id, name: id, unit: 'LB', score: 50, loggedToday: true, lastMealAt: null, tasks: [], scoreHistory: [], ...over },
  status: status(key, openIds),
});

test('critical outranks below outranks due_soon', () => {
  const p = buildPriorities({
    nowMin: 900,
    entries: [entry('due', 'due_soon', {}, ['lunch']), entry('below', 'below_standard'), entry('crit', 'overdue', { loggedToday: false, lastMealAt: null }, ['breakfast', 'lunch'])],
    interventions: [],
  });
  expect(p.map(x => x.athleteId)).toEqual(['crit', 'below', 'due']);
  expect(p[0].tier).toBe('critical');
});
test('on_standard / excused athletes never appear', () => {
  const p = buildPriorities({ nowMin: 900, entries: [entry('ok', 'on_standard'), entry('ex', 'excused')], interventions: [] });
  expect(p).toHaveLength(0);
});
test('reasonKey is stable regardless of item order', () => {
  expect(reasonKey(status('overdue', ['lunch', 'breakfast']))).toBe(reasonKey(status('overdue', ['breakfast', 'lunch'])));
});
test('a handled intervention with the same signature clears the card; a new reason resurfaces it', () => {
  const e = entry('a1', 'overdue', {}, ['lunch']);
  const key = reasonKey(e.status);
  expect(buildPriorities({ nowMin: 900, entries: [e], interventions: [{ athlete_id: 'a1', kind: 'handled', reason_key: key }] })).toHaveLength(0);
  const worse = entry('a1', 'overdue', {}, ['lunch', 'dinner']);
  expect(buildPriorities({ nowMin: 900, entries: [worse], interventions: [{ athlete_id: 'a1', kind: 'handled', reason_key: key }] })).toHaveLength(1);
});
test('every card carries a suggested action', () => {
  const p = buildPriorities({ nowMin: 900, entries: [entry('crit', 'overdue', { loggedToday: false }, ['breakfast', 'lunch']), entry('b', 'below_standard'), entry('d', 'due_soon', {}, ['lunch'])], interventions: [] });
  expect(p.find(x => x.athleteId === 'crit')!.suggestedAction.kind).toBe('message');
  expect(p.find(x => x.athleteId === 'b')!.suggestedAction.kind).toBe('review');
  expect(p.find(x => x.athleteId === 'd')!.suggestedAction.kind).toBe('nudge');
});
```

- [ ] **Step 2: Run — expect FAIL** (module not found)

Run: `npx jest src/core/coachPriority.test.ts`

- [ ] **Step 3: Implement `proto/redesign-2026-07/js/priority.js`**

```js
/* Coach Priorities — PURE ranking engine (no imports/DOM/fetch). The app ranks problems
   instead of painting every struggling athlete the same red. Deterministic: same inputs,
   same queue, every render — and testable, so "why is Devin #1" always has an answer.

   Mark-handled: every coach action (nudge/message/assign/handled) logs an intervention
   with this file's reasonKey. A card whose CURRENT signature already has an intervention
   today stays out of the queue; a genuinely new reason (extra overdue item, new tier)
   changes the signature and resurfaces the athlete. */

const TIER_RANK = { critical: 0, below: 1, due_soon: 2 };

export function reasonKey(status) {
  const ids = (status.openItems || []).filter(i => i.state === 'overdue' || i.state === 'due_soon')
    .map(i => i.id).sort().join('+');
  return `${status.key}:${ids}`;
}

function tierOf(row, status) {
  if (status.key === 'overdue' || status.key === 'no_activity') {
    const n = (status.openItems || []).filter(i => i.state === 'overdue').length;
    const stale = !row.loggedToday && (!row.lastMealAt || (Date.now() - new Date(row.lastMealAt).getTime()) > 24 * 3600 * 1000);
    return (n >= 2 || (n >= 1 && stale) || status.key === 'no_activity') ? 'critical' : 'due_soon';
  }
  if (status.key === 'below_standard' || status.key === 'needs_review') return 'below';
  if (status.key === 'due_soon') return 'due_soon';
  return null; // on_standard / excused — not a problem
}

function suggestion(tier, status) {
  if (tier === 'critical') return { kind: 'message', label: 'Send direct reminder' };
  if (tier === 'below') return { kind: 'review', label: 'Review the log' };
  if (status.key === 'due_soon') return { kind: 'nudge', label: 'Nudge' };
  return { kind: 'message', label: 'Check in' };
}

function reasons(row, status) {
  const out = [];
  if (status.detail) out.push(status.detail);
  if (!row.loggedToday && row.lastMealAt) {
    const h = Math.floor((Date.now() - new Date(row.lastMealAt).getTime()) / 3600000);
    if (h >= 12) out.push(`No activity for ${h >= 48 ? Math.floor(h / 24) + ' days' : h + ' hours'}`);
  } else if (!row.loggedToday && !row.lastMealAt) out.push('No activity on record');
  return out;
}

/** entries: [{row, status}] (already scope-filtered). interventions: today's rows. */
export function buildPriorities({ nowMin, entries, interventions }) {
  const acted = new Set((interventions || []).filter(i => i.reason_key).map(i => `${i.athlete_id}|${i.reason_key}`));
  const cards = [];
  for (const { row, status } of (entries || [])) {
    const tier = tierOf(row, status);
    if (!tier) continue;
    const key = reasonKey(status);
    if (acted.has(`${row.athleteId}|${key}`)) continue;
    const overdueN = (status.openItems || []).filter(i => i.state === 'overdue').length;
    cards.push({
      athleteId: row.athleteId, name: row.name, unit: row.unit || '',
      tier, reasons: reasons(row, status), detail: status.detail, score: row.score,
      suggestedAction: suggestion(tier, status), reasonKey: key,
      _sort: TIER_RANK[tier] * 1000 - overdueN * 10 - (row.score != null ? (100 - row.score) / 100 : 0.5),
    });
  }
  cards.sort((a, b) => a._sort - b._sort);
  return cards.map(({ _sort, ...c }) => c);
}
```

- [ ] **Step 4: Run — expect PASS**

Run: `npx jest src/core/coachPriority.test.ts src/core/coachStatus.test.ts`

- [ ] **Step 5: Commit**

```bash
git add proto/redesign-2026-07/js/priority.js src/core/coachPriority.test.ts
git commit -m "feat(coach-os): deterministic priority queue with reason signatures + mark-handled"
```

---

### Task 5: Shared coach data cache `js/coach-data.js`

**Files:**
- Create: `proto/redesign-2026-07/js/coach-data.js`
- Modify: `proto/redesign-2026-07/js/screens/coach.js:10-62` (delegate `ROSTER`/loaders to the new module; keep `export async function loadCoachRoster` as a re-export so `js/screens/index.js` and any other importer keeps working)

**Interfaces:**
- Produces (consumed by coach-home, coach-roster, coach-insights, existing coach screens):
  - `CD.roster` → `null | { teams, rows, pending, offline }` (same contract as today's `ROSTER`)
  - `CD.extras` → `null | { sets, groups, exceptions, interventions, scope }`
  - `loadCoachRoster(force?)` — existing behavior + also fills `CD.extras` via `Promise.all(fetchRequirementSets, fetchCoachGroups, fetchActiveExceptions, fetchTodayInterventions, fetchMyStaffScope)` for `teams[0].id`
  - `loadActivity(force?)`, `ACT` accessor `CD.act` — moved verbatim from coach.js:44-62
  - `entriesFor(scope)` → scope-filtered `[{row, status}]` using `resolveRequirementSet` + `athleteStatus` (`nowMin` from local clock); `scope = {kind:'team'|'position'|'group'|'athlete', value}`
  - `getScope()` / `setScope(scope)` — persisted in `localStorage['onstd-coach-scope-v1']`, defaulting to the staff row's scope (position room) when one exists, else team.

- [ ] **Step 1: Create the module** (move, don't rewrite: lift `ROSTER/rosterLoading/loadCoachRoster` from coach.js:13-39 and `ACT/actLoading/actFetchedAt/loadActivity/actTime` from coach.js:44-68 into it verbatim, then add)

```js
import * as roles from './roles.js';
import { resolveRequirementSet } from './requirements.js';
import { athleteStatus } from './status.js';

/* …lifted ROSTER + ACT loaders here (unchanged bodies; loadCoachRoster gains the
   extras fetch below, and its repaint-hash list gains '#coach-home', '#coach-roster',
   '#coach-create', '#coach-insights')… */

export const CD = {
  get roster() { return ROSTER; },
  get act() { return ACT; },
  extras: null,
};

async function loadExtras(teamId) {
  const [sets, groups, exceptions, interventions, scope] = await Promise.all([
    roles.fetchRequirementSets(teamId), roles.fetchCoachGroups(teamId),
    roles.fetchActiveExceptions(teamId), roles.fetchTodayInterventions(teamId),
    roles.fetchMyStaffScope(teamId),
  ]);
  CD.extras = { sets, groups, exceptions, interventions, scope };
}
// call `await loadExtras(r.teams[0].id)` inside loadCoachRoster after the roster resolves
// (guarded: only when r.teams.length; on throw set CD.extras = { sets:[], groups:[], exceptions:[], interventions:[], scope:null })

const SCOPE_KEY = 'onstd-coach-scope-v1';
export function getScope() {
  try { const j = JSON.parse(localStorage.getItem(SCOPE_KEY) || 'null'); if (j && j.kind) return j; } catch { /* fresh */ }
  const s = CD.extras && CD.extras.scope;
  return s && s.kind === 'position' ? { kind: 'position', value: s.value } : { kind: 'team', value: null };
}
export function setScope(scope) {
  try { localStorage.setItem(SCOPE_KEY, JSON.stringify(scope)); } catch { /* in-memory only */ }
}

export function scopeFilter(rows, scope) {
  if (!scope || scope.kind === 'team') return rows;
  if (scope.kind === 'position') return rows.filter(r => (r.position || '').toUpperCase() === String(scope.value || '').toUpperCase());
  if (scope.kind === 'group') {
    const g = ((CD.extras && CD.extras.groups) || []).find(x => x.id === scope.value);
    const ids = new Set((g && g.athlete_ids) || []);
    return rows.filter(r => ids.has(r.athleteId));
  }
  if (scope.kind === 'athlete') return rows.filter(r => r.athleteId === scope.value);
  return rows;
}

export function entriesFor(scope) {
  if (!ROSTER || !CD.extras) return null;   // still loading — screens render skeletons
  const now = new Date(); const nowMin = now.getHours() * 60 + now.getMinutes();
  const excusedIds = new Set(CD.extras.exceptions.map(e => e.athlete_id));
  return scopeFilter(ROSTER.rows, scope).map(row => ({
    row,
    status: athleteStatus({
      nowMin, row,
      reqs: resolveRequirementSet(CD.extras.sets, row.position, row.athleteId).items,
      excused: excusedIds.has(row.athleteId),
      needsReview: false, // slice D wires flagged-meal review state
    }),
  }));
}
```
Note for the implementer: check the ACTUAL exported name/shape of `resolveRequirementSet` in `js/requirements.js` before wiring (`items` property vs direct array) and adapt this one call site — the tests in `requirementsEngine.test.ts` show the real signature.

In `coach.js`, replace the lifted blocks with:
```js
import { CD, loadCoachRoster, loadActivity, actTime } from '../coach-data.js';
export { loadCoachRoster };            // back-compat for js/screens/index.js importers
const ROSTER_VIEW = () => CD.roster;   // inside render bodies, replace `ROSTER` reads with ROSTER_VIEW()
```
(Mechanical: `coach.js` references `ROSTER` in `coach`, `coachAssign`, `coachPlan`, `coachInbox`, `copilot`, `coachAthlete` renders — swap reads to `CD.roster`; grep `ROSTER` within the file and update each.)

- [ ] **Step 2: Run the full suite — no regressions**

Run: `npx jest`
Expected: all suites PASS (1771+)

- [ ] **Step 3: Commit**

```bash
git add proto/redesign-2026-07/js/coach-data.js proto/redesign-2026-07/js/screens/coach.js
git commit -m "refactor(coach-os): shared coach data cache + scope filter (no behavior change)"
```

---

### Task 6: Navigation restructure — five tabs, avatar header, route registrations

**Files:**
- Modify: `proto/redesign-2026-07/js/router.js:17-23` (NAVS.coach), `:81-85` (ROOT_TAB)
- Modify: `proto/redesign-2026-07/js/components.js:199-203` (add `avatarHead`)
- Modify: `proto/redesign-2026-07/js/screens/index.js` (register `coach-home`, `coach-roster`, `coach-create`, `coach-insights`; alias `coach`)

**Interfaces:**
- Produces routes: `coach-home` (tab id `home`), `coach-roster` (`roster`), `coach-create` (fab), `coach-inbox` (`inbox`, badge unchanged), `coach-insights` (`insights`). `#coach` renders the same module as `coach-home` (alias key — old deep links, `routeForRole`, and `data-go="coach"` all keep working).
- `avatarHead(title, sub, initials)` → titleHead markup + right-aligned 34px round avatar button `data-go="coach-profile"` showing the coach's initials.

- [ ] **Step 1: router.js — NAVS.coach and ROOT_TAB**

```js
  coach: [
    { id: 'home',     route: 'coach-home',     label: 'Home',     icon: 'home' },
    { id: 'roster',   route: 'coach-roster',   label: 'Roster',   icon: 'users' },
    { id: 'create',   route: 'coach-create',   label: '',         icon: 'plus', fab: true },
    { id: 'inbox',    route: 'coach-inbox',    label: 'Inbox',    icon: 'message' },
    { id: 'insights', route: 'coach-insights', label: 'Insights', icon: 'bars' },
  ],
```
ROOT_TAB: replace the coach entries with
```js
  coach: 'home', 'coach-home': 'home', 'coach-roster': 'roster',
  'coach-inbox': 'inbox', 'coach-insights': 'insights', 'coach-profile': 'profile',
  'coach-plan': 'roster',
```
(`coach-profile` keeps a tab id for stack bookkeeping even though no tab is highlighted; `coach-plan` — the standards editor — now lights the Roster tab since athletes/standards live there until Slice C.)

- [ ] **Step 2: components.js — avatarHead**

```js
/* A coach tab-root header: titleHead + the account avatar (initials) top-right.
   Profile left the tab bar (Coach OS slice A) — the avatar is its one home. */
export function avatarHead(title, sub, initials) {
  return `<div class="back-head" style="align-items:center">
    <div style="flex:1;min-width:0"><div class="ht">${esc(title)}</div>${sub ? `<div class="hs">${esc(sub)}</div>` : ''}</div>
    <div role="button" aria-label="Your profile" data-go="coach-profile"
      style="width:34px;height:34px;border-radius:50%;background:var(--blue-surface);color:var(--blue-bright);display:grid;place-items:center;font-size:12px;font-weight:800;letter-spacing:0.02em;flex:none;cursor:pointer">${esc(initials || 'C')}</div>
  </div>`;
}
```

- [ ] **Step 3: screens/index.js — registrations**

Add imports + entries (exact keys):
```js
import { coachHome } from './coach-home.js';
import { coachRoster } from './coach-roster.js';
import { coachCreate } from './coach-create.js';
import { coachInsights } from './coach-insights.js';
// …
'coach-home': coachHome, coach: coachHome,     // alias — old route renders the new Home
'coach-roster': coachRoster,
'coach-create': coachCreate,
'coach-insights': coachInsights,
```
(Tasks 7–9 create these modules; to keep every commit green, do this task's index.js/router edit in the SAME commit as Task 7's minimal modules — see Task 7 Step 5. Steps 1–2 here can commit alone since nothing references the new routes yet.)

- [ ] **Step 4: Commit (router + components only)**

```bash
git add proto/redesign-2026-07/js/router.js proto/redesign-2026-07/js/components.js
git commit -m "feat(coach-os): five-tab coach nav skeleton + avatar header helper"
```
Note: between this commit and Task 7's, the coach tabs point at unregistered routes (they fall back to `screens.home`, guarded away from coaches). That's why Task 7 lands immediately after — do not ship a build between them.

---

### Task 7: Home command center — `js/screens/coach-home.js`

**Files:**
- Create: `proto/redesign-2026-07/js/screens/coach-home.js`
- Modify: `proto/redesign-2026-07/js/screens/index.js` (Task 6 Step 3 registrations land here)
- Modify: `proto/redesign-2026-07/js/screens/coach.js` (delete the old `coach` export's roster/attention/activity sections — the module keeps its OTHER exports; `coach` key in index.js now points at coachHome)

**Interfaces:**
- Consumes: `CD`, `loadCoachRoster`, `loadActivity`, `entriesFor`, `getScope`, `setScope`, `scopeFilter` (Task 5); `buildPriorities`, `reasonKey` (Task 4); `teamPulse`, `STATUS_META` (Task 3); `roles.logIntervention`, `roles.nudgePush`, `roles.fetchTodayInterventions`; `avatarHead`.
- Produces: screen module `coachHome = { nav:'coach', tab:'home', render, mount }`.

- [ ] **Step 1: Implement the screen**

```js
import { S, RT } from '../state.js';
import { icon } from '../icons.js';
import { avatarHead, esc } from '../components.js';
import * as roles from '../roles.js';
import { CD, loadCoachRoster, loadActivity, actTime, entriesFor, getScope, setScope } from '../coach-data.js';
import { buildPriorities } from '../priority.js';
import { teamPulse, STATUS_META } from '../status.js';

const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
let SHOW_SCOPES = false;        // scope sheet open?
let SHOW_PULSE = false;         // pulse breakdown open?

function scopeLabel(scope) {
  if (!scope || scope.kind === 'team') return 'Entire team';
  if (scope.kind === 'position') return `${scope.value} room`;
  if (scope.kind === 'group') {
    const g = ((CD.extras && CD.extras.groups) || []).find(x => x.id === scope.value);
    return g ? g.name : 'Group';
  }
  if (scope.kind === 'athlete') {
    const r = CD.roster && CD.roster.rows.find(x => x.athleteId === scope.value);
    return r ? r.name : 'One athlete';
  }
  return 'Entire team';
}

function scopeSheet() {
  const rows = CD.roster ? CD.roster.rows : [];
  const positions = [...new Set(rows.map(r => (r.position || '').toUpperCase()).filter(Boolean))].sort();
  const groups = (CD.extras && CD.extras.groups) || [];
  const chip = (kind, value, label, active) => `
    <button class="btn ${active ? 'green' : 'ghost'} sm" data-scope="${esc(kind)}:${esc(value == null ? '' : value)}"
      style="width:auto;padding:0 13px;height:32px;margin:0 6px 6px 0">${esc(label)}</button>`;
  const cur = getScope();
  const is = (k, v) => cur.kind === k && String(cur.value || '') === String(v || '');
  return `
  <section class="card" style="padding:13px 16px">
    <div class="eyebrow" style="margin:0 0 8px">Who you're looking at</div>
    <div>${chip('team', '', 'Entire team', is('team', ''))}
    ${positions.map(p => chip('position', p, `${p} room`, is('position', p))).join('')}
    ${groups.map(g => chip('group', g.id, g.name, is('group', g.id))).join('')}</div>
    <div style="font-size:11.5px;color:var(--text-3);font-weight:600;margin-top:4px">Custom groups are built on the Roster tab.</div>
  </section>`;
}

function pulseCard(rows, statuses) {
  const p = teamPulse(rows, statuses, roles.todayISO());
  if (p.avg == null && !rows.length) return '';
  const delta = p.deltaVsYesterday;
  const deltaTxt = delta == null ? '' : `<span style="font-size:12px;font-weight:800;color:${delta >= 0 ? 'var(--green-bright)' : 'var(--red)'}">${delta >= 0 ? '▲' : '▼'} ${Math.abs(delta)} vs yesterday</span>`;
  const cell = (v, k, color) => `<div style="flex:1;text-align:center"><div style="font-size:17px;font-weight:800;font-variant-numeric:tabular-nums;color:${color}">${v}</div><div style="font-size:9px;font-weight:800;letter-spacing:0.1em;text-transform:uppercase;color:var(--text-3)">${k}</div></div>`;
  return `
  <section class="card" data-pulse style="padding:15px 18px;cursor:pointer">
    <div style="display:flex;align-items:center;gap:16px">
      <div style="flex:none">
        <div style="font-size:9px;font-weight:800;letter-spacing:0.14em;text-transform:uppercase;color:var(--text-3);margin-bottom:3px">Group score</div>
        <div style="font-size:42px;font-weight:800;letter-spacing:-0.04em;line-height:1;font-variant-numeric:tabular-nums;background:linear-gradient(105deg,var(--ring-a),var(--ring-b) 45%,var(--ring-c));-webkit-background-clip:text;background-clip:text;color:transparent">${p.avg != null ? p.avg : '—'}</div>
        ${deltaTxt}
      </div>
      <div style="flex:1;display:flex;border-left:1px solid var(--hairline-soft);padding-left:10px">
        ${cell(p.onStandard, 'On std', 'var(--green-bright)')}
        ${cell(p.dueSoon, 'Due soon', 'var(--amber-bright)')}
        ${cell(p.overdue, 'Overdue', 'var(--red)')}
        ${cell(p.completionPct != null ? p.completionPct + '%' : '—', 'Done', 'var(--blue-bright)')}
      </div>
    </div>
    ${SHOW_PULSE ? `
    <div style="border-top:1px solid var(--hairline-soft);margin-top:12px;padding-top:10px;font-size:12px;font-weight:600;color:var(--text-2);line-height:1.6">
      The group score is the average of today's real athlete scores (${rows.filter(r => r.score != null).length} of ${rows.length} scored so far).
      Completion counts every required item across the group — ${p.completionPct != null ? p.completionPct + '% done' : 'no requirements resolved yet'}.
      Nothing here is estimated: an athlete with no log contributes no score.
    </div>` : ''}
  </section>`;
}

function priorityCard(c, i, nudgedToday) {
  const tierMeta = { critical: ['CRITICAL', 'var(--red)'], below: ['BELOW STANDARD', 'var(--amber-bright)'], due_soon: ['DUE SOON', 'var(--blue-bright)'] }[c.tier];
  return `
  <div class="card" style="padding:13px 15px;border-left:3px solid ${tierMeta[1]}">
    <div style="display:flex;align-items:center;gap:10px;cursor:pointer" data-go="coach-athlete/${esc(c.athleteId)}">
      <span style="font-size:15px;font-weight:800;color:var(--text-3);flex:none">${i + 1}</span>
      <div style="flex:1;min-width:0">
        <div style="font-size:13.5px;font-weight:800">${esc(c.name)}${c.unit ? ` <small style="color:var(--text-3);font-weight:700">· ${esc(c.unit)}</small>` : ''} <span style="font-size:9px;font-weight:800;letter-spacing:0.1em;color:${tierMeta[1]}">${tierMeta[0]}</span></div>
        ${c.reasons.map(r => `<div style="font-size:11.5px;font-weight:600;color:var(--text-2);margin-top:2px">${esc(r)}</div>`).join('')}
        <div style="font-size:11px;font-weight:700;color:var(--blue-bright);margin-top:3px">→ ${esc(c.suggestedAction.label)}</div>
      </div>
      ${c.score != null ? `<span class="nw">${c.score}</span>` : ''}
    </div>
    <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:6px;margin-top:10px">
      <button class="btn sm" data-go="coach-athlete/${esc(c.athleteId)}" style="height:32px;font-size:11.5px">Open</button>
      <button class="btn ghost sm" data-pnudge="${esc(c.athleteId)}" data-key="${esc(c.reasonKey)}" data-tier="${esc(c.tier)}" style="height:32px;font-size:11.5px" ${nudgedToday ? 'disabled' : ''}>${nudgedToday ? 'Nudged ✓' : 'Nudge'}</button>
      <button class="btn ghost sm" data-passign="${esc(c.athleteId)}" data-key="${esc(c.reasonKey)}" data-tier="${esc(c.tier)}" style="height:32px;font-size:11.5px">Assign</button>
      <button class="btn ghost sm" data-phandle="${esc(c.athleteId)}" data-key="${esc(c.reasonKey)}" data-tier="${esc(c.tier)}" style="height:32px;font-size:11.5px">Handled</button>
    </div>
  </div>`;
}

export const coachHome = {
  nav: 'coach', tab: 'home',
  render() {
    const teamName = CD.roster && CD.roster.teams[0] ? CD.roster.teams[0].name : (S.athlete.school || 'Your team');
    const initials = (S.coachIdentity.handle || 'C').replace(/coach\s*/i, '').slice(0, 2).toUpperCase();
    const scope = getScope();
    const head = avatarHead(`${S.greeting}, ${S.coachIdentity.handle}`, `${teamName} · ${scopeLabel(scope)} · today`, initials);
    if (CD.roster === null) return `${head}
      <div class="sidebox"><div class="req-icon b" style="width:38px;height:38px">${icon('users', 17)}</div>
      <div><div class="tt">Loading your team…</div><div class="ts">Pulling today's real numbers.</div></div></div>`;
    if (CD.roster.offline) return `${head}
      <div class="state-demo"><div class="sd-ic">${icon('wifiOff', 24)}</div>
      <div class="sd-t">Can't reach your team</div>
      <div class="sd-s">Check your connection — reopen to retry. Nothing is lost.</div></div>`;
    if (!CD.roster.rows.length) return `${head}
      <div class="state-demo" data-go="coach-profile" style="cursor:pointer"><div class="sd-ic">${icon('users', 24)}</div>
      <div class="sd-t">No athletes yet</div>
      <div class="sd-s">Share your team code so athletes can join. Your command center lights up as they log.</div>
      ${RT.team && RT.team.code ? `<div class="sd-cta"><span class="btn ghost sm" style="width:auto;padding:0 14px;letter-spacing:0.18em;font-weight:800">${esc(RT.team.code)}</span></div>` : ''}</div>`;

    const entries = entriesFor(scope);
    const statuses = {}; if (entries) for (const e of entries) statuses[e.row.athleteId] = e.status;
    const rows = entries ? entries.map(e => e.row) : [];
    const cards = entries ? buildPriorities({ nowMin: new Date().getHours() * 60 + new Date().getMinutes(), entries, interventions: (CD.extras && CD.extras.interventions) || [] }) : [];
    const pending = CD.roster.pending || [];
    const seen = new Set(RT.coachSeenMealIds || []);
    const act = CD.act && CD.act.rows ? CD.act.rows.filter(m => rows.some(r => r.athleteId === m.athlete_id)) : null;
    const unseen = act ? act.filter(m => !seen.has(m.id)).length : 0;
    const followUps = [
      unseen ? { n: unseen, t: `log${unseen > 1 ? 's' : ''} you haven't opened`, go: 'coach-inbox' } : null,
      pending.length ? { n: pending.length, t: `join request${pending.length > 1 ? 's' : ''} waiting`, go: 'coach-inbox' } : null,
      cards.length ? { n: cards.length, t: `priorit${cards.length > 1 ? 'ies' : 'y'} not handled yet`, go: null } : null,
    ].filter(Boolean);

    return `${head}
    <button class="btn ghost sm" data-scopes style="width:auto;padding:0 13px;height:30px;margin-bottom:10px">${icon('users', 13)} ${esc(scopeLabel(scope))} ▾</button>
    ${SHOW_SCOPES ? scopeSheet() : ''}
    ${pending.length ? `<div class="card" data-go="coach-inbox" style="padding:10px 15px;cursor:pointer;display:flex;align-items:center;gap:10px"><div class="lic" style="background:var(--blue-surface);color:var(--blue-bright)">${icon('user', 15)}</div><div style="flex:1;font-size:12.5px;font-weight:700">${pending.length} join request${pending.length > 1 ? 's' : ''} waiting</div><span style="color:var(--text-3)">›</span></div>` : ''}
    ${entries === null ? '' : pulseCard(rows, statuses)}

    <div class="eyebrow">Coach priorities</div>
    ${entries === null ? `<div class="sidebox"><div class="req-icon b" style="width:38px;height:38px">${icon('bell', 17)}</div><div><div class="tt">Ranking the day…</div><div class="ts">Standards and exceptions are loading.</div></div></div>`
    : cards.length === 0 ? `<div style="font-size:12px;font-weight:600;color:var(--text-3);margin:0 2px 4px;line-height:1.4">Nothing needs you right now. Anything you nudge, assign, or mark handled stays out of this queue until the reason changes.</div>`
    : cards.slice(0, 6).map((c, i) => priorityCard(c, i, (RT.coachNudged || {})[c.athleteId] === new Date().toISOString().slice(0, 10))).join('')}

    <div class="eyebrow" style="display:flex;justify-content:space-between;align-items:baseline"><span>Live activity</span>${unseen ? `<span style="color:var(--blue-bright)">${unseen} new</span>` : ''}</div>
    ${act === null ? `<div style="font-size:12px;font-weight:600;color:var(--text-3);margin:0 2px 4px">Loading the feed…</div>`
    : act.length === 0 ? `<div style="font-size:12px;font-weight:600;color:var(--text-3);margin:0 2px 4px;line-height:1.4">No logs yet ${scope.kind === 'team' ? 'today' : 'in this group today'}. Every meal lands here the moment it's logged.</div>`
    : `<div style="display:flex;gap:9px;overflow-x:auto;padding-bottom:4px;margin:0 -2px">${act.slice(0, 12).map(m => {
        const who = rows.find(r => r.athleteId === m.athlete_id) || {};
        const photo = CD.act.photos[m.id];
        const bits = [cap(m.type || 'Meal'), actTime(m.logged_at)].filter(Boolean);
        return `<div class="act-card" data-go="coach-meal/${esc(m.id)}" style="position:relative;flex:0 0 47%">
          ${photo ? `<div class="act-media" style="height:64px;background-image:url('${esc(photo)}');background-size:cover;background-position:center"></div>` : `<div class="act-media" style="height:64px;background:linear-gradient(150deg,var(--surface-2),var(--surface-3))"></div>`}
          ${seen.has(m.id) ? '' : `<span style="position:absolute;top:7px;right:7px;width:9px;height:9px;border-radius:50%;background:var(--blue-bright);box-shadow:0 0 9px rgba(96,165,250,0.7);border:2px solid rgba(5,8,15,0.8)"></span>`}
          <div style="padding:8px 10px 9px"><div style="font-size:11px;font-weight:800">${esc((who.name || 'Athlete').split(' ')[0])}</div>
          <div style="font-size:9.5px;color:var(--text-3);font-weight:700;margin-top:2px">${esc(bits.join(' · '))}</div></div>
        </div>`;
      }).join('')}</div>`}

    <div class="eyebrow">Follow-ups</div>
    ${followUps.length === 0 ? `<div style="font-size:12px;font-weight:600;color:var(--text-3);margin:0 2px 4px">All caught up.</div>`
    : `<section class="card" style="padding:6px 16px">${followUps.map(f => `
      <div class="lrow" ${f.go ? `data-go="${f.go}" style="cursor:pointer"` : 'style="cursor:default"'}>
        <div class="lic" style="background:var(--blue-surface);color:var(--blue-bright)"><b>${f.n}</b></div>
        <div class="lm"><div class="lt" style="text-transform:capitalize">${esc(f.t)}</div></div>
        ${f.go ? '<span style="color:var(--text-3)">›</span>' : ''}
      </div>`).join('')}</section>`}
    <div style="height:10px"></div>`;
  },
  mount(root) {
    loadCoachRoster().then(() => loadActivity());
    root.querySelectorAll('[data-scopes]').forEach(b => b.addEventListener('click', () => { SHOW_SCOPES = !SHOW_SCOPES; window.__render(); }));
    root.querySelectorAll('[data-pulse]').forEach(b => b.addEventListener('click', () => { SHOW_PULSE = !SHOW_PULSE; window.__render(); }));
    root.querySelectorAll('[data-scope]').forEach(b => b.addEventListener('click', () => {
      const [kind, value] = b.getAttribute('data-scope').split(':');
      setScope({ kind: kind || 'team', value: value || null }); SHOW_SCOPES = false; window.__render();
    }));
    const teamId = CD.roster && CD.roster.teams[0] && CD.roster.teams[0].id;
    const log = async (athleteId, kind, b) => {
      const reasonKey = b.getAttribute('data-key'), tier = b.getAttribute('data-tier');
      await roles.logIntervention({ teamId, athleteId, kind, reasonKey, tier });
      if (CD.extras) CD.extras.interventions.push({ athlete_id: athleteId, kind, reason_key: reasonKey, tier });
    };
    root.querySelectorAll('[data-phandle]').forEach(b => b.addEventListener('click', async () => {
      b.disabled = true; b.textContent = '…';
      await log(b.getAttribute('data-phandle'), 'handled', b);
      window.__render();
    }));
    root.querySelectorAll('[data-pnudge]').forEach(b => b.addEventListener('click', async () => {
      const id = b.getAttribute('data-pnudge');
      b.disabled = true; b.textContent = '…';
      const ok = await roles.nudgePush(id, `${S.coachIdentity.handle} is waiting`, 'Your log is overdue. Get it in.');
      if (ok) { const { act } = await import('../state.js'); act.markNudged(id); await log(id, 'nudge', b); }
      window.__render();
    }));
    root.querySelectorAll('[data-passign]').forEach(b => b.addEventListener('click', async () => {
      const id = b.getAttribute('data-passign');
      await log(id, 'assign', b);
      window.__go(`coach-assign/${id}`);
    }));
  },
};
```
Also in this task: in `coach.js`, delete the old `coach` screen object's body (lines 84-242) — replace the export with `export { coachHome as coach } from './coach-home.js';` is NOT valid for the index.js pattern; instead simply delete the `coach` export and let index.js point key `coach` at `coachHome` (Task 6 Step 3). Keep `loadCoachRoster` re-export and all other exports (`coachAssign`, `coachPlan`, `coachInbox`, `copilot`, `coachAthlete`, `coachMeal`, `trainer`, …) untouched.

- [ ] **Step 2: Register everything (Task 6 Step 3 edits) + create minimal `coach-create.js` / `coach-insights.js` stubs so imports resolve** (their real bodies land in Tasks 8–9; stubs render `backHead('Create','', 'coach-home')` + empty card, honest not fake)

- [ ] **Step 3: Build + verify**

Run: `node scripts/build-proto-zip.mjs && npm run verify`
Expected: zip rebuilt, verify green

- [ ] **Step 4: Commit**

```bash
git add proto/redesign-2026-07/js/screens/coach-home.js proto/redesign-2026-07/js/screens/coach-create.js proto/redesign-2026-07/js/screens/coach-insights.js proto/redesign-2026-07/js/screens/index.js proto/redesign-2026-07/js/screens/coach.js src/proto/protoVersion.ts assets/proto.zip
git commit -m "feat(coach-os): Home command center — scope selector, pulse, priority queue, follow-ups"
```

---

### Task 8: Roster tab — `js/screens/coach-roster.js`

**Files:**
- Create: `proto/redesign-2026-07/js/screens/coach-roster.js`
- Modify: `proto/redesign-2026-07/js/screens/index.js` (point `coach-roster` at the real module)

**Interfaces:**
- Consumes: `CD`, `entriesFor`, `getScope` (whole-team by default here — roster always shows the full visible roster; the FILTER chips do scoping locally), `STATUS_META`, `roles.saveCoachGroup`, `roles.deleteCoachGroup`, `roles.saveAthleteException`, `roles.nudgePush`, `roles.logIntervention`.
- Produces: `coachRoster = { nav:'coach', tab:'roster', render, mount }`.

Local UI state (module-level): `Q` (search string), `SORT` (`'score'|'status'|'name'|'activity'`), `FILTER` (`{kind:'all'|'position'|'group'|'status', value}`), `SELECTING` (bool), `SEL` (Set of athleteIds), `SHOW_GROUPS`, `SHOW_ABSENCE`.

- [ ] **Step 1: Implement**

```js
import { RT, S } from '../state.js';
import { icon } from '../icons.js';
import { avatarHead, esc } from '../components.js';
import * as roles from '../roles.js';
import { CD, loadCoachRoster, entriesFor } from '../coach-data.js';
import { STATUS_META } from '../status.js';

let Q = '', SORT = 'score', FILTER = { kind: 'all', value: null };
let SELECTING = false; const SEL = new Set();
let SHOW_GROUPS = false, SHOW_ABSENCE = false, BULK_STATUS = '';

const STATUS_ORDER = ['overdue', 'no_activity', 'needs_review', 'below_standard', 'due_soon', 'excused', 'on_standard'];

function sparkline(hist) {
  const pts = (hist || []).filter(h => h.score != null).slice(-7);
  if (pts.length < 2) return `<span style="font-size:10px;color:var(--text-3);font-weight:700">—</span>`;
  const w = 44, h = 16, min = 0, max = 100;
  const xy = pts.map((p, i) => `${(i / (pts.length - 1)) * w},${h - ((p.score - min) / (max - min)) * h}`).join(' ');
  const up = pts[pts.length - 1].score >= pts[0].score;
  return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" aria-hidden="true"><polyline points="${xy}" fill="none" stroke="${up ? 'var(--green-bright)' : 'var(--red)'}" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round" opacity="0.85"/></svg>`;
}

function lastActivityLabel(iso) {
  if (!iso) return 'No recent activity';
  const h = Math.floor((Date.now() - new Date(iso).getTime()) / 3600000);
  if (h < 1) return 'Active just now';
  if (h < 24) return `Active ${h}h ago`;
  return `Active ${Math.floor(h / 24)}d ago`;
}

function applyView(entries) {
  let list = entries;
  const q = Q.trim().toLowerCase();
  if (q) list = list.filter(e => e.row.name.toLowerCase().includes(q));
  if (FILTER.kind === 'position') list = list.filter(e => (e.row.position || '').toUpperCase() === FILTER.value);
  if (FILTER.kind === 'group') {
    const g = ((CD.extras && CD.extras.groups) || []).find(x => x.id === FILTER.value);
    const ids = new Set((g && g.athlete_ids) || []);
    list = list.filter(e => ids.has(e.row.athleteId));
  }
  if (FILTER.kind === 'status') list = list.filter(e => e.status.key === FILTER.value);
  const by = {
    score: (a, b) => (b.row.score ?? -1) - (a.row.score ?? -1),
    status: (a, b) => STATUS_ORDER.indexOf(a.status.key) - STATUS_ORDER.indexOf(b.status.key),
    name: (a, b) => a.row.name.localeCompare(b.row.name),
    activity: (a, b) => String(b.row.lastMealAt || '').localeCompare(String(a.row.lastMealAt || '')),
  };
  return [...list].sort(by[SORT] || by.score);
}

function rosterRow(e) {
  const r = e.row, st = e.status, meta = STATUS_META[st.key];
  const sel = SEL.has(r.athleteId);
  return `
  <div class="roster-row" ${SELECTING ? `data-sel="${esc(r.athleteId)}"` : `data-go="coach-athlete/${esc(r.athleteId)}"`}>
    ${SELECTING ? `<div style="width:20px;height:20px;border-radius:6px;border:2px solid ${sel ? 'var(--green-bright)' : 'var(--hairline)'};background:${sel ? 'var(--green-bright)' : 'transparent'};display:grid;place-items:center;flex:none">${sel ? '✓' : ''}</div>` : `<div class="flagdot ${r.flag}"></div>`}
    <div class="rn">
      <div class="t">${esc(r.name)}${r.unit ? ` <small style="color:var(--text-3);font-weight:700">· ${esc(r.unit)}</small>` : ''}</div>
      <div class="s"><span style="color:${meta.color};font-weight:800">${meta.label}</span> · ${esc(lastActivityLabel(r.lastMealAt))}</div>
    </div>
    ${sparkline(r.scoreHistory)}
    <span class="rs" style="color:${r.score == null ? 'var(--text-3)' : r.score >= 80 ? 'var(--green-bright)' : r.score >= 60 ? 'var(--amber-bright)' : 'var(--red)'};margin-left:8px">${r.score != null ? r.score : '—'}</span>
  </div>`;
}

export const coachRoster = {
  nav: 'coach', tab: 'roster',
  render() {
    const initials = (S.coachIdentity.handle || 'C').replace(/coach\s*/i, '').slice(0, 2).toUpperCase();
    const head = avatarHead('Roster', CD.roster && CD.roster.teams[0] ? CD.roster.teams[0].name : '', initials);
    if (CD.roster === null || !CD.extras) return `${head}<div class="sidebox"><div class="req-icon b" style="width:38px;height:38px">${icon('users', 17)}</div><div><div class="tt">Loading the roster…</div><div class="ts">Real statuses, real scores.</div></div></div>`;
    if (CD.roster.offline) return `${head}<div class="state-demo"><div class="sd-ic">${icon('wifiOff', 24)}</div><div class="sd-t">Can't reach the roster</div><div class="sd-s">Check your connection and reopen.</div></div>`;
    const entries = entriesFor({ kind: 'team', value: null }) || [];
    if (!entries.length) return `${head}<div class="state-demo"><div class="sd-ic">${icon('users', 24)}</div><div class="sd-t">No athletes yet</div><div class="sd-s">Share your team code from your profile — every athlete who joins shows up here.</div></div>`;

    const positions = [...new Set(entries.map(e => (e.row.position || '').toUpperCase()).filter(Boolean))].sort();
    const groups = (CD.extras && CD.extras.groups) || [];
    const list = applyView(entries);
    const fchip = (kind, value, label) => {
      const on = FILTER.kind === kind && String(FILTER.value || '') === String(value || '');
      return `<button class="btn ${on ? 'green' : 'ghost'} sm" data-filter="${esc(kind)}:${esc(value == null ? '' : value)}" style="width:auto;padding:0 11px;height:29px;flex:none">${esc(label)}</button>`;
    };
    return `${head}
    <div style="display:flex;gap:7px;margin-bottom:8px">
      <input class="ob-input" id="roster-q" placeholder="Search athletes" value="${esc(Q)}" style="flex:1;height:36px" />
      <button class="btn ghost sm" data-sort style="width:auto;padding:0 11px;height:36px">${{ score: 'Score ↓', status: 'Status', name: 'A–Z', activity: 'Recent' }[SORT]}</button>
      <button class="btn ${SELECTING ? 'green' : 'ghost'} sm" data-selmode style="width:auto;padding:0 11px;height:36px">${SELECTING ? 'Done' : 'Select'}</button>
    </div>
    <div style="display:flex;gap:6px;overflow-x:auto;padding-bottom:6px;margin:0 -2px 4px">
      ${fchip('all', '', 'All')}${STATUS_ORDER.map(k => fchip('status', k, STATUS_META[k].label)).join('')}${positions.map(p => fchip('position', p, p)).join('')}${groups.map(g => fchip('group', g.id, g.name)).join('')}
      <button class="btn ghost sm" data-groups style="width:auto;padding:0 11px;height:29px;flex:none">＋ Group</button>
    </div>
    ${SHOW_GROUPS ? groupSheet(entries, groups) : ''}
    ${SHOW_ABSENCE ? absenceSheet() : ''}
    <section class="card" style="padding:2px 0">${list.length ? list.map(rosterRow).join('') : `<div style="padding:18px;text-align:center;font-size:12px;font-weight:600;color:var(--text-3)">No one matches that filter.</div>`}</section>
    ${SELECTING && SEL.size ? `
    <div class="card" style="position:sticky;bottom:8px;display:grid;grid-template-columns:repeat(4,1fr);gap:6px;padding:9px">
      <button class="btn sm" data-bulk="nudge" style="height:34px;font-size:11.5px">Nudge ${SEL.size}</button>
      <button class="btn ghost sm" data-bulk="assign" style="height:34px;font-size:11.5px">Assign</button>
      <button class="btn ghost sm" data-bulk="group" style="height:34px;font-size:11.5px">→ Group</button>
      <button class="btn ghost sm" data-bulk="absence" style="height:34px;font-size:11.5px">Excuse</button>
    </div>
    <div id="bulk-status" style="font-size:11.5px;font-weight:600;color:var(--text-3);min-height:14px;margin-top:4px">${esc(BULK_STATUS)}</div>` : ''}
    <div style="height:10px"></div>`;
  },
  mount(root) {
    loadCoachRoster();
    const q = root.querySelector('#roster-q');
    if (q) q.addEventListener('input', () => { Q = q.value; window.__render(); });
    root.querySelectorAll('[data-sort]').forEach(b => b.addEventListener('click', () => {
      SORT = { score: 'status', status: 'name', name: 'activity', activity: 'score' }[SORT]; window.__render();
    }));
    root.querySelectorAll('[data-selmode]').forEach(b => b.addEventListener('click', () => { SELECTING = !SELECTING; if (!SELECTING) SEL.clear(); BULK_STATUS = ''; window.__render(); }));
    root.querySelectorAll('[data-sel]').forEach(b => b.addEventListener('click', () => {
      const id = b.getAttribute('data-sel'); SEL.has(id) ? SEL.delete(id) : SEL.add(id); window.__render();
    }));
    root.querySelectorAll('[data-filter]').forEach(b => b.addEventListener('click', () => {
      const [kind, value] = b.getAttribute('data-filter').split(':');
      FILTER = kind === 'all' ? { kind: 'all', value: null } : { kind, value: value || null }; window.__render();
    }));
    root.querySelectorAll('[data-groups]').forEach(b => b.addEventListener('click', () => { SHOW_GROUPS = !SHOW_GROUPS; window.__render(); }));
    const teamId = CD.roster && CD.roster.teams[0] && CD.roster.teams[0].id;
    root.querySelectorAll('[data-bulk]').forEach(b => b.addEventListener('click', async () => {
      const kind = b.getAttribute('data-bulk'); const ids = [...SEL];
      if (kind === 'nudge') {
        b.disabled = true; BULK_STATUS = 'Sending…'; window.__render();
        for (const id of ids) { await roles.nudgePush(id, `${S.coachIdentity.handle} is waiting`, 'Your log is overdue. Get it in.'); await roles.logIntervention({ teamId, athleteId: id, kind: 'nudge' }); }
        BULK_STATUS = `Nudged ${ids.length}.`; SEL.clear(); SELECTING = false; window.__render();
      } else if (kind === 'assign') {
        window.__go('coach-assign');   // composer already supports team/room scope; per-athlete multi-target lands with Create (slice C)
      } else if (kind === 'group') {
        SHOW_GROUPS = true; window.__render();
      } else if (kind === 'absence') {
        SHOW_ABSENCE = true; window.__render();
      }
    }));
    wireGroupSheet(root, teamId);
    wireAbsenceSheet(root, teamId);
  },
};
```

The two sheets, in the same file:

```js
function groupSheet(entries, groups) {
  return `
  <section class="card" style="padding:13px 16px">
    <div class="eyebrow" style="margin:0 0 8px">Custom groups</div>
    ${groups.map(g => `
    <div class="lrow" style="cursor:default">
      <div class="lm"><div class="lt">${esc(g.name)}</div><div class="ls">${(g.athlete_ids || []).length} athletes</div></div>
      ${SEL.size ? `<button class="btn ghost sm" data-gadd="${esc(g.id)}" style="width:auto;padding:0 10px;height:30px">Add ${SEL.size}</button>` : ''}
      <button class="btn ghost sm" data-gdel="${esc(g.id)}" style="width:auto;padding:0 10px;height:30px;margin-left:6px;color:var(--red)">Delete</button>
    </div>`).join('') || `<div style="font-size:12px;font-weight:600;color:var(--text-3)">No groups yet.</div>`}
    <div style="display:flex;gap:7px;margin-top:10px">
      <input class="ob-input" id="group-name" maxlength="40" placeholder="New group name" style="flex:1;height:36px" />
      <button class="btn green sm" data-gnew style="width:auto;padding:0 12px;height:36px" ${SEL.size ? '' : 'disabled'}>Create with ${SEL.size || 0}</button>
    </div>
    <div id="group-status" style="font-size:11.5px;font-weight:600;color:var(--text-3);min-height:14px;margin-top:5px"></div>
  </section>`;
}
function wireGroupSheet(root, teamId) {
  const status = (msg, bad) => { const el = root.querySelector('#group-status'); if (el) { el.style.color = bad ? 'var(--red)' : 'var(--green-bright)'; el.textContent = msg; } };
  root.querySelectorAll('[data-gnew]').forEach(b => b.addEventListener('click', async () => {
    const name = ((root.querySelector('#group-name') || {}).value || '').trim();
    if (!name) { status('Name the group first.', true); return; }
    b.disabled = true;
    const r = await roles.saveCoachGroup(teamId, { name, athleteIds: [...SEL] });
    if (r.ok) { SEL.clear(); SELECTING = false; SHOW_GROUPS = false; await loadCoachRoster(true); }
    else { b.disabled = false; status(r.error || 'Could not save the group — check your connection.', true); }
  }));
  root.querySelectorAll('[data-gadd]').forEach(b => b.addEventListener('click', async () => {
    const g = ((CD.extras && CD.extras.groups) || []).find(x => x.id === b.getAttribute('data-gadd'));
    if (!g) return;
    b.disabled = true;
    const merged = [...new Set([...(g.athlete_ids || []), ...SEL])];
    const r = await roles.saveCoachGroup(teamId, { id: g.id, name: g.name, athleteIds: merged });
    if (r.ok) { SEL.clear(); SELECTING = false; await loadCoachRoster(true); }
    else { b.disabled = false; status(r.error || 'Could not update the group.', true); }
  }));
  root.querySelectorAll('[data-gdel]').forEach(b => b.addEventListener('click', async () => {
    b.disabled = true;
    const ok = await roles.deleteCoachGroup(b.getAttribute('data-gdel'));
    if (ok) { if (FILTER.kind === 'group') FILTER = { kind: 'all', value: null }; await loadCoachRoster(true); }
    else { b.disabled = false; status('Could not delete it — check your connection.', true); }
  }));
}
function absenceSheet() {
  return `
  <section class="card" style="padding:13px 16px">
    <div class="eyebrow" style="margin:0 0 8px">Excuse ${SEL.size} athlete${SEL.size > 1 ? 's' : ''}</div>
    <div style="font-size:12px;font-weight:600;color:var(--text-2);line-height:1.5;margin-bottom:8px">Excused athletes drop out of the priority queue and today's completion math — and nothing pings them while excused.</div>
    <input class="ob-input" id="abs-reason" maxlength="120" placeholder="Reason (travel, injury, family…)" style="height:36px" />
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:7px;margin-top:8px">
      <button class="btn sm" data-abs="0" style="height:34px;font-size:12px">Just today</button>
      <button class="btn ghost sm" data-abs="6" style="height:34px;font-size:12px">Through the week</button>
    </div>
    <div id="abs-status" style="font-size:11.5px;font-weight:600;color:var(--text-3);min-height:14px;margin-top:5px"></div>
  </section>`;
}
function wireAbsenceSheet(root, teamId) {
  root.querySelectorAll('[data-abs]').forEach(b => b.addEventListener('click', async () => {
    const days = +b.getAttribute('data-abs');
    const reason = ((root.querySelector('#abs-reason') || {}).value || '').trim();
    const end = new Date(); end.setDate(end.getDate() + days);
    const endISO = `${end.getFullYear()}-${String(end.getMonth() + 1).padStart(2, '0')}-${String(end.getDate()).padStart(2, '0')}`;
    b.disabled = true;
    let failed = 0;
    for (const id of [...SEL]) {
      const r = await roles.saveAthleteException(teamId, id, roles.todayISO(), endISO, reason);
      if (!r.ok) failed++;
    }
    const el = root.querySelector('#abs-status');
    if (failed) { b.disabled = false; if (el) { el.style.color = 'var(--red)'; el.textContent = `Could not excuse ${failed} — check your connection.`; } return; }
    SEL.clear(); SELECTING = false; SHOW_ABSENCE = false;
    await loadCoachRoster(true);
  }));
}
```

Known simplification (deliberate, matches spec priority §"relevant meal photo"): slice A priority cards carry reason/score/action but not an inline meal photo — the photo lives one tap away (Open → athlete profile / activity feed). Slice B's athlete profile brings the photo into the review path; revisit inline thumbnails then if the founder wants them on the card itself.

- [ ] **Step 2: Build + verify + suite**

Run: `node scripts/build-proto-zip.mjs && npm run verify && npx jest`
Expected: green

- [ ] **Step 3: Commit**

```bash
git add proto/redesign-2026-07/js/screens/coach-roster.js proto/redesign-2026-07/js/screens/index.js src/proto/protoVersion.ts assets/proto.zip
git commit -m "feat(coach-os): Roster tab — search, statuses, filters, sparklines, groups, bulk actions"
```

---

### Task 9: Create sheet + Insights starter (real content only)

**Files:**
- Modify: `proto/redesign-2026-07/js/screens/coach-create.js` (replace Task 7 stub)
- Modify: `proto/redesign-2026-07/js/screens/coach-insights.js` (replace Task 7 stub)

**Interfaces:**
- Consumes: `CD`, `backHead`, existing routes `coach-assign`, `coach-plan`, `coach-profile`; the `copilot` summary logic pattern (`coach.js:864-914` — deterministic counts, no narration).
- Produces: `coachCreate` (transient create menu — every option routes to a REAL existing destination), `coachInsights` (deterministic "Today's read" + honest unlock note for trends).

- [ ] **Step 1: coach-create.js** — a menu of real destinations, no dead options:

```js
import { backHead, esc } from '../components.js';
import { icon } from '../icons.js';
import { RT } from '../state.js';

/* The + is a CREATE MENU now, not a single composer (Coach OS spec §3). Slice A ships
   the options that have real destinations today; announcements, check-ins, and schedule
   adjustments arrive with slice C — they are NOT listed until they exist. */
const OPTIONS = [
  { icon: 'clipboard', title: 'Assign a requirement', sub: 'Team, room, group, or one athlete', go: 'coach-assign' },
  { icon: 'message',   title: 'Message an athlete',   sub: 'Pick from the roster',              go: 'coach-roster' },
  { icon: 'bars',      title: 'Standards',            sub: 'Meals, weigh-ins, check-ins by room', go: 'coach-plan' },
  { icon: 'user',      title: 'Add an athlete',       sub: 'Share your team code',              go: 'coach-profile' },
  { icon: 'users',     title: 'Invite staff',         sub: 'Assistant or dietitian codes',      go: 'coach-profile' },
];

export const coachCreate = {
  nav: 'coach', tab: 'create', transient: true,
  render() {
    return `${backHead('Create', 'What do you want to put in motion?', 'coach-home')}
    <section class="card" style="padding:6px 16px">
      ${OPTIONS.map(o => `
      <div class="lrow" data-go="${o.go}" style="cursor:pointer">
        <div class="lic" style="background:var(--blue-surface);color:var(--blue-bright)">${icon(o.icon, 17)}</div>
        <div class="lm"><div class="lt">${esc(o.title)}</div><div class="ls">${esc(o.sub)}</div></div>
        <span style="color:var(--text-3)">›</span>
      </div>`).join('')}
    </section>`;
  },
};
```

- [ ] **Step 2: coach-insights.js** — deterministic reads only (move/adapt the `copilot` count logic):

```js
import { S } from '../state.js';
import { icon } from '../icons.js';
import { avatarHead, esc } from '../components.js';
import { CD, loadCoachRoster, entriesFor } from '../coach-data.js';
import { STATUS_META } from '../status.js';

/* Insights v1 starter (slice A): today's deterministic read over the real roster.
   Weekly trends / most-missed / movers land in slice E — the unlock note below is
   honest about that, and coach_interventions is ALREADY recording so slice E's
   "did the intervention work?" has history from today forward. */
export const coachInsights = {
  nav: 'coach', tab: 'insights',
  render() {
    const initials = (S.coachIdentity.handle || 'C').replace(/coach\s*/i, '').slice(0, 2).toUpperCase();
    const head = avatarHead('Insights', 'What the numbers say', initials);
    if (CD.roster === null || !CD.extras) return `${head}<div class="sidebox"><div class="req-icon b" style="width:38px;height:38px">${icon('bars', 17)}</div><div><div class="tt">Reading the day…</div></div></div>`;
    const entries = entriesFor({ kind: 'team', value: null }) || [];
    const by = (k) => entries.filter(e => e.status.key === k);
    const lines = [];
    if (by('overdue').length) lines.push(`${by('overdue').length} athlete${by('overdue').length > 1 ? 's are' : ' is'} overdue right now: ${by('overdue').slice(0, 3).map(e => e.row.name.split(' ')[0]).join(', ')}${by('overdue').length > 3 ? '…' : ''}.`);
    if (by('no_activity').length) lines.push(`${by('no_activity').length} ${by('no_activity').length > 1 ? 'have' : 'has'} no activity in the last day.`);
    if (by('below_standard').length) lines.push(`${by('below_standard').length} logged below the standard today.`);
    const top = entries.filter(e => e.row.score != null).sort((a, b) => b.row.score - a.row.score)[0];
    if (top) lines.push(`${top.row.name} leads the day at ${top.row.score}.`);
    if (!lines.length) lines.push(entries.length ? 'Quiet so far — no logs yet today.' : 'No athletes on the roster yet.');
    return `${head}
    <div class="eyebrow">Today's read</div>
    <section class="card" style="padding:13px 16px">
      ${lines.map(l => `<div style="font-size:13px;font-weight:600;color:var(--text-2);line-height:1.55;margin:3px 0">· ${esc(l)}</div>`).join('')}
      <div style="font-size:10.5px;color:var(--text-3);font-weight:700;margin-top:8px">Computed from your roster's real logs — nothing here is generated.</div>
    </section>
    <div class="eyebrow">This week</div>
    <div class="sidebox"><div class="req-icon b" style="width:38px;height:38px">${icon('bars', 17)}</div>
    <div><div class="tt">Trends unlock as history builds</div>
    <div class="ts">Weekly change, most-missed requirements, and whether your nudges are working — this screen fills in from your team's real data. Every action you take is already being recorded toward it.</div></div></div>
    <div style="height:10px"></div>`;
  },
  mount() { loadCoachRoster(); },
};
```

- [ ] **Step 3: Build + verify + suite**

Run: `node scripts/build-proto-zip.mjs && npm run verify && npx jest`
Expected: green

- [ ] **Step 4: Commit**

```bash
git add proto/redesign-2026-07/js/screens/coach-create.js proto/redesign-2026-07/js/screens/coach-insights.js src/proto/protoVersion.ts assets/proto.zip
git commit -m "feat(coach-os): Create menu (real destinations) + Insights starter (deterministic read)"
```

---

### Task 10: Sweep stale coach chrome + old-route integrity

**Files:**
- Modify: `proto/redesign-2026-07/js/screens/roles.js:915-923` (coach profile "Team settings" links: `coach-plan` label becomes "Standards"; add "Insights" link `coach-insights`; keep the rest)
- Modify: any remaining `data-go="coach"` / `tab:'team'` stragglers

**Interfaces:** none new — this is integrity work.

- [ ] **Step 1: Sweep**

Run: `rg -n "data-go=\"coach\"|tab: 'team'|tab:'team'" proto/redesign-2026-07/js/`
For every hit: `data-go="coach"` may stay (alias renders Home) but update to `coach-home` for clarity; any screen declaring `tab:'team'` (e.g. `coachAthlete`, `coachMeal` in coach.js) changes to `tab:'roster'` so drill-downs light the Roster tab. `copilot`'s screen registration stays routable (it's detabbed already).

- [ ] **Step 2: Manually trace the guard paths**

Read `router.js:167-179` mirror guards + `routeForRole` in state.js: confirm a coach booting with a stale `#coach` hash lands on Home (alias), and a trainer/athlete never renders the new screens (all declare `nav:'coach'` — the existing guard covers them). If `routeForRole` returns `'coach'`, leave it (alias) — no edit needed.

- [ ] **Step 3: Build + verify + full suite + commit**

```bash
node scripts/build-proto-zip.mjs && npm run verify && npx jest
git add -u proto/redesign-2026-07 src/proto/protoVersion.ts assets/proto.zip
git commit -m "chore(coach-os): drill-downs light Roster tab; stale coach-route sweep"
```

---

### Task 11: Browser smoke test (the proof)

**Files:** none (scratchpad screenshots only)

- [ ] **Step 1: Serve + seed** per the memory recipe: `python -m http.server 8127` in `proto/redesign-2026-07`, Playwright MCP → seed `localStorage['onstd-proto-rt-v1']` with `{userId:'smoke-coach', authRole:'coach', profile:{}}` and reload in the SAME evaluate call. Replace `window.sb` with the thenable-Proxy fake client keyed by table/rpc name (memory: proto-webview-audit-and-smoke) returning: `team_roster` → 4 athletes (two positions), `days` → mixed rows (one overdue-shaped: tasks `[{id:'breakfast',done:false},{id:'lunch',done:false}]`, one 90-scorer), `requirement_sets` → `[]` (falls back to catalog), `coach_interventions`/`coach_groups`/`athlete_exceptions` → `[]`, `meals` → 2 rows. Then `const cd = await import('./js/coach-data.js'); await cd.loadCoachRoster(true);` and navigate by hash.

- [ ] **Step 2: Walk all five tabs + interactions.** Verify, screenshotting each (`scratchpad/coach-os-a-{tab}.png`):
  1. `#coach-home` — greeting header with avatar chip, scope chip, pulse card with 4 cells, priority cards ranked (the no-log athlete ABOVE the below-standard one), follow-ups.
  2. Tap a priority card's **Handled** → card leaves the queue (stub insert resolves ok), queue re-renders without it.
  3. Scope chip → pick a position room → pulse + priorities + activity all shrink to that room.
  4. `#coach-roster` — statuses per row, search narrows, sort cycles, Select → bulk bar appears.
  5. `#coach-create` — five options, each `data-go` target renders.
  6. `#coach-insights` — deterministic lines match the seeded roster (e.g. "1 athlete is overdue").
  7. `#coach` (old route) — renders Home (alias works).
  Remember the stub caveat: `.eq()` filters are ignored — cross-athlete bleed on drill-downs is a stub artifact, not a bug. After any suspicious finding: `fetch(path,{cache:'reload'})` + reload before reporting.

- [ ] **Step 3: Fix anything found, rebuild zip, re-verify, commit fixes**

```bash
git add -u && git commit -m "fix(coach-os): smoke-test findings"
```

---

## Final acceptance (whole slice)

- `npx jest` — full suite green (1771 + ~20 new).
- `npm run verify` green after `node scripts/build-proto-zip.mjs`.
- All five tabs render real-data states: loading / offline / empty / populated — no invented numbers anywhere.
- `coach_interventions` rows appear in live DB when actions are taken (verify via `supabase db query --linked "select kind, count(*) from coach_interventions group by 1"`).
- Old deep links (`#coach`, `#coach-athlete/{id}`, `#coach-plan`, `#coach-inbox`) all still render.
```
