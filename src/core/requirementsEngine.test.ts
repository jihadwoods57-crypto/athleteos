// Requirements engine (0055) pure helpers — proto is plain ESM JS (allowJs), same import
// pattern as exec.test.ts.
// @ts-ignore
import { resolveRequirementSet, catalogFromItems, assignedFromRow, derive, stdFromSolo } from '../../proto/redesign-2026-07/js/requirements.js';

const TEAM = { id: 't', scope_kind: 'team', scope_value: null, items: [] };
const OL = { id: 'p', scope_kind: 'position', scope_value: 'OL', items: [] };
const MINE = { id: 'a', scope_kind: 'athlete', scope_value: 'ath-1', items: [] };

describe('resolveRequirementSet — precedence athlete > position > team', () => {
  test('athlete-scoped set wins over everything', () =>
    expect(resolveRequirementSet([TEAM, OL, MINE], 'ath-1', 'OL')).toBe(MINE));
  test('position room wins over team', () =>
    expect(resolveRequirementSet([TEAM, OL], 'ath-2', 'OL')).toBe(OL));
  test('position match is case/whitespace-insensitive', () =>
    expect(resolveRequirementSet([TEAM, OL], 'ath-2', ' ol ')).toBe(OL));
  test('no room match falls to team', () =>
    expect(resolveRequirementSet([TEAM, OL], 'ath-2', 'QB')).toBe(TEAM));
  test('no sets at all -> null (client keeps built-in catalog)', () => {
    expect(resolveRequirementSet([], 'ath-1', 'OL')).toBeNull();
    expect(resolveRequirementSet(null as any, 'ath-1', 'OL')).toBeNull();
  });
  test('another athlete\'s override never leaks', () =>
    expect(resolveRequirementSet([MINE, TEAM], 'ath-2', null)).toBe(TEAM));
});

describe('stdFromSolo — an independent athlete personal standard → the scored day', () => {
  test('3 meals → a 3-slot day (breakfast/lunch/dinner)', () => {
    const std = stdFromSolo({ mealsPerDay: 3 });
    expect(std!.mealsRequired).toBe(3);
    expect(std!.slots).toEqual(['breakfast', 'lunch', 'dinner']);
  });
  test('2 meals → a 2-slot day', () => {
    expect(stdFromSolo({ mealsPerDay: 2 })!.mealsRequired).toBe(2);
  });
  test('no/invalid meal count → null (the classic 4-meal day stands)', () => {
    expect(stdFromSolo(null)).toBeNull();
    expect(stdFromSolo({})).toBeNull();
    expect(stdFromSolo({ mealsPerDay: 0 })).toBeNull();
    expect(stdFromSolo({ mealsPerDay: 9 })).toBeNull();
  });
});

describe('derive — first-day activation marks pre-activation windows Not required, never Missed', () => {
  const lunch = { id: 'lunch', title: 'Lunch', accent: 'g', proof: 'photo', window: { open: 12 * 60, due: 14 * 60 }, required: true };
  test('window closed before activation → "Not required" (not "Missed")', () => {
    const d = derive(lunch, {}, 18 * 60 + 40, 18 * 60 + 34); // now 6:40 PM, activated 6:34 PM
    expect(d.status).toBe('Not required');
    expect(d.missed).toBe(false);
  });
  test('without an activation stamp, a past-due window is still "Missed"', () => {
    const d = derive(lunch, {}, 18 * 60 + 40);
    expect(d.status).toBe('Missed');
    expect(d.missed).toBe(true);
  });
  test('a logged pre-activation slot still reads Logged, not excused', () => {
    const d = derive(lunch, { done: true }, 18 * 60 + 40, 18 * 60 + 34);
    expect(d.done).toBe(true);
    expect(d.status).toBe('Logged');
  });
});

describe('catalogFromItems — server items to catalog-shaped requirements', () => {
  test('meal item inherits nutrition defaults (photo proof, scored component)', () => {
    const [r] = catalogFromItems([{ id: 'm1', title: 'Breakfast', kind: 'meal', proof: 'photo' }]);
    expect(r!.proof).toBe('photo');
    expect(r!.impact).toEqual({ kind: 'component', comp: 'nutrition' });
    expect(r!.required).toBe(true);
    expect(r!.freq.type).toBe('daily');
  });
  test('lift item is a plan-kind check by default', () => {
    const [r] = catalogFromItems([{ id: 'l1', title: 'Lift · lower', kind: 'lift', proof: 'check' }]);
    expect(r!.impact.kind).toBe('plan');
    expect(r!.icon).toBe('bolt');
  });
  test('unknown kind falls back to custom, never invented as scored', () => {
    const [r] = catalogFromItems([{ id: 'x', title: 'X', kind: 'mystery', proof: 'check' }]);
    expect(r!.impact.kind).toBe('plan');
  });
  test('bad proof falls back to the kind default', () => {
    const [r] = catalogFromItems([{ id: 'm1', title: 'Lunch', kind: 'meal', proof: 'vibes' }]);
    expect(r!.proof).toBe('photo');
  });
  test('malformed items are dropped, not repaired', () => {
    expect(catalogFromItems([{ kind: 'meal' }, null, 'nope' as any])).toEqual([]);
    expect(catalogFromItems(undefined as any)).toEqual([]);
  });
  test('weigh keeps trend impact (never daily points)', () => {
    const [r] = catalogFromItems([{ id: 'w', title: 'Morning Weight', kind: 'weigh', proof: 'scale' }]);
    expect(r!.impact.kind).toBe('trend');
  });
});

describe('assignedFromRow — server row to RT.assigned shape', () => {
  const row = (over: object = {}) => ({
    id: 'uuid-1', title: 'Extra shake after lift', note: 'No shortcuts.',
    proof: 'photo', status: 'open', due_label: null, due_at: null, ...over,
  });
  test('open row maps with real flag and coach attribution', () => {
    const a = assignedFromRow(row(), 'Coach JB');
    expect(a).toMatchObject({ id: 'uuid-1', done: false, real: true, from: 'Coach JB', proof: 'photo' });
  });
  test('done status maps to done', () =>
    expect(assignedFromRow(row({ status: 'done' }), null)!.done).toBe(true));
  test('due_label wins over due_at', () =>
    expect(assignedFromRow(row({ due_label: 'Tonight 9 PM', due_at: '2026-07-14T02:00:00Z' }), null)!.dueLabel).toBe('Tonight 9 PM'));
  test('due_at formats as a local clock time', () => {
    const d = new Date(); d.setHours(21, 5, 0, 0);
    expect(assignedFromRow(row({ due_at: d.toISOString() }), null)!.dueLabel).toBe('Due 9:05 PM');
  });
  test('no due info reads honestly, not a fake deadline', () =>
    expect(assignedFromRow(row(), null)!.dueLabel).toBe('On your list'));
  test('missing id/title -> null (never invented)', () => {
    expect(assignedFromRow({ id: 'x' } as any, null)).toBeNull();
    expect(assignedFromRow(null as any, null)).toBeNull();
  });
});
