/* Coach score truth (founder report, 2026-09-24). Coach Grinch's Home read 57 for Jihad Woods
 * while Jihad's own Home read 53; the coach saw yesterday's score in the morning; and the group
 * pill said "down 28 vs yesterday" at lunch because dinner had not happened yet.
 *
 * The fixtures are the two real prod day rows behind the report (read-only query, 2026-09-24),
 * trimmed to the fields the engine reads.
 *
 *   1. ONE number. The athlete's Home (S.score) and the coach (days.score, via the roster) are the
 *      same function of the same day: clampedScore(DAY), which pushDay writes.
 *   2. Each athlete's OWN today, in their timezone, and never yesterday's row as today's.
 *   3. "vs yesterday" only compares finished windows with finished windows.
 *
 * Run: node --test proto/redesign-2026-07/js/coach-score-truth.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const src = (f) => readFileSync(join(HERE, f), 'utf8');

/* state.js runs in the same bare harness state-memo.test.mjs uses. */
const el = () => ({
  style: { setProperty() {}, removeProperty() {} },
  classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
  setAttribute() {}, getAttribute: () => null, addEventListener() {},
  querySelectorAll: () => [], querySelector: () => null, appendChild() {}, remove() {}, insertAdjacentHTML() {},
});
globalThis.window = {
  location: { hash: '' }, addEventListener() {},
  matchMedia: () => ({ matches: false, addEventListener() {}, addListener() {} }),
  __render: () => {},
};
globalThis.document = Object.assign(el(), { createElement: el, getElementById: () => null, documentElement: el(), body: el(), head: el() });
const store = new Map();
globalThis.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
globalThis.sessionStorage = { getItem: () => null, setItem() {}, removeItem() {} };
globalThis.location = globalThis.window.location;

const { S, RT, act } = await import('./state.js');
const D = await import('./day.js');
const { stdFromItems, catalogFromItems } = await import('./requirements.js');
const { athleteStatus } = await import('./status.js');
const { projectRows, localDayISO } = await import('./roster-day.js');
const { shownScore, groupPulse, dayStanding, teamCounts } = await import('./team-count.js');

const ATHLETE = '4c580c5e-c79b-4495-ac8b-1184d50e11b9';
/* Northgate Varsity's team standard (requirement_sets, effective 2026-08-28). */
const ITEMS = [
  { freq: { type: 'daily' }, id: 'meal-1', kind: 'meal', proof: 'photo', title: 'Breakfast', window: { due: 570, open: 420 } },
  { freq: { type: 'daily' }, id: 'meal-2', kind: 'meal', proof: 'photo', title: 'Lunch', window: { due: 840, open: 720 } },
  { freq: { type: 'daily' }, id: 'meal-3', kind: 'meal', proof: 'photo', title: 'Dinner', window: { due: 1230, open: 1080 } },
  { freq: { days: [1, 3, 5], label: 'Mon / Wed / Fri', type: 'days' }, id: 'weight', kind: 'weigh', proof: 'scale', title: 'Morning Weight', window: { due: 540 } },
  { freq: { type: 'daily' }, id: 'recovery', kind: 'recovery', proof: 'form', title: 'Recovery Check-In', window: { due: 1410, label: 'Before bed' } },
];
/* days row, 2026-09-24, as stored at 12:13 PM ET (score 57). */
const ROW_0924 = {
  athlete_id: ATHLETE, date: '2026-09-24', score: 57, plan_style: 'guided',
  meals: { breakfast: true, dinner: false, lunch: true, snack: false }, quick_added: [false, false, false], hydration_l: 0,
  tasks: [{ id: 'breakfast', done: true }, { id: 'lunch', done: true }, { id: 'dinner', done: false }, { id: 'recovery', done: true }],
  checkin: {
    submitted: true, energy: 10, recovery: 10, sleep: 6, confidence: 10, soreness: 4, motivation: 8, commitment: null,
    mealLoggedAt: { breakfast: 442, lunch: 732 },
    slotMacros: { breakfast: { protein: 53, kcal: 540, quality: 100 }, lunch: { protein: 73, kcal: 872, quality: 100 } },
    wakeup: { assigned: true, lateMin: 21, verdict: 'late' },
  },
};
const ROW_0923 = { athlete_id: ATHLETE, date: '2026-09-23', score: 85, meals: { breakfast: true, lunch: true, dinner: true }, tasks: [] };
const CFG = { proteinTarget: 180, calTarget: 2400, scoringProfile: 'athlete' }; // targets {protein:180, calories:2400}

