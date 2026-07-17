# Coach OS Slice D — Inbox v2 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship Slice D of the Coach OS spec (docs/superpowers/specs/2026-07-16-coach-os-design.md §Slice D): a categorized coach Inbox (segmented control), AI-drafted suggested coach replies inside meal threads (four stances, coach edits & sends, AI never auto-sends), grouped deterministic alert rows, and thread resolution that writes `coach_interventions` so Follow-ups/Insights see it.

**Architecture:** All UI in the shipped proto WebView (`proto/redesign-2026-07/` — NOT `src/screens`, legacy). **No database migration** — categories are computed client-side by a pure engine (`js/inbox.js`, testable like `status.js`/`priority.js`), suggested replies are ephemeral (drafted server-side, returned, never persisted until the coach sends a normal comment), and thread resolution reuses the existing `coach_interventions` table (kinds `message`/`handled` already in the 0071 enum). The **one backend change** is a new `draftReplies` mode on the existing `meal-chat` edge function that returns four candidate coach-voice drafts and writes nothing (distinct from the existing `coachSupport` mode, which persists one AI message after the coach sends). Category state comes from one extra `meal_comments` team-fetch + a recent-interventions fetch (both single queries under existing RLS), not per-meal N-queries.

**Tech Stack:** Vanilla-JS ES modules (proto WebView), Supabase edge function (Deno + `@anthropic-ai/sdk`, model `claude-sonnet-5`), Jest 30 (TS tests in `src/core/` importing proto JS via `// @ts-ignore`), `npm run verify` gate (lint:xss + typecheck + test + bundle).

## Global Constraints

- **Branch:** build on a worktree branch off `compliance-fixes` (NOT master — stale). Base commit: current `compliance-fixes` HEAD (Slice C + 0075 merged).
- **No migration.** If any task believes it needs a schema change, STOP and report — the slice is designed migration-free. `coach_interventions.kind` already allows `nudge|message|assign|handled` (0071); `meal_comments` already has roles `athlete|coach|ai` and kinds `message|reaction|note` (0046/0049/0068).
- **AI never auto-sends.** Draft replies are candidates the coach must tap to load into the composer and then explicitly send. The draft endpoint persists NOTHING. Only `roles.postMealComment(...)` (coach-initiated) writes a thread message.
- **Thread caps unchanged (2/3/1).** Coach 2 `message` rows/meal is enforced by DB trigger `tg_meal_comment_caps` (0059/0060) and mirrored in the UI (coach.js ~1571-1581). Suggested replies must respect the coach cap: when 2 coach messages exist, drafting/sending is disabled with the existing honest copy. Reactions/notes exempt.
- **Numbers are never narrated fiction.** Category counts, briefing sentences, and grouped alerts are computed by plain code from real roster/meal/comment data. The AI drafts prose over context; it introduces no number not already present (the meal-chat system-prompt rule).
- **Pure engines take time/data from callers.** No `Date.now()`/`new Date()` inside `js/inbox.js` — callers pass `nowMs`. (Reviewers rejected `Date.now()` in engines twice in Slice A.) Give optional params JSDoc-typed defaults.
- **Deterministic honesty on thread state.** "Needs response" / "Resolved" are computed from real `meal_comments` last-author + `coach_interventions`, never guessed.
- **Dark tokens, existing classes** (`.co-seg`/`.co-chip`, `.card`, `.lrow`, `.eyebrow`, `.qa`/`.qa-row`, `titleHead`, `composer`). Blue→teal score-only, green status-only.
- **XSS:** every user/AI/athlete string rendered into HTML goes through `esc()` (lint:xss gate). AI draft text and athlete comment text are untrusted — escape them.
- **After any proto change** in a task: run the affected Jest suites. `node scripts/build-proto-zip.mjs` + full `npm run verify` happen once at the end (Task 6).
- **Edge-function safety:** the draft mode reuses `meal-chat`'s existing auth (caller JWT, `auth.getUser`, RLS-scoped meal select proving `can_view`); coach mode requires `mealRow.athlete_id !== callerId`. Add its own rate-limit key; never persist; keep the coach-voice prompt discipline (only context numbers, never shame, defer to coach).
- **Commits:** small, per task, `feat(coach-os): …` / `test(coach-os): …`.

