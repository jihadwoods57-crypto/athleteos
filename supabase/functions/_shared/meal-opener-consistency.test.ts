/**
 * THE MEAL BREAKDOWN IS THE SINGLE SOURCE OF TRUTH (founder call 2026-08-02).
 *
 * This is the seam test for that rule. It wires the two halves that used to disagree — the CLIENT's
 * groundResult (which produces the object the Meal Breakdown card renders) and the SERVER's
 * composeOpenerText (which writes the AI nutritionist's opening message into the thread) — and
 * pins that every figure the bubble states is a figure the card shows.
 *
 * WHAT WENT WRONG. analyze-meal composed and inserted that bubble itself, inline with the analysis,
 * from the model's RAW tool output. groundMacros on the server is a documented passthrough, so those
 * were the model's own estimates. The client then re-derived every macro against the food DB and
 * recomputed the score deterministically, and rendered THAT. The athlete got a card reading ~29g of
 * protein and a weak-plate score of 44, sitting directly above an AI message saying "I'd put it
 * around 23g of protein" and crediting them for "decent protein from the bacon". The AI was doing a
 * second visual estimate and reporting it as fact.
 *
 * The fix is structural: the server no longer posts from the analysis, and the client hands the
 * FINISHED read back through mode 'opener'. These tests fail if anything reintroduces a second
 * estimate — they compare the bubble against groundResult's own output rather than hard-coded
 * numbers, so they cannot rot as the food DB or the scoring formula move.
 */
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost' });
(globalThis as any).window = dom.window;
(globalThis as any).document = dom.window.document;
(globalThis as any).localStorage = dom.window.localStorage;

/* eslint-disable @typescript-eslint/no-var-requires */
const { groundResult, MEAL } = require('../../../proto/redesign-2026-07/js/state.js');
import { composeOpenerText } from './meal-opener';

beforeEach(() => {
  MEAL.key = 'breakfast';
  MEAL.capturedAtMin = 7 * 60 + 39; // 7:39 AM — inside the breakfast window, on time
});

/**
 * The founder's plate, as the wire actually carries it: the model's own estimate, with per-food
 * macro attribution that does NOT add up to the totals it reported. Grounding re-derives the
 * totals from the foods, which is exactly the step that moves the number out from under the
 * paragraph the model already wrote.
 */
const rawPayload = () => ({
  kind: 'result',
  name: 'Bacon, french toast sticks and home fries',
  quality: 71,          // the model's own generous score; the app computes its own and shows that
  protein: 23, kcal: 660, carbs: 48, fat: 42, fiber: 2,
  detected: [
    { name: 'Bacon', confidence: 'high', quantity: '6-8 strips', protein: 24, kcal: 370, carbs: 1, fat: 35 },
    { name: 'French toast sticks', confidence: 'high', quantity: '3-4 sticks', protein: 6, kcal: 230, carbs: 30, fat: 9 },
    { name: 'Home fries', confidence: 'high', quantity: '1 cup', protein: 4, kcal: 210, carbs: 30, fat: 9 },
  ],
  highlights: [],
  note: 'Heavy on fat for a breakfast.',
  analysis: "I'd put this around 23g of protein and 660 calories, so you're getting decent protein from the bacon.",
});

/**
 * The `read` payload EXACTLY as act._postMealOpener puts it on the wire. Mirrored rather than
 * approximated on purpose: passing the grounded object straight through looks equivalent but is
 * not, because `detected` on it is a plain string array for legacy consumers while the composer
 * needs the rich rows (it reads .name and .confidence off them). Getting that wrong silently drops
 * the "I can see ..." sentence and the uncertainty hedge, which is precisely the kind of quiet
 * divergence this file exists to catch.
 */
const readFor = (grounded: any) => ({
  name: grounded.name, quality: grounded.quality,
  protein: grounded.protein, kcal: grounded.kcal, carbs: grounded.carbs, fat: grounded.fat,
  fiber: grounded.fiber,
  detected: grounded.detectedRich || [],
  note: grounded.note, analysis: grounded.analysis, highlights: grounded.highlights || [],
});

