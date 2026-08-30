/* The coach must never be told an athlete missed something they logged.
 *
 * 2026-08-28, on a real coach's lock screen: "Owen missed Dinner", "Owen missed Breakfast",
 * "Owen missed Lunch", three at once, on a day whose profile screen showed all three meals with
 * photos and scores 51 / 65 / 73 and "Everything is in".
 *
 * The cause was one source of truth too few. status.js openItems() read done-ness ONLY from
 * days.tasks, the roster's day query never fetched days.meals at all, and coach-notify-plan.js
 * turns openItems[].state === 'overdue' into "<Name> missed <title>". A day row can legitimately
 * carry a real score and an empty tasks array: 0041 computes the score from meals, not tasks, and
 * a pre-writer row carries no tasks while a legacy RN row carries numeric ids. insights.js has
 * always guarded its own miss counts against exactly this (protoTasksAware); the notification path
 * did not.
 */
import { test } from 'node:test';
import assert from 'node:assert';
import { athleteStatus } from './status.js';
import { buildRosterRow } from './roles.js';

const T = (h, m = 0) => h * 60 + m;
const FRI = 5;
const NOW_MS = Date.parse('2026-08-28T22:00:00Z');

const REQS = [
  { id: 'breakfast', title: 'Breakfast', required: true, proof: 'photo', window: { open: T(5), due: T(9, 30) }, freq: { type: 'daily' } },
  { id: 'lunch', title: 'Lunch', required: true, proof: 'photo', window: { open: T(11), due: T(14) }, freq: { type: 'daily' } },
  { id: 'dinner', title: 'Dinner', required: true, proof: 'photo', window: { open: T(17), due: T(20, 30) }, freq: { type: 'daily' } },
  { id: 'recovery', title: 'Recovery Check-In', required: true, proof: 'form', window: { due: T(23, 30) }, freq: { type: 'daily' } },
];

const at = (row) => athleteStatus({ nowMin: T(22), nowMs: NOW_MS, row, reqs: REQS, excused: false, nowDow: FRI });
const overdueTitles = (s) => (s.openItems || []).filter((i) => i.state === 'overdue').map((i) => i.title);

test('Owen: every meal logged, tasks empty — no meal reads as missed', () => {
  const row = {
    athleteId: 'a1', name: 'Owen Castillo', loggedToday: true, score: 72,
    tasks: [],                                                  // the pre-writer / legacy shape
    meals: { breakfast: true, lunch: true, dinner: true, snack: false },
    lastMealAt: '2026-08-28T19:42:00Z', scoreHistory: [],
  };
  const s = at(row);
  assert.deepEqual(overdueTitles(s).filter((t) => t !== 'Recovery Check-In'), [],
    'a logged meal must never be reported missed');
  assert.notStrictEqual(s.key, 'overdue');
});

test('a meal genuinely not logged still reports, using the same map', () => {
  const row = {
    athleteId: 'a1', name: 'Owen Castillo', loggedToday: true, score: 40,
    tasks: [], meals: { breakfast: true, lunch: false, dinner: false },
    lastMealAt: '2026-08-28T08:10:00Z', scoreHistory: [],
  };
  const s = at(row);
  assert.deepEqual(overdueTitles(s), ['Lunch', 'Dinner'], 'a real miss must still reach the coach');
  assert.strictEqual(s.key, 'overdue');
});

test('no day row at all: nothing was logged, so everything is honestly missed', () => {
  // The distinction the guard turns on. This is the alert the feature exists for and it must
  // survive: loggedToday false means there is no day row, not an ambiguous one.
  const row = { athleteId: 'a1', name: 'Owen', loggedToday: false, score: null, tasks: [], meals: null, lastMealAt: null, scoreHistory: [] };
  const s = at(row);
  assert.deepEqual(overdueTitles(s), ['Breakfast', 'Lunch', 'Dinner'], 'a silent athlete must still surface');
});

test('a logged day with untrustworthy tasks never fabricates a non-meal miss', () => {
  // Legacy RN rows carry NUMERIC task ids. They prove nothing about a recovery check-in, and
  // silence beats a fabricated miss (the trade insights.js already makes).
  const row = {
    athleteId: 'a1', name: 'Owen', loggedToday: true, score: 72,
    tasks: [{ id: 3, done: true }, { id: 7, done: true }],
    meals: { breakfast: true, lunch: true, dinner: true },
    lastMealAt: '2026-08-28T19:42:00Z', scoreHistory: [],
  };
  assert.deepEqual(overdueTitles(row && at(row)), [], 'numeric task ids cannot prove a skip');
});

test('trustworthy tasks still decide the non-meal items', () => {
  const row = {
    athleteId: 'a1', name: 'Owen', loggedToday: true, score: 72,
    tasks: [{ id: 'breakfast', done: true }, { id: 'recovery', done: false }],
    meals: { breakfast: true, lunch: true, dinner: true },
    lastMealAt: '2026-08-28T19:42:00Z', scoreHistory: [],
  };
  assert.deepEqual(overdueTitles(at(row)), [], 'recovery is not overdue until 23:30');
});

test('buildRosterRow carries days.meals through to the status engine', () => {
  // The other half of the fix: the roster query now selects `meals`, and the row has to keep it.
  const row = buildRosterRow(
    { athlete_id: 'a1', athlete_name: 'Owen Castillo', position: 'QB' },
    { score: 72, tasks: [], meals: { breakfast: true, lunch: true, dinner: true } },
  );
  assert.deepEqual(row.meals, { breakfast: true, lunch: true, dinner: true });
  assert.strictEqual(row.loggedToday, true);
  assert.deepEqual(overdueTitles(at(row)), [], 'the row the coach actually judges must be clean');
});

test('a day row with no meals map falls back rather than guessing', () => {
  const row = buildRosterRow({ athlete_id: 'a1', athlete_name: 'Owen' }, { score: 72, tasks: [] });
  assert.strictEqual(row.meals, null, 'absent means absent, never an empty map that reads as "none logged"');
  assert.deepEqual(overdueTitles(at(row)), [], 'a logged day with nothing to judge by stays silent');
});