## Deliberate deferrals (do NOT build; recorded so nobody adds them)

- **coach-notify-plan.js / push delivery of grouped alerts** — Slice E. Slice D renders grouped alerts as INBOX ROWS only (deterministic display grouping), no notification scheduling/quiet-hours/push.
- **Per-coach saved voice/tone flowing into drafts** — the `coach-voice` screen is a design preview; `personalityDirective` is an `assist`-only seam. Draft mode uses meal-chat's fixed coach-voice prompt in v1; a configurable directive is future work.
- **Server per-meal read receipts** — unseen state stays device-local (`RT.coachSeenMealIds`). No new table.
- **"Set a follow-up requirement" as an actual assignment** — the stance drafts a coach-voice MESSAGE proposing a follow-up; it does NOT call `assignRequirement`. Wiring a draft to a real requirement is future work.
- **Athletes-side changes** — trainer/parent inboxes untouched.

---

### Task 1: `meal-chat` draft mode — four candidate coach-voice replies, persisted nothing

**Files:**
- Modify: `supabase/functions/meal-chat/index.ts`
- Modify: `proto/redesign-2026-07/js/roles.js` (add `draftMealReplies`)
- Test: `src/core/mealDraftClient.test.ts` (new — client wrapper shape/error handling; the edge function itself is Deno, type-checked not unit-tested)

**Interfaces:**
- Consumes: meal-chat's existing caller-JWT auth, RLS-scoped meal select, `claim_ai_usage_key` rate-limit RPC, `ALLOWED_ORIGINS`/CORS.
- Produces:
  - Edge: request `{ mealId, draftReplies: true, context: object }` → response `{ drafts: [{ stance, text }] }` (4 items, stances `supportive|direct|context|followup`) or `{ error }`. Persists nothing. New rate-limit key `meal_draft:<uid>` (daily cap, reuse `MEAL_CHAT_DAILY_CAP` default 10) + the existing per-IP limit + a global key `meal_draft_global`.
  - Client: `roles.draftMealReplies(mealId, context)` → `{ ok, drafts?: [{stance,text}], error? }` (parses the vendored-supabase-js `FunctionsHttpError` off `error.context.json()`, same idiom as `screens/meal.js:818-828`).

- [ ] **Step 1: Read `supabase/functions/meal-chat/index.ts` end to end.** Note the coachSupport branch (lines ~117-182): auth (`auth.getUser`), meal select, `athlete_id !== callerId` coach gate, the `reply` forced tool, rate-limit RPC usage, CORS. The draft mode reuses all of this scaffolding.

- [ ] **Step 2: Write the failing client test**

```ts
// src/core/mealDraftClient.test.ts
// Verifies the roles wrapper shape + error parsing. supabase client is stubbed.
const invoke = jest.fn();
const fakeSb = { functions: { invoke: invoke } };
jest.mock('../../proto/redesign-2026-07/js/supa.js', () => ({}), { virtual: true }); // if needed; else set window.sb

// Load roles with window.sb stubbed (follow the JSDOM/lazy-require idiom used by other src/core proto tests).
// Pseudocode expectations:
test('draftMealReplies returns ok + drafts on success', async () => {
  invoke.mockResolvedValue({ data: { drafts: [
    { stance: 'supportive', text: 'Great consistency logging lunch.' },
    { stance: 'direct', text: 'Protein was light — hit 40g at dinner.' },
    { stance: 'context', text: 'What did the rest of your day look like?' },
    { stance: 'followup', text: 'Send me a photo of tomorrow’s breakfast.' },
  ] }, error: null });
  const r = await draftMealReplies('m1', { meal: {} });
  expect(r.ok).toBe(true);
  expect(r.drafts).toHaveLength(4);
  expect(r.drafts[0].stance).toBe('supportive');
});

test('draftMealReplies surfaces a limit error parsed off FunctionsHttpError', async () => {
  invoke.mockResolvedValue({ data: null, error: { context: { json: async () => ({ error: 'limit' }) } } });
  const r = await draftMealReplies('m1', { meal: {} });
  expect(r.ok).toBe(false);
  expect(r.error).toBe('limit');
});

test('draftMealReplies returns generic error when unreachable', async () => {
  invoke.mockRejectedValue(new Error('network'));
  const r = await draftMealReplies('m1', { meal: {} });
  expect(r.ok).toBe(false);
  expect(r.error).toBeTruthy();
});
```

