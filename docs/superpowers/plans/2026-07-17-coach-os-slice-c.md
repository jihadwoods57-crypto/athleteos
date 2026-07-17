# Coach OS Slice C — Create Menu + Standards Deepening — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the Slice C of the Coach OS spec (docs/superpowers/specs/2026-07-16-coach-os-design.md): a real Create menu (announcements with feed + push fan-out), and a deepened Standards editor (custom meal names, per-meal time windows, photo-proof toggle, hydration target, requirement templates with 7 seeds, preview-as-athlete).

**Architecture:** All UI work happens in the shipped proto WebView (`proto/redesign-2026-07/` — NOT `src/screens`, which is legacy). Time windows already ARE the engine currency: `status.js`, `priority.js`, and `notify-plan.js` all read `window:{open,due}` (minutes-from-midnight) off each requirement item, and `catalogFromItems` passes coach-set windows through verbatim (`requirements.js:152`). So the standards work is: extend the knobs→items editor (`coachPlanSet` in `js/screens/coach.js:406-547`) + the DB items validator, and pin the engine flow with tests. Announcements are greenfield but every pattern exists: migration 0074 clones the 0071/0073 idiom, the `notify()` SECURITY DEFINER helper (0027) fans out athlete feed rows exactly like `assign_requirement` (0055:137-171) does, and the `send-push` edge function gains an announcement mode for Expo push. Backend writes go through SECURITY DEFINER RPCs; new tables get RLS probes in `supabase/tests/rls_authz_test.sql`.

**Tech Stack:** Vanilla-JS ES modules (proto WebView), Supabase (Postgres + RLS + edge functions/Deno), Jest 30 (TS tests in `src/core/` importing proto JS via `// @ts-ignore`), `npm run verify` gate (lint:xss + typecheck + test + bundle).

## Global Constraints

- **Branch:** build on a worktree branch off `compliance-fixes` (NOT master — master is stale; compliance-fixes is the integration line).
- **Migrations:** one slice, one migration: `supabase/migrations/0074_coach_os_slice_c.sql`. Forward-only, idempotent (0055 idiom: `create table if not exists`, `drop policy if exists`/`create policy`, `do $$` guards). FKs inline: athlete columns → `profiles(id) on delete cascade`, actor columns → bare `references profiles(id)` (0072 lesson). Applied to live by the orchestrator (not the task subagent) after review, same as 0071/0073.
- **RLS predicates:** staff read/write → `is_team_staff(team_id)`. NEVER `can_view()` for staff-only surfaces (it includes `is_self` — the 0073 lesson).
- **Pure engines take time from callers.** No `Date.now()` / `new Date()` inside `js/requirements.js`, `js/templates.js`, `js/status.js`, `js/notify-plan.js`, or any pure function — reviewers rejected this twice in Slice A. Give optional params JSDoc-typed defaults (Jest allowJs infers destructured params required otherwise).
- **Numbers are never narrated fiction.** Deterministic copy only. No scoring formulas in notification copy. Scoring weights stay engine-owned (D3 rails) — coaches set requirements, never weights.
- **Dark tokens, existing CSS classes** (`.card`, `.lrow`, `.chip-row`/`.chp`, `.seg`, `.eyebrow`, `backHead`). Blue→teal stays score-only, green status-only.
- **XSS:** every user-supplied string rendered into HTML goes through `esc()` from `js/components.js` (there is a lint:xss gate).
- **After any proto change** in a task: run the affected Jest suites. `node scripts/build-proto-zip.mjs` + full `npm run verify` happen once at the end (Task 9), not per task.
- **Commits:** small, per task, message style `feat(coach-os): …` / `test(coach-os): …`.

## Deliberate deferrals (do NOT build these; they are recorded here so nobody "helpfully" adds them)

- **Excused-day rules knob** in the standards editor: excused flows exist via `athlete_exceptions` (Slice A absence sheet). A per-standard "rest days" rule needs its own design pass across runsOn/status/notify — deferred with this note, not silently dropped.
- **"Create check-in" composer:** weekly check-in is a standards toggle (`checkin` knob), not a standalone object. The Create menu routes "Check-ins & recovery" to Standards. A custom check-in question builder is future work (teams.settings.checkin_questions exists but is out of Slice C).
- **Group-scoped requirement sets:** `requirement_sets.scope_kind` is DB-constrained to `team|position|athlete` (0055). Applying a template to a custom group = loop the group's athletes and write athlete-scope sets client-side. No schema change.
- **Position-coach audience RLS capping:** `team_staff.scope_kind/scope_value` columns exist (0071) but enforcement lands in Slice F with the scoped roles. Slice C filters the Create menu client-side by `staff_role` only (head_coach/assistant/nutritionist are the live enum values) and notes the cap honestly.
- **Announcement edit/delete UI:** v1 is post + history. (The table gets an author-delete policy so Slice D can add it cheaply.)

---

### Task 1: Migration 0074 — announcements, post_announcement RPC, requirement_templates, items-validator extension + RLS probes

**Files:**
- Create: `supabase/migrations/0074_coach_os_slice_c.sql`
- Modify: `supabase/tests/rls_authz_test.sql` (append probes)

**Interfaces:**
- Consumes: helpers `is_team_staff(uuid)` (0002:44), `is_staff_of_team(uuid)` (0055:21), `notify(uuid,text,text,text)` (0027:29), `validate_requirement_items(jsonb)` (0055:53-75), tables `team_members`, `coach_groups` (0071).
- Produces: table `announcements`, RPC `post_announcement(p_team uuid, p_scope_kind text, p_scope_value text, p_title text, p_body text) returns jsonb` (`{id, count}`), table `requirement_templates`, extended `validate_requirement_items` accepting optional per-item `window {open,due,label}` and numeric `target`. Later tasks call the RPC via `roles.js` and read/write `requirement_templates` directly (RLS table rw, like `coach_groups`).

- [ ] **Step 1: Write the migration**

