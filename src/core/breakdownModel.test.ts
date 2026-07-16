// Score-explanation model (proto/redesign-2026-07/js/breakdown-model.js) — spec §2.
// Every claim the breakdown screen makes must be engine-exact: reach rows sum to the
// ceiling, "up to" labels appear exactly where points are variable, and category
// explanations carry real remaining-point math.
// @ts-ignore
import { dayScoreOf, maxPossibleScore, reachPlan, mealMaxGain, explainCategories, proteinRemaining } from '../../proto/redesign-2026-07/js/breakdown-model.js';

const fmtClock = (min: number) => {
  let h = Math.floor(min / 60) % 12; if (h === 0) h = 12;
  return `${h}:${String(min % 60).padStart(2, '0')} ${Math.floor(min / 60) < 12 ? 'AM' : 'PM'}`;
};

const freshDay = (over: object = {}) => ({
  date: '2026-07-16',
  meals: { breakfast: false, lunch: false, snack: false, dinner: false },
  mealLoggedAt: {}, slotMacros: {}, quickAdded: [false, false, false],
  hydrationL: 0, dailyCommitment: null,
  ci: { energy: 8, recovery: 7, sleep: 8, confidence: 9, soreness: 4, motivation: 8 },
  ciConfig: { energy: true, recovery: true, sleep: true, confidence: true, soreness: false, motivation: false },
  ciSubmitted: false, ciLast: null,
  proteinTarget: 180, calTarget: 3200, scoringProfile: 'athlete',
  currentWeight: null, scoreHistory: [],
  ...over,
});

const OPTS: any = {
  slots: ['breakfast', 'lunch', 'snack', 'dinner'],
  denom: 4,
  titles: { breakfast: 'Breakfast', lunch: 'Lunch', snack: 'Snack', dinner: 'Dinner' },
  optional: ['snack'],
  nowMin: 10 * 60, // 10:00 AM — breakfast window closed, lunch open
  fmtClock,
};

describe('reachPlan (spec §2.6: mathematically exact, sums to the ceiling)', () => {
  test('row gains sum EXACTLY to maxPossible − current score', () => {
    const day = freshDay();
    const cur = dayScoreOf(day);
    const { rows, maxPossible } = reachPlan(day, OPTS);
    const sum = rows.reduce((a: number, r: any) => a + r.gain, 0);
    expect(sum).toBe(maxPossible - cur);
    expect(maxPossible).toBe(maxPossibleScore(day, OPTS));
  });

  test('a perfect ceiling day reaches 100 and a complete day has an empty reach plan', () => {
    const day = freshDay();
    expect(maxPossibleScore(day, { ...OPTS, nowMin: 8 * 60 })).toBe(100); // everything still on time at 8 AM
    const done = freshDay({
      meals: { breakfast: true, lunch: true, snack: true, dinner: true },
      mealLoggedAt: { breakfast: 500, lunch: 780, snack: 1000, dinner: 1200 },
      slotMacros: { breakfast: { protein: 45 }, lunch: { protein: 45 }, snack: { protein: 45 }, dinner: { protein: 45 } },
      ciSubmitted: true, dailyCommitment: 'yes',
    });
    expect(reachPlan(done, OPTS).rows).toEqual([]);
  });

  test('meals and recovery are "up to"; commitment is guaranteed (spec §2.5/§2.6)', () => {
    const { rows } = reachPlan(freshDay(), OPTS);
    const kinds = Object.fromEntries(rows.map((r: any) => [r.id, r.kind]));
    expect(kinds.lunch).toBe('upTo');
    expect(kinds.recovery).toBe('upTo');
    expect(kinds.commitment).toBe('guaranteed');
  });

  test('a slot past its deadline is labeled late (half credit), never silently on time', () => {
    const { rows } = reachPlan(freshDay(), OPTS); // 10:00 AM > breakfast 9:30 deadline
    const bfast = rows.find((r: any) => r.id === 'breakfast')!;
    expect(bfast.late).toBe(true);
    expect(bfast.sub).toMatch(/late still beats|late still counts|half/i);
    const lunch = rows.find((r: any) => r.id === 'lunch')!;
    expect(lunch.late).toBe(false);
  });

  test('optional snack is framed Optional, never overdue', () => {
    const { rows } = reachPlan(freshDay(), { ...OPTS, nowMin: 18 * 60 }); // 6 PM, snack window passed
    const snack = rows.find((r: any) => r.id === 'snack')!;
    expect(snack.sub).toMatch(/Optional/);
  });
});

