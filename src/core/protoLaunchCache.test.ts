/**
 * The cold-launch cache (proto js/launch-cache.js) holds what Home last showed for ONE account:
 * photo URLs + thumbnails, the past-day rails, the coach-seen and coach-replied receipts. It is
 * painted before the server answers, so it must never survive into another account:
 *   1. signOut drops it (storage AND the in-memory copy),
 *   2. a Keychain restore for a DIFFERENT user drops it before that user's first paint,
 *   3. a restore for the SAME user keeps it (that is the whole point: the next launch paints it).
 * Same jsdom-before-require pattern as protoSessionWipe.test.ts.
 */
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost' });
(globalThis as any).window = dom.window;
(globalThis as any).document = dom.window.document;
(globalThis as any).localStorage = dom.window.localStorage;

/* eslint-disable @typescript-eslint/no-var-requires */
const { RT, act } = require('../../proto/redesign-2026-07/js/state.js');
const LC = require('../../proto/redesign-2026-07/js/launch-cache.js');

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
const sb = {
  auth: { signOut: async () => ({}) },
  from: () => chain(),
  rpc: async () => ({ data: null, error: null }),
  functions: { invoke: async () => ({ data: null, error: null }) },
  storage: { from: () => ({ upload: async () => ({}), createSignedUrls: async () => ({ data: [] }) }) },
};

const KEY_A = 'onstd-launch-user-a';
function seedA() {
  RT.userId = 'user-a';
  RT.authRole = 'athlete';
  dom.window.localStorage.setItem(KEY_A, JSON.stringify({ uid: 'user-a', seen: { date: '2026-07-23', rows: [{ seen_at: 'x', viewer_name: 'Coach' }] } }));
  LC.launchOwner('user-a');
  expect(LC.launchCache('user-a').seen).toBeTruthy();
}

beforeEach(() => {
  dom.window.localStorage.clear();
  (dom.window as any).sb = sb;
  act._wipeUserScopedState();
});

test('signOut drops the launch cache, stored and in memory', async () => {
  seedA();
  await act.signOut();
  expect(dom.window.localStorage.getItem(KEY_A)).toBeNull();
  expect(LC.launchCache('user-a').seen).toBeUndefined();
});

test('restoring a DIFFERENT account drops the previous one before anything paints', async () => {
  seedA();
  await act._syncSession({ id: 'user-b', email: 'b@example.com' });
  expect(dom.window.localStorage.getItem(KEY_A)).toBeNull();
  expect(LC.launchCache('user-b').seen).toBeUndefined();
});

test('restoring the SAME account keeps it for the cold-launch paint', async () => {
  seedA();
  await act._syncSession({ id: 'user-a', email: 'a@example.com' });
  expect(LC.launchCache('user-a').seen.date).toBe('2026-07-23');
});
