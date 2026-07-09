# Onboarding Overhaul Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the forward-only athlete onboarding with an adaptive 7-step wizard (name/DOB with 13+ gate, school→coach discovery, adaptive Your Standard with hold-to-commit, hardened account step), and make coach/trainer onboarding real enough to supply the directory.

**Architecture:** All UI lives in the WebView proto (`proto/redesign-2026-07/`) — vanilla ES modules, hash router, template-string screens. Pre-account discovery goes through a new anon `org-directory` edge function; all writes (profile, join redemption, org/team creation) happen post-signup via existing SECURITY DEFINER RPCs (`join_team`, `join_practice`, `create_team`, `create_practice`). One new authored-only migration adds identity/consent columns.

**Tech Stack:** Vanilla JS ES modules (proto), Supabase JS v2 (in WebView), Deno edge functions, PostgreSQL migrations + psql RLS tests, Jest (jest-expo) importing proto ESM via `allowJs`, React Native bridge (`src/proto/bridge.ts`).

**Spec:** `docs/superpowers/specs/2026-07-09-onboarding-overhaul-design.md` (approved 2026-07-09).

## Global Constraints

- **Migrations are authored only** — never applied to any live database; founder applies at go-live (guardrail from 0004+, 0022, 0038).
- **The scoring formula is untouched** (DECISION-MEMO D3). The meals/day knob feeds requirement rows, never weights.
- **Never fabricate identity or data** — unknown fields render blank/neutral; no demo names, no fake matches. New code must keep this rule.
- Password minimum: **8 characters** (raised from 6). ToS version tag: **`2026-07-09`**. Hold-to-commit duration: **1200 ms**. Meals/day knob range: **2–4**. Join-code input accepts **`^[A-Z0-9]{4,12}$`** (legacy 4–5 char codes keep working per 0038).
- Under-13 → hard block screen; 13–17 proceed with no guardian dependency.
- Proto conventions: screens are `{ hideTabs?, render({sub}), mount(root)? }` registered in `js/screens/index.js`; navigation via `data-go`, actions via `data-act`/`data-then`; every user selection persists to `RT.ob` immediately via `act.captureOb(patch)` because the DOM is wiped between hash routes. Passwords are NEVER written to `RT.ob`/localStorage.
- Client-side writes to columns from the new migration must be **separate best-effort calls** so they fail cleanly against a database where 0048 is not yet applied (backend-live gap).
- Verify after each task: `npm run typecheck && npm run test` (fast); `npm run verify` (adds the bundle) at Task 14. Commit at the end of every task.
- Working directory for all commands: `c:\Users\Administrator\Downloads\athleteos`.

---

### Task 1: Pure onboarding helpers (`ob-helpers.js`)

**Files:**
- Create: `proto/redesign-2026-07/js/ob-helpers.js`
- Test: `src/core/obHelpers.test.ts`

**Interfaces:**
- Consumes: nothing (pure functions, no DOM, no state).
- Produces: `dobFromParts(mm, dd, yyyy) → 'YYYY-MM-DD' | null`, `ageOn(dobISO, todayISO) → number | null`, `passwordStrength(pw) → { ok: boolean, score: 0|1|2|3, label: string }`, `standardForGoal(goal, mealsPerDay?, profile?) → { meals, focus, rows: [icon, title, sub][] }`, `TOS_VERSION = '2026-07-09'`. Tasks 2, 5, 6, 10 import these.

- [ ] **Step 1: Write the failing test**

Create `src/core/obHelpers.test.ts`:

```ts
// Proto is plain ESM JS (allowJs) — same import pattern as scoreParity.test.ts.
// @ts-ignore
import { dobFromParts, ageOn, passwordStrength, standardForGoal, TOS_VERSION } from '../../proto/redesign-2026-07/js/ob-helpers.js';

describe('dobFromParts', () => {
  test('valid date, string inputs, zero-pads', () => expect(dobFromParts('7', '9', '2010')).toBe('2010-07-09'));
  test('rejects impossible calendar dates', () => expect(dobFromParts(2, 30, 2010)).toBeNull());
  test('rejects year below 1900', () => expect(dobFromParts(1, 1, 1899)).toBeNull());
  test('rejects non-numeric input', () => expect(dobFromParts('a', 'b', 'c')).toBeNull());
});

describe('ageOn — the 13th-birthday boundary', () => {
  test('turns 13 today → 13', () => expect(ageOn('2013-07-09', '2026-07-09')).toBe(13));
  test('turns 13 tomorrow → still 12', () => expect(ageOn('2013-07-10', '2026-07-09')).toBe(12));
  test('null dob → null', () => expect(ageOn(null, '2026-07-09')).toBeNull());
});

describe('passwordStrength', () => {
  test('7 chars fails the floor', () => expect(passwordStrength('abcdefg').ok).toBe(false));
  test('8 plain chars = ok, score 1 (Weak)', () =>
    expect(passwordStrength('abcdefgh')).toEqual({ ok: true, score: 1, label: 'Weak' }));
  test('8 chars with 3 character classes = score 2', () =>
    expect(passwordStrength('Abcdef1!').score).toBe(2));
  test('12+ chars with variety = score 3 (Strong)', () =>
    expect(passwordStrength('Abcdefgh1234!')).toEqual({ ok: true, score: 3, label: 'Strong' }));
  test('empty = score 0', () => expect(passwordStrength('').score).toBe(0));
});

describe('standardForGoal', () => {
  test('clamps meals to 2–4', () => {
    expect(standardForGoal('gain', 9).meals).toBe(4);
    expect(standardForGoal('gain', 1).meals).toBe(2);
    expect(standardForGoal('gain').meals).toBe(3);
  });
  test('meal count appears in the first row title', () =>
    expect(standardForGoal('gain', 4).rows[0][1]).toContain('Four meals'));
  test('every goal key has focus copy; unknown falls back', () => {
    for (const g of ['gain', 'lose', 'maintain', 'perform', 'build', 'health', 'nonsense']) {
      expect(standardForGoal(g).focus.length).toBeGreaterThan(10);
    }
  });
  test('general profile relabels the weights (55/20/15/10)', () => {
    const rows = standardForGoal('lose', 3, 'general').rows;
    expect(rows[0][2]).toContain('55%');
    expect(rows[1][2]).toContain('20%');
  });
  test('athlete profile keeps 50/25/15/10', () => {
    const rows = standardForGoal('gain').rows;
    expect(rows[0][2]).toContain('50%');
    expect(rows[1][2]).toContain('25%');
  });
});

describe('TOS_VERSION', () => {
  test('is the spec date tag', () => expect(TOS_VERSION).toBe('2026-07-09'));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/core/obHelpers.test.ts`
Expected: FAIL — cannot find module `../../proto/redesign-2026-07/js/ob-helpers.js`.

- [ ] **Step 3: Write the implementation**

Create `proto/redesign-2026-07/js/ob-helpers.js`:

```js
/* Pure onboarding helpers — no DOM, no state, no imports. Unit-tested from
   src/core/obHelpers.test.ts (same proto-ESM import pattern as scoreParity). */

export const TOS_VERSION = '2026-07-09';

/** Validate MM/DD/YYYY parts into 'YYYY-MM-DD', or null. Real calendar dates only. */
export function dobFromParts(mm, dd, yyyy) {
  const m = parseInt(mm, 10), d = parseInt(dd, 10), y = parseInt(yyyy, 10);
  if (!Number.isInteger(m) || !Number.isInteger(d) || !Number.isInteger(y)) return null;
  if (y < 1900 || y > 9999 || m < 1 || m > 12 || d < 1 || d > 31) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** Whole-year age on todayISO. Both args 'YYYY-MM-DD'. Null-safe. */
export function ageOn(dobISO, todayISO) {
  if (!dobISO || !todayISO) return null;
  const [y, m, d] = dobISO.split('-').map(Number);
  const [ty, tm, td] = todayISO.split('-').map(Number);
  let age = ty - y;
  if (tm < m || (tm === m && td < d)) age--;
  return age;
}

/** 3-band strength: floor is 8 chars; +1 for 3+ character classes; +1 for 12+ length. */
export function passwordStrength(pw) {
  const p = pw || '';
  if (p.length < 8) return { ok: false, score: 0, label: 'Too short' };
  let variety = 0;
  if (/[a-z]/.test(p)) variety++;
  if (/[A-Z]/.test(p)) variety++;
  if (/[0-9]/.test(p)) variety++;
  if (/[^A-Za-z0-9]/.test(p)) variety++;
  const score = 1 + (variety >= 3 ? 1 : 0) + (p.length >= 12 ? 1 : 0);
  return { ok: true, score, label: ['Too short', 'Weak', 'Good', 'Strong'][score] };
}

/* Goal → emphasis copy. Athlete goals (gain/lose/maintain/perform) + client goals
   (build/health). Unknown goals fall back to maintain — never a blank standard. */
const GOAL_EMPHASIS = {
  gain:     'Protein first — every meal moves the calorie floor.',
  lose:     'Hydration and honest portions carry this. Keep protein high.',
  maintain: 'Consistency over everything. Same standard, every day.',
  perform:  'Fuel training, then recover hard — the check-ins are where you win.',
  build:    'Protein first — never under-fueled, every meal counts.',
  health:   'Small meals logged honestly. Consistency is the whole game.',
};
const MEAL_WORD = { 2: 'Two', 3: 'Three', 4: 'Four' };

/** The solo standard for a goal: requirement rows + focus line. `profile` relabels the
    component weights ('athlete' 50/25/15/10 · 'general' 55/20/15/10) — labels only; the
    scoring engine itself is untouched (DECISION-MEMO D3). */
export function standardForGoal(goal, mealsPerDay, profile = 'athlete') {
  const meals = Math.min(4, Math.max(2, Math.round(mealsPerDay || 3)));
  const W = profile === 'general'
    ? { n: 55, r: 20, c: 15, w: 10 }
    : { n: 50, r: 25, c: 15, w: 10 };
  return {
    meals,
    focus: GOAL_EMPHASIS[goal] || GOAL_EMPHASIS.maintain,
    rows: [
      ['utensils', `${MEAL_WORD[meals]} meals, photo proof`, `Nutrition · ${W.n}% of your score`],
      ['moon', 'Recovery check-in before bed', `Recovery · ${W.r}%`],
      ['check', 'One honest commitment tap', `Commitment · ${W.c}%`],
      ['clipboard', 'Weekly check-in on Sundays', `Check-in · ${W.w}%`],
      ['scale', 'Weight Mon / Wed / Fri', 'Season trend · not scored'],
    ],
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/core/obHelpers.test.ts`
Expected: PASS (all suites).

- [ ] **Step 5: Run the full check and commit**

Run: `npm run typecheck && npm run test`
Expected: clean.

```bash
git add proto/redesign-2026-07/js/ob-helpers.js src/core/obHelpers.test.ts
git commit -m "feat(onboarding): pure helpers — DOB validation, age gate, password strength, solo standard"
```

---

### Task 2: Wizard shell — 7 steps, back navigation, progress bar, name/DOB step, under-13 block

**Files:**
- Modify: `proto/redesign-2026-07/js/screens/onboarding.js` (full-file rework of the step table)
- Modify: `proto/redesign-2026-07/css/screens.css` (append nav/progress/DOB styles)

**Interfaces:**
- Consumes: `dobFromParts`, `ageOn` from `../ob-helpers.js` (Task 1); existing `act.captureOb`, `wireToggles`.
- Produces: 7-step route space `#onboarding/1..7` + `#onboarding/blocked`; `RT.ob` keys `firstName`, `lastName`, `name`, `dob`, plus the existing `sport/position/level/goal/currentWeight/targetWeight/allergies/pressure`. `frame(n, title, sub, body, cta, next, opts)` where opts supports `{ green, act, skip, back, disabled }`. Tasks 4, 5, 6 replace the bodies of steps 2, 6, 7 inside this same file.

- [ ] **Step 1: Append the CSS**

Append to `proto/redesign-2026-07/css/screens.css`:

