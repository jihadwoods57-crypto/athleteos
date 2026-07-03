import { clampPlanSlots, parsePlanSlots, PLAN_DAY_KCAL_FLOOR_ADULT, PLAN_DAY_KCAL_FLOOR_MINOR } from './planValidate';
import type { PlanSlot } from './coachPlan';

const slot = (key: PlanSlot['key'], kcal: number, protein = 30): PlanSlot => ({
  key,
  mode: 'open',
  macros: { kcal, protein },
  pinnedMeal: null,
  options: [],
  restaurantAlts: [],
  note: null,
  photoRequired: false,
});

describe('parsePlanSlots', () => {
  it('drops entries with no valid meal key', () => {
    const out = parsePlanSlots([{ key: 'brunch', mode: 'open' }, { key: 'lunch', mode: 'open' }]);
    expect(out.map((s) => s.key)).toEqual(['lunch']);
  });

  it('defaults missing fields and strips unknown keys', () => {
    const [s] = parsePlanSlots([{ key: 'breakfast', mode: 'pinned', hacker: true, macros: { kcal: 600, protein: 40 } }]);
    expect(s.mode).toBe('pinned');
    expect(s.options).toEqual([]);
    expect(s.restaurantAlts).toEqual([]);
    expect(s.photoRequired).toBe(false);
    expect(s.note).toBeNull();
    expect((s as unknown as Record<string, unknown>).hacker).toBeUndefined();
  });

  it('clamps negative macros to 0 and coerces meal items to strings', () => {
    const [s] = parsePlanSlots([
      { key: 'dinner', mode: 'open', macros: { kcal: -5, protein: -2 }, options: [{ name: 'X', items: ['rice', 7], macros: { kcal: -1, protein: 10, carbs: 5, fat: 3 }, source: 'ai' }] },
    ]);
    expect(s.macros).toEqual({ kcal: 0, protein: 0 });
    expect(s.options[0].items).toEqual(['rice']);
    expect(s.options[0].macros.kcal).toBe(0);
  });

  it('returns [] for non-array input', () => {
    expect(parsePlanSlots(null)).toEqual([]);
    expect(parsePlanSlots('nope')).toEqual([]);
  });
});

describe('clampPlanSlots — the deterministic calorie floor no AI draft can cross', () => {
  it('scales a starvation-level day up to the minor floor, preserving slot ratios', () => {
    // A drafted 900-kcal day for a 14-year-old flowed straight to setPlanSlots — the
    // exact "LLM never invents safety-bounded numbers for minors" line the
    // constitution draws, enforced in deterministic code rather than a prompt.
    const out = clampPlanSlots([slot('breakfast', 300), slot('lunch', 300), slot('dinner', 300)], { isMinor: true });
    const total = out.reduce((t, x) => t + x.macros.kcal, 0);
    expect(total).toBeGreaterThanOrEqual(PLAN_DAY_KCAL_FLOOR_MINOR);
    // Ratios hold: equal slots stay equal.
    expect(out[0].macros.kcal).toBe(out[1].macros.kcal);
  });

  it('applies the adult floor to adult drafts', () => {
    const out = clampPlanSlots([slot('breakfast', 300), slot('lunch', 300), slot('dinner', 300)], { isMinor: false });
    const total = out.reduce((t, x) => t + x.macros.kcal, 0);
    expect(total).toBeGreaterThanOrEqual(PLAN_DAY_KCAL_FLOOR_ADULT);
  });

  it('leaves a healthy day untouched', () => {
    const slots = [slot('breakfast', 700), slot('lunch', 900), slot('dinner', 900)];
    expect(clampPlanSlots(slots, { isMinor: true })).toEqual(slots);
  });

  it('a day with no kcal targets asserts nothing and is left alone', () => {
    const slots = [slot('breakfast', 0), slot('lunch', 0)];
    expect(clampPlanSlots(slots, { isMinor: true })).toEqual(slots);
  });

  it('drops pinned meals and options matching a confirmed avoid food', () => {
    const withMeals: PlanSlot[] = [{
      ...slot('dinner', 800),
      pinnedMeal: { name: 'Peanut chicken bowl', items: ['peanut sauce'], macros: { kcal: 800, protein: 45, carbs: 60, fat: 30 }, source: 'ai' },
      options: [
        { name: 'Salmon & rice', items: ['salmon'], macros: { kcal: 750, protein: 42, carbs: 65, fat: 22 }, source: 'ai' },
        { name: 'Thai peanut noodles', items: ['peanuts'], macros: { kcal: 700, protein: 30, carbs: 80, fat: 28 }, source: 'ai' },
      ],
    }];
    const out = clampPlanSlots(withMeals, { isMinor: false, avoid: ['peanut'] });
    expect(out[0].pinnedMeal).toBeNull();
    expect(out[0].options.map((o) => o.name)).toEqual(['Salmon & rice']);
  });
});
