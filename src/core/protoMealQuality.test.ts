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
  stripFoodMentions, analysisAgreesWithBand, analysisAgreesWithNumbers, analysisAgreesWithComponents,
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
  test('BAND BOUNDARY: a plate scoring exactly 75 sits in Strong, not Needs work', () => {
    // met protein (35) + partial carbs (9) + met fat (20) + miss fiber (5) + partial timing (6) = 75
    const q = mealQualityScore({ macros: { protein: 30, carbs: 75, fat: 3 }, fiber: 0, detected: [], minutesLate: 30 });
    expect(q).toBe(75);
    expect(qualityBand(q)!.label).toBe('Strong');
    expect(qualityBand(74)!.label).toBe('Needs work'); // one point under the edge flips the band
  });
  test('BAND BOUNDARY: a plate scoring exactly 50 sits in Needs work, not Weak plate', () => {
    // miss protein (8) + met carbs (15) + partial fat (12) + miss fiber (5) + met timing (10) = 50
    const q = mealQualityScore({ macros: { protein: 10, carbs: 60, fat: 22 }, fiber: 0, detected: [], minutesLate: 0 });
    expect(q).toBe(50);
    expect(qualityBand(q)!.label).toBe('Needs work');
    expect(qualityBand(49)!.label).toBe('Weak plate'); // one point under the edge flips the band
  });
  test('TIMING EDGES: penalties change exactly at the window cutoffs (0→1 and 60→61 min late)', () => {
    const at = (minutesLate: number) => mealQualityScore({ macros: balanced, fiber: 7, detected: [], minutesLate })!;
    expect(at(0)).toBe(100);          // on the deadline = inside the window
    expect(at(1)).toBe(96);           // first late minute costs the partial (10→6)
    expect(at(60)).toBe(at(1));       // the whole 1–60 grace band costs the same
    expect(at(61)).toBe(92);          // minute 61 crosses into the miss (6→2)
    expect(at(600)).toBe(at(61));     // and it never compounds beyond that
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

/**
 * analysisAgreesWithComponents — the verdict half of the same invariant (founder escalation
 * 2026-08-11: the breakdown chips said "Protein low" while the AI's opener said "Good start on
 * protein for the day" on the same screen). Prose may never praise a component the deterministic
 * componentStates marks a miss, nor condemn one it marks met.
 */
describe('analysisAgreesWithComponents — prose verdicts must match the chips', () => {
  // The 2026-08-11 breakfast: 41g protein in a 950-kcal plate (18% of energy → protein miss,
  // fat 48g → 48% of energy → fat miss), sandwich + bacon, no produce, low fiber.
  const breakfast = { macros: { protein: 41, carbs: 78, fat: 48, kcal: 950 }, fiber: 2, detected: [{ name: 'Breakfast sandwich' }, { name: 'Bacon' }], minutesLate: 0 };
  const balancedPlate = { macros: { protein: 40, carbs: 45, fat: 15, kcal: 475 }, fiber: 7, detected: [], minutesLate: 0 };

  test('the founder bug: protein praise cannot ride a protein-miss plate', () => {
    expect(analysisAgreesWithComponents(
      "Good start on protein for the day, that foil-wrapped sandwich plus the bacon puts you in solid shape early.",
      breakfast,
    )).toBe(false);
  });
  test('criticism of a MET component fails too', () => {
    expect(analysisAgreesWithComponents('Protein came in low on this one.', balancedPlate)).toBe(false);
    expect(analysisAgreesWithComponents('Too much fat on this plate.', balancedPlate)).toBe(false);
  });
  test('fat praise cannot ride a fat-miss plate', () => {
    expect(analysisAgreesWithComponents('Fat is in a good range here.', breakfast)).toBe(false);
  });
  test('agreeing prose passes: the deterministic fallback can never re-trip the rail', () => {
    expect(analysisAgreesWithComponents('Protein came in low next to the carbs and fat and fat ran above the range.', breakfast)).toBe(true);
    expect(analysisAgreesWithComponents('Good start on protein for the day.', balancedPlate)).toBe(true);
  });
  test('honest nuance passes: each verdict judged against its own component', () => {
    // protein met + fiber miss on this plate: praising protein and flagging fiber is exactly right
    expect(analysisAgreesWithComponents('Solid protein, light on fiber. Add produce next time.',
      { macros: { protein: 40, carbs: 45, fat: 15, kcal: 475 }, fiber: 0, detected: [], minutesLate: 0 })).toBe(true);
  });
  test('clause punctuation stops the window: one macro\'s adjective never smears onto another', () => {
    expect(analysisAgreesWithComponents('Protein, carbs, and fat are in balance on this plate.', balancedPlate)).toBe(true);
  });
  test('partial components never silence prose (conservative like its siblings)', () => {
    // protein share ~22% → partial, not miss: praise passes
    expect(analysisAgreesWithComponents('Good protein here.',
      { macros: { protein: 30, carbs: 60, fat: 20, kcal: 540 }, fiber: 6, detected: [], minutesLate: 0 })).toBe(true);
  });
  test('nothing to judge, nothing to contradict', () => {
    expect(analysisAgreesWithComponents('Good start on protein.', { macros: {}, fiber: 0, detected: [] })).toBe(true);
    expect(analysisAgreesWithComponents('', breakfast)).toBe(true);
  });
});

/**
 * analysisAgreesWithNumbers — the numeric half of the same invariant (founder call 2026-08-02:
 * "the Meal Breakdown is the single source of truth"). The model writes its paragraph against its
 * OWN estimate; grounding then re-derives the macros against the food DB. Prose quoting a figure
 * the breakdown will not show is dropped, so the thread bubble and the card can never disagree.
 */
describe('analysisAgreesWithNumbers — prose figures must match the grounded breakdown', () => {
  const truth = { protein: 29, carbs: 48, fat: 42, kcal: 660, fiber: 2 };

  test('the founder bug: the model\'s own 23g cannot ride a grounded 29g read', () => {
    expect(analysisAgreesWithNumbers("I'd put it around 23g of protein and 660 calories.", truth)).toBe(false);
  });

  test('the figure that matches passes, in either word order', () => {
    expect(analysisAgreesWithNumbers('That is about 29g of protein and 660 calories.', truth)).toBe(true);
    expect(analysisAgreesWithNumbers('Protein lands near 30g here.', truth)).toBe(true);
  });

  test('a hedged range passes when the grounded value falls inside it', () => {
    // The system prompt actively ASKS for ranges on a photo estimate, so this must never fail.
    expect(analysisAgreesWithNumbers('Roughly 25 to 34g of protein on this plate.', truth)).toBe(true);
    expect(analysisAgreesWithNumbers('Roughly 40 to 55g of protein on this plate.', truth)).toBe(false);
  });

  test('rounding is allowed, contradiction is not', () => {
    expect(analysisAgreesWithNumbers('About 31g of protein.', truth)).toBe(true);   // within 10%
    expect(analysisAgreesWithNumbers('About 640 calories.', truth)).toBe(true);     // within 30 kcal
    expect(analysisAgreesWithNumbers('About 1200 calories.', truth)).toBe(false);
  });

  test('bare numbers describing the plate never fail the prose', () => {
    // "6 to 8 strips" and "2 eggs" are descriptions of the food, not claims about the totals.
    expect(analysisAgreesWithNumbers('Looks like 6 to 8 strips of bacon and 2 eggs.', truth)).toBe(true);
    expect(analysisAgreesWithNumbers('About 3 to 4 french toast sticks and 1 cup of home fries.', truth)).toBe(true);
  });

  test('carbs, fat and fiber are held to the same standard', () => {
    expect(analysisAgreesWithNumbers('Around 48g of carbs and 42g of fat.', truth)).toBe(true);
    expect(analysisAgreesWithNumbers('Only 5g of carbs here.', truth)).toBe(false);
    expect(analysisAgreesWithNumbers('That is 2g of fiber.', truth)).toBe(true);
    expect(analysisAgreesWithNumbers('That is 25g of fiber.', truth)).toBe(false);
  });

  test('silence is not disagreement', () => {
    expect(analysisAgreesWithNumbers('Good timing. Get some produce on the next plate.', truth)).toBe(true);
    expect(analysisAgreesWithNumbers('', truth)).toBe(true);
    // A macro the grounded read does not carry can never fail the prose.
    expect(analysisAgreesWithNumbers('Around 9g of fiber.', { protein: 29, kcal: 660 })).toBe(true);
    expect(analysisAgreesWithNumbers('Around 9g of fiber.', null)).toBe(true);
  });
});
