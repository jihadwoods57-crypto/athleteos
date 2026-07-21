/**
 * Pre-log deleted-food propagation (Tier 1 session isolation, 2026-07-21).
 * applyFoodEdit touches only the food arrays; act.recomputeStagedMeal is what makes a
 * deletion REAL: totals re-sum from the remaining per-food grounded macros, quality
 * recomputes deterministically, and the removed food leaves the prose. Payloads without
 * per-food macros (older analyze-meal deploys) keep the AI totals — recomputed=false —
 * but the prose scrub still runs. JSDOM + lazy require, same pattern as
 * coachNotifySync.test.ts / protoSessionWipe.test.ts.
 */
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost' });
(globalThis as any).window = dom.window;
(globalThis as any).document = dom.window.document;
(globalThis as any).localStorage = dom.window.localStorage;

/* eslint-disable @typescript-eslint/no-var-requires */
// Required AFTER the JSDOM globals exist so the proto module graph (state.js) evaluates cleanly.
const { MEAL, act } = require('../../proto/redesign-2026-07/js/state.js');
const { applyFoodEdit } = require('../../proto/redesign-2026-07/js/meal-intel.js');

/** A staged result the way groundResult produces it for a NEW payload (per-food macros). */
const stagedPerFood = () => ({
  name: 'Chicken, Rice & Broccoli', quality: 100, aiQuality: 84,
  protein: 42, kcal: 426, carbs: 51, fat: 4, fiber: 6,
  highlights: ['Strong iron source'],
  detected: ['Grilled chicken', 'White rice', 'Broccoli'],
  detectedRich: [
    { name: 'Grilled chicken', confidence: 'high', per: { protein: 35, kcal: 190, carbs: 0, fat: 4 } },
    { name: 'White rice', confidence: 'high', per: { protein: 4, kcal: 205, carbs: 45, fat: 0 } },
    { name: 'Broccoli', confidence: 'medium', per: { protein: 3, kcal: 31, carbs: 6, fat: 0 } },
  ],
  note: 'Chicken and rice, in on time.',
  analysis: 'The grilled chicken anchors this plate with strong protein. The rice fuels the afternoon. Add a second vegetable next time.',
});

/** The same plate from an OLD edge deploy — no per-food macros anywhere. */
const stagedLegacy = () => {
  const r: any = stagedPerFood();
  r.detectedRich = r.detectedRich.map(({ per, ...rest }: any) => rest);
  return r;
};

const stage = (result: any) => {
  MEAL.key = 'dinner';
  MEAL.capturedAtMin = 17 * 60; // 5:00 PM — well inside any dinner window
  MEAL.result = result;
};

describe('act.recomputeStagedMeal — per-food payloads', () => {
  test('removing a food subtracts its macros, recomputes quality, and scrubs the prose', () => {
    stage(stagedPerFood());
    const before = { protein: MEAL.result.protein, quality: MEAL.result.quality };
    const op = { kind: 'remove', name: 'Grilled chicken' };
    expect(applyFoodEdit(MEAL.result, op)).toBe(true);
    act.recomputeStagedMeal(op);
    const r = MEAL.result;
    expect(r.recomputed).toBe(true);
    // totals: the chicken's grounded 35g protein is gone to the gram
    expect(before.protein - r.protein).toBe(35);
    // score inputs: quality recomputed deterministically and dropped (protein now misses)
    expect(r.quality).not.toBeNull();
    expect(r.quality).toBeLessThan(before.quality);
    // saved-record inputs: both arrays agree, chicken gone from each
    expect(r.detected).toEqual(['White rice', 'Broccoli']);
    expect(r.detectedRich.map((d: any) => d.name)).toEqual(['White rice', 'Broccoli']);
    // final text: no sentence mentions the removed food; the rest survives
    expect(r.analysis).not.toMatch(/chicken/i);
    expect(r.note).not.toMatch(/chicken/i);
  });

  test('adding a DB-known food prices it into the totals', () => {
    stage(stagedPerFood());
    const before = MEAL.result.protein;
    const op = { kind: 'add', name: 'Egg', quantity: '2 eggs' };
    expect(applyFoodEdit(MEAL.result, op)).toBe(true);
    act.recomputeStagedMeal(op);
    expect(MEAL.result.recomputed).toBe(true);
    expect(MEAL.result.protein).toBe(before + 12); // 6g × 2 servings from the curated table
  });

  test('an unpriceable added food keeps the AI totals and says so (recomputed=false)', () => {
    stage(stagedPerFood());
    const before = MEAL.result.protein;
    const op = { kind: 'add', name: 'grandma special zz' };
    expect(applyFoodEdit(MEAL.result, op)).toBe(true);
    act.recomputeStagedMeal(op);
    expect(MEAL.result.recomputed).toBe(false);
    expect(MEAL.result.protein).toBe(before);
  });
});

describe('act.recomputeStagedMeal — legacy payloads (no per-food macros)', () => {
  test('macros honestly stay the AI estimate, but the prose scrub still runs', () => {
    stage(stagedLegacy());
    const before = { protein: MEAL.result.protein, kcal: MEAL.result.kcal };
    const op = { kind: 'remove', name: 'Grilled chicken' };
    expect(applyFoodEdit(MEAL.result, op)).toBe(true);
    act.recomputeStagedMeal(op);
    const r = MEAL.result;
    expect(r.recomputed).toBe(false);
    expect(r.protein).toBe(before.protein); // no per-food attribution → no silent re-estimate
    expect(r.kcal).toBe(before.kcal);
    expect(r.analysis).not.toMatch(/chicken/i); // text isolation holds regardless
  });
});
