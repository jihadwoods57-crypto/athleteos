/* The roll-call rebuilt data layer in commitment-data.js (Task 8, 2026-09-23): the team board, the
 * coach's history, arrival by distance and the coach's saved place. Each is checked against a fake
 * Supabase client for the exact RPC name and argument names the server (0242) takes, and for the
 * fetcher contract: null means the read FAILED, never "nothing there".
 *
 * Run: node --test proto/redesign-2026-07/js/rollcall-team-data.test.mjs
 */
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

globalThis.window = globalThis.window || {};
globalThis.localStorage = globalThis.localStorage || { getItem: () => null, setItem() {}, removeItem() {} };
const CD = await import('./commitment-data.js');

let calls = [];
function client(answers) {
  calls = [];
  window.sb = {
    rpc: (name, args) => {
      calls.push([name, args]);
      const a = answers[name];
      if (a instanceof Error) return Promise.reject(a);
      return Promise.resolve(typeof a === 'function' ? a(args) : a || { data: null, error: null });
    },
  };
}
beforeEach(() => { delete window.sb; });

const BOARD = { instance_id: 'i1', total: 2, up: 1, closes_at: '2026-09-25T10:30:00Z', rows: [
  { athlete_id: 'd', name: 'DeShawn Cole', acknowledged_at: '2026-09-25T09:52:00Z', verdict: 'on_standard', place: 1 },
  { athlete_id: 'v', name: 'Tommy Vargas', acknowledged_at: null, verdict: 'pending', place: null }] };

test('loadTeamBoard calls rollcall_team_board(p_instance) and caches the board', async () => {
  client({ rollcall_team_board: { data: BOARD, error: null } });
  const b = await CD.loadTeamBoard('i1', true);
  assert.deepEqual(calls, [['rollcall_team_board', { p_instance: 'i1' }]]);
  assert.equal(b.up, 1);
  assert.equal(CD.VC.teamBoard('i1').up, 1);
  // Fresh cache: a second non-forced load does not refetch.
  await CD.loadTeamBoard('i1');
  assert.equal(calls.length, 1);
});

test('loadTeamBoard: a failed read keeps the last board and flags the error; never cached means null', async () => {
  client({ rollcall_team_board: { data: null, error: { message: 'not_authorized' } } });
  assert.equal(await CD.loadTeamBoard('never-seen', true), null);
  assert.equal(CD.VC.teamBoardError('never-seen'), true);
  const kept = await CD.loadTeamBoard('i1', true);
  assert.equal(kept && kept.instance_id, 'i1', 'the last good board stands');
  client({ rollcall_team_board: new Error('offline') });
  assert.equal((await CD.loadTeamBoard('i1', true)).instance_id, 'i1');
});

test('seedTeamBoardForHarness writes the cache loadTeamBoard reads (no network)', async () => {
  CD.seedTeamBoardForHarness('seeded', { ...BOARD, instance_id: 'seeded' });
  assert.equal(CD.VC.teamBoard('seeded').instance_id, 'seeded');
  client({});
  const b = await CD.loadTeamBoard('seeded');
  assert.equal(b.instance_id, 'seeded');
  assert.equal(calls.length, 0);
});

test('loadRollcallHistory calls rollcall_history(p_commitment, p_days) and defaults to 30 days', async () => {
  const H = { team_on_time_pct: 83, team_trend: -4, athletes: [] };
  client({ rollcall_history: { data: H, error: null } });
  assert.deepEqual(await CD.loadRollcallHistory('c1'), H);
  assert.deepEqual(calls[0], ['rollcall_history', { p_commitment: 'c1', p_days: 30 }]);
  client({ rollcall_history: { data: null, error: { message: 'not_authorized' } } });
  assert.equal(await CD.loadRollcallHistory('c2', 14), null, 'a refusal is null, never an empty history');
  CD.seedHistoryForHarness('c3', H);
  client({});
  assert.deepEqual(await CD.loadRollcallHistory('c3'), H);
  assert.equal(calls.length, 0);
});

test('arriveAt sends one reading to verify_arrival_at and returns the verdict, not the coordinates', async () => {
  client({ verify_arrival_at: { data: { status: 'arrived', within: true, distance_m: 42 }, error: null } });
  const r = await CD.arriveAt('i1', 'manual', { lat: 28.6, lng: -81.2, accuracy: 12 });
  assert.deepEqual(calls[0], ['verify_arrival_at', { p_instance: 'i1', p_source: 'manual', p_lat: 28.6, p_lng: -81.2, p_accuracy_m: 12 }]);
  assert.deepEqual(r, { ok: true, within: true, distance_m: 42 });
  client({ verify_arrival_at: { data: null, error: { message: 'no_place' } } });
  assert.deepEqual(await CD.arriveAt('i1', 'manual', { lat: 1, lng: 2 }), { ok: false, error: 'no_place' });
  assert.deepEqual(await CD.arriveAt('i1', 'manual', null), { ok: false, error: 'bad_position' });
});