Match the ACTUAL proto-test import idiom for `roles.js` — inspect an existing `src/core/*.test.ts` that imports `roles.js` (or that stubs `window.sb`), and follow whichever seam it uses (roles reads `window.sb` via a `sb()` helper — set `globalThis.window = { sb: fakeSb }` before the lazy `require`). If `roles.js` can't load under node without more globals, note it and stub minimally.

- [ ] **Step 3: Run — expect FAIL** (`draftMealReplies` not exported): `npx jest src/core/mealDraftClient.test.ts`

- [ ] **Step 4: Implement the edge draft mode.** In `meal-chat/index.ts`, add a branch when `body.draftReplies === true`, BEFORE/beside the coachSupport branch:
  - Reuse the existing auth + meal select + coach gate (`mealRow.athlete_id !== callerId` required; the RLS select already proves can_view).
  - Rate limit: per-IP (existing `RATE_LIMIT_PER_MIN`), per-user `claim_ai_usage_key('meal_draft:'+callerId, MEAL_CHAT_DAILY_CAP)` (fail open), global `meal_draft_global` (`MEAL_CHAT_GLOBAL_CAP`, fail closed) — mirror the coachSupport caps.
  - One model call, forced tool `draft_replies` with an array output of exactly 4 items:
    ```
    draft_replies({ drafts: [ { stance: 'supportive'|'direct'|'context'|'followup', text: string } x4 ] })
    ```
  - System prompt: reuse meal-chat's coach-voice rules (only numbers present in context; never shame; 60 words max per draft; no em dashes; no markdown), plus: "Draft FOUR alternative replies the COACH could send to the athlete about this meal, one per stance: supportive (reinforce what went right), direct (name the gap and the fix), context (ask one clarifying question), followup (propose one concrete next step). Speak AS the coach TO the athlete. These are drafts the coach will edit — do not sign them, do not send them."
  - Return `{ drafts }` (4 items). Persist NOTHING (no `meal_comments` insert). `max_tokens` ~500.
  - Errors: same shapes as coachSupport (`bad_request`/`unauthorized`/`limit`/`unavailable`).

- [ ] **Step 5: Implement `roles.draftMealReplies`** (near the other coach helpers, follow the `screens/meal.js` error-parse idiom):

```js
export async function draftMealReplies(mealId, context) {
  const c = sb(); if (!c || !mealId) return { ok: false, error: 'offline' };
  try {
    const { data, error } = await c.functions.invoke('meal-chat', { body: { mealId, draftReplies: true, context: context || {} } });
    if (error || !data || data.error) {
      let parsed = data && data.error ? data : null;
      if (!parsed && error && error.context && typeof error.context.json === 'function') parsed = await error.context.json().catch(() => null);
      return { ok: false, error: (parsed && parsed.error) || 'unavailable' };
    }
    return { ok: true, drafts: Array.isArray(data.drafts) ? data.drafts : [] };
  } catch (e) { return { ok: false, error: String((e && e.message) || e) }; }
}
```

- [ ] **Step 6: Run** `npx jest src/core/mealDraftClient.test.ts` — green. Deno typecheck the edge fn if deno is available (`deno check supabase/functions/meal-chat/index.ts`); else state it wasn't type-checked locally.

- [ ] **Step 7: Commit**

```bash
git add supabase/functions/meal-chat/index.ts proto/redesign-2026-07/js/roles.js src/core/mealDraftClient.test.ts
git commit -m "feat(coach-os): meal-chat draft mode — four coach-voice reply candidates, persisted nothing"
```

**NOTE for the orchestrator:** deploying `meal-chat` (`supabase functions deploy meal-chat`) happens after review, alongside no migration (there is none).

---

### Task 2: `js/inbox.js` — pure categorizer + grouped alerts, plus roles fetchers

**Files:**
- Create: `proto/redesign-2026-07/js/inbox.js`
- Modify: `proto/redesign-2026-07/js/roles.js` (add `fetchTeamMealComments`, `fetchRecentInterventions`)
- Test: `src/core/inbox.test.ts` (new)

