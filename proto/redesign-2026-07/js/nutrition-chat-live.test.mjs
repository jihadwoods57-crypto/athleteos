/* The Nutrition chat is a CONVERSATION, and two things have to be true for that word to be honest.
 *
 * 1. THE ROOM CAN HEAR YOU. For most of this screen's life its composer called postMealComment and
 *    stopped: no functions.invoke, no typing state, no poll, no realtime — while the facepile
 *    listed the AI Nutritionist, the members sheet promised it "reads every meal and answers
 *    questions", and the empty state said it would start the conversation. The meal thread, the
 *    trust thread and the coach's view all reached meal-chat. This screen, the one the product
 *    calls the conversation, did not. That is a silent failure: nothing errors, the message posts,
 *    and the athlete simply never gets an answer. Nothing in the test suite could see it, which is
 *    why the structural checks below exist at all — they are cheap, and they are the difference
 *    between "the feature regressed" and "the feature regressed for six weeks".
 *
 * 2. THE MESSAGE LANDS ON THE PLATE YOU MEANT. Every message row belongs to a meal. This screen
 *    resolved that to `STATE.meals[0]` and called it "your latest meal" in a placeholder. It is
 *    not: fetchRecentMeals orders day_date DESC then logged_at ASC, so meals[0] is the newest
 *    day's EARLIEST plate. Ask a question at 9pm and it attached to that morning's breakfast.
 *    latestMeal() is the fix, and the ordering it has to survive is pinned here.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

/* The screen graph touches the DOM at module eval; stub what it reads. Same shim as
   roll-call-resolve.test.mjs / router-roles.test.mjs. */
const el = () => ({
  style: { setProperty() {}, removeProperty() {} },
  classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
  setAttribute() {}, getAttribute: () => null, addEventListener() {},
  querySelectorAll: () => [], querySelector: () => null, appendChild() {}, remove() {}, insertAdjacentHTML() {},
});
globalThis.window = { location: { hash: '' }, addEventListener() {}, matchMedia: () => ({ matches: false, addEventListener() {}, addListener() {} }) };
globalThis.document = Object.assign(el(), { createElement: el, getElementById: () => null, documentElement: el(), body: el(), head: el() });
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
globalThis.sessionStorage = { getItem: () => null, setItem() {}, removeItem() {} };
globalThis.location = globalThis.window.location;

const { latestMeal, mealLabel } = await import('./screens/nutrition-chat.js');

const SRC = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), 'screens', 'nutrition-chat.js'), 'utf8');

/* ---- 1. the room can hear you ------------------------------------------------------------- */