/** The live athlete day, the way the athlete's device holds it. */
function liveDay(std) {
  D.dayResetLocal();
  const d = D.dayFromHistoryRow({ date: ROW_0924.date, meals: ROW_0924.meals, checkin: ROW_0924.checkin, quickAdded: ROW_0924.quick_added, hydrationL: 0, planStyle: 'guided' }, CFG);
  Object.assign(D.DAY, d, { ciSubmitted: true });
  D.setDayGoalConfig('athlete', 180, 2400);
  D.setDayPlanStyle('guided');
  D.setDayStandard(std);
}

/* ------------------------------------------------------------------ 1. one number */

test('root cause: the athlete Home dropped the wake-up term the weights still paid for (53 vs 57)', () => {
  liveDay(null); // the device had no team standard loaded (state.js early return, fixed below)
  const c = D.computeComponents(D.DAY), w = D.weightsForDay(D.DAY);
  const oldHome = Math.round(w.nutrition * c.nutrition + w.recovery * c.recoveryContribution + w.commitment * c.commitment + w.checkin * c.checkin);
  assert.equal(oldHome, 53, 'the pre-fix Home formula reproduces what Jihad saw');
  assert.equal(D.clampedScore(D.DAY), 57, 'pushDay wrote 57, which is what the coach read');
});

test('the athlete Home now shows exactly what pushDay writes for the coach', () => {
  liveDay(null);
  assert.equal(S.score, D.clampedScore(D.DAY));
  assert.equal(S.score, 57);
  // With the team's 3-meal standard applied (what the athlete is held to), both sides move together.
  liveDay(stdFromItems(ITEMS));
  assert.equal(S.score, D.clampedScore(D.DAY));
  assert.equal(S.score, 61, '2 of 3 meals under the coach standard, not 2 of 4');
  D.setDayStandard(null);
});

test('coach vs athlete: the roster, the group ring and the athlete page read the SAME number', (t) => {
  liveDay(null);
  const athleteShows = S.score;
  const nowMs = Date.parse('2026-09-24T16:30:00Z'); // 12:30 PM ET
  // teamCounts reads the device clock (it is what the coach's phone sees now), so pin it too; the
  // suite otherwise went red at midnight after the fixture day.
  t.mock.timers.enable({ apis: ['Date'], now: nowMs });
  const [row] = projectRows([[{ athlete_id: ATHLETE, athlete_name: 'Jihad Woods', position: 'LB' }]],
    [ROW_0923, ROW_0924], [], { [ATHLETE]: 'America/New_York' }, nowMs);
  const reqs = catalogFromItems(ITEMS);
  const e = { row, reqs, nowMin: 750, nowDow: 4, status: athleteStatus({ nowMin: 750, nowMs, nowDow: 4, row, reqs, excused: false }) };
  assert.equal(row.score, athleteShows);
  assert.equal(shownScore(e, nowMs), athleteShows);
  assert.equal(groupPulse([e], nowMs).avg, athleteShows);
  assert.equal(teamCounts([e]).avg, athleteShows);
});

test('the athlete standard loads even with no one-off coach assignment', async () => {
  // Every table read answers "nothing"; only the team's standard exists. Before the fix the empty
  // assignment list returned early and the standard was never fetched (the prod state: 0 recent
  // assignments, scored on the classic 4-meal day).
  const reads = [];
  const chain = (name) => {
    const p = new Proxy(function () {}, {
      get(_t, prop) {
        if (prop === 'then') return (res) => res({ data: name === 'rpc:relevant_requirement_sets' ? [SET] : (name === 'requirement_assignments' ? [] : null), error: null });
        return () => p;
      },
      apply() { return p; },
    });
    return p;
  };
  const SET = { id: 's1', scope_kind: 'team', scope_value: null, effective_date: '2026-08-28', items: ITEMS };
  window.sb = {
    from: (t) => { reads.push(t); return chain(t); },
    rpc: (fn) => { reads.push(`rpc:${fn}`); return chain(`rpc:${fn}`); },
    auth: { getUser: async () => ({ data: { user: { id: ATHLETE } } }) },
  };
  RT.userId = ATHLETE; RT.myCoach = { teamId: 'team-1', name: 'Coach Grinch' }; RT.reqSets = null; RT.assigned = [];
  D.dayResetLocal();
  await act._loadAssignmentsIntoRt();
  assert.ok(reads.includes('rpc:relevant_requirement_sets'), 'the standard was fetched');
  assert.equal(D.dayStandard() && D.dayStandard().mealsRequired, 3, 'and it governs the scored day');
  D.setDayStandard(null); delete window.sb; RT.myCoach = null;
});

