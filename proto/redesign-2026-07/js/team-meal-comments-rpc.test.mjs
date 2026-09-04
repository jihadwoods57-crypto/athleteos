/* node --test — fetchTeamMealComments's RPC-first path (0219) and its fallback contract.

   Same three-server discipline as team-activity-rpc.test.mjs (0214), because the migration is
   authored but not applied until the founder runs it: a server with the RPC must be used, a
   server without it must fall back to the chunked reads and stop re-paying the doomed round
   trip, and a server that is simply down must answer null, never a confirmed-empty [] — the
   inbox's needsResponse count prints "All caught up" off that value. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as roles from './roles.js';

const ROWS = [
  { meal_id: 'm2', athlete_id: 'a1', role: 'coach', kind: 'message', created_at: '2026-09-02T12:00:00Z' },
  { meal_id: 'm1', athlete_id: 'a2', role: 'athlete', kind: 'message', created_at: '2026-09-02T08:00:00Z' },
];

/* A client whose rpc() answers as scripted and whose from() records whether the chunked
   path ran. Chained builder methods all return the same thenable, like supabase-js. */
function client({ rpc, fromData = ROWS }) {
  const calls = { rpc: 0, from: 0, rpcArgs: [] };
  const chain = () => {
    const p = new Proxy(function () {}, {
      get(_t, prop) {
        if (prop === 'then') return (res, rej) => Promise.resolve({ data: fromData, error: null }).then(res, rej);
        return () => p;
      },
      apply() { return p; },
    });
    return p;
  };
  return {
    calls,
    rpc: (fn, args) => { calls.rpc += 1; calls.rpcArgs.push([fn, args]); return Promise.resolve(rpc()); },
    from: () => { calls.from += 1; return chain(); },
  };
}

function withClient(c, fn) {
  globalThis.window = globalThis.window || {};
  const prev = globalThis.window.sb;
  globalThis.window.sb = c;
  roles.__resetTeamMealCommentsRpc();
  return Promise.resolve(fn()).finally(() => {
    globalThis.window.sb = prev;
    roles.__resetTeamMealCommentsRpc();
  });
}

test('server has 0219: the RPC answers and no chunked read is issued', async () => {
  const c = client({ rpc: () => ({ data: ROWS, error: null }) });
  await withClient(c, async () => {
    const out = await roles.fetchTeamMealComments(['a1', 'a2'], '2026-08-28T00:00:00Z');
    assert.deepEqual(out, ROWS);
    assert.equal(c.calls.rpc, 1);
    assert.equal(c.calls.from, 0);
    const [fn, args] = c.calls.rpcArgs[0];
    assert.equal(fn, 'team_meal_comments_batch');
    assert.deepEqual(args.p_athletes, ['a1', 'a2']);
    assert.equal(args.p_since, '2026-08-28T00:00:00Z');
    assert.equal(args.p_limit, 1000, 'the client asks for the same 1000-row ceiling the chunked path slices to');
  });
});

test('pre-0219 server (PGRST202): falls back to chunked reads, and remembers not to retry the RPC', async () => {
  const c = client({ rpc: () => ({ data: null, error: { code: 'PGRST202', message: 'function not found' } }) });
  await withClient(c, async () => {
    const first = await roles.fetchTeamMealComments(['a1', 'a2'], '2026-08-28T00:00:00Z');
    assert.deepEqual(first, ROWS, 'fallback must return the chunked result');
    assert.equal(c.calls.rpc, 1);
    assert.equal(c.calls.from, 1);
    await roles.fetchTeamMealComments(['a1', 'a2'], '2026-08-28T00:00:00Z');
    assert.equal(c.calls.rpc, 1, 'a missing function is remembered — no second doomed POST');
    assert.equal(c.calls.from, 2);
  });
});

test('transient RPC error: falls back this call, but retries the RPC next call', async () => {
  const c = client({ rpc: () => ({ data: null, error: { code: 'PGRST000', message: 'unreachable' } }) });
  await withClient(c, async () => {
    const out = await roles.fetchTeamMealComments(['a1'], '2026-08-28T00:00:00Z');
    assert.deepEqual(out, ROWS, 'a transient RPC failure must degrade to the chunked result, not fail the read');
    await roles.fetchTeamMealComments(['a1'], '2026-08-28T00:00:00Z');
    assert.equal(c.calls.rpc, 2, 'only PGRST202 is remembered; transient errors must keep retrying');
    assert.equal(c.calls.from, 2, 'the chunked fallback must actually run on each transient failure');
  });
});

test('no ids: the guard answers [] before any request — the RPC is never tried', async () => {
  const c = client({ rpc: () => ({ data: ROWS, error: null }) });
  await withClient(c, async () => {
    const out = await roles.fetchTeamMealComments([], '2026-08-28T00:00:00Z');
    assert.deepEqual(out, []);
    assert.equal(c.calls.rpc, 0);
    assert.equal(c.calls.from, 0);
  });
});
