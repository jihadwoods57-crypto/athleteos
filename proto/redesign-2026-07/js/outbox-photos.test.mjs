/* Photo bytes live in IndexedDB, not localStorage (2026-09-26).
 *
 * The founder's breakfast photo was dropped on 2026-09-26 because the meal outbox kept 150-250KB of
 * base64 per capture in localStorage, and something else had filled it (storage-footprint.test.mjs).
 * Now the queue there is metadata only and the bytes sit in IndexedDB, keyed by job key. These run
 * the real outbox (meal-outbox.js + outbox-photos.js) and the real drain (state.js) against a fake
 * IndexedDB backend.
 * Run: node --test proto/redesign-2026-07/js/outbox-photos.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

const el = () => ({
  style: { setProperty() {}, removeProperty() {} },
  classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
  setAttribute() {}, getAttribute: () => null, addEventListener() {},
  querySelectorAll: () => [], querySelector: () => null, appendChild() {}, remove() {}, insertAdjacentHTML() {},
});
const mem = new Map();
let refuse = null;   // (key, value) => true to refuse a write, as a full WebKit store does
const fakeStore = {
  get length() { return mem.size; }, key: (i) => [...mem.keys()][i] ?? null,
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => { if (refuse && refuse(k, String(v))) { const e = new Error('QuotaExceededError'); e.name = 'QuotaExceededError'; throw e; } mem.set(k, String(v)); },
  removeItem: (k) => mem.delete(k), clear: () => mem.clear(),
};
const sess = new Map();
globalThis.window = {
  location: { hash: '' }, addEventListener() {}, dispatchEvent() {},
  matchMedia: () => ({ matches: false, addEventListener() {}, addListener() {} }),
  __render: () => {}, localStorage: fakeStore,
};
globalThis.document = Object.assign(el(), { createElement: el, getElementById: () => null, documentElement: el(), body: el(), head: el() });
globalThis.localStorage = fakeStore;
globalThis.sessionStorage = { getItem: (k) => (sess.has(k) ? sess.get(k) : null), setItem: (k, v) => sess.set(k, String(v)), removeItem: (k) => sess.delete(k) };
globalThis.location = globalThis.window.location;

/* Supabase stand-in: records every upload's bytes, every insert, every analyze-meal body. */
const calls = { inserts: [], uploads: [], bodies: [] };
const chain = (result) => new Proxy(function () {}, {
  get(_, p) { if (p === 'then') return (ok, bad) => Promise.resolve(result).then(ok, bad); return () => chain(result); },
  apply() { return chain(result); },
});
window.sb = {
  from: (table) => new Proxy({}, {
    get(_, p) {
      if (p === 'insert' && table === 'meals') return (row) => { calls.inserts.push(row); return chain({ data: { id: `m-${calls.inserts.length}` }, error: null }); };
      return () => chain({ data: null, error: null });
    },
  }),
  storage: { from: () => ({ upload: async (path, bytes) => { calls.uploads.push({ path, n: bytes.length }); return { error: null }; } }) },
  // 'capacity' is terminal for the read, so a job finishes in one pass and can be seen leaving.
  functions: { invoke: async (name, { body }) => { calls.bodies.push(body); return { data: null, error: { message: 'capacity' } }; } },
  rpc: () => chain({ data: null, error: null }),
};

/** A fake IndexedDB backend: the outbox-photos.js interface over a Map, oldest first. */
function fakeIdb() {
  const m = new Map();
  let t = 0;
  return {
    m,
    put: async (k, b64) => { m.delete(k); m.set(k, { b64, at: ++t }); },
    get: async (k) => (m.has(k) ? m.get(k).b64 : null),
    del: async (k) => { m.delete(k); },
    keys: async () => [...m.entries()].sort((a, b) => a[1].at - b[1].at).map(([k]) => k),
  };
}

const { RT, act } = await import('./state.js');
const { DAY } = await import('./day.js');
const OB = await import('./meal-outbox.js');
const OP = await import('./outbox-photos.js');
const QKEY = 'onstd-proto-outbox-v1';
const PHOTO = 'QUJD'.repeat(2000);   // 8K chars of base64 stands in for a capture
const settle = async (n = 20) => { for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0)); };
const quiet = async (fn) => { const w = console.warn; console.warn = () => {}; try { return await fn(); } finally { console.warn = w; } };
const stored = () => JSON.parse(mem.get(QKEY) || '[]');

