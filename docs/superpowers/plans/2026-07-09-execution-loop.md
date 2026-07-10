# Execution Loop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One pure execution engine (`exec.js`) drives a redesigned execution-first Home (NOW card + celebration flip), the Action Hub dashboard, an intelligent FAB dot, and fully state-driven local notifications with auto-cancel.

**Architecture:** `exec.js` is a pure module (clock and state are arguments) returning one `ExecState`; `state.js` composes its inputs from the live day state and exposes `S.exec` plus a `syncNotifications()` action hooked into every completion. Home and the Action Hub render from `S.exec` with a 30-second tick; a new `NOTIFY_SYNC` bridge message hands the engine's notification plan to a native seam that cancels-then-reschedules expo-notifications date triggers.

**Tech Stack:** Vanilla JS ES modules (proto in WebView), Jest via proto-ESM imports (`obHelpers.test.ts` pattern), expo-notifications (native seam), React Native bridge (`src/proto/bridge.ts`).

**Spec:** `docs/superpowers/specs/2026-07-09-execution-loop-design.md` (approved 2026-07-09; visual preview approved).

## Global Constraints

- **Scoring is untouched** (DECISION-MEMO D3): exec reads day-state and existing projections; it never writes or re-implements score math.
- 4-state status color on execution surfaces: **gold = ready/due_soon, green = done/done_late, gray = locked/upcoming, red = overdue**. Category identity only via icon glyphs/labels. Never color alone — every state also reads via pill text + icon.
- Due-soon threshold: **90 minutes**. UI tick: **30 seconds**, re-render only when derived output changed. NOW selection priority: overdue (earliest due) → due_soon (nearest due) → ready required (earliest due) → assigned (undated) — optional items never become NOW; `now = null` when celebration.
- Pressure mapping (display string → engine value): "Remind me gently" → `gentle` (one nudge, due−30) · "Hold me accountable"/default → `accountable` (due−45 + at due) · "Max pressure" → `max` (window open + due−45 + at due). Plan contains only incomplete required timed items with fire times strictly in the future; weight copy is trend-only/no-shame; celebration note is immediate and skipped on `gentle`.
- **Weekly Check-In is untracked in v1** (its completion isn't wired): it appears in the Action Hub's Forms group ONLY on Sundays as a navigational row, and never enters met/total or the notification plan. Hydration (optional) never notifies.
- Legacy static reminders are retired: `app/_layout.tsx` stops calling `initReminders()`; NOTIFY_SYNC becomes the only scheduler (so `cancelAllScheduledNotificationsAsync` before rescheduling is safe).
- Proto conventions: screens `{ tab?, hideTabs?, bleed?, render({sub}), mount(root)? }`; navigation `data-go`, actions `data-act`/`data-then`; server/user-traceable strings through `esc` from `components.js`; `prefers-reduced-motion` degrades animations to fades/instant.
- Verify after each task: `npm run typecheck && npm run test` (must stay green; currently 130 suites / 1597 tests). Commit at the end of every task. Working dir: `c:\Users\Administrator\Downloads\athleteos`.

---

### Task 1: The execution engine (`exec.js`) + fake-clock test suite

**Files:**
- Create: `proto/redesign-2026-07/js/exec.js`
- Test: `src/core/exec.test.ts`

**Interfaces:**
- Consumes: `CATALOG`, `runsToday(req, dow)`, `fmtMin(min)` from `./requirements.js` (existing, unchanged).
- Produces (later tasks rely on these exact names):
  - `deriveExec(input) → ExecState` where `input = { nowMin, dow, status, assigned?, pressure?, score?, possible?, streak? }` and `status = { breakfast|lunch|dinner: {done,late,at?}, weight: {done,late?}, hydration: {oz}, recovery: {done,at?} }` (`at` is a display string like `'8:14 AM'`).
  - `ExecState = { items[], now, next, later[], doneItems[], overdue[], met, total, score, possible, celebration, plan[] }`. Each item: `{ id, title, icon, state, color, pill, minsLeft, countdown, dueLabel, why, sub, route, required, tracked }`. Plan item: `{ id, fireAtMin, immediate, title, body }`.
  - `mapPressure(label) → 'gentle'|'accountable'|'max'`, `fmtCountdown(mins) → string`, `samePlan(a, b) → boolean`.

- [ ] **Step 1: Write the failing test**

Create `src/core/exec.test.ts`:

```ts
// Proto is plain ESM JS (allowJs) — same import pattern as obHelpers.test.ts.
// @ts-ignore
import { deriveExec, mapPressure, fmtCountdown, samePlan } from '../../proto/redesign-2026-07/js/exec.js';

const FRESH = {
  breakfast: { done: false, late: false }, lunch: { done: false, late: false },
  dinner: { done: false, late: false }, weight: { done: false },
  hydration: { oz: 0 }, recovery: { done: false },
};
const at = (nowMin: number, over: object = {}, extra: object = {}) =>
  deriveExec({ nowMin, dow: 5, status: { ...FRESH, ...over }, ...extra }); // Friday = weight day

describe('item state boundaries', () => {
  const get = (e: any, id: string) => e.items.find((i: any) => i.id === id);
  test('locked before window opens', () => expect(get(at(6 * 60), 'breakfast').state).toBe('locked'));
  test('due_soon exactly 90 min out', () => expect(get(at(10 * 60 - 90), 'breakfast').state).toBe('due_soon'));
  test('ready at 91 min out', () => expect(get(at(10 * 60 - 91), 'breakfast').state).toBe('ready'));
  test('overdue one minute past due', () => expect(get(at(10 * 60 + 1), 'breakfast').state).toBe('overdue'));
  test('done beats time', () =>
    expect(get(at(11 * 60, { breakfast: { done: true, late: true } }), 'breakfast').state).toBe('done_late'));
  test('colors follow the 4-state mapping', () => {
    const e = at(10 * 60 + 1, { lunch: { done: true, late: false } });
    expect(get(e, 'breakfast').color).toBe('red');
    expect(get(e, 'lunch').color).toBe('green');
    expect(get(e, 'dinner').color).toBe('gray');
  });
  test('countdown formats', () => {
    expect(fmtCountdown(47)).toBe('47 min');
    expect(fmtCountdown(132)).toBe('2:12');
  });
});

describe('NOW selection priority', () => {
  test('overdue beats due_soon; earliest due wins across overdue', () => {
    const e = at(14 * 60 + 30); // weight (9:00), breakfast (10:00), lunch (2:00) all overdue
    expect(e.overdue.map((o: any) => o.id)).toEqual(['weight', 'breakfast', 'lunch']);
    expect(e.now.id).toBe('weight');
  });
  test('due_soon beats ready', () => {
    const done = { breakfast: { done: true, late: false }, lunch: { done: true, late: false }, weight: { done: true } };
    const e = at(19 * 60, done); // dinner due 20:00 (due_soon), recovery due 23:30 (ready)
    expect(e.now.id).toBe('dinner');
    expect(e.next.id).toBe('recovery');
  });
  test('optional hydration never becomes NOW while required items open', () => {
    const e = at(19 * 60, { breakfast: { done: true }, lunch: { done: true }, weight: { done: true } });
    expect(e.now.id).not.toBe('hydration');
  });
  test('assigned (undated) chosen only after timed required', () => {
    const e = at(19 * 60,
      { breakfast: { done: true }, lunch: { done: true }, weight: { done: true } },
      { assigned: [{ id: 'rehab', title: 'Rehab · band work', icon: 'bolt', note: 'wk 2', from: 'AT', dueLabel: 'Before practice', done: false, seen: true }] });
    expect(e.now.id).toBe('dinner');
    expect([e.next.id, ...e.later.map((l: any) => l.id)]).toContain('rehab');
  });
});

describe('groups + progress + celebration', () => {
  const ALLDONE = {
    breakfast: { done: true }, lunch: { done: true }, dinner: { done: true },
    weight: { done: true }, hydration: { oz: 124 }, recovery: { done: true },
  };
  test('met/total counts required only (Friday: 3 meals + weight + recovery = 5)', () => {
    const e = at(19 * 60, { breakfast: { done: true }, lunch: { done: true } });
    expect(e.total).toBe(5);
    expect(e.met).toBe(2); // weight not done yet
  });
  test('weight not required on Tuesday', () =>
    expect(deriveExec({ nowMin: 19 * 60, dow: 2, status: FRESH }).total).toBe(4));
  test('celebration only when every required item done; now null', () => {
    const e = at(22 * 60, ALLDONE, { score: 92, streak: 7 });
    expect(e.celebration).toBe(true);
    expect(e.now).toBeNull();
  });
  test('hydration open does not block celebration', () => {
    const e = at(22 * 60, { ...ALLDONE, hydration: { oz: 40 } });
    expect(e.celebration).toBe(true);
  });
  test('weekly is excluded even on Sunday (untracked v1)', () => {
    const e = deriveExec({ nowMin: 12 * 60, dow: 0, status: FRESH });
    expect(e.items.find((i: any) => i.id === 'weekly')).toBeUndefined();
  });
});

describe('notification plan', () => {
  test('accountable: due−45 and at-due per incomplete item, future only', () => {
    const e = at(9 * 60 + 30); // breakfast due 10:00 → only at-due (600) remains; 9:15 already past
    const b = e.plan.filter((p: any) => p.id === 'breakfast');
    expect(b.map((p: any) => p.fireAtMin)).toEqual([600]);
  });
  test('gentle: single nudge at due−30', () => {
    const e = at(8 * 60, {}, { pressure: 'gentle' });
    expect(e.plan.filter((p: any) => p.id === 'breakfast').map((p: any) => p.fireAtMin)).toEqual([570]);
  });
  test('max adds a window-open nudge', () => {
    const e = at(6 * 60, {}, { pressure: 'max' });
    expect(e.plan.filter((p: any) => p.id === 'breakfast').map((p: any) => p.fireAtMin)).toEqual([420, 555, 600]);
  });
  test('done items produce no reminders (auto-cancel by omission)', () => {
    const e = at(8 * 60, { breakfast: { done: true } });
    expect(e.plan.filter((p: any) => p.id === 'breakfast')).toEqual([]);
  });
  test('hydration never notifies', () =>
    expect(at(8 * 60).plan.filter((p: any) => p.id === 'hydration')).toEqual([]));
  test('weight copy is trend-only, never shame', () => {
    const w = at(7 * 60).plan.find((p: any) => p.id === 'weight');
    expect(w.body).toMatch(/trend/i);
    expect(w.body).not.toMatch(/score/i);
  });
  test('celebration: immediate note with score+streak, skipped on gentle', () => {
    const ALL = { breakfast: { done: true }, lunch: { done: true }, dinner: { done: true }, weight: { done: true }, hydration: { oz: 0 }, recovery: { done: true } };
    const e = at(22 * 60, ALL, { score: 92, streak: 7 });
    const c = e.plan.find((p: any) => p.id === 'celebrate');
    expect(c.immediate).toBe(true);
    expect(c.body).toContain('92');
    expect(c.body).toContain('8'); // day streak+1 locks tonight
    expect(at(22 * 60, ALL, { score: 92, streak: 7, pressure: 'gentle' }).plan).toEqual([]);
  });
});

describe('helpers', () => {
  test('mapPressure maps the onboarding display strings', () => {
    expect(mapPressure('Remind me gently')).toBe('gentle');
    expect(mapPressure('Max pressure')).toBe('max');
    expect(mapPressure('Hold me accountable')).toBe('accountable');
    expect(mapPressure(undefined)).toBe('accountable');
  });
  test('samePlan is order/content equality', () => {
    const a = at(8 * 60).plan, b = at(8 * 60).plan;
    expect(samePlan(a, b)).toBe(true);
    expect(samePlan(a, at(9 * 60).plan)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/core/exec.test.ts`
Expected: FAIL — cannot find module `../../proto/redesign-2026-07/js/exec.js`.

- [ ] **Step 3: Write the engine**

Create `proto/redesign-2026-07/js/exec.js`:

```js
/* OnStandard — Execution Engine (pure; the clock and all state are ARGUMENTS).
   One ExecState drives Home, the Action Hub, the FAB dot, and the notification plan —
   the four surfaces can never disagree. Scoring is NEVER computed here (DECISION-MEMO
   D3): score/possible/streak arrive as inputs from the existing projections. */
import { CATALOG, runsToday, fmtMin, IMPACT_LABEL } from './requirements.js';

export const DUE_SOON_MIN = 90;

/** Onboarding knob display string → engine pressure value. */
export function mapPressure(label) {
  const s = String(label || '').toLowerCase();
  if (s.includes('gentl')) return 'gentle';
  if (s.includes('max')) return 'max';
  return 'accountable';
}

/** 47 → '47 min' · 132 → '2:12'. Null/negative → ''. */
export function fmtCountdown(mins) {
  if (mins == null || mins < 0) return '';
  const h = Math.floor(mins / 60), m = mins % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}` : `${m} min`;
}

