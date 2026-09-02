/* node --test — fetchTeamActivity's RPC-first path (0214) and its fallback contract.

   The migration is authored but not applied until the founder runs it, so the client MUST be
   correct against three servers: one with the RPC (use it), one without (fall back to the
   chunked reads, and stop re-paying the doomed round trip), and one that is simply down
   (null, never a confirmed-empty []). The last is also covered by fetcher-contract.test.mjs;
   it is re-pinned here because this file owns the path that could regress it. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as roles from './roles.js';

const ROWS = [
  { id: 'm2', athlete_id: 'a1', logged_at: '2026-09-02T12:00:00Z' },
  { id: 'm1', athlete_id: 'a2', logged_at: '2026-09-02T08:00:00Z' },
];

/* A client whose rpc() answers as scripted and whose from() records whether the chunked
   path ran. Chained builder methods all return the same thenable, like supabase-js. */
function client({ rpc, fromData = ROWS }) {
  const calls = { rpc: 0, from: 0 };
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
    rpc: () => { calls.rpc += 1; return Promise.resolve(rpc()); },
    from: () => { calls.from += 1; return chain(); },
  };
}

function withClient(c, fn) {
  globalThis.window = globalThis.window || {};
  const prev = globalThis.window.sb;
  globalThis.window.sb = c;
  roles.__resetTeamActivityRpc();
  return Promise.resolve(fn()).finally(() => {
    globalThis.window.sb = prev;
    roles.__resetTeamActivityRpc();
  });
}

test('server has 0214: the RPC answers and no chunked read is issued', async () => {
  const c = client({ rpc: () => ({ data: ROWS, error: null }) });
  await withClient(c, async () => {
    const out = await roles.fetchTeamActivity('2026-08-27', 400, ['a1', 'a2']);
    assert.deepEqual(out, ROWS);
    assert.equal(c.calls.rpc, 1);
    assert.equal(c.calls.from, 0);
  });
});

test('pre-0214 server (PGRST202): falls back to chunked reads, and remembers not to retry the RPC', async () => {
  const c = client({ rpc: () => ({ data: null, error: { code: 'PGRST202', message: 'function not found' } }) });
  await withClient(c, async () => {
    const first = await roles.fetchTeamActivity('2026-08-27', 400, ['a1', 'a2']);
    assert.deepEqual(first, ROWS, 'fallback must return the chunked result');
    assert.equal(c.calls.rpc, 1);
    assert.equal(c.calls.from, 1);
    await roles.fetchTeamActivity('2026-08-27', 400, ['a1', 'a2']);
    assert.equal(c.calls.rpc, 1, 'a missing function is remembered — no second doomed POST');
    assert.equal(c.calls.from, 2);
  });
});

test('transient RPC error: falls back this call, but retries the RPC next call', async () => {
  const c = client({ rpc: () => ({ data: null, error: { code: 'PGRST000', message: 'unreachable' } }) });
  await withClient(c, async () => {
    await roles.fetchTeamActivity('2026-08-27', 400, ['a1']);
    await roles.fetchTeamActivity('2026-08-27', 400, ['a1']);
    assert.equal(c.calls.rpc, 2, 'only PGRST202 is remembered; transient errors must keep retrying');
  });
});

test('no ids: the un-chunked branch is untouched — the RPC is never tried', async () => {
  const c = client({ rpc: () => ({ data: ROWS, error: null }) });
  await withClient(c, async () => {
    await roles.fetchTeamActivity('2026-08-27', 20);
    assert.equal(c.calls.rpc, 0);
    assert.equal(c.calls.from, 1);
  });
});
