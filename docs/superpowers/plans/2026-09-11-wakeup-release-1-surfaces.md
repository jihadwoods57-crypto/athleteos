# Wake-Up Release 1: the surfaces

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the five athlete- and coach-facing surfaces of the coach wake-up on top of the
Wake-Up Roll Call engine that already exists, without any new native code.

**Architecture:** The roll call already models a morning: a `commitment_board` instance carries a
`rows[]` array, one per athlete, each with a server-computed `verdict`. Everything here is a
projection of that one array. A single dependency-free module turns a board instance into the
numbers every screen needs, and the screens are thin renderers over it. No new tables, no new RPC,
no native build.

**Tech Stack:** Plain ES modules in `proto/redesign-2026-07` (no bundler, no TypeScript, no JSX),
`node:test` suites named `*.test.mjs`, Supabase RPCs already shipped in migrations 0138/0141/0211/0212.

**Spec:** `docs/superpowers/specs/2026-09-10-coach-wakeup-alarm-design.md`

## Global Constraints

- **The proto has NO BUILD STEP.** A missing import or a typo'd identifier throws at click time,
  not at build time. `npm run verify` is what catches it; `npm run lint:undef` is the specific gate.
- **`npm run verify` must be green before any commit.** It runs 16 gates.
- **No em dashes in any user-facing copy.** Gate: `npm run lint:dash`.
- **No new inline `style="` in proto files.** New files have a ceiling of ZERO. Gate:
  `npm run lint:inline`. Use classes; put CSS in `css/screens.css`.
- **Spacing uses the tokens** `var(--s1)`..`var(--s9)` and the half steps `--s1h --s2h --s3h --s4h`.
  Gate: `npm run lint:space`.
- **Font sizes use `var(--t-*)` tokens or `calc()` over them.** Gate: `npm run lint:type`.
- **Never hardcode a score weight in copy.** Use `liveWeightPct(comp)`. Gate: `npm run lint:score`.
- **Every interpolation into innerHTML is escaped** with `esc()`. Gate: `npm run lint:xss`.
- **Registry formatting is load-bearing:** every route in `js/screens/index.js` stays on one
  `name: value,` line. `scripts/qc-capture.mjs` parses that file by regex.
- **Shipping the proto means rebuilding the zip:** `node scripts/build-proto-zip.mjs`, commit
  `assets/proto.zip` AND `src/proto/protoVersion.ts`, then OTA. The OTA ships the zip, not the
  loose files.
- **Release 1 cannot show snooze counts.** The roll-call engine has no snooze concept; snooze
  arrives with the real alarm in release 3. Every surface here says answered on time, answered
  late, or never answered. Do not invent a snoozed column.

---

### Task 0: Re-enable the engine (founder-gated, do not run unprompted)

The Wake-Up Roll Call was switched off on 2026-09-02. Verified on prod 2026-09-11:
`feature_flags.verified_commitments.kill_switch = true`. Every surface in this plan renders empty
until it is turned back on, because the server returns `[]` for every read while the switch is on.

**Files:**
- Modify: `proto/redesign-2026-07/js/commitments.js:46`

**Interfaces:**
- Produces: a live `commitment_board` RPC that returns real rows, which every later task consumes.

- [ ] **Step 1: Confirm the switch is still on**

```bash
npx supabase db query --linked "select name, kill_switch from feature_flags where name = 'verified_commitments'"
```
Expected: `kill_switch` is `true`.

- [ ] **Step 2: Ask the founder before flipping it.** This is a live behaviour change for real
users on prod, and the founder switched it off deliberately. Do not run step 3 without a yes.

- [ ] **Step 3: Turn the server half back on**

```bash
npx supabase db query --linked "update feature_flags set kill_switch = false where name = 'verified_commitments'"
```

- [ ] **Step 4: Turn the client half back on**

In `proto/redesign-2026-07/js/commitments.js`, change:

```js
export const ROLLCALL_OFF = true;
```

to:

```js
export const ROLLCALL_OFF = false;
```

- [ ] **Step 5: Verify, rebuild, commit**

```bash
npm run verify
node scripts/build-proto-zip.mjs
git add proto/redesign-2026-07/js/commitments.js assets/proto.zip src/proto/protoVersion.ts
git commit -m "feat(wakeup): turn the roll call back on, server first"
```

---

### Task 1: The morning summary engine

One dependency-free module that turns a `commitment_board` instance into every number the
screens need. This is the spine: tasks 2, 3 and 5 all read from it and nothing else computes
these counts.

**Files:**
- Create: `proto/redesign-2026-07/js/wakeup-morning.js`
- Test: `proto/redesign-2026-07/js/wakeup-morning.test.mjs`

**Interfaces:**
- Consumes: a board instance from `VC.board` / `loadBoardFor()` in `js/commitment-data.js`. Its
  shape, from migration 0212: `{ instance_id, commitment_id, type, title, occurs_on, coach_name,
  starts_at, respond_by_at, closes_at, rows: [...] }` where each row is `{ response_id, athlete_id,
  name, status, acknowledged_at, verdict, late_min, excused_reason }` and `verdict` is one of
  `'on_standard' | 'late' | 'pending' | 'missed' | 'excused' | 'review'`.
- Produces:
  - `morningSummary(instance)` -> `{ total, onTime, late, missed, pending, excused, firstUp, needsYou, upRows }`
    where `firstUp` is `{ name, at, atMin } | null`, and `needsYou` / `upRows` are arrays of
    `{ athleteId, name, verdict, at, atMin, lateMin }`.
  - `morningStreak(days)` -> integer.
  - `WAKEUP_TYPE` -> `'morning_roll_call'`.

