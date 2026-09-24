/* Roll call v3 client calls. Run: node --test proto/redesign-2026-07/js/rollcall-v3-data.test.mjs */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  markRollcallSeen, primerState, setPrimer, loadArming, seedArmingForHarness, armingFor, remindArm, notifyRollcall, _resetV3ForTests,
} from './rollcall-v3-data.js';

function fakeSb(h) {
  const calls = [];
  return {
    calls,
    rpc: async (n, a) => { calls.push([n, a]); return h[n] ? h[n](a) : { data: null, error: { message: 'no' } }; },
    functions: { invoke: async (n, o) => { calls.push([n, o.body]); return h[n] ? h[n](o.body) : { data: null, error: { context: { status: 500 } } }; } },
  };
}
const withSb = (sb) => { globalThis.window = { sb }; _resetV3ForTests(); return sb; };

test('seen is stamped once per roll call per session, and retried after a failure', async () => {
  let fail = true;
  const sb = withSb(fakeSb({ mark_rollcall_seen: () => (fail ? { data: null, error: { message: 'x' } } : { data: 1, error: null }) }));
  assert.equal(await markRollcallSeen('c1'), false);
  fail = false;
  assert.equal(await markRollcallSeen('c1'), true);
  assert.equal(await markRollcallSeen('c1'), false);
  assert.equal(sb.calls.filter(([n]) => n === 'mark_rollcall_seen').length, 2);
});

test('the primer answer reads back; a failed read is null, never "never answered"', async () => {
  withSb(fakeSb({ alarm_primer_state: () => ({ data: { at: '2026-09-24T01:00:00Z', answer: 'not_now' }, error: null }) }));
  assert.deepEqual(await primerState(), { at: '2026-09-24T01:00:00Z', answer: 'not_now' });
  withSb(fakeSb({}));
  assert.equal(await primerState(), null);
  withSb(fakeSb({ set_alarm_primer: () => ({ data: true, error: null }) }));
  assert.equal(await setPrimer('maybe'), false);
  assert.equal(await setPrimer('continue'), true);
  assert.equal((await primerState()).answer, 'continue');
});

test('the cached primer answer belongs to one account: another sign-in reads its own', async () => {
  const { setVcUidProvider } = await import('./commitment-data.js');
  let uid = 'a';
  setVcUidProvider(() => uid);
  const sb = withSb(fakeSb({ alarm_primer_state: () => ({ data: { at: null, answer: null }, error: null }), set_alarm_primer: () => ({ data: true, error: null }) }));
  await setPrimer('not_now');
  assert.equal((await primerState()).answer, 'not_now');
  uid = 'b';
  assert.equal((await primerState()).answer, null, 'B never inherits A’s Not now');
  assert.equal(sb.calls.filter(([n]) => n === 'alarm_primer_state').length, 1);
  setVcUidProvider(null);
});

test('remind and notify map the coach function answers', async () => {
  withSb(fakeSb({ 'roll-call-coach': (b) => (b.action === 'remind_arm'
    ? { data: { ok: true, targeted: 3 }, error: null } : { data: { ok: true, pushed: 5 }, error: null }) }));
  assert.deepEqual(await remindArm('i1'), { sent: 3, reason: 'ok' });
  assert.deepEqual(await notifyRollcall('c1'), { sent: 5, reason: 'ok' });
  withSb(fakeSb({ 'roll-call-coach': () => ({ data: null, error: { context: { status: 429 } } }) }));
  assert.deepEqual(await remindArm('i1'), { sent: 0, reason: 'rate_limited' });
});

test('a seeded arming board never refetches; a failed read is null', async () => {
  const sb = withSb(fakeSb({}));
  seedArmingForHarness('i9', { rows: [] });
  assert.deepEqual(await loadArming('i9', true), { rows: [] });
  assert.equal(await loadArming('i8'), null);
  assert.equal(armingFor('i8'), null);
  assert.equal(sb.calls.filter(([n]) => n === 'rollcall_arming').length, 1);
  delete globalThis.window;
});
