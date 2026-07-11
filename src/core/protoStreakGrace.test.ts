/**
 * STREAK GRACE (roadmap #11, council-ruled): the streak must not read "0" every morning
 * (an incomplete today is pending, not a miss), one sub-80/missed day per rolling 7 is
 * graced (the chain survives, the day doesn't count), a second miss inside the week ends
 * the run honestly, and unknown days before history began are not misses.
 *
 * day.js's pure functions are Node-importable (same as scoreParity.test.ts) — but streak
 * reads the DAY singleton, so each test seeds DAY.scoreHistory/meals directly.
 */
/* eslint-disable @typescript-eslint/no-var-requires */
const { DAY, streakInfo, streakDays, dayResetLocal } = require('../../proto/redesign-2026-07/js/day.js');

function iso(daysAgo: number): string {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
/** Seed history as [daysAgo, score] pairs; today's DAY starts empty (live score 0). */
function seed(hist: Array<[number, number]>) {
  dayResetLocal();
  DAY.date = iso(0);
  DAY.scoreHistory = hist.map(([ago, score]) => ({ date: iso(ago), score }));
}
/** Make TODAY qualify (>= 80): full meals + protein + submitted check-in + commitment. */
function qualifyToday() {
  DAY.meals = { breakfast: true, lunch: true, snack: true, dinner: true };
  DAY.slotMacros = { breakfast: { protein: 50 }, lunch: { protein: 50 }, snack: { protein: 40 }, dinner: { protein: 50 } };
  DAY.ciSubmitted = true;
  DAY.ci = { energy: 9, recovery: 9, sleep: 9, confidence: 9, soreness: 2, motivation: 9 };
  DAY.dailyCommitment = 'yes';
}

test('THE morning fix: an incomplete today never zeroes a live run', () => {
  seed([[1, 85], [2, 90], [3, 82], [4, 88], [5, 91]]);
  expect(streakDays()).toBe(5); // was 0 before — the flame survives the morning
  expect(streakInfo().todayCounted).toBe(false);
});

test('today joins the run once it qualifies', () => {
  seed([[1, 85], [2, 90]]);
  qualifyToday();
  const info = streakInfo();
  expect(info.todayCounted).toBe(true);
  expect(info.days).toBe(3);
});

test('one sub-80 day is graced: chain survives, graced day does not count', () => {
  seed([[1, 85], [2, 90], [3, 60], [4, 88], [5, 91]]); // dip 3 days ago
  const info = streakInfo();
  expect(info.days).toBe(4); // 85+90 and 88+91; the 60 is bridged, not counted
  expect(info.graceDate).toBe(iso(3));
});

test('a MISSING day inside known history is a miss (graced once)', () => {
  seed([[1, 85], [3, 88], [4, 91]]); // no row 2 days ago, history reaches further back
  const info = streakInfo();
  expect(info.days).toBe(3);
  expect(info.graceDate).toBe(iso(2));
});

test('a second miss inside the rolling 7 ends the run honestly', () => {
  seed([[1, 85], [2, 60], [3, 88], [4, 55], [5, 91], [6, 89]]); // misses 2 and 4 days ago
  const info = streakInfo();
  expect(info.days).toBe(2); // 85 + 88; the 55 (3 days after the graced 60... within 7) stops it
  expect(info.graceDate).toBe(iso(2));
});

test('misses 7+ days apart are each graced (one per rolling week)', () => {
  const hist: Array<[number, number]> = [];
  for (let ago = 1; ago <= 16; ago++) hist.push([ago, ago === 3 || ago === 12 ? 50 : 85]);
  seed(hist);
  expect(streakInfo().days).toBe(14); // 16 days minus the two graced misses
});

test('days before the earliest history row are unknown, not misses — and burn no grace', () => {
  seed([[1, 85], [2, 90]]); // history simply begins 2 days ago
  const info = streakInfo();
  expect(info.days).toBe(2);
  expect(info.graceDate).toBeNull();
});

test('no history and a blank today reads 0', () => {
  seed([]);
  expect(streakDays()).toBe(0);
});