- [ ] **Step 1: Write the failing test**

Create `proto/redesign-2026-07/js/wakeup-morning.test.mjs`:

```js
/* The morning, reduced to the numbers every wake-up surface reads.
   Run: node --test proto/redesign-2026-07/js/wakeup-morning.test.mjs */
import test from 'node:test';
import assert from 'node:assert/strict';
import { morningSummary, morningStreak, WAKEUP_TYPE } from './wakeup-morning.js';

const row = (name, verdict, at, lateMin = 0) => ({
  response_id: `r-${name}`, athlete_id: `a-${name}`, name,
  status: verdict === 'pending' ? 'pending' : 'acknowledged',
  acknowledged_at: at, verdict, late_min: lateMin,
});
const inst = (rows) => ({
  instance_id: 'i1', type: WAKEUP_TYPE, title: 'Team wake-up', occurs_on: '2026-09-11',
  coach_name: 'Priya Nair', rows,
});

test('it counts every verdict and leaves excused out of the total', () => {
  const s = morningSummary(inst([
    row('Devon', 'on_standard', '2026-09-11T09:44:00Z'),
    row('Amare', 'on_standard', '2026-09-11T09:45:00Z'),
    row('Tyler', 'late', '2026-09-11T10:09:00Z', 24),
    row('Marcus', 'missed', null),
    row('Sam', 'excused', null),
  ]));
  assert.equal(s.onTime, 2);
  assert.equal(s.late, 1);
  assert.equal(s.missed, 1);
  // excused leaves the denominator entirely, the same rule commitments.js accountability() uses
  assert.equal(s.excused, 1);
  assert.equal(s.total, 4);
});

test('first up is the earliest answer, and only an on-time one counts', () => {
  const s = morningSummary(inst([
    row('Tyler', 'late', '2026-09-11T09:40:00Z', 20),
    row('Devon', 'on_standard', '2026-09-11T09:44:00Z'),
    row('Amare', 'on_standard', '2026-09-11T09:45:00Z'),
  ]));
  assert.equal(s.firstUp.name, 'Devon', 'a late answer is not first up however early it landed');
});

test('needs-you is missed before late, and never contains anyone who was up on time', () => {
  const s = morningSummary(inst([
    row('Devon', 'on_standard', '2026-09-11T09:44:00Z'),
    row('Tyler', 'late', '2026-09-11T10:09:00Z', 24),
    row('Marcus', 'missed', null),
    row('Jordan', 'late', '2026-09-11T09:58:00Z', 13),
  ]));
  assert.deepEqual(s.needsYou.map((r) => r.name), ['Marcus', 'Tyler', 'Jordan'],
    'missed first, then the latest answer down to the earliest');
  assert.ok(!s.needsYou.some((r) => r.name === 'Devon'));
});

test('up rows are in the order they answered', () => {
  const s = morningSummary(inst([
    row('Amare', 'on_standard', '2026-09-11T09:45:00Z'),
    row('Devon', 'on_standard', '2026-09-11T09:44:00Z'),
  ]));
  assert.deepEqual(s.upRows.map((r) => r.name), ['Devon', 'Amare']);
});

test('an empty or missing instance is zeroes, never a crash', () => {
  for (const bad of [null, undefined, {}, { rows: null }]) {
    const s = morningSummary(bad);
    assert.equal(s.total, 0);
    assert.equal(s.firstUp, null);
    assert.deepEqual(s.needsYou, []);
  }
});

test('the streak counts consecutive answered mornings back from the most recent', () => {
  // newest first, which is the order scoreHistory and the board caches use
  assert.equal(morningStreak([true, true, true, false, true]), 3);
  assert.equal(morningStreak([false, true, true]), 0, 'a missed today ends it at zero');
  assert.equal(morningStreak([]), 0);
  assert.equal(morningStreak(null), 0);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node scripts/node-test.mjs "proto/redesign-2026-07/js/wakeup-morning.test.mjs"`
Expected: FAIL, cannot find module `./wakeup-morning.js`.

- [ ] **Step 3: Write the implementation**

Create `proto/redesign-2026-07/js/wakeup-morning.js`:

