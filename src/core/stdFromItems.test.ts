// @ts-ignore — plain ESM proto module
import { stdFromItems } from '../../proto/redesign-2026-07/js/requirements.js';

const meal = (i: number, title: string, open: number | null, due: number) =>
  ({ id: `meal-${i}`, title, kind: 'meal', proof: 'photo', freq: { type: 'daily' },
     window: open == null ? { due } : { open, due } });

test('null on no meal items', () => {
  expect(stdFromItems([])).toBeNull();
  expect(stdFromItems([{ id: 'lift', kind: 'lift', title: 'Lift', proof: 'check' }])).toBeNull();
});

describe('snack-optional (0086 item.snack)', () => {
  const four = (over: any[] = []) => [
    { id: 'meal-1', kind: 'meal', title: 'Breakfast', proof: 'photo' },
    { id: 'meal-2', kind: 'meal', title: 'Lunch', proof: 'photo' },
    { id: 'meal-3', kind: 'meal', title: 'Snack', proof: 'photo', ...(over[2] || {}) },
    { id: 'meal-4', kind: 'meal', title: 'Dinner', proof: 'photo' },
  ];
  test('PARITY: with no snack flag, mealsRequired === slot count and optional is empty', () => {
    const std = stdFromItems(four())!;
    expect(std.mealsRequired).toBe(4);
    expect(std.slots.length).toBe(4);
    expect(std.optional).toEqual([]);
  });
  test('a snack-flagged meal drops out of the denominator but keeps its slot', () => {
    const std = stdFromItems(four([, , { snack: true }]))!;
    expect(std.slots.length).toBe(4);        // still loggable
    expect(std.mealsRequired).toBe(3);       // out of the required denominator
    expect(std.optional).toEqual(['snack']); // the snack slot key is marked optional
  });
  test('degenerate all-snack config falls back to all-required (can\'t opt out of every meal)', () => {
    const allSnack = four().map((m) => ({ ...m, snack: true }));
    expect(stdFromItems(allSnack)!.mealsRequired).toBe(4); // never 0 — the || m guard holds the denominator
  });
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
