/* NO PHOTO, NO MEAL, ON THE SERVER (0251, founder decision 2026-09-26).
 *
 * The server now refuses a meals row with no photo: SQLSTATE 23514, message exactly
 * 'photo_required'. The current client never sends one (act.logMeal refuses first; see
 * no-photo-log.test.mjs), but an old staged meal, an outbox entry an older build left in
 * localStorage, or a future bug could. When it does, the refusal is TERMINAL:
 *   - insertMeal says so with a sentinel and does not re-send the legacy shape (refused the same);
 *   - the meal outbox drops the job instead of retrying it with backoff forever;
 *   - the slot keeps a note of why (`syncRefused`), and nothing claims it is still being read.
 * Run: node --test proto/redesign-2026-07/js/server-photo-rule.test.mjs
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
const fakeStore = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k), clear: () => mem.clear() };
const sess = new Map();
globalThis.window = {
  location: { hash: '' }, addEventListener() {},
  matchMedia: () => ({ matches: false, addEventListener() {}, addListener() {} }),
  __render: () => {}, localStorage: fakeStore,
};
globalThis.document = Object.assign(el(), { createElement: el, getElementById: () => null, documentElement: el(), body: el(), head: el() });
globalThis.localStorage = fakeStore;
globalThis.sessionStorage = { getItem: (k) => (sess.has(k) ? sess.get(k) : null), setItem: (k, v) => sess.set(k, String(v)), removeItem: (k) => sess.delete(k) };
globalThis.location = globalThis.window.location;

/* A Supabase stand-in: every chain resolves { data: null, error: null } except a meals insert,
   which answers whatever the test says the server answers. */
const REFUSED = { data: null, error: { code: '23514', message: 'photo_required', details: 'x', hint: 'x' } };
const calls = { inserts: [], uploads: 0, invokes: 0 };
let answer = () => REFUSED;
const chain = (result) => new Proxy(function () {}, {
  get(_, p) {
    if (p === 'then') return (ok, bad) => Promise.resolve(result).then(ok, bad);
    return () => chain(result);
  },
  apply() { return chain(result); },
});
window.sb = {
  from: (table) => new Proxy({}, {
    get(_, p) {
      if (p === 'insert' && table === 'meals') return (row) => { calls.inserts.push(row); return chain(answer(row, calls.inserts.length)); };
      return () => chain({ data: null, error: null });
    },
  }),
  storage: { from: () => ({ upload: async () => { calls.uploads++; return { error: null }; } }) },
  functions: { invoke: async () => { calls.invokes++; return { data: null, error: null }; } },
  rpc: () => chain({ data: null, error: null }),
};

const { RT, act, MEAL } = await import('./state.js');
const { DAY, insertMeal, isPhotoRequired, PHOTO_REQUIRED } = await import('./day.js');
const { putJob, readQueue, jobKey } = await import('./meal-outbox.js');

const reset = () => {
  RT.userId = 'u-spr';
  for (const k of Object.keys(DAY.meals)) DAY.meals[k] = false;
  DAY.slotMacros = {}; DAY.mealLoggedAt = {}; DAY.plans = {};
  act.clearMeal();
  mem.delete('onstd-proto-outbox-v1');
  calls.inserts = []; calls.uploads = 0; calls.invokes = 0;
  answer = () => REFUSED;
};
const quiet = async (fn) => { const w = console.warn; console.warn = () => {}; try { return await fn(); } finally { console.warn = w; } };

test('the refusal is recognised by its message, not by its code (other checks share 23514)', () => {
  assert.equal(PHOTO_REQUIRED, 'photo_required');
  assert.equal(isPhotoRequired(REFUSED.error), true);
  assert.equal(isPhotoRequired({ code: '23514', message: 'new row for relation "meals" violates check constraint "meals_source_chk"' }), false);
  assert.equal(isPhotoRequired({ code: '23505', message: 'duplicate key value' }), false);
  assert.equal(isPhotoRequired(null), false);
  assert.equal(isPhotoRequired({}), false);
});

test('insertMeal: a photo_required refusal is terminal and the legacy shape is NOT re-sent', async () => {
  reset();
  const res = await quiet(() => insertMeal('u-spr', 'dinner', { protein: 40, kcal: 600 }, { name: 'Dinner', source: 'manual' }, null));
  assert.deepEqual(res, { photoRequired: true });
  assert.equal(calls.inserts.length, 1, 'one attempt, no fallback retry');
  assert.equal(calls.inserts[0].photo_path, null);
});