**Interfaces:**
- Consumes: recent meals (CD.act.rows shape: `{id, athlete_id, type, protein, kcal, quality, logged_at}`), recent `meal_comments` (`{meal_id, role, kind, created_at}`), interventions (`{athlete_id, kind, reason_key, created_at}`), roster rows (for names/status), pending join requests, staff list, announcements, `seenIds` set, `nowMs`.
- Produces:
  - `categorizeInbox({ meals, comments, interventions, roster, pending, staff, announcements, seenIds, nowMs })` → `{ needsResponse: Row[], athletes: Row[], mealReviews: Row[], staff: Row[], announcements: Row[], resolved: Row[], counts: {…} }` where each `Row` is `{ kind:'meal'|'join'|'staff'|'announcement'|'alert', id, athleteId?, title, sub, go?, ts }`.
  - `inboxAlerts(entries, nowMs)` → `Row[]` of grouped alerts (`kind:'alert'`), e.g. `{ id:'alert:overdue:lunch', title:'3 athletes missed lunch', sub:'…', ts }` — grouped by `openItems[].id` where `state==='overdue'` across the scope's `entries` ([{row,status}] from `entriesFor`).
  - roles: `fetchTeamMealComments(athleteIds, sinceISO)` (one query, RLS-scoped) → `[{meal_id, athlete_id, role, kind, created_at}]`; `fetchRecentInterventions(teamId, sinceISO)` → `[{athlete_id, kind, reason_key, created_at}]`.

- [ ] **Step 1: Write the failing test**

```ts
// src/core/inbox.test.ts
// @ts-ignore
import { categorizeInbox, inboxAlerts } from '../../proto/redesign-2026-07/js/inbox.js';

const NOW = 1_700_000_000_000;
const meal = (id: string, over = {}) => ({ id, athlete_id: 'a1', type: 'Lunch', protein: 20, quality: 70, logged_at: new Date(NOW - 3600_000).toISOString(), ...over });

test('a meal whose last comment is from the athlete lands in needsResponse', () => {
  const out = categorizeInbox({
    meals: [meal('m1')],
    comments: [
      { meal_id: 'm1', role: 'coach', kind: 'message', created_at: new Date(NOW - 7200_000).toISOString() },
      { meal_id: 'm1', role: 'athlete', kind: 'message', created_at: new Date(NOW - 1800_000).toISOString() },
    ],
    interventions: [], roster: [{ athleteId: 'a1', name: 'Devin' }], pending: [], staff: [], announcements: [], seenIds: new Set(), nowMs: NOW,
  });
  expect(out.needsResponse.some(r => r.id === 'm1')).toBe(true);
  expect(out.counts.needsResponse).toBeGreaterThanOrEqual(1);
});

test('an unseen meal with no comments lands in mealReviews, not needsResponse', () => {
  const out = categorizeInbox({ meals: [meal('m2')], comments: [], interventions: [], roster: [{ athleteId: 'a1', name: 'Devin' }], pending: [], staff: [], announcements: [], seenIds: new Set(), nowMs: NOW });
  expect(out.mealReviews.some(r => r.id === 'm2')).toBe(true);
  expect(out.needsResponse.some(r => r.id === 'm2')).toBe(false);
});

test('a meal with a handled intervention (reason_key meal:<id>) lands in resolved', () => {
  const out = categorizeInbox({
    meals: [meal('m3')],
    comments: [{ meal_id: 'm3', role: 'athlete', kind: 'message', created_at: new Date(NOW - 1800_000).toISOString() }],
    interventions: [{ athlete_id: 'a1', kind: 'handled', reason_key: 'meal:m3', created_at: new Date(NOW - 600_000).toISOString() }],
    roster: [{ athleteId: 'a1', name: 'Devin' }], pending: [], staff: [], announcements: [], seenIds: new Set(), nowMs: NOW,
  });
  expect(out.resolved.some(r => r.id === 'm3')).toBe(true);
  expect(out.needsResponse.some(r => r.id === 'm3')).toBe(false); // resolved wins
});

test('all athlete meal threads appear under athletes; join requests under staff-adjacent needsResponse', () => {
  const out = categorizeInbox({ meals: [meal('m4')], comments: [], interventions: [], roster: [{ athleteId: 'a1', name: 'Devin' }], pending: [{ id: 'p1', name: 'New Kid' }], staff: [], announcements: [], seenIds: new Set(['m4']), nowMs: NOW });
  expect(out.athletes.some(r => r.id === 'm4')).toBe(true);
  expect(out.needsResponse.some(r => r.kind === 'join')).toBe(true);
});

test('inboxAlerts groups overdue requirements across athletes', () => {
  const entries = [
    { row: { athleteId: 'a1', name: 'A' }, status: { key: 'overdue', openItems: [{ id: 'lunch', title: 'Lunch', state: 'overdue' }] } },
    { row: { athleteId: 'a2', name: 'B' }, status: { key: 'overdue', openItems: [{ id: 'lunch', title: 'Lunch', state: 'overdue' }] } },
    { row: { athleteId: 'a3', name: 'C' }, status: { key: 'on_standard', openItems: [] } },
  ];
  const alerts = inboxAlerts(entries, NOW);
  const lunch = alerts.find(a => a.id.includes('lunch'));
  expect(lunch).toBeTruthy();
  expect(lunch!.title).toMatch(/2 athletes/);
});
```