```sql
-- OnStandard — Coach OS Slice C: announcements + requirement templates + item-window rails
-- (spec: docs/superpowers/specs/2026-07-16-coach-os-design.md, Slice C).
-- One slice, one migration (0055 idiom). Forward-only, idempotent.
--
-- announcements: a coach broadcast to a scoped audience. The row is the durable coach-side
--   record; athlete delivery is notify() feed rows (fan-out in post_announcement) + Expo
--   push via the send-push edge function (announcement mode — push only, never feed rows,
--   so nothing is double-delivered). Athletes never read this table.
-- requirement_templates: named, reusable requirement-set item lists (game week, travel…).
--   Direct-table RLS rw for staff (coach_groups idiom) — templates are drafts, not the
--   governing standard; publishing still goes through set_team_requirements' rails.
-- validate_requirement_items: now also rails the optional window {open,due,label} and
--   numeric target riding on items (windows drive due-soon/overdue + nudge timing).

create table if not exists announcements (
  id          uuid primary key default gen_random_uuid(),
  team_id     uuid not null references teams(id) on delete cascade,
  author_id   uuid not null default auth.uid() references profiles(id),
  scope_kind  text not null default 'team' check (scope_kind in ('team','position','group','athlete')),
  scope_value text,
  title       text not null check (char_length(trim(title)) between 2 and 80),
  body        text not null check (char_length(trim(body)) between 1 and 500),
  sent_count  int not null default 0,
  created_at  timestamptz not null default now(),
  constraint ann_scope_shape check (
    (scope_kind = 'team' and scope_value is null) or
    (scope_kind <> 'team' and scope_value is not null)
  )
);
create index if not exists ann_team_created on announcements (team_id, created_at desc);
alter table announcements enable row level security;
drop policy if exists ann_staff_read on announcements;
create policy ann_staff_read on announcements
  for select using (is_team_staff(team_id));
drop policy if exists ann_author_delete on announcements;
create policy ann_author_delete on announcements
  for delete using (is_team_staff(team_id) and author_id = auth.uid());
-- No insert policy: writes go through post_announcement (SECURITY DEFINER) so the
-- audience fan-out can never be skipped or forged.

create or replace function post_announcement(
  p_team uuid, p_scope_kind text, p_scope_value text, p_title text, p_body text
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  ann_id uuid;
  n int := 0;
  ath record;
begin
  if not is_team_staff(p_team) then
    raise exception 'not team staff';
  end if;
  insert into announcements (team_id, author_id, scope_kind, scope_value, title, body)
  values (p_team, auth.uid(), coalesce(p_scope_kind,'team'),
          case when coalesce(p_scope_kind,'team') = 'team' then null else p_scope_value end,
          trim(p_title), trim(p_body))
  returning id into ann_id;

  for ath in
    select tm.athlete_id from team_members tm
    where tm.team_id = p_team and tm.status = 'active'
      and (
        coalesce(p_scope_kind,'team') = 'team'
        or (p_scope_kind = 'position' and upper(coalesce(tm.position,'')) = upper(p_scope_value))
        or (p_scope_kind = 'athlete' and tm.athlete_id::text = p_scope_value)
        or (p_scope_kind = 'group' and tm.athlete_id = any (
              select unnest(g.athlete_ids) from coach_groups g
              where g.id::text = p_scope_value and g.team_id = p_team))
      )
  loop
    perform notify(ath.athlete_id, 'announcement', trim(p_title), trim(p_body));
    n := n + 1;
  end loop;

  update announcements set sent_count = n where id = ann_id;
  return jsonb_build_object('id', ann_id, 'count', n);
end $$;
grant execute on function post_announcement(uuid, text, text, text, text) to authenticated;

create table if not exists requirement_templates (
  id          uuid primary key default gen_random_uuid(),
  team_id     uuid not null references teams(id) on delete cascade,
  name        text not null check (char_length(trim(name)) between 1 and 60),
  kind        text not null default 'custom' check (kind in
                ('game_week','off_season','travel','recovery','weight_gain','weight_loss','injured','custom')),
  items       jsonb not null check (validate_requirement_items(items)),
  created_by  uuid not null default auth.uid() references profiles(id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create unique index if not exists rt_team_name on requirement_templates (team_id, lower(name));
alter table requirement_templates enable row level security;
drop policy if exists rt_staff_rw on requirement_templates;
create policy rt_staff_rw on requirement_templates
  for all using (is_team_staff(team_id))
  with check (is_team_staff(team_id));

-- Extend the items validator: optional window/target rails. Recreate in full (0055 body +
-- new checks) — copy the CURRENT function body from 0055_requirements_engine.sql:53-75 and
-- add, inside the per-item loop:
--   window: if item ? 'window' then it must be a jsonb object; its open/due, when present,
--           must be numbers in 0..1439; when both present, due >= open.
--   target: if item ? 'target' then it must be a number in 1..999.
-- Everything else (array 1..24, id/title/kind/proof required, kind/proof enums,
-- meals 1-6 / lifts 0-7 rails) stays byte-identical to the live definition.
create or replace function validate_requirement_items(items jsonb) returns boolean
language plpgsql immutable as $$
-- (full body per the note above — start from 0055 verbatim, add the window/target block)
$$;

comment on table announcements is
  'Coach broadcasts. Durable coach-side record; athlete delivery = notifications rows (post_announcement) + Expo push (send-push announcement mode). Athletes never read this table.';
comment on table requirement_templates is
  'Named reusable requirement-set drafts (7 standard kinds + custom). Staff-only. Publishing still flows through set_team_requirements.';
```

The `validate_requirement_items` body is the one part left as a directive on purpose: it MUST start from the live 0055 definition verbatim (read `supabase/migrations/0055_requirements_engine.sql:53-75` first) so no existing rail is loosened, then add the window/target block. Do not paraphrase the 0055 body from memory.

- [ ] **Step 2: Append RLS probes to `supabase/tests/rls_authz_test.sql`**

Follow the file's existing seed-actors/probe/rollback structure (read its header first). Probes to add:
1. Staff can `select` announcements on their team; a non-staff athlete on the team gets 0 rows; a coach of a DIFFERENT team gets 0 rows.
2. Direct `insert into announcements` as staff FAILS (no insert policy — RPC-only).
3. `post_announcement` as staff succeeds and creates one `notifications` row per active team member (team scope); as an athlete it raises `not team staff`.
4. `post_announcement` with `p_scope_kind='position'` only notifies members whose position matches.
5. Staff can insert/update/delete `requirement_templates` for their team; cross-team staff and athletes cannot see or write them.
6. `requirement_templates` insert with items violating the window rail (e.g. `window.due = 2000`) FAILS the check constraint.

- [ ] **Step 3: Syntax-check the migration locally if a local DB is available**

Run: `npm run test:rls` (drives `supabase/tests/run.sh` against the local DB at 127.0.0.1:54322). If no local Supabase stack is running, state that plainly in the task report — do NOT claim the probes ran.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/0074_coach_os_slice_c.sql supabase/tests/rls_authz_test.sql
git commit -m "feat(coach-os): 0074 — announcements + post_announcement fan-out, requirement_templates, window/target rails"
```

**NOTE for the orchestrator (not the subagent):** after this task passes review, apply 0074 to live (`supabase db push` / SQL editor, per supabase/README.md) before Tasks 5/7 are smoke-tested against live.

---

### Task 2: `stdFromItems` — one shared pure path from set items to the athlete day standard

**Files:**
- Modify: `proto/redesign-2026-07/js/requirements.js` (add export)
- Modify: `proto/redesign-2026-07/js/state.js:1240-1256` (`_applyStandardFromSets` delegates)
- Test: `src/core/stdFromItems.test.ts` (new)

**Interfaces:**
- Consumes: `STD_SLOT_MAP` — currently in `state.js` (find it; it maps meal-count → slot-key arrays). Move the constant into `requirements.js` and re-import in `state.js` (single source).
- Produces: `stdFromItems(items)` in `requirements.js` → `{ mealsRequired, slots, deadlines, titles } | null`. Task 6 (preview) and `state.js` both call exactly this — this is the spec's "same code path as setDayStandard" requirement.

- [ ] **Step 1: Write the failing test**

```ts
// src/core/stdFromItems.test.ts
// @ts-ignore — plain ESM proto module
import { stdFromItems } from '../../proto/redesign-2026-07/js/requirements.js';

const meal = (i: number, title: string, open: number | null, due: number) =>
  ({ id: `meal-${i}`, title, kind: 'meal', proof: 'photo', freq: { type: 'daily' },
     window: open == null ? { due } : { open, due } });

test('null on no meal items', () => {
  expect(stdFromItems([])).toBeNull();
  expect(stdFromItems([{ id: 'lift', kind: 'lift', title: 'Lift', proof: 'check' }])).toBeNull();
});

