/**
 * Deterministic per-meal quality (Tier 1 invariant: application code computes the
 * score; AI explains, never sets it) + the score↔language agreement validators.
 * mealQualityScore and scoreRubric read the SAME componentStates evaluation, so the
 * number and its explanation cannot contradict each other by construction — these
 * tests pin that agreement plus the band boundaries the UI relies on.
 */
// @ts-ignore — proto is plain ESM JS (allowJs)
import {
  mealQualityScore, scoreRubric, qualityBand, normalizeDetected,
  stripFoodMentions, analysisAgreesWithBand,
  // @ts-ignore
} from '../../proto/redesign-2026-07/js/meal-intel.js';

const balanced = { protein: 40, carbs: 45, fat: 15 }; // p-share 29%, f-share 25%
const lowProtein = { protein: 8, carbs: 60, fat: 40 }; // p-share 5%, f-share 57% — a weak plate

describe('mealQualityScore — deterministic and rubric-aligned', () => {
  test('balanced on-time plate with fiber scores 100', () => {
    expect(mealQualityScore({ macros: balanced, fiber: 7, detected: [], minutesLate: 0 })).toBe(100);
  });
  test('no macros → null (no honest score), and qualityBand handles it', () => {
    expect(mealQualityScore({ macros: {}, fiber: 0, detected: [] })).toBeNull();
    expect(qualityBand(null)).toBeNull();
  });
  test('low-protein greasy plate lands in the weak band', () => {
    const q = mealQualityScore({ macros: lowProtein, fiber: 0, detected: [], minutesLate: 0 });
    expect(q).not.toBeNull();
    expect(qualityBand(q)!.cls).toBe('low'); // < 50
  });
  test('lateness costs points: >60 min late costs more than slightly late', () => {
    const onTime = mealQualityScore({ macros: balanced, fiber: 7, detected: [], minutesLate: 0 })!;
    const slightlyLate = mealQualityScore({ macros: balanced, fiber: 7, detected: [], minutesLate: 20 })!;
    const veryLate = mealQualityScore({ macros: balanced, fiber: 7, detected: [], minutesLate: 90 })!;
    expect(onTime).toBeGreaterThan(slightlyLate);
    expect(slightlyLate).toBeGreaterThan(veryLate);
  });
  test('visible produce softens a low fiber ESTIMATE (same guard as qualityReason)', () => {
    const noProduce = mealQualityScore({ macros: balanced, fiber: 0, detected: [], minutesLate: 0 })!;
    const withProduce = mealQualityScore({ macros: balanced, fiber: 3, detected: [{ name: 'Broccoli' }], minutesLate: 0 })!;
    expect(withProduce).toBeGreaterThan(noProduce);
  });
  test('pure function: same inputs, same score', () => {
    const args = { macros: lowProtein, fiber: 2, detected: [{ name: 'Fries' }], minutesLate: 45 };
    expect(mealQualityScore(args)).toBe(mealQualityScore(args));
  });
  test('AGREEMENT: every all-met rubric row set implies the max score', () => {
    const args = { macros: balanced, fiber: 7, detected: [], minutesLate: 0 };
    const rubric = scoreRubric({ ...args, quality: mealQualityScore(args), source: 'live' });
    const judged = rubric.rows.filter((r: any) => ['On-time logging', 'Protein alignment', 'Carbohydrate balance', 'Fat within range', 'Produce & fiber'].includes(r.k));
    expect(judged.every((r: any) => r.state === 'met')).toBe(true);
    expect(mealQualityScore(args)).toBe(100);
  });
  test('AGREEMENT: a missed protein row means the score lost its protein points', () => {
    const args = { macros: lowProtein, fiber: 7, detected: [], minutesLate: 0 };
    const rubric = scoreRubric({ ...args, quality: mealQualityScore(args), source: 'live' });
    const proteinRow = rubric.rows.find((r: any) => r.k === 'Protein alignment')!;
    expect(proteinRow.state).toBe('miss');
    expect(mealQualityScore(args)!).toBeLessThan(mealQualityScore({ ...args, macros: balanced })!);
  });
});

describe('normalizeDetected — per-food macros ride through', () => {
  test('flat wire shape (analyze-meal) nests into per', () => {
    const [d]: any[] = normalizeDetected([{ name: 'Grilled chicken', confidence: 'high', protein: 35, kcal: 190, carbs: 0, fat: 4 }]);
    expect(d.per).toEqual({ protein: 35, kcal: 190, carbs: 0, fat: 4 });
  });
  test('already-nested per survives a re-normalize (sessionStorage round-trip)', () => {
    const [d]: any[] = normalizeDetected([{ name: 'Rice', confidence: 'medium', per: { protein: 4, kcal: 205, carbs: 45, fat: 0 }, edited: true }]);
    expect(d.per.carbs).toBe(45);
    expect(d.edited).toBe(true);
  });
  test('old payloads without macros stay per-less (fallback path)', () => {
    const [d]: any[] = normalizeDetected([{ name: 'Toast', confidence: 'high' }]);
    expect(d.per).toBeUndefined();
  });
});

describe('stripFoodMentions — deleted food leaves the prose', () => {
  const text = 'The grilled chicken anchors this plate with strong protein. The rice fuels the afternoon. Add a vegetable next time.';
  test('drops only the sentences naming the removed food', () => {
    const out = stripFoodMentions(text, 'Grilled chicken');
    expect(out).not.toMatch(/chicken/i);
    expect(out).toMatch(/rice fuels/i);
    expect(out).toMatch(/vegetable next time/i);
  });
  test('plural-tolerant and partial-name-tolerant', () => {
    expect(stripFoodMentions('Two eggs add protein. Solid plate.', 'Egg')).toBe('Solid plate.');
  });
  test('no mention → text untouched; empty inputs safe', () => {
    expect(stripFoodMentions(text, 'Salmon')).toBe(text);
    expect(stripFoodMentions('', 'Rice')).toBe('');
    expect(stripFoodMentions(text, '')).toBe(text);
  });
});

describe('analysisAgreesWithBand — score and words from one evaluation', () => {
  test('the founder bug: "keep this in rotation" cannot ride a weak-band score', () => {
    expect(analysisAgreesWithBand('Solid effort. Keep this in rotation.', { cls: 'low', label: 'Weak plate' })).toBe(false);
  });
  test('damning copy cannot ride a strong-band score', () => {
    expect(analysisAgreesWithBand('This is a weak plate for your goal.', { cls: 'good', label: 'Strong' })).toBe(false);
  });
  test('honest nuance always passes', () => {
    expect(analysisAgreesWithBand('Solid protein, light on fiber. Add produce next time.', { cls: 'mid', label: 'Needs work' })).toBe(true);
    expect(analysisAgreesWithBand('', { cls: 'low' })).toBe(true);
  });
});