/* Review I2: the stored score is only rewritten when every input behind it loaded THIS session. */
function hydrateStub({ setsFail }) {
  const upserts = [];
  const TODAY = localDayISO(null);
  const chain = (table) => {
    const st = { order: false, upsert: false };
    const p = new Proxy(function () {}, {
      get(_t, prop) {
        if (prop === 'then') return (res) => {
          if (st.upsert) return res({ data: null, error: null });
          if (table === 'rpc:relevant_requirement_sets' || table === 'requirement_sets') {
            return res(setsFail ? { data: null, error: { message: 'down' } } : { data: [{ id: 's1', scope_kind: 'team', scope_value: null, effective_date: '2026-08-28', items: ITEMS }], error: null });
          }
          if (table === 'days') return res({ data: st.order ? [] : { ...ROW_0924, date: TODAY, score: 1 }, error: null });
          if (table === 'athlete_profiles') return res({ data: { base_goal: 'performance', position: 'LB' }, error: null });
          if (table === 'rpc:athlete_plan_meta') return res({ data: [{ base_weight: null, targets: { protein: 180, calories: 2400 } }], error: null });
          if (table === 'requirement_assignments' || table === 'meals' || table === 'trust_passes' || table === 'pass_spends') return res({ data: [], error: null });
          return res({ data: null, error: null });
        };
        return (...args) => { if (prop === 'order') st.order = true; if (prop === 'upsert') { st.upsert = true; upserts.push(args[0]); } return p; };
      },
      apply() { return p; },
    });
    return p;
  };
  window.sb = { from: (t) => chain(t), rpc: (fn) => chain(`rpc:${fn}`), auth: { getUser: async () => ({ data: { user: { id: ATHLETE } } }) } };
  return upserts;
}
test('the stored score is healed only when the standard and profile both loaded this session', async () => {
  RT.userId = ATHLETE; RT.authRole = 'athlete'; RT.myCoach = { teamId: 'team-1', name: 'Coach Grinch' };
  for (const [setsFail, expectWrite] of [[true, false], [false, true]]) {
    const upserts = hydrateStub({ setsFail });
    await act._loadProfileIntoRt(ATHLETE);
    await act._loadAssignmentsIntoRt();
    await D.loadDay(ATHLETE);
    await act._afterDayLoad();
    const wrote = upserts.filter((r) => r && r.athlete_id === ATHLETE && 'score' in r);
    assert.equal(wrote.length > 0, expectWrite, setsFail ? 'a failed standard fetch must not write' : 'a fully loaded day heals the stale 1');
    if (expectWrite) assert.equal(wrote[0].score, S.score, 'and it writes exactly what Home shows');
  }
  D.setDayStandard(null); delete window.sb; RT.myCoach = null; RT.authRole = null;
});

test('S.score and pushDay name the same function', () => {
  assert.match(src('state.js'), /get score\(\) \{ return memo\('score', \(\) => clampedScore\(DAY\)\); \}/);
  assert.match(src('day.js'), /const s = clampedScore\(DAY\);/);
});

/* ------------------------------------------------------------------ 2. whose today */

test('each athlete is matched on THEIR today, and yesterday is exactly the day before it', () => {
  // 12:30 AM on the 25th in New York is still 9:30 PM on the 24th in Los Angeles.
  const nowMs = Date.parse('2026-09-25T04:30:00Z');
  const rows = projectRows([[{ athlete_id: 'ny', athlete_name: 'NY' }, { athlete_id: 'la', athlete_name: 'LA' }]], [
    { athlete_id: 'ny', date: '2026-09-24', score: 57, tasks: [] },
    { athlete_id: 'la', date: '2026-09-24', score: 72, tasks: [] },
    { athlete_id: 'la', date: '2026-09-23', score: 80, tasks: [] },
    { athlete_id: 'la', date: '2026-09-20', score: 99, tasks: [] },
  ], [], { ny: 'America/New_York', la: 'America/Los_Angeles' }, nowMs);
  const ny = rows.find((r) => r.athleteId === 'ny'), la = rows.find((r) => r.athleteId === 'la');
  assert.equal(ny.dayISO, '2026-09-25');
  assert.equal(ny.score, null, 'a new day with nothing in yet is not yesterday\'s 57');
  assert.equal(ny.loggedToday, false);
  assert.equal(ny.yesterdayScore, 57, 'yesterday is labelled as yesterday');
  assert.equal(la.dayISO, '2026-09-24');
  assert.equal(la.score, 72);
  assert.equal(la.yesterdayScore, 80, 'the day before THEIR today, never the last scored day (the 99)');
});

