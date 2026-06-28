// AthleteOS — the Coach Plan keystone. Locks the plan derivation both engines read:
// activePlan's target fallbacks (a corrupt/legacy blob must never poison the plan),
// the 12-hour window-time formatting (midnight/noon/wraparound), and mealTarget's
// required-vs-snack share split (incl. the no-required / degenerate-plan fallbacks).
import { activePlan, formatWindowTime, mealTarget, DEFAULT_PLAN } from './coachPlan';
import type { MealKey } from './types';

describe('formatWindowTime', () => {
  it('formats midnight and noon with the right meridiem', () => {
    expect(formatWindowTime(0)).toBe('12:00 AM');
    expect(formatWindowTime(720)).toBe('12:00 PM');
  });
  it('formats morning and evening times with zero-padded minutes', () => {
    expect(formatWindowTime(570)).toBe('9:30 AM'); // 9:30
    expect(formatWindowTime(365)).toBe('6:05 AM'); // 6:05, minute padded
    expect(formatWindowTime(1410)).toBe('11:30 PM'); // 23:30
  });
  it('wraps a >=24h value back into a valid label, never "24:.."', () => {
    expect(formatWindowTime(1440)).toBe('12:00 AM'); // 24:00 -> midnight
    expect(formatWindowTime(1455)).toBe('12:15 AM'); // 24:15 -> 12:15 AM
  });
});

describe('activePlan', () => {
  it('falls back to the default targets when state carries nothing', () => {
    const p = activePlan({
      proteinTarget: undefined as unknown as number,
      calTarget: undefined as unknown as number,
      weightTarget: undefined as unknown as number,
      planInstructions: undefined as unknown as string[],
    });
    expect(p.calorieTarget).toBe(DEFAULT_PLAN.calorieTarget);
    expect(p.proteinTarget).toBe(DEFAULT_PLAN.proteinTarget);
    expect(p.weightGoalLb).toBeNull();
    expect(p.instructions).toEqual([]);
    // windows + the rest of the plan come straight from the default.
    expect(p.windows).toEqual(DEFAULT_PLAN.windows);
  });

  it('uses the athlete\'s real editable targets when present', () => {
    const p = activePlan({
      proteinTarget: 200,
      calTarget: 2800,
      weightTarget: 175,
      planInstructions: ['No sugary drinks'],
    });
    expect(p.proteinTarget).toBe(200);
    expect(p.calorieTarget).toBe(2800);
    expect(p.weightGoalLb).toBe(175);
    expect(p.instructions).toEqual(['No sugary drinks']);
  });

  it('treats a zero/negative target as missing and falls back (corrupt blob guard)', () => {
    const p = activePlan({
      proteinTarget: 0,
      calTarget: -5,
      weightTarget: 0,
      planInstructions: [],
    });
    expect(p.proteinTarget).toBe(DEFAULT_PLAN.proteinTarget);
    expect(p.calorieTarget).toBe(DEFAULT_PLAN.calorieTarget);
    expect(p.weightGoalLb).toBeNull(); // a 0 weight goal is not a real goal
  });
});

describe('mealTarget', () => {
  it('gives a required meal a full share and a snack a lighter (~half) share', () => {
    const lunch = mealTarget(DEFAULT_PLAN, 'lunch'); // required
    const snack = mealTarget(DEFAULT_PLAN, 'snack'); // not required
    expect(lunch.calories).toBe(1067); // round(3200/3)
    expect(lunch.protein).toBe(60); // round(180/3)
    expect(snack.calories).toBe(533); // round((3200/3) * 0.5)
    expect(snack.protein).toBe(30); // round((180/3) * 0.5)
    expect(snack.calories).toBeLessThan(lunch.calories);
  });

  it('falls back to mealsPerDay when no window is marked required', () => {
    const plan = {
      ...DEFAULT_PLAN,
      windows: DEFAULT_PLAN.windows.map((w) => ({ ...w, required: false })),
      mealsPerDay: 4,
    };
    const t = mealTarget(plan, 'lunch');
    // slots = mealsPerDay (4); every meal gets the half (non-required) weight.
    expect(t.calories).toBe(400); // round(3200/4 * 0.5)
    expect(t.protein).toBe(23); // round(180/4 * 0.5)
  });

  it('never produces NaN/0-division for a degenerate plan (no windows, 0 meals/day)', () => {
    const plan = { ...DEFAULT_PLAN, windows: [] as typeof DEFAULT_PLAN.windows, mealsPerDay: 0 };
    const t = mealTarget(plan, 'dinner' as MealKey);
    expect(Number.isFinite(t.calories)).toBe(true);
    expect(Number.isFinite(t.protein)).toBe(true);
    expect(t.calories).toBeGreaterThan(0); // slots clamped to >=1
  });
});

describe('DEFAULT_PLAN invariants', () => {
  it('has exactly the three required meals + an optional snack, each window well-ordered', () => {
    const required = DEFAULT_PLAN.windows.filter((w) => w.required).map((w) => w.key);
    expect(required).toEqual(['breakfast', 'lunch', 'dinner']);
    expect(DEFAULT_PLAN.windows.find((w) => w.key === 'snack')?.required).toBe(false);
    for (const w of DEFAULT_PLAN.windows) {
      expect(w.deadlineMin).toBeGreaterThan(w.openMin); // deadline after open
    }
  });
});
