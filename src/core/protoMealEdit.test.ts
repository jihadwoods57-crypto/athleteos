/**
 * Pre-log food editing (WS4 — "user can edit for accuracy"): applyFoodEdit is the single
 * reducer for remove/rename/quantity/add on the staged MEAL.result, keeping detectedRich
 * (rich renderers) and detected (flat names logMeal persists as `foods`) in lockstep.
 * Macros are deliberately untouched by every op.
 */
// @ts-ignore — proto is plain ESM JS (allowJs)
import { applyFoodEdit, hasUserEdits } from '../../proto/redesign-2026-07/js/meal-intel.js';

const staged = () => ({
  protein: 40, kcal: 700, carbs: 60, fat: 20,
  detected: ['Chicken', 'Rice'],
  detectedRich: [
    { name: 'Chicken', confidence: 'high' },
    { name: 'Rice', confidence: 'medium', quantity: '1 cup' },
  ],
});

describe('applyFoodEdit', () => {
  test('remove splices BOTH arrays by name', () => {
    const r: any = staged();
    expect(applyFoodEdit(r, { kind: 'remove', name: 'Rice' })).toBe(true);
    expect(r.detectedRich.map((d: any) => d.name)).toEqual(['Chicken']);
    expect(r.detected).toEqual(['Chicken']);
  });
  test('rename updates both arrays and marks the row edited', () => {
    const r: any = staged();
    expect(applyFoodEdit(r, { kind: 'rename', name: 'Chicken', newName: 'Grilled chicken' })).toBe(true);
    expect(r.detectedRich[0]).toMatchObject({ name: 'Grilled chicken', edited: true });
    expect(r.detected).toContain('Grilled chicken');
    expect(r.detected).not.toContain('Chicken');
  });
  test('quantity sets/clears and marks edited; strips markup + caps at 40', () => {
    const r: any = staged();
    applyFoodEdit(r, { kind: 'quantity', name: 'Chicken', quantity: '<b>2 breasts</b>' + 'x'.repeat(60) });
    expect(r.detectedRich[0].quantity).not.toContain('<');
    expect(r.detectedRich[0].quantity.length).toBeLessThanOrEqual(40);
    applyFoodEdit(r, { kind: 'quantity', name: 'Rice', quantity: '' });
    expect(r.detectedRich[1]).not.toHaveProperty('quantity');
    expect(hasUserEdits(r)).toBe(true);
  });
  test('add appends to both arrays as userAdded high-confidence; dupes and >8 refused', () => {
    const r: any = staged();
    expect(applyFoodEdit(r, { kind: 'add', name: 'Broccoli', quantity: '1 cup' })).toBe(true);
    expect(r.detectedRich[2]).toMatchObject({ name: 'Broccoli', confidence: 'high', userAdded: true, quantity: '1 cup' });
    expect(r.detected).toContain('Broccoli');
    expect(applyFoodEdit(r, { kind: 'add', name: 'Broccoli' })).toBe(false); // duplicate
    for (let i = 0; i < 10; i++) applyFoodEdit(r, { kind: 'add', name: `Item ${i}` });
    expect(r.detectedRich.length).toBeLessThanOrEqual(8);
  });
  test('macros are never touched by any op', () => {
    const r: any = staged();
    applyFoodEdit(r, { kind: 'remove', name: 'Chicken' });
    applyFoodEdit(r, { kind: 'add', name: 'Steak' });
    applyFoodEdit(r, { kind: 'rename', name: 'Rice', newName: 'Brown rice' });
    expect({ protein: r.protein, kcal: r.kcal, carbs: r.carbs, fat: r.fat })
      .toEqual({ protein: 40, kcal: 700, carbs: 60, fat: 20 });
  });
  test('bogus ops are safe no-ops', () => {
    const r: any = staged();
    expect(applyFoodEdit(r, { kind: 'remove', name: 'Ghost' })).toBe(false);
    expect(applyFoodEdit(r, { kind: 'rename', name: 'Chicken', newName: '' })).toBe(false);
    expect(applyFoodEdit(null, { kind: 'remove', name: 'x' })).toBe(false);
    expect(applyFoodEdit(r, null)).toBe(false);
    expect(hasUserEdits(r)).toBe(false); // nothing actually changed
  });
});