- [ ] **Step 2: Run — expect FAIL** (module missing): `npx jest src/core/inbox.test.ts`

- [ ] **Step 3: Implement `js/inbox.js`** (pure, header comment: "computes Inbox v2 categories + grouped alerts from real roster/meal/comment/intervention data — no clock, callers pass nowMs; mirrors status.js/priority.js purity"). Rules:
  - Build `lastByMeal`: for each meal, the latest `message`-kind comment's role (ignore reaction/note).
  - `resolvedMealIds` = set of meal ids with a `handled` intervention whose `reason_key === 'meal:'+id`.
  - **needsResponse**: meals where `lastByMeal[id] === 'athlete'` (athlete spoke last) AND not resolved; plus `pending` join rows (kind `join`); plus `inboxAlerts` rows. Sort by ts desc.
  - **athletes**: all athlete meal threads (every recent meal, athlete-owned), regardless of seen.
  - **mealReviews**: meals not in `seenIds` with no coach message yet (fresh logs to review). (Unseen + `lastByMeal[id] !== 'coach'` and not athlete-awaiting → still show; keep it "unopened logs".)
  - **staff**: staff invites/rows (from `staff`) — kind `staff`. (v1 may be thin; honest empty state.)
  - **announcements**: announcement rows (kind `announcement`).
  - **resolved**: meals in `resolvedMealIds`.
  - `counts` per category (numbers only; drive the chip badges).
  - Escape nothing here (pure data → strings are escaped at render in Task 3).

- [ ] **Step 4: Implement roles fetchers** (follow the `sb()`/try-catch idiom, e.g. `fetchTeamActivity` at roles.js:126):

```js
export async function fetchTeamMealComments(athleteIds, sinceISO) {
  const c = sb(); if (!c || !athleteIds || !athleteIds.length) return [];
  try {
    const { data } = await c.from('meal_comments')
      .select('meal_id,athlete_id,role,kind,created_at')
      .in('athlete_id', athleteIds).gte('created_at', sinceISO)
      .order('created_at', { ascending: true }).limit(1000);
    return data || [];
  } catch { return []; }
}
export async function fetchRecentInterventions(teamId, sinceISO) {
  const c = sb(); if (!c || !teamId) return [];
  try {
    const { data } = await c.from('coach_interventions')
      .select('athlete_id,kind,reason_key,created_at')
      .eq('team_id', teamId).gte('created_at', sinceISO)
      .order('created_at', { ascending: false }).limit(500);
    return data || [];
  } catch { return []; }
}
```

- [ ] **Step 5: Run** `npx jest src/core/inbox.test.ts` — green. **Step 6: Commit**

```bash
git add proto/redesign-2026-07/js/inbox.js proto/redesign-2026-07/js/roles.js src/core/inbox.test.ts
git commit -m "feat(coach-os): pure Inbox v2 categorizer + grouped alerts + team comment/intervention fetchers"
```

---

