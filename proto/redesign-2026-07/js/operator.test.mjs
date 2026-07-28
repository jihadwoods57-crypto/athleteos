/* Golden tests for the operator spine — the PURE engines every coach screen renders from, and
   which the trainer side is about to render from too. Written BEFORE the team/practice
   generalization: green here means the generalization changed no behavior for a team book.

   Fixtures are two books of the same shape — one team, one practice. The practice book is
   deliberately position-less (practice_roster hardcodes position: null) and set-less (requirement
   sets are team-owned until 0136), because that is the exact shape the trainer renders today. */
import assert from 'node:assert';
import { athleteStatus, teamPulse, runsOn, STATUS_META } from './status.js';
import { buildPriorities, reasonKey } from './priority.js';
import { resolveRequirementSet, catalogFromItems, CATALOG } from './requirements.js';
import { scopeFilter, localClock, entriesFor, CD, can, getScope, setScope } from './coach-data.js';

const T = (h, m = 0) => h * 60 + m;
const FRI = 5, THU = 4;
const NOW_MS = Date.parse('2026-07-24T19:12:00Z');   // fixed instant — no Date.now anywhere

/* Two required items with real windows, mirroring a shipped standard. */
const REQS = [
  { id: 'breakfast', title: 'Breakfast', required: true, window: { open: T(6), due: T(10) }, freq: { type: 'daily' } },
  { id: 'dinner', title: 'Dinner', required: true, window: { open: T(17), due: T(21) }, freq: { type: 'daily' } },
  { id: 'weigh', title: 'Morning Weight', required: true, window: { open: T(6), due: T(9) }, freq: { type: 'days', days: [1, 3, 5] } },
];

const row = (over = {}) => ({
  athleteId: 'a1', name: 'Devin', position: 'LB', unit: 'LB',
  loggedToday: false, score: null, tasks: [], lastMealAt: null, scoreHistory: [], ...over,
});

/* ---------------- athleteStatus: precedence ladder ---------------- */
{
  // excused beats everything, even two overdue items.
  const s = athleteStatus({ nowMin: T(22), nowMs: NOW_MS, row: row(), reqs: REQS, excused: true, nowDow: FRI });
  assert.strictEqual(s.key, 'excused');
}
{
  // 22:00 Friday, nothing done -> breakfast + dinner + weigh all overdue. Oxford join.
  const s = athleteStatus({ nowMin: T(22), nowMs: NOW_MS, row: row(), reqs: REQS, excused: false, nowDow: FRI });
  assert.strictEqual(s.key, 'overdue');
  assert.strictEqual(s.detail, 'Breakfast, Dinner and Morning Weight overdue');
}
{
  // Same clock on THURSDAY: the MWF weigh-in must not enter the list at all.
  const s = athleteStatus({ nowMin: T(22), nowMs: NOW_MS, row: row(), reqs: REQS, excused: false, nowDow: THU });
  assert.strictEqual(s.detail, 'Breakfast and Dinner overdue', 'off-schedule item must not read overdue');
}
{
  // A logged, scored-low day outranks due_soon but not overdue.
  const r = row({ loggedToday: true, score: 62, tasks: [{ id: 'breakfast', done: true }, { id: 'dinner', done: true }, { id: 'weigh', done: true }] });
  const s = athleteStatus({ nowMin: T(20), nowMs: NOW_MS, row: r, reqs: REQS, excused: false, nowDow: FRI });
  assert.strictEqual(s.key, 'below_standard');
  assert.strictEqual(s.detail, 'Scored 62 today');
}
{
  // 20:30 — dinner due 21:00 is inside the 60-minute due_soon window; everything else done.
  const r = row({ tasks: [{ id: 'breakfast', done: true }, { id: 'weigh', done: true }] });
  const s = athleteStatus({ nowMin: T(20, 30), nowMs: NOW_MS, row: r, reqs: REQS, excused: false, nowDow: FRI });
  assert.strictEqual(s.key, 'due_soon');
  assert.strictEqual(s.detail, 'Dinner window closes in 30 minutes');
}
{
  // Grace: an item 20 min past due with 30 min grace is still closing, not overdue.
  const graced = [{ id: 'dinner', title: 'Dinner', required: true, grace: 30, window: { open: T(17), due: T(21) }, freq: { type: 'daily' } }];
  const s = athleteStatus({ nowMin: T(21, 20), nowMs: NOW_MS, row: row(), reqs: graced, excused: false, nowDow: FRI });
  assert.strictEqual(s.key, 'due_soon', 'inside grace must not flip to overdue');
  const past = athleteStatus({ nowMin: T(21, 40), nowMs: NOW_MS, row: row(), reqs: graced, excused: false, nowDow: FRI });
  assert.strictEqual(past.key, 'overdue', 'past grace must flip to overdue');
}
{
  // Logged but unscored -> needs_review from the second precedence position.
  const r = row({ loggedToday: true, score: null, tasks: REQS.map(q => ({ id: q.id, done: true })) });
  const s = athleteStatus({ nowMin: T(20), nowMs: NOW_MS, row: r, reqs: REQS, excused: false, nowDow: FRI });
  assert.strictEqual(s.key, 'needs_review');
}
{
  // Clean day, everything done, scored well.
  const r = row({ loggedToday: true, score: 94, tasks: REQS.map(q => ({ id: q.id, done: true })) });
  const s = athleteStatus({ nowMin: T(22), nowMs: NOW_MS, row: r, reqs: REQS, excused: false, nowDow: FRI });
  assert.strictEqual(s.key, 'on_standard');
}
{
  // Every status key the engine can emit must have render metadata.
  for (const k of ['excused', 'overdue', 'needs_review', 'below_standard', 'due_soon', 'no_activity', 'on_standard']) {
    assert.ok(STATUS_META[k] && STATUS_META[k].label, `STATUS_META missing ${k}`);
  }
}

