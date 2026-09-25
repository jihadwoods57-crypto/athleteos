/* The local read and the stored read are drawn the same way (2026-09-25).
   The meal page paints a read composed on this device (meal-intel.js openingMessage) the instant
   it lands, then swaps it for the row analyze-meal stores (meal-opener.ts composeOpener) a beat
   later. The server joined its parts with a paragraph break and the client with a space, so the
   same read jumped from 3 bubbles (the old-row heuristic) to 6 on the swap. Both now separate
   their parts with "\n\n", so the thread draws the same number of texts either side of the swap. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { openingMessage } from './meal-intel.js';
import { splitAiText } from './thread-polish.js';
import { composeOpener } from '../../../supabase/functions/_shared/meal-opener.ts';

const analysis = 'Solid lunch. The chicken carries it and the corn gives you real carbs for the afternoon.';
const pattern = "You've hit your protein bar in 3 of your last 4 lunches.";
const highlight = 'Cabbage slaw adds fiber and vitamin C';
const detected = [
  { name: 'Grilled chicken', confidence: 'high', quantity: '6 oz' },
  { name: 'Sour cream', confidence: 'low' },
];
const texts = (s) => splitAiText(s, { opener: true });

test('the same read gives the same number of texts on this device and from the server', () => {
  const cases = [
    { day: { proteinSoFar: 90, proteinTarget: 180, mealsRemaining: 2 }, late: true },
    { day: { proteinSoFar: 120, proteinTarget: 180, mealsRemaining: 1 }, late: false },
    { day: { proteinSoFar: 190, proteinTarget: 180, mealsRemaining: 1 }, late: false },
    { day: null, late: true },
  ];
  for (const { day, late } of cases) {
    const local = openingMessage({
      name: 'Lunch', quality: 84, analysis, highlights: [highlight], late, detected, source: 'live',
      day, patterns: [pattern],
    });
    const server = composeOpener({ name: 'Lunch', analysis, highlights: [highlight], detected }, {
      planStyle: 'structured', late, mealName: 'Lunch', patterns: [pattern],
      day: day ? { proteinIncludingThisMeal: day.proteinSoFar, proteinTarget: day.proteinTarget, mealsRemaining: day.mealsRemaining } : null,
    }).text;
    assert.ok(local.includes('\n\n'), 'the local read separates its parts');
    assert.equal(texts(local).length, texts(server).length, JSON.stringify({ day, late, local: texts(local), server: texts(server) }));
  }
});

test('the local read keeps its words: only the spacing between parts changed', () => {
  const local = openingMessage({ name: 'Lunch', quality: 84, analysis, late: true, detected, source: 'live',
    day: { proteinSoFar: 90, proteinTarget: 180, mealsRemaining: 2 }, patterns: [pattern], impact: 13 });
  for (const t of local.split('\n\n')) assert.equal(t, t.trim());
  assert.doesNotMatch(local, /\n{3,}/);
  assert.match(local.replace(/\n\n/g, ' '), /Land around 45g of protein at each of your last 2 meals/);
});
