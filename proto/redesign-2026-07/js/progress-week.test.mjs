/* Progress reads the calendar, not the rows (js/progress-week.js, 2026-09-23). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { progressRead, weekHeadline, weekSubline } from './progress-week.js';

const TODAY = '2026-07-23'; // a Thursday
const back = (n) => { const d = new Date(2026, 6, 23 - n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const rows = (spec) => spec.map(([b, s]) => ({ date: back(b), score: s }));

test('a day with no row is a MISSED day in the week, never skipped', () => {
  const r = progressRead({ rows: rows([[6, 90], [5, 88], [3, 92], [2, 85], [1, 91]]), todayKey: TODAY, startKey: back(30) });
  assert.equal(r.week.length, 7);
  assert.deepEqual(r.week.map((d) => d.state), ['scored', 'scored', 'missed', 'scored', 'scored', 'scored', 'today']);
  assert.equal(r.week[2].label, 'S'); // Sat 18 Jul
  assert.equal(r.days, 6);
  assert.equal(r.on, 5);
  assert.equal(r.missed, 1);
  assert.equal(r.avg, 89, 'the average is over logged days; the miss is counted, not averaged in as 0');
});

test('an open today never drags the week down; a secured today counts', () => {
  const hist = rows([[7, 90], [6, 90], [5, 90], [4, 90], [3, 90], [2, 90], [1, 90]]);
  const morning = progressRead({ rows: hist, todayKey: TODAY, todayScore: 19, startKey: back(30) });
  assert.equal(morning.avg, 90);
  assert.equal(morning.days, 6);
  assert.equal(weekHeadline(morning), 'On standard all 6 days');
  const evening = progressRead({ rows: hist, todayKey: TODAY, todayScore: 94, startKey: back(30) });
  assert.equal(evening.days, 7);
  assert.equal(evening.on, 7);
  assert.equal(evening.avg, 91);
});

test('days before the start are blank, not missed; day one reads as a sentence', () => {
  const r = progressRead({ rows: rows([[1, 84]]), todayKey: TODAY, startKey: back(1) });
  assert.deepEqual(r.week.map((d) => d.state), ['before', 'before', 'before', 'before', 'before', 'scored', 'today']);
  assert.equal(weekHeadline(r), 'On standard on day one');
  assert.equal(weekSubline(r), 'Averaging 84.');
  const fresh = progressRead({ rows: [], todayKey: TODAY, startKey: TODAY });
  assert.equal(fresh.days, 0);
  assert.equal(weekHeadline(fresh), null);
  assert.equal(weekSubline(fresh), null);
});

test('the subline never prints "+0" and words the direction', () => {
  const flat = progressRead({ rows: rows([[13, 88], [8, 88], [3, 88]]), todayKey: TODAY, startKey: back(20) });
  assert.equal(flat.delta, 0);
  assert.match(weekSubline(flat), /^Averaging 88, same as the week before\./);
  const down = progressRead({ rows: rows([[10, 90], [2, 80]]), todayKey: TODAY, startKey: back(10) });
  assert.match(weekSubline(down), /down 10 on the week before/);
  assert.doesNotMatch(weekSubline(down), /[+]/);
});

test('the prior week is only compared when it had a logged day', () => {
  const r = progressRead({ rows: rows([[2, 90]]), todayKey: TODAY, startKey: back(12) });
  assert.equal(r.prevAvg, null);
  assert.equal(r.delta, null);
});

test('best run breaks on a missed day; the 30-day rate waits for a week of days', () => {
  const r = progressRead({ rows: rows([[5, 90], [4, 91], [2, 92], [1, 93]]), todayKey: TODAY, startKey: back(5) });
  assert.equal(r.bestRun, 2, 'day 3 had no log, so 90,91 and 92,93 are two runs of two');
  assert.equal(r.rate30, null);
  const long = progressRead({ rows: rows(Array.from({ length: 10 }, (_, i) => [i + 1, i % 2 ? 70 : 90])), todayKey: TODAY, startKey: back(10) });
  assert.equal(long.rate30, 50);
});

test('weekly averages skip weeks before the start and keep a started week with no log as a gap', () => {
  const r = progressRead({ rows: rows([[20, 80], [19, 82], [6, 90]]), todayKey: TODAY, startKey: back(20) });
  assert.deepEqual(r.weeks.map((w) => w.avg), [81, null, 90]);
});

test('nothing before the earliest fetched row is a miss: a long perfect run reads 60+, not a reset', () => {
  // 200 days in, every day 90, but history only holds the last 60 rows (the fetch window).
  const hist = rows(Array.from({ length: 60 }, (_, i) => [i + 1, 90]));
  const r = progressRead({ rows: hist, todayKey: TODAY, todayScore: 92, startKey: back(200), windowDays: 60 });
  assert.equal(r.bestRun, 61, '60 fetched days plus today, nothing unfetched counted');
  assert.equal(r.bestCut, true);
  assert.deepEqual(r.month30, { on: 30, days: 30 });
  assert.equal(r.weeks.length, 8);
  assert.ok(r.weeks.every((w) => w.avg >= 90), 'no unfetched week averages in as misses');
});

test('with fewer than 30 days of rows, the count is over the known days only', () => {
  const r = progressRead({ rows: rows(Array.from({ length: 10 }, (_, i) => [i + 1, 90])), todayKey: TODAY, startKey: back(200) });
  assert.deepEqual(r.month30, { on: 10, days: 10 });
  assert.equal(r.bestCut, false, 'ten rows is well inside the window: the run is complete');
});

test('re-activation: stale rows before the activation day are not misses', () => {
  // Old rows from a previous stint 40 days ago, a long gap, then re-activated 3 days ago.
  const r = progressRead({ rows: rows([[40, 85], [39, 88], [2, 90], [1, 91]]), todayKey: TODAY, startKey: back(3) });
  assert.equal(r.week[2].state, 'before', 'the gap before re-activation is not a miss');
  assert.equal(r.week[3].state, 'missed', 'the activation day itself had no log');
  assert.equal(r.missed, 1);
  assert.equal(r.bestRun, 2);
  assert.equal(r.bestCut, false);
  assert.equal(r.weeks.length, 1, 'no weeks from the old stint');
});
