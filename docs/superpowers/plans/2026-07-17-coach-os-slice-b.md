# Coach OS — Slice B Implementation Plan (coach-facing athlete profile)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Rebuild `coach-athlete/{id}` from a single read-only day view into a six-section coach-facing athlete profile — Overview · Today · Activity · Conversation · Requirements · Notes — reusing Slice A's engines/helpers and adding one migration (`coach_notes`), three history helpers, and an in-screen section switcher.

**Architecture:** A per-athlete profile cache (`loadAthleteProfile` in `js/coach-data.js`) gathers everything the six sections need in one guarded load. The screen is a thin renderer over a module-level `SECTION` variable + chip-row switcher (the established `coach-roster.js` pattern). Notes get their own per-athlete table (staff-only RLS). The existing `loadAthlete`/`trainerClient` path is left intact — the new loader is additive.

**Tech Stack:** Vanilla-JS proto WebView (`proto/redesign-2026-07`), supabase-js + RLS, Jest (ts-jest, allowJs), Supabase CLI migrations.

## Global Constraints

- Shipped UI is `proto/redesign-2026-07/` — never `src/screens`.
- **Never narrated fiction:** every value from real rows; three distinct loading/offline/empty states; unknown = honest empty, never invented.
- All cross-user text through `esc()`.
- Data helpers in `js/roles.js` are best-effort: `[]`/`null`/`{ok,error}` per the file-top idiom; never throw to a screen.
- **Notes are athlete-invisible.** The read policy MUST be `is_team_staff(team_id)` — NOT `can_view`, which includes `is_self` and would leak notes to the athlete.
- **Do not break the trainer side.** `loadAthlete`/`ATH` cache and `coachMeal`'s `mealById` are shared with `trainerClient` (coach.js:726, 848). Additive changes only; if you touch `loadAthlete`, verify `trainerClient` still renders.
- Migrations: forward-only, idempotent, applied via `supabase db push --linked` (`dangerouslyDisableSandbox: true`; docker warning harmless; pre-check `supabase migration list --linked` shows ONLY the new file pending).
- Blue→teal signature on score surfaces; green status-only; dark tokens.
- After any proto change: `node scripts/build-proto-zip.mjs` (worktree-safe since Slice A) then `npm run verify`. Full suite (1967) stays green. Commit per task; explicit file lists, never `git add -A`.

## Existing interfaces consumed (verified 2026-07-17)

- `roles.fetchDay(athleteId,date)`, `fetchRecentMeals(athleteId,sinceISO)`, `signedMealPhotoUrl(path)`, `fetchAthleteTargets(athleteId)`, `fetchAthleteBasics(athleteId)`, `fetchActiveTrustPass/grantTrustPass/endTrustPass`, `fetchActiveExceptions(teamId)`, `fetchMealComments(mealId)`, `logIntervention`, `markDayViewed` — all in `js/roles.js`.
- `resolveRequirementSet(sets, athleteId, position)` → governing set row or null; `catalogFromItems(items)` → CATALOG-shaped reqs — `js/requirements.js:118,142`.
- `athleteStatus({nowMin,nowMs,nowDow,row,reqs,excused,needsReview})` → `{key,label,detail,openItems}`; `STATUS_META` — `js/status.js`.
- `CD`, `entriesFor(scope)`, `loadCoachRoster` — `js/coach-data.js`; roster rows carry `scoreHistory` (7 days, oldest→newest), `lastMealAt`, `tasks`, `position`.
- `meal-intel.js`: `openingMessage`, `threadMessages`, `reactionGroups`, `privateNotes`.
- `sparkline(hist)` — currently inline in `coach-roster.js:22`.
- Screen module = `{ nav:'coach', tab:'roster', render({sub,S}), mount(root) }`; `backHead(title,sub,'coach-home')`; router pops nav-stack for Back. `window.__navigate` exists (Slice A) for subtree-patched taps.
- Migrations through 0072 applied live; new file is `0073`.

---