```css
/* ---- onboarding v2: back nav + segmented progress (replaces dots) ---- */
.ob-nav{display:flex;align-items:center;gap:12px;padding:2px 0 16px}
.ob-back{width:34px;height:34px;min-width:34px;border-radius:12px;background:var(--surface-2);display:flex;align-items:center;justify-content:center;cursor:pointer;color:var(--text-2)}
.ob-back svg{transform:rotate(180deg)}
.ob-prog{flex:1;display:flex;gap:5px}
.ob-prog i{flex:1;height:4px;border-radius:2px;background:var(--surface-2)}
.ob-prog i.on{background:var(--green-bright)}
.dob-row{display:flex;gap:10px}
.dob-row .ob-input{text-align:center}
/* hold-to-commit (used by Task 5) */
.hold-btn{position:relative;overflow:hidden}
.hold-fill{position:absolute;inset:0;width:0;background:rgba(255,255,255,0.22);pointer-events:none}
.hold-label{position:relative}
/* password meter (used by Task 6) */
.pw-meter{display:flex;gap:5px;margin:10px 2px 4px}
.pw-meter i{flex:1;height:4px;border-radius:2px;background:var(--surface-2)}
.pw-meter i.on{background:var(--amber-bright)}
.pw-meter i.on.s3{background:var(--green-bright)}
.pw-row{position:relative}
.pw-row .pw-eye{position:absolute;right:14px;top:50%;transform:translateY(-50%);font-size:12px;font-weight:800;color:var(--text-3);cursor:pointer}
.lnk{color:var(--green-bright);font-weight:800;cursor:pointer}
```

- [ ] **Step 2: Rework the step table in `onboarding.js`**

Replace the header block (lines 1–27: imports, `STEPS`, `dots`, `frame`) with:

```js
import { S, RT, act } from '../state.js';
import { icon } from '../icons.js';
import { dobFromParts, ageOn } from '../ob-helpers.js';

/* 7-step onboarding: identity → belonging → sport → goal → baseline → the contract → account.
   Back arrow + segmented progress on every step. Every selection is captured into RT.ob as
   they go (DOM is wiped between routes) and written to the account on step 7. */

const STEPS = 7;
function progress(n) {
  return `<div class="ob-prog" role="progressbar" aria-label="Step ${n} of ${STEPS}" aria-valuenow="${n}" aria-valuemax="${STEPS}">${
    Array.from({ length: STEPS }, (_, i) => `<i class="${i + 1 <= n ? 'on' : ''}"></i>`).join('')}</div>`;
}
function frame(n, title, sub, body, cta, next, opts = {}) {
  const back = opts.back || (n === 1 ? 'role' : `onboarding/${n - 1}`);
  return `
  <div class="ob">
    <div class="ob-nav"><div class="ob-back" data-go="${back}" aria-label="Back">${icon('chevron', 18)}</div>${progress(n)}</div>
    <div class="ob-title">${title}</div>
    <div class="ob-sub">${sub}</div>
    <div class="ob-body">${body}</div>
    <div class="ob-foot">
      ${cta ? `<button class="btn ${opts.green ? 'green' : 'primary'}" ${opts.disabled ? 'disabled' : ''} ${opts.act ? `data-act="${opts.act}"` : ''} data-${opts.act ? 'then' : 'go'}="${next}">${cta}</button>` : ''}
      ${opts.skip ? `<div style="text-align:center;padding-top:14px;font-size:14px;font-weight:700;color:var(--text-3);cursor:pointer" data-go="${opts.skip}">Skip for now</div>` : ''}
    </div>
  </div>`;
}
const numInput = 'width:100%;background:transparent;border:none;outline:none;text-align:center;font-size:34px;font-weight:800;color:inherit;font-family:inherit;padding:0';
```

- [ ] **Step 3: Renumber the steps and add step 1 + blocked**

In the `steps` object:
- **New step 1** (replaces the old name+sport step):

```js
  1: () => frame(1, 'Who are you?', 'Your coach sees this next to every log.', `
    <input id="ob-first" class="ob-input" placeholder="First name" autocapitalize="words" autocorrect="off" spellcheck="false" />
    <div style="height:12px"></div>
    <input id="ob-last" class="ob-input" placeholder="Last name" autocapitalize="words" autocorrect="off" spellcheck="false" />
    <div style="height:16px"></div>
    <div class="eyebrow" style="margin:8px 2px 10px">Date of birth</div>
    <div class="dob-row">
      <input id="ob-dob-m" class="ob-input" type="number" inputmode="numeric" placeholder="MM" />
      <input id="ob-dob-d" class="ob-input" type="number" inputmode="numeric" placeholder="DD" />
      <input id="ob-dob-y" class="ob-input" type="number" inputmode="numeric" placeholder="YYYY" style="flex:1.4" />
    </div>
    <div id="ob-age-err" style="color:var(--amber-bright);font-size:13px;font-weight:700;min-height:18px;margin-top:10px"></div>
    <div style="font-size:12px;font-weight:600;color:var(--text-3);margin-top:6px;line-height:1.5">You must be 13 or older to use OnStandard.</div>`,
    'Next', 'onboarding/2'),

  blocked: () => `
  <div class="ob">
    <div class="ob-nav"><div class="ob-back" data-go="onboarding/1" aria-label="Back">${icon('chevron', 18)}</div></div>
    <div class="standard-set" style="padding-bottom:6px">
      <div class="halo"><div class="core" style="background:var(--surface-2);color:var(--text-2)">${icon('lock', 32)}</div></div>
      <div class="ob-title" style="margin-top:18px">Not yet — but soon.</div>
      <div class="ob-sub" style="padding:0 8px">OnStandard is for athletes 13 and older — that's the law for apps like this, and we take it seriously. Come back on your 13th birthday. The Standard will be waiting.</div>
    </div>
    <div class="ob-foot" style="margin-top:auto">
      <button class="btn ghost" data-go="welcome">Back to start</button>
    </div>
  </div>`,
```

- **Step 2 (interim)**: move the old step-4 coach-code body here verbatim, with `frame(2, 'Connect your coach', …, 'Continue', 'onboarding/3', { skip: 'onboarding/3' })`. (Task 4 replaces this body with school discovery.)
- **Step 3**: the old step-1 sport/position/level chips (name input removed), title `'Your sport'`, sub `'Position and level shape your plan.'`, next `onboarding/4`.
- **Step 4**: the old step 2 (goal), renumbered — `frame(4, …, 'Next', 'onboarding/5')`.
- **Step 5**: the old step 3 (weights + allergies), renumbered — `frame(5, …, 'Next', 'onboarding/6')`.
- **Step 6 (interim)**: the old step-5 Your Standard body with `frame(6, …, 'Set My Standard', 'onboarding/7')`. (Task 5 replaces it.)
- **Step 7**: the old step-6 account body, with `dots(6)` removed and this nav header added inside the top of its `.ob` div: `<div class="ob-nav"><div class="ob-back" data-go="onboarding/6" aria-label="Back">${icon('chevron', 18)}</div>${progress(7)}</div>`. (Task 6 replaces the body.)

Update the module export's render clamp:

```js
  render({ sub }) {
    if (sub === 'blocked') return steps.blocked();
    const n = Math.min(STEPS, Math.max(1, +(sub || 1)));
    return steps[n]();
  },
```

- [ ] **Step 4: Rewire `mount()`**

In `mount(root)`: keep `wireToggles`, `wireGroup`, and the multi-select wiring unchanged. Replace the old `#ob-name` block with:

```js
    // ---- Step 1: first + last name REQUIRED, DOB validated, under-13 → block screen ----
    const first = grab('#ob-first');
    if (first) {
      const last = grab('#ob-last'), dm = grab('#ob-dob-m'), dd = grab('#ob-dob-d'), dy = grab('#ob-dob-y');
      const errEl = grab('#ob-age-err');
      const nextBtn = root.querySelector('.ob-foot .btn');
      // restore captured values so Back never loses work
      const ob = RT.ob || {};
      if (ob.firstName) first.value = ob.firstName;
      if (ob.lastName) last.value = ob.lastName;
      if (ob.dob) { const [y, m, d] = ob.dob.split('-'); dm.value = +m; dd.value = +d; dy.value = y; }
      const todayISO = () => {
        const t = new Date();
        return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
      };
      const sync = () => {
        const f = first.value.trim(), l = last.value.trim();
        const dob = dobFromParts(dm.value, dd.value, dy.value);
        cap({ firstName: f, lastName: l, name: `${f} ${l}`.trim(), dob });
        const under13 = dob != null && ageOn(dob, todayISO()) < 13;
        if (under13) {
          errEl.textContent = 'OnStandard is for ages 13 and up.';
          nextBtn.setAttribute('data-go', 'onboarding/blocked');
          nextBtn.disabled = false;
        } else {
          errEl.textContent = '';
          nextBtn.setAttribute('data-go', 'onboarding/2');
          nextBtn.disabled = !(f && l && dob);
        }
      };
      [first, last, dm, dd, dy].forEach(el => el.addEventListener('input', sync));
      dm.addEventListener('input', () => { if (dm.value.length >= 2) dd.focus(); });
      dd.addEventListener('input', () => { if (dd.value.length >= 2) dy.focus(); });
      sync();
    }
```

Keep the step-2 code capture (`#ob-code` → `cap({ coachCode: … })`), the goal/weights/allergies/pressure wiring, and the step-7 signup block exactly as they are (they now live under new step numbers; Task 6 rewrites the signup block). Also restore captured values on the renumbered steps where inputs exist (weights): after the `#ob-cur`/`#ob-tgt` wiring add `if (RT.ob && RT.ob.currentWeight) cur.value = RT.ob.currentWeight; if (RT.ob && RT.ob.targetWeight) tgt.value = RT.ob.targetWeight;`.

- [ ] **Step 5: Verify and commit**

Run: `npm run typecheck && npm run test`
Expected: clean (proto JS is not typechecked; parity/unit tests still pass).
Manual QA (optional, browser): open `proto/redesign-2026-07/index.html`, walk `#onboarding/1` → type DOB `2015-01-01` → Next label routes to blocked screen; back arrows preserve entered values.

```bash
git add proto/redesign-2026-07/js/screens/onboarding.js proto/redesign-2026-07/css/screens.css
git commit -m "feat(onboarding): 7-step wizard — back nav, segmented progress, first/last+DOB, under-13 block"
```

---

### Task 3: `org-directory` edge function (anon search + code preview)

**Files:**
- Create: `supabase/functions/org-directory/index.ts`

**Interfaces:**
- Consumes: existing tables `orgs`, `teams`, `practices`, `profiles`; existing RPCs `discover_teams(org)`, `resolve_team_code(code)`, `resolve_practice_code(code)` (all SECURITY DEFINER, callable by the service role).
- Produces (POST JSON, invoked via `sb.functions.invoke('org-directory', { body })` — the anon key satisfies the platform JWT check):
  - `{op:'search', q}` → `{ orgs: [{id,name,type,city,state,teams:number}] }`
  - `{op:'teams', org}` → `{ teams: [{id,name,sport,coach_name}] }`
  - `{op:'practices', q}` → `{ practices: [{id,name,handle,trainer_name}] }`
  - `{op:'preview_code', code}` → `{ match: {kind:'team',id,name,sport,coach_name,school} | {kind:'practice',id,name,trainer_name} | null }`
  - Errors: `{error:'rate_limited'|'bad_request'}` with 429/400. **Never** returns `created_by` or any `join_code`.

- [ ] **Step 1: Write the function**

Create `supabase/functions/org-directory/index.ts`:

