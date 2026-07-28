/**
 * gapFoods (proto/nutrition.js) — the "which detected foods need USDA enrichment" filter for the
 * post-log enrich-meal background job. A food already in the curated table is grounded at log time
 * and must NOT trigger a wasted USDA call; a food the table can't match (branded/restaurant) is
 * exactly what enrichment resolves and learns. Pure, so it's unit-tested directly.
 */
// @ts-ignore — proto is plain ESM JS (allowJs)
import { gapFoods } from '../../proto/redesign-2026-07/js/nutrition.js';

const food = (name: string, per?: any) => ({ name, confidence: 'high', ...(per ? { per } : {}) });

describe('gapFoods', () => {
  test('excludes foods the curated table matches, keeps the ones it cannot', () => {
    const out = gapFoods([
      food('Grilled chicken', { protein: 35, kcal: 190, carbs: 0, fat: 4 }), // curated → excluded
      food('White rice', { protein: 4, kcal: 205, carbs: 45, fat: 0 }),        // curated → excluded
      food('Chipotle chicken burrito bowl', { protein: 45, kcal: 700, carbs: 60, fat: 22 }), // gap → kept
      food('Celsius energy drink', { protein: 0, kcal: 10, carbs: 2, fat: 0 }), // gap → kept
    ]);
    expect(out.map((f: any) => f.name)).toEqual(['Chipotle chicken burrito bowl', 'Celsius energy drink']);
    expect(out[0]).toEqual({ name: 'Chipotle chicken burrito bowl', protein: 45, kcal: 700, carbs: 60, fat: 22 });
  });

  test('carries the AI per-food macros through, zero-filling missing ones', () => {
    const [f] = gapFoods([food('Panda Express orange chicken', { protein: 15 })]);
    expect(f).toEqual({ name: 'Panda Express orange chicken', protein: 15, kcal: 0, carbs: 0, fat: 0 });
  });

  test('dedupes by name (case-insensitive), drops blanks/too-short, caps the batch', () => {
    const dup = gapFoods([food('Mystery Bar XY'), food('mystery bar xy'), food('a'), food('')]);
    expect(dup.map((f: any) => f.name)).toEqual(['Mystery Bar XY']);
    const many = Array.from({ length: 12 }, (_, i) => food(`Rare Dish ${i}`));
    expect(gapFoods(many).length).toBe(8);
    expect(gapFoods(many, 3).length).toBe(3);
  });

  test('an all-curated plate yields nothing to enrich (no wasted call)', () => {
    expect(gapFoods([food('Grilled chicken'), food('Broccoli'), food('White rice')])).toEqual([]);
  });

  test('bad input is safe', () => {
    expect(gapFoods(null as any)).toEqual([]);
    expect(gapFoods(undefined as any)).toEqual([]);
    expect(gapFoods([null, undefined, {} as any])).toEqual([]);
  });
});
