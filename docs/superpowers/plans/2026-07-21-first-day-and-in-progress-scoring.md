# First-day activation fix + in-progress day framing — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A brand-new account never shows "Off Standard / 0 / OVERDUE" on day one, and no day shows a failure verdict before it's actually over.

**Architecture:** Two independent parts. Part A (Task 1) anchors first-day activation to the account's server creation date (`profiles.created_at`) instead of a stale device-carried commit stamp. Part B (Tasks 2–4) is presentation-only: a pure `dayDecided` rule delays the negative verdict until a day's required windows have all closed, softens the requirement pill ladder (Upcoming → Due → Late → Missed), and holds the hero in a neutral "In progress" state while a sub-passing day is still winnable. The score math (`computeScore`, `WEIGHTS`, denominators, streaks) is never touched.

**Tech Stack:** Vanilla ESM JS proto (`proto/redesign-2026-07/js/`), Jest tests in `src/core/*.test.ts` that import the proto modules under jsdom.

## Global Constraints

- **Score math does not bend (founder decision D3):** never change `WEIGHTS` (state.js:106), `computeScore` (state.js:111), denominators, or streak math. `scoreParity` / `standardDay` suites must stay green — they are the proof.
- **No emoji as icons; icons only via `icon(name,size)`** from `js/icons.js`.
- **Pills are read-only** (`.status-pill` never interactive).
- **`esc()` every interpolated value** rendered to HTML (from `js/components.js`).
- **No new migration / grant / RLS change.** `profiles.created_at` already exists and the app already self-selects `profiles` columns for the signed-in user.
- **Pure helpers take the clock as an argument** (no `Date.now()` inside `js/activation.js` / `js/dayverdict.js`), matching the existing `activation.js` contract.
- Test runner: `npx jest <file>` (repo `npm test` = jest). Full gate: `npm run verify` (xss lint + typecheck + jest + expo bundle).

---

### Task 1: Part A — anchor activation to the account's server birthday

Fixes the founder-reported bug: a fresh account carries an 11-day-old `committed_at` from a prior onboarding run on the same device, so first-day grace never fires. Anchor to `profiles.created_at`.

**Files:**
- Modify: `proto/redesign-2026-07/js/state.js` — `activationStamp()` (~397-399); profile-load select + patch (~1158, ~1166); `persistOnboarding` stamp guard (~1629) and the `_stampConsent` argument (~1656); add `createdAt: null` to the profile defaults if the profile object is shape-checked (it is a loose object — no schema change needed).
- Test: `src/core/firstDayActivationLive.test.ts` (append cases).

**Interfaces:**
- Consumes: `parseActivation` (already imported at state.js:21), `todayISO` (already imported at state.js:37), `RT.profile.createdAt` (new, hydrated from server), `RT.profile.committedAt` (existing).
- Produces: `activationStamp()` now prefers `RT.profile.createdAt` for the activation date, using `committed` only to refine the minute on the same day. `S.activation` / `S.notYetScored` behavior is unchanged in signature; only the source of the date changes.

- [ ] **Step 1: Write the failing tests** — append to `src/core/firstDayActivationLive.test.ts`:

```ts
describe('activation anchors to the account birthday, not a stale device stamp', () => {
  const isoDaysAgo = (days: number, h = 12, mi = 0) =>
    new Date(t.getFullYear(), t.getMonth(), t.getDate() - days, h, mi).toISOString();

  test('created today but committed_at is 11 days stale → still activation day (created_at wins)', () => {
    // Reproduces the founder's row: created today, committed_at carried from 11 days ago.
    RT.activationDate = isoDaysAgo(11, 12, 35); // stale local carry too
    RT.profile = { createdAt: activatedToday634pm, committedAt: isoDaysAgo(11, 12, 35) };
    expect(S.activation.isActivationDay).toBe(true);
    expect(S.notYetScored).toBe(true);
    expect(lunch(S.exec).state).toBe('not_required'); // lunch window closed pre-signup → excused
  });

  test('created today + committed_at same day → uses committed_at to refine the minute', () => {
    const createdEarly = new Date(t.getFullYear(), t.getMonth(), t.getDate(), 9, 0).toISOString();
    RT.activationDate = null;
    RT.profile = { createdAt: createdEarly, committedAt: activatedToday634pm };
    expect(S.activation.isActivationDay).toBe(true);
    expect(S.activation.activationMin).toBe(1114); // 6:34 PM, the finer commit minute
  });

  test('created yesterday (established user) → fully active even if a commit stamp is today', () => {
    RT.activationDate = activatedToday634pm;
    RT.profile = { createdAt: isoDaysAgo(1, 18, 34), committedAt: activatedToday634pm };
    expect(S.activation.isActivationDay).toBe(false);
    expect(S.notYetScored).toBe(false);
  });

  test('no created_at (older client) → falls back to the commit stamp (prior behavior)', () => {
    RT.activationDate = activatedToday634pm;
    RT.profile = {}; // no createdAt
    expect(S.notYetScored).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx jest src/core/firstDayActivationLive.test.ts -t "anchors to the account birthday"`
Expected: FAIL — the first case fails because today's `activationStamp()` returns the stale July-style stamp and `isActivationDay` is false.

- [ ] **Step 3: Rewrite `activationStamp()`** in `proto/redesign-2026-07/js/state.js` (replace lines ~397-399):

```js
/* The athlete's activation stamp for the first-day (no-retroactive-failure) rules. The account's
   SERVER birthday (profiles.created_at, hydrated into RT.profile.createdAt) is the authoritative,
   tamper-proof anchor — it can't be stale because the row didn't exist until the account did. A
   commit stamp (RT.activationDate / RT.profile.committedAt) only refines the minute-of-day, and
   only when it lands on the birthday; a stale cross-day carry (the founder's 11-day-old stamp) is
   ignored. No server birthday (older clients) ⇒ prior commit-stamp behavior, so nobody regresses. */
function activationStamp() {
  const created = (RT.profile && RT.profile.createdAt) || null;
  const committed = RT.activationDate || (RT.profile && RT.profile.committedAt) || null;
  if (created) {
    const cd = parseActivation(created);
    const md = committed ? parseActivation(committed) : null;
    if (cd && md && md.date === cd.date) return committed; // same-day: keep the finer minute
    if (cd) return created;                                 // reject a stale cross-day commit
  }
  return committed;
}
```

- [ ] **Step 4: Run to verify they pass**

Run: `npx jest src/core/firstDayActivationLive.test.ts -t "anchors to the account birthday"`
Expected: PASS (all four).

- [ ] **Step 5: Hydrate `created_at` from the server** in `proto/redesign-2026-07/js/state.js`. In the profile-load select (~1158) add the column:

```js
const { data: prof } = await sb.from('profiles').select('full_name,committed_at,created_at').eq('id', userId).maybeSingle();
```

And in the patch block (right after the `committed_at` line ~1166):

```js
      if (prof && prof.created_at) patch.createdAt = prof.created_at; // server birthday: the activation anchor
```

- [ ] **Step 6: Stop writing a stale commit stamp** in `persistOnboarding` (~1629). Replace the single stamp line:

```js
    if (!RT.activationDate) { RT.activationDate = ob.committedAt || new Date().toISOString(); save(); }
```

with a today-guarded stamp (a carried stamp from a prior day is never reused):

```js
    if (!RT.activationDate) {
      const c = ob.committedAt ? parseActivation(ob.committedAt) : null;
      RT.activationDate = (c && c.date === todayISO()) ? ob.committedAt : new Date().toISOString();
      save();
    }
```

And where `_stampConsent` is called (~1656), pass the same guarded value so a stale scratch can't poison the server backstop:

```js
      synced.stamps = await this._stampConsent(RT.activationDate || ob.committedAt);
```

- [ ] **Step 7: Run the full first-day suites to confirm no regression**

Run: `npx jest src/core/firstDayActivation.test.ts src/core/firstDayActivationLive.test.ts`
Expected: PASS (existing cases + the four new ones).

- [ ] **Step 8: Commit**