test('carries custom titles and window deadlines onto slot keys', () => {
  const std = stdFromItems([
    meal(1, 'Team Breakfast', 400, 555), meal(2, 'Fuel Stop', 700, 800), meal(3, 'Dinner', 1080, 1230),
  ])!;
  expect(std.mealsRequired).toBe(3);
  expect(std.slots.length).toBe(3);
  expect(std.deadlines[std.slots[0]]).toBe(555);
  expect(std.deadlines[std.slots[1]]).toBe(800);
  expect(std.titles[std.slots[0]]).toBe('Team Breakfast');
});

test('clamps to 1..6 meals and tolerates missing windows', () => {
  const std = stdFromItems([meal(1, 'Only Meal', null, 1230)])!;
  expect(std.mealsRequired).toBe(1);
  expect(std.deadlines[std.slots[0]]).toBe(1230);
});

test('non-meal items are ignored, order preserved', () => {
  const std = stdFromItems([
    { id: 'weight', kind: 'weigh', title: 'Morning Weight', proof: 'scale', window: { due: 540 } },
    meal(1, 'A', 420, 570), meal(2, 'B', 720, 840),
  ])!;
  expect(std.mealsRequired).toBe(2);
  expect(std.titles[std.slots[0]]).toBe('A');
});
```

- [ ] **Step 2: Run it — expect FAIL** (`stdFromItems` not exported): `npx jest src/core/stdFromItems.test.ts`

- [ ] **Step 3: Implement.** In `requirements.js`: move `STD_SLOT_MAP` from `state.js` (locate its definition there; keep values byte-identical) and add:

```js
/* One shared path from a requirement set's items to the athlete day standard
   ({mealsRequired, slots, deadlines, titles} — the setDayStandard shape). state.js applies
   it live; the coach standards editor previews a DRAFT through the same function. */
export function stdFromItems(items) {
  const mealItems = Array.isArray(items) ? items.filter(i => i && i.kind === 'meal') : [];
  if (!mealItems.length) return null;
  const m = Math.min(6, Math.max(1, mealItems.length));
  const slots = STD_SLOT_MAP[m];
  const deadlines = {}, titles = {};
  slots.forEach((k, i) => {
    const it = mealItems[i] || {};
    if (it.window && it.window.due != null) deadlines[k] = it.window.due;
    if (it.title) titles[k] = it.title;
  });
  return { mealsRequired: m, slots, deadlines, titles };
}
```

Then in `state.js` `_applyStandardFromSets` (1242-1256): replace the inline mapping with

```js
_applyStandardFromSets() {
  const set = resolveRequirementSet(RT.reqSets || [], RT.userId, (RT.profile || {}).position);
  RT.stdMeals = stdFromItems(set && set.items);
  setDayStandard(RT.stdMeals);
},
```

(import `stdFromItems` — and `STD_SLOT_MAP` if state.js uses it elsewhere — from `./requirements.js`; delete the now-dead local copy of the constant).

- [ ] **Step 4: Run the new test + the state/day suites that cover this path**

Run: `npx jest src/core/stdFromItems.test.ts src/core` — expect the new suite green and ZERO regressions in the existing 159 suites that touch state/day (`coachPlan`, `exec`, day-related suites). `state.js` behavior must be bit-identical for existing inputs.

- [ ] **Step 5: Commit**

```bash
git add proto/redesign-2026-07/js/requirements.js proto/redesign-2026-07/js/state.js src/core/stdFromItems.test.ts
git commit -m "feat(coach-os): stdFromItems — one shared items→day-standard path (state apply + coach preview)"
```

---

### Task 3: Standards editor deepening — custom meal names, per-meal time windows, photo toggle, hydration target

**Files:**
- Modify: `proto/redesign-2026-07/js/screens/coach.js` (`KNOB`/`knobsFromItems`/`itemsFromKnobs` at 409-445, `coachPlanSet` render/mount at 447-547)
- Test: `src/core/coachPlanKnobs.test.ts` (new — extract-and-test requires exporting the two knob fns; export them from coach.js)

**Interfaces:**
- Consumes: `roles.setTeamRequirements(teamId, kind, value, items)` (roles.js:309), existing chip/seg markup patterns.
- Produces: extended KNOB shape `{ key, meals, lifts, weigh, hydration, hydrationOz, recovery, checkin, photoProof, mealNames: string[], mealWins: {open?:number, due:number}[] }`; exported `knobsFromItems(items)` and `itemsFromKnobs(k)` (named exports from `js/screens/coach.js`). Items produced now carry: per-meal custom `title`, per-meal `window`, `proof: 'photo'|'check'` (photoProof), hydration item `target: <oz>` + title `Hydration · <oz> oz`. Task 4/6 reuse `itemsFromKnobs`; Task 6 previews `stdFromItems(itemsFromKnobs(KNOB))`.

- [ ] **Step 1: Write the failing test**

```ts
// src/core/coachPlanKnobs.test.ts
// @ts-ignore
import { itemsFromKnobs, knobsFromItems } from '../../proto/redesign-2026-07/js/screens/coach.js';

const base = { key: 'team:', meals: 3, lifts: 0, weigh: 'off', hydration: true, hydrationOz: 120,
               recovery: true, checkin: true, photoProof: true,
               mealNames: ['First Fuel', 'Lunch', 'Dinner'],
               mealWins: [{ open: 360, due: 540 }, { open: 720, due: 840 }, { open: 1080, due: 1230 }] };

test('itemsFromKnobs carries custom names, windows, photo proof, hydration target', () => {
  const items = itemsFromKnobs(base);
  const meals = items.filter((i: any) => i.kind === 'meal');
  expect(meals.length).toBe(3);
  expect(meals[0]).toMatchObject({ id: 'meal-1', title: 'First Fuel', proof: 'photo', window: { open: 360, due: 540 } });
  const hyd = items.find((i: any) => i.kind === 'hydration');
  expect(hyd).toMatchObject({ target: 120, required: false });
  expect(hyd.title).toBe('Hydration · 120 oz');
});

test('photoProof=false downgrades meal proof to check', () => {
  const meals = itemsFromKnobs({ ...base, photoProof: false }).filter((i: any) => i.kind === 'meal');
  expect(meals.every((m: any) => m.proof === 'check')).toBe(true);
});

test('knobsFromItems round-trips names, windows, photo flag and target', () => {
  const k = knobsFromItems(itemsFromKnobs(base));
  expect(k.mealNames).toEqual(['First Fuel', 'Lunch', 'Dinner']);
  expect(k.mealWins).toEqual(base.mealWins);
  expect(k.photoProof).toBe(true);
  expect(k.hydrationOz).toBe(120);
});

test('legacy items (no custom fields) produce sane defaults', () => {
  const k = knobsFromItems([
    { id: 'meal-1', title: 'Breakfast', kind: 'meal', proof: 'photo', freq: { type: 'daily' }, window: { open: 420, due: 570 } },
    { id: 'hydration', title: 'Hydration · 120 oz', kind: 'hydration', proof: 'counter', freq: { type: 'daily' }, window: { due: 1290 }, required: false },
  ]);
  expect(k.meals).toBe(1);
  expect(k.mealNames).toEqual(['Breakfast']);
  expect(k.hydrationOz).toBe(120);
  expect(k.photoProof).toBe(true);
});