/* ---------------- runsOn: schedule gating ---------------- */
assert.strictEqual(runsOn({ freq: { type: 'daily' } }, THU), true);
assert.strictEqual(runsOn({ freq: { type: 'days', days: [1, 3, 5] } }, THU), false);
assert.strictEqual(runsOn({ freq: { type: 'days', days: [1, 3, 5] } }, FRI), true);
assert.strictEqual(runsOn({ freq: { type: 'weekly', day: 0 } }, FRI), false);
assert.strictEqual(runsOn({}, THU), true, 'unknown freq must never phantom-hide an item');

/* ---------------- THE PRACTICE-BOOK CLAIM ----------------
   The whole no-migration trainer story rests on this: a practice has no requirement sets, so
   resolveRequirementSet returns null and the built-in CATALOG governs. If this ever changes,
   the trainer roster silently starts scoring against nothing. */
assert.strictEqual(resolveRequirementSet([], 'a1', 'LB'), null, 'empty sets must resolve to null');
assert.strictEqual(resolveRequirementSet(null, 'a1', null), null);
assert.strictEqual(resolveRequirementSet([], 'a1', null), null, 'position-less (practice) row must also resolve null');
{
  const set = resolveRequirementSet([], 'a1', null);
  const reqs = set ? catalogFromItems(set.items) : CATALOG;
  assert.strictEqual(reqs, CATALOG, 'a practice book must fall through to the built-in CATALOG');
  assert.ok(CATALOG.length > 0);
}
{
  // Team book still resolves athlete > position > team, unchanged.
  const sets = [
    { scope_kind: 'team', scope_value: null, items: [] },
    { scope_kind: 'position', scope_value: 'LB', items: [] },
    { scope_kind: 'athlete', scope_value: 'a1', items: [] },
  ];
  assert.strictEqual(resolveRequirementSet(sets, 'a1', 'LB').scope_kind, 'athlete');
  assert.strictEqual(resolveRequirementSet(sets, 'a2', 'LB').scope_kind, 'position');
  assert.strictEqual(resolveRequirementSet(sets, 'a2', 'WR').scope_kind, 'team');
  assert.strictEqual(resolveRequirementSet(sets, 'a2', null).scope_kind, 'team', 'null position skips the room tier');
}