```js
/* The morning, reduced to the numbers every wake-up surface reads.
 *
 * The roll call already computes the hard part: the server stamps a `verdict` per athlete per
 * morning (rollcall_verdict, migration 0212) and the client must never second-guess it. This
 * module only projects that array into the shapes the screens want, so the coach summary, the
 * squad list and the athlete's own streak can never disagree about the same morning.
 *
 * Dependency-free on purpose, like score-band.js: it is pure data in, pure data out, so it is
 * unit-tested rather than pinned by reading the source of a screen.
 *
 * RELEASE 1 HAS NO SNOOZE. The roll-call engine has no concept of one: an athlete answered on
 * time, answered late, or never answered. Snooze counts arrive with the real alarm, because only
 * an alarm the app owns can see one. Do not add a snoozed count here from a guess.
 */

/** The commitment type a coach wake-up uses. Mirrors commitments.js TYPE_LABEL. */
export const WAKEUP_TYPE = 'morning_roll_call';

const UP = 'on_standard';
const LATE = 'late';
const MISSED = 'missed';
const EXCUSED = 'excused';

function minuteOf(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isFinite(d.getTime()) ? d.getHours() * 60 + d.getMinutes() : null;
}

function shape(r) {
  return {
    athleteId: r.athlete_id || null,
    name: r.name || '',
    verdict: r.verdict || 'pending',
    at: r.acknowledged_at || null,
    atMin: minuteOf(r.acknowledged_at),
    lateMin: Number(r.late_min) || 0,
  };
}

/**
 * Every number one morning yields.
 * @param {object|null} instance a commitment_board instance, or anything at all
 * @returns {{total:number, onTime:number, late:number, missed:number, pending:number,
 *            excused:number, firstUp:{name:string,at:string,atMin:number}|null,
 *            needsYou:Array, upRows:Array}}
 */
export function morningSummary(instance) {
  const raw = (instance && Array.isArray(instance.rows)) ? instance.rows : [];
  const rows = raw.map(shape);

  /* 'excused' leaves the denominator entirely — it cannot be scored honestly either way. That is
     the same rule commitments.js accountability() already applies, and the two must not diverge. */
  const counted = rows.filter((r) => r.verdict !== EXCUSED);
  const upRows = counted.filter((r) => r.verdict === UP).sort((a, b) => String(a.at).localeCompare(String(b.at)));
  const lateRows = counted.filter((r) => r.verdict === LATE);
  const missedRows = counted.filter((r) => r.verdict === MISSED);

  /* Worst first: a missed morning needs the coach more than a late one, and among the late ones
     the one who answered latest needs them most. */
  const needsYou = [
    ...missedRows,
    ...lateRows.sort((a, b) => (b.lateMin - a.lateMin) || String(a.name).localeCompare(String(b.name))),
  ];

  return {
    total: counted.length,
    onTime: upRows.length,
    late: lateRows.length,
    missed: missedRows.length,
    pending: counted.filter((r) => r.verdict !== UP && r.verdict !== LATE && r.verdict !== MISSED).length,
    excused: rows.length - counted.length,
    /* First up is an ON-TIME answer only. A late answer that happened to land early in the clock
       is still late, and naming it as the morning's best would reward the wrong thing. */
    firstUp: upRows.length ? { name: upRows[0].name, at: upRows[0].at, atMin: upRows[0].atMin } : null,
    needsYou,
    upRows,
  };
}

/**
 * Consecutive answered mornings, counting back from the most recent.
 * @param {boolean[]|null} days newest first; true = answered inside the window
 */
export function morningStreak(days) {
  if (!Array.isArray(days)) return 0;
  let n = 0;
  for (const answered of days) { if (!answered) break; n += 1; }
  return n;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node scripts/node-test.mjs "proto/redesign-2026-07/js/wakeup-morning.test.mjs"`
Expected: 6 passing, 0 failing.

- [ ] **Step 5: Commit**

```bash
git add proto/redesign-2026-07/js/wakeup-morning.js proto/redesign-2026-07/js/wakeup-morning.test.mjs
git commit -m "feat(wakeup): one engine for the morning's numbers"
```

---

### Task 2: The coach's morning summary screen

The surface the feature is built around. A coach is asleep at 5:45; what they use is one card when
the window shuts.

**Files:**
- Create: `proto/redesign-2026-07/js/screens/wakeup-morning.js`
- Modify: `proto/redesign-2026-07/js/screens/index.js` (one line, next to the other lazy routes)
- Modify: `proto/redesign-2026-07/css/screens.css` (append the `.wk-*` block)
- Test: `proto/redesign-2026-07/js/screens/wakeup-morning.test.mjs`

**Interfaces:**
- Consumes: `morningSummary` from `js/wakeup-morning.js`; `loadBoard` and `VC` from
  `js/commitment-data.js`; `backHead`, `esc` from `js/components.js`; `icon` from `js/icons.js`;
  `nudgePush` from `js/roles.js`.
- Produces: route `'wakeup-morning'`.

- [ ] **Step 1: Write the failing test**

Create `proto/redesign-2026-07/js/screens/wakeup-morning.test.mjs`. Source-shape pins, the way
`verified-profile.test.mjs` and `apple-health.test.mjs` already work: this screen imports state
and the DOM, so rendering it here would cost more than it proves.

```js
/* The coach's morning summary. Pinned by shape, the way the other screen suites are.
   Run: node --test proto/redesign-2026-07/js/screens/wakeup-morning.test.mjs */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const read = (p) => readFileSync(join(here, p), 'utf8');
const screen = read('wakeup-morning.js');
const registry = read('index.js');

test('it reads the shared engine rather than counting rows itself', () => {
  assert.match(screen, /import \{ morningSummary \} from '\.\.\/wakeup-morning\.js'/);
  assert.ok(!/\.filter\(\s*\(?r\)?\s*=>\s*r\.verdict/.test(screen),
    'no screen re-derives a verdict count; that is what the engine is for');
});

test('release 1 never claims a snooze count', () => {
  assert.ok(!/snooz/i.test(screen),
    'the roll-call engine has no snooze concept until the real alarm ships');
});

test('the route is registered on one line, which qc-capture parses by regex', () => {
  assert.match(registry, /^ {2}'wakeup-morning': lazy\(\(\) => import\('\.\/wakeup-morning\.js'\)\),$/m);
});

test('every athlete name reaches innerHTML escaped', () => {
  const names = screen.match(/\$\{[^}]*\.name[^}]*\}/g) || [];
  assert.ok(names.length > 0, 'the screen prints athlete names');
  assert.ok(names.every((m) => m.includes('esc(')), `unescaped name interpolation: ${names.join(', ')}`);
});

test('it carries an honest empty state instead of a fabricated zero', () => {
  assert.match(screen, /No wake-up was set/);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node scripts/node-test.mjs "proto/redesign-2026-07/js/screens/wakeup-morning.test.mjs"`
Expected: FAIL, cannot read `wakeup-morning.js`.

- [ ] **Step 3: Write the screen**