```bash
git add proto/redesign-2026-07/js/state.js src/core/firstDayActivationLive.test.ts
git commit -m "fix(activation): anchor first-day grace to profiles.created_at, not a stale device commit stamp"
```

---

### Task 2: Part B1 — pure `dayDecided` helper

A day is "decided" when no required window is still open on time — every required item is done or past its close. Red verdicts are only allowed once a day is decided.

**Files:**
- Create: `proto/redesign-2026-07/js/dayverdict.js`
- Test: `src/core/dayVerdict.test.ts` (new)

**Interfaces:**
- Consumes: an array of derived exec items (each `{ required, state }`), as produced by `deriveExec` (exec.js).
- Produces: `dayDecided(items) → boolean`. True when no required item is in an on-time-actionable state (`locked`, `ready`, `due_soon`); i.e. every required item is done, past-window (`overdue`), or excused (`not_required`). An empty/all-optional day is vacuously decided.

- [ ] **Step 1: Write the failing test** — create `src/core/dayVerdict.test.ts`:

```ts
// @ts-ignore — proto is plain ESM JS (allowJs), same import pattern as exec.test.ts
import { dayDecided } from '../../proto/redesign-2026-07/js/dayverdict.js';

const req = (state: string) => ({ required: true, state });
const opt = (state: string) => ({ required: false, state });

describe('dayDecided — the day is over for on-time purposes', () => {
  test('an open required window (ready) → not decided', () => {
    expect(dayDecided([req('overdue'), req('ready')])).toBe(false);
  });
  test('a locked (not-yet-open) required window → not decided (still ahead)', () => {
    expect(dayDecided([req('done'), req('locked')])).toBe(false);
  });
  test('a due_soon required window → not decided', () => {
    expect(dayDecided([req('due_soon')])).toBe(false);
  });
  test('all required done or past-window → decided', () => {
    expect(dayDecided([req('done'), req('done_late'), req('overdue')])).toBe(true);
  });
  test('all required done → decided (a finished win)', () => {
    expect(dayDecided([req('done'), req('done')])).toBe(true);
  });
  test('open windows are optional only → decided (optional never holds the day open)', () => {
    expect(dayDecided([req('done'), opt('ready'), opt('due_soon')])).toBe(true);
  });
  test('excused pre-activation windows do not hold the day open', () => {
    expect(dayDecided([req('not_required'), req('overdue')])).toBe(true);
  });
  test('empty / no required items → vacuously decided', () => {
    expect(dayDecided([])).toBe(true);
    expect(dayDecided([opt('ready')])).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx jest src/core/dayVerdict.test.ts`
Expected: FAIL with "Cannot find module '.../dayverdict.js'".

- [ ] **Step 3: Write the implementation** — create `proto/redesign-2026-07/js/dayverdict.js`:

```js
/* OnStandard — day verdict timing (pure; no imports, no DOM, no Date). One job: decide whether a
   day is OVER for on-time purposes, so the UI never delivers a negative verdict ("Off Standard",
   a red "Missed") on a day the athlete can still win. A day is DECIDED when no required window is
   still open on time — every required item is done, past its close, or excused. Optional items and
   pre-activation ('not_required') windows never hold the day open. Empty day ⇒ vacuously decided. */

const STILL_OPEN = new Set(['locked', 'ready', 'due_soon']);

/** @param {{required?: boolean, state?: string}[]} items derived exec items
 *  @returns {boolean} true once no required window is still open on time */
export function dayDecided(items) {
  const list = Array.isArray(items) ? items : [];
  return !list.some((i) => i && i.required && STILL_OPEN.has(i.state));
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx jest src/core/dayVerdict.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add proto/redesign-2026-07/js/dayverdict.js src/core/dayVerdict.test.ts
git commit -m "feat(scoring): pure dayDecided helper — a day is decided when no required window is open"
```

---

### Task 3: Part B3 — decided-aware pill ladder in `exec.js`

While a day is live, a past-window required item reads amber "Late — still counts"; only once the day is decided does it become red "Missed". `deriveExec` returns `decided` so consumers (the hero) can read it without recomputing.