/* ---------------- teamPulse: works on a practice book too ---------------- */
{
  const rows = [
    { athleteId: 'a1', score: 90, tasks: [{ done: true }, { done: true }], scoreHistory: [{ date: '2026-07-23', score: 80 }] },
    { athleteId: 'a2', score: 70, tasks: [{ done: true }, { done: false }], scoreHistory: [{ date: '2026-07-23', score: 60 }] },
  ];
  const statuses = { a1: { key: 'on_standard' }, a2: { key: 'below_standard' } };
  const p = teamPulse(rows, statuses, '2026-07-24');
  assert.strictEqual(p.avg, 80);
  assert.strictEqual(p.deltaVsYesterday, 10);
  assert.strictEqual(p.onStandard, 1);
  assert.strictEqual(p.completionPct, 75);
}
{
  // A practice book has no scoreHistory (loadTrainerBook fetched 1 day) -> delta must be null,
  // never 0. This is the surface Slice A fixes by widening the fetch to 7 days.
  const rows = [{ athleteId: 'a1', score: 90, tasks: [], scoreHistory: [] }];
  const p = teamPulse(rows, { a1: { key: 'on_standard' } }, '2026-07-24');
  assert.strictEqual(p.avg, 90);
  assert.strictEqual(p.deltaVsYesterday, null, 'no history must read as unknown, not flat');
  assert.strictEqual(p.completionPct, null, 'no tasks must read as unknown, not 0%');
}
{
  const p = teamPulse([], {}, '2026-07-24');
  assert.strictEqual(p.avg, null);
  assert.strictEqual(p.overdue, 0);
}

/* ---------------- buildPriorities: ranking + mark-handled ---------------- */
{
  const mk = (id, name, st, over = {}) => ({ row: row({ athleteId: id, name, ...over }), status: st });
  const overdue2 = athleteStatus({ nowMin: T(22), nowMs: NOW_MS, row: row(), reqs: REQS, excused: false, nowDow: THU });
  const low = athleteStatus({
    nowMin: T(20), nowMs: NOW_MS, reqs: REQS, excused: false, nowDow: FRI,
    row: row({ loggedToday: true, score: 62, tasks: REQS.map(q => ({ id: q.id, done: true })) }),
  });
  const clean = athleteStatus({
    nowMin: T(22), nowMs: NOW_MS, reqs: REQS, excused: false, nowDow: FRI,
    row: row({ loggedToday: true, score: 94, tasks: REQS.map(q => ({ id: q.id, done: true })) }),
  });

  const entries = [
    mk('a2', 'Sam', low, { loggedToday: true, score: 62 }),
    mk('a1', 'Devin', overdue2),
    mk('a3', 'Chris', clean, { loggedToday: true, score: 94 }),
  ];
  const q = buildPriorities({ nowMin: T(22), nowMs: NOW_MS, entries, interventions: [] });
  assert.strictEqual(q.length, 2, 'on_standard must not enter the queue');
  assert.strictEqual(q[0].name, 'Devin', 'critical outranks below');
  assert.strictEqual(q[0].tier, 'critical');
  assert.strictEqual(q[1].name, 'Sam');
  assert.ok(!('_sort' in q[0]), 'internal sort key must not leak to the render');

  // Mark-handled: an intervention matching the CURRENT signature removes the card.
  const handled = buildPriorities({
    nowMin: T(22), nowMs: NOW_MS, entries,
    interventions: [{ athlete_id: 'a1', reason_key: reasonKey(overdue2) }],
  });
  assert.strictEqual(handled.length, 1);
  assert.strictEqual(handled[0].name, 'Sam');

  // A stale signature must NOT suppress a genuinely new reason.
  const stale = buildPriorities({
    nowMin: T(22), nowMs: NOW_MS, entries,
    interventions: [{ athlete_id: 'a1', reason_key: 'overdue:something-else' }],
  });
  assert.strictEqual(stale.length, 2, 'a changed reason must resurface the athlete');
}
{
  // A practice entry carries no unit (no rooms) — the card must still build.
  const st = athleteStatus({ nowMin: T(22), nowMs: NOW_MS, row: row(), reqs: CATALOG, excused: false, nowDow: FRI });
  const q = buildPriorities({
    nowMin: T(22), nowMs: NOW_MS, interventions: [],
    entries: [{ row: row({ position: null, unit: null }), status: st }],
  });
  assert.strictEqual(q.length, 1);
  assert.strictEqual(q[0].unit, '', 'a unit-less practice row must render an empty unit, not undefined');
}
assert.deepStrictEqual(buildPriorities({ nowMin: 0, nowMs: NOW_MS, entries: [], interventions: [] }), []);

