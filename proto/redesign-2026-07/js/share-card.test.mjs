// The share card's CLAIMS, held without rendering a pixel: day, week, and Verified Profile
// payload builders are pure, and what a card someone posts publicly says about them is exactly
// the kind of thing that must not drift. dayShareCard shipped untested; this covers all three.
import test from 'node:test';
import assert from 'node:assert/strict';
import { dayShareCard, weekShareCard, profileCardPayload } from './share-card.js';

const labels = (p) => p.stats.map(([k]) => k);

test('day: null score stays null, never a zero claim', () => {
  const { payload } = dayShareCard({ score: null, streak: 5, met: 2, total: 3 });
  assert.equal(payload.score, null);
  // No score means no tier claim either.
  assert.ok(!labels(payload).includes('Standard'));
});

test('day: no denominator, no "0 of 0" noise', () => {
  const { payload } = dayShareCard({ score: 88, streak: 0, met: 0, total: 0 });
  assert.ok(!labels(payload).includes('Completed'));
  assert.equal(payload.score, 88);
});

test('day: a 1-day streak is not a streak', () => {
  const { payload } = dayShareCard({ score: 90, streak: 1 });
  assert.ok(!labels(payload).includes('Streak'));
});

test('day: met clamps to total and score clamps to 0..100', () => {
  const { payload } = dayShareCard({ score: 140, met: 9, total: 4 });
  assert.equal(payload.score, 100);
  assert.equal(payload.stats.find(([k]) => k === 'Completed')[1], '4 of 4');
});

test('week: rounds the average and carries the pre-signed delta only when signed', () => {
  const { payload } = weekShareCard({ avg: 83.6, onDays: 5, total: 7, delta: '+4' });
  assert.equal(payload.score, 84);
  assert.equal(payload.eyebrow, 'This week');
  assert.equal(payload.stats.find(([k]) => k === 'At standard')[1], '5 of 7 days');
  assert.equal(payload.stats.find(([k]) => k === 'vs last week')[1], '+4');
});

test('week: an unsigned delta string is dropped, not shown as a claim', () => {
  const { payload } = weekShareCard({ avg: 80, onDays: 4, total: 7, delta: 'about the same' });
  assert.ok(!labels(payload).includes('vs last week'));
});

test('week: no scored days means a null score and an honest caption', () => {
  const { payload, caption } = weekShareCard({ avg: null, onDays: null, total: 0 });
  assert.equal(payload.score, null);
  assert.ok(!labels(payload).includes('At standard'));
  assert.ok(caption.includes('—'));
});

test('week: onDays clamps to total', () => {
  const { payload } = weekShareCard({ avg: 90, onDays: 9, total: 7 });
  assert.equal(payload.stats.find(([k]) => k === 'At standard')[1], '7 of 7 days');
});

test('profile: leads with duration, consistency, accountability', () => {
  const p = profileCardPayload({
    avg30: 86, daysOnRecord: 212, onStandardPct: 91,
    accountability: { earned: 930, possible: 1000 },
  });
  assert.equal(p.score, 86);
  assert.deepEqual(labels(p), ['Days on record', 'At standard', 'Accountability']);
  assert.equal(p.stats[2][1], '93%');
});

test('profile: an empty accountability denominator never becomes a percentage', () => {
  const p = profileCardPayload({ avg30: 70, daysOnRecord: 31, onStandardPct: 40, accountability: { earned: 0, possible: 0 } });
  assert.ok(!labels(p).includes('Accountability'));
});

test('profile: a missing record draws as unknown, not as zeros', () => {
  const p = profileCardPayload(null);
  assert.equal(p.score, null);
  assert.deepEqual(p.stats, []);
});