**Files:**
- Modify: `proto/redesign-2026-07/js/exec.js` — import `dayDecided`; after `const all = [...]` (~107) compute `decided` and re-treat past-window required items; add `decided` to the return object (~155).
- Modify: `src/core/exec.test.ts` — the existing overdue-color assertion (~21-26) now expects amber while live; add a decided-case assertion.

**Interfaces:**
- Consumes: `dayDecided` from `./dayverdict.js` (Task 2).
- Produces: `deriveExec(...)` return object gains `decided: boolean`. Past-window required items (`state === 'overdue'`) get `color: 'gold'` + `pill: 'Late'` while live, `color: 'red'` + `pill: 'Missed'` when decided. The internal `state` name stays `'overdue'` so NOW-ladder ordering and the denominator are unchanged.

- [ ] **Step 1: Write the failing tests** — in `src/core/exec.test.ts`, replace the existing `'colors follow the 4-state mapping'` test (~21-26) with the decided-aware version, and add a decided case:

```ts
  test('past-window required item is amber "Late" while the day is still live', () => {
    // 8:00 AM-ish: breakfast (due 9:30) already overdue, but lunch & dinner windows are still ahead
    const e = at(570 + 1, { lunch: { done: true, late: false } });
    const b = get(e, 'breakfast');
    expect(b.state).toBe('overdue');   // internal state name is unchanged (ordering/denominator)
    expect(b.color).toBe('gold');      // was 'red' — a savable day is not painted as failure
    expect(b.pill).toBe('Late');
    expect(e.decided).toBe(false);
    expect(get(e, 'lunch').color).toBe('green'); // done wins, unchanged
    expect(get(e, 'dinner').color).toBe('gray'); // still locked, unchanged
  });

  test('past-window required item is red "Missed" once the day is decided', () => {
    // Tuesday 11:00 PM: breakfast/lunch/dinner all closed, nothing done → the day is over
    const e = deriveExec({ nowMin: 23 * 60, dow: 2, status: FRESH });
    expect(e.decided).toBe(true);
    const b = get(e, 'breakfast');
    expect(b.state).toBe('overdue');
    expect(b.color).toBe('red');
    expect(b.pill).toBe('Missed');
  });
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx jest src/core/exec.test.ts -t "past-window required"`
Expected: FAIL — `color` is still `'red'` while live and `e.decided` is `undefined`.

- [ ] **Step 3: Wire `dayDecided` into `exec.js`.** Add the import at the top of `proto/redesign-2026-07/js/exec.js` (next to the other imports):

```js
import { dayDecided } from './dayverdict.js';
```

Immediately after `const all = [...items, ...assignedItems];` (~107), before the `byDue`/`overdue`/`met` lines, insert the decided computation and re-treatment:

```js
  // Verdict timing: a required window past its close is "Late" (amber, still savable) while the day
  // is live, and only becomes "Missed" (red) once the day is DECIDED — no required window still open.
  // The internal state stays 'overdue' so NOW ordering and the denominator are untouched; only the
  // display (color/pill) changes. Done/optional/not_required items are never re-treated.
  const decided = dayDecided(all);
  for (const i of all) {
    if (i.required && i.state === 'overdue') {
      i.color = decided ? 'red' : 'gold';
      i.pill = decided ? 'Missed' : 'Late';
    }
  }
```

Then add `decided` to the return object (~155):

```js
  return { items: all, now, next, later, doneItems, overdue, met, total, score, possible, celebration, plan, decided };
```

- [ ] **Step 4: Run to verify they pass**

Run: `npx jest src/core/exec.test.ts`
Expected: PASS — including the two new cases and the rest of the existing suite (the old red-while-live assertion was replaced).

- [ ] **Step 5: Commit**

```bash
git add proto/redesign-2026-07/js/exec.js src/core/exec.test.ts
git commit -m "feat(exec): decided-aware pill ladder — past-window required reads Late (amber) live, Missed (red) once the day is over"
```