```ts
// OnStandard — anonymous directory for pre-account onboarding (spec 2026-07-09 §4).
// The athlete has no session at step 2, and search_orgs/find_org/discover_teams require
// auth.uid() — so this function fronts the SAME safe display columns with the service role,
// guarded by a per-IP rate limit. It never returns created_by or a join_code: knowing a code
// is the only capability, and preview only confirms a code the caller already has.
import { createClient } from "npm:@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

// Per-isolate sliding window: 30 requests/min/IP. Best-effort (isolates recycle) — the goal is
// stopping scripted enumeration, not perfect accounting. Same spirit as claim_ai_usage_key.
const hits = new Map<string, { n: number; t: number }>();
function limited(ip: string, max = 30, windowMs = 60_000): boolean {
  const now = Date.now();
  const h = hits.get(ip);
  if (!h || now - h.t > windowMs) { hits.set(ip, { n: 1, t: now }); return false; }
  h.n++;
  return h.n > max;
}
// strip characters that would let user input escape a PostgREST or() filter
const clean = (s: unknown) => String(s ?? "").replace(/[,()]/g, " ").trim();

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "bad_request" }, 400);
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  if (limited(ip)) return json({ error: "rate_limited" }, 429);

  const body = await req.json().catch(() => null);
  if (!body || typeof body.op !== "string") return json({ error: "bad_request" }, 400);
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  if (body.op === "search") {
    const q = clean(body.q);
    if (q.length < 2) return json({ orgs: [] });
    const { data: orgs, error } = await sb.from("orgs")
      .select("id,name,type,city,state").ilike("name", `%${q}%`).order("name").limit(20);
    if (error) return json({ error: "bad_request" }, 400);
    const ids = (orgs ?? []).map((o) => o.id);
    const counts: Record<string, number> = {};
    if (ids.length) {
      const { data: teams } = await sb.from("teams")
        .select("org_id").in("org_id", ids).eq("discoverable", true);
      for (const t of teams ?? []) counts[t.org_id] = (counts[t.org_id] || 0) + 1;
    }
    return json({ orgs: (orgs ?? []).map((o) => ({ ...o, teams: counts[o.id] || 0 })) });
  }

  if (body.op === "teams") {
    if (typeof body.org !== "string" || !body.org) return json({ error: "bad_request" }, 400);
    const { data, error } = await sb.rpc("discover_teams", { org: body.org });
    if (error) return json({ error: "bad_request" }, 400);
    return json({ teams: data ?? [] });
  }

  if (body.op === "practices") {
    const q = clean(body.q);
    if (q.length < 2) return json({ practices: [] });
    const { data: rows, error } = await sb.from("practices")
      .select("id,name,handle,owner_id").eq("discoverable", true)
      .or(`name.ilike.%${q}%,handle.ilike.%${q}%`).limit(20);
    if (error) return json({ error: "bad_request" }, 400);
    const owners = [...new Set((rows ?? []).map((r) => r.owner_id))];
    const names: Record<string, string> = {};
    if (owners.length) {
      const { data: profs } = await sb.from("profiles").select("id,full_name").in("id", owners);
      for (const p of profs ?? []) names[p.id] = p.full_name;
    }
    return json({
      practices: (rows ?? []).map((r) => ({
        id: r.id, name: r.name, handle: r.handle, trainer_name: names[r.owner_id] || null,
      })),
    });
  }

  if (body.op === "preview_code") {
    const code = String(body.code ?? "").trim().toUpperCase();
    if (!/^[A-Z0-9]{4,12}$/.test(code)) return json({ match: null });
    const { data: team } = await sb.rpc("resolve_team_code", { code });
    if (team && team.length) {
      const t = team[0];
      return json({ match: { kind: "team", id: t.id, name: t.name, sport: t.sport, coach_name: t.coach_name, school: t.school } });
    }
    const { data: prac } = await sb.rpc("resolve_practice_code", { code });
    if (prac && prac.length) {
      const p = prac[0];
      return json({ match: { kind: "practice", id: p.id, name: p.name, trainer_name: p.trainer_name } });
    }
    return json({ match: null });
  }

  return json({ error: "bad_request" }, 400);
});
```

- [ ] **Step 2: Static verification**

There is no Deno toolchain wired into `npm run verify`; verification is: (a) re-read the function against the Interfaces block above, confirming no branch selects `created_by` or `join_code`; (b) if the Supabase CLI is available, smoke it locally:

Run: `supabase functions serve org-directory` then
`curl -s -X POST http://127.0.0.1:54321/functions/v1/org-directory -H "Content-Type: application/json" -d "{\"op\":\"search\",\"q\":\"east\"}"`
Expected: `{"orgs":[…Eastside High School…]}` against a DB with the 0022 seed. If the CLI or local DB is unavailable, note that in the commit body and move on — the function deploys at go-live with the other functions.

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/org-directory/index.ts
git commit -m "feat(backend): org-directory edge function — anon school/team/practice search + code preview, rate-limited"
```

---

### Task 4: Directory client + athlete school step (step 2)

**Files:**
- Create: `proto/redesign-2026-07/js/ob-directory.js`
- Modify: `proto/redesign-2026-07/js/screens/onboarding.js` (replace interim step 2 body + add mount wiring)

**Interfaces:**
- Consumes: `org-directory` function (Task 3) via `window.sb.functions.invoke`; `frame()` (Task 2); `act.captureOb`.
- Produces: `dir.search(q)`, `dir.teams(org)`, `dir.practices(q)`, `dir.previewCode(code)`, `debounce(fn, ms)` from `ob-directory.js` (Tasks 8, 10 reuse). Sets `RT.ob.join = { kind:'team', code, teamId, teamName, coachName, school } | null` and removes the legacy `RT.ob.coachCode`. Step 6 (Task 5) and `persistOnboarding` (Task 6) read `RT.ob.join`.

- [ ] **Step 1: Write the directory client**

Create `proto/redesign-2026-07/js/ob-directory.js`:

```js
/* Anonymous directory client for pre-account onboarding. All calls go through the
   org-directory edge function (the signed-out anon key can't call the authed RPCs).
   Every call can throw — callers degrade to code-entry / skip, never a dead end. */
async function invoke(body) {
  const sb = window.sb;
  if (!sb) throw new Error('offline');
  const { data, error } = await sb.functions.invoke('org-directory', { body });
  if (error || !data || data.error) throw new Error((data && data.error) || 'directory unavailable');
  return data;
}
export const dir = {
  search: (q) => invoke({ op: 'search', q }),
  teams: (org) => invoke({ op: 'teams', org }),
  practices: (q) => invoke({ op: 'practices', q }),
  previewCode: (code) => invoke({ op: 'preview_code', code }),
};
export function debounce(fn, ms = 300) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}
export const CODE_RE = /^[A-Z0-9]{4,12}$/;
```

- [ ] **Step 2: Replace step 2 in `onboarding.js`**

```js
  2: () => {
    const j = (RT.ob || {}).join;
    if (j) return frame(2, 'Coach connected', 'Your logs will count toward their board from day one.', `
      <section class="card team-preview">
        <div class="tp-av" style="background:linear-gradient(150deg,var(--green-bright),#0d9459);color:#04150c">${(j.coachName || j.teamName || '?')[0]}</div>
        <div style="flex:1">
          <div style="font-size:16px;font-weight:800">${j.coachName || j.teamName}</div>
          <div style="font-size:13px;font-weight:600;color:var(--text-2);margin-top:2px">${j.teamName || ''}${j.school ? ' · ' + j.school : ''}</div>
        </div>
        <span class="status-pill g">Connected</span>
      </section>
      <div style="height:12px"></div>
      <div style="text-align:center;font-size:13px;font-weight:700;color:var(--text-3);cursor:pointer" data-act="clearJoin">Remove connection</div>`,
      'Continue', 'onboarding/3');
    return frame(2, 'Your school', 'Find your school, then your coach. Their code is the handshake.', `
      <input id="sc-q" class="ob-input" placeholder="Search your school" autocorrect="off" spellcheck="false" />
      <div id="sc-out" style="margin-top:14px"></div>
      <div style="height:10px"></div>
      <div id="sc-alt" style="text-align:center;font-size:14px;font-weight:700;color:var(--green-bright);cursor:pointer">I have a coach code</div>`,
      'Continue', 'onboarding/3', { skip: 'onboarding/3' });
  },
```

Add a tiny action in `state.js` `act` (one line, next to `captureOb`):

```js
  clearJoin() { if (RT.ob) { delete RT.ob.join; save(); } },
```

- [ ] **Step 3: Add the step-2 mount wiring**

In `onboarding.js` `mount(root)`, replace the old `#ob-code` block with:

```js
    // ---- Step 2: school → coach → code (validated preview; real join happens post-signup) ----
    const scQ = grab('#sc-q');
    if (scQ) {
      const { dir, debounce, CODE_RE } = await import('../ob-directory.js');
      const out = grab('#sc-out'), alt = grab('#sc-alt');
      const esc = (s) => String(s == null ? '' : s).replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));
      const codeEntry = (ctx) => {
        out.innerHTML = `
          ${ctx ? `<div class="sidebox" style="margin-bottom:12px"><div class="req-icon b" style="width:38px;height:38px">${icon('users', 17)}</div>
            <div><div class="tt">${esc(ctx.title)}</div><div class="ts">${esc(ctx.sub)}</div></div></div>` : ''}
          <input id="sc-code" class="ob-input" placeholder="Coach code" autocapitalize="characters" autocorrect="off" spellcheck="false" maxlength="12" />
          <div id="sc-code-err" style="color:var(--amber-bright);font-size:13px;font-weight:700;min-height:18px;margin-top:10px"></div>`;
        const codeEl = out.querySelector('#sc-code'), codeErr = out.querySelector('#sc-code-err');
        codeEl.addEventListener('input', debounce(async () => {
          const code = codeEl.value.trim().toUpperCase();
          codeErr.textContent = '';
          if (!CODE_RE.test(code)) return;
          try {
            const { match } = await dir.previewCode(code);
            if (!match) { codeErr.textContent = "That code didn't match. Check with your coach."; return; }
            cap({ join: match.kind === 'team'
              ? { kind: 'team', code, teamId: match.id, teamName: match.name, coachName: match.coach_name, school: match.school }
              : { kind: 'practice', code, practiceId: match.id, practiceName: match.name, trainerName: match.trainer_name } });
            window.__render();
          } catch { codeErr.textContent = 'Could not check that code — you can also skip and connect later.'; }
        }, 350));
        codeEl.focus();
      };
      const showTeams = async (org) => {
        out.innerHTML = `<div class="micro" style="color:var(--text-3);font-weight:700;padding:6px 2px">Loading coaches…</div>`;
        try {
          const { teams } = await dir.teams(org.id);
          if (!teams.length) { codeEntry({ title: `${org.name}`, sub: 'No coaches listed here yet. Have a code? Enter it below.' }); return; }
          out.innerHTML = `<section class="card" style="padding:6px 16px">${teams.map((t, i) => `
            <div class="lrow" data-team="${i}">
              <div class="lic">${icon('users', 17)}</div>
              <div class="lm"><div class="lt">${esc(t.coach_name || t.name)}</div><div class="ls">${esc(t.name)}${t.sport ? ' · ' + esc(t.sport) : ''}</div></div>
              ${icon('chevron', 17, 'style="color:var(--text-3)"')}
            </div>`).join('')}</section>`;
          out.querySelectorAll('[data-team]').forEach((el) => el.addEventListener('click', () => {
            const t = teams[+el.getAttribute('data-team')];
            codeEntry({ title: `Ask ${t.coach_name || 'your coach'} for the team code`, sub: `${t.name} · the code is the handshake — only your coach hands it out.` });
          }));
        } catch { codeEntry({ title: 'Directory unavailable', sub: 'Enter your coach code directly, or skip and connect later.' }); }
      };
      scQ.addEventListener('input', debounce(async () => {
        const q = scQ.value.trim();
        if (q.length < 2) { out.innerHTML = ''; return; }
        out.innerHTML = `<div class="micro" style="color:var(--text-3);font-weight:700;padding:6px 2px">Searching…</div>`;
        try {
          const { orgs } = await dir.search(q);
          if (!orgs.length) {
            out.innerHTML = `<div class="sidebox"><div class="req-icon b" style="width:38px;height:38px">${icon('users', 17)}</div>
              <div><div class="tt">Not listed yet</div><div class="ts">No school by that name is on OnStandard yet. Enter your coach's code below, or skip — you can connect anytime from Profile.</div></div></div>`;
            return;
          }
          out.innerHTML = `<section class="card" style="padding:6px 16px">${orgs.map((o, i) => `
            <div class="lrow" data-org="${i}">
              <div class="lic">${icon('shield', 17)}</div>
              <div class="lm"><div class="lt">${esc(o.name)}</div><div class="ls">${esc([o.city, o.state].filter(Boolean).join(', ') || '—')}${o.teams ? ` · ${o.teams} coach${o.teams > 1 ? 'es' : ''}` : ''}</div></div>
              ${icon('chevron', 17, 'style="color:var(--text-3)"')}
            </div>`).join('')}</section>`;
          out.querySelectorAll('[data-org]').forEach((el) => el.addEventListener('click', () => showTeams(orgs[+el.getAttribute('data-org')])));
        } catch {
          out.innerHTML = `<div class="sidebox"><div class="req-icon b" style="width:38px;height:38px">${icon('users', 17)}</div>
            <div><div class="tt">Can't reach the directory</div><div class="ts">Check your connection, enter a coach code directly, or skip for now.</div></div></div>`;
        }
      }, 300));
      alt.addEventListener('click', () => codeEntry(null));
    }