test('insertMeal: the other answers are unchanged (dup wall, legacy fallback, success)', async () => {
  reset();
  answer = () => ({ data: null, error: { code: '23505', message: 'duplicate key' } });
  assert.deepEqual(await insertMeal('u-spr', 'lunch', {}, {}, 'u-spr/2026-09-26/lunch.jpg'), { dup: true });

  reset();
  answer = (row, n) => (n === 1 ? { data: null, error: { code: 'PGRST204', message: 'column not found' } } : { data: { id: 'm-legacy' }, error: null });
  assert.equal(await insertMeal('u-spr', 'lunch', {}, {}, 'u-spr/2026-09-26/lunch.jpg'), 'm-legacy');
  assert.equal(calls.inserts.length, 2, 'a pre-0062 database still gets the legacy shape');
  assert.equal(calls.inserts[1].photo_path, 'u-spr/2026-09-26/lunch.jpg', 'the legacy shape still carries the photo');

  reset();
  answer = (row, n) => (n === 1 ? { data: null, error: { code: 'PGRST204', message: 'column not found' } } : REFUSED);
  assert.deepEqual(await quiet(() => insertMeal('u-spr', 'lunch', {}, {}, null)), { photoRequired: true }, 'a refusal of the legacy shape is terminal too');

  reset();
  answer = () => ({ data: { id: 'm-1' }, error: null });
  assert.equal(await insertMeal('u-spr', 'lunch', {}, {}, 'u-spr/2026-09-26/lunch.jpg'), 'm-1');
});

test('the outbox DROPS a refused insert instead of retrying it forever, and notes why on the slot', async () => {
  reset();
  // An entry an older build could have left behind: an insert owed, no photo behind it.
  const k = jobKey('u-spr', DAY.date, 'dinner');
  DAY.meals.dinner = true;
  DAY.slotMacros.dinner = { protein: 40, kcal: 600, name: 'Typed dinner', source: 'manual', pending: true };
  putJob({ k, uid: 'u-spr', date: DAY.date, slot: 'dinner', base64: null, photoPath: null,
    macros: { protein: 40, kcal: 600 }, meta: { name: 'Typed dinner', source: 'manual' },
    needUpload: false, needInsert: true, needAnalysis: true, tries: 0, lastTryAt: 0 });
  await quiet(() => act._runMealJob(readQueue().find((e) => e.k === k)));
  assert.equal(readQueue().find((e) => e.k === k), undefined, 'the job left the queue');
  assert.equal(calls.inserts.length, 1, 'the insert was tried once');
  assert.equal(calls.invokes, 0, 'no read was spent on a meal the server refused');
  assert.equal(DAY.slotMacros.dinner.syncRefused, 'photo_required', 'the slot says why');
  assert.equal(DAY.slotMacros.dinner.pending, false, 'nothing claims the plate is still being read');
  assert.equal(DAY.slotMacros.dinner.mealId, undefined, 'no row id was invented');
});

test('logMeal\'s direct insert (a read that landed before the log) marks the slot and stops', async () => {
  reset();
  MEAL.key = 'lunch'; MEAL.mealType = 'Lunch'; MEAL.photoBase64 = 'AAAA'; MEAL.photoHash = 'a'.repeat(64);
  MEAL.source = 'live';
  MEAL.result = { protein: 40, kcal: 600, carbs: 50, fat: 10, quality: 80, detected: ['Chicken'], note: '', name: 'Bowl' };
  await quiet(async () => {
    act.logMeal('lunch');
    for (let i = 0; i < 5 && !(DAY.slotMacros.lunch && DAY.slotMacros.lunch.syncRefused); i++) await new Promise((r) => setTimeout(r, 0));
  });
  assert.equal(DAY.meals.lunch, true, 'the athlete\'s day is left as they logged it');
  assert.equal(calls.inserts.length, 1);
  assert.equal(calls.inserts[0].photo_path, `u-spr/${DAY.date}/lunch.jpg`, 'the current client sends the photo path at insert');
  assert.equal(DAY.slotMacros.lunch.syncRefused, 'photo_required');
  assert.equal(DAY.slotMacros.lunch.mealId, undefined);
});