export function samePlan(a, b) { return JSON.stringify(a || []) === JSON.stringify(b || []); }

const COLOR = { done: 'green', done_late: 'green', overdue: 'red', due_soon: 'gold', ready: 'gold', locked: 'gray' };
const PILL = { done: 'Logged', done_late: 'Logged late', overdue: 'Overdue', due_soon: 'Due soon', ready: 'Open', locked: 'Upcoming' };

/* Coach-voice reminder copy. Weight is trend-only and never mentions the score. */
const HOOK = {
  breakfast: 'Photo proof keeps the 50%.',
  lunch: 'Photo proof keeps the 50%.',
  dinner: 'Photo proof keeps the 50%.',
  recovery: '20 seconds locks your Recovery 25%.',
  weight: 'Same time, same conditions — the trend is what we read.',
};
function copyFor(req, kind) {
  const t = req.title;
  if (req.id === 'weight') {
    return { title: `${t} — this morning`, body: HOOK.weight };
  }
  if (kind === 'open') return { title: `${t} window is open`, body: `Due ${fmtMin(req.window.due)}. ${HOOK[req.id] || ''}`.trim() };
  if (kind === 'soon') return { title: `${t} closes in 45`, body: HOOK[req.id] || `Due ${fmtMin(req.window.due)}.` };
  return { title: `${t} is due now`, body: HOOK[req.id] || 'Log it before the window closes.' };
}

function itemState(req, st, nowMin) {
  if (st.done) return st.late ? 'done_late' : 'done';
  if (nowMin > req.window.due) return 'overdue';
  if (req.window.open != null && nowMin < req.window.open) return 'locked';
  if (req.window.due - nowMin <= DUE_SOON_MIN) return 'due_soon';
  return 'ready';
}

const ROUTE = {
  breakfast: (d) => (d ? 'meal-detail/breakfast' : 'camera/breakfast'),
  lunch: (d) => (d ? 'meal-detail/lunch' : 'camera/lunch'),
  dinner: (d) => (d ? 'meal-detail/dinner' : 'camera/dinner'),
  weight: () => 'weight',
  hydration: () => 'log',
  recovery: (d) => (d ? 'recovery-confirm' : 'recovery'),
};

/**
 * The one derivation. `status` carries real completion; nothing here fabricates data.
 * Weekly Check-In is deliberately excluded (untracked in v1 — its completion isn't wired;
 * the Action Hub shows it as a navigational row on Sundays only, outside this engine).
 */