describe('mealMaxGain (camera "earn up to +N" — spec §4.4)', () => {
  test('is a true single-meal ceiling: > 0 on an open slot, 0 on a logged one', () => {
    const day = freshDay();
    expect(mealMaxGain(day, 'lunch', OPTS)).toBeGreaterThan(0);
    const logged = freshDay({ meals: { ...day.meals, lunch: true }, mealLoggedAt: { lunch: 700 }, slotMacros: { lunch: { protein: 40 } } });
    expect(mealMaxGain(logged, 'lunch', OPTS)).toBe(0);
  });
});

describe('explainCategories (spec §2.2/§2.3)', () => {
  test('earned + remaining never exceeds each category ceiling, and weights sum to 100%', () => {
    const cats = explainCategories(freshDay(), OPTS);
    expect(cats.map((c: any) => c.weightPct).reduce((a: number, b: number) => a + b, 0)).toBe(100);
    for (const c of cats) {
      expect(c.earned).toBeGreaterThanOrEqual(0);
      expect(c.earned + c.remaining).toBeLessThanOrEqual(c.possible + 1); // ±1 rounding guard
    }
  });

  test('a submitted check-in explains its exact quality and names what cost points (§2.3)', () => {
    const day = freshDay({ ciSubmitted: true, ci: { energy: 6, recovery: 6, sleep: 4, confidence: 8, soreness: 4, motivation: 8 } });
    const rec = explainCategories(day, OPTS).find((c: any) => c.id === 'recovery')!;
    expect(rec.note).toMatch(/Recovery quality \d+%/);
    expect(rec.note).toMatch(/Sleep/); // the biggest deficit is named
    expect(rec.remaining).toBe(0);     // settled for today — no phantom remaining points
  });

  test('commitment explains the reflection and its guaranteed remainder', () => {
    const com = explainCategories(freshDay(), OPTS).find((c: any) => c.id === 'commitment')!;
    expect(com.remainingKind).toBe('guaranteed');
    expect(com.remaining).toBe(15);
    const done = explainCategories(freshDay({ dailyCommitment: 'partial' }), OPTS).find((c: any) => c.id === 'commitment')!;
    expect(done.earned).toBe(9); // 0.15 × 60
    expect(done.remaining).toBe(0);
  });

  test('protein remaining feeds the nutrition explanation', () => {
    const day = freshDay({ meals: { breakfast: true, lunch: false, snack: false, dinner: false }, mealLoggedAt: { breakfast: 500 }, slotMacros: { breakfast: { protein: 40 } } });
    expect(proteinRemaining(day, OPTS.slots)).toBe(140);
    const nut = explainCategories(day, OPTS).find((c: any) => c.id === 'nutrition')!;
    expect(nut.note).toMatch(/1 of 4 meals completed/);
  });
});

describe('restriction comparison (meal-intel, spec §18.3/§18.4)', () => {
  // @ts-ignore
  const { restrictionConflicts } = require('../../proto/redesign-2026-07/js/meal-intel.js');
  const R = { allergies: [{ name: 'Peanuts', severity: 'severe' }, { name: 'Eggs', severity: 'moderate' }], intolerances: ['Dairy'], preferences: ['Halal'] };

  test('a severe allergen match is flagged severe (stemmed: "peanut butter" hits "Peanuts")', () => {
    const c = restrictionConflicts(['Peanut butter toast', 'Banana'], R);
    expect(c.severe).toEqual(['Peanuts']);
    expect(c.any).toBe(true);
  });
  test('moderate allergies and intolerances flag separately; preferences never alarm', () => {
    const c = restrictionConflicts([{ name: 'Scrambled eggs' }, { name: 'Milk' }], R);
    expect(c.severe).toEqual([]);
    expect(c.moderate).toEqual(['Eggs']);
    expect(c.noted).toEqual(['Dairy']);
  });
  test('no match yields any=false — the CALLER must still never claim guaranteed safety', () => {
    const c = restrictionConflicts(['Grilled chicken', 'Rice'], R);
    expect(c.any).toBe(false);
  });
});
