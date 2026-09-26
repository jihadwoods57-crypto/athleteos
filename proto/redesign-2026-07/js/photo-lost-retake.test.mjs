/* A lost photo has a way out: retake it (2026-09-26).
 *
 * The founder's breakfast thread said "The photo couldn't be kept on this device, so there's
 * nothing left to read" over a foot that still promised "Syncs when connected". Nothing was ever
 * going to sync: the job was dead and no meals row existed. Now the thread offers a retake (or
 * "Choose the photo again" for a gallery log), the new photo REPLACES the lost log for that slot,
 * the originally logged minute is kept, and the foot says the meal was not sent.
 * Run: node --test proto/redesign-2026-07/js/photo-lost-retake.test.mjs
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
const fakeStore = {
  get length() { return mem.size; }, key: (i) => [...mem.keys()][i] ?? null,
  getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k),
};
globalThis.window = {
  location: { hash: '' }, addEventListener() {}, dispatchEvent() {},
  matchMedia: () => ({ matches: false, addEventListener() {}, addListener() {} }), __render: () => {}, localStorage: fakeStore,
};
globalThis.document = Object.assign(el(), { createElement: el, getElementById: () => null, documentElement: el(), body: el(), head: el() });
globalThis.localStorage = fakeStore;
globalThis.sessionStorage = fakeStore;
globalThis.location = globalThis.window.location;

const { RT, act, MEAL, mealDetail, lostPhotoSlot } = await import('./state.js');
const { DAY, slotDeadline } = await import('./day.js');
const OB = await import('./meal-outbox.js');
const OP = await import('./outbox-photos.js');
const { openingBlockHtml, thread } = await import('./screens/meal.js');

// This file is about the log, not the network: a drain would re-arm its own timer forever here.
act.drainMealOutbox = async () => {};

const bytes = new Map();
OP.setBackend({ put: async (k, b) => { bytes.set(k, b); }, get: async (k) => bytes.get(k) || null, del: async (k) => { bytes.delete(k); }, keys: async () => [...bytes.keys()] });

const AT = 8 * 60 + 53;   // logged 8:53 AM, the founder's breakfast
function stuckBreakfast(source = 'gallery') {
  RT.userId = 'u-rt';
  for (const k of Object.keys(DAY.meals)) DAY.meals[k] = false;
  DAY.slotMacros = {}; DAY.mealLoggedAt = {}; DAY.plans = {};
  act.clearMeal();
  mem.clear(); OB._resetOutboxMemory();
  DAY.meals.breakfast = true;
  DAY.mealLoggedAt.breakfast = AT;
  DAY.slotMacros.breakfast = { name: 'Breakfast', source, live: source !== 'gallery', pending: true, analysisFailed: 'photo_lost' };
  // The tombstone the old writeQueue left on the phone.
  mem.set('onstd-proto-outbox-v1', JSON.stringify([{ k: OB.jobKey('u-rt', DAY.date, 'breakfast'), uid: 'u-rt', date: DAY.date, slot: 'breakfast',
    base64: null, lostPhoto: true, needUpload: false, needInsert: true, needAnalysis: false, dead: 'quota', tries: 0, lastTryAt: 0 }]));
}

test('the stuck state shows a retake, not a dead end (and no "Read it again")', () => {
  stuckBreakfast('gallery');
  const html = openingBlockHtml(mealDetail('breakfast'));
  assert.match(html, /id="mt-retake-lost"/);
  assert.match(html, /Choose the photo again/, 'a gallery log is re-chosen, not re-shot');
  assert.doesNotMatch(html, /mt-retry-analysis/);
  assert.doesNotMatch(html, /couldn't be kept on this device/);
  assert.match(html, /Your logged time stays/);
  stuckBreakfast('live');
  assert.match(openingBlockHtml(mealDetail('breakfast')), /Retake the photo/);
});

test('the foot never promises a sync that cannot happen', () => {
  stuckBreakfast();
  const html = thread.render({ sub: 'breakfast' });
  assert.doesNotMatch(html, /Syncs when connected/);
  assert.match(html, /Not sent/);
  // An ordinary unsynced meal still says it will sync.
  DAY.slotMacros.breakfast = { name: 'Breakfast', source: 'live', pending: true };
  assert.match(thread.render({ sub: 'breakfast' }), /Syncs when connected/);
});

test('a capture for the lost slot stays on that slot (it is logged, but it is not done)', () => {
  stuckBreakfast();
  assert.equal(lostPhotoSlot('breakfast'), true);
  act.captureMeal('TkVX', 'data:image/jpeg;base64,TkVX', 'breakfast', false, { takenAt: null });
  assert.equal(MEAL.key, 'breakfast');
});

test('logging the retake replaces the lost log, keeps the original minute, and queues a real job', async () => {
  stuckBreakfast();
  act.captureMeal('TkVX', 'data:image/jpeg;base64,TkVX', 'breakfast', false, { takenAt: null });
  const w = console.warn; console.warn = () => {};
  try { act.logMeal('breakfast'); } finally { console.warn = w; }
  const m = DAY.slotMacros.breakfast;
  assert.equal(DAY.meals.breakfast, true);
  assert.equal(m.analysisFailed, undefined, 'the lost state is gone');
  assert.equal(m.pending, true, 'the new photo is being read');
  assert.equal(DAY.mealLoggedAt.breakfast, AT, 'the originally logged minute is kept');
  const q = OB.readQueue().filter((e) => e.slot === 'breakfast');
  assert.equal(q.length, 1, 'the tombstone was replaced, not joined');
  assert.equal(q[0].dead, undefined);
  assert.equal(q[0].needUpload, true);
  assert.equal(q[0].needInsert, true, 'no row existed, so one is inserted');
  assert.equal(q[0].meta.minutesLate, Math.max(0, AT - slotDeadline('breakfast')), 'lateness is measured from the original minute, not now');
  assert.equal(await OB.photoFor(q[0]), 'TkVX', 'the new bytes are there for the drain');
  await new Promise((r) => setTimeout(r, 20));
});

test('a logged slot that is NOT lost still refuses a second log', () => {
  stuckBreakfast();
  DAY.slotMacros.breakfast = { name: 'Breakfast', source: 'live', quality: 80, protein: 30, kcal: 500 };
  assert.equal(lostPhotoSlot('breakfast'), false);
  MEAL.key = 'breakfast'; MEAL.photoBase64 = 'QQ=='; MEAL.photoDataUrl = 'data:,'; MEAL.source = 'live';
  act.logMeal('breakfast');
  assert.equal(DAY.slotMacros.breakfast.quality, 80, 'the settled plate was not touched');
  assert.equal(OB.readQueue().filter((e) => e.slot === 'breakfast' && !e.dead).length, 0);
});

test('a row that went in before the bytes were lost keeps its id: no second insert', () => {
  stuckBreakfast();
  DAY.slotMacros.breakfast.mealId = 'm-old';
  act.captureMeal('TkVX', 'data:image/jpeg;base64,TkVX', 'breakfast', true);
  const w = console.warn; console.warn = () => {};
  try { act.logMeal('breakfast'); } finally { console.warn = w; }
  const q = OB.readQueue().find((e) => e.slot === 'breakfast');
  assert.equal(q.needInsert, false);
  assert.equal(q.mealId, 'm-old');
  assert.equal(DAY.slotMacros.breakfast.mealId, 'm-old');
});
