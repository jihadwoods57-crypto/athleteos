/**
 * GALLERY REVERSAL (founder direction 2026-07-15): gallery-picked meal photos now SCORE.
 * Rule A's `live === false` exclusion is gone; the integrity wall is the 0062 photo-hash
 * duplicate check, surfaced client-side as `slotMacros[k].flagged === 'dup'` — the ONLY
 * state that keeps a logged slot from counting.
 */
// @ts-ignore — proto is plain ESM JS (allowJs), same import pattern as mealIntel.test.ts
import { mealScored, computeComponents, DAY, projectedDay } from '../../proto/redesign-2026-07/js/day.js';

const day = (patch: any) => ({
  meals: {}, slotMacros: {}, quickAdded: [], proteinTarget: 180, scoringProfile: 'athlete',
  ciSubmitted: false, ciLast: null, dailyCommitment: null, ci: {}, ciConfig: {}, date: '2026-07-15',
  ...patch,
});

describe('mealScored — gallery counts, duplicates do not', () => {
  test('a bare logged slot scores (unchanged classic path)', () =>
    expect(mealScored(day({ meals: { lunch: true } }), 'lunch')).toBe(true));

  test('a gallery pick (live:false) NOW scores — Rule A is gone', () =>
    expect(mealScored(day({ meals: { lunch: true }, slotMacros: { lunch: { live: false, protein: 40 } } }), 'lunch')).toBe(true));

  test('a duplicate-flagged slot is logged but never scores', () =>
    expect(mealScored(day({ meals: { lunch: true }, slotMacros: { lunch: { flagged: 'dup', protein: 40 } } }), 'lunch')).toBe(false));

  test('an unlogged slot never scores regardless of meta', () =>
    expect(mealScored(day({ meals: {}, slotMacros: { lunch: { live: false } } }), 'lunch')).toBe(false));
});

describe('nutrition component — gallery protein counts, duplicate protein does not', () => {
  const base = {
    meals: { breakfast: true }, ciSubmitted: false,
  };
  test('gallery plate protein feeds nutrition', () => {
    const live = computeComponents(day({ ...base, slotMacros: { breakfast: { protein: 50 } } })).nutrition;
    const gallery = computeComponents(day({ ...base, slotMacros: { breakfast: { protein: 50, live: false } } })).nutrition;
    expect(gallery).toBe(live); // identical — provenance no longer changes the number
    expect(gallery).toBeGreaterThan(0);
  });
  test('duplicate-flagged plate earns 0 nutrition from that slot', () => {
    const flagged = computeComponents(day({ ...base, slotMacros: { breakfast: { protein: 50, flagged: 'dup' } } })).nutrition;
    const none = computeComponents(day({ meals: {}, slotMacros: {} })).nutrition;
    expect(flagged).toBe(none);
  });
});

describe('projectedDay — dup slots stay excluded even in the "if you finish today" reach', () => {
  const D: any = DAY;
  beforeAll(() => { (globalThis as any).window = (globalThis as any).window ?? {}; });
  afterEach(() => {
    D.meals = { breakfast: false, lunch: false, snack: false, dinner: false };
    D.slotMacros = {}; D.mealLoggedAt = {};
  });
  test('a gallery slot needs no flag-clearing (it already counts); a dup slot cannot be projected into counting', () => {
    D.meals.lunch = true;
    D.slotMacros.lunch = { protein: 40, live: false };
    const withGallery = computeComponents(projectedDay()).nutrition;
    D.slotMacros.lunch = { protein: 40, flagged: 'dup' };
    const withDup = computeComponents(projectedDay()).nutrition;
    expect(withGallery).toBeGreaterThan(withDup); // the dup's meal credit + protein are honestly gone
  });
});