```

Note: `mount` is already `async`, and the `data-act="clearJoin"` row re-renders via the router's default `render()` after the action.

- [ ] **Step 4: Verify and commit**

Run: `npm run typecheck && npm run test`
Expected: clean.

```bash
git add proto/redesign-2026-07/js/ob-directory.js proto/redesign-2026-07/js/screens/onboarding.js proto/redesign-2026-07/js/state.js
git commit -m "feat(onboarding): school→coach discovery step — anon directory search, code preview, connected state"
```

---

### Task 5: Commit widget + adaptive Your Standard (step 6)

**Files:**
- Create: `proto/redesign-2026-07/js/ob-commit.js`
- Modify: `proto/redesign-2026-07/js/screens/onboarding.js` (replace interim step 6 + mount wiring)

**Interfaces:**
- Consumes: `standardForGoal` (Task 1), `RT.ob.join` (Task 4), `frame()` with `{disabled}` (Task 2), CSS `.hold-btn/.hold-fill` (Task 2).
- Produces: `commitButton(committed) → html`, `wireCommit(root, onDone)` from `ob-commit.js` (Task 10 reuses). Sets `RT.ob.committedAt` (ISO string) and `RT.ob.standard = { mealsPerDay, pressure }`. `persistOnboarding` (Task 6) reads both.

- [ ] **Step 1: Write the commit widget**

Create `proto/redesign-2026-07/js/ob-commit.js`:

```js
/* Hold-to-commit — the signing-the-contract moment. 1200ms press-and-hold with a fill
   sweep and haptic; reduced-motion users get a plain tap (same meaning, no theater). */
import { icon } from './icons.js';

export function commitButton(committed) {
  if (committed) return `<button class="btn green" id="ob-commit" disabled>${icon('check', 18)}&nbsp; Standard committed</button>`;
  return `<button class="btn primary hold-btn" id="ob-commit"><span class="hold-fill"></span><span class="hold-label">Hold to commit</span></button>`;
}

export function wireCommit(root, onDone) {
  const btn = root.querySelector('#ob-commit');
  if (!btn || btn.disabled) return;
  const fill = btn.querySelector('.hold-fill');
  const HOLD_MS = 1200;
  const reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let timer = null;
  const done = () => {
    timer = null;
    try { navigator.vibrate && navigator.vibrate(30); } catch { /* no-op */ }
    onDone();
  };
  if (reduced) {
    btn.querySelector('.hold-label').textContent = 'Tap to commit';
    btn.addEventListener('click', done);
    return;
  }
  const start = (e) => {
    e.preventDefault();
    fill.style.transition = `width ${HOLD_MS}ms linear`;
    fill.style.width = '100%';
    try { navigator.vibrate && navigator.vibrate(10); } catch { /* no-op */ }
    timer = setTimeout(done, HOLD_MS);
  };
  const cancel = () => {
    if (timer == null) return;
    clearTimeout(timer); timer = null;
    fill.style.transition = 'width 160ms ease';
    fill.style.width = '0%';
  };
  btn.addEventListener('pointerdown', start);
  ['pointerup', 'pointerleave', 'pointercancel'].forEach((ev) => btn.addEventListener(ev, cancel));
}
```

- [ ] **Step 2: Replace step 6 in `onboarding.js`**

Add imports at the top of the file: `import { standardForGoal } from '../ob-helpers.js';` and `import { commitButton, wireCommit } from '../ob-commit.js';`

```js
  6: () => {
    const ob = RT.ob || {};
    const join = ob.join && ob.join.kind === 'team' ? ob.join : null;
    const std = standardForGoal(ob.goal, ob.standard && ob.standard.mealsPerDay);
    const committed = !!ob.committedAt;
    const coachLast = join && join.coachName ? join.coachName.trim().split(/\s+/).slice(-1)[0] : null;
    const title = join ? `Coach ${coachLast || ''}’s Standard`.replace(/\s+’/, '’') : 'Your Standard';
    const sub = join
      ? `The deal on ${join.teamName || 'the team'}. Your score is built on it — hold to commit.`
      : 'Built from your goal. When you connect a coach, their standard takes over.';
    const rows = std.rows.map(([ic, t, s]) => `
        <div class="lrow" style="cursor:default">
          <div class="lic" style="background:var(--surface-2)">${icon(ic, 17)}</div>
          <div class="lm"><div class="lt">${t}</div><div class="ls">${s}</div></div>
        </div>`).join('');
    const knobs = join ? '' : `
      <div class="eyebrow" style="margin:14px 2px 10px">Meals per day</div>
      <div class="chip-row" id="ob-meals">${[2, 3, 4].map((m) => `<span class="chp ${m === std.meals ? 'on' : ''}">${m}</span>`).join('')}</div>`;
    return frame(6, title, sub, `
      <section class="card" style="padding:6px 16px">${rows}</section>
      <div style="height:10px"></div>
      <div class="sidebox">
        <div class="req-icon b" style="width:38px;height:38px">${icon('bolt', 17)}</div>
        <div><div class="tt">Your edge</div><div class="ts">${std.focus}</div></div>
      </div>
      ${knobs}
      <div class="eyebrow" style="margin:14px 2px 10px">Reminder pressure</div>
      <div class="chip-row" id="ob-pressure" style="justify-content:center">
        <span class="chp ${ob.pressure === 'Remind me gently' ? 'on' : ''}">Remind me gently</span><span class="chp ${!ob.pressure || ob.pressure === 'Hold me accountable' ? 'on' : ''}">Hold me accountable</span><span class="chp ${ob.pressure === 'Max pressure' ? 'on' : ''}">Max pressure</span>
      </div>
      <div style="height:16px"></div>
      ${commitButton(committed)}`,
      'Next', 'onboarding/7', { disabled: !committed });
  },
```

- [ ] **Step 3: Wire step 6 in `mount()`**

Keep the existing `wireGroup('#ob-pressure', 'pressure')`. Add after it:

```js
    // ---- Step 6: meals/day knob re-renders the rows; hold-to-commit stamps the contract ----
    const mealsRow = grab('#ob-meals');
    if (mealsRow) mealsRow.addEventListener('click', (e) => {
      const chp = e.target.closest('.chp'); if (!chp) return;
      cap({ standard: { ...((RT.ob || {}).standard || {}), mealsPerDay: +chp.textContent.trim() } });
      window.__render();
    });
    if (grab('#ob-commit')) wireCommit(root, () => {
      const ob = RT.ob || {};
      cap({
        committedAt: new Date().toISOString(),
        standard: { mealsPerDay: (ob.standard && ob.standard.mealsPerDay) || 3, pressure: ob.pressure || 'Hold me accountable' },
      });
      window.__render();
    });
```

- [ ] **Step 4: Verify and commit**

Run: `npm run typecheck && npm run test`
Expected: clean. Manual QA (optional): step 6 shows "Your Standard" solo / "Coach X's Standard" when a join exists; Next stays disabled until the hold completes; re-entering the step shows the committed state.

```bash
git add proto/redesign-2026-07/js/ob-commit.js proto/redesign-2026-07/js/screens/onboarding.js
git commit -m "feat(onboarding): adaptive Your Standard — coach-named vs goal-generated, meals knob, hold-to-commit"
```

---

### Task 6: Shared account step + persistence extensions (step 7)

**Files:**
- Create: `proto/redesign-2026-07/js/screens/ob-account.js`
- Modify: `proto/redesign-2026-07/js/screens/onboarding.js` (step 7 body + mount)
- Modify: `proto/redesign-2026-07/js/state.js` (`friendlyAuth`, `persistOnboarding`)
- Modify: `proto/redesign-2026-07/js/screens/settings.js` (`terms`/`privacy` back-target threading)

**Interfaces:**
- Consumes: `passwordStrength`, `TOS_VERSION` (Task 1); `RT.ob` (Tasks 2/4/5); existing `act.signUp`, `act.persistOnboarding`, `act.startDay0`; RPCs `join_team(code, athlete_position)` / `join_practice(code)` (existing, 0002).
- Produces: `accountBody({ terms }) → html` and `wireAccount(root, { role, onSession }) → void` from `ob-account.js` — `onSession(live: boolean)` fires after a successful signup (`live=false` means email-confirmation required). Tasks 8, 9, 10, 11 reuse both. `persistOnboarding()` now also writes `dob`/`standard` (separate best-effort upsert), ToS + commitment stamps on `profiles`, and redeems `RT.ob.join`. Terms routes: `#terms/ob`, `#privacy/ob` return to `onboarding/7`; `cob|tob|clob` variants for Tasks 8–10.

- [ ] **Step 1: Write the shared account component**

Create `proto/redesign-2026-07/js/screens/ob-account.js`:

```js
/* Shared account-creation step for every onboarding flow (athlete/coach/trainer/client).
   Email + password + confirm + strength meter + implicit ToS line. Passwords are never
   persisted; the email is captured to RT.ob so a Terms detour doesn't lose it. */
import { RT, act } from '../state.js';
import { passwordStrength } from '../ob-helpers.js';

export function accountBody(opts = {}) {
  const terms = opts.terms || 'ob';
  return `
    <div id="ap-wrap"></div>
    <input id="su-email" class="ob-input" type="email" inputmode="email" autocapitalize="none" autocorrect="off" spellcheck="false" placeholder="Email" />
    <div style="height:12px"></div>
    <div class="pw-row"><input id="su-pass" class="ob-input" type="password" placeholder="Create a password (8+ characters)" /><span class="pw-eye" id="su-eye">Show</span></div>
    <div class="pw-meter" id="su-meter"><i></i><i></i><i></i></div>
    <div id="su-meter-label" style="font-size:12px;font-weight:700;color:var(--text-3);min-height:16px;margin:0 2px 8px"></div>
    <input id="su-pass2" class="ob-input" type="password" placeholder="Retype password" />
    <div id="su-err" style="color:#f87171;font-size:13px;font-weight:600;min-height:18px;margin-top:12px;text-align:center"></div>
    <div style="font-size:12px;font-weight:600;color:var(--text-3);text-align:center;line-height:1.5;margin-top:4px">By creating an account you agree to the <span class="lnk" data-go="terms/${terms}">Terms of Service</span> and <span class="lnk" data-go="privacy/${terms}">Privacy Policy</span>.</div>`;
}

export function wireAccount(root, { role, onSession }) {
  const $ = (s) => root.querySelector(s);
  const btn = $('#su-go'), err = $('#su-err'), email = $('#su-email');
  const p1 = $('#su-pass'), p2 = $('#su-pass2'), eye = $('#su-eye');
  const meter = $('#su-meter'), mlabel = $('#su-meter-label');
  if (!btn) return;
  if (RT.ob && RT.ob.email) email.value = RT.ob.email;
  email.addEventListener('input', () => act.captureOb({ email: email.value.trim() }));
  eye.addEventListener('click', () => {
    const t = p1.type === 'password' ? 'text' : 'password';
    p1.type = t; p2.type = t;
    eye.textContent = t === 'password' ? 'Show' : 'Hide';
  });
  const gate = () => {
    const s = passwordStrength(p1.value);
    meter.querySelectorAll('i').forEach((seg, i) => { seg.className = i < s.score ? `on${s.score === 3 ? ' s3' : ''}` : ''; });
    mlabel.textContent = p1.value ? s.label : '';
    const match = !!p1.value && p1.value === p2.value;
    err.textContent = p2.value && !match ? 'Passwords don’t match yet.' : '';
    btn.disabled = !(email.value.trim() && s.ok && match);
  };
  [p1, p2, email].forEach((el) => el.addEventListener('input', gate));
  gate();
  const submit = async () => {
    err.textContent = '';
    const ob = RT.ob || {};
    const name = (ob.name || '').trim();
    if (!name) { err.textContent = 'Add your name in step 1 before creating your account.'; return; }
    btn.disabled = true;
    const was = btn.textContent;
    btn.textContent = 'Creating your account…';
    const r = await act.signUp(email.value.trim(), p1.value, name, role);
    if (r.ok) { await onSession(!!r.session); return; }
    err.textContent = r.error || 'Could not create your account.';
    btn.disabled = false;
    btn.textContent = was;
  };
  btn.addEventListener('click', submit);
  p2.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
}
```

- [ ] **Step 2: Replace step 7 in `onboarding.js`**

