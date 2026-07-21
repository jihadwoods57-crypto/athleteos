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
  test('due_soon exactly 90 min out', () => expect(get(at(570 - 90), 'breakfast').state).toBe('due_soon'));
  test('ready at 91 min out', () => expect(get(at(570 - 91), 'breakfast').state).toBe('ready'));
  test('overdue one minute past due', () => expect(get(at(570 + 1), 'breakfast').state).toBe('overdue'));
  test('done beats time', () =>
    expect(get(at(11 * 60, { breakfast: { done: true, late: true } }), 'breakfast').state).toBe('done_late'));
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
    // Tuesday 11:45 PM: breakfast/lunch/dinner/recovery (last-closing window, 23:30) all closed,
    // nothing done → the day is over. (11:00 PM is too early — recovery is still due_soon then.)
    const e = deriveExec({ nowMin: 23 * 60 + 45, dow: 2, status: FRESH });
    expect(e.decided).toBe(true);
    const b = get(e, 'breakfast');
    expect(b.state).toBe('overdue');
    expect(b.color).toBe('red');
    expect(b.pill).toBe('Missed');
  });
  test('optional hydration never renders overdue', () => {
    const e = at(22 * 60); // past hydration's 21:30 target — optional items cap at 'ready'
    expect(e.items.find((i: any) => i.id === 'hydration')!.state).toBe('ready');
  });

  // Home-screen dedup regression: in the evening, breakfast AND lunch are both overdue, so `now`
  // and `next` are drawn from the FRONT of the overdue list — meaning `overdue` legitimately
  // CONTAINS both. The home render must therefore exclude BOTH now and next from the overdue
  // strip (it previously excluded only `now`, so lunch rendered twice — overdue strip + Next).
  test('two overdue items: now and next are BOTH inside the overdue array (render must dedup both)', () => {
    // Tuesday (dow 2) so weight — a Mon/Wed/Fri item — doesn't run and confound the scenario.
    const e = deriveExec({ nowMin: 20 * 60, dow: 2, status: FRESH }); // 8 PM: breakfast + lunch overdue
    const overdueIds = e.overdue.map((i: any) => i.id);
    expect(overdueIds).toEqual(expect.arrayContaining(['breakfast', 'lunch']));
    expect(e.now.id).toBe('breakfast');   // earliest-due overdue leads
    expect(e.next.id).toBe('lunch');
    // the invariant the home dedup relies on: next is itself an overdue item here
    expect(overdueIds).toContain(e.next.id);
    // after excluding both cards, nothing overdue is left for the strip → no duplicate row
    const strip = e.overdue.filter((o: any) => o.id !== e.now.id && o.id !== e.next.id);
    expect(strip).toHaveLength(0);
  });
  test('countdown formats', () => {
    expect(fmtCountdown(47)).toBe('47 min');
    expect(fmtCountdown(132)).toBe('2:12');
  });
});