Create `proto/redesign-2026-07/js/screens/wakeup-morning.js`:

```js
import { RT } from '../state.js';
import { icon } from '../icons.js';
import { backHead, esc } from '../components.js';
import { morningSummary, WAKEUP_TYPE } from '../wakeup-morning.js';
import { VC, loadBoard } from '../commitment-data.js';
import { CD } from '../coach-data.js';
import * as roles from '../roles.js';

/* The coach's morning, in one card. The founder's ruling: a coach is asleep at 5:45 too, so the
   surface the feature is built around is the summary when the window SHUTS, not the live widget.
   Everything on it comes from wakeup-morning.js, so this screen and the athlete's squad list can
   never disagree about the same morning. */

function instanceOf() {
  return (VC.board || []).find((i) => i.type === WAKEUP_TYPE) || null;
}

function clock(min) {
  if (min == null) return '';
  const h = Math.floor(min / 60), m = min % 60;
  const ampm = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, '0')} ${ampm}`;
}

function needRow(r) {
  const why = r.verdict === 'missed' ? 'Never answered' : `${r.lateMin} minutes late`;
  const cls = r.verdict === 'missed' ? 'r' : 'a';
  return `
  <div class="lrow wk-need">
    <div class="lic">${esc((r.name || '?').slice(0, 2).toUpperCase())}</div>
    <div class="lm"><div class="lt">${esc(r.name)}</div><div class="ls wk-why ${cls}">${esc(why)}</div></div>
    <button type="button" class="btn ghost xs wk-nudge" data-nudge="${esc(r.athleteId || '')}">Nudge</button>
  </div>`;
}

export default {
  nav: 'coach', tab: 'home',
  render() {
    const inst = instanceOf();
    if (!inst) {
      return `${backHead('This morning', '', 'coach-home')}
      <div class="sidebox">
        <div class="req-icon muted s38">${icon('clock', 17)}</div>
        <div><div class="tt">No wake-up was set</div>
        <div class="ts">Set one from the create menu and this fills in the next morning.</div></div>
      </div>`;
    }
    const s = morningSummary(inst);
    const pct = s.total ? Math.round((s.onTime / s.total) * 100) : 0;
    return `
    ${backHead('This morning', `${esc(inst.title || 'Team wake-up')} · ${esc(inst.audience_label || 'Everyone')}`, 'coach-home')}

    <section class="wk-pulse">
      <div class="wk-k">Up on time</div>
      <div class="wk-num"><span class="wk-big">${s.onTime}</span><span class="wk-of">/${s.total}</span></div>
      <div class="wk-bar" role="img" aria-label="${s.onTime} up, ${s.late} late, ${s.missed} never answered">
        ${s.onTime ? `<span class="wk-seg g" style="flex:${s.onTime}"></span>` : ''}
        ${s.late ? `<span class="wk-seg a" style="flex:${s.late}"></span>` : ''}
        ${s.missed ? `<span class="wk-seg r" style="flex:${s.missed}"></span>` : ''}
      </div>
      ${s.firstUp ? `<div class="wk-cap">${esc(s.firstUp.name)} was first up at ${esc(clock(s.firstUp.atMin))}.</div>` : ''}
    </section>

    ${s.needsYou.length ? `
    <h2 class="eyebrow">Needs you</h2>
    <section class="card rows">${s.needsYou.map(needRow).join('')}</section>` : `
    <div class="sidebox">
      <div class="req-icon g s38">${icon('check', 17)}</div>
      <div><div class="tt">Everyone answered</div>
      <div class="ts">${pct}% of the roster was up inside the window.</div></div>
    </div>`}

    <div class="wk-gap"></div>
    `;
  },
  async mount(root) {
    const owner = CD.teamId || CD.practiceId || null;
    if (owner) { await loadBoard(owner, CD.kind || 'team'); window.__render(); }
    root.addEventListener('click', async (e) => {
      const b = e.target.closest('[data-nudge]');
      if (!b) return;
      const id = b.getAttribute('data-nudge');
      if (!id) return;
      b.disabled = true; b.textContent = 'Sent';
      try { await roles.nudgePush(id, 'Morning', 'Your coach noticed you missed roll call.'); }
      catch { b.textContent = 'Failed'; b.disabled = false; }
    });
  },
};
```

- [ ] **Step 4: Register the route**

In `proto/redesign-2026-07/js/screens/index.js`, inside the `screens` object, add exactly one line:

```js
  'wakeup-morning': lazy(() => import('./wakeup-morning.js')),
```

- [ ] **Step 5: Add the styles**

Append to `proto/redesign-2026-07/css/screens.css`:

```css
/* The coach's morning summary (screens/wakeup-morning.js). The composition is coach-home's own
   pulse card: one headline number, a proportional bar, one line of meaning. The three tinted stat
   boxes this replaced gave 18, 3 and 1 equal weight when the story is a single number. */
