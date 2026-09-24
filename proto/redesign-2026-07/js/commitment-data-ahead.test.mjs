/* loadMineAhead's cache (roll call v3, review round 2).

   armAhead (home.js) used to force a fresh 14-day read on EVERY Home render — Home is re-mounted
   by window.__render(), and that call has hundreds of sites across the app, so a coach's roster
   was reading two extra RPCs (one a WRITE, ensure_my_commitment_instances) on nearly every tap.
   Only three moments actually need a guaranteed-fresh read: the first Home mount this app open,
   a foreground resume, and right after an answer. Everything else should ride this cache.

   This file drives loadMineAhead directly (home.js's DOM is too heavy to mount in node:test);
   home.js's own force/no-force wiring at those three call sites is the thin, obviously-correct
   layer on top of what's tested here.

   Run: node --test proto/redesign-2026-07/js/commitment-data-ahead.test.mjs */
import test from 'node:test';
import assert from 'node:assert/strict';

globalThis.window = { sb: null };

const { loadMineAhead, _resetAhead, aheadRows, setVcUidProvider } = await import('./commitment-data.js');

/** A fake Supabase client. Counts one "load" per `my_commitments` call — the actual data read;
 *  `ensure_my_commitment_instances` (the write) always rides alongside it, one-for-one. Returns a
 *  mutable counter object (not a bare number) so callers can read it live across awaits. */
function fakeClient() {
  const counter = { loads: 0 };
  const client = {
    rpc: async (fn) => {
      if (fn === 'my_commitments') counter.loads++;
      return { data: [], error: null };
    },
  };
  return { client, counter };
}

test('N non-forced calls inside the freshness window cost exactly ONE load', async () => {
  _resetAhead();
  const { client, counter } = fakeClient();
  window.sb = client;
  for (let i = 0; i < 20; i++) await loadMineAhead(false);
  assert.equal(counter.loads, 1, 'renders 2..20 must all reuse the first render\'s cached read');
});

test('concurrent calls (a burst of renders in the same tick) share ONE in-flight load', async () => {
  _resetAhead();
  const { client, counter } = fakeClient();
  window.sb = client;
  // None of these is awaited before the next starts — exactly what a burst of __render() calls
  // produces. Without in-flight de-dupe each one opens its own round trip.
  await Promise.all(Array.from({ length: 12 }, () => loadMineAhead(false)));
  assert.equal(counter.loads, 1);
});

test('a forced call always loads, even immediately after another forced call', async () => {
  _resetAhead();
  const { client, counter } = fakeClient();
  window.sb = client;
  await loadMineAhead(true);
  await loadMineAhead(true);
  await loadMineAhead(true);
  assert.equal(counter.loads, 3, 'open, resume and answer must each see the server, not each other\'s cache');
});

test('a forced call mid-burst is folded into the SAME in-flight load, not a second one', async () => {
  _resetAhead();
  const { client, counter } = fakeClient();
  window.sb = client;
  const a = loadMineAhead(false);   // a render starts a load
  const b = loadMineAhead(true);    // an answer lands a moment later, wants a guaranteed load too
  await Promise.all([a, b]);
  assert.equal(counter.loads, 1, 'the already-in-flight read satisfies the forced caller too');
});

test('roll call v3: across N renders, exactly one load per open, resume, or answer', async () => {
  _resetAhead();
  const { client, counter } = fakeClient();
  window.sb = client;

  await loadMineAhead(true);                                          // app open
  for (let i = 0; i < 25; i++) await loadMineAhead(false);             // 25 ordinary renders
  await loadMineAhead(true);                                          // foreground resume
  for (let i = 0; i < 25; i++) await loadMineAhead(false);             // 25 more renders
  await loadMineAhead(true);                                          // an answer, right after
  for (let i = 0; i < 25; i++) await loadMineAhead(false);             // 25 more renders

  assert.equal(counter.loads, 3, '75 renders plus 3 forced moments must cost exactly 3 loads, not 78');
});

test('past the freshness window, even a non-forced call reloads', async () => {
  _resetAhead();
  const { client, counter } = fakeClient();
  window.sb = client;
  const realNow = Date.now;
  try {
    let t = realNow();
    Date.now = () => t;
    await loadMineAhead(false);
    assert.equal(counter.loads, 1);
    t += 60_000; // 1 minute later: still inside the ~2-minute window
    await loadMineAhead(false);
    assert.equal(counter.loads, 1);
    t += 90_000; // now 2.5 minutes past the first load
    await loadMineAhead(false);
    assert.equal(counter.loads, 2, 'a stale-enough cache must not stand in forever without a force');
  } finally {
    Date.now = realNow;
  }
});

test('roll call v3: a load started for one account never populates another account\'s cache', async () => {
  _resetAhead();
  const { client, counter } = fakeClient();
  window.sb = client;
  let uid = 'athlete-a';
  setVcUidProvider(() => uid);
  try {
    await loadMineAhead(true);           // fresh load for A
    assert.equal(counter.loads, 1);
    uid = 'athlete-b';                    // a fast switch on the same device, no sign-out in between
    await loadMineAhead(false);           // B must not be handed A's cache
    assert.equal(counter.loads, 2, 'a different signed-in account is never a cache hit');
  } finally {
    setVcUidProvider(null);
  }
});

test('roll call v3: an in-flight load\'s answer is discarded if the account changed before it landed', async () => {
  _resetAhead();
  let settleMyCommitments;
  let uid = 'athlete-a';
  setVcUidProvider(() => uid);
  window.sb = {
    rpc: async (fn) => {
      if (fn === 'my_commitments') return new Promise((res) => { settleMyCommitments = res; });
      return { data: null, error: null };
    },
  };
  try {
    const pending = loadMineAhead(true); // A's sign-out races this fetch
    // Let the fetch actually reach the my_commitments call (past the ensure-instances await)
    // before the account underneath it changes.
    await new Promise((r) => setTimeout(r, 0));
    uid = 'athlete-b'; // A signed out (or B signed in) while A's read was still in flight
    settleMyCommitments({ data: [{ instance_id: 'a-only-row' }], error: null }); // A's late answer
    await pending;
    assert.deepEqual(aheadRows(), [], 'A\'s stale answer must never land now that B is signed in');
  } finally {
    setVcUidProvider(null);
  }
});
