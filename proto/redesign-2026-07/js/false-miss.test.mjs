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
  { id: 'recovery', title: 'Recovery check-in', required: true, proof: 'form', window: { due: T(23, 30) }, freq: { type: 'daily' } },
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
  assert.deepEqual(overdueTitles(s).filter((t) => t !== 'Recovery check-in'), [],
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

/* 2026-09-15, on the founder's own coach home at 2:45 PM: "Jihad Woods · Critical · Breakfast and
 * Lunch overdue", score 34, directly above a Live Activity card showing Jihad's breakfast photo
 * logged at 5:44 AM. Lunch was genuinely still open (it landed at 2:48). Breakfast was not.
 *
 * Every number below is copied off production, not invented: the team's requirement_sets row
 * (scope team, effective 2026-08-28) names its meals meal-1 / meal-2 / meal-3, while the athlete's
 * day row records them under breakfast / lunch / dinner in BOTH days.meals and days.tasks. The
 * status engine looked up meals['meal-1'], found nothing, and called a logged meal overdue.
 */
import { catalogFromItems } from './requirements.js';

const NAIR_SET_ITEMS = [
  { id: 'meal-1', freq: { type: 'daily' }, kind: 'meal', proof: 'photo', title: 'Breakfast', window: { due: 570, open: 420 } },
  { id: 'meal-2', freq: { type: 'daily' }, kind: 'meal', proof: 'photo', title: 'Lunch', window: { due: 840, open: 720 } },
  { id: 'meal-3', freq: { type: 'daily' }, kind: 'meal', proof: 'photo', title: 'Dinner', window: { due: 1230, open: 1080 } },
  { id: 'weight', freq: { days: [1, 3, 5], type: 'days', label: 'Mon / Wed / Fri' }, kind: 'weigh', proof: 'scale', title: 'Morning Weight', window: { due: 540 } },
  { id: 'recovery', freq: { type: 'daily' }, kind: 'recovery', proof: 'form', title: 'Recovery Check-In', window: { due: 1410, label: 'Before bed' } },
];

test('Jihad 2026-09-15 14:45: a standard that names its meals meal-N still sees a logged breakfast', () => {
  const TUE = 2;
  // days row as it stood at 2:45 PM: breakfast in (5:44 AM), lunch not yet (2:48 PM).
  const row = buildRosterRow(
    { athlete_id: '4c580c5e', athlete_name: 'Jihad Woods', position: 'LB' },
    { score: 34, meals: { lunch: false, snack: false, dinner: false, breakfast: true },
      tasks: [{ id: 'breakfast', done: true }, { id: 'lunch', done: false }, { id: 'dinner', done: false }, { id: 'recovery', done: false }] },
    { lastMealAt: '2026-09-15T09:44:27Z' },
  );
  const s = athleteStatus({ nowMin: T(14, 45), nowMs: Date.parse('2026-09-15T18:45:00Z'), row, reqs: catalogFromItems(NAIR_SET_ITEMS), excused: false, nowDow: TUE });
  assert.deepEqual(overdueTitles(s), ['Lunch'], 'breakfast was logged at 5:44; only lunch is honestly overdue at 2:45');
  assert.strictEqual(s.detail, 'Lunch overdue');
});

test('Jihad 2026-09-15 14:50: once lunch lands, the same standard reads clean', () => {
  const TUE = 2;
  const row = buildRosterRow(
    { athlete_id: '4c580c5e', athlete_name: 'Jihad Woods', position: 'LB' },
    { score: 61, meals: { lunch: true, snack: false, dinner: false, breakfast: true },
      tasks: [{ id: 'breakfast', done: true }, { id: 'lunch', done: true }, { id: 'dinner', done: false }, { id: 'recovery', done: true }] },
    { lastMealAt: '2026-09-15T18:48:13Z' },
  );
  const s = athleteStatus({ nowMin: T(14, 50), nowMs: Date.parse('2026-09-15T18:50:00Z'), row, reqs: catalogFromItems(NAIR_SET_ITEMS), excused: false, nowDow: TUE });
  assert.deepEqual(overdueTitles(s), [], 'nothing is overdue: dinner opens at 18:00 and recovery is due at 23:30');
  assert.notStrictEqual(s.key, 'overdue');
});
