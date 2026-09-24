/**
 * Home's fetches write the cold-launch cache (launch-cache.js) and in-memory receipts AFTER an
 * await. A sign-out, or a switch from athlete A to athlete B, can land inside that await. Each
 * fetch fixes whose read it is when it starts and drops the answer if that user is gone, and the
 * cache refuses writes for anyone but its owner. These run the REAL home.js fetch paths against a
 * Supabase stub whose answers are released by hand, so the switch happens exactly mid-flight.
 */
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/#home' });
const g = globalThis as any;
g.window = dom.window;
g.document = dom.window.document;
g.localStorage = dom.window.localStorage;
g.location = dom.window.location;
g.requestAnimationFrame = (f: () => void) => setTimeout(f, 0);

/* eslint-disable @typescript-eslint/no-var-requires */
const { RT, act } = require('../../proto/redesign-2026-07/js/state.js');
const { DAY } = require('../../proto/redesign-2026-07/js/day.js');
const LC = require('../../proto/redesign-2026-07/js/launch-cache.js');
const PS = require('../../proto/redesign-2026-07/js/photo-store.js');
const { homeFetchesForTest: H } = require('../../proto/redesign-2026-07/js/screens/home.js');

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const today = iso(new Date());
const yesterday = iso(new Date(Date.now() - 864e5));
const photoA = `A/${yesterday}/lunch.jpg`;

/** Every answer waits on `release()`. Rows are user A's, by table. */
let gate: Promise<void> = Promise.resolve();
let release: () => void = () => {};
function arm() { gate = new Promise((r) => { release = r; }); }
const ROWS: Record<string, unknown[]> = {
  meals: [{ id: 'm1', athlete_id: 'A', day_date: yesterday, type: 'lunch', photo_path: photoA, quality: 80 }],
  coach_views: [{ viewer_name: 'Coach A', seen_at: new Date().toISOString() }],
  meal_comments: [{ id: 'c1', meal_id: 'm1', author_id: 'coach', role: 'coach', kind: 'message', text: 'secret for A', created_at: new Date().toISOString() }],
  meal_views: [],
};
function chain(rows: unknown[]): any {
  const p: any = new Proxy(function () { /* callable */ }, {
    get(_t, prop) {
      if (prop === 'then') return (res: (v: unknown) => void) => gate.then(() => res({ data: rows, error: null }));
      return () => p;
    },
    apply() { return p; },
  });
  return p;
}
const sb = {
  from: (t: string) => chain(ROWS[t] || []),
  rpc: async () => ({ data: null, error: null }),
  auth: { signOut: async () => ({}) },
  functions: { invoke: async () => ({ data: null, error: null }) },
  storage: {
    from: () => ({
      createSignedUrls: (ps: string[]) => gate.then(() => ({ data: ps.map((p) => ({ path: p, signedUrl: 'https://x.supabase.co/storage/v1/' + p })), error: null })),
    }),
  },
};

const flush = async () => { for (let i = 0; i < 16; i++) await new Promise((r) => setTimeout(r, 30)); };
function homeRoot() {
  document.body.innerHTML = '<div id="device"><div id="seen-row"></div><div id="reply-row"></div></div>';
  return document.getElementById('device');
}
function signIn(uid: string) {
  RT.userId = uid; RT.authRole = 'athlete';
  LC.launchOwner(uid);
}
function startAll(uid: string) {
  const root = homeRoot();
  void H.warmPastResults(uid);
  H.paintSeen(root, true, false);
  H.paintCoachReply(root, true, false);
}
const launchKeys = () => Object.keys(dom.window.localStorage).filter((k) => k.startsWith('onstd-launch-'));

beforeEach(() => {
  dom.window.localStorage.clear();
  (dom.window as any).sb = sb;
  (dom.window as any).__render = () => {};
  act._wipeUserScopedState();
  DAY.date = today;
  arm();
});

test('control: with nobody leaving, the answers land and are kept for the next launch', async () => {
  signIn('A');
  startAll('A');
  release();
  await flush();
  const c = LC.launchCache('A');
  expect(c.seen.rows).toHaveLength(1);
  expect(c.past.rows).toHaveLength(1);
  expect(H.state().SEEN.uid).toBe('A');
  expect(PS.cachedMealPhoto(photoA)).toContain(photoA);
  expect(launchKeys()).toEqual(['onstd-launch-A']);
});

test('sign-out while every fetch is in flight: nothing of A is written back', async () => {
  signIn('A');
  startAll('A');
  act._wipeUserScopedState();          // sign-out lands mid-flight
  release();
  await flush();
  expect(launchKeys()).toEqual([]);
  const st = H.state();
  expect(st.SEEN.uid === 'A' && st.SEEN.rows).toBeFalsy();
  expect(st.PAST.uid === 'A' && st.PAST.rows).toBeFalsy();
  expect(st.REPLY.inputs).toBeFalsy();
  expect(PS.cachedMealPhoto(photoA)).toBeNull();
});

test('A -> B mid-flight: B never sees A rows, receipts or photos, and A is not resurrected', async () => {
  signIn('A');
  startAll('A');
  act._wipeUserScopedState();          // A signs out...
  signIn('B');                         // ...B signs in before A's answers land
  release();
  await flush();
  const b = LC.launchCache('B');
  expect(b.seen).toBeUndefined();
  expect(b.past).toBeUndefined();
  expect(b.reply).toBeUndefined();
  expect(b.photos).toBeUndefined();
  const st = H.state();
  expect(st.SEEN.rows).toBeFalsy();
  expect(st.REPLY.inputs).toBeFalsy();
  expect(JSON.stringify(st.PAST.rows || [])).not.toContain('A/');
  expect(PS.cachedMealPhoto(photoA)).toBeNull();
  expect(launchKeys()).toEqual([]);
  expect(document.getElementById('seen-row')!.textContent).not.toContain('Coach A');
  expect(document.getElementById('reply-row')!.textContent).not.toContain('replied');
});

test('the launch cache refuses writes for anyone but its owner; a pending write never crosses users', async () => {
  signIn('A');
  expect(LC.keepLaunch('seen', { x: 1 }, 'A')).toBe(true);
  signIn('B');
  expect(LC.keepLaunch('seen', { x: 2 }, 'A')).toBe(false);   // A is not the owner any more
  expect(LC.keepLaunch('seen', { x: 3 }, 'B')).toBe(true);
  await flush();
  // A's write was still coalescing when B took over: it is not flushed for a user no longer on screen.
  expect(launchKeys()).toEqual(['onstd-launch-B']);
  expect(JSON.parse(dom.window.localStorage.getItem('onstd-launch-B')!).seen).toEqual({ x: 3 });
});