export function deriveExec({ nowMin, dow, status, assigned = [], pressure = 'accountable', score = 0, possible = 0, streak = 0 }) {
  const rows = CATALOG.filter((r) => r.id !== 'weekly' && runsToday(r, dow));
  const items = rows.map((req) => {
    const st = status[req.id] || {};
    const isHydro = req.id === 'hydration';
    const hydroDone = isHydro && (st.oz || 0) >= 120;
    const done = isHydro ? hydroDone : !!st.done;
    const state = itemState(req, { done, late: !!st.late }, nowMin);
    const minsLeft = !done && nowMin <= req.window.due ? req.window.due - nowMin : null;
    const dueLabel = req.window.label || `due ${fmtMin(req.window.due)}`;
    const impact = IMPACT_LABEL[req.impact.comp || req.impact.kind] || '';
    let sub;
    if (state === 'done' || state === 'done_late') sub = st.at ? `Logged ${st.at}${st.late ? ' · late' : ''}` : (isHydro ? `${st.oz} oz · goal hit` : 'In');
    else if (state === 'overdue') sub = `Was due ${fmtMin(req.window.due)} — still counts, log it late`;
    else if (state === 'locked') sub = `Opens ${fmtMin(req.window.open)}`;
    else if (isHydro) sub = `${st.oz || 0} of 120 oz · ${dueLabel}`;
    else sub = dueLabel;
    return {
      id: req.id, title: req.title, icon: req.icon, state, color: COLOR[state], pill: PILL[state],
      minsLeft, countdown: fmtCountdown(minsLeft), dueLabel, why: `${req.note} ${impact ? `**${impact}**` : ''}`.trim(),
      sub, route: ROUTE[req.id] ? ROUTE[req.id](done) : 'home', required: !!req.required, tracked: true,
      window: req.window, proof: req.proof, oz: isHydro ? (st.oz || 0) : undefined,
    };
  });

  const assignedItems = assigned.map((a) => ({
    id: a.id, title: a.title, icon: a.icon || 'clipboard',
    state: a.done ? 'done' : 'ready', color: a.done ? 'green' : 'gold', pill: a.done ? 'Done' : 'Open',
    minsLeft: null, countdown: '', dueLabel: a.dueLabel || '', why: a.note || '',
    sub: a.done ? 'Completed' : `From ${a.from || 'Coach'} · ${a.dueLabel || ''}`,
    route: `requirement/${a.id}`, required: true, tracked: true, assigned: true,
  }));

  const all = [...items, ...assignedItems];
  const doneItems = all.filter((i) => i.state === 'done' || i.state === 'done_late');
  const overdue = all.filter((i) => i.required && i.state === 'overdue')
    .sort((a, b) => (a.window ? a.window.due : 1e9) - (b.window ? b.window.due : 1e9));
  const met = all.filter((i) => i.required && (i.state === 'done' || i.state === 'done_late')).length;
  const total = all.filter((i) => i.required).length;
  const celebration = met === total && total > 0;

  // NOW: overdue (earliest due) → due_soon (nearest due) → ready required (earliest due) → assigned.
  const byDue = (arr) => arr.slice().sort((a, b) => (a.window ? a.window.due : 1e9) - (b.window ? b.window.due : 1e9));
  const openRequired = all.filter((i) => i.required && !['done', 'done_late'].includes(i.state));
  let ordered = [];
  if (!celebration) {
    ordered = [
      ...overdue,
      ...byDue(openRequired.filter((i) => i.state === 'due_soon')),
      ...byDue(openRequired.filter((i) => i.state === 'ready' && !i.assigned)),
      ...openRequired.filter((i) => i.assigned && i.state !== 'overdue'),
      ...byDue(openRequired.filter((i) => i.state === 'locked')),
    ];
  }
  const now = ordered[0] || null;
  const next = ordered[1] || null;
  const later = [
    ...ordered.slice(2),
    ...all.filter((i) => !i.required && !['done', 'done_late'].includes(i.state)),
  ];

  // Notification plan: incomplete REQUIRED timed items only; future times only.
  const plan = [];
  if (celebration) {
    if (pressure !== 'gentle') plan.push({
      id: 'celebrate', fireAtMin: nowMin, immediate: true,
      title: "You're OnStandard.",
      body: `Day locked at ${score} — day ${streak + 1} of your streak.`,
    });
  } else {
    for (const i of items) {
      if (!i.required || i.state === 'done' || i.state === 'done_late') continue;
      const req = rows.find((r) => r.id === i.id);
      const due = req.window.due;
      const slots = [];
      if (pressure === 'gentle') slots.push([due - 30, 'soon']);
      else {
        if (pressure === 'max' && req.window.open != null) slots.push([req.window.open, 'open']);
        slots.push([due - 45, 'soon'], [due, 'due']);
      }
      for (const [t, kind] of slots) {
        if (t <= nowMin) continue;
        const c = copyFor(req, kind);
        plan.push({ id: i.id, fireAtMin: t, immediate: false, title: c.title, body: c.body });
      }
    }
    plan.sort((a, b) => a.fireAtMin - b.fireAtMin);
  }

  return { items: all, now, next, later, doneItems, overdue, met, total, score, possible, celebration, plan };
}
```

- [ ] **Step 4: Run tests until green**

Run: `npx jest src/core/exec.test.ts`
Expected: PASS (all suites). If a boundary test disagrees with the implementation, the TEST expresses the spec — fix the implementation.

- [ ] **Step 5: Full check and commit**

Run: `npm run typecheck && npm run test`
Expected: clean, 131 suites.

```bash
git add proto/redesign-2026-07/js/exec.js src/core/exec.test.ts
git commit -m "feat(exec): pure execution engine — 4-state machine, NOW selection, pressure-scaled notification plan"
```

---

### Task 2: State integration — `S.exec`, `syncNotifications`, in-app feed

**Files:**
- Modify: `proto/redesign-2026-07/js/state.js`

**Interfaces:**
- Consumes: `deriveExec`, `mapPressure`, `samePlan` (Task 1); existing `DAY`, `DEADLINE`, `minutesNow` from `./day.js`; `fmtClock` (module-local in state.js).
- Produces: `S.exec` (getter → fresh ExecState each read); `act.syncNotifications()` (idempotent; posts `{id, atISO, title, body}[]` via `window.OnStandardNative.notify.sync` when the plan changed); sync hooks inside `logMeal`, `submitRecovery`, `logWeight`, `addWater`, `completeAssigned`, `startDay0`, `hydrateDay`. `S.notifications` rewritten to read `S.exec`.

- [ ] **Step 1: Add the exec import and getter**

At the top of `state.js`: `import { deriveExec, mapPressure, samePlan } from './exec.js';`

Inside the `S` object (near the other getters):

```js
  /* ---------- EXECUTION ENGINE (one derivation for Home / Hub / FAB / notifications) ---------- */
  get exec() {
    const mstat = (k) => {
      const at = DAY.mealLoggedAt[k];
      return { done: !!DAY.meals[k], late: at != null && at > DEADLINE[k], at: at != null ? fmtClock(at) : null };
    };
    return deriveExec({
      nowMin: minutesNow(),
      dow: new Date().getDay(),
      status: {
        breakfast: mstat('breakfast'), lunch: mstat('lunch'), dinner: mstat('dinner'),
        weight: { done: RT.weightLogged, late: RT.weightLogged },
        hydration: { oz: RT.hydrationOz },
        recovery: { done: DAY.ciSubmitted },
      },
      assigned: RT.assigned,
      pressure: mapPressure(RT.ob && RT.ob.standard && RT.ob.standard.pressure),
      score: this.score, possible: this.possible, streak: this.streakDays,
    });
  },