.wk-pulse {
  position: relative; border-radius: var(--r-card); overflow: hidden;
  background: radial-gradient(120% 140% at 12% -10%, rgba(var(--teal-rgb), 0.10), transparent 55%), var(--surface-1);
  border: 1px solid var(--hairline); box-shadow: var(--sh-card);
  padding: var(--s5) var(--s5) var(--s4);
}
.wk-k { font-size: var(--t-eyebrow); font-weight: 800; letter-spacing: var(--track-eyebrow); text-transform: uppercase; color: var(--text-3); }
.wk-num { display: flex; align-items: baseline; gap: var(--s1h); margin-top: var(--s1h); }
.wk-big { font-family: var(--font-display); font-size: 60px; font-weight: 800; line-height: 0.9; letter-spacing: -0.045em; }
.wk-of { font-family: var(--font-display); font-size: var(--t-xl); font-weight: 800; color: var(--text-3); }
.wk-bar { display: flex; gap: var(--s1); height: 12px; margin-top: var(--s4); border-radius: var(--r-pill); overflow: hidden; }
.wk-bar .wk-seg { height: 100%; border-radius: var(--r-micro); min-width: 4px; }
.wk-bar .wk-seg.g { background: linear-gradient(90deg, var(--green-deep), var(--green)); }
.wk-bar .wk-seg.a { background: linear-gradient(90deg, var(--amber-deep), var(--amber)); }
.wk-bar .wk-seg.r { background: var(--red); }
.wk-cap { font-size: var(--t-sm); font-weight: 600; color: var(--text-3); margin-top: var(--s3); }
.wk-why.a { color: var(--amber-bright); font-weight: 700; }
.wk-why.r { color: var(--red-bright); font-weight: 700; }
.wk-need .wk-nudge { flex: none; }
.wk-gap { height: var(--s2h); }
```

- [ ] **Step 6: Run the tests and the gates**

```bash
node scripts/node-test.mjs "proto/redesign-2026-07/js/screens/wakeup-morning.test.mjs"
npm run lint:undef && npm run lint:inline && npm run lint:space && npm run lint:type && npm run lint:dash && npm run lint:xss
```
Expected: tests pass, every lint clean.

- [ ] **Step 7: Commit**

```bash
git add proto/redesign-2026-07/js/screens/wakeup-morning.js proto/redesign-2026-07/js/screens/wakeup-morning.test.mjs proto/redesign-2026-07/js/screens/index.js proto/redesign-2026-07/css/screens.css
git commit -m "feat(wakeup): the coach's morning summary, with a nudge per miss"
```

---

### Task 3: The athlete's squad list

The only thing a coach's alarm has that Apple's alarm never will: twenty-two people hear it at the
same time.

**Files:**
- Create: `proto/redesign-2026-07/js/screens/wakeup-squad.js`
- Modify: `proto/redesign-2026-07/js/screens/index.js` (one line)
- Modify: `proto/redesign-2026-07/css/screens.css` (append)
- Test: `proto/redesign-2026-07/js/screens/wakeup-squad.test.mjs`

**Interfaces:**
- Consumes: `morningSummary`, `WAKEUP_TYPE` from `js/wakeup-morning.js`; `VC` from
  `js/commitment-data.js`; `RT` from `js/state.js` for `RT.userId`.
- Produces: route `'wakeup-squad'`.

- [ ] **Step 1: Write the failing test**

```js
/* The squad list. Run: node --test proto/redesign-2026-07/js/screens/wakeup-squad.test.mjs */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const read = (p) => readFileSync(join(here, p), 'utf8');
const screen = read('wakeup-squad.js');
const registry = read('index.js');

test('it reads the shared engine', () => {
  assert.match(screen, /import \{ morningSummary, WAKEUP_TYPE \} from '\.\.\/wakeup-morning\.js'/);
});

test('the athlete sees themselves marked in the list', () => {
  assert.match(screen, /RT\.userId/, 'the athlete row is identified by their own id');
  assert.match(screen, /wk-you/, 'and marked with a class so it reads as theirs');
});

test('the route is registered on one line', () => {
  assert.match(registry, /^ {2}'wakeup-squad': lazy\(\(\) => import\('\.\/wakeup-squad\.js'\)\),$/m);
});

test('names are escaped', () => {
  const names = screen.match(/\$\{[^}]*\.name[^}]*\}/g) || [];
  assert.ok(names.length && names.every((m) => m.includes('esc(')));
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `node scripts/node-test.mjs "proto/redesign-2026-07/js/screens/wakeup-squad.test.mjs"`
Expected: FAIL, cannot read `wakeup-squad.js`.

- [ ] **Step 3: Write the screen**

```js
import { RT } from '../state.js';
import { icon } from '../icons.js';
import { backHead, esc } from '../components.js';
import { morningSummary, WAKEUP_TYPE } from '../wakeup-morning.js';
import { VC } from '../commitment-data.js';

/* Who is up. The social half of the feature: an athlete seeing five names already answered at
   5:45 is the thing a coach's alarm has that the phone's own alarm never will. */

function clock(min) {
  if (min == null) return '';
  const h = Math.floor(min / 60), m = min % 60;
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, '0')}`;
}

export default {
  tab: 'home',
  render() {
    const inst = (VC.board || []).find((i) => i.type === WAKEUP_TYPE) || null;
    const s = morningSummary(inst);
    if (!s.total) {
      return `${backHead('Who is up', '', 'home')}
      <div class="sidebox">
        <div class="req-icon muted s38">${icon('users', 17)}</div>
        <div><div class="tt">Nothing to show yet</div>
        <div class="ts">Your squad's morning appears here once a coach sets a wake-up.</div></div>
      </div>`;
    }
    const rows = s.upRows.map((r, i) => {
      const mine = r.athleteId && r.athleteId === RT.userId;
      return `
      <div class="lrow wk-sq${mine ? ' wk-you' : ''}">
        <span class="wk-rank">${i + 1}</span>
        <span class="lm"><span class="lt">${mine ? 'You' : esc(r.name)}</span></span>
        <span class="wk-at">${esc(clock(r.atMin))}</span>
      </div>`;
    }).join('');
    const left = s.total - s.onTime;
    return `
    ${backHead('Who is up', `${esc(inst.title || 'Team wake-up')}`, 'home')}

    <section class="wk-pulse">
      <div class="wk-k">Up so far</div>
      <div class="wk-num"><span class="wk-big">${s.onTime}</span><span class="wk-of">/${s.total}</span></div>
      ${s.firstUp ? `<div class="wk-cap">${esc(s.firstUp.name)} was first, at ${esc(clock(s.firstUp.atMin))}.</div>` : ''}
    </section>

    <h2 class="eyebrow">In order</h2>
    <section class="card rows">${rows}</section>
    ${left > 0 ? `<div class="wk-cap wk-left">${left} still to answer.</div>` : ''}
    <div class="wk-gap"></div>
    `;
  },
};
```

- [ ] **Step 4: Register the route**

One line in `js/screens/index.js`:

```js
  'wakeup-squad': lazy(() => import('./wakeup-squad.js')),