### Task 3: Inbox v2 UI — categorized segmented control in `coachInbox`

**Files:**
- Modify: `proto/redesign-2026-07/js/screens/coach.js` (`coachInbox` render/mount, ~746-854; `loadAnnouncements`/caches region)
- Modify: `proto/redesign-2026-07/js/coach-data.js` (add a small loader for team comments + recent interventions into `CD`, or a module cache in coach.js — match how `ANN_CACHE`/`loadAnnouncements` is done)
- Test: none new (pure logic is Task 2; this is DOM wiring — covered by the browser smoke in Task 6). If `coachInbox` exposes a pure helper, add a focused test; otherwise document why not.

**Interfaces:**
- Consumes: `categorizeInbox`/`inboxAlerts` (Task 2), `fetchTeamMealComments`/`fetchRecentInterventions` (Task 2), `CD.roster`/`CD.act`/`RT.coachSeenMealIds`/`ANN_CACHE`, the `.co-seg`/`.co-chip` pattern (coach.js:1311-1313, css/coach.css:92-113).
- Produces: a rebuilt `coachInbox` with a category chip row + selected-category content; module var `INBOX_CAT` (default `'needsResponse'`) persisted in `localStorage` (`onstd-inbox-cat-v1`); a module cache `INBOX_DATA {teamId, comments, interventions}`.

