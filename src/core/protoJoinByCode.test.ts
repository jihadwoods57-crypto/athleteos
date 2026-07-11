/**
 * CONNECT-A-COACH (invite loop, athlete side): act.joinByCode must redeem a real code via the
 * join_team RPC (falling back to join_practice for trainer codes), normalize input, fail
 * honestly offline, and never claim a connection the server didn't confirm.
 *
 * Same node+jsdom bootstrap as the other proto tests.
 */
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost' });
(globalThis as any).window = dom.window;
(globalThis as any).document = dom.window.document;
(globalThis as any).localStorage = dom.window.localStorage;

/* eslint-disable @typescript-eslint/no-var-requires */
const { RT, act } = require('../../proto/redesign-2026-07/js/state.js');

/** Thenable chainable no-rows query stub (for the post-join hydration reads). */
function chain(): any {
  const p: any = new Proxy(function () { /* callable */ }, {
    get(_t, prop) {
      if (prop === 'then') return (resolve: (v: unknown) => void) => resolve({ data: null, error: null });
      return () => p;
    },
    apply() { return p; },
  });
  return p;
}

function sbWithRpc(rpcImpl: (name: string, args: Record<string, unknown>) => { error: unknown }) {
  return {
    rpc: async (name: string, args: Record<string, unknown>) => rpcImpl(name, args),
    from: () => chain(),
    auth: { signOut: async () => ({}) },
  };
}

beforeEach(() => {
  dom.window.localStorage.clear();
  act._wipeUserScopedState();
  RT.userId = 'athlete-1';
  delete (dom.window as any).sb;
});

test('empty code → honest validation error, no RPC needed', async () => {
  const r = await act.joinByCode('   ');
  expect(r.ok).toBe(false);
  expect(r.error).toMatch(/Enter the code/);
});

test('offline (no client) → honest offline error, never a fake success', async () => {
  const r = await act.joinByCode('EAGLES');
  expect(r.ok).toBe(false);
  expect(r.error).toMatch(/online/);
});

test('valid team code → ok, normalized to uppercase, position passed through', async () => {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  RT.profile = { name: 'A', position: 'LB' };
  (dom.window as any).sb = sbWithRpc((name, args) => {
    calls.push({ name, args });
    return name === 'join_team' ? { error: null } : { error: { message: 'nope' } };
  });
  const r = await act.joinByCode('  eagles24 ');
  expect(r).toEqual({ ok: true, kind: 'team' });
  expect(calls[0]).toEqual({ name: 'join_team', args: { code: 'EAGLES24', athlete_position: 'LB' } });
});

test('team RPC rejects but practice accepts → connected as practice', async () => {
  (dom.window as any).sb = sbWithRpc((name) =>
    name === 'join_practice' ? { error: null } : { error: { message: 'invalid team code' } });
  const r = await act.joinByCode('trainer1');
  expect(r).toEqual({ ok: true, kind: 'practice' });
});

test('neither RPC accepts → honest failure message', async () => {
  (dom.window as any).sb = sbWithRpc(() => ({ error: { message: 'invalid code' } }));
  const r = await act.joinByCode('WRONG');
  expect(r.ok).toBe(false);
  expect(r.error).toMatch(/didn’t match/);
});