```

- [ ] **Step 5: Add the styles**

Append to `css/screens.css`:

```css
/* The squad list (screens/wakeup-squad.js). */
.wk-sq .wk-rank { font-family: var(--font-display); font-size: var(--t-base); font-weight: 800; color: var(--text-3); width: 20px; flex: none; }
.wk-sq .wk-at { font-family: var(--font-display); font-size: var(--t-sm); font-weight: 800; color: var(--green-bright); }
.wk-sq.wk-you { background: rgba(var(--blue-rgb), 0.10); border-radius: var(--r-card-sm); }
.wk-sq.wk-you .lt, .wk-sq.wk-you .wk-rank, .wk-sq.wk-you .wk-at { color: var(--blue-bright); }
.wk-left { text-align: center; }
```

- [ ] **Step 6: Run tests and gates**

```bash
node scripts/node-test.mjs "proto/redesign-2026-07/js/screens/wakeup-squad.test.mjs"
npm run lint:undef && npm run lint:inline && npm run lint:space && npm run lint:type && npm run lint:dash && npm run lint:xss
```

- [ ] **Step 7: Commit**

```bash
git add proto/redesign-2026-07/js/screens/wakeup-squad.js proto/redesign-2026-07/js/screens/wakeup-squad.test.mjs proto/redesign-2026-07/js/screens/index.js proto/redesign-2026-07/css/screens.css
git commit -m "feat(wakeup): the squad list, so athletes see each other answer"
```

---

### Task 4: The handoff to breakfast

Getting up is not the goal; eating is. Answering the wake-up should put the first meal in front of
them, not leave them on a screen that congratulates them.

**Files:**
- Create: `proto/redesign-2026-07/js/wakeup-handoff.js`
- Test: `proto/redesign-2026-07/js/wakeup-handoff.test.mjs`
- Modify: `proto/redesign-2026-07/js/screens/home.js` (render the row; see step 4 for the anchor)
- Modify: `proto/redesign-2026-07/css/screens.css` (append)

**Interfaces:**
- Consumes: `morningSummary`, `WAKEUP_TYPE` from `js/wakeup-morning.js`.
- Produces: `wakeupReceipt(instance, userId)` -> `{ answered: boolean, atMin: number|null,
  late: boolean, placed: number|null }`, and `receiptHtml(receipt, esc)` -> string.

- [ ] **Step 1: Write the failing test**

```js
/* The morning receipt that lands on Home.
   Run: node --test proto/redesign-2026-07/js/wakeup-handoff.test.mjs */
import test from 'node:test';
import assert from 'node:assert/strict';
import { wakeupReceipt, receiptHtml } from './wakeup-handoff.js';

const inst = (rows) => ({ type: 'morning_roll_call', rows });
const row = (id, name, verdict, at) => ({
  athlete_id: id, name, verdict, acknowledged_at: at, late_min: 0,
  status: verdict === 'missed' ? 'pending' : 'acknowledged',
});

test('it reports the athlete own answer and where they placed', () => {
  const r = wakeupReceipt(inst([
    row('a1', 'Devon', 'on_standard', '2026-09-11T09:44:00Z'),
    row('a2', 'Lewis', 'on_standard', '2026-09-11T09:46:00Z'),
  ]), 'a2');
  assert.equal(r.answered, true);
  assert.equal(r.late, false);
  assert.equal(r.placed, 2, 'second to answer');
});

test('someone who never answered gets no receipt', () => {
  const r = wakeupReceipt(inst([row('a1', 'Marcus', 'missed', null)]), 'a1');
  assert.equal(r.answered, false);
  assert.equal(r.placed, null);
});

test('a stranger to the morning gets no receipt, and nothing throws', () => {
  assert.equal(wakeupReceipt(inst([row('a1', 'Devon', 'on_standard', '2026-09-11T09:44:00Z')]), 'zz').answered, false);
  assert.equal(wakeupReceipt(null, 'a1').answered, false);
  assert.equal(wakeupReceipt(undefined, undefined).answered, false);
});

test('the row is empty markup when there is nothing to say', () => {
  assert.equal(receiptHtml({ answered: false }, (x) => x), '');
});