test('a row loaded before the athlete\'s midnight is never shown after it', () => {
  const row = { athleteId: 'ny', score: 57, dayISO: '2026-09-24', timezone: 'America/New_York', tasks: [], meals: { breakfast: true } };
  const e = { row, reqs: [], nowMin: 5, status: { key: 'on_standard' } };
  assert.equal(shownScore(e, Date.parse('2026-09-24T23:00:00Z')), 57);
  assert.equal(shownScore(e, Date.parse('2026-09-25T04:05:00Z')), null, '12:05 AM: yesterday is over');
});

test('localDayISO: the athlete zone when known, the device date otherwise', () => {
  const ms = Date.parse('2026-09-25T02:00:00Z');
  assert.equal(localDayISO('America/Los_Angeles', ms), '2026-09-24');
  assert.equal(localDayISO('Asia/Tokyo', ms), '2026-09-25');
  const d = new Date(ms);
  const device = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  assert.equal(localDayISO(null, ms), device);
  assert.equal(localDayISO('Not/AZone', ms), device, 'an unknown zone falls back, never throws');
});

test('the morning: nothing required in yet reads "not started", like the athlete ring', () => {
  // A roll-call morning: the on-time wake-up alone wrote a real 8. The athlete's ring shows no digit.
  const reqs = catalogFromItems(ITEMS);
  const row = { athleteId: 'a', score: 8, loggedToday: true, dayISO: localDayISO(null), tasks: [], meals: {} };
  const e = { row, reqs, nowMin: 400, nowDow: 4, status: { key: 'due_soon' } };
  assert.deepEqual(dayStanding(e), { done: 0, settled: false });
  assert.equal(shownScore(e), null);
  assert.equal(groupPulse([e]).avg, null, 'the group ring is not started');
  assert.equal(teamCounts([e]).scored, 0);
  // The first requirement in: the digit arrives, on both sides.
  const fed = { ...e, row: { ...row, score: 30, meals: { breakfast: true } } };
  assert.equal(shownScore(fed), 30);
});

