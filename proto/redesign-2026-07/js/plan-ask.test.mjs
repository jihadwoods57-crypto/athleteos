/* Ask OnStandard — the engine's contract.
 *
 * The tests that matter here are the NEGATIVE ones: a question about a restaurant this athlete
 * has never logged must answer "nothing saved yet", and a question outside the plan must refuse
 * rather than produce nutrition advice. The screen this replaced returned a confident, invented
 * Chipotle order to an athlete with no Chipotle in their history, so "it declines" is the
 * requirement, not a nicety.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  answerAsk, askSuggestions, matchPlace, matchRequirement, itemsAtPlace, remainingPhrase,
} from './plan-ask.js';

const ctx = (over = {}) => ({
  hasCoach: true, coachNoun: 'coach', styleName: 'Guided',
  styleHow: 'Flexible ranges instead of exact numbers.',
  hasTargets: true,
  targets: { protein: 180, calories: 3200, weight: 175 },
  remaining: { protein: 55, kcal: 980 },
  weights: [
    { key: 'Nutrition', pct: 52 }, { key: 'Recovery', pct: 25 },
    { key: 'Daily commitment', pct: 13 }, { key: 'Weekly check-in', pct: 10 },
  ],
  nutritionParts: [{ label: 'Protein', pct: 20 }, { label: 'Calories', pct: 30 }],
  places: [{ name: 'Subway' }, { name: 'Chipotle' }],
  items: [
    { id: 'i1', name: 'Usual Subway order', place: 'Subway', kcal: 720, protein: 42, times_logged: 6 },
    { id: 'i2', name: 'Chicken bowl', place: 'Chipotle', kcal: 1010, protein: 55, times_logged: 4 },
    { id: 'i3', name: 'Overnight oats', kcal: 480, protein: 30, times_logged: 9 },
  ],
  facts: [{ kind: 'favorite_food', value: 'greek yogurt' }],
  requirements: [
    { id: 'weight', title: 'Morning Weight', freqLabel: 'Required Mon / Wed / Fri', dueLabel: 'Due by 9:00 AM',
      proofLabel: 'Scale entry', impactLabel: 'Season trend · not scored', scored: false,
      note: 'Same time, same conditions.', setBy: 'Coach Ruiz', effectiveDate: 'Aug 1',
      dayWords: ['monday', 'wednesday', 'friday'] },
    { id: 'lunch', title: 'Lunch', freqLabel: 'Required daily', dueLabel: 'Due by 2:00 PM',
      proofLabel: 'Photo proof', impactLabel: 'Nutrition · 52% of score', scored: true, note: '' },
  ],
  today: [
    { title: 'Breakfast', sub: 'Logged at 8:10 AM', done: true },
    { title: 'Lunch', sub: 'Due by 2:00 PM', done: false },
  ],
  slotTitles: { lunch: 'Lunch' },
  slotDue: { lunch: '2:00 PM' },
  nextSlot: 'Lunch',
  ...over,
});

test('a place the athlete actually eats answers with their own saved order', () => {
  const a = answerAsk('Can I eat Subway and stay on plan?', ctx());
  assert.equal(a.kind, 'answer');
  assert.equal(a.title, 'Subway');
  const body = a.lines.join('\n');
  assert.match(body, /Usual Subway order/);
  assert.match(body, /720 cal/);
  assert.match(body, /fits/);
});

test('a usual that busts what is left is reported as over, not silently endorsed', () => {
  // 1010 cal against 400 left. The verdict is rankForRemaining's own `over` flag (which carries a
  // 15% grace) so this surface and the What-to-eat card can never disagree about the same plate.
  const a = answerAsk('Can I eat Chipotle and stay on plan?', ctx({ remaining: { protein: 20, kcal: 400 } }));
  assert.match(a.lines.join('\n'), /runs over/);
  const fits = answerAsk('Can I eat Chipotle and stay on plan?', ctx({ remaining: { protein: 55, kcal: 1600 } }));
  assert.match(fits.lines.join('\n'), /your usual fits/);
});

test('a restaurant with nothing saved never invents an order', () => {
  const a = answerAsk('Can I eat Panda Express and stay on plan?', ctx());
  const body = a.lines.join('\n');
  assert.doesNotMatch(body, /Panda Express.*(bowl|chicken|rice|order is)/i);
  // It is allowed to say it doesn't know, and must say what the real number to judge against is.
  assert.match(`${a.title} ${body}`, /outside what I can answer|980 calories/);
});

test('"what do I normally order at Chipotle" reads memory back', () => {
  const a = answerAsk('What do I normally order at Chipotle?', ctx());
  assert.equal(a.title, 'Chipotle');
  assert.match(a.lines.join('\n'), /Chicken bowl/);
});

test('"why do I weigh in Monday" resolves Morning Weight and states it is not scored', () => {
  const a = answerAsk('Why do I weigh in Monday?', ctx());
  assert.equal(a.title, 'Morning Weight');
  const body = a.lines.join('\n');
  assert.match(body, /Mon \/ Wed \/ Fri/);
  assert.match(body, /never moves your daily number/);
  assert.match(body, /Coach Ruiz/);
});

test('"what should I eat for lunch" names the window and ranks the athlete\'s own meals', () => {
  const a = answerAsk('What should I eat for lunch?', ctx());
  const body = a.lines.join('\n');
  assert.match(body, /980 calories and 55g protein/);
  assert.match(body, /Lunch is due by 2:00 PM/);
  assert.match(body, /Overnight oats|Usual Subway order|Chicken bowl/);
});

test('with no saved meals it says so instead of suggesting generic food', () => {
  const a = answerAsk('What should I eat next?', ctx({ items: [], places: [] }));
  const body = a.lines.join('\n');
  assert.match(body, /Nothing is saved in your Food Memory yet/);
  assert.doesNotMatch(body, /chicken|rice|salad/i);
});

test('the score answer sums to 100 and comes from the passed weights, never a constant', () => {
  const a = answerAsk('How is my score built?', ctx());
  assert.match(a.lines.join('\n'), /Nutrition: 52%/);
  assert.match(a.lines.join('\n'), /That's 100% of the score/);
  const shifted = answerAsk('How is my score built?', ctx({
    weights: [{ key: 'Nutrition', pct: 40 }, { key: 'Recovery', pct: 35 }, { key: 'Daily commitment', pct: 15 }, { key: 'Weekly check-in', pct: 10 }],
  }));
  assert.match(shifted.lines.join('\n'), /Nutrition: 40%/);
});

test('an off-plan question refuses instead of answering', () => {
  const a = answerAsk('Is creatine safe for a 15 year old?', ctx());
  assert.equal(a.kind, 'unknown');
  assert.match(a.lines.join('\n'), /won't guess/);
  assert.ok(a.chips.some((c) => c.go === 'messages'), 'routes to a human when one exists');
});

test('an unlinked athlete is never offered a coach that does not exist', () => {
  const a = answerAsk('Is creatine safe?', ctx({ hasCoach: false }));
  assert.ok(!a.chips.some((c) => c.go === 'messages'));
});

test('"what\'s due today" lists only what is still open, with the count', () => {
  const a = answerAsk("What's due today?", ctx());
  const body = a.lines.join('\n');
  assert.match(body, /Lunch: Due by 2:00 PM/);
  assert.doesNotMatch(body, /• Breakfast/);
  assert.match(body, /1 of 2 done/);
});

test('no targets set: the nutrition answer states that plainly and offers the real path', () => {
  const a = answerAsk('How is my nutrition scored?', ctx({ hasTargets: false, targets: null }));
  assert.match(a.lines.join('\n'), /No calorie or protein target is set/);
  assert.match(a.lines.join('\n'), /Nutrition is 52% of your daily score/);
});

test('suggestions only name a place the athlete actually has', () => {
  assert.ok(askSuggestions(ctx(), 'overview').some((s) => s.includes('Subway')));
  const bare = askSuggestions(ctx({ places: [] }), 'overview');
  assert.ok(!bare.some((s) => /Subway|Chipotle/.test(s)));
  assert.ok(bare.length && bare.length <= 4);
});

test('suggestions differ by area and stay answerable', () => {
  for (const area of ['overview', 'nutrition', 'requirements', 'memory']) {
    for (const q of askSuggestions(ctx(), area)) {
      const a = answerAsk(q, ctx());
      assert.equal(a.kind, 'answer', `suggested but unanswerable in ${area}: ${q}`);
    }
  }
});

test('helpers: place matching prefers the longest name and ignores unknown text', () => {
  assert.equal(matchPlace('subway for lunch', ctx()), 'Subway');
  assert.equal(matchPlace('somewhere else', ctx()), null);
  assert.equal(itemsAtPlace('Subway', ctx()).length, 1);
  assert.equal(remainingPhrase({ protein: 20, kcal: null }), '20g protein');
  assert.equal(remainingPhrase({ protein: null, kcal: null }), '');
  assert.equal(matchRequirement('when is lunch due', ctx()).id, 'lunch');
  assert.equal(matchRequirement('tell me about the moon', ctx()), null);
});

test('an empty question is not an answer', () => {
  assert.equal(answerAsk('', ctx()), null);
  assert.equal(answerAsk('   ', ctx()), null);
});
