/**
 * SHARED-DEVICE SAFETY: a user signing out (or a different user signing in / being restored
 * from the Keychain) must never leave the previous account's day, identity, or onboarding
 * scratch behind. These tests lock the wipe semantics of proto state.js/day.js:
 *
 *   1. signOut wipes DAY + every user-scoped RT field, including dynamic keys that are not
 *      in DEFAULT_RT (e.g. _lastPlan) — Object.assign alone would leave them behind.
 *   2. A pending onboarding scratch survives sign-out ONLY when it carries its owner's email
 *      (the email-confirm flow routes through Welcome → signOut before the first sign-in).
 *   3. loadDay resets to a fresh day BEFORE merging cache/server rows, so a user with no
 *      server row can never inherit the previous session's meals (also fixes the
 *      midnight-crossing residue: yesterday's meals can't bleed into today's row).
 *   4. signIn by a different user wipes the previous user's state; a scratch whose email
 *      provably belongs to someone else is dropped, never rendered or backfilled.
 *   5. _syncSession (Keychain restore) with a different user id wipes first.
 *   6. deleteAccount wipes everything including the scratch.
 *
 * Runs under node with jsdom installed manually (same pattern as wireTogglesCapture.test.ts):
 * globals must exist BEFORE the proto module graph evaluates.
 */
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost' });
(globalThis as any).window = dom.window;
(globalThis as any).document = dom.window.document;
(globalThis as any).localStorage = dom.window.localStorage;

/* eslint-disable @typescript-eslint/no-var-requires */
const { RT, act } = require('../../proto/redesign-2026-07/js/state.js');
const { DAY, loadDay } = require('../../proto/redesign-2026-07/js/day.js');

/** Thenable chainable stub standing in for the supabase query builder: every method returns
 *  itself; awaiting it resolves { data: null, error: null } (i.e. "no rows anywhere"). */
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
function sbStub(userId: string) {
  return {
    auth: {
      signInWithPassword: async () => ({ data: { user: { id: userId } }, error: null }),
      signUp: async () => ({ data: { user: { id: userId }, session: null }, error: null }),
      signOut: async () => ({}),
    },
    from: () => chain(),
    rpc: async () => ({ data: null, error: null }),
    functions: { invoke: async () => ({ data: null, error: null }) },
    storage: { from: () => ({ upload: async () => ({}) }) },
  };
}

/** Pollute state as if user A had a full live session on this device. */
function seedUserA() {
  RT.userId = 'user-a';
  RT.email = 'a@example.com';
  RT.authRole = 'athlete';
  RT.profile = { name: 'Alice Athlete', sport: 'Soccer', school: 'Eastside' };
  RT.allergies = ['Peanuts'];
  RT.assigned = [{ id: 'rehab', title: 'Rehab', done: false, seen: false }];
  RT.injured = true;
  RT.camPrimed = true;
  (RT as any)._lastPlan = { date: '2026-07-10', plan: [] }; // dynamic key, not in DEFAULT_RT
  DAY.meals.breakfast = true;
  DAY.meals.lunch = true;
  DAY.slotMacros.breakfast = { protein: 40, kcal: 500 };
  DAY.hydrationL = 1.5;
  DAY.ciSubmitted = true;
  DAY.scoreHistory = [{ date: '2026-07-10', score: 88 }];
}

beforeEach(() => {
  dom.window.localStorage.clear();
  delete (dom.window as any).sb;
  act._wipeUserScopedState(); // clean slate between tests (the helper under test itself)
});

test('signOut wipes DAY, RT identity, and dynamic keys; keeps device-level camPrimed', async () => {
  seedUserA();
  await act.signOut();
  expect(RT.userId).toBeNull();
  expect(RT.profile).toBeNull();
  expect(RT.allergies).toEqual([]);
  expect(RT.assigned).toEqual([]);
  expect(RT.injured).toBe(false);
  expect((RT as any)._lastPlan).toBeUndefined();
  expect(RT.camPrimed).toBe(true);
  expect(DAY.meals).toEqual({ breakfast: false, lunch: false, snack: false, dinner: false });
  expect(DAY.slotMacros).toEqual({});
  expect(DAY.hydrationL).toBe(0);
  expect(DAY.ciSubmitted).toBe(false);
  expect(DAY.scoreHistory).toEqual([]);
});

test('signOut preserves a pending onboarding scratch only when it carries an email', async () => {
  seedUserA();
  RT.ob = { email: 'a@example.com', name: 'Alice Athlete', _synced: { legacy: false } };
  await act.signOut();
  expect(RT.ob).toEqual({ email: 'a@example.com', name: 'Alice Athlete', _synced: { legacy: false } });
  expect(RT.allergies).toEqual(['Peanuts']); // allergies ride with the pending scratch

  RT.ob = { name: 'No Email Legacy' }; // no email → provably unownable → wiped
  await act.signOut();
  expect(RT.ob).toBeNull();
});

