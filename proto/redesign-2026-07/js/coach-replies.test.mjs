/* "Your coach replied" on the athlete's Home (0229, inbox audit item 6).

   Unread = a human staff message on one of my threads that is newer than every stamp saying I
   opened it: the server's meal_views row, this device's own RT.mealViewedAt stamp, and my own
   last message on that thread. A reaction, a private note, and the AI never count. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { unreadCoachReplies, replyRow } from './coach-replies.js';

const T = (m) => `2026-09-10T12:${String(m).padStart(2, '0')}:00Z`;
const c = (mealId, role, minute, over = {}) => ({
  id: `${mealId}-${role}-${minute}`, meal_id: mealId, role, kind: 'message', text: `${role} ${minute}`,
  created_at: T(minute), ...over,
});
const meals = [
  { id: 'm1', type: 'lunch', day_date: '2026-09-10' },
  { id: 'm2', type: 'dinner', day_date: '2026-09-09' },
];

test('a coach message the athlete never opened is unread', () => {
  const out = unreadCoachReplies({ comments: [c('m1', 'coach', 5)], meals, views: [] });
  assert.equal(out.length, 1);
  assert.equal(out[0].mealId, 'm1');
  assert.equal(out[0].type, 'lunch');
  assert.equal(out[0].count, 1);
  assert.equal(out[0].latestText, 'coach 5');
});

test('a server view stamp after the message clears it; one before it does not', () => {
  const comments = [c('m1', 'coach', 5)];
  assert.equal(unreadCoachReplies({ comments, meals, views: [{ meal_id: 'm1', seen_at: T(6) }] }).length, 0);
  assert.equal(unreadCoachReplies({ comments, meals, views: [{ meal_id: 'm1', seen_at: T(4) }] }).length, 1);
});

test('this device\'s own stamp counts even before the server has it', () => {
  const comments = [c('m1', 'coach', 5)];
  assert.equal(unreadCoachReplies({ comments, meals, views: [], localViewedAt: { m1: T(7) } }).length, 0);
  assert.equal(unreadCoachReplies({ comments, meals, views: [], localViewedAt: { m1: T(2) } }).length, 1);
});

test('the athlete answering the thread reads everything before their answer', () => {
  const comments = [c('m1', 'coach', 5), c('m1', 'athlete', 6)];
  assert.equal(unreadCoachReplies({ comments, meals, views: [] }).length, 0);
  const again = [...comments, c('m1', 'coach', 8)];
  const out = unreadCoachReplies({ comments: again, meals, views: [] });
  assert.equal(out.length, 1);
  assert.equal(out[0].count, 1, 'only the reply after the athlete spoke');
});

test('the AI, reactions and private notes are not "your coach replied"', () => {
  const comments = [
    c('m1', 'ai', 5),
    c('m1', 'coach', 6, { kind: 'reaction', text: '🔥' }),
    c('m1', 'coach', 7, { kind: 'note', text: 'private' }),
  ];
  assert.equal(unreadCoachReplies({ comments, meals, views: [] }).length, 0);
  // A row with no kind column (pre-0049 server) is a plain message.
  const legacy = [c('m1', 'coach', 8, { kind: undefined })];
  assert.equal(unreadCoachReplies({ comments: legacy, meals, views: [] }).length, 1);
});

test('threads sort newest reply first and count per thread', () => {
  const comments = [c('m2', 'coach', 3), c('m1', 'coach', 5), c('m1', 'coach', 9), c('m2', 'trainer', 4)];
  const out = unreadCoachReplies({ comments, meals, views: [] });
  assert.deepEqual(out.map((u) => u.mealId), ['m1', 'm2']);
  assert.deepEqual(out.map((u) => u.count), [2, 2]);
});

test('garbage in, empty list out', () => {
  assert.deepEqual(unreadCoachReplies(), []);
  assert.deepEqual(unreadCoachReplies({ comments: null, meals: null, views: 'x', localViewedAt: 3 }), []);
  assert.deepEqual(unreadCoachReplies({ comments: [{ role: 'coach' }, null] }), []);
});

test('replyRow: one thread names the slot and opens today\'s live thread', () => {
  const unread = unreadCoachReplies({ comments: [c('m1', 'coach', 5)], meals, views: [] });
  const row = replyRow(unread, { todayISO: '2026-09-10', mealKeys: ['breakfast', 'lunch', 'dinner', 'snack'] });
  assert.equal(row.title, 'Your coach replied on lunch');
  assert.equal(row.route, 'meal-detail/lunch');
  assert.equal(row.mealId, 'm1');
  assert.equal(row.sub, 'Tap to read and answer.');
});

test('replyRow: a past-day thread opens the past-meal read; the noun follows the operator', () => {
  const unread = unreadCoachReplies({ comments: [c('m2', 'coach', 5), c('m2', 'coach', 6)], meals, views: [] });
  const row = replyRow(unread, { todayISO: '2026-09-10', mealKeys: ['breakfast', 'lunch', 'dinner', 'snack'], noun: 'trainer' });
  assert.equal(row.title, 'Your trainer replied on dinner');
  assert.equal(row.route, 'meal-view/m2');
  assert.equal(row.sub, '2 new messages. Tap to read.');
});

test('replyRow: several threads say how many and open the newest', () => {
  const comments = [c('m2', 'coach', 3), c('m1', 'coach', 5)];
  const row = replyRow(unreadCoachReplies({ comments, meals, views: [] }), { todayISO: '2026-09-10', mealKeys: ['lunch'] });
  assert.equal(row.title, 'Your coach replied on 2 meals');
  assert.equal(row.threads, 2);
  assert.equal(row.total, 2);
  assert.equal(row.route, 'meal-detail/lunch');
});

test('replyRow: nothing unread, no row', () => {
  assert.equal(replyRow([], {}), null);
  assert.equal(replyRow(null, {}), null);
});
