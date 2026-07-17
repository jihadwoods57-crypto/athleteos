// @ts-ignore — plain ESM proto module
import { stdFromItems } from '../../proto/redesign-2026-07/js/requirements.js';

const meal = (i: number, title: string, open: number | null, due: number) =>
  ({ id: `meal-${i}`, title, kind: 'meal', proof: 'photo', freq: { type: 'daily' },
     window: open == null ? { due } : { open, due } });

test('null on no meal items', () => {
  expect(stdFromItems([])).toBeNull();
  expect(stdFromItems([{ id: 'lift', kind: 'lift', title: 'Lift', proof: 'check' }])).toBeNull();
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