```

- [ ] **Step 2: Add the sync action**

In `act`, next to `readNotifs`:

```js
  /* Post the engine's notification plan to native (schedule/cancel). Idempotent: skipped
     when the plan is unchanged since the last post, so completions auto-cancel their
     reminders and untouched state causes zero churn. Best-effort — UI never blocks. */
  syncNotifications() {
    try {
      const plan = S.exec.plan;
      if (samePlan(plan, RT._lastPlan)) return;
      RT._lastPlan = plan; save();
      const N = window.OnStandardNative;
      if (!N || !N.notify) return;
      const [y, mo, d] = String(DAY.date).split('-').map(Number);
      N.notify.sync(plan.map((p) => ({
        id: p.id,
        atISO: p.immediate ? null : new Date(y, mo - 1, d, Math.floor(p.fireAtMin / 60), p.fireAtMin % 60).toISOString(),
        title: p.title, body: p.body,
      })));
    } catch { /* notifications are best-effort */ }
  },
```

- [ ] **Step 3: Hook the completions**

Append `this.syncNotifications();` (or `act.syncNotifications();` where `this` isn't the act object) as the LAST line before any `return` in: `logMeal`, `submitRecovery`, `logWeight`, `addWater`, `completeAssigned`, `startDay0`. In `hydrateDay`, after `syncRtFromDay()` add `this.syncNotifications();`.

- [ ] **Step 4: Rewrite `S.notifications` to read the engine**

Replace the existing `get notifications()` body with:

```js
  get notifications() {
    const e = this.exec;
    const fresh = [];
    for (const o of e.overdue) fresh.push({
      level: 'high', title: `${o.title} is overdue`, body: `${o.sub}.`, when: 'now', icon: o.icon, route: o.route,
    });
    if (e.now && e.now.state !== 'overdue') fresh.push({
      level: 'medium', title: `Next up: ${e.now.title}`,
      body: e.now.countdown ? `${e.now.countdown} left · ${e.now.dueLabel}.` : `${e.now.dueLabel}.`,
      when: 'now', icon: e.now.icon, route: e.now.route,
    });
    RT.assigned.filter((a) => !a.done).forEach((a) => fresh.push({
      level: 'medium', title: `${a.from || 'Coach'} added: ${a.title}`,
      body: `${a.note} Due: ${(a.dueLabel || '').toLowerCase()}.`, when: 'now', icon: 'clipboard', route: `requirement/${a.id}`,
    }));
    if (RT.injured) fresh.push({ level: 'medium', title: 'Your Standard adapted', body: 'Hamstring rehab is on your list; nutrition tilts anti-inflammatory. Coach and your AT both see progress.', when: 'now', icon: 'bolt', route: 'injury' });
    if (RT.hydrationOz >= 120) fresh.push({ level: 'positive', title: 'Hydration standard hit', body: `${RT.hydrationOz} oz in. This week's focus, handled. Coach sees it.`, when: 'now', icon: 'droplet', route: 'log' });
    if (e.celebration) fresh.push({
      level: 'positive', title: "You're OnStandard", body: `Every requirement is in at ${e.score}. Day ${this.streakDays + 1} locks at midnight.`,
      when: 'now', icon: 'check', route: 'home',
    });
    return { new: fresh, earlier: [] };
  },