test('meal-count change resets names/windows to defaults for the new count', () => {
  // Editor rule: when KNOB.meals changes, mealNames/mealWins re-derive (documented behavior).
  const items = itemsFromKnobs({ ...base, meals: 2, mealNames: undefined, mealWins: undefined });
  const meals = items.filter((i: any) => i.kind === 'meal');
  expect(meals.map((m: any) => m.title)).toEqual(['Breakfast', 'Dinner']);
});
```

- [ ] **Step 2: Run — expect FAIL** (fns not exported / fields missing): `npx jest src/core/coachPlanKnobs.test.ts`

Importing `js/screens/coach.js` into Jest pulls its module graph (components, roles, state). If top-level imports break under node, follow the established lazy-require pattern (`src/core/wireTogglesCapture.test.ts` installs JSDOM globals before a lazy `require`). Check how `src/core/coachPlan.test.ts` already imports these editor internals — if it re-implements the knob fns as fixtures instead of importing, mirror whichever approach that file uses and note it in the report.

- [ ] **Step 3: Implement `itemsFromKnobs`/`knobsFromItems` extension (export both)**

```js
export function knobsFromItems(items) {
  const mealItems = items.filter(i => i.kind === 'meal');
  const lift = items.find(i => i.kind === 'lift');
  const weigh = items.find(i => i.kind === 'weigh');
  const hyd = items.find(i => i.kind === 'hydration');
  const meals = Math.min(6, Math.max(1, mealItems.length));
  return {
    meals,
    lifts: lift ? Math.min(7, (lift.freq && lift.freq.days && lift.freq.days.length) || 3) : 0,
    weigh: weigh ? ((weigh.freq && weigh.freq.type === 'daily') ? 'daily' : 'mwf') : 'off',
    hydration: !!hyd,
    hydrationOz: (hyd && typeof hyd.target === 'number') ? hyd.target
      : (hyd && /(\d+)\s*oz/i.test(hyd.title || '') ? +(hyd.title.match(/(\d+)\s*oz/i)[1]) : 120),
    recovery: items.some(i => i.kind === 'recovery'),
    checkin: items.some(i => i.kind === 'checkin'),
    photoProof: mealItems.length ? mealItems.every(m => m.proof === 'photo') : true,
    mealNames: mealItems.slice(0, meals).map((m, i) => m.title || MEAL_NAMES[i]),
    mealWins: mealItems.slice(0, meals).map((m, i) => (m.window && m.window.due != null) ? { ...m.window } : { ...MEAL_WINDOWS[i] }),
  };
}
export function itemsFromKnobs(k) {
  const items = [];
  let names, wins;
  if (Array.isArray(k.mealNames) && k.mealNames.length === k.meals
      && Array.isArray(k.mealWins) && k.mealWins.length === k.meals) {
    names = k.mealNames; wins = k.mealWins;
  } else if (k.meals === 1) { names = ['Daily meal']; wins = [{ open: 720, due: 1230 }]; }
  else if (k.meals === 2) { names = ['Breakfast', 'Dinner']; wins = [MEAL_WINDOWS[0], MEAL_WINDOWS[2]]; }
  else { names = MEAL_NAMES.slice(0, k.meals); wins = MEAL_WINDOWS.slice(0, k.meals); }
  const proof = k.photoProof === false ? 'check' : 'photo';
  names.forEach((t, i) => items.push({
    id: `meal-${i + 1}`, title: String(t || MEAL_NAMES[i] || `Meal ${i + 1}`).slice(0, 40),
    kind: 'meal', proof, freq: { type: 'daily' }, window: { ...wins[i] },
  }));
  // lift/weigh/recovery/checkin blocks UNCHANGED from current code (coach.js:433-443)
  if (k.hydration) {
    const oz = Math.min(999, Math.max(1, +k.hydrationOz || 120));
    items.push({ id: 'hydration', title: `Hydration · ${oz} oz`, kind: 'hydration', proof: 'counter',
                 freq: { type: 'daily' }, window: { due: 1290 }, required: false, target: oz });
  }
  // recovery/checkin unchanged
  return items;
}
```

`DEFAULT_KNOBS` for a new scope gains `hydrationOz: 120, photoProof: true` (mealNames/mealWins omitted → defaults path). When the meals chip changes count, delete `KNOB.mealNames`/`KNOB.mealWins` so they re-derive.

- [ ] **Step 4: Editor UI.** In `coachPlanSet.render`, after the meals chip-row, add a per-meal editor card (helpers included):

```js
const toHM = m => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
const fromHM = s => { const [h, mm] = String(s || '').split(':').map(Number); return (Number.isFinite(h) && Number.isFinite(mm)) ? h * 60 + mm : null; };
```

Render (names/wins resolved through the same fallback logic as `itemsFromKnobs` so what's shown IS what saves):

```html
<div class="eyebrow">Meal names & windows · windows drive due-soon, overdue, and reminders</div>
<section class="card" style="padding:10px 16px">
  ${names.map((t, i) => `
    <div class="lrow" style="cursor:default;gap:8px">
      <input class="mname" data-meal="${i}" maxlength="40" value="${esc(t)}"
             style="flex:1;min-width:0;background:transparent;border:1px solid var(--line);border-radius:8px;padding:7px 10px;color:var(--text-1);font-size:13.5px;font-weight:600">
      <input type="time" class="mwin" data-meal="${i}" data-edge="open" value="${wins[i].open != null ? toHM(wins[i].open) : ''}">
      <span style="color:var(--text-3);font-size:12px">→</span>
      <input type="time" class="mwin" data-meal="${i}" data-edge="due" value="${toHM(wins[i].due)}">
    </div>`).join('')}
