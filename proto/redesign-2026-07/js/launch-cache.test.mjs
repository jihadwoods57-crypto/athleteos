/* The cold-launch cache (launch-cache.js + photo-store.js): Home's last-known picture, per user.
   What must hold, because it is shown before the server has said anything:
     1. it is keyed by user id and never read back for anyone else,
     2. sign-out (dropLaunch) removes every copy and leaves other storage alone,
     3. a kept photo URL ages like one signed this session (gone after 45 min; the thumbnail stays),
     4. the photo store keeps at most 16 entries, and invalidating a path forgets it. */
import test from 'node:test';
import assert from 'node:assert/strict';

const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
  key: (i) => [...store.keys()][i] ?? null,
  get length() { return store.size; },
};
globalThis.window = {};

const LC = await import('./launch-cache.js');
const PS = await import('./photo-store.js');
const flush = () => new Promise((r) => setTimeout(r, 350));   // keepLaunch coalesces writes (300 ms)

test('kept per user: another id reads nothing, and the stored record names its owner', async () => {
  store.clear(); LC.dropLaunch();
  LC.launchOwner('user-a');
  LC.keepLaunch('seen', { date: '2026-07-23', rows: [{ seen_at: 'x' }] }, 'user-a');
  await flush();
  assert.ok(store.has('onstd-launch-user-a'));
  assert.equal(JSON.parse(store.get('onstd-launch-user-a')).uid, 'user-a');
  assert.deepEqual(LC.launchCache('user-b'), { uid: 'user-b' });
  assert.equal(LC.launchCache('user-a').seen.date, '2026-07-23');
  assert.deepEqual(LC.launchCache(null), {});
});

test('a record filed under the wrong key is never trusted', () => {
  store.clear(); LC.dropLaunch();
  store.set('onstd-launch-user-a', JSON.stringify({ uid: 'user-b', past: { rows: [1] } }));
  assert.equal(LC.launchCache('user-a').past, undefined);
});

test('sign-out drops every launch cache and nothing else', async () => {
  store.clear(); LC.dropLaunch();
  LC.launchOwner('user-a');
  LC.keepLaunch('reply', [{ mealId: 'm1' }], 'user-a');
  await flush();
  store.set('onstd-launch-user-b', JSON.stringify({ uid: 'user-b' }));
  store.set('onstd-proto-rt-v1', '{}');
  LC.dropLaunch();
  assert.deepEqual([...store.keys()], ['onstd-proto-rt-v1']);
  assert.deepEqual(LC.launchCache('user-a'), { uid: 'user-a' });   // the in-memory copy is gone too
});

test('a pending write cannot resurrect a dropped cache', async () => {
  store.clear(); LC.dropLaunch();
  LC.launchOwner('user-a');
  LC.keepLaunch('past', { date: 'd', rows: [] }, 'user-a');
  LC.dropLaunch();
  await flush();
  assert.equal(store.has('onstd-launch-user-a'), false);
});

test('a kept photo URL is served until it is 45 minutes old; its thumbnail outlives it', () => {
  store.clear(); LC.dropLaunch();
  const now = Date.now();
  store.set('onstd-launch-user-a', JSON.stringify({ uid: 'user-a', photos: {
    'user-a/d/lunch.jpg': { u: 'https://x.supabase.co/storage/v1/lunch', at: now - 10 * 60e3, th: 'data:image/jpeg;base64,AAAA' },
    'user-a/d/dinner.jpg': { u: 'https://x.supabase.co/storage/v1/dinner', at: now - 50 * 60e3, th: 'data:image/jpeg;base64,BBBB' },
  } }));
  LC.launchOwner('user-a');
  assert.equal(PS.cachedMealPhoto('user-a/d/lunch.jpg'), 'https://x.supabase.co/storage/v1/lunch');
  assert.equal(PS.cachedMealPhoto('user-a/d/dinner.jpg'), null, 'past the signed-URL margin');
  assert.equal(PS.cachedMealThumb('user-a/d/dinner.jpg'), 'data:image/jpeg;base64,BBBB');
  LC.launchOwner('user-b');
  assert.equal(PS.cachedMealThumb('user-a/d/lunch.jpg'), null, 'another user never sees it');
});

test('the photo store keeps the newest 16 and forgets an invalidated path', async () => {
  store.clear(); LC.dropLaunch();
  LC.launchOwner('user-a');
  const photos = {};
  for (let i = 0; i < 20; i++) photos[`p${i}`] = { u: `u${i}`, at: 1000 + i, th: 'data:image/jpeg;base64,AA' };
  store.set('onstd-launch-user-a', JSON.stringify({ uid: 'user-a', photos }));
  PS.invalidateMealPhoto('p19');
  await flush();
  const kept = JSON.parse(store.get('onstd-launch-user-a')).photos;
  assert.equal(Object.keys(kept).length, 16);
  assert.equal(kept.p19, undefined);
  assert.ok(kept.p18 && !kept.p2, 'oldest pruned first');
});

test('only the owner can write: a late answer for a user who left is refused', async () => {
  store.clear(); LC.dropLaunch();
  assert.equal(LC.keepLaunch('seen', { x: 1 }, 'user-a'), false, 'nobody signed in');
  LC.launchOwner('user-b');
  assert.equal(LC.keepLaunch('seen', { x: 1 }, 'user-a'), false, 'another user is on screen');
  assert.equal(LC.keepLaunch('seen', { x: 2 }, 'user-b'), true);
  await flush();
  assert.deepEqual([...store.keys()], ['onstd-launch-user-b']);
});

test('dropping runs the registered hooks (photo-store forgets its signed URLs)', () => {
  store.clear(); LC.dropLaunch();
  LC.launchOwner('user-a');
  store.set('onstd-launch-user-a', JSON.stringify({ uid: 'user-a', photos: { p: { u: 'https://x.supabase.co/storage/v1/p', at: Date.now() } } }));
  assert.ok(PS.cachedMealPhoto('p'));
  LC.dropLaunch();
  LC.launchOwner('user-a');
  assert.equal(PS.cachedMealPhoto('p'), null);
});