- [ ] **Step 1: Load data.** In `coachInbox.mount`, after `loadCoachRoster().then(...)`, load activity + announcements (as today) + the two new fetches into a module cache: compute `athleteIds` from `CD.roster.rows`, `sinceISO` = e.g. 7 days ago (pass a caller-computed ISO — do NOT hardcode a clock in a pure fn; here in mount `new Date()` is allowed, it's a screen), call `fetchTeamMealComments(athleteIds, sinceISO)` and `fetchRecentInterventions(teamId, sinceISO)`, store in `INBOX_DATA`, then `window.__render()` (guarded to the inbox route, like `loadActivity`).

- [ ] **Step 2: Render.** Replace the flat sections with:
  - `titleHead('Inbox', <needsMe> ? '<n> need you' : 'All caught up')`.
  - Category chip row (`.co-seg`), one `.co-chip` per category with a count badge (`.cnt`), reflecting `out.counts`. Order: Needs response · Athletes · Meal reviews · Staff · Announcements · Resolved. Active = `INBOX_CAT`.
  - Below it, render the selected category's rows as `.lrow`s. Meal rows deep-link `coach-meal/<id>` (escape id). Join rows keep approve/decline buttons (`[data-jr]`). Announcement rows link `coach-announce`. Alert rows are non-clickable summaries (or link to a filtered roster — keep simple: non-clickable in v1). Each row's title/sub through `esc()`.
  - Honest empty state per category ("No threads need you right now.", etc.).
  - Compact briefing line folded into the Needs-response empty/full header (reuse the existing deterministic briefing sentence builder — keep it, it's the coach's read).
- Build the row list once via `categorizeInbox({...})` using `INBOX_DATA` + `CD` + `RT` + `ANN_CACHE`.

- [ ] **Step 3: Wire.** `[data-icat]` chips → set `INBOX_CAT` + persist to localStorage + `window.__render()`. Preserve the `[data-jr]` approve/decline wiring. Preserve `badge()` (now = `counts.needsResponse` or `pending+unseen` — keep it meaningful; use `needsResponse` count).

- [ ] **Step 4: Verify no regression** in the coach-home unseen/activity block (it shares `RT.coachSeenMealIds` + `CD.act` — do NOT change coach-home). Run `npx jest src/core` (nothing should break; inbox pure logic already covered).

- [ ] **Step 5: Commit**

```bash
git add proto/redesign-2026-07/js/screens/coach.js proto/redesign-2026-07/js/coach-data.js
git commit -m "feat(coach-os): Inbox v2 — six-category segmented control over real thread state"
```

---

### Task 4: Suggested replies UI in the coach meal thread

**Files:**
- Modify: `proto/redesign-2026-07/js/screens/coach.js` (`coachMeal` render/mount, ~1436-1633)
- Test: none new (network-driven UI; smoke-tested in Task 6). If a pure stance-label/prefill helper is factored out, unit-test it.

**Interfaces:**
- Consumes: `roles.draftMealReplies(mealId, context)` (Task 1), the coach composer (`#cm-input`/`#cm-send`), the coach-cap logic (coach.js:1571-1581), the `.qa`/`.qa-row` prefill pattern (meal.js:565-568,796).
- Produces: a "Draft a reply" affordance in the coach thread; on tap → loading → 4 stance chips (Supportive / Direct / Ask for context / Set a follow-up); tapping a chip fills `#cm-input` with the draft text (coach edits, then uses the existing Send). Module state `DRAFTS {mealId, items, loading, error}`.

- [ ] **Step 1: Render affordance.** In `coachMeal.render`, above the composer, when the coach cap is NOT reached (`coachN < 2`), show a `.qa-row` with a single "✍️ Draft a reply" button (`#cm-draft`). If `DRAFTS.mealId === sub && DRAFTS.items.length`, render the 4 stance chips instead: `.qa` buttons labeled Supportive/Direct/Ask for context/Set a follow-up, each `data-draft="<index>"`. Loading → a muted "Drafting…" line. Error → honest line ("Couldn't draft right now — write your own or try again."). When cap reached, show nothing (the existing cap note covers it).

- [ ] **Step 2: Wire.** In `mount`:
  - `#cm-draft` click → set `DRAFTS = {mealId: sub, items: [], loading: true, error: null}`, `window.__render()`, then `roles.draftMealReplies(sub, context)` where `context` mirrors the coachSupport context (meal type/protein/kcal/quality + last few thread messages via `threadMessages(MC.comments).slice(-6)`). On resolve: set items/error, `window.__render()`.
  - `[data-draft]` chip click → set `#cm-input.value` to the draft text (the REAL element value; do not re-render over it), focus it, and clear the chip row (`DRAFTS.items = []`) WITHOUT wiping the input — i.e. set input value first, then `window.__render()` reads the value back? No: setting input.value then __render() rebuilds DOM and loses it. So: on chip tap, set input value and DO NOT re-render; just hide the chip row via direct DOM (`el.closest('.qa-row').remove()`), matching the "never re-render over a live input" rule. The coach then edits and taps the existing Send.
  - The existing Send path (postMealComment + coachSupport meal-chat) is unchanged — the draft only prefills.
- AI never auto-sends: the draft only populates the input; the coach must tap Send.

- [ ] **Step 3: Respect the cap.** Ensure `#cm-draft` is absent/disabled when `coachN >= 2` (drafting a reply you can't send is dishonest). Reuse the existing `coachN` computation.

- [ ] **Step 4: Manual sanity + commit.** Run `npx jest src/core` (unaffected). Commit:

```bash
git add proto/redesign-2026-07/js/screens/coach.js
git commit -m "feat(coach-os): suggested coach replies — four AI-drafted stances that prefill the composer, coach sends"
```

---

### Task 5: Thread resolution + interventions

**Files:**
- Modify: `proto/redesign-2026-07/js/screens/coach.js` (`coachMeal` submit + a "Mark resolved" action)
- Test: none new pure (categorizer resolved-path already tested in Task 2); this wires the WRITE side.

**Interfaces:**
- Consumes: `roles.logIntervention({teamId, athleteId, kind, reasonKey})` (roles.js:396), the categorizer's `reason_key === 'meal:'+id` convention (Task 2), `CD.roster.teams[0].id`.
- Produces: on a successful coach `postMealComment`, a `logIntervention({kind:'message', reasonKey:'meal:'+mealId})`; a "Mark resolved" button in the coach thread → `logIntervention({kind:'handled', reasonKey:'meal:'+mealId})` then navigate back to inbox (or show resolved state). These make the meal appear in Follow-ups (Home) and the Resolved inbox category.

- [ ] **Step 1: Log on coach message.** In `coachMeal.submit` (~1582-1608), after `postMealComment(...)` succeeds and before/after the fire-and-forget meal-chat, add `roles.logIntervention({ teamId, athleteId: meal.athlete_id, kind: 'message', reasonKey: 'meal:'+sub })` (fire-and-forget, `.catch(()=>{})` — never block the send). `teamId` from `CD.roster.teams[0].id`.

- [ ] **Step 2: Mark resolved action.** Add a "Mark resolved" affordance (a `.btn ghost` near the quick actions). On tap → `logIntervention({ teamId, athleteId, kind:'handled', reasonKey:'meal:'+sub })`; on success show a brief "Resolved." status and set a module flag so the button flips to "Resolved ✓" (idempotent — a second tap is a no-op or re-logs harmlessly). Optionally navigate `#coach-inbox` after a short delay.

- [ ] **Step 3: Refresh inbox data.** Because resolution changes categories, ensure returning to the inbox re-fetches interventions (the inbox `mount` already re-fetches; confirm `fetchRecentInterventions` runs on inbox mount so the resolved meal moves out of Needs-response into Resolved).

- [ ] **Step 4: Commit**

```bash
git add proto/redesign-2026-07/js/screens/coach.js
git commit -m "feat(coach-os): coach thread writes message/handled interventions; Mark resolved moves a thread to Resolved"
```

---

### Task 6: Ship gate — proto zip, full verify, browser smoke

**Files:**
- Modify: `assets/proto.zip` + `src/proto/protoVersion.ts` (generated)

- [ ] **Step 1:** `node scripts/build-proto-zip.mjs`
- [ ] **Step 2:** `npm run verify` — lint:xss + typecheck + full Jest + bundle. All green; fix forward anything red and say what it was.
- [ ] **Step 3: Browser smoke** (recipe from the proto-webview memory — serve `proto/redesign-2026-07` with `python -m http.server 8127`; mutate live modules in one evaluate call: `const st = await import('./js/state.js'); st.RT.userId='x'; st.RT.authRole='coach'; …`; stub `window.sb` with the thenable-Proxy fake keyed by table/rpc/function name — for `functions.invoke('meal-chat', {body:{draftReplies:true}})` return `{data:{drafts:[4 items]},error:null}`; seed `meal_comments`, `coach_interventions`, `meals`, `announcements`, `team_members`; `await cd.loadCoachRoster(true)`; navigate via `location.hash` only, no reload). Walk:
  1. `#coach-inbox` — six category chips render with counts; switching category swaps content; a meal row deep-links.
  2. `#coach-meal/<id>` — "Draft a reply" button → 4 stance chips (from the stubbed draft response) → tapping one fills the composer; Send stays coach-initiated; "Mark resolved" present.
  3. Resolve a thread (stub the intervention insert) → returning to `#coach-inbox` shows it under Resolved (stub `coach_interventions` fetch to include the handled row).
  4. Screenshot each into `.superpowers/sdd/smoke/`.
- [ ] **Step 4: Commit** the zip/version bump: `git add assets/proto.zip src/proto/protoVersion.ts && git commit -m "chore(coach-os): proto zip — slice D"`

---

## Self-Review (done at write time)

- **Spec coverage:** categorized segmented control (Needs response · Athletes · Meal reviews · Staff · Announcements · Resolved) ✔ (Tasks 2/3). Thread previews with substance ✔ (categorizer builds title/sub from real state; Task 2/3). Suggested coach replies — four stances, coach edits & sends, AI never auto-sends, caps unchanged ✔ (Tasks 1/4). AI-generated grouped alerts as inbox rows ✔ (`inboxAlerts`, Task 2/3; delivery/planner deferred to E per spec). Resolving a thread writes `coach_interventions` (message/handled) ✔ (Task 5). Thread caps 2/3/1 unchanged ✔ (constraint + Task 4 gating).
- **No migration:** confirmed — `coach_interventions.kind` (0071) and `meal_comments` roles/kinds (0046/0049/0068) already support everything.
- **Type consistency:** `draftMealReplies` returns `{ok,drafts,error}` consumed by Task 4; `categorizeInbox` returns `{...categories, counts}` consumed by Task 3; `reason_key` convention `meal:<id>` is written in Task 5 and read in Task 2 — identical string.
- **Honest unknowns delegated with instructions:** roles.js proto-test import idiom (inspect existing src/core test), Deno typecheck coverage, the exact `.co-seg`/`.cnt` markup (verbatim from coach.js:1311), the "never re-render over a live input" prefill mechanic (Task 4 Step 2). Each has a verify-then-adjust instruction.