Add import: `import { accountBody, wireAccount } from './ob-account.js';`

```js
  7: () => `
  <div class="ob">
    <div class="ob-nav"><div class="ob-back" data-go="onboarding/6" aria-label="Back">${icon('chevron', 18)}</div>${progress(7)}</div>
    <div class="standard-set" style="padding-bottom:6px">
      <div class="halo"><div class="core">${icon('check', 38)}</div></div>
      <div class="ob-title" style="margin-top:18px">Your Standard is set.</div>
      <div class="ob-sub" style="padding:0 10px">Create your account to save it — your score, meals, and coach connection sync across devices.</div>
    </div>
    <div style="height:16px"></div>
    ${accountBody({ terms: 'ob' })}
    <div class="ob-foot" style="margin-top:auto">
      <button id="su-go" class="btn green" disabled>Create account &amp; Start</button>
    </div>
  </div>`,
```

Replace the whole step-6-era signup block in `mount()` (the `#su-go` block) with:

```js
    // ---- Step 7: shared account component; connection + stamps persist post-signup ----
    if (root.querySelector('#su-go')) {
      wireAccount(root, {
        role: 'athlete',
        onSession: async (live) => {
          await act.persistOnboarding();
          if (live) { act.startDay0(); window.__go('home'); return; }
          const err = root.querySelector('#su-err'), btn = root.querySelector('#su-go');
          err.style.color = 'var(--text-2)';
          err.textContent = 'Account created — confirm your email, then sign in to start.';
          btn.textContent = 'Confirm your email to continue';
          btn.disabled = true;
        },
      });
    }
```

- [ ] **Step 3: Extend `state.js`**

In `friendlyAuth`, change the password line to: `if (m.includes('password')) return 'Password must be at least 8 characters.';`

Add at the top of `state.js` imports: `import { TOS_VERSION } from './ob-helpers.js';`

Replace `persistOnboarding` with:

```js
  /* Persist the athlete's captured onboarding (RT.ob) to the server + local RT. Awaitable;
     idempotent (upserts + on-conflict RPCs), so it back-fills a confirmation-delayed signup
     on the next sign-in. New-column writes (dob/standard, ToS stamps) are SEPARATE
     best-effort calls so they fail cleanly until migration 0048 is applied at go-live. */
  async persistOnboarding() {
    const sb = window.sb;
    const ob = RT.ob || {};
    const name = ob.name || (RT.profile && RT.profile.name) || '';
    this.saveProfile({ name, sport: ob.sport || '', position: ob.position || '', level: ob.level || '' });
    this.saveAllergies(ob.allergies || RT.allergies || []);
    const fields = {};
    if (ob.sport) fields.sport = ob.sport;
    if (ob.position) fields.position = ob.position;
    if (ob.level) fields.level = ob.level;
    if (ob.goal) fields.base_goal = ob.goal;
    if (ob.currentWeight) fields.base_weight = Math.round(ob.currentWeight);
    if (ob.currentWeight || ob.targetWeight) fields.season_goal = { start: ob.currentWeight || null, target: ob.targetWeight || null };
    let wrote = false;
    if (Object.keys(fields).length) wrote = await this.saveAthleteProfile(fields);
    // 0048 columns — separate upsert so a pre-migration DB rejects only this call
    if (ob.dob || ob.standard) {
      const extra = {};
      if (ob.dob) extra.dob = ob.dob;
      if (ob.standard) extra.standard = ob.standard;
      await this.saveAthleteProfile(extra);
    }
    // consent + commitment stamps (profiles_self_write; 0048 columns, best-effort)
    if (sb && RT.userId) {
      try {
        await sb.from('profiles').update({
          tos_accepted_at: new Date().toISOString(),
          tos_version: TOS_VERSION,
          ...(ob.committedAt ? { committed_at: ob.committedAt } : {}),
        }).eq('id', RT.userId);
      } catch { /* re-attempted on next sign-in back-fill */ }
    }
    // redeem the validated join code now that a session exists (server re-validates; idempotent)
    if (sb && RT.userId && ob.join && ob.join.code) {
      try {
        const rpc = ob.join.kind === 'practice' ? 'join_practice' : 'join_team';
        const args = ob.join.kind === 'practice'
          ? { code: ob.join.code }
          : { code: ob.join.code, athlete_position: ob.position || null };
        const { error } = await sb.rpc(rpc, args);
        if (!error && ob.join.school) this.saveProfile({ school: ob.join.school });
      } catch { /* re-attempted on next sign-in back-fill */ }
    }
    return wrote;
  },
```

- [ ] **Step 4: Thread the back target through `terms`/`privacy`**

In `settings.js`, change both screens' `render()` to `render({ sub })` and compute the backHead target:

```js
const OB_BACK = { ob: 'onboarding/7', cob: 'coach-ob/5', tob: 'trainer-ob/3', clob: 'client-ob/6' };
```

(place the constant once, above the two screens) and in each: `const back = OB_BACK[sub] || 'profile';` then pass `back` as the third argument to `backHead(…)` instead of `'profile'`.

- [ ] **Step 5: Verify and commit**

Run: `npm run typecheck && npm run test`
Expected: clean. Manual QA (optional): step 7 gates on 8+ chars + match; meter fills; Terms link opens and returns to step 7 with the email still filled.

```bash
git add proto/redesign-2026-07/js/screens/ob-account.js proto/redesign-2026-07/js/screens/onboarding.js proto/redesign-2026-07/js/state.js proto/redesign-2026-07/js/screens/settings.js
git commit -m "feat(onboarding): hardened account step — confirm+strength (8+ min), ToS gate, join redemption post-signup"
```

---

### Task 7: Migration 0048 + RLS test coverage

**Files:**
- Create: `supabase/migrations/0048_onboarding_overhaul.sql`
- Modify: `supabase/tests/rls_authz_test.sql` (append a section before the final scoreboard block)

**Interfaces:**
- Consumes: existing `profiles_self_write` (0002:86) and athlete_profiles self-write policies.
- Produces: columns `athlete_profiles.dob date`, `athlete_profiles.standard jsonb`, `profiles.tos_accepted_at timestamptz`, `profiles.tos_version text`, `profiles.committed_at timestamptz` — exactly the names `persistOnboarding` (Task 6) writes.

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/0048_onboarding_overhaul.sql`:

```sql
-- OnStandard — onboarding overhaul: identity, consent receipts, the commitment
-- (spec docs/superpowers/specs/2026-07-09-onboarding-overhaul-design.md).
--
-- GUARDRAIL: authored only; the founder applies this at go-live (like 0004+). Additive and
-- inert; the client writes these columns in SEPARATE best-effort calls, so it is safe on
-- either side of the apply. No policy changes: profiles_self_write (0002) covers the
-- profiles stamps, and the athlete_profiles self-write policies cover dob/standard.

alter table athlete_profiles add column if not exists dob date;
alter table athlete_profiles add column if not exists standard jsonb;
alter table profiles add column if not exists tos_accepted_at timestamptz;
alter table profiles add column if not exists tos_version text;
alter table profiles add column if not exists committed_at timestamptz;

comment on column athlete_profiles.dob is
  'Date of birth from signup. Under-13 is blocked client-side (COPPA); 13-17 proceed with no guardian dependency. Visible only within existing can_view() scope.';
comment on column athlete_profiles.standard is
  'Solo standard knobs {mealsPerDay, pressure}. Coach-connected athletes inherit the team standard; this never feeds the scoring formula (DECISION-MEMO D3).';
comment on column profiles.tos_accepted_at is
  'When this account accepted the Terms/Privacy (implicit-agree line at account creation).';
comment on column profiles.tos_version is
  'Version tag of the accepted terms, e.g. 2026-07-09.';
comment on column profiles.committed_at is
  'The hold-to-commit timestamp from onboarding — the user''s signature on their Standard.';
```

- [ ] **Step 2: Add RLS checks**

In `supabase/tests/rls_authz_test.sql`, find the final scoreboard block (search for `scoreboard`) and insert this section immediately before it (actor UUIDs are the suite's existing cast — athlete A `aaaaaaaa-0000-0000-0000-000000000001`, athlete B `bbbbbbbb-0000-0000-0000-000000000002`):

```sql
-- ---------------------------------------------------------------- 0048: onboarding columns
select _as('aaaaaaaa-0000-0000-0000-000000000001');
select _ok(_try($$update profiles set tos_accepted_at = now(), tos_version = '2026-07-09', committed_at = now()
                 where id = 'aaaaaaaa-0000-0000-0000-000000000001'$$) = 'ok',
           '0048: athlete records own ToS acceptance + commitment');
select _ok(_try($$update athlete_profiles set dob = '2008-01-15', standard = '{"mealsPerDay":3}'::jsonb
                 where athlete_id = 'aaaaaaaa-0000-0000-0000-000000000001'$$) = 'ok',
           '0048: athlete writes own dob + standard knobs');
-- cross-writes: RLS silently matches zero rows — assert the value did not change
select _try($$update profiles set tos_version = 'evil' where id = 'bbbbbbbb-0000-0000-0000-000000000002'$$);
select _try($$update athlete_profiles set dob = '1990-01-01' where athlete_id = 'bbbbbbbb-0000-0000-0000-000000000002'$$);
select _superuser();
select _ok((select tos_version is distinct from 'evil' from profiles
            where id = 'bbbbbbbb-0000-0000-0000-000000000002'),
           '0048: stranger cannot stamp another profile''s ToS fields');
select _ok((select dob is distinct from '1990-01-01'::date from athlete_profiles
            where athlete_id = 'bbbbbbbb-0000-0000-0000-000000000002'),
           '0048: stranger cannot set another athlete''s dob');
```

- [ ] **Step 3: Run the suite if a local DB exists**

Run: `npm run test:rls`
Expected: full scoreboard PASS including the four `0048:` checks. If no migrated local database is available in this environment, statically re-check the section against the harness conventions (`_as`/`_try`/`_superuser`/`_ok`) and note "authored, not locally executed" in the commit body.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/0048_onboarding_overhaul.sql supabase/tests/rls_authz_test.sql
git commit -m "feat(backend): 0048 — dob, solo-standard knobs, ToS receipts, commitment stamp (authored only)"
```

---

### Task 8: Coach onboarding made real (5 steps + code screen)

**Files:**
- Modify: `proto/redesign-2026-07/js/screens/roles.js` (`coachSteps`, `coachOb`)
- Modify: `proto/redesign-2026-07/js/state.js` (add `persistCoachOnboarding`, extend `signIn` back-fill)
- Modify: `proto/redesign-2026-07/js/screens/index.js` (no new routes needed — `coach-ob/6` rides the existing `coach-ob` module)

**Interfaces:**
- Consumes: `dir`, `debounce` (Task 4); `accountBody`, `wireAccount` (Task 6); RPCs `find_org(p_name, p_state)`, `create_team(team_name, team_sport, team_org, team_discoverable)` (existing); `orgs` insert under `orgs_write` (requires `created_by = auth.uid()`).
- Produces: `RT.ob.coach = { name, staffRole, orgId?, schoolName, city, state, teamName, sport, level, discoverable }`, `RT.ob.teamCode` (real server code). `act.persistCoachOnboarding() → boolean`. Route `#coach-ob/1..6`.

- [ ] **Step 1: Rewrite `coachSteps` with real capture**

First, three module-level changes in `roles.js`:
1. Change the state import to `import { S, RT, act } from '../state.js';`
2. Add `import { accountBody, wireAccount } from './ob-account.js';`
3. Replace the roles.js `frame()` with the Task-2 implementation extended for a `total` parameter — `frame(n, total, title, sub, body, cta, next, opts)` — whose nav header is `<div class="ob-nav"><div class="ob-back" data-go="${opts.back || 'role'}" aria-label="Back">${icon('chevron', 18)}</div>${progressOf(n, total)}</div>`, plus the helper:

```js
function progressOf(n, total) {
  return `<div class="ob-prog" role="progressbar" aria-label="Step ${n} of ${total}" aria-valuenow="${n}" aria-valuemax="${total}">${
    Array.from({ length: total }, (_, i) => `<i class="${i + 1 <= n ? 'on' : ''}"></i>`).join('')}</div>`;
}
```

Then replace `coachSteps` (5 steps + code screen):

