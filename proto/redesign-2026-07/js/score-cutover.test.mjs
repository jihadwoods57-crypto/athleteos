import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SCORING_V2_CUTOVER, SCORING_V3_CUTOVER, SCORING_CUTOVERS, cutoverIndex } from './score-cutover.js';

test('the exported constants match src/core/scoreIntegrity.ts and migrations 0193 / 0228', () => {
  assert.equal(SCORING_V2_CUTOVER, '2026-08-16');
  assert.equal(SCORING_V3_CUTOVER, '2026-09-09');
  assert.deepEqual(SCORING_CUTOVERS, ['2026-08-16', '2026-09-09']);
});

test('the v3 boundary draws its own divider — the week it went silent (09-10..09-14) stays fixed', () => {
  const dates = ['2026-09-06', '2026-09-07', '2026-09-08', '2026-09-09', '2026-09-10', '2026-09-11', '2026-09-12'];
  assert.equal(cutoverIndex(dates), 3);
});

test('a window entirely inside the v2 era (after v2, before v3) draws nothing', () => {
  const dates = ['2026-09-01', '2026-09-02', '2026-09-03', '2026-09-04', '2026-09-05', '2026-09-06', '2026-09-07'];
  assert.equal(cutoverIndex(dates), -1);
});

test('a window spanning both cutovers marks the newest one — the step the viewer is looking at', () => {
  const dates = ['2026-08-14', '2026-08-20', '2026-09-01', '2026-09-10'];
  assert.equal(cutoverIndex(dates), 3);
});

test('finds the first date at/after the cutover when an earlier date is also in view', () => {
  const dates = ['2026-08-14', '2026-08-15', '2026-08-16', '2026-08-17', '2026-08-18'];
  assert.equal(cutoverIndex(dates), 2);
});

test('the cutover date itself counts as "at/after", not "before"', () => {
  assert.equal(cutoverIndex(['2026-08-15', '2026-08-16']), 1);
});

test('no divider when every date is still before the cutover (today, in reality)', () => {
  const dates = ['2026-08-03', '2026-08-04', '2026-08-05', '2026-08-06', '2026-08-07', '2026-08-08', '2026-08-09'];
  assert.equal(cutoverIndex(dates), -1);
});

test('no divider when every date is already at/after the cutover — nothing to explain in view', () => {
  const dates = ['2026-08-16', '2026-08-17', '2026-08-18'];
  assert.equal(cutoverIndex(dates), -1);
});

test('no divider on an empty or missing history array', () => {
  assert.equal(cutoverIndex([]), -1);
  assert.equal(cutoverIndex(undefined), -1);
});

test('a custom cutover argument overrides the default (so a caller can test either boundary)', () => {
  assert.equal(cutoverIndex(['2026-01-01', '2026-06-01'], '2026-06-01'), 1);
});
