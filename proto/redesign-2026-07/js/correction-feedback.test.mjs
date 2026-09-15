/* WHAT THE ATHLETE SEES WHEN THEY CORRECT A MEAL.
 *
 * Founder, 2026-09-14, looking at a real thread: he typed "I had core power with this", the AI
 * answered "Good add, Core Power counts. Your numbers and score for this meal are updating now",
 * and nothing visibly happened. He asked for a better animation. The animation already existed
 * (corrReceipt, shipped 2026-09-07 for the same complaint) and was correctly wired to this path.
 * It showed nothing because there was nothing to show: "Core Power" was not in the curated
 * reference, and applyMealCorrection returned NULL when no named food could be priced, throwing
 * the unpriced names away with it. The AI promised; the client silently did nothing.
 *
 * So two things are pinned here. The receipt has to be worth looking at, and it must never be
 * asked to animate a change that did not happen.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { stripComments } from '../tools/strip-comments.mjs';

const JS = dirname(fileURLToPath(import.meta.url));
const MEAL = stripComments(readFileSync(join(JS, 'screens', 'meal.js'), 'utf8'));
const CSS = readFileSync(join(JS, '..', 'css', 'screens.css'), 'utf8');

/* ---- a correction that priced nothing never reaches the receipt ---------------------------- */

test('a no-op correction is spoken, not animated', () => {
  const i = MEAL.indexOf('applied.nothingPriced');
  assert.ok(i > 0, 'the thread must handle the case where nothing could be priced');
  const branch = MEAL.slice(i, i + 700);
  assert.match(branch, /setNote\(/, 'it says what it could not count');
  assert.match(branch, /have nothing on file for/, 'and names the food, because the athlete named it correctly');
  assert.match(branch, /return;/, 'and stops: there is no change to draw');
  // The receipt must be set only AFTER that early return, or it would be handed a pair of
  // identical records and asked to animate the difference between a number and itself.
  assert.ok(i < MEAL.indexOf('setCorrFx('),
    'the no-op branch has to return before the receipt is built');
});

test('the promise the AI already made is answered either way', () => {
  // Three outcomes, three sentences: it could not find the food, it found it but cannot price it,
  // or it worked. Silence is the one thing that is not allowed, because the AI has already said
  // "your numbers and score are updating now" by the time any of this runs.
  for (const phrase of [
    /didn't line up with anything/,      // the named food is not in this meal's read
    /have nothing on file for/,          // named fine, no numbers for it
    /Added what I could price/,          // some priced, some not
  ]) assert.match(MEAL, phrase, `missing the branch for ${phrase}`);
});

/* ---- the score is the answer, so the score is what turns ----------------------------------- */

test('the meal score is the last row and carries its band', () => {
  assert.match(MEAL, /score: label === 'Meal score'/, 'the score row is marked');
  assert.match(MEAL, /rows\.sort\(\(x, y\) => \(x\.score \? 1 : 0\) - \(y\.score \? 1 : 0\)\)/,
    'macros are the cause and the score is the consequence; the consequence goes last');
  assert.match(MEAL, /qualityBand\(Math\.round\(\+b\)\)/,
    'the score lands in the colour of the band it now belongs to, not in plain ink');
});

test('the turn fires once the counting has finished, never during it', () => {
  const i = MEAL.indexOf("card.classList.add('landed')");
  assert.ok(i > 0);
  // stripComments blanks comments to SPACES so byte offsets stay put; collapse them or a window
  // measured in characters is mostly whitespace.
  const after = MEAL.slice(i, i + 900).replace(/\s+/g, ' ');
  assert.match(after, /\.corr-score b'\)/);
  assert.match(after, /classList\.add\('turn'\)/);
  assert.match(after, /buzz\('reveal'\)/, 'the haptic lands with the turn, not before it');
});

/* ---- the motion itself, and the two rules it has to keep ----------------------------------- */

test('the card arrives with depth, using transforms only', () => {
  assert.match(CSS, /#corr-fx\{perspective:900px\}/, 'the perspective belongs to the row, not the card');
  assert.match(CSS, /\.corr-card:not\(\.in\)\{transform:translateY\(6px\) rotateX\(-14deg\)\}/);
  assert.match(CSS, /@keyframes corr-turn\{/);
  // DESIGN.md: never animate a layout property. Everything here has to be transform or opacity.
  const block = CSS.slice(CSS.indexOf('@keyframes corr-turn{'), CSS.indexOf('@keyframes corr-turn{') + 220);
  assert.doesNotMatch(block, /\b(width|height|top|left|margin|padding)\s*:/,
    'a keyframe that moves layout would jank the whole thread');
});

test('green is the verdict, so nothing is green until it has landed', () => {
  assert.match(CSS, /\.corr-card:not\(\.landed\) \.corr-head\{color:var\(--text-3\)\}/,
    'the heading announced the result during the wait and left "Updated" nothing to become');
  const spin = CSS.slice(CSS.indexOf('.corr-spin{'), CSS.indexOf('.corr-spin{') + 220);
  assert.doesNotMatch(spin, /green/, 'the working spinner wears the working colour');
});

test('every beat is switched off under prefers-reduced-motion', () => {
  const i = CSS.indexOf('@media (prefers-reduced-motion: reduce){', CSS.indexOf('.corr-card{'));
  const block = CSS.slice(i, i + 460);
  for (const sel of ['.corr-card', '.corr-spin', 'b.pend', 'b.turn']) {
    assert.ok(block.includes(sel), `${sel} must be neutralised for reduced motion`);
  }
});
