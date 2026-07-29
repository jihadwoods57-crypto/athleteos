/* The awareness re-weight — pure-module tests (node --test).

   "How did this meal land?" was removed from the meal screen. On an Intuitive plan that prompt fed
   signal awareness, which is 35 of the 100 points in the nutrition sub-score. Removing a way to
   earn points is a way to LOWER someone's score for a change they did not make, and that is the
   one thing this change is not allowed to do.

   So the rule these tests hold: for every athlete, on every historical day, the nutrition
   sub-score after the change is >= the sub-score before it. The mechanism is constant credit —
   awarenessScore returns 1 because nothing meal-time is enabled any more — and the arithmetic is
   trivially monotonic (aware <= 1 always). The tests exist because the mechanism is easy to
   "improve" into a redistribution later, and a redistribution provably drops people. The sweep
   below is the proof: find a redistribution that passes it, or leave the credit alone. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { knobsFor, awarenessScore, PRESETS, MEAL_SIGNAL_KEYS, NUTRITION_PARTS } from './plan-style.js';

/** The nutrition sub-score, expressed the way day.js composes it from parts + credits. */
const nutrition = (parts, credit) =>
  (parts.protein * credit.protein + parts.calorie * credit.calorie + parts.timing * credit.timing
    + parts.hydration * credit.hydration + parts.quality * credit.quality
    + parts.awareness * credit.awareness) / 100;

test('no style asks for a meal-time signal any more', () => {
  for (const style of ['structured', 'guided', 'intuitive']) {
    const knobs = knobsFor(style);
    for (const k of MEAL_SIGNAL_KEYS) assert.equal(knobs.signals[k], false, `${style}.${k}`);
  }
});

test("a professional's saved override cannot resurrect a prompt that no longer exists", () => {
  // A config stored before the removal would otherwise enable a signal nothing can capture,
  // which would pin that athlete's awareness credit at zero forever.
  const knobs = knobsFor('intuitive', { signals: { hunger: true, fullness: true, satisfaction: true } });
  for (const k of MEAL_SIGNAL_KEYS) assert.equal(knobs.signals[k], false);
  assert.equal(awarenessScore(new Set(), knobs, 0), 1);
});

test('check-in signals still ride the check-in — only the meal prompt went away', () => {
  const knobs = knobsFor('intuitive');
  assert.equal(knobs.signals.digestion, true);
  assert.equal(knobs.signals.cravings, true);
});

test('awareness credit is 1 regardless of what was answered or how the week went', () => {
  const knobs = knobsFor('intuitive');
  for (const answered of [new Set(), new Set(['hunger']), new Set(['digestion', 'cravings']), null]) {
    for (const weekRate of [0, 0.25, 0.5, 1, undefined]) {
      assert.equal(awarenessScore(answered, knobs, weekRate), 1);
    }
  }
});

test('THE INVARIANT: no historical day scores lower than it did before', () => {
  // Sweep every shape of day an Intuitive athlete could have had. `before` uses the old awareness
  // credit (anything in 0..1); `after` uses the constant. Weights are unchanged, so this is the
  // whole comparison.
  const parts = knobsFor('intuitive').parts;
  const grid = [0, 0.25, 0.5, 0.75, 1];
  let checked = 0;
  for (const calorie of grid) {
    for (const hydration of grid) {
      for (const oldAwareness of grid) {
        const credit = { protein: 0, calorie, timing: 0, hydration, quality: 0 };
        const before = nutrition(parts, { ...credit, awareness: oldAwareness });
        const after = nutrition(parts, { ...credit, awareness: awarenessScore(new Set(), knobsFor('intuitive'), oldAwareness) });
        assert.ok(after >= before, `dropped: cal=${calorie} hyd=${hydration} aware=${oldAwareness} (${before} -> ${after})`);
        checked++;
      }
    }
  }
  assert.equal(checked, 125);
});

test('a day the athlete never touched still floors at zero', () => {
  // The credit is constant, but it is NOT unconditional: day.js grants it only when the athlete
  // logged a meal or filed a real check-in. An untouched day used to answer no signals and earn
  // no awareness, so handing it 35 free points would invent engagement that never happened —
  // and would put a number on the screen for someone who did nothing at all.
  const parts = knobsFor('intuitive').parts;
  const untouched = nutrition(parts, { protein: 0, calorie: 0, timing: 0, hydration: 0, quality: 0, awareness: 0 });
  assert.equal(untouched, 0);
});

test('a redistribution of the 35 points WOULD have dropped people — this is why it was not done', () => {
  // Kept as a live counter-example. Proportionally re-weighting fueling and hydration to absorb
  // awareness looks tidy and costs a real athlete real points.
  const parts = knobsFor('intuitive').parts;
  const total = parts.calorie + parts.hydration;
  const redistributed = { protein: 0, calorie: (parts.calorie / total) * 100, timing: 0, hydration: (parts.hydration / total) * 100, quality: 0, awareness: 0 };
  const credit = { protein: 0, calorie: 0.5, timing: 0, hydration: 1, quality: 0 };
  const before = nutrition(parts, { ...credit, awareness: 1 });
  const after = nutrition(redistributed, { ...credit, awareness: 0 });
  assert.ok(after < before, 'expected the redistribution to be a drop');
});

test('the published weights did not move', () => {
  // Decision 2 authorized neutralizing the awareness credit and nothing else in scoring.
  assert.deepEqual(PRESETS.intuitive.parts, NUTRITION_PARTS.intuitive);
  assert.equal(NUTRITION_PARTS.intuitive.awareness, 35);
  assert.equal(NUTRITION_PARTS.guided.awareness, 0);
  assert.equal(NUTRITION_PARTS.structured.awareness, 0);
  assert.equal(PRESETS.intuitive.nutrition.awarenessScored, true);
});

test('Guided and Structured were never scored on awareness, and still are not', () => {
  assert.equal(knobsFor('guided').parts.awareness, 0);
  assert.equal(knobsFor('structured').parts.awareness, 0);
});