test('the composer reaches meal-chat — a screen that names the AI must be able to call it', () => {
  assert.match(SRC, /functions\.invoke\(\s*'meal-chat'/,
    'nutrition-chat must invoke the meal-chat function; without it the AI Nutritionist is a face in a facepile');
});

test('the athlete sees that a reply is coming — a typing row exists', () => {
  assert.match(SRC, /tdots/, 'a question with no visible acknowledgement reads as a dropped message');
  assert.match(SRC, /setTyping/, 'the typing state has to be toggled, not merely declared');
});

test('the thread keeps itself current — a poll AND a socket, because a socket fails silently', () => {
  assert.match(SRC, /setTimeout/, 'the poll is the floor: a dropped socket must not strand the reply');
  assert.match(SRC, /postgres_changes/, 'realtime is the fast path');
  assert.match(SRC, /document\.hidden/, 'a backgrounded screen must not keep polling');
});

test('a failed AI call is retryable WITHOUT reposting the question', () => {
  // The message row lands once. A retry re-runs only the invoke, exactly as the meal thread does,
  // or the athlete's question duplicates itself every time the network hiccups.
  assert.match(SRC, /nc-retry-ai/, 'there has to be a retry affordance for the AI leg specifically');
  assert.match(SRC, /lastAsk/, 'the retry needs the question and the meal it belonged to');
});

/* ---- 2. the message lands on the plate you meant -------------------------------------------- */

// Exactly what fetchRecentMeals returns: day_date DESC, then logged_at ASC within a day.
const FETCHED = [
  { id: 'today-breakfast', type: 'Breakfast', day_date: '2026-08-28', logged_at: '2026-08-28T07:10:00Z' },
  { id: 'today-lunch', type: 'Lunch', day_date: '2026-08-28', logged_at: '2026-08-28T12:30:00Z' },
  { id: 'today-dinner', type: 'Dinner', day_date: '2026-08-28', logged_at: '2026-08-28T19:05:00Z' },
  { id: 'thu-dinner', type: 'Dinner', day_date: '2026-08-27', logged_at: '2026-08-27T19:00:00Z' },
];

test('the latest plate is the LATEST plate, not the first row the fetcher returned', () => {
  assert.equal(FETCHED[0].id, 'today-breakfast', 'guard the premise: meals[0] really is breakfast');
  assert.equal(latestMeal(FETCHED).id, 'today-dinner');
});

test('a single meal is its own latest, and an empty list has none', () => {
  assert.equal(latestMeal([FETCHED[3]]).id, 'thu-dinner');
  assert.equal(latestMeal([]), null);
  assert.equal(latestMeal(null), null);
});

test('a row with no timestamps never outranks one that has them', () => {
  const withJunk = [{ id: 'no-time', type: 'Snack' }, ...FETCHED];
  assert.equal(latestMeal(withJunk).id, 'today-dinner');
});

test('junk rows are skipped rather than thrown on', () => {
  assert.equal(latestMeal([null, undefined, {}, FETCHED[3]]).id, 'thu-dinner');
});

test('the plate is NAMED, because an unstated default is how the wrong meal got answered', () => {
  const label = mealLabel(FETCHED[3]);
  assert.match(label, /Dinner/, 'the slot has to appear');
  assert.ok(label.length > 'Dinner'.length, 'the day has to appear alongside it');
  assert.equal(mealLabel(null), '');
});

test('every meal card is a control the athlete can aim at', () => {
  assert.match(SRC, /data-meal-id="\$\{esc\(meal\.id\)\}"/, 'the card carries the id it targets');
  assert.match(SRC, /aria-pressed/, 'a selectable card states its own selected state');
  assert.match(SRC, /nc-target/, 'and the current target is shown above the composer');
});

test('a chosen plate that scrolls out of the loaded window falls back to the latest', () => {
  // Otherwise the composer posts to a meal that is no longer anywhere on screen.
  assert.match(SRC, /if \(REPLY_TO && !mealById\(STATE\.meals, REPLY_TO\)\) REPLY_TO = null;/);
});

/* ---- 3. the room is as capable as the meal thread, and it remembers (2026-09-02) ---------- */

test('the composer sends per-item foods, not totals only', () => {
  // Without items the AI could neither discuss one food honestly nor aim a correction at one.
  assert.match(SRC, /foods: foodsFor\(meal\)/, 'per-item provenance rides in the context, as the meal thread sends it');
});

test("a structured correction is offered for TODAY's plate and applied, never promised elsewhere", () => {
  assert.match(SRC, /canApplyCorrection: true/, 'the capability flag unlocks apply_correction server-side');
  assert.match(SRC, /todaySlotFor\(mealId\)/, 'and it is keyed on the plate being in today\'s record');
  assert.match(SRC, /act\.correctMeal\(slot,/, 'a returned correction is applied deterministically, like the meal thread');
  assert.match(SRC, /if \(!applied\) setNote\(/, 'a correction that did not land is admitted, not left as a standing promise');
});

test('the AI may remember what the athlete says, and only the athlete can make it bind', () => {
  assert.match(SRC, /canRemember: true/, 'the capability flag unlocks the remember tool server-side');
  assert.match(SRC, /memoryOfferChips\(offer, esc\)/, 'an offer row draws the shared Yes / No chips');
  assert.match(SRC, /act\.confirmMemoryFact\(id, fx\.getAttribute\('data-keep'\) === '1'\)/, 'the tap is the confirmation, through the one shared path');
  assert.match(SRC, /act\.pendingMemoryFacts\(\)/, 'answered offers stop asking: pending ids are fetched with the thread');
});