let idb;
const reset = (backend = fakeIdb()) => {
  idb = backend;
  OP.setBackend(backend);
  OP._resetMigration();
  OB._resetOutboxMemory();
  refuse = null;
  mem.clear();
  RT.userId = 'u-op';
  mem.set('os.aiConsent.u-op', '1');
  for (const k of Object.keys(DAY.meals)) DAY.meals[k] = false;
  DAY.slotMacros = {}; DAY.mealLoggedAt = {}; DAY.plans = {};
  calls.inserts = []; calls.uploads = []; calls.bodies = [];
};
const job = (slot, over = {}) => ({
  k: OB.jobKey('u-op', DAY.date, slot), uid: 'u-op', date: DAY.date, slot,
  photoPath: `u-op/${DAY.date}/${slot}.jpg`, macros: { protein: 0, kcal: 0 }, meta: { name: 'Lunch', source: 'live', pending: true },
  needUpload: true, needInsert: true, needAnalysis: true, tries: 0, lastTryAt: 0, ...over,
});
const logged = (slot) => { DAY.meals[slot] = true; DAY.slotMacros[slot] = { pending: true, source: 'live' }; };

test('putJob: localStorage gets metadata only; the bytes go to IndexedDB under the job key', async () => {
  reset();
  const j = job('lunch', { base64: PHOTO });
  OB.putJob(j);
  const row = stored().find((e) => e.k === j.k);
  assert.equal(row.base64, null, 'no base64 in localStorage');
  assert.equal(row.bytes, 'idb');
  assert.ok(mem.get(QKEY).length < 1000, `the queue is tiny (${mem.get(QKEY).length} chars)`);
  await settle();
  assert.equal(idb.m.get(j.k).b64, PHOTO, 'the bytes landed in IndexedDB');
});

test('the drain reads the bytes back from IndexedDB for the upload AND the read, then cleans up', async () => {
  reset();
  logged('lunch');
  const j = job('lunch', { base64: PHOTO });
  OB.putJob(j);
  await settle();
  OB._resetOutboxMemory();                       // a fresh launch: nothing in memory, only IndexedDB
  await quiet(() => act._runMealJob(OB.getJob(j.k)));
  assert.equal(calls.uploads.length, 1);
  assert.equal(calls.uploads[0].n, atob(PHOTO).length, 'the upload carried the real bytes');
  assert.equal(calls.bodies[0].photoBase64, PHOTO, 'analyze-meal got the real bytes');
  assert.equal(calls.inserts.length, 1);
  assert.equal(OB.getJob(j.k), null, 'the finished job left the queue');
  await settle();
  assert.equal(idb.m.has(j.k), false, 'and its bytes left IndexedDB');
});

test('migration: a queue an older build left with base64 moves it to IndexedDB on the first drain', async () => {
  reset();
  const j = job('dinner', { base64: PHOTO, needUpload: false, needInsert: false, needAnalysis: false, pendingQuestions: ['x'] });
  mem.set(QKEY, JSON.stringify([j]));            // the old shape, exactly as it sits on a phone today
  await idb.put('u-op/2026-01-01/lunch', 'ORPHAN');
  await quiet(() => act.drainMealOutbox());
  const row = stored().find((e) => e.k === j.k);
  assert.equal(row.base64, null);
  assert.equal(row.bytes, 'idb');
  assert.equal(idb.m.get(j.k).b64, PHOTO);
  assert.equal(idb.m.has('u-op/2026-01-01/lunch'), false, 'bytes with no job are deleted');
  assert.equal(await OB.photoFor(row), PHOTO);
});

test('no IndexedDB: the bytes ride in the queue, as before (localStorage fallback)', async () => {
  reset(null);
  const j = job('lunch', { base64: PHOTO });
  OB.putJob(j);
  await settle();
  assert.equal(stored().find((e) => e.k === j.k).base64, PHOTO);
  assert.equal(await OB.photoFor(OB.getJob(j.k)), PHOTO);
});

test('bytes gone but the photo ALREADY uploaded: the meals row is still inserted with its photo_path', async () => {
  reset();
  logged('lunch');
  const j = job('lunch', { needUpload: false, bytes: 'idb' });   // uploaded earlier; IndexedDB lost the copy
  mem.set(QKEY, JSON.stringify([j]));
  await quiet(() => act._runMealJob(OB.getJob(j.k)));
  assert.equal(calls.inserts.length, 1, 'the coach gets the meal');
  assert.equal(calls.inserts[0].photo_path, `u-op/${DAY.date}/lunch.jpg`);
  assert.equal(calls.uploads.length, 0);
  assert.equal(calls.bodies.length, 0, 'no read without bytes');
  assert.equal(DAY.slotMacros.lunch.mealId, 'm-1');
  assert.equal(DAY.slotMacros.lunch.analysisFailed, 'error', '"Read it again" (from storage) is offered');
  assert.equal(OB.getJob(j.k), null);
});

