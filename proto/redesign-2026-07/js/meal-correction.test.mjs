/* A LOGGED MEAL CAN BE UNDONE AND MOVED (impeccable critique, 2026-09-16).
 *
 * Logging was the highest-frequency action in the product and it was irreversible. There was no
 * delete, no undo, and no way to move a plate into the slot it actually belonged to: grep the
 * proto for dayUnlogMeal / dayMoveMeal / deleteMeal before this change and the only hits are on
 * meal COMMENTS. Photograph lunch at 2pm on a day breakfast was never logged and it files against
 * breakfast, permanently, in the row the coach reads. The only correction path was the AI chat,
 * scoped by its own copy to "the name, numbers and score update together" — not existence, not
 * slot. A three-second mistake became a durable, visible, unfixable failure, on the product whose
 * whole promise is honest accountability.
 *
 * The invariants this pins are the ones that keep the repair from becoming a loophole:
 *
 *   NEVER OVERWRITES — a move only ever targets an OPEN slot, so correcting one plate can never
 *   destroy a second one.
 *
 *   NEVER LAUNDERS TIME — the logged-at minute travels WITH the meal. Moving a 2:10pm plate into
 *   breakfast makes it a late breakfast, because that is what happened. Resetting the clock on a
 *   move would be a way to buy back late credit.
 *
 *   NEVER CELEBRATES A DROP — deleting lowers the score. RT.lastMove drives the "+N" ring reveal,
 *   so unlog CLEARS it rather than setting it; a stale move left there would replay an old gain
 *   over the new, lower number.
 *
 *   ALWAYS REACHES THE COACH — both writes mirror to the `meals` row through the same outbox the
 *   existing corrections use, so a coach can never keep reading a plate the athlete took back.
 *   RLS already allows both (0002_rls.sql meals_update / meals_delete are is_self), which is why
 *   this needs no migration and no definer door.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { stripComments } from '../tools/strip-comments.mjs';

const JS = dirname(fileURLToPath(import.meta.url));
const read = (p) => stripComments(readFileSync(join(JS, p), 'utf8'));

const day = read('day.js');
const state = read('state.js');
const meal = read('screens/meal.js');
const css = readFileSync(join(JS, '..', 'css', 'screens.css'), 'utf8');

const dayMove = day.slice(day.indexOf('export function dayMoveMeal'));
const dayUnlog = day.slice(day.indexOf('export function dayUnlogMeal'), day.indexOf('export function dayMoveMeal'));

test('day.js exposes the two inverses of dayLogMeal', () => {
  assert.match(day, /export function dayUnlogMeal\(key\)/);
  assert.match(day, /export function dayMoveMeal\(from, to\)/);
  // dayLogMeal writes exactly three things; the inverse has to clear the same three.
  assert.match(dayUnlog, /DAY\.meals\[key\] = false/);
  assert.match(dayUnlog, /delete DAY\.mealLoggedAt\[key\]/);
  assert.match(dayUnlog, /delete DAY\.slotMacros\[key\]/);
});

test('a move can never overwrite a slot that already holds a meal', () => {
  assert.match(dayMove, /if \(DAY\.meals\[to\]\) return false/,
    'an occupied target must be refused outright');
  assert.match(dayMove, /if \(!DAY\.meals\[from\]\) return false/,
    'there must be something logged to move');
  assert.match(dayMove, /if \(from === to\) return false/);
  // And the UI must only ever offer open slots in the first place.
  const targets = state.slice(state.indexOf('moveTargetsFor(slot) {'), state.indexOf('moveMeal(from, to) {'));
  assert.match(targets, /!DAY\.meals\[k\]/, 'only open slots may be offered as move targets');
  assert.match(targets, /Object\.keys\(DAY\.meals/,
    'the slot set must come from the day itself, so a coach standard of meal-1..meal-6 works too');
});

test('a move carries the logged-at minute with it, so late credit cannot be bought back', () => {
  assert.match(dayMove, /DAY\.mealLoggedAt\[to\] = DAY\.mealLoggedAt\[from\]/,
    'the logged-at minute must travel with the meal, not reset');
  assert.doesNotMatch(dayMove, /minutesNow\(\)/,
    'a move must never re-stamp the clock — that would be a way to launder a late log');
});

test('deleting never plays the celebratory score reveal', () => {
  const unlog = state.slice(state.indexOf('unlogMeal(slot) {'), state.indexOf('_mirrorMeal(mealId, kind, fields) {'));
  assert.match(unlog, /RT\.lastMove = null/,
    'a drop must clear the ring reveal, never set it');
  assert.doesNotMatch(unlog, /RT\.lastMove = \{/,
    'unlog must not write a move object at all');
  assert.match(unlog, /pushDay\(RT\.userId\)/, 'the day row must be pushed');
});

test('both writes mirror to the coach-visible meals row, with an outbox behind them', () => {
  const mirror = state.slice(state.indexOf('_mirrorMeal(mealId, kind, fields) {'));
  assert.match(mirror, /from\('meals'\)\.delete\(\)\.eq\('id', mealId\)\.eq\('athlete_id', RT\.userId\)/,
    'a delete must be scoped to the athlete\'s own row');
  assert.match(mirror, /SQ\.putJob/, 'a failed mirror must land in the outbox, never be dropped');
  // And the drain has to know the new kind, or a queued delete would sit forever.
  assert.match(state, /job\.kind === 'meal-delete'/,
    'the sync drain must handle meal-delete or the queue never heals');
});

test('the correction row is athlete-only, today-only, and arms before deleting', () => {
  assert.match(meal, /\(!you \|\| past\) \? '' : correctionRow\(M\.slot\)/,
    'a coach viewing an athlete, and any past day, must not get these controls');
  assert.match(meal, /data-move="\$\{esc\(t\.key\)\}"/);
  assert.match(meal, /data-unlog="\$\{esc\(slot\)\}"/);
  // Two-tap arming, the same idiom Home uses to spend a pass.
  assert.match(meal, /if \(armedDel !== delBtn\)/, 'delete must arm before it fires');
  assert.match(meal, /Delete for good\?/, 'the armed state must name what it does');
  assert.match(meal, /drops your score and removes it from your coach/,
    'the armed state must name the consequence, including that the coach loses it');
  assert.match(meal, /setTimeout\(\(\) => \{ disarmDel\(\); say\(''\); \}, 4500\)/,
    'an armed delete must disarm itself rather than sit waiting for a later thumb');
});

test('the screen follows the meal instead of rendering a read of nothing', () => {
  assert.match(meal, /location\.hash = `#meal-detail\/\$\{to\}`/,
    'after a move the route must follow the meal to its new slot');
  assert.match(meal, /location\.hash = '#home'/,
    'after a delete the screen must leave, since the meal it renders is gone');
});

test('the row is a footer to the breakdown, not a nested card', () => {
  const block = css.slice(css.indexOf('.mcx{'), css.indexOf('.mcx-s.is-error'));
  assert.match(block, /border-top:1px solid var\(--hairline-soft\)/,
    'it separates with a hairline; a card inside the breakdown card is the nested-card ban');
  assert.doesNotMatch(block, /box-shadow/, 'a footer row does not get its own elevation');
  assert.match(block, /\.mcx-acts \.btn\{width:auto/,
    'the buttons must sit as chips in a row, not stack into full-width bars');
});