/* ---------------- scopeFilter / entriesFor / localClock ---------------- */
{
  const rows = [
    { athleteId: 'a1', position: 'LB' },
    { athleteId: 'a2', position: 'WR' },
    { athleteId: 'a3', position: null },   // the practice shape
  ];
  assert.strictEqual(scopeFilter(rows, { kind: 'team', value: null }).length, 3);
  assert.strictEqual(scopeFilter(rows, null).length, 3);
  assert.strictEqual(scopeFilter(rows, { kind: 'position', value: 'lb' }).length, 1, 'position match is case-insensitive');
  assert.strictEqual(scopeFilter(rows, { kind: 'athlete', value: 'a2' }).length, 1);
  // BUG 5 — a position scope leaking from a coach session annihilates a practice book, silently.
  assert.strictEqual(
    scopeFilter([{ athleteId: 'a3', position: null }], { kind: 'position', value: 'LB' }).length, 0,
    'documents why the scope key must be namespaced per book',
  );
}
// entriesFor must stay null (skeleton) until BOTH roster and extras are loaded — never throw,
// never return [] (which screens would render as a real empty roster).
assert.strictEqual(entriesFor({ kind: 'team', value: null }), null);

assert.strictEqual(localClock(null, NOW_MS), null);
assert.strictEqual(localClock('Not/AZone', NOW_MS), null, 'a bad tz must degrade to the caller clock, not throw');
{
  const c = localClock('America/New_York', NOW_MS);
  assert.ok(c && typeof c.nowMin === 'number' && c.nowMin >= 0 && c.nowMin < 1440);
  assert.ok(c.nowDow >= 0 && c.nowDow <= 6);
  const utc = localClock('UTC', NOW_MS);
  assert.strictEqual(utc.nowMin, T(19, 12), 'UTC projection must match the fixed instant');
}

/* ---------------- capability map ----------------
   These assertions encode DECISIONS, not just current values. If one fails, the question is
   "did we mean to change what a trainer can do?", not "update the number". */
{
  // Default book is a team, and a coach can do everything — no shipped coach screen consults caps.
  assert.strictEqual(CD.kind, 'team');
  for (const cap of ['roster', 'inbox', 'interventions', 'notes', 'standards', 'rooms', 'staffRoles', 'rollups']) {
    assert.strictEqual(can(cap), true, `a coach must retain '${cap}'`);
  }
  // Monetization is trainer-only and must never light up on a team book.
  for (const cap of ['offers', 'payments', 'packages']) {
    assert.strictEqual(can(cap), false, `'${cap}' must stay off for a coach`);
  }
  assert.strictEqual(can('nonexistent-cap'), false, 'an unknown cap must deny, never throw');
}

/* ---------------- BUG 5: the scope key must be namespaced per book ----------------
   A coach session persisting {kind:'position'} used to leak into a trainer session, where
   position is always null -> scopeFilter matched nothing -> an EMPTY book with no error. */
{
  const store = new Map();
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, v),
    removeItem: (k) => store.delete(k),
  };
  setScope({ kind: 'position', value: 'LB' });
  assert.deepStrictEqual(getScope(), { kind: 'position', value: 'LB' }, 'a coach scope round-trips');
  const keys = [...store.keys()];
  assert.strictEqual(keys.length, 1);
  assert.ok(keys[0].includes('team'), `scope key must name its book kind, got ${keys[0]}`);
  assert.ok(!keys[0].includes('practice'), 'a team scope must not occupy the practice key');
  // The practice key is a different slot, so nothing a coach saved can ever be read as a
  // practice scope. (CD.kind only flips inside loadBook, which needs a live client.)
  assert.strictEqual(store.has('onstd-scope-practice-v1'), false);
  delete globalThis.localStorage;
}

console.log('operator spine: all assertions passed');