test('a coach book is re-read after two minutes and dropped the moment the day turns', () => {
  const cd = src('coach-data.js');
  assert.match(cd, /if \(bookDay !== roles\.todayISO\(\)\) ROSTER = null;/);
  assert.match(cd, /Date\.now\(\) - bookAt < BOOK_TTL/);
  assert.match(cd, /addEventListener\('onstd:foreground'/);
  assert.match(cd, /PROFILE\.athleteId === athleteId && !force && Date\.now\(\) - PROFILE\.at < BOOK_TTL/);
});

/* ------------------------------------------------------------------ 3. like for like */

function jihadAt(nowMin, nowMs) {
  const [row] = projectRows([[{ athlete_id: ATHLETE, athlete_name: 'Jihad Woods' }]], [ROW_0923, ROW_0924], [], { [ATHLETE]: 'America/New_York' }, nowMs);
  const reqs = catalogFromItems(ITEMS);
  return { row, reqs, nowMin, nowDow: 4, status: athleteStatus({ nowMin, nowMs, nowDow: 4, row, reqs, excused: false }) };
}

test('12:30 PM: no "down 28". Dinner is still open, so there is only yesterday\'s final', () => {
  const p = groupPulse([jihadAt(750, Date.parse('2026-09-24T16:30:00Z'))], Date.parse('2026-09-24T16:30:00Z'));
  assert.equal(p.avg, 57);
  assert.equal(p.settled, false);
  assert.equal(p.delta, null);
  assert.equal(p.yesterday, 85);
});

test('9:00 PM: every window has closed, so the finished day compares with the finished day', () => {
  const ms = Date.parse('2026-09-25T01:00:00Z');
  const p = groupPulse([jihadAt(1260, ms)], ms);
  assert.equal(p.settled, true);
  assert.equal(p.delta, 57 - 85, 'a real miss (no dinner) is still reported, once it IS one');
});

test('the group delta waits for EVERY counted athlete, and compares the same people on both days', () => {
  const settled = { row: { athleteId: 'a', score: 90, yesterdayScore: 80, tasks: [] }, reqs: [], nowMin: 1300, status: { key: 'on_standard' } };
  const newbie = { row: { athleteId: 'b', score: 70, yesterdayScore: null, tasks: [] }, reqs: [], nowMin: 1300, status: { key: 'on_standard' } };
  assert.equal(groupPulse([settled, newbie]).delta, 10, 'b has no yesterday, so only a is compared');
  const open = { ...settled, row: { ...settled.row, athleteId: 'c', meals: { breakfast: true } }, reqs: catalogFromItems(ITEMS), nowMin: 750, nowDow: 4 };
  assert.equal(groupPulse([settled, open]).delta, null);
});

test('the athlete Home follows the same rule: no delta until the day is decided', () => {
  const home = src('screens/home.js');
  const fn = home.slice(home.indexOf('function deltaChip(score)'), home.indexOf('export function scoreSummary'));
  assert.match(fn, /!S\.dayDecided/);
});

test('coach Home prints yesterday as yesterday, never a delta, until today settles', () => {
  const ch = src('screens/coach-home.js');
  assert.match(ch, /groupPulse\(entries\)/);
  assert.match(ch, /Yesterday ended at \$\{p\.yesterday\}/);
  assert.doesNotMatch(ch, /First day of data/);
});

/* ------------------------------------------------------------------ status follows the athlete */

test('coach status: under the bar with windows open is "In progress", never a verdict or a score', () => {
  const reqs = catalogFromItems(ITEMS);
  const row = { athleteId: 'a', score: 57, loggedToday: true, tasks: ROW_0924.tasks, meals: ROW_0924.meals };
  const noon = athleteStatus({ nowMin: 750, nowMs: 0, nowDow: 4, row, reqs, excused: false });
  assert.equal(noon.key, 'in_progress');
  assert.doesNotMatch(noon.detail, /\d/, 'no number in the line while the day is open');
  // Everything in, and every window has closed: now the verdict is honest.
  const full = { ...row, score: 70, meals: { breakfast: true, lunch: true, dinner: true }, tasks: [...ROW_0924.tasks.filter((t) => t.id !== 'dinner'), { id: 'dinner', done: true }] };
  const late = athleteStatus({ nowMin: 1420, nowMs: 0, nowDow: 4, row: full, reqs, excused: false });
  assert.equal(late.key, 'below_standard');
  assert.equal(late.detail, 'Scored 70 today');
  // A closed window with nothing in stays live: overdue is a fact the coach can act on.
  const missed = athleteStatus({ nowMin: 1300, nowDow: 4, row, reqs, excused: false });
  assert.equal(missed.key, 'overdue');
  // One count for every screen.
  const c = teamCounts([{ row, reqs, nowMin: 750, nowDow: 4, status: noon }]);
  assert.equal(c.inProgress, 1);
  assert.equal(c.attention, 0);
});

/* ------------------------------------------------------------------ breakdown adds up */

test('the breakdown sums to the ring on a day with an arrival (and "max today" is the engine\'s)', async () => {
  const { dayScoreOf, explainCategories } = await import('./breakdown-model.js');
  liveDay(null);
  D.DAY.arrival = { assigned: true, verdict: 'on_standard', lateMin: 0 };
  assert.equal(dayScoreOf(D.DAY), D.scoreFor(D.DAY));
  const cats = explainCategories(D.DAY, { slots: D.MEAL_KEYS, denom: 4, nowMin: 750, fmtClock: (m) => String(m) });
  assert.ok(cats.some((x) => x.id === 'arrival'), 'an Arrival card exists when arrival carries points');
  const sum = cats.reduce((n, x) => n + x.earned, 0);
  assert.ok(Math.abs(sum - D.scoreFor(D.DAY)) <= 1, `parts ${sum} vs ring ${D.scoreFor(D.DAY)}`);
  D.DAY.arrival = null;
});
