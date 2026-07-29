/* The inbox after the AI joined the conversation — pure-module tests (node --test).

   The AI now posts its read of every plate and answers every question, so it is almost always the
   last row on a meal. The inbox's whole job is telling a coach where a PERSON is waiting on them,
   and "who spoke last" is how it decides. Count the AI and every athlete question becomes
   "AI spoke last", needsResponse empties itself, and the coach's queue quietly stops working —
   a failure that looks exactly like a calm week.

   These cases exist because that regression is invisible: nothing errors, no test fails, the
   inbox just goes quiet. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { categorizeInbox, previewSub } from './inbox.js';

const NOW = Date.parse('2026-07-28T20:00:00Z');
const meal = (id, over = {}) => ({
  id, athlete_id: 'ath-1', type: 'Dinner', logged_at: '2026-07-28T19:00:00Z',
  protein: 40, kcal: 700, ...over,
});
const c = (mealId, role, minute, over = {}) => ({
  id: `${mealId}-${role}-${minute}`, meal_id: mealId, role, kind: 'message',
  text: `${role} said something`, created_at: `2026-07-28T19:${String(minute).padStart(2, '0')}:00Z`, ...over,
});
const roster = [{ athlete_id: 'ath-1', athlete_name: 'Marcus Reed' }];
const run = (comments, meals = [meal('m1')]) =>
  categorizeInbox({ meals, comments, roster, interventions: [], nowMs: NOW });

test('an athlete question still needs a response after the AI answers it', () => {
  // The exact sequence the group chat produces on every question: AI reads the plate, athlete
  // asks, AI answers. A coach is still the person being waited on.
  const out = run([c('m1', 'ai', 5, { meta: { t: 'analysis' } }), c('m1', 'athlete', 20), c('m1', 'ai', 21)]);
  assert.equal(out.needsResponse.length, 1, 'the athlete is still waiting');
  assert.match(out.needsResponse[0].sub, /needs your response/);
});

test('a meal the AI has read, and nobody else has touched, is not a question', () => {
  const out = run([c('m1', 'ai', 5, { meta: { t: 'analysis' } })]);
  assert.equal(out.needsResponse.length, 0);
  assert.equal(out.mealReviews.length, 1, 'it is a review, waiting to be opened');
  assert.match(out.mealReviews[0].sub, /not yet opened/);
});

test('once the coach replies it reads as answered, whatever the AI says afterwards', () => {
  const out = run([c('m1', 'athlete', 10), c('m1', 'coach', 15), c('m1', 'ai', 16)]);
  assert.equal(out.needsResponse.length, 0);
  assert.match(out.athletes[0].sub, /you replied/);
});

test('a reaction is not an answer', () => {
  const out = run([c('m1', 'athlete', 10), c('m1', 'coach', 12, { kind: 'reaction', text: '🔥' })]);
  assert.equal(out.needsResponse.length, 1, 'an emoji does not close a question');
});

test('a private coach note is not an answer either', () => {
  const out = run([c('m1', 'athlete', 10), c('m1', 'coach', 12, { kind: 'note', text: 'watch portions' })]);
  assert.equal(out.needsResponse.length, 1, 'the athlete never sees a note, so nothing was said to them');
});

test('the preview line reads the same way', () => {
  assert.match(previewSub(meal('m1'), 'athlete', false), /needs your response/);
  assert.match(previewSub(meal('m1'), 'coach', false), /you replied/);
  assert.match(previewSub(meal('m1'), undefined, false), /not yet opened/);
  assert.match(previewSub(meal('m1'), 'athlete', true), /resolved/);
});

test('several meals sort out independently', () => {
  const out = run(
    [c('m1', 'athlete', 10), c('m1', 'ai', 11), c('m2', 'ai', 12, { meta: { t: 'analysis' } })],
    [meal('m1'), meal('m2', { logged_at: '2026-07-28T12:00:00Z' })],
  );
  assert.equal(out.needsResponse.length, 1);
  assert.equal(out.needsResponse[0].id, 'm1');
  assert.equal(out.mealReviews.some((r) => r.id === 'm2'), true);
});