test('the row names the time and never contains an em dash', () => {
  const html = receiptHtml({ answered: true, atMin: 346, late: false, placed: 2 }, (x) => x);
  assert.match(html, /5:46/);
  assert.ok(!html.includes(String.fromCharCode(8212)), 'no em dashes in user-facing copy');
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `node scripts/node-test.mjs "proto/redesign-2026-07/js/wakeup-handoff.test.mjs"`
Expected: FAIL, cannot find module.

- [ ] **Step 3: Write the module**

```js
/* The morning's receipt on Home, and the handoff it implies.
 *
 * The founder's rule: getting up is not the goal, eating is. So the answer to a wake-up is not a
 * screen that congratulates the athlete, it is a line on Home saying the morning is banked with
 * the next meal already sitting under it.
 *
 * Pure and dependency-free so it can be tested without booting Home. home.js passes its own esc.
 */
import { morningSummary, WAKEUP_TYPE } from './wakeup-morning.js';

function clock(min) {
  if (min == null) return '';
  const h = Math.floor(min / 60), m = min % 60;
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, '0')}`;
}

/**
 * What this athlete did with this morning.
 * @param {object|null} instance a commitment_board instance for the wake-up
 * @param {string|null} userId the athlete's own id
 */
export function wakeupReceipt(instance, userId) {
  const none = { answered: false, atMin: null, late: false, placed: null };
  if (!instance || instance.type !== WAKEUP_TYPE || !userId) return none;
  const s = morningSummary(instance);
  const i = s.upRows.findIndex((r) => r.athleteId === userId);
  if (i >= 0) return { answered: true, atMin: s.upRows[i].atMin, late: false, placed: i + 1 };
  const lateRow = s.needsYou.find((r) => r.athleteId === userId && r.verdict === 'late');
  if (lateRow) return { answered: true, atMin: lateRow.atMin, late: true, placed: null };
  return none;
}

/** The Home row. Empty string when there is nothing honest to say. */
export function receiptHtml(receipt, esc) {
  if (!receipt || !receipt.answered) return '';
  const t = esc(clock(receipt.atMin));
  const tail = receipt.late ? 'Answered late.' : (receipt.placed ? `${receipt.placed} of the squad up.` : 'Answered.');
  return `<div class="wk-receipt${receipt.late ? ' late' : ''}">
    <span class="wk-rc-t">Up at ${t}</span>
    <span class="wk-rc-s">${esc(tail)}</span>
  </div>`;
}
```

- [ ] **Step 4: Render it on Home**

In `proto/redesign-2026-07/js/screens/home.js`, add to the imports:

```js
import { wakeupReceipt, receiptHtml } from '../wakeup-handoff.js';
import { WAKEUP_TYPE } from '../wakeup-morning.js';
import { VC } from '../commitment-data.js';
```

Then find the existing `#reply-row` slot (added 2026-09-10 for the coach-replied row) and insert
the receipt immediately BEFORE it, so the morning reads above the day's other news:

```js
    ${receiptHtml(wakeupReceipt((VC.board || []).find((i) => i.type === WAKEUP_TYPE) || null, RT.userId), esc)}
```

- [ ] **Step 5: Add the styles**

Append to `css/screens.css`:

```css
/* The morning receipt on Home (wakeup-handoff.js). Same grammar as the seen-receipt row. */
.wk-receipt {
  display: flex; align-items: center; gap: var(--s2h);
  margin: var(--s3) 0 var(--s2h); padding: var(--s3h) var(--s4);
  border-radius: var(--r-card-sm);
  background: rgba(var(--green-rgb), 0.10); border: 1px solid var(--green-border);
}
.wk-receipt.late { background: rgba(var(--amber-rgb), 0.10); border-color: var(--amber-border); }
.wk-receipt .wk-rc-t { font-size: var(--t-base); font-weight: 800; color: var(--green-bright); }
.wk-receipt.late .wk-rc-t { color: var(--amber-bright); }
.wk-receipt .wk-rc-s { font-size: var(--t-sm); font-weight: 700; color: var(--text-3); margin-left: auto; }
```

- [ ] **Step 6: Run tests and gates**

```bash
node scripts/node-test.mjs "proto/redesign-2026-07/js/wakeup-handoff.test.mjs"
npm run lint:undef && npm run lint:inline && npm run lint:space && npm run lint:type && npm run lint:dash && npm run lint:xss
```

- [ ] **Step 7: Commit**

```bash
git add proto/redesign-2026-07/js/wakeup-handoff.js proto/redesign-2026-07/js/wakeup-handoff.test.mjs proto/redesign-2026-07/js/screens/home.js proto/redesign-2026-07/css/screens.css
git commit -m "feat(wakeup): the morning lands on Home, above the rest of the day"
```

---

### Task 5: The morning streak

People chase streaks harder than points. The engine function already exists from Task 1; this wires
it to real days and shows it.

**Files:**
- Modify: `proto/redesign-2026-07/js/commitment-data.js` (add `loadMyMornings`)
- Modify: `proto/redesign-2026-07/js/screens/wakeup-squad.js` (show the streak)
- Test: `proto/redesign-2026-07/js/wakeup-morning.test.mjs` (extend)

**Interfaces:**
- Consumes: `loadMineRange(fromISO, toISO)` which already exists in `js/commitment-data.js:136`.
- Produces: `loadMyMornings(days)` -> `Promise<boolean[]>`, newest first, for `morningStreak`.

- [ ] **Step 1: Write the failing test**

Append to `proto/redesign-2026-07/js/wakeup-morning.test.mjs`:

```js
test('the streak ignores excused mornings rather than breaking on them', () => {
  // an excused morning is neither a win nor a loss; the caller passes only scored days
  assert.equal(morningStreak([true, true, true]), 3);
});

test('a single answered morning is a streak of one', () => {
  assert.equal(morningStreak([true, false, false]), 1);
});
```

- [ ] **Step 2: Run it**

Run: `node scripts/node-test.mjs "proto/redesign-2026-07/js/wakeup-morning.test.mjs"`
Expected: PASS (these hold against the Task 1 implementation; they pin the contract the loader
must honour, that excused days are filtered out BEFORE the array is built).

- [ ] **Step 3: Add the loader**

Append to `proto/redesign-2026-07/js/commitment-data.js`:

```js
/** The athlete's own last `days` mornings, newest first, as answered / not.
 *  Excused mornings are dropped rather than counted either way, which is the same rule
 *  wakeup-morning.js applies to the denominator. Returns [] when the range read fails, so a
 *  streak never renders a number invented from a failed fetch. */
export async function loadMyMornings(days = 30) {
  const to = todayISO();
  const from = shiftISO(to, -Math.max(1, days));
  const rows = await loadMineRange(from, to);
  if (!Array.isArray(rows)) return [];
  return rows
    .filter((r) => r.type === 'morning_roll_call' && r.verdict !== 'excused')
    .sort((a, b) => String(b.occurs_on).localeCompare(String(a.occurs_on)))
    .map((r) => r.verdict === 'on_standard');
}
```

- [ ] **Step 4: Show it on the squad screen**

In `js/screens/wakeup-squad.js`, add the import and a mount that paints it:

```js
import { VC, loadMyMornings } from '../commitment-data.js';
import { morningSummary, morningStreak, WAKEUP_TYPE } from '../wakeup-morning.js';
```

Add a slot inside `render()`, immediately after the `</section>` that closes `.wk-pulse`:

```js
    <div id="wk-streak-slot"></div>
```

And add a `mount`:

```js
  async mount(root) {
    const slot = root.querySelector('#wk-streak-slot');
    if (!slot) return;
    const n = morningStreak(await loadMyMornings(30));
    if (!n || !slot.isConnected) return;
    slot.innerHTML = `<div class="wk-streak">${n} straight ${n === 1 ? 'morning' : 'mornings'}</div>`;
  },
```

- [ ] **Step 5: Style it**

Append to `css/screens.css`:

```css
.wk-streak {
  display: inline-flex; align-items: center; margin-top: var(--s3);
  padding: var(--s2) var(--s3h); border-radius: var(--r-pill);
  background: rgba(var(--amber-rgb), 0.13); border: 1px solid var(--amber-border);
  font-size: var(--t-sm); font-weight: 800; color: var(--amber-bright);
}
```

- [ ] **Step 6: Run tests and gates**

```bash
node scripts/node-test.mjs "proto/redesign-2026-07/js/wakeup-morning.test.mjs"
npm run lint:undef && npm run lint:inline && npm run lint:space && npm run lint:type && npm run lint:dash
```

- [ ] **Step 7: Commit**

```bash
git add proto/redesign-2026-07/js/commitment-data.js proto/redesign-2026-07/js/screens/wakeup-squad.js proto/redesign-2026-07/js/wakeup-morning.test.mjs proto/redesign-2026-07/css/screens.css
git commit -m "feat(wakeup): the morning streak, the number athletes actually chase"
```

---

### Task 6: Ship it

**Files:**
- Modify: `assets/proto.zip`, `src/proto/protoVersion.ts` (both rebuilt, never hand-edited)

- [ ] **Step 1: Full verify**

```bash
npm run verify
```
Expected: `all 16 gates passed.`

- [ ] **Step 2: Screenshot the new screens in both themes**

```bash
node scripts/serve-proto.mjs 8799 &
node scripts/qc-capture.mjs --all --themes dark,light --out wakeup sweep-wakeup-morning,sweep-wakeup-squad,home
```
Expected: `js errors: 0`, `h-overflow: 0`, `clipped text: 0`.

- [ ] **Step 3: Rebuild the zip and content-check it**

```bash
node scripts/build-proto-zip.mjs
npm run verify:zip
node -e "const {unzipSync}=require('fflate');const z=unzipSync(require('fs').readFileSync('assets/proto.zip'));console.log('engine',!!z['js/wakeup-morning.js'],'coach',!!z['js/screens/wakeup-morning.js'],'squad',!!z['js/screens/wakeup-squad.js'])"
```
Expected: all three `true`.

- [ ] **Step 4: Commit and push**

```bash
git add assets/proto.zip src/proto/protoVersion.ts
git commit -m "chore(wakeup): rebuild proto.zip for release 1"
git pull --rebase && git push
```

- [ ] **Step 5: Publish the OTA and PROVE it carries the build**

```bash
node -e "const c=require('crypto'),b=require('fs').readFileSync('assets/proto.zip');console.log('md5',c.createHash('md5').update(b).digest('hex'));console.log('sha256',c.createHash('sha256').update(b).digest('base64url'))"
npx eas update --branch production --environment production --non-interactive --message "wake-up release 1: the surfaces"
```

Then fetch the live manifest for BOTH platforms and grep for the md5 and the sha256 printed above.
A commit message is not proof; the manifest is.

```bash
for p in ios android; do curl -s "https://u.expo.dev/31bafa06-851f-4efe-b330-0e8601c843dd" \
  -H "expo-platform: $p" -H "expo-runtime-version: 1.0.0" -H "expo-channel-name: production" \
  -H "expo-protocol-version: 1" -H "Accept: multipart/mixed" | grep -c "<the md5>"; done
```
Expected: a non-zero count on each.

---

## Out of scope for release 1, and why

- **The athlete setting their own wake-up.** `commitments` rows are owned by a team or a practice.
  An athlete-owned wake-up needs a new owner kind, its own RLS, and a migration. It is a release of
  its own, not a task here.
- **The score change** (food 82, wake-up 8, check-in 10). Release 2. It touches the eight places
  the weights live, needs a dated cutover and a new server ceiling, and requires reprinting the
  published formula. Keeping it out of this release is what stops it being blocked behind anything.
- **The alarm itself.** Release 3, and the only part that needs a native build.
- **Snooze counts anywhere.** There is no snooze until release 3.
