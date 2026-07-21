/**
 * Coach-side score explainability — std threading (Tier 2, 2026-07-21).
 *
 * The scoring chain in day.js reads its standard through an optional `std` param that DEFAULTS
 * to the module-global STD. This test pins the two properties the coach breakdown depends on:
 *   (1) DEFAULT PRESERVATION — a call with no std arg is byte-identical to today (the athlete's
 *       own path is unchanged); the parity/exec suites lock the rest.
 *   (2) COACH ISOLATION — a call with an EXPLICIT std uses THAT standard, never the module
 *       global. This is the exact cross-athlete hazard the threading closes: a coach whose
 *       device STD is a 6-meal team standard must still score a viewed athlete against the
 *       athlete's own 2-meal standard.
 * Plus nutritionConfigForGoal (state.js) — the shared derivation both the athlete's own hydrate
 * and the coach reconstruction use, so a coach never grades a day against the device's targets.
 */
// @ts-ignore — proto is plain ESM JS (allowJs), same pattern as standardDay.test.ts
import {
  DAY as DAY_, setDayStandard, slotDeadline, slotGrace, slotLateCredit, computeComponents, scoreFor,
  // @ts-ignore
} from '../../proto/redesign-2026-07/js/day.js';

const DAY: any = DAY_;

const athleteStd = (over: any = {}) => ({ mealsRequired: 2, slots: ['breakfast', 'dinner'], deadlines: {}, titles: {}, ...over });

const freshDay = () => {
  DAY.meals = { breakfast: false, lunch: false, snack: false, dinner: false };
  DAY.mealLoggedAt = {}; DAY.slotMacros = {}; DAY.quickAdded = [false, false, false];
  DAY.proteinTarget = 180; DAY.calTarget = 3200; DAY.scoringProfile = 'athlete';
  DAY.ci = {}; DAY.ciConfig = {}; DAY.ciSubmitted = false; DAY.ciLast = null; DAY.dailyCommitment = null;
};
// 90 g each → two meals meet the 180 g protein target, so protein credit is full and the ONLY
// thing that moves nutrition between the two standards is the meal denominator (the isolation point).
const logOnTime = (k: string, protein = 90) => { DAY.meals[k] = true; DAY.mealLoggedAt[k] = 60; DAY.slotMacros[k] = { protein }; };

afterEach(() => { setDayStandard(null); freshDay(); });

describe('slot accessors — explicit std overrides the module global', () => {
  test('slotDeadline reads the explicit std, not the coach-device global', () => {
    setDayStandard({ mealsRequired: 1, slots: ['dinner'], deadlines: { dinner: 1200 }, titles: {} }); // "coach device"
    expect(slotDeadline('dinner')).toBe(1200);                                   // no arg → global
    expect(slotDeadline('dinner', athleteStd({ deadlines: { dinner: 900 } }))).toBe(900); // explicit wins
  });
  test('slotGrace and slotLateCredit honor the explicit std', () => {
    setDayStandard({ mealsRequired: 1, slots: ['dinner'], deadlines: {}, titles: {}, grace: { dinner: 90 }, latePolicy: { dinner: 'none' } });
    expect(slotGrace('dinner')).toBe(90);
    expect(slotLateCredit('dinner')).toBe(0);
    const athlete = athleteStd({ grace: { dinner: 0 }, latePolicy: { dinner: 'full' } });
    expect(slotGrace('dinner', athlete)).toBe(0);
    expect(slotLateCredit('dinner', athlete)).toBe(1);
  });
});

describe('computeComponents / scoreFor — coach isolation', () => {
  test('an explicit 2-meal std scores full where the device 6-meal global would score partial', () => {
    // Coach device is on a 6-meal team standard.
    setDayStandard({ mealsRequired: 6, slots: ['breakfast', 'lunch', 'snack', 'dinner', 'meal-5', 'meal-6'], deadlines: {}, titles: {} });
    freshDay();
    logOnTime('breakfast'); logOnTime('dinner'); // the viewed athlete logged their 2 meals
    // No-arg (the bug): graded against the coach's 6-meal denominator → 2/6 meal credit.
    const viaGlobal = computeComponents(DAY).nutrition;
    expect(viaGlobal).toBe(Math.round(65 + (2 / 6) * 35));
    // Explicit athlete std (the fix): graded against their own 2-meal denominator → full.
    const viaAthlete = computeComponents(DAY, athleteStd()).nutrition;
    expect(viaAthlete).toBe(100);
    expect(viaAthlete).not.toBe(viaGlobal); // the threading demonstrably changed the number
  });
  test('scoreFor carries the explicit std through to the total', () => {
    setDayStandard({ mealsRequired: 6, slots: ['breakfast', 'lunch', 'snack', 'dinner', 'meal-5', 'meal-6'], deadlines: {}, titles: {} });
    freshDay();
    logOnTime('breakfast'); logOnTime('dinner');
    expect(scoreFor(DAY, athleteStd())).toBeGreaterThan(scoreFor(DAY)); // athlete's own std scores higher than the wrong global
  });
});

describe('default preservation — no std arg is byte-identical to today', () => {
  test('classic day, no standard: 3 on-time meals = 3/4 credit, arg-less == explicit null', () => {
    setDayStandard(null);
    freshDay();
    logOnTime('breakfast'); logOnTime('lunch'); logOnTime('dinner');
    const classic = Math.round(65 + (3 / 4) * 35);
    expect(computeComponents(DAY).nutrition).toBe(classic);
    expect(computeComponents(DAY, null).nutrition).toBe(classic); // explicit null === arg-less default
    expect(computeComponents(DAY, undefined).nutrition).toBe(classic);
  });
});

describe('nutritionConfigForGoal (state.js) — shared derivation, coach never uses device targets', () => {
  // state.js reads localStorage at module load, so require it under JSDOM (protoMealPropagation pattern).
  const { JSDOM } = require('jsdom');
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost' });
  (globalThis as any).window = dom.window;
  (globalThis as any).document = dom.window.document;
  (globalThis as any).localStorage = dom.window.localStorage;
  const { nutritionConfigForGoal } = require('../../proto/redesign-2026-07/js/state.js');

  test('no goal → shipped athlete defaults (never another day\'s values)', () => {
    expect(nutritionConfigForGoal(null, 200, { protein: 999 })).toEqual({ scoringProfile: 'athlete', proteinTarget: 180, calTarget: 3200 });
  });
  test('gain goal derives the gain profile + surplus targets from bodyweight', () => {
    const cfg = nutritionConfigForGoal('gain', 200, null);
    expect(cfg.scoringProfile).toBe('gain');
    expect(cfg.proteinTarget).toBe(200);  // p(200*1.0) → round to 5
    expect(cfg.calTarget).toBe(3400);     // c(200*17)=3400
  });
  test('lose goal derives the general profile', () => {
    expect(nutritionConfigForGoal('lose', 180, null).scoringProfile).toBe('general');
  });
  test('a coach-set target wins over the goal-derived default', () => {
    const cfg = nutritionConfigForGoal('gain', 200, { protein: 240, calories: 3800 });
    expect(cfg.proteinTarget).toBe(240);
    expect(cfg.calTarget).toBe(3800);
  });
});