```

- [ ] **Step 5: Verify and commit**

Run: `npm run typecheck && npm run test`
Expected: clean.

```bash
git add proto/redesign-2026-07/js/state.js
git commit -m "feat(exec): S.exec getter, idempotent syncNotifications on every completion, engine-driven in-app feed"
```

---

### Task 3: Home redesign — score strip, NOW card, groups, celebration flip, tick

**Files:**
- Modify: `proto/redesign-2026-07/js/screens/home.js` (rewrite render; keep `actCard` and the head)
- Modify: `proto/redesign-2026-07/js/router.js` (clear the exec tick on every render)
- Modify: `proto/redesign-2026-07/css/screens.css` (append exec classes)

**Interfaces:**
- Consumes: `S.exec` (Task 2); existing `appHead`, `scoreRing`, `animateRing`, `esc`, `safeImg` from `../components.js`; `icon` from `../icons.js`; existing CSS vars (`--amber-*` serve as gold, `--red-*`, `--green-*`).
- Produces: the `window.__execTick` convention (router clears it; screens set it) that Task 4 reuses.

- [ ] **Step 1: Append the CSS**

Append to `proto/redesign-2026-07/css/screens.css`:

```css
/* ---- execution loop: score strip, NOW card, groups ---- */
.xstrip{display:flex;align-items:center;gap:12px;background:var(--surface-1);border:1px solid var(--hairline);border-radius:20px;padding:11px 14px;cursor:pointer}
.xstrip .xsc{font-size:24px;font-weight:800;letter-spacing:var(--num-tight);font-variant-numeric:tabular-nums}
.xstrip .xmid{flex:1;display:flex;flex-direction:column;gap:4px}
.xstrip .xrow{display:flex;align-items:center;gap:8px}
.xstrip .xmeta{font-size:10.5px;color:var(--text-3);font-weight:700;text-align:right;line-height:1.4;white-space:nowrap}
.xsegs{display:flex;gap:4px}
.xsegs i{height:4px;flex:1;border-radius:2px;background:var(--surface-3)}
.xsegs i.on{background:var(--green)}
.xnow{background:linear-gradient(160deg,rgba(245,165,36,0.16),rgba(245,165,36,0.05) 55%),var(--surface-1);border:1px solid var(--amber-border);border-radius:22px;padding:16px 16px 14px;box-shadow:var(--sh-card)}
.xnow.red{background:linear-gradient(160deg,rgba(246,87,87,0.16),rgba(246,87,87,0.05) 55%),var(--surface-1);border-color:var(--red-border)}
.xnow .xlab{display:flex;justify-content:space-between;align-items:center}
.xnow .xl{font-size:10px;font-weight:800;letter-spacing:.16em;color:var(--amber-bright)}
.xnow.red .xl{color:var(--red)}
.xnow .xmain{display:flex;gap:12px;align-items:center;margin-top:11px}
.xnow .xt{font-size:19px;font-weight:800;letter-spacing:var(--title-tight)}
.xnow .xwhy{font-size:12px;color:var(--text-2);line-height:1.45;margin-top:2px}
.xcount{display:flex;align-items:baseline;gap:8px;margin:13px 0 12px}
.xcount .xcd{font-size:34px;font-weight:800;letter-spacing:var(--num-tight);color:var(--amber-bright);font-variant-numeric:tabular-nums}
.xnow.red .xcd{color:var(--red)}
.xcount .xdl{font-size:12px;color:var(--text-2);font-weight:700}
.xcta{display:flex;align-items:center;justify-content:center;gap:9px;width:100%;box-sizing:border-box;padding:14px;border:none;border-radius:var(--r-btn);background:linear-gradient(150deg,var(--amber-bright),var(--amber));color:#1A1204;font-family:var(--font);font-size:15px;font-weight:800;box-shadow:0 12px 34px rgba(245,165,36,0.30);cursor:pointer}
.xnow.red .xcta{background:linear-gradient(150deg,#F87171,var(--red));color:#1A0505;box-shadow:0 12px 34px rgba(246,87,87,0.28)}
.xgrp{font-size:10px;font-weight:800;letter-spacing:.16em;text-transform:uppercase;color:var(--text-3);margin:6px 4px -4px}
.xrow-item{display:flex;align-items:center;gap:11px;background:var(--surface-1);border:1px solid var(--hairline);border-radius:17px;padding:10px 12px;cursor:pointer}
.xrow-item .xr{flex:1}
.xrow-item .xa{font-size:14px;font-weight:700;letter-spacing:-.01em}
.xrow-item .xb{font-size:11.5px;color:var(--text-3);margin-top:1px}
.xrow-item.green{background:linear-gradient(90deg,var(--green-surface),transparent 70%);border-color:var(--green-border)}
.xrow-item.green .xa{color:var(--green-bright)}
.xrow-item.red{background:linear-gradient(90deg,var(--red-surface),transparent 75%);border-color:var(--red-border)}
.xpill{font-size:10px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;padding:3px 9px;border-radius:var(--r-pill);white-space:nowrap}
.xpill.gold{background:var(--amber-surface);color:var(--amber-bright);border:1px solid var(--amber-border)}
.xpill.gray{background:var(--surface-3);color:var(--text-3);border:1px solid var(--hairline)}
.xpill.green{background:var(--green-surface);color:var(--green-bright);border:1px solid var(--green-border)}
.xpill.red{background:var(--red-surface);color:var(--red);border:1px solid var(--red-border)}
.xico{width:46px;height:46px;border-radius:var(--r-tile);display:grid;place-items:center;flex:0 0 auto}
.xico.gold{background:var(--amber-surface);color:var(--amber-bright);border:1px solid var(--amber-border)}
.xico.green{background:var(--green-surface);color:var(--green-bright)}
.xico.gray{background:var(--surface-2);color:var(--text-3);border:1px solid var(--hairline)}
.xico.red{background:var(--red-surface);color:var(--red);border:1px solid var(--red-border)}
.xico.sm{width:38px;height:38px}
.xrecord{background:var(--surface-1);border:1px solid var(--hairline);border-radius:20px;padding:6px 14px;text-align:left}
.xrec{display:flex;align-items:center;gap:10px;padding:9px 0;border-bottom:1px solid var(--hairline-soft);font-size:13px;font-weight:700}
.xrec:last-child{border-bottom:none}
.xrec .xtk{width:22px;height:22px;border-radius:8px;background:var(--green-surface);color:var(--green-bright);display:grid;place-items:center;flex:0 0 auto}
.xrec .xtm{margin-left:auto;font-size:11px;color:var(--text-3);font-weight:700;font-variant-numeric:tabular-nums}
.xcelebwrap{display:flex;flex-direction:column;align-items:center;text-align:center}
@media (prefers-reduced-motion: reduce){ .xnow,.xcelebwrap{animation:none !important;transition:none !important} }
```

- [ ] **Step 2: Add the tick-clear to `router.js`**

In `render()`, as the first lines of the function body:

```js
  // Screens with live countdowns register a tick; every route change clears it.
  if (window.__execTick) { clearInterval(window.__execTick); window.__execTick = null; }
```

- [ ] **Step 3: Rewrite `home.js`**

Replace the whole file with (keeping `actCard` verbatim from the current file — copy it across):

```js
import { S, RT, act } from '../state.js';
import { icon } from '../icons.js';
import { appHead, scoreRing, animateRing, esc, safeImg } from '../components.js';

/* actCard: KEEP the existing implementation from the current file, unchanged. */
// ... (existing actCard function) ...

const whyHtml = (why) => esc(why).replace(/\*\*(.+?)\*\*/, '<b>$1</b>');

function nowCard(e) {
  const n = e.now;
  const od = n.state === 'overdue';
  return `<section class="xnow ${od ? 'red' : ''}">
    <div class="xlab"><span class="xl">${od ? 'OVERDUE' : 'NOW'}</span><span class="xpill ${n.color}">${n.pill}</span></div>
    <div class="xmain">
      <div class="xico ${n.color}">${icon(n.icon, 21)}</div>
      <div><div class="xt">${esc(n.title)}</div><div class="xwhy">${whyHtml(n.why)}</div></div>
    </div>
    <div class="xcount">
      ${od ? `<span class="xcd">Late</span><span class="xdl">${esc(n.sub)}</span>`
           : `<span class="xcd" data-cd>${n.countdown}</span><span class="xdl">${esc(n.dueLabel)}</span>`}
    </div>
    <button class="xcta" data-go="${n.route}">${icon(n.proof === 'form' ? 'moon' : n.proof === 'scale' ? 'scale' : 'camera', 18)} ${od ? `Log ${esc(n.title)} late` : `Log ${esc(n.title)}`}</button>
  </section>`;
}

const row = (i) => `<div class="xrow-item ${i.color === 'green' ? 'green' : i.color === 'red' ? 'red' : ''}" data-go="${i.route}">
    <div class="xico sm ${i.color}">${icon(i.icon, 17)}</div>
    <div class="xr"><div class="xa">${esc(i.title)}</div><div class="xb">${esc(i.sub)}</div></div>
    <span class="xpill ${i.color}">${i.pill}</span>
  </div>`;

function strip(e) {
  return `<section class="xstrip" data-go="score-breakdown">
    ${scoreRing({ score: e.score, size: 52, stroke: 6, glow: false, showCenter: false, uid: 'strip' })}
    <span class="xsc">${e.score}</span>
    <div class="xmid">
      <div class="xrow"><span class="status-pill ${S.tier.cls}">${S.tier.name}</span>${S.streakDays > 0 ? `<span style="font-size:11px;font-weight:700;color:var(--text-2)">🔥 ${S.streakDays} day streak</span>` : ''}</div>
      <div class="xsegs">${Array.from({ length: e.total }, (_, i) => `<i class="${i < e.met ? 'on' : ''}"></i>`).join('')}</div>
    </div>
    <div class="xmeta">${e.met} of ${e.total} in<br>${e.score} → ${e.possible}</div>
  </section>`;
}

function celebration(e) {
  return `<div class="xcelebwrap">
    <section class="hero" style="padding-bottom:8px">
      ${scoreRing({ score: e.score, delta: (S.scoreYesterday != null && e.score > S.scoreYesterday) ? `+${e.score - S.scoreYesterday} pts` : null, streak: S.streakDays > 0 ? `${S.streakDays} day streak` : null, tierName: S.tier.name, tierCls: S.tier.cls })}
    </section>
    <div style="font-size:22px;font-weight:800;letter-spacing:-.02em;margin-top:2px">You're OnStandard.</div>
    <div style="font-size:12.5px;color:var(--text-2);line-height:1.55;max-width:34ch;margin-top:5px">Every requirement is in. Day <b>${S.streakDays + 1}</b> of your streak locks at midnight.</div>
    <div style="height:14px"></div>
    <div class="eyebrow" style="align-self:flex-start">Today's record</div>
    <div class="xrecord" style="width:100%;box-sizing:border-box">
      ${e.doneItems.map((d) => `<div class="xrec"><span class="xtk">${icon('check', 12)}</span>${esc(d.title)}<span class="xtm">${esc((d.sub || '').replace('Logged ', ''))}</span></div>`).join('')}
    </div>
    ${RT.hydrationOz < 120 ? `<div style="width:100%;margin-top:10px"><div class="xrow-item" data-go="log"><div class="xico sm gray">${icon('droplet', 16)}</div><div class="xr"><div class="xa">Add water</div><div class="xb">${RT.hydrationOz} of 120 oz — optional, still counts with coach</div></div><span class="xpill gray">Open</span></div></div>` : ''}
  </div>`;
}

export default {
  tab: 'home',
  render() {
    const e = S.exec;

    if (RT.day0 && !RT.day0Breakfast) {
      return `
      ${appHead()}
      ${strip(e)}
      <section class="xnow">
        <div class="xlab"><span class="xl">NOW</span><span class="xpill gold">Start here</span></div>
        <div class="xmain"><div class="xico gold">${icon('camera', 21)}</div>
        <div><div class="xt">Log First Meal</div><div class="xwhy">Your score starts moving with your first log. <b>Nutrition · 50% of score.</b></div></div></div>
        <div style="height:10px"></div>
        <button class="xcta" data-go="camera">${icon('camera', 18)} Log First Meal</button>
      </section>
      <div class="xgrp">Later</div>
      ${e.items.filter((i) => i.id !== 'breakfast').map(row).join('')}
      <div class="eyebrow">Recent Activity</div>
      <div class="state-demo"><div class="sd-ic">${icon('camera', 24)}</div><div class="sd-t">No logs yet</div>
      <div class="sd-s">Your proof trail builds here as you log. Take a photo to begin today's standard.</div></div>
      <div style="height:8px"></div>`;
    }

    if (e.celebration) {
      const t = S.trustPass;
      return `
      ${appHead()}
      ${celebration(e)}
      ${t.active ? `<div class="trust" data-go="trust" style="margin-top:14px"><div class="ic">${icon('shield', 20)}</div><div style="flex:1"><div class="tt">Trust Pass · day ${t.day} of ${t.length}</div><div class="ts">${t.note}</div></div>${icon('chevron', 18, 'style="color:var(--text-3)"')}</div>` : ''}
      <div class="eyebrow">Recent Activity <span class="link" data-go="progress">View all</span></div>
      <div class="hscroll">${S.activity.map(actCard).join('')}</div>
      <div style="height:20px"></div>`;
    }

    const t = S.trustPass;
    const nextRows = e.next ? [e.next] : [];
    return `
    ${appHead()}
    ${strip(e)}
    ${e.overdue.filter((o) => !e.now || o.id !== e.now.id).map(row).join('')}
    ${e.now ? nowCard(e) : ''}
    ${nextRows.length ? `<div class="xgrp">Next</div>${nextRows.map(row).join('')}` : ''}
    ${e.later.length ? `<div class="xgrp">Later · ${e.later.length}</div>${e.later.map(row).join('')}` : ''}
    ${e.doneItems.length ? `<div class="xgrp">Done · ${e.doneItems.length}</div>${e.doneItems.map(row).join('')}` : ''}
    ${t.active ? `<div class="trust" data-go="trust" style="margin-top:14px"><div class="ic">${icon('shield', 20)}</div><div style="flex:1"><div class="tt">Trust Pass · day ${t.day} of ${t.length}</div><div class="ts">${t.note}</div></div>${icon('chevron', 18, 'style="color:var(--text-3)"')}</div>` : ''}
    ${RT.injured ? `
    <div style="height:12px"></div>
    <div class="trust" data-go="injury" style="cursor:pointer;background:linear-gradient(100deg, rgba(245,165,36,0.14), rgba(59,130,246,0.05));border-color:var(--amber-border)">
      <div class="ic" style="background:rgba(245,165,36,0.2);color:var(--amber-bright)">${icon('bolt', 20)}</div>
      <div style="flex:1"><div class="tt">Injury mode · hamstring, week 2 of 4</div>
      <div class="ts">Your Standard adapted. Rehab is on the list; coach and AT see the same bar.</div></div>
      ${icon('chevron', 18, 'style="color:var(--text-3)"')}
    </div>` : ''}
    <div class="eyebrow">Recent Activity <span class="link" data-go="progress">View all</span></div>
    <div class="hscroll">${S.activity.map(actCard).join('')}</div>
    <div style="height:20px"></div>`;
  },
  mount(root) {
    animateRing(root);
    act.syncNotifications();
    // Live loop: re-render when the derived state changes (minute ticks, state
    // transitions, day rollover). Cheap: derive → compare → maybe render. The router
    // clears window.__execTick on every route change.
    const key = () => {
      const e = S.exec;
      return JSON.stringify([e.now && e.now.id, e.now && e.now.countdown, e.met, e.celebration, e.overdue.map((o) => o.id)]);
    };
    let last = key();
    window.__execTick = setInterval(() => {
      const t = new Date();
      const iso = `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
      if (iso !== String(DAY.date)) {
        // Day rolled over while the app was open: reload the real day, then repaint.
        act.hydrateDay().then(() => window.__render());
        return;
      }
      const k = key();
      if (k !== last) { last = k; act.syncNotifications(); window.__render(); }
    }, 30000);
  },
};
```

(Add `import { DAY } from '../day.js';` to home.js's imports for the rollover check.)

- [ ] **Step 4: Verify and commit**

Run: `npm run typecheck && npm run test`
Expected: clean. Manual QA (browser, `http://localhost:8124` or the file): Home shows strip + NOW card; logging a meal (or toggling state via console `__act.logMeal('breakfast')`) promotes the next item on the following render.

```bash
git add proto/redesign-2026-07/js/screens/home.js proto/redesign-2026-07/js/router.js proto/redesign-2026-07/css/screens.css
git commit -m "feat(home): execution-first redesign — score strip, NOW card with live countdown, Now/Next/Later/Done, celebration flip"
```

---

### Task 4: Action Hub dashboard + intelligent FAB dot

**Files:**
- Modify: `proto/redesign-2026-07/js/screens/log.js` (rewrite)
- Modify: `proto/redesign-2026-07/js/router.js` (FAB dot in `tabbar`)
- Modify: `proto/redesign-2026-07/css/screens.css` (append hub/FAB classes)

**Interfaces:**
- Consumes: `S.exec`, `S.weekly`, `RT.hydrationOz`, `RT.recoveryDone/weightLogged`, `act.addWater`; CSS classes from Task 3 (`.xpill`, `.xico`, `.xsegs`, `.xgrp`); the `window.__execTick` convention.
- Produces: FAB dot markup `.fab .fab-dot` driven by ExecState.

- [ ] **Step 1: Append the CSS**

```css
/* ---- action hub ---- */
.hub-head{display:flex;align-items:center;justify-content:space-between;margin:2px 2px 8px}
.hub-head .a{font-size:15px;font-weight:800;letter-spacing:-.01em}
.hub-head .b{font-size:11.5px;font-weight:800;color:var(--text-2);font-variant-numeric:tabular-nums}
.hub-head .b em{font-style:normal;color:var(--green-bright)}
.hub-hero{display:flex;align-items:center;gap:12px;background:linear-gradient(140deg,rgba(245,165,36,0.18),rgba(245,165,36,0.05)),var(--surface-2);border:1px solid var(--amber-border);border-radius:18px;padding:13px 14px;margin:12px 0;cursor:pointer}
.hub-hero.red{background:linear-gradient(140deg,rgba(246,87,87,0.18),rgba(246,87,87,0.05)),var(--surface-2);border-color:var(--red-border)}
.hub-hero .ht{flex:1}
.hub-hero .ht .a{font-size:16px;font-weight:800;letter-spacing:-.015em}
.hub-hero .ht .b{font-size:11.5px;color:var(--text-2);margin-top:2px;font-variant-numeric:tabular-nums}
.hub-fold{display:flex;align-items:center;gap:8px;justify-content:center;font-size:11.5px;font-weight:800;color:var(--green-bright);padding:10px 0 2px;cursor:pointer}
.fab-dot{position:absolute;top:-3px;right:-3px;width:15px;height:15px;border-radius:50%;border:3px solid var(--bg)}
.fab-dot.gold{background:var(--amber-bright)}
.fab-dot.red{background:var(--red)}
.hub-celeb{text-align:center;padding:10px 6px 4px}
.hub-celeb .n{font-size:38px;font-weight:800;letter-spacing:var(--num-tight)}
```

- [ ] **Step 2: Rewrite `log.js`**

```js
import { S, RT } from '../state.js';
import { icon } from '../icons.js';
import { esc } from '../components.js';

/* Action Hub — the FAB's execution dashboard. One question, always answered:
   "what is the single most important thing I should do right now?" */
export default {
  tab: 'camera',
  hideTabs: true,
  bleed: true,
  render() {
    const e = S.exec;
    const segs = `<div class="xsegs" style="margin:0 2px 12px">${Array.from({ length: e.total }, (_, i) => `<i class="${i < e.met ? 'on' : ''}"></i>`).join('')}</div>`;
    const head = `<div class="hub-head"><span class="a">${e.met} of ${e.total} in</span><span class="b">${e.score} → <em>${e.possible} possible</em></span></div>`;

    if (e.celebration) {
      return `
      <div class="sheet-scrim" data-go="home"></div>
      <div class="sheet">
        <div class="grab"></div>
        ${head}${segs}
        <div class="hub-celeb">
          <div class="n">${e.score}</div>
          <div style="font-size:15px;font-weight:800;margin-top:2px">You're OnStandard.</div>
          <div style="font-size:12px;color:var(--text-2);margin-top:4px;line-height:1.5">Every requirement is in. Day ${S.streakDays + 1} locks at midnight.</div>
        </div>
        ${RT.hydrationOz < 120 ? `
        <div class="sheet-row">
          <div class="si" style="background:var(--cyan-surface);color:var(--cyan)">${icon('droplet', 20)}</div>
          <div class="st"><div class="t">Log Water</div><div class="s">${RT.hydrationOz} of 120 oz · optional</div></div>
          <div class="water-btns"><span class="wb2" data-act="addWater:8" data-then="log">+8</span><span class="wb2" data-act="addWater:16" data-then="log">+16</span></div>
        </div>` : ''}
        <div class="cancel" data-go="home">Close</div>
      </div>`;
    }

    const n = e.now;
    const hero = n ? `
      <div class="hub-hero ${n.state === 'overdue' ? 'red' : ''}" data-go="${n.route}">
        <div class="xico ${n.color}" style="width:44px;height:44px">${icon(n.proof === 'form' ? 'moon' : n.proof === 'scale' ? 'scale' : 'camera', 20)}</div>
        <div class="ht">
          <div class="a">${n.state === 'overdue' ? `Log ${esc(n.title)} late` : `Log ${esc(n.title)}`}</div>
          <div class="b">${n.state === 'overdue' ? esc(n.sub) : `⏱ ${n.countdown || '—'} · ${esc(n.dueLabel)}`}</div>
        </div>
        ${icon('chevron', 16, 'style="color:var(--text-3)"')}
      </div>` : '';

    const hydro = e.items.find((i) => i.id === 'hydration');
    const weight = e.items.find((i) => i.id === 'weight');
    const recovery = e.items.find((i) => i.id === 'recovery');
    const weeklyToday = new Date().getDay() === 0;

    return `
    <div class="sheet-scrim" data-go="home"></div>
    <div class="sheet">
      <div class="grab"></div>
      ${head}${segs}
      ${hero}
      <div class="xgrp" style="margin:0 2px 7px">Quick logs</div>
      ${hydro && hydro.state !== 'done' ? `
      <div class="sheet-row">
        <div class="si" style="background:var(--cyan-surface);color:var(--cyan)">${icon('droplet', 20)}</div>
        <div class="st"><div class="t">Log Water</div><div class="s">${RT.hydrationOz} of 120 oz today</div></div>
        <div class="water-btns"><span class="wb2" data-act="addWater:8" data-then="log">+8</span><span class="wb2" data-act="addWater:16" data-then="log">+16</span></div>
      </div>` : `
      <div class="sheet-row" style="background:linear-gradient(90deg, rgba(52,211,153,0.14), transparent 85%);border-radius:16px">
        <div class="si" style="background:var(--green-surface);color:var(--green-bright)">${icon('check', 20)}</div>
        <div class="st"><div class="t">Hydration standard hit</div><div class="s">${RT.hydrationOz} oz · this week's focus, handled.</div></div>
      </div>`}
      ${weight && !(e.now && e.now.id === 'weight') ? `
      <div class="sheet-row" data-go="weight">
        <div class="si" style="background:${weight.state === 'done' ? 'var(--green-surface);color:var(--green-bright)' : 'var(--surface-2);color:var(--text-3)'}">${icon(weight.state === 'done' ? 'check' : 'scale', 20)}</div>
        <div class="st"><div class="t">Log Weight</div><div class="s">${weight.state === 'done' ? 'In for today · trend only' : 'Trend only · never moves the daily score'}</div></div>
        <span class="sv" style="color:var(--text-3)">trend</span>
      </div>` : ''}
      <div class="xgrp" style="margin:4px 2px 7px">Forms &amp; check-ins</div>
      ${recovery && !(e.now && e.now.id === 'recovery') ? `
      <div class="sheet-row" data-go="${recovery.route}">
        <div class="si" style="background:${recovery.state === 'done' ? 'var(--green-surface);color:var(--green-bright)' : 'rgba(168,85,247,0.22);color:var(--purple-bright)'}">${icon(recovery.state === 'done' ? 'check' : 'moon', 20)}</div>
        <div class="st"><div class="t">Recovery Check-In</div><div class="s">${recovery.state === 'done' ? 'Submitted tonight' : 'Before bed · 20 seconds · Recovery 25%'}</div></div>
        <span class="xpill ${recovery.color}">${recovery.pill}</span>
      </div>` : ''}
      ${weeklyToday ? `
      <div class="sheet-row" data-go="checkin">
        <div class="si" style="background:var(--blue-surface);color:var(--blue-bright)">${icon('clipboard', 19)}</div>
        <div class="st"><div class="t">Weekly Check-In</div><div class="s">${S.weekly.status}</div></div>
      </div>` : ''}
      ${e.doneItems.length ? `<div class="hub-fold" data-go="home">${icon('check', 13)} ${e.doneItems.length} in — view on Home</div>` : ''}
      <div class="cancel" data-go="home">Cancel</div>
    </div>`;
  },
};
```

- [ ] **Step 3: FAB dot in `router.js`**

In `tabbar()`, replace the FAB branch:

```js
    if (t.fab) {
      // Athlete camera FAB carries the exec status dot (gold = actionable, red = overdue,
      // none = day complete). Other roles' FABs are plain. Glyph never changes.
      let dot = '';
      if (nav === 'athlete') {
        try {
          const e = S.exec;
          dot = e.celebration ? '' : `<span class="fab-dot ${e.overdue.length ? 'red' : 'gold'}"></span>`;
        } catch { /* pre-auth render — no dot */ }
      }
      return `<div class="tab"><div class="fab" data-go="${t.route}" style="position:relative">${icon(t.icon, 26)}${dot}</div></div>`;
    }
```

- [ ] **Step 4: Verify and commit**

Run: `npm run typecheck && npm run test`
Expected: clean.

```bash
git add proto/redesign-2026-07/js/screens/log.js proto/redesign-2026-07/js/router.js proto/redesign-2026-07/css/screens.css
git commit -m "feat(hub): Action Hub execution dashboard — progress header, NOW hero, grouped quick logs, Sunday-only weekly, FAB status dot"
```

---

### Task 5: NOTIFY_SYNC bridge + native seam + retire legacy reminders

**Files:**
- Create: `src/lib/notify/execSync.ts`
- Modify: `src/proto/bridge.ts` (message union + case + shim `notify` API)
- Modify: `app/_layout.tsx` (remove the `initReminders()` effect)
- Test: `src/proto/bridge.test.ts` (extend) and `src/lib/notify/execSync.test.ts` (new)

**Interfaces:**
- Consumes: `ensureNotifyPermission`, `isNotifyAvailable` from `src/lib/notify/index.ts` (existing); `expo-notifications` (already a dependency).
- Produces: `syncExecNotifications(plan: ExecPlanItem[])` with `ExecPlanItem = { id: string; atISO: string | null; title: string; body: string }`; bridge message `{ type: 'NOTIFY_SYNC'; plan: ExecPlanItem[] }` (fire-and-forget); shim `window.OnStandardNative.notify.sync(plan)` — exactly what Task 2's `syncNotifications` posts.

- [ ] **Step 1: Write the failing tests**

Create `src/lib/notify/execSync.test.ts`:

```ts
const scheduled: unknown[] = [];
const cancelAll = jest.fn(async () => undefined);
jest.mock('expo-notifications', () => ({
  cancelAllScheduledNotificationsAsync: (...a: unknown[]) => cancelAll(...a),
  scheduleNotificationAsync: jest.fn(async (req: unknown) => { scheduled.push(req); return 'id'; }),
  SchedulableTriggerInputTypes: { DATE: 'date', DAILY: 'daily' },
  getPermissionsAsync: jest.fn(async () => ({ granted: true })),
  requestPermissionsAsync: jest.fn(async () => ({ granted: true })),
  setNotificationChannelAsync: jest.fn(async () => undefined),
}));
jest.mock('react-native', () => ({ Platform: { OS: 'ios' } }));

import { syncExecNotifications } from './execSync';

beforeEach(() => { scheduled.length = 0; cancelAll.mockClear(); });

test('cancels everything, then schedules only future date triggers', async () => {
  const future = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  const past = new Date(Date.now() - 60 * 1000).toISOString();
  await syncExecNotifications([
    { id: 'dinner', atISO: future, title: 'Dinner closes in 45', body: 'x' },
    { id: 'stale', atISO: past, title: 'old', body: 'y' },
  ]);
  expect(cancelAll).toHaveBeenCalledTimes(1);
  expect(scheduled).toHaveLength(1);
  expect((scheduled[0] as { identifier: string }).identifier).toContain('exec-dinner');
});

test('empty plan cancels and schedules nothing', async () => {
  await syncExecNotifications([]);
  expect(cancelAll).toHaveBeenCalledTimes(1);
  expect(scheduled).toHaveLength(0);
});

test('immediate items (atISO null) schedule with a null trigger', async () => {
  await syncExecNotifications([{ id: 'celebrate', atISO: null, title: "You're OnStandard.", body: 'z' }]);
  expect(scheduled).toHaveLength(1);
  expect((scheduled[0] as { trigger: unknown }).trigger).toBeNull();
});
```

Extend `src/proto/bridge.test.ts` with:

```ts
jest.mock('../lib/notify/execSync', () => ({ syncExecNotifications: jest.fn(async () => undefined) }));
// (import after mocks, alongside the existing imports)
import { syncExecNotifications } from '../lib/notify/execSync';

test('NOTIFY_SYNC hands the plan to the exec seam (fire-and-forget)', async () => {
  const { ref } = fakeRef();
  const plan = [{ id: 'dinner', atISO: '2026-07-09T19:15:00.000Z', title: 't', body: 'b' }];
  const handled = await handleBridgeMessage(ref, { type: 'NOTIFY_SYNC', plan } as never);
  expect(handled).toBe(true);
  expect(syncExecNotifications).toHaveBeenCalledWith(plan);
});

test('shim exposes notify.sync', () => {
  expect(BRIDGE_SHIM).toContain('NOTIFY_SYNC');
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx jest src/lib/notify/execSync.test.ts src/proto/bridge.test.ts`
Expected: FAIL — module `./execSync` not found; NOTIFY_SYNC unhandled.

- [ ] **Step 3: Implement the seam**

Create `src/lib/notify/execSync.ts`:

```ts
// OnStandard — exec-driven local notifications (the NOTIFY_SYNC half).
// The proto's execution engine decides WHAT to remind and WHEN (pure, tested);
// this seam only schedules what it is handed: cancel the previous set, then
// schedule each future item as a one-shot date trigger. Exec is the ONLY
// scheduler now (the legacy daily reminders are retired), so cancel-all is safe.
import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import { ensureNotifyPermission, isNotifyAvailable } from './index';

export type ExecPlanItem = { id: string; atISO: string | null; title: string; body: string };

export async function syncExecNotifications(plan: ExecPlanItem[]): Promise<void> {
  if (!isNotifyAvailable) return;
  try {
    await Notifications.cancelAllScheduledNotificationsAsync();
    if (!plan.length) return;
    const granted = await ensureNotifyPermission();
    if (!granted) return;
    for (const p of plan) {
      const at = p.atISO ? new Date(p.atISO) : null;
      if (at && at.getTime() <= Date.now()) continue; // stale by transit time — skip
      await Notifications.scheduleNotificationAsync({
        identifier: `exec-${p.id}-${p.atISO ?? 'now'}`,
        content: { title: p.title, body: p.body },
        trigger: at
          ? { type: Notifications.SchedulableTriggerInputTypes.DATE, date: at, channelId: Platform.OS === 'android' ? 'reminders' : undefined }
          : null,
      });
    }
  } catch {
    // best-effort — a scheduler hiccup never surfaces to the athlete
  }
}
```

In `src/proto/bridge.ts`: add to the union `| { type: 'NOTIFY_SYNC'; plan: import('../lib/notify/execSync').ExecPlanItem[] }`, add `import { syncExecNotifications } from '../lib/notify/execSync';`, add the case:

```ts
    case 'NOTIFY_SYNC':
      void syncExecNotifications(msg.plan ?? []);
      return true;
```

and in `BRIDGE_SHIM`'s `OnStandardNative` object add:

```js
    notify: { sync: function(plan){ post({ type: 'NOTIFY_SYNC', plan: plan || [] }); } },
```

- [ ] **Step 4: Retire the legacy schedule**

In `app/_layout.tsx`, delete the effect:

```tsx
  // Schedule the athlete's local reminders + request permission once, on launch (no-op on web).
  React.useEffect(() => {
    useStore.getState().initReminders();
  }, []);
```

(and remove the now-unused `useStore` import ONLY if nothing else in the file uses it — `themeMode` and `flow` selectors do use it, so keep the import). Replace with a comment: `// Local reminders are exec-driven now: the proto posts NOTIFY_SYNC via the bridge.`

- [ ] **Step 5: Run tests, verify, commit**

Run: `npx jest src/lib/notify/execSync.test.ts src/proto/bridge.test.ts` → PASS.
Run: `npm run typecheck && npm run test` → clean (check no test asserted the removed `_layout` effect; fix any that did by updating them to the new reality).

```bash
git add src/lib/notify/execSync.ts src/lib/notify/execSync.test.ts src/proto/bridge.ts src/proto/bridge.test.ts app/_layout.tsx
git commit -m "feat(notify): NOTIFY_SYNC bridge + exec scheduling seam; retire legacy static reminders"
```

---

### Task 6: Full verification + browser QA + docs closeout

**Files:**
- Modify: `docs/superpowers/specs/2026-07-09-execution-loop-design.md` (Status line)
- Modify: `proto/redesign-2026-07/BUILD-NOTES.md` (dated entry)

- [ ] **Step 1: Full verify**

Run: `npm run verify`
Expected: typecheck clean, all jest suites pass, bundle exports. Fix anything that fails.

- [ ] **Step 2: Browser QA (Playwright MCP, http://localhost:8124 or a static server)**

Walk the spec §9 QA script and record pass/fail per item: NOW card renders with countdown; countdown text ticks (wait 60s or stub `minutesNow` via console); completing an item (`__act.logMeal('breakfast')` from console then re-render) promotes NEXT→NOW and updates the Hub + FAB dot on the next render; overdue styling appears for a past-due item; Action Hub groups render (weekly hidden unless Sunday); celebration flip renders when all required complete (`__act.logMeal` × meals + `__act.submitRecovery({})` + `__act.logWeight(180)` on a weight day); done group shows logged times; in-app bell matches the surfaces. Fix real defects in the owning file (small fixes only; report BLOCKED if architectural).

- [ ] **Step 3: Docs**

Spec Status → `**Status:** Implemented 2026-07-09 (plan docs/superpowers/plans/2026-07-09-execution-loop.md); notification learning deferred.` BUILD-NOTES: dated entry naming `exec.js`, the Home/Hub redesign, the FAB dot, `NOTIFY_SYNC`/`execSync`, and the legacy-reminder retirement.

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/specs/2026-07-09-execution-loop-design.md proto/redesign-2026-07/BUILD-NOTES.md
git commit -m "docs: execution loop closeout — spec status + build notes"
```