### Task 1: Migration `0073_coach_notes.sql` — per-athlete private notes (staff-only)

**Files:** Create `supabase/migrations/0073_coach_notes.sql`

**Interfaces produced:** table `coach_notes(id, team_id, athlete_id, author_id, body, created_at)`; RLS staff-only read+write.

- [ ] **Step 1: Write the migration**

```sql
-- OnStandard — Coach OS Slice B: per-athlete private coach notes.
-- Notes ABOUT an athlete (not tied to a meal — that's 0068's meal_comments kind='note').
-- Visible to team STAFF only; the athlete must NEVER read their own notes.
-- CRITICAL: the read policy is is_team_staff(team_id), NOT can_view(athlete_id) —
-- can_view() includes is_self(), which would leak the note to the athlete it's about.
-- Forward-only, idempotent (create-if-not-exists + guarded policy recreate).

create table if not exists coach_notes (
  id          uuid primary key default gen_random_uuid(),
  team_id     uuid not null references teams(id) on delete cascade,
  athlete_id  uuid not null references profiles(id) on delete cascade,
  author_id   uuid not null default auth.uid() references profiles(id),
  body        text not null check (char_length(body) between 1 and 4000),
  created_at  timestamptz not null default now()
);
create index if not exists cn_team_athlete on coach_notes (team_id, athlete_id, created_at desc);
alter table coach_notes enable row level security;

drop policy if exists cn_staff_read on coach_notes;
create policy cn_staff_read on coach_notes
  for select using (is_team_staff(team_id));
drop policy if exists cn_staff_write on coach_notes;
create policy cn_staff_write on coach_notes
  for insert with check (is_team_staff(team_id) and author_id = auth.uid());
drop policy if exists cn_author_delete on coach_notes;
create policy cn_author_delete on coach_notes
  for delete using (is_team_staff(team_id) and author_id = auth.uid());

comment on table coach_notes is
  'Per-athlete private staff notes. Staff-only (is_team_staff); the athlete never reads notes about themselves — do not switch to can_view.';
```
(FK on-delete: `athlete_id` cascades — athlete-owned PII per the 0007 erasure invariant. `author_id` is NO ACTION, matching the repo's 0055/0061/0071 actor-column idiom; the known staff-erasure follow-up already covers it — do not re-litigate here.)

- [ ] **Step 2: Pre-check + apply.** `supabase migration list --linked` (only 0073 pending — else BLOCKED), then `supabase db push --linked` (non-interactive; `dangerouslyDisableSandbox`).
- [ ] **Step 3: Verify.** Query `pg_class` for `coach_notes.relrowsecurity = t` and `pg_policies` shows the three policies. Confirm the read policy predicate contains `is_team_staff`, NOT `can_view`.
- [ ] **Step 4: Commit** `feat(coach-os): coach_notes per-athlete staff-only notes (0073, applied)` — file `supabase/migrations/0073_coach_notes.sql`.

---

### Task 2: roles.js helpers — notes CRUD, per-athlete history, standalone meal

**Files:** Modify `proto/redesign-2026-07/js/roles.js` (append after the Slice-A Coach OS section, ~line 430). Test: none new (network helpers; gate is suite-green — matches Slice A convention).

**Interfaces produced (best-effort idiom):**
- `fetchCoachNotes(teamId, athleteId)` → `[{id,author_id,body,created_at}]` newest first, or `[]`
- `postCoachNote(teamId, athleteId, body)` → `{ok, error?}`
- `deleteCoachNote(id)` → `boolean`
- `fetchAthleteInterventions(teamId, athleteId, sinceISO)` → `[{kind,reason_key,tier,note,created_at}]` newest first
- `fetchAthleteAssignments(athleteId, sinceISO)` → `[{id,title,proof,status,due_at,created_at,note}]` newest first
- `fetchMeal(mealId)` → one `meals` row or null (standalone, no ATH cache — lets Conversation resolve a meal directly)

- [ ] **Step 1: Implement** (mirror the file's exact idiom: `const c = sb(); if (!c||!x) return default; try {...} catch { return default; }`):

```js
/* ---------------- Coach OS Slice B: profile helpers ---------------- */
export async function fetchCoachNotes(teamId, athleteId) {
  const c = sb(); if (!c || !teamId || !athleteId) return [];
  try {
    const { data } = await c.from('coach_notes').select('id,author_id,body,created_at')
      .eq('team_id', teamId).eq('athlete_id', athleteId)
      .order('created_at', { ascending: false }).limit(100);
    return data || [];
  } catch { return []; }
}
export async function postCoachNote(teamId, athleteId, body) {
  const c = sb(); if (!c || !teamId || !athleteId) return { ok: false, error: 'You need a connection for this.' };
  try {
    const { error } = await c.from('coach_notes').insert({ team_id: teamId, athlete_id: athleteId, body });
    return error ? { ok: false, error: error.message || 'Could not save the note.' } : { ok: true };
  } catch (e) { return { ok: false, error: (e && e.message) || 'Could not save the note.' }; }
}
export async function deleteCoachNote(id) {
  const c = sb(); if (!c || !id) return false;
  try { const { error } = await c.from('coach_notes').delete().eq('id', id); return !error; } catch { return false; }
}
export async function fetchAthleteInterventions(teamId, athleteId, sinceISO) {
  const c = sb(); if (!c || !teamId || !athleteId) return [];
  try {
    let q = c.from('coach_interventions').select('kind,reason_key,tier,note,created_at')
      .eq('team_id', teamId).eq('athlete_id', athleteId);
    if (sinceISO) q = q.gte('day', sinceISO);
    const { data } = await q.order('created_at', { ascending: false }).limit(100);
    return data || [];
  } catch { return []; }
}
export async function fetchAthleteAssignments(athleteId, sinceISO) {
  const c = sb(); if (!c || !athleteId) return [];
  try {
    let q = c.from('requirement_assignments').select('id,title,proof,status,due_at,created_at,note')
      .eq('athlete_id', athleteId);
    if (sinceISO) q = q.gte('created_at', sinceISO);
    const { data } = await q.order('created_at', { ascending: false }).limit(60);
    return data || [];
  } catch { return []; }
}
export async function fetchMeal(mealId) {
  const c = sb(); if (!c || !mealId) return null;
  try { const { data } = await c.from('meals').select('*').eq('id', mealId).maybeSingle(); return data || null; } catch { return null; }
}
```
(RLS note for the implementer: `requirement_assignments`/`coach_interventions` reads are already `can_view`/staff-scoped from Slice A migrations — no explicit coach filter needed beyond the columns above; `athlete_id` filter narrows to the one athlete.)

- [ ] **Step 2:** `npx jest` (suite still 1967 green — no shape regressions). Commit `feat(coach-os): profile data helpers — notes CRUD, per-athlete history, standalone meal` — file `roles.js`.

---

### Task 3: Extract `sparkline` into a shared util

**Files:** Modify `proto/redesign-2026-07/js/components.js` (add `export function sparkline(hist)`), `js/screens/coach-roster.js` (import it, delete the inline copy). Test: none (pure SVG string; suite green + zip build catches import errors).

**Interface:** `sparkline(hist)` — `hist` = `[{date,score}]`; returns an SVG polyline string (green up / red down), `—` for <2 points. Behavior byte-identical to the current `coach-roster.js:22-29` inline version.

- [ ] **Step 1:** Move the function verbatim to `components.js`, `export` it. In `coach-roster.js`: `import { ..., sparkline } from '../components.js'` (add to existing import), delete the local `function sparkline`.
- [ ] **Step 2:** `node scripts/build-proto-zip.mjs && npm run verify && npx jest` green. Commit `refactor(coach-os): share sparkline util (no behavior change)` — files `components.js`, `coach-roster.js`, `assets/proto.zip`, `src/proto/protoVersion.ts`.

---

### Task 4: Profile data loader `loadAthleteProfile` in coach-data.js

**Files:** Modify `proto/redesign-2026-07/js/coach-data.js`. Test: none new (network loader; gate is suite green + smoke in Task 8).

**Interfaces produced:**
- `PROFILE` accessor `CD.profile` → `null | { athleteId, day, meals, photos:{mealId:url}, targets, basics, trustPass, interventions, assignments, notes, exceptions, row, status, offline }`
- `loadAthleteProfile(athleteId, force?)` — guarded per-athlete load (generation counter like the existing `loadAthlete`); fills `CD.profile`; repaints via `window.__render()` when the current hash is `#coach-athlete/<id>`.
- Reuses: the resolved status comes from running `athleteStatus` on the athlete's roster row (find it in `CD.roster.rows` by id; if roster not loaded, `await loadCoachRoster()` first) with `CD.extras.sets` — mirror `entriesFor`'s per-athlete computation (coach-data.js:128-148) rather than re-implementing.

- [ ] **Step 1: Implement** (mirror the existing `loadCoachRoster` guard idiom — `profileLoadingId`/`profileGen`; best-effort, `offline:true` on a thrown fetch):

```js
let PROFILE = null, profileLoadingId = null, profileGen = 0;
export async function loadAthleteProfile(athleteId, force) {
  if (!athleteId) return;
  if (profileLoadingId === athleteId && !force) return;
  if (PROFILE && PROFILE.athleteId === athleteId && !force) return;
  const gen = ++profileGen; profileLoadingId = athleteId;
  try {
    if (!CD.roster) await loadCoachRoster();           // need the row + extras (sets/exceptions)
    const teamId = CD.roster && CD.roster.teams[0] && CD.roster.teams[0].id;
    const since30 = roles.daysAgoISO(30);
    const [day, meals, targets, basics, trustPass, interventions, assignments, notes] = await Promise.all([
      roles.fetchDay(athleteId, roles.todayISO()),
      roles.fetchRecentMeals(athleteId, since30),
      roles.fetchAthleteTargets(athleteId),
      roles.fetchAthleteBasics(athleteId),
      roles.fetchActiveTrustPass(athleteId),
      roles.fetchAthleteInterventions(teamId, athleteId, since30),
      roles.fetchAthleteAssignments(athleteId, since30),
      roles.fetchCoachNotes(teamId, athleteId),
    ]);
    const photos = {};
    await Promise.all((meals || []).slice(0, 12).filter(m => m.photo_path).map(async (m) => {
      const u = await roles.signedMealPhotoUrl(m.photo_path); if (u) photos[m.id] = u;
    }));
    const row = (CD.roster.rows || []).find(r => r.athleteId === athleteId) || null;
    const exceptions = ((CD.extras && CD.extras.exceptions) || []).filter(e => e.athlete_id === athleteId);
    let status = null;
    if (row) {
      const now = new Date();
      status = athleteStatus({
        nowMin: now.getHours() * 60 + now.getMinutes(), nowMs: now.getTime(), nowDow: now.getDay(),
        row, reqs: resolveRequirementSet(CD.extras.sets, athleteId, row.position)
          ? catalogFromItems(resolveRequirementSet(CD.extras.sets, athleteId, row.position).items)
          : undefined,
        excused: exceptions.length > 0, needsReview: false,
      });
    }
    if (gen !== profileGen) return;                    // a newer load superseded us
    PROFILE = { athleteId, day, meals: meals || [], photos, targets, basics, trustPass,
      interventions, assignments, notes, exceptions, row, status, offline: false };
    // receipt: coach opened this athlete's day
    try { roles.markDayViewed(athleteId, roles.todayISO(), RT.userId, S.coachIdentity.handle); } catch { /* best-effort */ }
  } catch {
    if (gen === profileGen) PROFILE = { athleteId, offline: true };
  } finally {
    if (gen === profileGen) profileLoadingId = null;
    if (location.hash === `#coach-athlete/${athleteId}`) window.__render();
  }
}
```
Add `get profile() { return PROFILE; }` to the `CD` object. Import `RT`, `S` if not already (check current imports — coach-data.js may only import roles/requirements/status; add `import { RT, S } from './state.js'` only if needed for markDayViewed, else pass them from the screen). `resolveRequirementSet`/`catalogFromItems` are already imported by entriesFor — confirm and reuse.

- [ ] **Step 2:** `node scripts/build-proto-zip.mjs && npm run verify && npx jest` green. Commit `feat(coach-os): per-athlete profile loader (day, meals, history, notes, status)` — files `coach-data.js`, `assets/proto.zip`, `src/proto/protoVersion.ts`.

---

### Task 5: Profile shell + section switcher + Overview + Today

**Files:** Modify `proto/redesign-2026-07/js/screens/coach.js` — replace the `coachAthlete` screen object (coach.js:729-832) with the new six-section version. Keep `loadAthlete`/`ATH`/`mealById`/`coachMeal`/`trainerClient` UNTOUCHED (they serve the trainer path and existing meal links).

**Interface:** `coachAthlete = { nav:'coach', tab:'roster', render({sub}), mount(root) }`; module-level `let PSECTION = 'overview'`. Sections: `overview | today | activity | conversation | requirements | notes`.

- [ ] **Step 1: Shell + switcher + two sections.** In render: read `athleteId = sub`; `const P = CD.profile` (from Task 4); three states — loading (`!P || P.athleteId!==athleteId`), offline (`P.offline`), else the profile. Header via `backHead(name, 'position · coach view', 'coach-roster')` + the existing action affordances (Message/Nudge/Assign/Targets/Trust — reuse the current coach.js action rows, keep behavior). Then a **chip-row switcher** (mirror `coach-roster.js` filter chips): six chips bound to `PSECTION`, `data-psec="<key>"`. Then the active section body.
  - **Overview:** status chip (`STATUS_META[P.status.key]`), score today (`P.day?.score`), today's completion, current streak (from `P.day`/scoreHistory), last activity (`P.row.lastMealAt`), active alerts (`P.status.detail` + exceptions), 7-day trend via `sparkline(P.row.scoreHistory)`. All honest-empty when null.
  - **Today:** mirror the CURRENT `coachAthlete` render (coach.js:760-812) — stat triptych, "Today's proof" (today's meals from `P.meals` filtered to today, `P.photos`), "What's open", coach actions. This is a near-verbatim move of the existing screen into the Today pane.
- [ ] **Step 2: mount** — `loadAthleteProfile(athleteId)`; wire `[data-psec]` → set `PSECTION`, `window.__render()`; keep the existing trust-pass/message/nudge action wiring. Reset `PSECTION='overview'` when `athleteId` changes (track a module `let PSEC_FOR=null`).
- [ ] **Step 3:** `node scripts/build-proto-zip.mjs && npm run verify && npx jest` green. Commit `feat(coach-os): athlete profile shell — switcher, Overview, Today` — files `coach.js`, zip, protoVersion.

---

### Task 6: Activity + Conversation sections

**Files:** Modify `js/screens/coach.js` (the new `coachAthlete`).

- [ ] **Step 1: Activity pane** — a merged reverse-chronological timeline from `CD.profile`: meal logs (photo thumb + type + score/quality, `data-go="coach-meal/{id}"`), weight entries + check-ins (from `P.meals`/`P.day`), and **coach interventions** (`P.interventions`: "You nudged · 2d ago", "Marked handled", with `reason_key`/`note`). Each row dated. Honest-empty ("No activity in the last 30 days").
- [ ] **Step 2: Conversation pane** — list the athlete's meals that have threads; for each, a preview using `meal-intel.js` `openingMessage`/`threadMessages` (fetch on demand via `roles.fetchMealComments(mealId)` — or show the count and link to `coach-meal/{id}`). Simplest honest version: list recent meals with a "View thread" row → `coach-meal/{id}` (the full thread UI already exists there). Do NOT duplicate the composer here — Conversation is a directory into existing threads. Note the reuse in a comment.
- [ ] **Step 3:** build + verify + suite green. Commit `feat(coach-os): athlete profile — Activity timeline, Conversation directory` — files `coach.js`, zip, protoVersion.

---

### Task 7: Requirements + Notes sections

**Files:** Modify `js/screens/coach.js`.

- [ ] **Step 1: Requirements pane** — resolved set: `resolveRequirementSet(CD.extras.sets, athleteId, P.row.position)` → `catalogFromItems(...)` (fall back to built-in CATALOG when null), rendered as the athlete's governing requirements with a source label (individual / group / team / team default). Show active **exceptions** (`P.exceptions`) with reason + window. Show **assignment history** (`P.assignments`: title · proof · status · due/created date). A row → `coach-plan/{athleteId}` to edit (existing screen).
- [ ] **Step 2: Notes pane** — list `P.notes` (author + relative time + body, `esc`'d), each with a Delete affordance (own notes; `roles.deleteCoachNote` gated on success). A composer at the bottom: textarea + Save → `roles.postCoachNote(teamId, athleteId, body)`, gated on `ok` (honest inline error on failure, keep the text on failure), then `loadAthleteProfile(athleteId, true)` to refresh. A one-line honest banner: "Private to your staff — the athlete never sees these."
- [ ] **Step 3:** build + verify + suite green. Commit `feat(coach-os): athlete profile — Requirements, Notes` — files `coach.js`, zip, protoVersion.

---

### Task 8: Trainer-safety check + browser smoke + verify

**Files:** none (verification) unless a regression is found.

- [ ] **Step 1: Trainer regression check.** Confirm `loadAthlete`/`ATH`/`mealById`/`coachMeal`/`trainerClient` are unchanged by this slice (`git diff compliance-fixes..HEAD -- proto/redesign-2026-07/js/screens/coach.js` — only `coachAthlete` and any additive helpers should differ). If `trainerClient` shared any code path that moved, restore/duplicate so the trainer client screen renders identically.
- [ ] **Step 2: Browser smoke** (recipe from memory `proto-webview-audit-and-smoke`): serve the worktree proto on :8127, seed a coach RT, replace `window.sb` with the thenable-Proxy fake keyed by table/rpc (seed `team_roster`, `days`, `meals`, `coach_notes` → a couple rows, `coach_interventions`/`requirement_assignments` → a couple, `requirement_sets`/`athlete_exceptions` → []). `await import('./js/coach-data.js')` → `loadCoachRoster(true)` → `loadAthleteProfile('a2', true)`, navigate `#coach-athlete/a2`. Screenshot each of the six sections to scratchpad; verify: switcher moves between panes, Overview sparkline renders, Today mirrors the old screen, Activity merges interventions, Notes composer posts + the note appears + a Delete removes it (stub resolves ok), Conversation links to `coach-meal`. Also open `#trainer` / a trainer client to confirm no regression. Stub caveat: `.eq()` ignored → cross-athlete bleed is a stub artifact, not a bug.
- [ ] **Step 3:** Fix any proto-JS findings, rebuild zip, re-verify, commit `fix(coach-os): slice B smoke findings` (explicit files). Kill the http server.

---

## Final acceptance

- `npx jest` full suite green (1967, no new unit tests expected — engines already covered; this slice is screens + helpers + one migration).
- `npm run verify` green after zip rebuild.
- Six sections each render loading/offline/empty/populated honestly; Notes never claim to be athlete-visible; Notes read policy is `is_team_staff` (verified in Task 1).
- `coach_notes` rows appear in live DB when a note is saved (`supabase db query --linked "select count(*) from coach_notes"`).
- Trainer client screen (`trainerClient`) renders unchanged.
- Old links still work: `#coach-athlete/{id}`, `#coach-meal/{id}`, `#coach-plan/{id}`.

## Out of scope
Native `src/` parity; scoring changes; Slice C+ (Create/Standards/Inbox/Insights/permissions); embedding the full meal composer inside Conversation (it links to the existing `coachMeal`).
