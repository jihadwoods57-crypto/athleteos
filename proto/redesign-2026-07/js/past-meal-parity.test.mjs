/* A past meal wears the SAME design as today's (founder 2026-09-14).
 *
 * The past-meal screen (trust.js mealView) was a simpler twin of the meal thread, written
 * separately, and the difference showed the moment an athlete opened yesterday's plate. The read
 * card and the breakdown are now one function in meal.js that both screens call; this pins that
 * the twin cannot come back, structurally, against the source. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const src = (p) => readFileSync(join(HERE, p), 'utf8');

test('the read card + breakdown is one exported function, and today\'s thread calls it', () => {
  const meal = src('screens/meal.js');
  assert.match(meal, /export function mealReadHtml\(M, \{ exec = null, past = false, viewer = 'athlete', targets = null, planStyle = null, dayTotals = null \} = \{\}\)/);
  assert.match(meal, /const \{ photoBlock, breakdown \} = mealReadHtml\(M, \{ exec: e \}\);/, 'the meal thread renders through it');
  // The function owns the sections, not the render: neither block is built inline any more.
  assert.equal((meal.match(/const photoBlock = `/g) || []).length, 1);
  assert.equal((meal.match(/const breakdown = !settled \?/g) || []).length, 1);
  // A past plate projects nothing and cannot be re-read.
  assert.match(meal, /const mealsLeft = past \? 0 :/);
  assert.match(meal, /!past && M\.mealId \? ` <span class="link" id="mt-reread"/);
});

test('the past-meal screen renders the same four blocks through the same function', () => {
  const trust = src('screens/trust.js');
  assert.match(trust, /import \{ mealReadHtml, wireReadControls \} from '\.\/meal\.js';/);
  assert.match(trust, /export function pastMealDetail\(m\)/, 'a meals row is mapped to the mealDetail() shape');
  assert.match(trust, /mealReadHtml\(M, \{ exec: null, past: true, dayTotals: pastDayTotalsThrough\(m\) \}\)/);
  // The logged confirmation is the same slim status line today's meal wears (2026-09-22): the
  // bordered .mt-confirm card was retired on the live thread 09-15 and lingered here alone.
  assert.match(trust, /<div class="lm-status">/, 'the logged status line');
  assert.doesNotMatch(trust, /<section class="mt-confirm">/, 'the retired confirmation card');
  assert.match(trust, /<section class="disc" id="meal-disc"/, 'the Team discussion section');
  assert.match(trust, /<div class="chat-dock disc-dock dock-end">/, 'the docked composer, flush with the bottom edge');
  assert.match(trust, /class="disc-open" id="open-full-chat"/, 'the aimed door to the full chat');
  assert.match(trust, /`nutrition-chat\/\$\{m\.id\}`/);
  assert.match(trust, /hideTabs: true/, 'no tab bar over a logged meal, as on today\'s');
  // The old twin's own blocks are gone.
  assert.doesNotMatch(trust, /<h2 class="eyebrow">Nutrition<\/h2>/);
  assert.doesNotMatch(trust, /<h2 class="eyebrow">Conversation<\/h2>/);
  assert.doesNotMatch(trust, /class="ai-note"/);
  assert.doesNotMatch(trust, /miniDial/);
});
