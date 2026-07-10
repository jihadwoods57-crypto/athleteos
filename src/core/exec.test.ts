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
    const w = at(7 * 60).plan.find((p: any) => p.id === 'weight')!;
    expect(w.body).toMatch(/trend/i);
    expect(w.body).not.toMatch(/score/i);
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