```js
const coachSteps = {
  1: () => frame(1, 5, 'You, coach.', 'Your athletes see this name on every standard you set.', `
    <input id="co-first" class="ob-input" placeholder="First name" autocapitalize="words" />
    <div style="height:12px"></div>
    <input id="co-last" class="ob-input" placeholder="Last name" autocapitalize="words" />
    <div style="height:16px"></div>
    <div class="eyebrow" style="margin:8px 2px 10px">Your role</div>
    <div class="chip-row" id="co-role">
      <span class="chp on">Head Coach</span><span class="chp">Assistant</span><span class="chp">S&amp;C</span><span class="chp">Nutrition</span>
    </div>`, 'Next', 'coach-ob/2', { back: 'role' }),

  2: () => {
    const c = (RT.ob || {}).coach || {};
    return frame(2, 5, 'Your school.', 'Athletes find you by school. Same-name schools split by city.', c.schoolName ? `
      <section class="card team-preview">
        <div class="tp-av">${c.schoolName[0]}</div>
        <div style="flex:1"><div style="font-size:16px;font-weight:800">${c.schoolName}</div>
        <div style="font-size:13px;font-weight:600;color:var(--text-2);margin-top:2px">${[c.city, c.state].filter(Boolean).join(', ') || '—'}</div></div>
        <span class="status-pill g">Set</span>
      </section>
      <div style="height:12px"></div>
      <div style="text-align:center;font-size:13px;font-weight:700;color:var(--text-3);cursor:pointer" id="co-school-clear">Change school</div>` : `
      <input id="co-q" class="ob-input" placeholder="Search your school" autocorrect="off" spellcheck="false" />
      <div id="co-out" style="margin-top:14px"></div>
      <div style="height:10px"></div>
      <div id="co-add" style="text-align:center;font-size:14px;font-weight:700;color:var(--amber-bright);cursor:pointer">My school isn't listed — add it</div>`,
      'Next', 'coach-ob/3', { back: 'coach-ob/1' });
  },

  3: () => frame(3, 5, 'Build the team.', 'Athletes join it with one code. You can run more than one group.', `
    <input id="co-team" class="ob-input" placeholder="Team name (e.g. Varsity Football)" />
    <div style="height:16px"></div>
    <div class="eyebrow" style="margin:8px 2px 10px">Sport</div>
    <div class="chip-row" id="co-sport">
      <span class="chp on">Football</span><span class="chp">Basketball</span><span class="chp">Baseball</span><span class="chp">Track</span><span class="chp">Other</span>
    </div>
    <div style="height:16px"></div>
    <div class="eyebrow" style="margin:8px 2px 10px">Level</div>
    <div class="chip-row" id="co-level">
      <span class="chp">Youth</span><span class="chp on">High School</span><span class="chp">College</span><span class="chp">Pro</span>
    </div>
    <div style="height:16px"></div>
    <div class="lrow" style="cursor:default;padding:0 2px">
      <div class="lm"><div class="lt">Listed in school search</div><div class="ls">Athletes at your school can find this team. The code is still required to join.</div></div>
      <div class="seg" style="width:104px" id="co-disc"><button class="on">On</button><button>Off</button></div>
    </div>`, 'Next', 'coach-ob/4', { back: 'coach-ob/2' }),

  4: () => /* keep the existing step-3 "Set the team standard" body verbatim, renumbered: */
    frame(4, 5, 'Set the team standard.', 'Every athlete starts with these. Adjust per athlete anytime.',
      /* existing toggles card + footnote markup unchanged */, 'Next', 'coach-ob/5', { back: 'coach-ob/3' }),

  5: () => `
  <div class="ob">
    <div class="ob-nav"><div class="ob-back" data-go="coach-ob/4">${icon('chevron', 18)}</div>${progressOf(5, 5)}</div>
    <div class="ob-title">Create your account.</div>
    <div class="ob-sub">Your team, code, and roster live on it.</div>
    <div style="height:8px"></div>
    ${accountBody({ terms: 'cob' })}
    <div class="ob-foot" style="margin-top:auto"><button id="su-go" class="btn primary" disabled>Create account &amp; Get my code</button></div>
  </div>`,

  6: () => {
    const code = (RT.ob || {}).teamCode || '';
    return `
  <div class="ob">
    <div class="standard-set">
      <div class="halo"><div class="core" style="background:linear-gradient(155deg,#f59e0b,#d97706)">${icon('users', 34)}</div></div>
      <div class="ob-title" style="margin-top:22px">Your team code.</div>
      <div class="ob-sub" style="padding:0 8px">Send it to the group chat. Athletes enter it once and their work starts counting toward your board.</div>
      <div style="height:22px"></div>
      ${code ? `<div class="code-boxes">${code.split('').map((c) => `<div class="cb filled" style="border-color:var(--amber-border);background:rgba(245,165,36,0.08)">${c}</div>`).join('')}</div>
      <div style="height:12px"></div>
      <button class="btn ghost sm" id="copy-code" style="width:auto;padding:0 26px;margin:0 auto">${icon('clipboard', 16)} Copy code</button>` :
      `<div class="sidebox"><div class="req-icon b" style="width:38px;height:38px">${icon('clipboard', 17)}</div>
        <div><div class="tt">Code pending</div><div class="ts">We couldn't mint your code yet (connection or pending email confirmation). It generates automatically on your next sign-in — check Profile → Team code.</div></div></div>`}
    </div>
    <div class="ob-foot" style="margin-top:auto">
      <button class="btn primary" data-go="coach">Open Coach Dashboard</button>
    </div>
  </div>`;
  },
};
```

(`progressOf(n, total)` is the roles.js-local segmented progress helper — same markup as Task 2's `progress()` but with a `total` parameter. Add it next to the roles.js `frame`.)

- [ ] **Step 2: Rewrite `coachOb.mount`**

```js
export const coachOb = {
  hideTabs: true,
  render({ sub }) {
    const n = Math.min(6, Math.max(1, +(sub || 1)));
    return coachSteps[n]();
  },
  async mount(root) {
    await toggles(root);
    const cap = (patch) => act.captureOb({ coach: { ...((RT.ob || {}).coach || {}), ...patch } });
    const $ = (s) => root.querySelector(s);
    // step 1: names + role chips
    const f = $('#co-first');
    if (f) {
      const l = $('#co-last'), roleRow = $('#co-role');
      const nextBtn = root.querySelector('.ob-foot .btn');
      const c = (RT.ob || {}).coach || {};
      if (c.name) { const [cf, ...cl] = c.name.split(' '); f.value = cf; l.value = cl.join(' '); }
      const sync = () => {
        const name = `${f.value.trim()} ${l.value.trim()}`.trim();
        const on = roleRow.querySelector('.on');
        cap({ name, staffRole: on ? on.textContent.trim() : 'Head Coach' });
        act.captureOb({ name }); // account step + profiles.full_name read RT.ob.name
        nextBtn.disabled = !(f.value.trim() && l.value.trim());
      };
      [f, l].forEach((el) => el.addEventListener('input', sync));
      roleRow.addEventListener('click', sync);
      sync();
    }
    // step 2: school search / add-your-school (anon directory — no session yet)
    const q = $('#co-q');
    if (q) {
      const { dir, debounce } = await import('../ob-directory.js');
      const out = $('#co-out');
      q.addEventListener('input', debounce(async () => {
        const v = q.value.trim();
        if (v.length < 2) { out.innerHTML = ''; return; }
        try {
          const { orgs } = await dir.search(v);
          out.innerHTML = orgs.length ? `<section class="card" style="padding:6px 16px">${orgs.map((o, i) => `
            <div class="lrow" data-org="${i}"><div class="lic">${icon('shield', 17)}</div>
            <div class="lm"><div class="lt">${o.name}</div><div class="ls">${[o.city, o.state].filter(Boolean).join(', ') || '—'}</div></div></div>`).join('')}</section>`
            : `<div class="micro" style="color:var(--text-3);font-weight:700;padding:6px 2px">Nothing yet — add your school below.</div>`;
          out.querySelectorAll('[data-org]').forEach((el) => el.addEventListener('click', () => {
            const o = orgs[+el.getAttribute('data-org')];
            cap({ orgId: o.id, schoolName: o.name, city: o.city, state: o.state });
            window.__render();
          }));
        } catch { out.innerHTML = `<div class="micro" style="color:var(--text-3);font-weight:700;padding:6px 2px">Directory unreachable — add your school below.</div>`; }
      }, 300));
      $('#co-add').addEventListener('click', () => {
        out.innerHTML = `
          <input id="co-add-name" class="ob-input" placeholder="School / organization name" />
          <div style="height:10px"></div>
          <div class="dob-row">
            <input id="co-add-city" class="ob-input" placeholder="City" style="flex:2" />
            <input id="co-add-state" class="ob-input" placeholder="ST" maxlength="2" autocapitalize="characters" />
          </div>
          <div style="height:10px"></div>
          <button class="btn ghost sm" id="co-add-go" style="width:auto;padding:0 22px;margin:0 auto;display:block">Use this school</button>`;
        out.querySelector('#co-add-go').addEventListener('click', () => {
          const name = out.querySelector('#co-add-name').value.trim();
          if (!name) return;
          cap({ orgId: null, schoolName: name, city: out.querySelector('#co-add-city').value.trim(), state: out.querySelector('#co-add-state').value.trim().toUpperCase() });
          window.__render();
        });
      });
    }
    const clear = $('#co-school-clear');
    if (clear) clear.addEventListener('click', () => { cap({ orgId: null, schoolName: '', city: '', state: '' }); window.__render(); });
    // step 3: team fields (restore + capture; discoverable defaults On)
    const team = $('#co-team');
    if (team) {
      const c = (RT.ob || {}).coach || {};
      if (c.teamName) team.value = c.teamName;
      const sync = () => {
        const sp = $('#co-sport .on'), lv = $('#co-level .on'), disc = $('#co-disc .on');
        cap({ teamName: team.value.trim(), sport: sp ? sp.textContent.trim() : null,
              level: lv ? lv.textContent.trim() : null, discoverable: !disc || disc.textContent.trim() === 'On' });
      };
      team.addEventListener('input', sync);
      ['#co-sport', '#co-level', '#co-disc'].forEach((sel) => { const el = $(sel); if (el) el.addEventListener('click', sync); });
      sync();
    }
    // step 5: shared account → mint org/team → code screen
    if ($('#su-go')) {
      wireAccount(root, {
        role: 'coach',
        onSession: async (live) => {
          if (live) { await act.persistCoachOnboarding(); window.__go('coach-ob/6'); return; }
          const err = $('#su-err');
          err.style.color = 'var(--text-2)';
          err.textContent = 'Account created — confirm your email, then sign in. Your team and code mint automatically.';
        },
      });
    }
    // step 6: copy the REAL code
    const copy = $('#copy-code');
    if (copy) copy.addEventListener('click', async () => {
      try { await navigator.clipboard.writeText((RT.ob || {}).teamCode || ''); } catch { /* label still confirms intent */ }
      copy.innerHTML = `${icon('check', 16)} Copied`;
    });
  },
};
```

- [ ] **Step 3: Add `persistCoachOnboarding` + back-fill to `state.js`**

In `act`, after `persistOnboarding`:

```js
  /* Mint the coach's real org + team + join code from RT.ob.coach. Idempotent: a minted
     code short-circuits. Org insert must set created_by = auth.uid() (orgs_write policy). */
  async persistCoachOnboarding() {
    const sb = window.sb;
    const ob = RT.ob || {};
    const c = ob.coach || {};
    if (!sb || !RT.userId) return false;
    if (ob.teamCode) return true;
    let orgId = c.orgId || null;
    if (!orgId && c.schoolName) {
      try {
        const { data: found } = await sb.rpc('find_org', { p_name: c.schoolName, p_state: c.state || null });
        if (found && found.length) orgId = found[0].id;
        else {
          const { data: ins } = await sb.from('orgs')
            .insert({ name: c.schoolName, type: 'school', city: c.city || null, state: c.state || null, created_by: RT.userId })
            .select('id').maybeSingle();
          if (ins) orgId = ins.id;
        }
      } catch { /* org optional — a code-only team still works */ }
    }
    try {
      const { data: code, error } = await sb.rpc('create_team', {
        team_name: c.teamName || 'My Team', team_sport: c.sport || null,
        team_org: orgId, team_discoverable: c.discoverable !== false,
      });
      if (error || !code) return false;
      this.captureOb({ teamCode: code });
      return true;
    } catch { return false; }
  },
```

In `signIn`, after the existing athlete back-fill block, add:

```js
    if (role === 'coach' && RT.ob && RT.ob.coach && !RT.ob.teamCode) {
      try { await this.persistCoachOnboarding(); } catch { /* best-effort */ }
    }
```

- [ ] **Step 4: Verify and commit**

Run: `npm run typecheck && npm run test`
Expected: clean.

```bash
git add proto/redesign-2026-07/js/screens/roles.js proto/redesign-2026-07/js/state.js
git commit -m "feat(coach): real coach onboarding — school registration, discoverable team, minted join code"
```

---

### Task 9: Trainer onboarding made real

**Files:**
- Modify: `proto/redesign-2026-07/js/screens/roles.js` (`trainerSteps`, `trainerOb`)
- Modify: `proto/redesign-2026-07/js/state.js` (add `persistTrainerOnboarding`, extend `signIn`)

**Interfaces:**
- Consumes: `accountBody`/`wireAccount` (Task 6); RPC `create_practice(practice_name, practice_handle, is_discoverable)` (existing, 0025).
- Produces: `RT.ob.trainer = { practiceName, audience }`, `RT.ob.practiceCode` (real). `act.persistTrainerOnboarding() → boolean`. Route `#trainer-ob/1..4`.

- [ ] **Step 1: Rework `trainerSteps` to 4 steps**

Same pattern as Task 8, smaller: step 1 = practice-name input (real, empty placeholder `"Practice name (e.g. Boone Performance)"`, restore from `RT.ob.trainer.practiceName`) + who-you-train chips captured to `audience`; step 2 = the existing default-standard toggle card unchanged (renumbered `frame(2, 4, …)`); step 3 = the shared account step (`accountBody({ terms: 'tob' })`, CTA id `su-go`, label `Create account & Get my code`); step 4 = code screen identical in structure to coach step 6 but purple-styled, reading `RT.ob.practiceCode`, CTA `data-go="trainer"`.

`trainerOb.mount` wires: practice-name capture (`act.captureOb({ trainer: {...}, name: practiceName })` — the trainer's display name IS the practice head; also add a first/last name pair like coach step 1 and capture `name` from it), account step:

```js
    if ($('#su-go')) {
      wireAccount(root, {
        role: 'trainer',
        onSession: async (live) => {
          if (live) { await act.persistTrainerOnboarding(); window.__go('trainer-ob/4'); return; }
          const err = $('#su-err');
          err.style.color = 'var(--text-2)';
          err.textContent = 'Account created — confirm your email, then sign in. Your code mints automatically.';
        },
      });
    }
```

and the copy-code handler reading `RT.ob.practiceCode`.

- [ ] **Step 2: Add `persistTrainerOnboarding` to `state.js`**

```js
  /* Mint the trainer's real practice + client code. Idempotent via RT.ob.practiceCode. */
  async persistTrainerOnboarding() {
    const sb = window.sb;
    const ob = RT.ob || {};
    const t = ob.trainer || {};
    if (!sb || !RT.userId) return false;
    if (ob.practiceCode) return true;
    try {
      const { data: code, error } = await sb.rpc('create_practice', {
        practice_name: t.practiceName || 'My Practice', practice_handle: null, is_discoverable: true,
      });
      if (error || !code) return false;
      this.captureOb({ practiceCode: code });
      return true;
    } catch { return false; }
  },
```

And in `signIn`: `if (role === 'trainer' && RT.ob && RT.ob.trainer && !RT.ob.practiceCode) { try { await this.persistTrainerOnboarding(); } catch { /* best-effort */ } }`

- [ ] **Step 3: Verify and commit**

Run: `npm run typecheck && npm run test`
Expected: clean.

```bash
git add proto/redesign-2026-07/js/screens/roles.js proto/redesign-2026-07/js/state.js
git commit -m "feat(trainer): real trainer onboarding — practice registration, minted client code"
```

---

### Task 10: Client flow adaptation (6 steps)

**Files:**
- Modify: `proto/redesign-2026-07/js/screens/roles.js` (`clientSteps`, `clientOb`)

**Interfaces:**
- Consumes: `dir.practices`/`dir.previewCode` (Task 4), `standardForGoal(goal, meals, 'general')` (Task 1), `commitButton`/`wireCommit` (Task 5), `accountBody`/`wireAccount` (Task 6), `act.persistOnboarding` (Task 6 — handles `join.kind === 'practice'` via `join_practice`).
- Produces: `RT.ob` keys `goal` (lose/maintain/build/health), `firstName/lastName/name`, `life`, `trainingDays`, `currentWeight/targetWeight/allergies`, `join {kind:'practice',…}`, `committedAt`, `standard`. Route `#client-ob/1..6`. Signup role: **`'athlete'`** (clients are athlete-profile users on the general scoring profile; `routeForRole` lands them on home and the athlete back-fill covers them).

- [ ] **Step 1: Rework `clientSteps`**

Six steps, all with the roles.js `frame` back/progress nav:
1. **Goal** — existing four cards (Lose fat / Maintain / Build / Health) with `data-val="lose|maintain|build|health"` added; captured via a `wireGroup`-style handler to `RT.ob.goal`. Keep the scoring-honesty sidebox.
2. **Who are you** — first/last inputs (real, required, restore), life chips, training-days chips → `cap({ firstName, lastName, name, life, trainingDays })`.
3. **Where are you now** — replace the static `198.5/185` divs with real number inputs (copy athlete step-5 `bignum` input markup exactly, ids `cl-cur`/`cl-tgt`), allergies multi-chips → `currentWeight/targetWeight/allergies`.
4. **Connect your trainer** — same shape as athlete step 2 but: search input hits `dir.practices(q)`; result rows show `name` + `trainer_name` + `@handle`; picking one shows code entry ("Ask ⟨trainer⟩ for your client code"); `dir.previewCode` validates; `cap({ join: { kind: 'practice', code, practiceId, practiceName, trainerName } })`; connected card + Remove; skippable.
5. **Your Standard** — the two-faced standard: `standardForGoal(ob.goal, meals, 'general')`; connected face titled with the trainer's name; solo face with the meals knob; `commitButton`/`wireCommit` gate the Next button exactly like athlete step 6.
6. **Create account** — `accountBody({ terms: 'clob' })`, `wireAccount(root, { role: 'athlete', onSession: … })` with:

```js
        onSession: async (live) => {
          await act.persistOnboarding(); // writes profile + redeems join_practice + stamps
          if (live) { act.startDay0(); window.__go('home'); return; }
          const err = $('#su-err');
          err.style.color = 'var(--text-2)';
          err.textContent = 'Account created — confirm your email, then sign in to start.';
        },
```

- [ ] **Step 2: Wire `clientOb.mount`** — same handlers as the athlete equivalents (goal group, name/restore, weights, allergies, practice search, meals knob, `wireCommit`, account). Reuse the exact code shapes from Tasks 2/4/5/6, with `cl-` id prefixes.

- [ ] **Step 3: Verify and commit**

Run: `npm run typecheck && npm run test`
Expected: clean.

```bash
git add proto/redesign-2026-07/js/screens/roles.js
git commit -m "feat(client): client onboarding — real inputs, trainer discovery, general-profile standard + commit"
```

---

### Task 11: Sign in with Apple through the bridge (gated seam)

**Files:**
- Modify: `src/proto/bridge.ts` (two message types + shim API)
- Modify: `proto/redesign-2026-07/js/screens/ob-account.js` (Apple button)
- Modify: `proto/redesign-2026-07/js/state.js` (add `setAuthRole`)
- Test: `src/proto/bridge.test.ts`

**Interfaces:**
- Consumes: `isAppleAuthAvailable`, `requestAppleIdentityToken` from `src/lib/auth/apple.ts` (existing seam — returns false/null until the founder adds `expo-apple-authentication` at go-live, so the button stays hidden today).
- Produces: bridge messages `{type:'APPLE_AVAILABLE', id}` → boolean and `{type:'APPLE_SIGNIN', id}` → string|null; WebView API `window.OnStandardNative.apple.available()` / `.signIn()`; `act.setAuthRole(role)`.

- [ ] **Step 1: Write the failing bridge test**

Create `src/proto/bridge.test.ts`:

```ts
jest.mock('react-native', () => ({ Share: { share: jest.fn() } }));
jest.mock('expo-haptics', () => ({
  impactAsync: jest.fn(), notificationAsync: jest.fn(),
  ImpactFeedbackStyle: { Light: 1, Medium: 2, Heavy: 3 },
  NotificationFeedbackType: { Success: 1, Warning: 2, Error: 3 },
}));
jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async () => null), setItemAsync: jest.fn(), deleteItemAsync: jest.fn(),
}));

import { handleBridgeMessage, BRIDGE_SHIM } from './bridge';

function fakeRef() {
  const injected: string[] = [];
  return { injected, ref: { current: { injectJavaScript: (js: string) => injected.push(js) } } as never };
}

test('APPLE_AVAILABLE resolves false while the native module is absent', async () => {
  const { injected, ref } = fakeRef();
  const handled = await handleBridgeMessage(ref, { type: 'APPLE_AVAILABLE', id: 1 } as never);
  expect(handled).toBe(true);
  expect(injected[0]).toContain('__onNativeResult(1, false');
});

test('APPLE_SIGNIN resolves null while the native module is absent', async () => {
  const { injected, ref } = fakeRef();
  await handleBridgeMessage(ref, { type: 'APPLE_SIGNIN', id: 2 } as never);
  expect(injected[0]).toContain('__onNativeResult(2, null');
});

test('shim exposes the apple API', () => {
  expect(BRIDGE_SHIM).toContain('APPLE_AVAILABLE');
  expect(BRIDGE_SHIM).toContain('APPLE_SIGNIN');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/proto/bridge.test.ts`
Expected: FAIL — `APPLE_AVAILABLE` falls to the `default: return false` branch.

- [ ] **Step 3: Extend the bridge**

In `src/proto/bridge.ts`: add to `BridgeMessage`:

```ts
  | { type: 'APPLE_AVAILABLE'; id: number }
  | { type: 'APPLE_SIGNIN'; id: number }
```

add the import `import { isAppleAuthAvailable, requestAppleIdentityToken } from '../lib/auth/apple';` and two cases in `handleBridgeMessage`:

```ts
    case 'APPLE_AVAILABLE':
      resolve(ref, msg.id, isAppleAuthAvailable);
      return true;
    case 'APPLE_SIGNIN':
      try {
        resolve(ref, msg.id, await requestAppleIdentityToken());
      } catch (e) {
        resolve(ref, msg.id, null, String((e as Error)?.message ?? e));
      }
      return true;
```

In `BRIDGE_SHIM`, inside `window.OnStandardNative = { … }` add:

```js
    apple: {
      available: function(){ return call('APPLE_AVAILABLE', {}); },
      signIn: function(){ return call('APPLE_SIGNIN', {}); }
    },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/proto/bridge.test.ts`
Expected: PASS.

- [ ] **Step 5: Add the button to `ob-account.js` and `setAuthRole` to `state.js`**

`state.js`, in `act`: `setAuthRole(role) { RT.authRole = role; save(); },`

At the end of `wireAccount` in `ob-account.js`:

```js
  // Sign in with Apple — renders only when the native seam reports availability (go-live).
  (async () => {
    const native = window.OnStandardNative && window.OnStandardNative.apple;
    if (!native) return;
    let ok = false;
    try { ok = await native.available(); } catch { /* treat as unavailable */ }
    if (!ok) return;
    const wrap = $('#ap-wrap');
    wrap.innerHTML = `<button class="btn ghost" id="su-apple" style="margin-bottom:14px"> Continue with Apple</button>`;
    wrap.querySelector('#su-apple').addEventListener('click', async () => {
      err.textContent = '';
      try {
        const token = await native.signIn();
        if (!token) return; // user cancelled
        const { data, error } = await window.sb.auth.signInWithIdToken({ provider: 'apple', token });
        if (error || !data || !data.user) { err.textContent = 'Apple sign-in failed. Use email instead.'; return; }
        act._syncSession(data.user);
        act.setAuthRole(role);
        try {
          await window.sb.from('profiles').update({
            primary_role: role, ...(RT.ob && RT.ob.name ? { full_name: RT.ob.name } : {}),
          }).eq('id', data.user.id);
        } catch { /* best-effort */ }
        await onSession(true);
      } catch { err.textContent = 'Apple sign-in failed. Use email instead.'; }
    });
  })();
```

- [ ] **Step 6: Verify and commit**

Run: `npm run typecheck && npm run test`
Expected: clean.

```bash
git add src/proto/bridge.ts src/proto/bridge.test.ts proto/redesign-2026-07/js/screens/ob-account.js proto/redesign-2026-07/js/state.js
git commit -m "feat(auth): Sign in with Apple via the bridge — gated seam, inert until the native dep lands"
```

---

### Task 12: Face ID app-unlock (gated seam) + opt-in moment

**Files:**
- Create: `src/lib/auth/biometrics.ts`
- Modify: `src/proto/bridge.ts` (`BIO_AVAILABLE` message + shim `biometrics` API)
- Modify: `src/proto/ProtoApp.tsx` (cold-start lock gate)
- Create: `proto/redesign-2026-07/js/screens/bio-optin.js`
- Modify: `proto/redesign-2026-07/js/screens/index.js` (register `'bio-optin'`)
- Modify: `proto/redesign-2026-07/js/screens/onboarding.js` + `roles.js` (route to the opt-in after athlete/client signup)
- Modify: `proto/redesign-2026-07/js/screens/settings.js` (Face ID toggle row)
- Test: `src/proto/bridge.test.ts` (one more case)

**Interfaces:**
- Consumes: SecureStore via the existing bridge (`OnStandardNative.secureStore`); flag key **`onstd-biolock`** = `'1'` when enabled.
- Produces: `isBiometricsAvailable: boolean`, `biometricsUsable(): Promise<boolean>`, `authenticateBiometric(): Promise<boolean>` from `src/lib/auth/biometrics.ts`; bridge `{type:'BIO_AVAILABLE', id}`; `OnStandardNative.biometrics.available()`; route `#bio-optin`. Gated exactly like apple.ts: **no dependency is installed now** — the founder adds `expo-local-authentication` at go-live and everything lights up; until then `available()` is false, the sheet never shows, and the cold-start gate passes through.

- [ ] **Step 1: Write the seam**

Create `src/lib/auth/biometrics.ts`:

```ts
// OnStandard — Face ID / biometric app-unlock seam (gated, native-deferred; mirrors apple.ts).
// Real flow needs `expo-local-authentication` (native module), added by the founder at
// go-live. Until then: available=false (opt-in UI never shows), authenticate=true (the
// lock gate NEVER locks a user out when the module is absent or errors).
import { Platform } from 'react-native';

export const isBiometricsAvailable: boolean = (() => {
  if (Platform.OS === 'web') return false;
  try {
    require.resolve('expo-local-authentication');
    return true;
  } catch {
    return false;
  }
})();

/** Hardware present AND biometrics enrolled — drives whether the opt-in sheet shows. */
export async function biometricsUsable(): Promise<boolean> {
  if (!isBiometricsAvailable) return false;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const LA = require('expo-local-authentication');
    return (await LA.hasHardwareAsync()) && (await LA.isEnrolledAsync());
  } catch {
    return false;
  }
}

/** Prompt Face ID / Touch ID. Fail-open: absence or errors return true (never lock out). */
export async function authenticateBiometric(): Promise<boolean> {
  if (!isBiometricsAvailable) return true;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const LA = require('expo-local-authentication');
    if (!(await LA.hasHardwareAsync()) || !(await LA.isEnrolledAsync())) return true;
    const r = await LA.authenticateAsync({ promptMessage: 'Unlock OnStandard' });
    return !!r.success;
  } catch {
    return true;
  }
}
```

- [ ] **Step 2: Bridge + test**

Add to `bridge.test.ts`:

```ts
test('BIO_AVAILABLE resolves false while the native module is absent', async () => {
  const { injected, ref } = fakeRef();
  await handleBridgeMessage(ref, { type: 'BIO_AVAILABLE', id: 3 } as never);
  expect(injected[0]).toContain('__onNativeResult(3, false');
});
```

Run `npx jest src/proto/bridge.test.ts` → the new case FAILS. Then in `bridge.ts`: add `| { type: 'BIO_AVAILABLE'; id: number }` to the union, `import { biometricsUsable } from '../lib/auth/biometrics';`, the case:

```ts
    case 'BIO_AVAILABLE':
      resolve(ref, msg.id, await biometricsUsable());
      return true;
```

and in `BRIDGE_SHIM`'s `OnStandardNative`: `biometrics: { available: function(){ return call('BIO_AVAILABLE', {}); } },`

Re-run → PASS.

- [ ] **Step 3: Cold-start gate in `ProtoApp.tsx`**

Add imports `import * as SecureStore from 'expo-secure-store';` and `import { authenticateBiometric } from '../lib/auth/biometrics';`, plus state and effect inside `ProtoApp()`:

```tsx
  const [locked, setLocked] = React.useState<boolean | null>(null);

  const tryUnlock = React.useCallback(async () => {
    try {
      const flag = await SecureStore.getItemAsync('onstd-biolock');
      if (flag !== '1') { setLocked(false); return; }
      setLocked(!(await authenticateBiometric()));
    } catch {
      setLocked(false); // fail-open: never brick the app on a storage error
    }
  }, []);

  React.useEffect(() => { void tryUnlock(); }, [tryUnlock]);
```

and before the existing `if (err)` return:

```tsx
  if (locked === null) {
    return (
      <Center>
        <ActivityIndicator color="#37D586" />
      </Center>
    );
  }
  if (locked) {
    return (
      <Center>
        <Text style={styles.errTitle}>OnStandard is locked</Text>
        <Text style={styles.errBody} onPress={() => void tryUnlock()}>
          Tap to unlock with Face ID
        </Text>
      </Center>
    );
  }
```

- [ ] **Step 4: Opt-in screen + routing + settings toggle**

Create `proto/redesign-2026-07/js/screens/bio-optin.js`:

```js
import { icon } from '../icons.js';

/* Post-signup Face ID opt-in. Reached only when the native seam reports biometrics are
   usable. Enabling sets the Keychain flag the native cold-start gate reads. */
export default {
  hideTabs: true,
  render() {
    return `
    <div class="ob">
      <div class="standard-set" style="padding-top:40px">
        <div class="halo"><div class="core">${icon('lock', 34)}</div></div>
        <div class="ob-title" style="margin-top:22px">Lock it down.</div>
        <div class="ob-sub" style="padding:0 10px">Unlock OnStandard with Face ID. Your scores, meals, and weight stay yours — even if someone has your phone.</div>
      </div>
      <div class="ob-foot" style="margin-top:auto">
        <button class="btn green" id="bio-on">Enable Face ID</button>
        <div style="text-align:center;padding-top:14px;font-size:14px;font-weight:700;color:var(--text-3);cursor:pointer" data-go="home">Not now</div>
      </div>
    </div>`;
  },
  mount(root) {
    const btn = root.querySelector('#bio-on');
    btn.addEventListener('click', async () => {
      try { await window.OnStandardNative.secureStore.setItem('onstd-biolock', '1'); } catch { /* no-op */ }
      window.__go('home');
    });
  },
};
```

Register in `screens/index.js`: `import bioOptin from './bio-optin.js';` and `'bio-optin': bioOptin,`.

In the athlete step-7 `onSession` (Task 6) and client step-6 `onSession` (Task 10), replace `window.__go('home')` on the live path with:

```js
          act.startDay0();
          let bio = false;
          try { bio = window.OnStandardNative && window.OnStandardNative.biometrics ? await window.OnStandardNative.biometrics.available() : false; } catch { /* unavailable */ }
          window.__go(bio ? 'bio-optin' : 'home');
```

Settings toggle — in `settings.js`, in the main settings screen's list add a row:

```js
      <div class="lrow" id="set-bio" style="display:none">
        <div class="lic">${icon('lock', 17)}</div>
        <div class="lm"><div class="lt">Unlock with Face ID</div><div class="ls">Required on app open</div></div>
        <div class="seg" style="width:104px" id="set-bio-seg"><button>On</button><button class="on">Off</button></div>
      </div>
```

and in that screen's `mount`, wire it (show the row only when the seam reports usable; read/write the flag via `OnStandardNative.secureStore`):

```js
    (async () => {
      const N = window.OnStandardNative;
      if (!N || !N.biometrics) return;
      let ok = false;
      try { ok = await N.biometrics.available(); } catch { /* hidden */ }
      if (!ok) return;
      const row = root.querySelector('#set-bio');
      row.style.display = '';
      const seg = row.querySelector('#set-bio-seg');
      const [onBtn, offBtn] = seg.querySelectorAll('button');
      const paint = (on) => { onBtn.classList.toggle('on', on); offBtn.classList.toggle('on', !on); };
      try { paint((await N.secureStore.getItem('onstd-biolock')) === '1'); } catch { /* default Off */ }
      onBtn.addEventListener('click', () => { N.secureStore.setItem('onstd-biolock', '1'); paint(true); });
      offBtn.addEventListener('click', () => { N.secureStore.removeItem('onstd-biolock'); paint(false); });
    })();
```

- [ ] **Step 5: Verify and commit**

Run: `npm run typecheck && npm run test`
Expected: clean (bridge tests now cover APPLE_* + BIO_AVAILABLE).

```bash
git add src/lib/auth/biometrics.ts src/proto/bridge.ts src/proto/bridge.test.ts src/proto/ProtoApp.tsx proto/redesign-2026-07/js/screens/bio-optin.js proto/redesign-2026-07/js/screens/index.js proto/redesign-2026-07/js/screens/onboarding.js proto/redesign-2026-07/js/screens/roles.js proto/redesign-2026-07/js/screens/settings.js
git commit -m "feat(auth): Face ID app-unlock — gated seam, cold-start gate, post-signup opt-in, settings toggle"
```

---

### Task 13: Remove the fake in-app status bar (quick win)

**Files:**
- Modify: `proto/redesign-2026-07/js/router.js` (`statusbar()`)

**Interfaces:**
- Consumes: nothing new. The real device status bar (rendered by `expo-status-bar` in `app/_layout.tsx`) already shows time/wifi/battery above the WebView.
- Produces: `.statusbar` becomes a safe-area spacer only.

- [ ] **Step 1: Replace `statusbar()`**

```js
function statusbar() {
  // The phone's own status bar (real clock, real battery) renders above the WebView —
  // drawing a second one reads as fake. This strip only reserves the safe-area height.
  return `<div class="statusbar" aria-hidden="true"></div>`;
}
```

Do NOT remove the `S` import (render still passes `S` to screens). Leave `.statusbar` CSS (height = the safe-area reservation) and the `.island` div untouched.

- [ ] **Step 2: Verify and commit**

Run: `npm run typecheck && npm run test`
Expected: clean.

```bash
git add proto/redesign-2026-07/js/router.js
git commit -m "fix(chrome): drop the drawn time/wifi/battery — the device status bar is the real one"
```

---

### Task 14: Full verification + docs closeout

**Files:**
- Modify: `docs/superpowers/specs/2026-07-09-onboarding-overhaul-design.md` (Status line)
- Modify: `proto/redesign-2026-07/BUILD-NOTES.md` (append a dated entry)

- [ ] **Step 1: Full verify**

Run: `npm run verify`
Expected: typecheck clean, all jest suites pass, `expo export` bundle succeeds. Fix anything that fails before proceeding (do not skip).

- [ ] **Step 2: End-to-end flow QA (browser)**

Open `proto/redesign-2026-07/index.html` in a browser and walk the QA script from spec §11: back/forward retention across all 7 steps; skip paths (school, coach); under-13 block; code path vs solo path rendering of step 6; hold-to-commit gating Next; password gate (8+, match, meter); coach flow through account to the code screen (directory calls fail gracefully offline → code screens show the pending state); client flow through trainer connect. Record any deviation and fix it in the owning file before closeout.

- [ ] **Step 3: Docs**

In the spec header change `**Status:** Approved…` to `**Status:** Implemented 2026-07-09 (this plan); migrations 0048 + org-directory function await go-live apply/deploy.` Append to `proto/redesign-2026-07/BUILD-NOTES.md` a short dated entry naming the new modules (`ob-helpers`, `ob-directory`, `ob-commit`, `ob-account`, `bio-optin`) and the two gated seams (Apple, biometrics).

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/specs/2026-07-09-onboarding-overhaul-design.md proto/redesign-2026-07/BUILD-NOTES.md
git commit -m "docs: onboarding overhaul closeout — spec status + build notes"
```