</section>
```

Plus a `seg('Photo proof on meals', 'Off = tap-to-check, no photo required', 'photo', KNOB.photoProof)` row in the always-on card, and an oz chip-row under Hydration when it's on: `[80, 100, 120, 150].map(n => chip(KNOB.hydrationOz === n, `${n} oz`, 'hydoz', n))`.

Mount wiring: `change` listeners on `.mname`/`.mwin` write into `KNOB.mealNames[i]` / `KNOB.mealWins[i]` (materialize the arrays from the render-resolved defaults on first edit — never leave them length-mismatched with `KNOB.meals`). Validation before save: for each meal, `due` required; if `open` present, `open < due`; on violation `say('Meal N's window closes before it opens — fix the times.', true)` and abort. **Do NOT call `window.__render()` on text/time input events** (it would destroy focus mid-typing — the Slice A roster-search lesson); only knob chips re-render.

- [ ] **Step 5: Run tests**

Run: `npx jest src/core/coachPlanKnobs.test.ts src/core/coachPlan.test.ts` — both green.

- [ ] **Step 6: Commit**

```bash
git add proto/redesign-2026-07/js/screens/coach.js src/core/coachPlanKnobs.test.ts
git commit -m "feat(coach-os): standards editor — custom meal names, per-meal windows, photo toggle, hydration target"
```

---

### Task 4: Pin the flow — coach windows drive status, priority, and reminders

No production code is expected to change here (the engines already consume `window`); this task PROVES it and catches any seam that drops the data. If a seam IS broken, fix it minimally and say so.

**Files:**
- Test: `src/core/coachWindowsFlow.test.ts` (new)

**Interfaces:**
- Consumes: `athleteStatus` (status.js:78), `buildPriorities` (priority.js:52), `planNotifications` (notify-plan.js:200), `catalogFromItems` + `stdFromItems` (requirements.js), `itemsFromKnobs` (Task 3).

- [ ] **Step 1: Write the tests**

```ts
// src/core/coachWindowsFlow.test.ts — end-to-end: editor items → engines honor custom windows
// @ts-ignore
import { itemsFromKnobs } from '../../proto/redesign-2026-07/js/screens/coach.js';
// @ts-ignore
import { catalogFromItems, stdFromItems } from '../../proto/redesign-2026-07/js/requirements.js';
// @ts-ignore
import { athleteStatus } from '../../proto/redesign-2026-07/js/status.js';
// @ts-ignore
import { planNotifications, DEFAULT_NOTIF_PREFS } from '../../proto/redesign-2026-07/js/notify-plan.js';

const KNOB = { key: 'team:', meals: 2, lifts: 0, weigh: 'off', hydration: false, hydrationOz: 120,
               recovery: false, checkin: false, photoProof: true,
               mealNames: ['Early Fuel', 'Team Dinner'],
               mealWins: [{ open: 300, due: 420 }, { open: 1000, due: 1100 }] }; // 5-7a, 4:40-6:20p
const reqs = catalogFromItems(itemsFromKnobs(KNOB));
const row = (over: object = {}) => ({ athleteId: 'a1', name: 'Devin', score: 90, loggedToday: true,
  tasks: [], lastMealAt: null, scoreHistory: [], ...over });

test('custom window: due_soon inside 60min of the coach-set due, not the old defaults', () => {
  // 6:30am = 390 — inside [420-60, 420] of Early Fuel, far from default breakfast 570
  const s = athleteStatus({ nowMin: 390, row: row(), reqs, excused: false });
  expect(s.key).toBe('due_soon');
  expect(s.detail).toContain('Early Fuel');
});

test('custom window: overdue strictly after coach-set due', () => {
  const s = athleteStatus({ nowMin: 421, row: row(), reqs, excused: false });
  expect(s.key).toBe('overdue');
});

test('before a custom open the item is upcoming, never due_soon', () => {
  const s = athleteStatus({ nowMin: 200, row: row(), reqs, excused: false });
  expect(s.key).toBe('on_standard');
});

test('reminders fire off the coach-set due (soon = due - lead), with custom title in copy', () => {
  const plan = planNotifications({ nowMin: 0, dateISO: '2026-07-17', dayOffset: 0, reqs,
    assigned: [], pressure: 'accountable', prefs: DEFAULT_NOTIF_PREFS,
    celebration: null, score: null, streak: 0, coachName: 'Coach' });
  const soon = plan.find((p: any) => p.id.includes('meal-1') && p.stage === 'soon');
  expect(soon).toBeTruthy();
  expect(soon.fireAtMin).toBe(420 - 45); // LEAD.accountable
});

test('the athlete day standard carries the same windows (stdFromItems parity)', () => {
  const std = stdFromItems(itemsFromKnobs(KNOB))!;
  expect(std.deadlines[std.slots[0]]).toBe(420);
  expect(std.titles[std.slots[1]]).toBe('Team Dinner');
});
```

Note: the `soon` finder keys off the plan item's `id` containing the req id — verify the actual plan-id scheme in `notify-plan.js` (read how ids are composed, e.g. `${req.id}-soon`) and adjust the predicate to the real scheme, not this guess. Same for the exact `plan` item field names (`stage`, `fireAtMin` are confirmed by notifyPlan.test.ts).

- [ ] **Step 2: Run** `npx jest src/core/coachWindowsFlow.test.ts` — if a test exposes a real seam gap (e.g. `catalogFromItems` clobbering windows), fix the seam minimally in the engine file and re-run the WHOLE core suite.

- [ ] **Step 3: Commit**

```bash
git add src/core/coachWindowsFlow.test.ts
git commit -m "test(coach-os): pin coach-set meal windows through status, reminders, and the athlete day standard"
```

---

### Task 5: `js/templates.js` — seven seed templates + template helpers (pure) + roles.js CRUD

**Files:**
- Create: `proto/redesign-2026-07/js/templates.js`
- Modify: `proto/redesign-2026-07/js/roles.js` (append CRUD helpers)
- Test: `src/core/templates.test.ts` (new)

**Interfaces:**
- Consumes: item shape from requirements.js; `itemsFromKnobs`-style construction (but templates.js is PURE and standalone — it builds items directly, no import from screens/).
- Produces:
  - `TEMPLATE_KINDS` — `['game_week','off_season','travel','recovery','weight_gain','weight_loss','injured']`.
  - `seedTemplates()` → `Array<{ name, kind, items }>` (the seven, deterministic, no clock).
  - `templateLabel(kind)` → display string.
  - roles.js: `fetchRequirementTemplates(teamId)` → rows; `saveRequirementTemplate(teamId, name, kind, items)` → `{ok, error?}` (insert, upsert `onConflict: 'team_id,lower(name)'` is not expressible client-side — plain insert; treat unique-violation as `{ok:false, error:'A template with that name already exists.'}`); `deleteRequirementTemplate(id)` → `{ok}`. All follow the existing `sb()`/try-catch/fallback idiom (roles.js:273-327 as the model).

- [ ] **Step 1: Write the failing test**

```ts
// src/core/templates.test.ts
// @ts-ignore
import { seedTemplates, TEMPLATE_KINDS, templateLabel } from '../../proto/redesign-2026-07/js/templates.js';

test('seven seeds, one per standard kind, deterministic', () => {
  const seeds = seedTemplates();
  expect(seeds.map(s => s.kind).sort()).toEqual([...TEMPLATE_KINDS].sort());
  expect(seedTemplates()).toEqual(seeds); // pure — same output every call
});

test('every seed passes the 0055/0074 item rails', () => {
  for (const s of seedTemplates()) {
    expect(s.items.length).toBeGreaterThanOrEqual(1);
    expect(s.items.length).toBeLessThanOrEqual(24);
    const meals = s.items.filter((i: any) => i.kind === 'meal');
    expect(meals.length).toBeGreaterThanOrEqual(1);
    expect(meals.length).toBeLessThanOrEqual(6);
    for (const it of s.items) {
      expect(typeof it.id).toBe('string');
      expect(typeof it.title).toBe('string');
      expect(['meal','lift','hydration','recovery','weigh','checkin','custom']).toContain(it.kind);
      expect(['photo','form','scale','counter','check']).toContain(it.proof);
      if (it.window) {
        if (it.window.open != null) expect(it.window.open).toBeGreaterThanOrEqual(0);
        expect(it.window.due).toBeLessThanOrEqual(1439);
        if (it.window.open != null) expect(it.window.due).toBeGreaterThanOrEqual(it.window.open);
      }
    }
  }
});

test('the templates differ where it matters', () => {
  const by = Object.fromEntries(seedTemplates().map(s => [s.kind, s]));
  const meals = (k: string) => by[k].items.filter((i: any) => i.kind === 'meal').length;
  expect(meals('weight_gain')).toBeGreaterThan(meals('weight_loss'));
  expect(by['travel'].items.some((i: any) => i.kind === 'lift')).toBe(false);
  expect(by['injured'].items.some((i: any) => i.kind === 'recovery')).toBe(true);
  expect(templateLabel('game_week')).toBe('Game week');
});
```

- [ ] **Step 2: Run — expect FAIL** (module missing): `npx jest src/core/templates.test.ts`

- [ ] **Step 3: Implement `js/templates.js`.** Pure module, header comment explaining seeds are drafts the coach applies through the standards editor. Football-honest content (the founder's users are college programs):

| kind | meals | lifts | weigh | notes |
|---|---|---|---|---|
| game_week | 3 (Breakfast 420-570 / Lunch 720-840 / Dinner 1080-1230) | 3 | mwf | recovery+checkin on |
| off_season | 3 | 4 | mwf | recovery on, checkin on |
| travel | 3 (windows shifted late: 480-630 / 780-900 / 1140-1290) | 0 | off | recovery on, checkin off |
| recovery | 3 | 1 | mwf | recovery on, hydration 150oz |
| weight_gain | 5 (adds Meal 4 due 1290, Meal 5 due 1350) | 4 | daily | hydration 150 |
| weight_loss | 3 | 4 | daily | hydration 120 |
| injured | 3 | 0 | daily | recovery on, checkin on |

Build items inline with the exact same field names as `itemsFromKnobs` output (id `meal-N`, `freq:{type:'daily'}`, etc. — copy the shapes from Task 3's code, do not import from screens/). `seedTemplates()` returns fresh deep copies (map + object spread) so callers can't mutate the seed source.

- [ ] **Step 4: roles.js CRUD** (append near the other coach helpers, follow the file's idiom exactly — `const c = sb(); if (!c) return …; try { … } catch { … }`):

```js
/* ---- Requirement templates (Slice C, 0074): named reusable requirement-set drafts ---- */
export async function fetchRequirementTemplates(teamId) {
  const c = sb(); if (!c || !teamId) return [];
  try {
    const { data } = await c.from('requirement_templates')
      .select('id,name,kind,items,created_at').eq('team_id', teamId).order('created_at');
    return data || [];
  } catch { return []; }
}
export async function saveRequirementTemplate(teamId, name, kind, items) {
  const c = sb(); if (!c) return { ok: false, error: 'Offline' };
  try {
    const { error } = await c.from('requirement_templates')
      .insert({ team_id: teamId, name, kind: kind || 'custom', items });
    if (error) return { ok: false, error: /duplicate|unique/i.test(error.message || '') ? 'A template with that name already exists.' : error.message };
    return { ok: true };
  } catch (e) { return { ok: false, error: String((e && e.message) || e) }; }
}
export async function deleteRequirementTemplate(id) {
  const c = sb(); if (!c) return { ok: false };
  try { const { error } = await c.from('requirement_templates').delete().eq('id', id); return { ok: !error }; }
  catch { return { ok: false }; }
}
```

- [ ] **Step 5: Run** `npx jest src/core/templates.test.ts` — green. **Step 6: Commit**

```bash
git add proto/redesign-2026-07/js/templates.js proto/redesign-2026-07/js/roles.js src/core/templates.test.ts
git commit -m "feat(coach-os): seven seed requirement templates (pure) + template CRUD"
```

---

### Task 6: Templates UI + preview-as-athlete in the standards flow

**Files:**
- Modify: `proto/redesign-2026-07/js/screens/coach.js` (`coachPlan` at ~200-231 gains a Templates section; `coachPlanSet` gains apply/save-as/preview)
- Test: `src/core/coachPlanTemplates.test.ts` (new — pure pieces only: the preview builder + template-to-knobs application; DOM wiring is smoke-tested in Task 9)

**Interfaces:**
- Consumes: `seedTemplates`, `templateLabel`, roles CRUD (Task 5), `knobsFromItems`/`itemsFromKnobs` (Task 3), `stdFromItems` (Task 2), `fmtMin` (requirements.js — check its exact export name/signature; notify-plan.js imports it) for window labels.
- Produces: module-level `TPL` cache `{ teamId, rows }` + `loadTemplates(force)` in coach.js; `previewFromKnobs(k)` exported from coach.js → `{ std, wins }` used by render.

- [ ] **Step 1: Failing test**

```ts
// src/core/coachPlanTemplates.test.ts
// @ts-ignore
import { previewFromKnobs, knobsFromItems } from '../../proto/redesign-2026-07/js/screens/coach.js';
// @ts-ignore
import { seedTemplates } from '../../proto/redesign-2026-07/js/templates.js';

test('previewFromKnobs renders the DRAFT through the same path as the athlete day', () => {
  const k = { key: 'team:', meals: 2, lifts: 0, weigh: 'off', hydration: false, hydrationOz: 120,
              recovery: false, checkin: false, photoProof: true,
              mealNames: ['A', 'B'], mealWins: [{ open: 400, due: 500 }, { open: 1000, due: 1100 }] };
  const p = previewFromKnobs(k)!;
  expect(p.std.mealsRequired).toBe(2);
  expect(p.std.titles[p.std.slots[0]]).toBe('A');
  expect(p.std.deadlines[p.std.slots[1]]).toBe(1100);
});

test('applying a template = knobsFromItems over its items (no special path)', () => {
  const game = seedTemplates().find(s => s.kind === 'game_week')!;
  const k = knobsFromItems(game.items);
  expect(k.meals).toBe(3);
  expect(k.mealWins.length).toBe(3);
});
```

- [ ] **Step 2: Run — FAIL** (`previewFromKnobs` missing). **Step 3: Implement.**

`previewFromKnobs` in coach.js:

```js
export function previewFromKnobs(k) {
  const items = itemsFromKnobs(k);
  const std = stdFromItems(items);
  return std ? { std, items } : null;
}
```

**Preview card** (in `coachPlanSet.render`, above the save button): a `.card` titled "What the athlete sees" listing `std.slots` rows — title (`std.titles[slot]`), window label built with the same time formatter the athlete day uses (`fmtMin` from requirements.js — verify name), and the meal-count denominator line ("2 meals make the day's nutrition score"). Static render from `previewFromKnobs(KNOB)` — re-renders on knob chips like everything else. This satisfies the spec's "render the athlete Home day-card from a draft set before publishing (pure function over the draft — same code path as setDayStandard)".

**Templates section** (in `coachPlanSet.render`, under the always-on card):
- Eyebrow "Templates". Chip-row of team templates (`TPL.rows`) + an outline "Save as template" chip.
- Tapping a template chip: `KNOB = { key, ...knobsFromItems(tpl.items) }; window.__render();` — it fills the knobs; the coach still reviews + hits the existing Save (publishing ALWAYS flows through `set_team_requirements` rails; a template never writes the standard directly).
- "Save as template": prompt for a name via a tiny inline input row (module boolean `SHOW_TPL_SAVE`, same in-render sheet idiom as `groupSheet` in coach-roster.js:70-86), then `roles.saveRequirementTemplate(teamId, name, 'custom', itemsFromKnobs(KNOB))`, then `loadTemplates(true)`.
- **Seed on first open:** in `loadTemplates()`, after fetch, if `rows.length === 0 && teamId`, insert the seven seeds sequentially via `saveRequirementTemplate(teamId, s.name, s.kind, s.items)` then refetch. The DB unique index `(team_id, lower(name))` makes a double-seed race harmless (losers get unique-violations, ignored).
- `mount()` gains `loadTemplates()` alongside the existing `loadSets()`.

Scope reminder: `coachPlanSet` already applies per scope (team / position via route). Applying a template **to an individual athlete** rides the existing athlete-scope route if one exists — check `coachPlan`/targets flow; if there is no `coach-plan-set/athlete/<id>` entry point today, do NOT invent one (deferral note it in the report). Group-apply is deferred (see header).

- [ ] **Step 4: Run** `npx jest src/core/coachPlanTemplates.test.ts src/core/coachPlan.test.ts src/core/coachPlanKnobs.test.ts` — green. **Step 5: Commit**

```bash
git add proto/redesign-2026-07/js/screens/coach.js src/core/coachPlanTemplates.test.ts
git commit -m "feat(coach-os): requirement templates in the standards editor + preview-as-athlete card"
```

---

### Task 7: Announcements — compose screen, Create menu rebuild, athlete feed kind, coach inbox rows

**Files:**
- Create: `proto/redesign-2026-07/js/screens/coach-announce.js`
- Modify: `proto/redesign-2026-07/js/screens/coach-create.js` (OPTIONS + role filter)
- Modify: `proto/redesign-2026-07/js/screens/index.js` (register `coach-announce`)
- Modify: `proto/redesign-2026-07/js/roles.js` (postAnnouncement / fetchAnnouncements)
- Modify: `proto/redesign-2026-07/js/notif-feed.js` (KIND_META announcement entry)
- Modify: `proto/redesign-2026-07/js/screens/coach.js` (`coachInbox`: recent-announcements section)
- Test: `src/core/notifFeed.test.ts` (extend), `src/core/coachAnnounce.test.ts` (new, pure pieces)

**Interfaces:**
- Consumes: RPC `post_announcement` (Task 1), `CD.roster` (rows[].unit for position chips), `roles.fetchCoachGroups` (roles.js:371), `backHead`/`esc`/`icon`, router `[data-go]`.
- Produces: roles.js `postAnnouncement({teamId, scopeKind, scopeValue, title, body})` → `{ok, count?, id?, error?}`; `fetchAnnouncements(teamId, limit=10)` → rows; screen route `coach-announce`; exported pure `audienceLabel(scopeKind, scopeValue, groups)` from coach-announce.js (used by both compose history and inbox rows). Task 8 consumes the returned announcement `id` for the push call.

- [ ] **Step 1: Failing tests**

```ts
// src/core/coachAnnounce.test.ts
// @ts-ignore
import { audienceLabel } from '../../proto/redesign-2026-07/js/screens/coach-announce.js';

test('audience labels are plain language', () => {
  expect(audienceLabel('team', null, [])).toBe('Entire team');
  expect(audienceLabel('position', 'LB', [])).toBe('LB room');
  expect(audienceLabel('group', 'g1', [{ id: 'g1', name: 'Travel squad' }])).toBe('Travel squad');
  expect(audienceLabel('group', 'gone', [])).toBe('Group');
});
```

Extend `src/core/notifFeed.test.ts` (match its existing style — read it first):

```ts
test('announcement kind renders with megaphone meta, not the default bell', () => {
  const r = feedRowFromServer({ id: 'n1', kind: 'announcement', title: 'Lift moved to 6am',
    body: 'Weight room closes early Friday.', created_at: new Date(NOW - 60000).toISOString(), read_at: null }, NOW);
  expect(r.icon).toBe('speaker'); // use an icon name that actually exists in js/icons.js — VERIFY and adjust
  expect(r.level).toBe('info');
});
```

(Verify the actual icon registry (`js/icons.js` or wherever `icon()` resolves) and the exact `feedRowFromServer` row/`NOW` fixture idiom from the existing test file.)

- [ ] **Step 2: Run — FAIL.** **Step 3: Implement.**

roles.js (follow the RPC idiom of `setTeamRequirements` at 309-317):

```js
/* ---- Announcements (Slice C, 0074): staff broadcast → feed rows server-side ---- */
export async function postAnnouncement({ teamId, scopeKind = 'team', scopeValue = null, title, body }) {
  const c = sb(); if (!c) return { ok: false, error: 'Offline' };
  try {
    const { data, error } = await c.rpc('post_announcement', {
      p_team: teamId, p_scope_kind: scopeKind, p_scope_value: scopeValue, p_title: title, p_body: body,
    });
    if (error) return { ok: false, error: error.message };
    return { ok: true, id: data && data.id, count: (data && data.count) || 0 };
  } catch (e) { return { ok: false, error: String((e && e.message) || e) }; }
}
export async function fetchAnnouncements(teamId, limit = 10) {
  const c = sb(); if (!c || !teamId) return [];
  try {
    const { data } = await c.from('announcements')
      .select('id,title,body,scope_kind,scope_value,sent_count,created_at')
      .eq('team_id', teamId).order('created_at', { ascending: false }).limit(limit);
    return data || [];
  } catch { return []; }
}
```

**`coach-announce.js`** — transient push screen (`transient: true, nav: 'coach', tab: 'create'`, `backHead('Announcement', 'Lands in every selected athlete's feed', 'coach-create')`), mirroring `coachAssign`'s module-state pattern (coach.js:23-126):
- Module state `ANN = { scopeKind:'team', scopeValue:null, title:'', body:'' }`.
- **Who** chip-rows: Entire team · position rooms (from `CD.roster.rows[].unit`, uppercased uniques — same derivation as coachAssign) · custom groups (fetch via `roles.fetchCoachGroups`, cached module-level) · (athlete targeting rides `coach-announce/<athleteId>` deep-link sub, like `coach-assign/<id>`).
- Title input (maxlength 80) + body textarea (maxlength 500) — plain inputs, no `__render()` on keystroke; read values at send time.
- Send: disable button, `roles.postAnnouncement(...)` → on ok: status `Sent to ${count} athlete${count===1?'':'s'}.`, then Task 8's push call (stub comment for now: `// push fan-out lands in the next commit`), reset ANN, refresh history.
- **History**: "Recent announcements" list under the composer — `fetchAnnouncements` on mount into module cache, rows: title, `audienceLabel(...)` + relative time (reuse `fmtWhen` from notif-feed.js), sent_count ("→ 42").
- Export `audienceLabel(scopeKind, scopeValue, groups)` as in the test.
- All user strings through `esc()`.

**`coach-create.js`** rebuild OPTIONS (keep the `.lrow` list style; delete the "arrive with slice C" comment — they exist now):

```js
const OPTIONS = [
  { icon: 'clipboard', title: 'Assign a requirement',  sub: 'Team, room, group, or one athlete', go: 'coach-assign' },
  { icon: 'speaker',   title: 'Send an announcement',  sub: 'Feed + push to the room you pick',  go: 'coach-announce' },
  { icon: 'message',   title: 'Message an athlete',    sub: 'Pick from the roster',              go: 'coach-roster' },
  { icon: 'users',     title: 'Message a group',       sub: 'Announce to a custom group',        go: 'coach-announce' },
  { icon: 'bars',      title: 'Standards & templates', sub: 'Meals, windows, check-ins by room', go: 'coach-plan' },
  { icon: 'calendar',  title: 'Adjust a schedule',     sub: 'Mark travel or an excused stretch', go: 'coach-roster' },
  { icon: 'user',      title: 'Add an athlete',        sub: 'Share your team code',              go: 'coach-profile' },
  { icon: 'users',     title: 'Invite staff',          sub: 'Assistant or dietitian codes',      go: 'coach-profile' },
];
```

(Again: verify each `icon` name exists in the icon registry; substitute the closest real glyph where these guesses miss.) **Role filter:** nutritionist additionally sees `{ title: 'Team diet', sub: 'Meal-plan tools', go: 'team-diet' }`. The coach's own staff role: check what's already cached client-side (CD / RT / fetchTeamStaff) — if nothing holds "my role", fetch `team_staff_list` once on mount into a module var and filter render-side; if roster hasn't loaded, show the unfiltered base list (never a blank screen). Position-coach capping is Slice F (client note only).

**`notif-feed.js`**: add `announcement: { icon: 'speaker', level: 'info' }` to `KIND_META` (line 10 block), matching the shape of the existing entries.

**`coachInbox`** (coach.js:553+): add a compact "Announcements" block — module-level `ANN_CACHE`, fetched on mount (`fetchAnnouncements(teamId, 3)`), rendered as up to 3 `.lrow`s (title · audience · relative time) with a "New announcement" `[data-go="coach-announce"]` affordance. Honest empty state: skip the section entirely when there are none. (Slice D turns this into a real category.)

**`index.js`**: `import { coachAnnounce } from './coach-announce.js';` + `'coach-announce': coachAnnounce` in the registry (mirror the `coach-create` registration at index.js:21/61).

- [ ] **Step 4: Run** `npx jest src/core/coachAnnounce.test.ts src/core/notifFeed.test.ts` — green. **Step 5: Commit**

```bash
git add proto/redesign-2026-07/js/screens/coach-announce.js proto/redesign-2026-07/js/screens/coach-create.js proto/redesign-2026-07/js/screens/index.js proto/redesign-2026-07/js/screens/coach.js proto/redesign-2026-07/js/roles.js proto/redesign-2026-07/js/notif-feed.js src/core/coachAnnounce.test.ts src/core/notifFeed.test.ts
git commit -m "feat(coach-os): announcements — compose screen, Create menu rebuild, feed kind, inbox rows"
```

---

### Task 8: Expo push fan-out — send-push announcement mode

**Files:**
- Modify: `supabase/functions/send-push/index.ts`
- Modify: `proto/redesign-2026-07/js/roles.js` (add `pushAnnouncement`)
- Modify: `proto/redesign-2026-07/js/screens/coach-announce.js` (wire the send)

**Interfaces:**
- Consumes: announcement row (Task 1), `device_tokens` (0028), `profiles.notifications_opt_out` (0067), the function's existing service-role client + CORS/rate-limit scaffolding.
- Produces: `send-push` accepts `{ announcement_id: string }`: authorizes (caller is active `team_staff` of the announcement's team — service-role query against the caller's JWT-derived uid, same uid-extraction the function already does), resolves the SAME audience as `post_announcement` (duplicate the scope logic in TS — team/position/group/athlete over active `team_members` + `coach_groups`), filters opt-outs, reads their `device_tokens`, chunks Expo posts (the existing POST helper; chunk ≤100 per Expo API), and does NOT write `notifications` rows (the RPC already did — double delivery is the failure mode to avoid). Returns `{ ok, pushed }`.

- [ ] **Step 1: Read `supabase/functions/send-push/index.ts` end-to-end first.** Reuse its uid-extraction, opt-out filtering, token fetch, and Expo POST helper — the announcement branch should be mostly composition, not new machinery. Match its error-handling style (best-effort, never 500 on partial token failures).

- [ ] **Step 2: Implement the `announcement_id` branch** (branch order: `announcement_id` → `to_coach` → athlete_id). Keep the per-IP rate limit and CORS allowlist untouched.

- [ ] **Step 3: Client wire-up.** roles.js:

```js
export async function pushAnnouncement(announcementId) {
  const c = sb(); if (!c || !announcementId) return { ok: false };
  try { const { error } = await c.functions.invoke('send-push', { body: { announcement_id: announcementId } }); return { ok: !error }; }
  catch { return { ok: false }; }
}
```

In coach-announce.js send handler, after a successful `postAnnouncement`: `roles.pushAnnouncement(r.id)` — fire-and-forget with `.catch(() => {})`; the feed rows are the guaranteed delivery, push is best-effort (exactly the app's existing nudge semantics). Status copy stays driven by the RPC count.

- [ ] **Step 4: Typecheck** (edge functions are Deno — confirm whether `npm run typecheck` covers `supabase/functions/`; if not, `deno check supabase/functions/send-push/index.ts` when deno is available, else state it wasn't type-checked locally). Run `npx jest src/core/coachAnnounce.test.ts` for the client edit.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/send-push/index.ts proto/redesign-2026-07/js/roles.js proto/redesign-2026-07/js/screens/coach-announce.js
git commit -m "feat(coach-os): send-push announcement mode — audience-scoped Expo fan-out, feed rows stay RPC-owned"
```

**NOTE for the orchestrator:** deploying the edge function (`supabase functions deploy send-push`) happens with the 0074 apply, after review.

---

### Task 9: Ship gate — proto zip, full verify, browser smoke

**Files:**
- Modify: `assets/proto.zip` + `src/proto/protoVersion.ts` (generated)

- [ ] **Step 1:** `node scripts/build-proto-zip.mjs`
- [ ] **Step 2:** `npm run verify` — lint:xss + typecheck + full Jest + bundle. Everything green; fix forward anything red and say what it was.
- [ ] **Step 3: Browser smoke** (recipe from the proto-webview memory — serve `proto/redesign-2026-07` with `python -m http.server 8127`, then in one evaluate call mutate live modules: `const st = await import('./js/state.js'); st.RT.userId='x'; st.RT.authRole='coach'; …`, stub `window.sb` with the thenable-Proxy fake keyed by table/rpc name, `const cd = await import('./js/coach-data.js'); await cd.loadCoachRoster(true);`, navigate via `location.hash` — NO reload after seeding; the boot session-wipe guard eats localStorage seeds). Walk:
  1. `#coach-create` — 8 rows render, announcement row routes.
  2. `#coach-announce` — audience chips render from stubbed roster; composer accepts input; send path calls the stubbed rpc (`post_announcement` key in the fake).
  3. `#coach-plan-set/team` — meal name inputs + time inputs render; changing meals count re-derives rows; photo toggle + hydration oz chips; preview card shows the draft names/windows; templates chips render (stub `requirement_templates` in the fake sb).
  4. Screenshot each for the report.
- [ ] **Step 4: Commit** the zip/version bump: `git add assets/proto.zip src/proto/protoVersion.ts && git commit -m "chore(coach-os): proto zip — slice C"`

---

## Self-Review (done at write time)

- **Spec coverage:** Create menu options ✔ (Task 7; check-in + schedule route to real existing surfaces, deferrals recorded). Announcements table + fan-out + athlete feed + coach Inbox ✔ (Tasks 1/7/8). Custom meal names ✔ (3), time windows driving due/overdue + nudges ✔ (3+4), hydration target ✔ (3), photo-required ✔ (3), deadline logic ✔ (windows ARE the deadlines; 3+4), excused-day rules → recorded deferral. Templates table + 7 seeds + save-as + apply ✔ (1/5/6; group-apply deferral recorded). Preview-as-athlete same code path ✔ (2+6). Nutritionist tools ✔, permission filtering pragmatic-v1 ✔ (7). Scoring weights untouched ✔.
- **Type consistency:** `stdFromItems` (2) consumed by 6; `itemsFromKnobs`/`knobsFromItems` exports (3) consumed by 4/6; `postAnnouncement` returns `{ok,id,count}` and 8 consumes `id`; `audienceLabel(scopeKind, scopeValue, groups)` defined (7) used only in 7.
- **Honest unknowns delegated with instructions, not hand-waved:** the 0055 validator body (copy live text), notify-plan plan-id scheme, icon-registry names, coachPlan.test.ts import style, athlete-scope plan-set entry point, Deno typecheck coverage. Each has an explicit "verify then adjust" step.