test('bytes gone and NEVER uploaded: no insert (0251), the job dies, the slot says photo_lost', async () => {
  reset();
  logged('lunch');
  const j = job('lunch', { bytes: 'idb' });
  mem.set(QKEY, JSON.stringify([j]));
  await quiet(() => act._runMealJob(OB.getJob(j.k)));
  assert.equal(calls.inserts.length, 0);
  assert.equal(calls.uploads.length, 0);
  const row = OB.getJob(j.k);
  assert.equal(row.dead, 'lost');
  assert.equal(row.lostPhoto, true);
  assert.equal(DAY.slotMacros.lunch.analysisFailed, 'photo_lost');
});

test('the IndexedDB guard keeps 30 photos; the oldest job is told its bytes are gone', async () => {
  reset();
  assert.equal(OP.MAX_IDB_PHOTOS, 30);
  const keys = [];
  for (let i = 0; i < 31; i++) { const j = job(`s${i}`, { base64: `B${i}` }); keys.push(j.k); OB.putJob(j); await settle(2); }
  await settle();
  assert.equal(idb.m.size, 30);
  assert.equal(idb.m.has(keys[0]), false);
  assert.equal(stored().find((e) => e.k === keys[0]).bytes, null);
  assert.equal(stored().find((e) => e.k === keys[30]).bytes, 'idb');
});

test('a full localStorage never sheds a photo on the spot: the session keeps the job, eviction makes room', async () => {
  reset();
  logged('lunch');
  const today = DAY.date;
  for (let i = 1; i <= 5; i++) mem.set(`onstd-day-u-op-2026-0${i}-01`, 'x'.repeat(1000));   // stale day caches
  mem.set(`onstd-day-u-op-${today}`, '{}');
  mem.set('onstd-launch-u-op', 'L'.repeat(500));
  // Refuse the outbox write while any old day cache is still there.
  refuse = (k) => k === QKEY && [...mem.keys()].some((x) => /^onstd-day-.*-2026-0\d-01$/.test(x) && !x.endsWith(today));
  const j = job('lunch', { base64: PHOTO });
  OB.putJob(j);
  assert.equal(mem.get(QKEY), undefined, 'the first write was refused');
  assert.ok(OB.getJob(j.k), 'but this session still reads the job (in memory)');
  assert.equal(OB.getJob(j.k).dead, undefined, 'and nothing was declared lost');
  await settle(40);
  assert.ok(stored().find((e) => e.k === j.k), 'after eviction the queue is persisted');
  assert.equal([...mem.keys()].filter((k) => k.startsWith('onstd-day-')).join(), `onstd-day-u-op-${today}`, 'the old day caches went first');
  assert.equal(mem.get('onstd-launch-u-op'), 'L'.repeat(500), 'the launch cache was not needed');
  // …and the drain still has the bytes.
  await quiet(() => act._runMealJob(OB.getJob(j.k)));
  assert.equal(calls.uploads.length, 1);
  assert.equal(calls.inserts.length, 1);
});

test('IndexedDB that errors or never answers: the photo is "try later", never "lost" (review 2026-09-26)', async () => {
  const broken = { put: () => Promise.reject(new Error('x')), get: () => Promise.reject(new Error('idb timeout')), del: () => Promise.resolve(), keys: () => Promise.resolve([]) };
  reset(broken);
  const row = { k: 'u-op/2026-01-02/lunch', bytes: 'idb', base64: null };
  assert.equal(await OB.photoFor(row), undefined, 'a storage error is unknown, not missing');
  reset(fakeIdb());
  assert.equal(await OB.photoFor({ k: 'u-op/none/lunch', bytes: 'idb', base64: null }), null, 'a real miss is null');
});

test('the IndexedDB backend races every call against a deadline', () => {
  assert.equal(typeof OP.IDB_TIMEOUT_MS, 'number');
  assert.ok(OP.IDB_TIMEOUT_MS > 0 && OP.IDB_TIMEOUT_MS <= 5000);
});