> **Deferred (conscious):** the spec's pill table also relabels the open `ready` state "Open"→"Due". That is cosmetic only and would churn the NOW-card wording and its tests; the load-bearing change (no red on a still-winnable day) is the `overdue` re-treatment above. Leave `ready` as "Open" for now; the founder can request the "Due" relabel as a one-line follow-up.

---

### Task 4: Part B2 — `S.dayDecided` getter + the "In progress" hero

While a sub-passing day is still live, the hero holds a neutral "In progress" state (the climbing number, "N to go", no red, no "Off Standard"). A good tier, or a decided day, shows the real verdict.

**Files:**
- Modify: `proto/redesign-2026-07/js/state.js` — add `get dayDecided()` near the other exec-derived getters (~1980).
- Modify: `proto/redesign-2026-07/js/screens/home.js` — add `inProgressHero(e)`; gate the main-path `hero(e)` call (~461).
- Test: `src/core/firstDayActivationLive.test.ts` (append hero-selection cases; the harness already renders `home.render()`).

**Interfaces:**
- Consumes: `S.exec.decided` (Task 3), `S.tier` (state.js:1966; `.cls === 'r'` is the sub-60 "Off Standard" band), `scoreRing` (already imported in home.js).
- Produces: `S.dayDecided → boolean`; `inProgressHero(e) → string` (HTML). Home renders `inProgressHero` when `!S.notYetScored && !S.dayDecided && S.tier.cls === 'r'`, otherwise the existing `hero(e)`.

- [ ] **Step 1: Write the failing tests** — append to `src/core/firstDayActivationLive.test.ts`:

```ts
describe('in-progress framing — no failure verdict on a day that is not over', () => {
  test('established user, live sub-passing day → hero reads In progress, never Off Standard', () => {
    // Activated yesterday (fully active), Tuesday morning, nothing logged, windows still open.
    RT.activationDate = activatedYesterday;
    RT.profile = { createdAt: activatedYesterday };
    DAY.date = todayISO;
    // Force a mid-morning clock so required windows are still open (not decided).
    const home = require('../../proto/redesign-2026-07/js/screens/home.js').default;
    const html: string = home.render();
    if (!S.dayDecided) {
      expect(html).toContain('In progress');
      expect(html).not.toContain('Off Standard');
    }
  });

  test('S.dayDecided mirrors exec.decided', () => {
    expect(S.dayDecided).toBe(S.exec.decided);
  });
});
```

> Note: the render-time clock comes from `minutesNow()` inside `get exec`; if the suite happens to run when the local wall-clock is past every window, `S.dayDecided` is true and the guard `if (!S.dayDecided)` skips the copy assertion — the `S.dayDecided === S.exec.decided` case always runs and is the load-bearing check. The three browser-QA scenarios in Task 5 pin the visual states deterministically via seeded time.

- [ ] **Step 2: Run to verify they fail**

Run: `npx jest src/core/firstDayActivationLive.test.ts -t "in-progress framing"`
Expected: FAIL — `S.dayDecided` is undefined and the hero renders "Off Standard".

- [ ] **Step 3: Add the `S.dayDecided` getter** in `proto/redesign-2026-07/js/state.js`, next to `get notYetScored()` (~1980):

```js
  // A day is "decided" once no required window is still open on time — the point at which a
  // negative verdict (Off Standard / a red Missed pill) is honest. Derived from exec, no recompute.
  get dayDecided() { return this.exec.decided; },
```

- [ ] **Step 4: Add `inProgressHero(e)`** in `proto/redesign-2026-07/js/screens/home.js`, directly after the `hero(e)` function (after ~262). Model it on `hero(e)` but neutral — reuse the same ring, drop the tier pill / red / down-delta:

```js
/* The hero on a day that is still live but sub-passing: the score is climbing, not failing. Same
   signature ring, but the tier verdict is held — a neutral "In progress" chip + what's left to do,
   never "Off Standard", never a red down-delta. The real tier returns once the day is decided
   (home render gates this) or once a passing tier is earned. */
function inProgressHero(e) {
  const left = e.total - e.met;
  const toGo = left > 0 ? `${left} to go — your day is still open` : 'Log your first requirement to start your score';
  return `<section class="xhero" data-go="score-breakdown" role="button" aria-label="Daily Score ${e.score}, in progress. ${e.met} of ${e.total} completed. Open score breakdown">
    <div class="xh-main">
      ${scoreRing({ score: e.score, size: 102, stroke: 10, glow: false, showCenter: false, centerNum: true, uid: 'hero' })}
      <div class="xh-side">
        <div class="xrow"><span class="status-pill" style="background:var(--surface-2);color:var(--text-2)">In progress</span></div>
        <div class="xh-line">${esc(`${e.met} of ${e.total} done · ${toGo}`)}</div>
      </div>
    </div>
  </section>`;
}
```

> Confirm `esc` is imported in home.js; if not, add it to the existing `../components.js` import. Match the surrounding `.xhero` / `.xh-*` class usage already present in `hero(e)` so the layout is consistent.

- [ ] **Step 5: Gate the main-path hero** in `proto/redesign-2026-07/js/screens/home.js` (~461). Replace the bare `${hero(e)}` on that line (the DEFAULT render path, not the day0 branch at ~397) with:

```js
    ${(!S.dayDecided && S.tier.cls === 'r') ? inProgressHero(e) : hero(e)}
```

- [ ] **Step 6: Run to verify they pass**

Run: `npx jest src/core/firstDayActivationLive.test.ts`
Expected: PASS (all cases, existing + new).

- [ ] **Step 7: Commit**

```bash
git add proto/redesign-2026-07/js/state.js proto/redesign-2026-07/js/screens/home.js src/core/firstDayActivationLive.test.ts
git commit -m "feat(home): In-progress hero holds the Off-Standard verdict until a day is decided"
```

---

### Task 5: Verify, browser-QA the three scenarios, rebuild proto.zip

**Files:**
- Modify: `proto.zip` (rebuilt artifact) — via the existing build step.
- No source changes unless QA surfaces a fix.

- [ ] **Step 1: Full verify gate**

Run: `npm run verify`
Expected: xss lint clean, `tsc --noEmit` 0 errors, all jest suites pass (incl. `scoreParity` / `standardDay` — proving the math didn't move), expo bundle 0 errors.

- [ ] **Step 2: Serve the proto and browser-QA the three scenarios.** Serve `proto/redesign-2026-07` on a local port and drive it with Playwright (module-mutation seed per the proto-headless recipe: set `RT.profile.createdAt`, `RT.activationDate`, `DAY.date`, and seed `status`/clock). Confirm, screenshotting each:
  1. **Fresh account, created today** → hero "Not scored yet / Ready to begin"; pre-now windows read "Not required"; no red, no "Off Standard".
  2. **Day-two morning** (created yesterday, windows still open, nothing logged) → hero "In progress"; past-window items amber "Late — still counts"; upcoming items grey "Upcoming"; no red.
  3. **Day-two evening, genuine miss** (created yesterday, all windows closed, nothing logged) → honest tier (red "Off Standard") and red "Missed" pills — the verdict is allowed once the day is decided.

- [ ] **Step 3: Rebuild the proto artifact**

Run the repo's proto-zip build (per the proto-webview-audit-and-smoke recipe, e.g. `node scripts/build-proto-zip.mjs` or the documented `build-proto-zip` step).
Expected: fresh `proto.zip` with the new module graph.

- [ ] **Step 4: Commit**

```bash
git add proto.zip
git commit -m "chore(proto): rebuild proto.zip with first-day + in-progress scoring fixes"
```

---

## Notes for the implementer

- **Do not touch** `computeScore`, `WEIGHTS`, `componentsNow/componentsDone`, `mealImpact`, or any denominator. If a change seems to require it, stop — it violates D3 and the design.
- The internal exec `state` value stays `'overdue'` for a past-window required item; only its `color`/`pill` change. This keeps the NOW-ladder ordering (exec.js:124) and the denominator (exec.js:114) byte-identical.
- `parseActivation` and `todayISO` are already imported in `state.js` (lines 21 and 37) — no new imports needed for Task 1.
- If `esc` is not already imported in `home.js`, add it to the existing `../components.js` import line (Task 4, Step 4).