test('loadDay resets to a fresh day before merging (no residue for a row-less user)', async () => {
  seedUserA();
  await loadDay('user-b'); // no window.sb → offline path; user-b has no cache entry
  expect(DAY.meals).toEqual({ breakfast: false, lunch: false, snack: false, dinner: false });
  expect(DAY.slotMacros).toEqual({});
  expect(DAY.hydrationL).toBe(0);
  expect(DAY.scoreHistory).toEqual([]);
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  expect(DAY.date).toBe(today);
});

test('loadDay still restores the SAME user\'s own same-day cache after the reset', async () => {
  act._wipeUserScopedState();
  DAY.meals.dinner = true;
  DAY.hydrationL = 2;
  // saveCache path: pushDay caches on every mutation; emulate by writing the cache directly
  dom.window.localStorage.setItem(`onstd-day-user-a-${DAY.date}`, JSON.stringify(DAY));
  DAY.meals.dinner = false; // in-memory diverges; cache should restore it
  DAY.hydrationL = 0;
  await loadDay('user-a');
  expect(DAY.meals.dinner).toBe(true);
  expect(DAY.hydrationL).toBe(2);
});

test('signIn by a DIFFERENT user wipes the previous user\'s state and foreign scratch', async () => {
  seedUserA();
  RT.ob = { email: 'a@example.com', name: 'Alice Athlete' };
  (dom.window as any).sb = sbStub('user-b');
  const r = await act.signIn('b@example.com', 'password123');
  expect(r.ok).toBe(true);
  expect(RT.userId).toBe('user-b');
  // A's identity must be gone:
  expect(RT.profile).toBeNull();
  expect(RT.assigned).toEqual([]);
  expect(DAY.meals).toEqual({ breakfast: false, lunch: false, snack: false, dinner: false });
  // A's scratch has A's email ≠ b@example.com → dropped, never backfilled or rendered:
  expect(RT.ob).toBeNull();
  expect(RT.allergies).toEqual([]);
});

test('signIn by the SAME user keeps their pending scratch (obMine)', async () => {
  act._wipeUserScopedState();
  RT.ob = { email: 'b@example.com', name: 'Bob' };
  RT.allergies = ['Dairy'];
  (dom.window as any).sb = sbStub('user-b');
  const r = await act.signIn('b@example.com', 'password123');
  expect(r.ok).toBe(true);
  expect(RT.ob).not.toBeNull();
  expect(RT.ob.name).toBe('Bob');
  expect(RT.allergies).toEqual(['Dairy']);
});

test('_syncSession (Keychain restore) with a different user id wipes first', () => {
  seedUserA();
  act._syncSession({ id: 'user-b', email: 'b@example.com' });
  expect(RT.userId).toBe('user-b');
  expect(RT.email).toBe('b@example.com');
  expect(RT.profile).toBeNull();
  expect(DAY.meals.breakfast).toBe(false);
});

test('_syncSession with UNKNOWN authRole fetches primary_role before the boot gate routes (role-integrity, 2026-07-15)', async () => {
  // Fresh localStorage + restored Keychain session (reinstall / storage eviction): without
  // this fetch, routeForRole(null) dumps a coach on the ATHLETE home.
  act._wipeUserScopedState();
  RT.authRole = null;
  const profChain: any = new Proxy(function () { /* callable */ }, {
    get(_t, prop) {
      if (prop === 'then') return (resolve: (v: unknown) => void) => resolve({ data: { primary_role: 'coach' }, error: null });
      return () => profChain;
    },
    apply() { return profChain; },
  });
  (dom.window as any).sb = { ...sbStub('coach-user'), from: () => profChain };
  await act._syncSession({ id: 'coach-user', email: 'coach@example.com' });
  expect(RT.authRole).toBe('coach');
});

test('_syncSession keeps a KNOWN authRole without refetching', async () => {
  act._wipeUserScopedState();
  RT.userId = 'user-a'; RT.authRole = 'trainer';
  // The role refetch is a `.select(...)`; the best-effort timezone capture (0088) is a
  // `.from('profiles').update(...)`. Flag ONLY a select so the legitimate tz write is allowed —
  // the invariant under test is "a known role is not re-read", not "no writes happen".
  let roleFetched = false;
  const spyChain = (): any => new Proxy(function () { /* callable */ }, {
    get(_t, prop) {
      if (prop === 'then') return (resolve: (v: unknown) => void) => resolve({ data: null, error: null });
      if (prop === 'select') return () => { roleFetched = true; return spyChain(); };
      return () => spyChain();
    },
    apply() { return spyChain(); },
  });
  (dom.window as any).sb = { ...sbStub('user-a'), from: () => spyChain() };
  await act._syncSession({ id: 'user-a', email: 'a@example.com' });
  expect(RT.authRole).toBe('trainer');
  expect(roleFetched).toBe(false);
});

test('deleteAccount wipes everything including the pending scratch', async () => {
  seedUserA();
  RT.ob = { email: 'a@example.com', name: 'Alice Athlete' };
  (dom.window as any).sb = sbStub('user-a');
  await act.deleteAccount();
  expect(RT.userId).toBeNull();
  expect(RT.ob).toBeNull();
  expect(RT.profile).toBeNull();
  expect(DAY.meals.breakfast).toBe(false);
});