test('savePlace calls save_commitment_place(p) with exactly one owner and returns the id', async () => {
  client({ save_commitment_place: { data: 'loc-1', error: null } });
  const place = { name: 'Weight room', address: '1 Main St', lat: 1, lng: 2, radius_m: 150 };
  assert.deepEqual(await CD.savePlace(place, 'team-1', 'team'), { ok: true, id: 'loc-1' });
  assert.deepEqual(calls[0], ['save_commitment_place', { p: { ...place, team_id: 'team-1', practice_id: null } }]);
  await CD.savePlace({ ...place, id: 'loc-1' }, 'prac-1', 'practice');
  assert.deepEqual(calls[1][1].p, { ...place, id: 'loc-1', team_id: null, practice_id: 'prac-1' });
  client({ save_commitment_place: { data: null, error: { message: 'radius_min' } } });
  assert.deepEqual(await CD.savePlace({ ...place, radius_m: 60 }, 'team-1', 'team'), { ok: false, error: 'radius_min' });
});

test('subscribeTeamBoard reloads the board on each tick and hands it over; unsubscribe stops it', async () => {
  // The clock is pinned inside the window (BOARD closes 10:30Z): past closes_at the board is idle
  // and polls slowly, so on the real clock this went red every day after 10:30 UTC.
  const realNow = Date.now;
  Date.now = () => Date.parse('2026-09-25T10:00:00Z');
  try {
    let n = 0;
    client({ rollcall_team_board: () => ({ data: { ...BOARD, up: ++n }, error: null }) });
    const seen = [];
    const stop = CD.subscribeTeamBoard('i1', (b) => seen.push(b.up), { pollMs: 5 });
    await new Promise((r) => setTimeout(r, 40));
    stop();
    const count = seen.length;
    assert.ok(count >= 2, `ticked ${count} times`);
    await new Promise((r) => setTimeout(r, 30));
    assert.equal(seen.length, count, 'no tick after unsubscribe');
    assert.ok(seen.every((v, i) => i === 0 || v > seen[i - 1]), 'each tick carries a fresh board');
  } finally { Date.now = realNow; }
});

/* ---------------------------------------------------------------- the QC/marketing stub */

test('the capture stub answers the four 0242 RPCs in the real shapes, with no coordinate', async () => {
  const { sbStubSource, ROSTER_ATHLETES } = await import('../../../web/landing-src/lib/sb-stub.mjs');
  const src = sbStubSource({ todayISO: '2026-09-25', athletes: ROSTER_ATHLETES });
  // The stub is injected as one script; it must evaluate, and hand createClient back our client.
  const fakeWindow = {};
  new Function('window', src)(fakeWindow);
  fakeWindow.supabase = { createClient: () => null };
  const c = fakeWindow.supabase.createClient();
  const board = (await c.rpc('rollcall_team_board', { p_instance: 'i-9' })).data;
  assert.equal(board.instance_id, 'i-9');
  assert.equal(board.rows.length, 6);
  assert.equal(board.total, 5, 'excused leaves the total');
  assert.equal(board.up, 4);
  const { boardModel } = await import('./team-board.js');
  const m = boardModel(board, 'ath-1', '2026-09-25T10:20:00Z');
  assert.equal(m.firstUp.name, 'DeShawn');
  assert.deepEqual(m.me, { place: 2, verdict: 'on_standard' });
  assert.equal(m.groups.late.length, 1);
  assert.doesNotMatch(JSON.stringify(board), /"lat"|"lng"/);
  const h = (await c.rpc('rollcall_history', { p_commitment: 'c1', p_days: 30 })).data;
  assert.equal(h.athletes.length, 6);
  assert.ok(h.athletes[0].on_time_pct <= h.athletes[5].on_time_pct, 'lowest rate first');
  const v = (await c.rpc('verify_arrival_at', { p_instance: 'i-9', p_source: 'manual', p_lat: 1, p_lng: 2, p_accuracy_m: 5 })).data;
  assert.equal(v.within, true);
  assert.doesNotMatch(JSON.stringify(v), /"lat"|"lng"|p_lat/);
  assert.equal((await c.rpc('save_commitment_place', { p: { name: 'Weight room' } })).data, 'loc-1');
});
