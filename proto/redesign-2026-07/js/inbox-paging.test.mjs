/* Inbox feed window + paging + shared seen state (inbox audit item 6, 2026-09-10).

   The inbox's only `meals` input was a global top-20 by logged_at over one day. On a 40-athlete
   roster that is a sixth of the day, and the header said "All caught up" over the rest. The
   window is now two days at the server clamp (400), the lists page client-side, and a count cut
   from a capped window prints as a floor ("137+"), never as an exact number the server did not
   promise. "Opened" is the union of this device's list and the server's staff views (0229). */
import test from 'node:test';
import assert from 'node:assert/strict';
import { countLabel, pageRows, unionSeen, MEAL_CATEGORIES, categorizeInbox } from './inbox.js';
import { seenMealSet, ACTIVITY_LIMIT, ACTIVITY_DAYS } from './coach-data.js';

test('the activity window is two days at the server clamp', () => {
  assert.equal(ACTIVITY_LIMIT, 400);
  assert.equal(ACTIVITY_DAYS, 2);
});

test('countLabel: exact when the window is not capped, a floor when it is', () => {
  assert.equal(countLabel(17, false, 'athletes'), '17');
  assert.equal(countLabel(17, true, 'athletes'), '17+');
  assert.equal(countLabel(400, true, 'athletes'), '400+');
  assert.equal(countLabel(0, true, 'mealReviews'), '0+');
  assert.equal(countLabel(undefined, false, 'athletes'), '0');
});

test('countLabel: categories with their own reads stay exact even on a capped window', () => {
  for (const cat of ['staff', 'announcements', 'flagged']) {
    assert.equal(countLabel(3, true, cat), '3', cat);
    assert.ok(!MEAL_CATEGORIES.includes(cat));
  }
  for (const cat of MEAL_CATEGORIES) assert.equal(countLabel(3, true, cat), '3+', cat);
});

test('pageRows: first page, then grows by one page per Show more, never truncates the source', () => {
  const rows = Array.from({ length: 47 }, (_, i) => ({ id: `m${i}` }));
  const p1 = pageRows(rows, 0, 20);
  assert.equal(p1.rows.length, 20);
  assert.equal(p1.more, true);
  assert.equal(p1.remaining, 27);
  const p2 = pageRows(rows, p1.next, 20);
  assert.equal(p2.rows.length, 40);
  assert.equal(p2.remaining, 7);
  const p3 = pageRows(rows, p2.next, 20);
  assert.equal(p3.rows.length, 47);
  assert.equal(p3.more, false);
  assert.equal(p3.remaining, 0);
  assert.equal(rows.length, 47, 'the source list is untouched');
});

test('pageRows: a short list is one page with no Show more', () => {
  const p = pageRows([{ id: 'a' }, { id: 'b' }], 0, 20);
  assert.deepEqual(p.rows.map((r) => r.id), ['a', 'b']);
  assert.equal(p.more, false);
  assert.equal(pageRows(null, 0).rows.length, 0);
});

test('unionSeen: device list and server set together, either may be missing', () => {
  assert.deepEqual([...unionSeen(['a', 'b'], new Set(['b', 'c']))].sort(), ['a', 'b', 'c']);
  assert.deepEqual([...unionSeen(['a'], null)], ['a']);
  assert.deepEqual([...unionSeen(null, ['z'])], ['z']);
  assert.deepEqual([...unionSeen(undefined, undefined)], []);
});

test('seenMealSet before any activity load falls back to the device list alone', () => {
  const s = seenMealSet(['m1', 'm2']);
  assert.ok(s instanceof Set);
  assert.deepEqual([...s].sort(), ['m1', 'm2']);
});

test('a staff view from the server clears the plate from Meal reviews on this device too', () => {
  const meals = [
    { id: 'm1', athlete_id: 'a1', type: 'Lunch', logged_at: '2026-09-10T12:00:00Z' },
    { id: 'm2', athlete_id: 'a1', type: 'Dinner', logged_at: '2026-09-10T18:00:00Z' },
  ];
  const roster = [{ athleteId: 'a1', name: 'Marcus Reed' }];
  const nowMs = Date.parse('2026-09-10T20:00:00Z');
  const before = categorizeInbox({ meals, roster, seenIds: unionSeen([], null), nowMs });
  assert.equal(before.counts.mealReviews, 2);
  // This device never opened m1; another coach on the team did (0229 meal_views).
  const after = categorizeInbox({ meals, roster, seenIds: unionSeen([], new Set(['m1'])), nowMs });
  assert.deepEqual(after.mealReviews.map((r) => r.id), ['m2']);
  assert.equal(after.counts.athletes, 2, 'Athletes still lists every loaded thread');
});
