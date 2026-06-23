// AthleteOS — macro-ring derivation tests. Locks the Nutrition Carbs + Fat rings
// to live day-state (carbsToday/fatToday + pcts) so they can never regress back to
// the old static 210g / 58g literals.
import { computeDerived } from './scoring';
import { createInitialState } from './defaultState';
import type { AppState } from './types';

describe('computeDerived — carbs + fat macro rings are live, not static', () => {
  it('default state sums logged meals: carbs 48+62+12=122, fat 16+24+6=46', () => {
    const d = computeDerived(createInitialState());
    expect(d.carbsToday).toBe(122);
    expect(d.fatToday).toBe(46);
    expect(d.carbTarget).toBe(300);
    expect(d.fatTarget).toBe(80);
    // pct = clamp(round(today/target*100))
    expect(d.carbPct).toBe(41); // round(122/300*100) = 41
    expect(d.fatPct).toBe(57); // round(46/80*100) = round(57.499..) = 57
  });

  it('logging dinner adds its carbs (+60) and fat (+25)', () => {
    const s = createInitialState();
    const before = computeDerived(s);
    const after = computeDerived({ ...s, meals: { ...s.meals, dinner: true } } as AppState);
    expect(after.carbsToday).toBe(before.carbsToday + 60);
    expect(after.fatToday).toBe(before.fatToday + 25);
  });

  it('quick-adds contribute carbs + fat (protein shake = +6c / +2f)', () => {
    const s = createInitialState();
    const before = computeDerived(s);
    const after = computeDerived({ ...s, quickAdded: [false, true, false] } as AppState);
    expect(after.carbsToday).toBe(before.carbsToday + 6);
    expect(after.fatToday).toBe(before.fatToday + 2);
  });

  it('a zero-meal day reads 0g on both rings (honest empty state, not a static 210/58)', () => {
    const s = createInitialState();
    const d = computeDerived({
      ...s,
      meals: { breakfast: false, lunch: false, snack: false, dinner: false },
      quickAdded: [false, false, false],
    } as AppState);
    expect(d.carbsToday).toBe(0);
    expect(d.fatToday).toBe(0);
    expect(d.carbPct).toBe(0);
    expect(d.fatPct).toBe(0);
  });
});