describe('NOW selection priority', () => {
  test('overdue beats due_soon; earliest due wins across overdue', () => {
    const e = at(14 * 60 + 30); // weight (9:00), breakfast (9:30), lunch (2:00) all overdue
    expect(e.overdue.map((o: any) => o.id)).toEqual(['weight', 'breakfast', 'lunch']);
    expect(e.now.id).toBe('weight');
  });
  test('due_soon beats ready', () => {
    const done = { breakfast: { done: true, late: false }, lunch: { done: true, late: false }, weight: { done: true } };
    const e = at(19 * 60, done); // dinner due 20:30 (due_soon), recovery due 23:30 (ready)
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
  test('locked items never become NOW — pre-window morning has no NOW', () => {
    // Tuesday 1:40 AM: recovery already done, all meals still locked (weight not a Tuesday item)
    const e = deriveExec({ nowMin: 100, dow: 2, status: { ...FRESH, recovery: { done: true } } });
    expect(e.now).toBeNull();
    expect(e.next).toBeNull();
    expect(e.celebration).toBe(false);
    expect(e.later.map((l: any) => l.id)).toEqual(expect.arrayContaining(['breakfast', 'lunch', 'dinner']));
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

describe('notification plan (delegated to notify-plan.js — see notifyPlan.test.ts for the framework itself)', () => {
  test('accountable: exactly ONE reminder per meal (soon), no at-due double', () => {
    const e = at(6 * 60);
    const b = e.plan.filter((p: any) => p.id === 'breakfast');
    expect(b.map((p: any) => [p.fireAtMin, p.stage])).toEqual([[525, 'soon']]);
  });
  test('accountable: high-urgency weight collapses to a single last-call (no duplicate weigh-in pair)', () => {
    const w = at(6 * 60).plan.filter((p: any) => p.id === 'weight');
    expect(w).toHaveLength(1);
    expect(w[0]!.stage).toBe('due');
    expect(w[0]!.fireAtMin).toBe(495); // due−45, with due-stage copy — one sharp reminder
  });
  test('gentle: single nudge at due−30', () => {
    const e = at(8 * 60, {}, { pressure: 'gentle' });
    const b = e.plan.filter((p: any) => p.id === 'breakfast');
    expect(b.map((p: any) => p.fireAtMin)).toEqual([540]);
    expect(b[0]!.title).toContain('Breakfast');
  });
  test('max keeps the full ladder: window-open + soon + due (soon may coalesce with the weigh-in)', () => {
    const e = at(6 * 60, {}, { pressure: 'max' });
    const bf = e.plan.filter((p: any) => String(p.id).includes('breakfast'));
    expect(bf.map((p: any) => p.fireAtMin)).toEqual([420, 525, 570]);
  });
  test('done items produce no reminders (auto-cancel by omission)', () => {
    const e = at(8 * 60, { breakfast: { done: true } });
    expect(e.plan.filter((p: any) => p.id === 'breakfast')).toEqual([]);
  });
  test('hydration never notifies', () =>
    expect(at(8 * 60).plan.filter((p: any) => p.id === 'hydration')).toEqual([]));
  test('every reminder carries its deep-link route — tap lands on the screen, not Home (WS7)', () => {
    const e = at(6 * 60);
    const b = e.plan.find((p: any) => p.id === 'breakfast')!;
    expect(b.route).toBe('camera/breakfast');
    const w = e.plan.find((p: any) => p.id === 'weight')!;
    expect(w.route).toBe('weight');
    const r = e.plan.find((p: any) => p.id === 'recovery');
    if (r) expect(r.route).toBe('recovery');
    e.plan.forEach((p: any) => expect(typeof p.route).toBe('string'));
  });
  test('no internal scoring formulas anywhere in the copy', () => {
    for (const pressure of ['gentle', 'accountable', 'max'] as const) {
      for (const p of at(6 * 60, {}, { pressure }).plan) {
        expect(`${p.title} ${p.body}`).not.toMatch(/\d+\s*%|the 50|Recovery 25/i);
      }
    }
  });
  test('weight copy never mentions the score', () => {
    const w = at(6 * 60).plan.find((p: any) => p.id === 'weight')!;
    expect(w.body).not.toMatch(/score|point/i);
  });
  test('celebration: immediate note with score+streak, skipped on gentle', () => {
    const ALL = { breakfast: { done: true }, lunch: { done: true }, dinner: { done: true }, weight: { done: true }, hydration: { oz: 0 }, recovery: { done: true } };
    const e = at(22 * 60, ALL, { score: 92, streak: 7 });
    const c = e.plan.find((p: any) => p.id === 'celebrate')!;
    expect(c.immediate).toBe(true);
    expect(c.body).toContain('92');
    expect(c.body).toContain('8'); // day streak+1 locks tonight
    expect(at(22 * 60, ALL, { score: 92, streak: 7, pressure: 'gentle' }).plan).toEqual([]);
  });
});

describe('first-day activation — pre-activation windows are Not required, never overdue', () => {
  const get = (e: any, id: string) => e.items.find((i: any) => i.id === id);
  // Athlete activated 6:34 PM (1114). It is now 6:40 PM (1120), Friday.
  const NOW = 18 * 60 + 40;
  const ACT = 18 * 60 + 34; // 1114
  const e = deriveExec({ nowMin: NOW, dow: 5, status: FRESH, activationMin: ACT });

  test('windows that closed before activation read not_required, not overdue', () => {
    for (const id of ['breakfast', 'lunch', 'weight']) {
      expect(get(e, id).state).toBe('not_required');
    }
    expect(e.overdue).toHaveLength(0);
  });
  test('a window comfortably after activation stays the athlete’s to do', () => {
    // dinner due 20:30 (1230) > activation+buffer (1174) → still required and actionable
    expect(get(e, 'dinner').state).toBe('ready');
    expect(get(e, 'dinner').required).toBe(true);
  });
  test('the denominator counts only post-activation required items', () => {
    // Friday required = breakfast, lunch, weight, dinner, recovery (5). Pre-activation removes
    // breakfast/lunch/weight → 2 remain (dinner, recovery).
    expect(e.total).toBe(2);
  });
  test('no reminders fire for pre-activation windows', () => {
    for (const id of ['breakfast', 'lunch', 'weight']) {
      expect(e.plan.filter((p: any) => String(p.id).includes(id))).toEqual([]);
    }
  });
  test('without an activation stamp, nothing changes (existing users unaffected)', () => {
    const plain = deriveExec({ nowMin: NOW, dow: 5, status: FRESH });
    expect(get(plain, 'breakfast').state).toBe('overdue');
    expect(plain.total).toBe(5);
  });
});

describe('grace window — a meal past due but within grace is not yet overdue', () => {
  const cat = [{ id: 'lunch', title: 'Lunch', icon: 'bowl', accent: 'g', proof: 'photo',
    freq: { type: 'daily' }, window: { open: 720, due: 840, grace: 60 }, required: true,
    impact: { kind: 'component', comp: 'nutrition' }, reminder: 'medium', note: '' }];
  const st = { lunch: { done: false } };
  test('within grace → due_soon (still actionable), never the red overdue', () => {
    const e = deriveExec({ nowMin: 870, dow: 2, status: st, catalog: cat }); // 840 < 870 <= 900
    expect(e.items.find((i: any) => i.id === 'lunch')!.state).toBe('due_soon');
  });
  test('past deadline+grace → overdue', () => {
    const e = deriveExec({ nowMin: 910, dow: 2, status: st, catalog: cat }); // > 900
    expect(e.items.find((i: any) => i.id === 'lunch')!.state).toBe('overdue');
  });
});

describe('catalog/deadline consistency', () => {
  test('meal window.due matches the scoring DEADLINE', () => {
    // requirements.js stays import-free by design — this test is the enforcement seam
    // between the display catalog and the scoring truth (day.js DEADLINE, D3 anchor).
    // @ts-ignore
    const { CATALOG } = require('../../proto/redesign-2026-07/js/requirements.js');
    // @ts-ignore
    const { DEADLINE } = require('../../proto/redesign-2026-07/js/day.js');
    for (const id of ['breakfast', 'lunch', 'dinner']) {
      expect(CATALOG.find((r: any) => r.id === id).window.due).toBe(DEADLINE[id]);
    }
  });
});

describe('helpers', () => {
  test('mapPressure maps the onboarding display strings', () => {
    expect(mapPressure('Remind me gently')).toBe('gentle');
    expect(mapPressure('High accountability')).toBe('max'); // renamed from "Max pressure"
    expect(mapPressure('Max pressure')).toBe('max');         // legacy stored value still maps
    expect(mapPressure('Hold me accountable')).toBe('accountable');
    expect(mapPressure(undefined)).toBe('accountable');
  });
  test('samePlan is order/content equality', () => {
    const a = at(8 * 60).plan, b = at(8 * 60).plan;
    expect(samePlan(a, b)).toBe(true);
    expect(samePlan(a, at(9 * 60).plan)).toBe(false);
  });
});
