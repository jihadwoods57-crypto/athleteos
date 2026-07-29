/* One conversation across every meal — pure-module tests (node --test).

   The rule that matters: the stream is ordered by WHEN PEOPLE SPOKE, not by when meals happened.
   A coach replying tonight to yesterday's lunch belongs at the bottom, where they said it. Get
   that backwards and the athlete opens the chat to find the newest thing their coach told them
   buried under yesterday's divider — which is exactly the reset behaviour this replaces. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { stitchNutritionChat, mealIdsInThread } from './thread-stitch.js';

const meal = (id, at, over = {}) => ({ id, type: 'lunch', name: `Meal ${id}`, logged_at: at, quality: 80, ...over });
const msg = (id, mealId, at, over = {}) => ({ id, meal_id: mealId, role: 'ai', text: id, created_at: at, ...over });

test('each meal enters the stream as a card, with its messages under it', () => {
  const { items } = stitchNutritionChat({
    meals: [meal('m1', '2026-07-27T12:00:00Z')],
    comments: [msg('a', 'm1', '2026-07-27T12:05:00Z'), msg('b', 'm1', '2026-07-27T12:09:00Z')],
  });
  assert.deepEqual(items.map((i) => i.type), ['divider', 'msg', 'msg']);
  assert.equal(items[0].meal.id, 'm1');
});

test('meals appear oldest first, so the newest conversation is at the bottom', () => {
  const { items } = stitchNutritionChat({
    meals: [meal('m2', '2026-07-28T12:00:00Z'), meal('m1', '2026-07-27T12:00:00Z')],
    comments: [msg('a', 'm1', '2026-07-27T12:05:00Z'), msg('b', 'm2', '2026-07-28T12:05:00Z')],
  });
  assert.deepEqual(items.filter((i) => i.type === 'divider').map((i) => i.meal.id), ['m1', 'm2']);
});

test('a meal enters at its first message, not at the moment it was logged', () => {
  // Lunch was eaten at noon but nobody spoke about it until the evening; dinner was logged later
  // and discussed immediately. The evening conversation about lunch does not jump the queue.
  const { items } = stitchNutritionChat({
    meals: [meal('lunch', '2026-07-28T12:00:00Z'), meal('dinner', '2026-07-28T19:00:00Z')],
    comments: [msg('d1', 'dinner', '2026-07-28T19:05:00Z'), msg('l1', 'lunch', '2026-07-28T21:00:00Z')],
  });
  assert.deepEqual(items.filter((i) => i.type === 'divider').map((i) => i.meal.id), ['dinner', 'lunch']);
});

test('a meal nobody has spoken about still appears — the log is part of the record', () => {
  const { items } = stitchNutritionChat({
    meals: [meal('quiet', '2026-07-28T08:00:00Z'), meal('busy', '2026-07-28T12:00:00Z')],
    comments: [msg('a', 'busy', '2026-07-28T12:05:00Z')],
  });
  const dividers = items.filter((i) => i.type === 'divider');
  assert.deepEqual(dividers.map((d) => d.meal.id), ['quiet', 'busy']);
  assert.equal(items.filter((i) => i.type === 'msg').length, 1);
});

test('the meal being viewed is marked, so the screen can open where the athlete tapped', () => {
  const { items, anchorIndex } = stitchNutritionChat({
    meals: [meal('m1', '2026-07-27T12:00:00Z'), meal('m2', '2026-07-28T12:00:00Z')],
    comments: [msg('a', 'm1', '2026-07-27T12:05:00Z'), msg('b', 'm2', '2026-07-28T12:05:00Z')],
    currentMealId: 'm2',
  });
  assert.ok(anchorIndex >= 0);
  assert.equal(items[anchorIndex].type, 'divider');
  assert.equal(items[anchorIndex].meal.id, 'm2');
  assert.equal(items[anchorIndex].current, true);
  assert.equal(items.filter((i) => i.current).length, 2, 'the divider and its one message');
});

test('with no current meal there is nothing to anchor to, and it says so', () => {
  const { anchorIndex } = stitchNutritionChat({
    meals: [meal('m1', '2026-07-27T12:00:00Z')],
    comments: [msg('a', 'm1', '2026-07-27T12:05:00Z')],
  });
  assert.equal(anchorIndex, -1);
});

test('messages whose meal has scrolled out of the window are kept, not dropped', () => {
  // The fetch covers a fixed window; a message older than it still belongs to this athlete and
  // still says something. Silently discarding it would make the record a lie.
  const { items } = stitchNutritionChat({
    meals: [meal('m1', '2026-07-28T12:00:00Z')],
    comments: [msg('old', 'm-gone', '2026-07-01T12:00:00Z'), msg('new', 'm1', '2026-07-28T12:05:00Z')],
  });
  const dividers = items.filter((i) => i.type === 'divider');
  assert.equal(dividers.length, 2);
  assert.equal(dividers[0].meal, null, 'an unloaded meal gets a null-meal divider to render as "Earlier"');
  assert.equal(items.filter((i) => i.type === 'msg').length, 2);
});

test('messages inside a meal stay in the order they were said', () => {
  const { items } = stitchNutritionChat({
    meals: [meal('m1', '2026-07-28T12:00:00Z')],
    comments: [
      msg('third', 'm1', '2026-07-28T12:30:00Z'),
      msg('first', 'm1', '2026-07-28T12:05:00Z'),
      msg('second', 'm1', '2026-07-28T12:10:00Z'),
    ],
  });
  assert.deepEqual(items.filter((i) => i.type === 'msg').map((i) => i.comment.id), ['first', 'second', 'third']);
});

test('junk in never throws, it just produces nothing', () => {
  assert.deepEqual(stitchNutritionChat({}).items, []);
  assert.deepEqual(stitchNutritionChat({ meals: null, comments: null }).items, []);
  assert.deepEqual(stitchNutritionChat({ meals: [null], comments: [null, { text: 'no meal id' }] }).items, []);
  assert.equal(stitchNutritionChat().anchorIndex, -1);
});

test('an unparseable timestamp sorts to the start instead of corrupting the order', () => {
  const { items } = stitchNutritionChat({
    meals: [meal('m1', 'not a date'), meal('m2', '2026-07-28T12:00:00Z')],
    comments: [msg('b', 'm2', '2026-07-28T12:05:00Z')],
  });
  assert.deepEqual(items.filter((i) => i.type === 'divider').map((d) => d.meal.id), ['m1', 'm2']);
});

test('the meals a stream needs are the ones its messages name', () => {
  assert.deepEqual(mealIdsInThread([msg('a', 'm1', '1'), msg('b', 'm1', '2'), msg('c', 'm2', '3')]), ['m1', 'm2']);
  assert.deepEqual(mealIdsInThread(null), []);
});