const dayFor = (grounded: any, over: Record<string, unknown> = {}) => ({
  proteinIncludingThisMeal: grounded.protein,
  proteinTarget: 155,
  mealsRemaining: 2,
  ...over,
});

/** groundResult -> the wire -> the composer, end to end, the way production runs it. */
const bubbleFor = (grounded: any, over: Record<string, unknown> = {}) => composeOpenerText(readFor(grounded), {
  planStyle: 'structured', late: false, mealName: 'Breakfast', day: dayFor(grounded), ...over,
});

describe('the thread bubble never re-states the breakdown card — and never re-estimates it', () => {
  // The contract sharpened on 2026-08-04: the bubble used to be REQUIRED to quote the grounded
  // macros (proof it wasn't a second estimate). Now the founder's rule is stronger — the card is
  // on screen, so the bubble states NO meal-macro figures at all. No figures ⇒ no figure can
  // disagree with the card ⇒ the single-source-of-truth invariant holds by construction.
  it('states no macro figure for the plate at all — the card owns those numbers', () => {
    const grounded = groundResult(rawPayload());
    const bubble = bubbleFor(grounded);
    expect(bubble).not.toContain("I'd put it around");
    expect(bubble).not.toContain(`${grounded.protein}g`);
    expect(bubble).not.toContain(`${grounded.kcal} calories`);
    expect(bubble).not.toContain(`${rawPayload().protein}g of protein`);
  });

  it('does not list the foods back — the athlete is looking at the photo', () => {
    const grounded = groundResult(rawPayload());
    const bubble = bubbleFor(grounded).toLowerCase();
    expect(bubble).not.toContain('i can see');
    expect(bubble).not.toContain('bacon, french toast sticks and home fries');
  });

  it('drops the model\'s paragraph when its figures contradict the grounded read', () => {
    // The raw analysis hard-codes "23g of protein". Grounding moved protein, so the numeric rail in
    // groundResult drops that prose rather than letting it ride onto the card and into the thread.
    const grounded = groundResult(rawPayload());
    expect(grounded.analysis).toBe('');
    expect(grounded.note).not.toContain('23g');

    const bubble = bubbleFor(grounded);
    expect(bubble).not.toContain('23g');
    expect(bubble).not.toContain('decent protein from the bacon');
  });

  it('keeps the model\'s paragraph when it agrees — the AI still coaches, it just cannot re-estimate', () => {
    // Same plate, but the model wrote prose with no macro figures in it. Nothing to contradict, so
    // the athlete keeps the richer read. A rail that silenced this would be worse than no rail.
    const grounded = groundResult({
      ...rawPayload(),
      analysis: 'The carbs here are almost entirely refined and fried, with no fruit or vegetable in sight. Get some produce on the next plate.',
    });
    expect(grounded.analysis).toContain('almost entirely refined');
    expect(bubbleFor(grounded)).toContain('almost entirely refined');
  });

  it('frames the day FORWARD from the grounded total — the gap, not a progress restatement', () => {
    const grounded = groundResult(rawPayload());
    const bubble = bubbleFor(grounded);
    const gap = 155 - grounded.protein;
    expect(bubble).toContain(`About ${gap}g of protein still to go across your last 2 required meals`);
    expect(bubble).not.toContain('That puts you near');
    expect(bubble).not.toContain('near 0 of 155g');
  });

  it('says which meals it is counting, so it cannot read against the log card\'s counter', () => {
    expect(bubbleFor(groundResult(rawPayload()))).toContain('required meals');
  });

  it('sanitized client patterns ride through to the bubble', () => {
    const grounded = groundResult({
      ...rawPayload(),
      analysis: 'The carbs here are almost entirely refined and fried, with no fruit or vegetable in sight.',
    });
    const bubble = bubbleFor(grounded, { patterns: ["You've logged breakfast on time 3 days running."] });
    expect(bubble).toContain('3 days running');
  });

  it('an Intuitive athlete still sees no figure anywhere in it', () => {
    const bubble = bubbleFor(groundResult(rawPayload()), { planStyle: 'intuitive' });
    expect(bubble).not.toMatch(/\d+\s*(?:g|grams?|kcal|calories)/i);
    expect(bubble).not.toContain('155');
  });
});
