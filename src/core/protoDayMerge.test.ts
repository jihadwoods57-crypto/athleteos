/**
 * RECONNECT-SAFE DAY MERGE: within one day the logged facts are monotonic (a meal, a
 * submitted check-in, sipped water don't un-happen), so loadDay must merge the server row
 * with OR/max semantics instead of overwriting — otherwise an older server row (meals all
 * false) erases the cache-restored offline logs. And when the LOCAL day carries anything the
 * server lacks, loadDay must push the reconciled day back up immediately (the healing push),
 * or the coach reads "not logged" for a day that was honestly logged.
 *
 * Same node+jsdom bootstrap as the other proto tests.
 */
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost' });
(globalThis as any).window = dom.window;
(globalThis as any).document = dom.window.document;
(globalThis as any).localStorage = dom.window.localStorage;

/* eslint-disable @typescript-eslint/no-var-requires */
const { DAY, loadDay, dayResetLocal } = require('../../proto/redesign-2026-07/js/day.js');

/** Supabase stub: serves `dayRow` for the today-select, [] for history, null for trust
 *  passes, and RECORDS every upsert (the healing push). */
function makeSb(dayRow: unknown) {
  const upserts: any[] = [];
  const from = (table: string) => {
    const state = { hist: false, upsert: false };
    const p: any = new Proxy(function () { /* callable */ }, {
      get(_t, prop: string) {
        if (prop === 'then') {
          return (resolve: (v: unknown) => void) => {
            const data = state.upsert ? null : table === 'days' ? (state.hist ? [] : dayRow) : null;
            resolve({ data, error: null });
          };
        }
        return (...args: unknown[]) => {
          if (prop === 'order') state.hist = true;
          if (prop === 'upsert') { state.upsert = true; upserts.push(args[0]); }
          return p;
        };
      },
      apply() { return p; },
    });
    return p;
  };
  return { sb: { from, rpc: async () => ({ data: null, error: null }) }, upserts };
}

const UID = 'merge-user';
function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
/** Seed this device's same-day cache (what an offline session leaves behind). */
function seedCache(patch: Record<string, unknown>) {
  dayResetLocal();
  DAY.date = todayISO();
  const cached = { ...JSON.parse(JSON.stringify(DAY)), ...patch, date: todayISO() };
  dom.window.localStorage.setItem(`onstd-day-${UID}-${todayISO()}`, JSON.stringify(cached));
}

beforeEach(() => {
  dom.window.localStorage.clear();
  dayResetLocal();
  delete (dom.window as any).sb;
});

test('offline logs SURVIVE an older server row, and the healing push fires', async () => {
  seedCache({ meals: { breakfast: true, lunch: true, snack: false, dinner: false }, hydrationL: 1.4 });
  const { sb, upserts } = makeSb({
    athlete_id: UID, date: todayISO(),
    meals: { breakfast: false, lunch: false, snack: false, dinner: false },
    hydration_l: 0, quick_added: [false, false, false], current_weight: null, checkin: {},
  });
  (dom.window as any).sb = sb;
  await loadDay(UID);
  expect(DAY.meals.breakfast).toBe(true);
  expect(DAY.meals.lunch).toBe(true);
  expect(DAY.hydrationL).toBeCloseTo(1.4);
  expect(upserts).toHaveLength(1);
  expect(upserts[0].meals.breakfast).toBe(true);
  expect(upserts[0].meals.lunch).toBe(true);
});

test('a server row that is AHEAD fills local without a needless push', async () => {
  seedCache({}); // clean local cache
  const { sb, upserts } = makeSb({
    athlete_id: UID, date: todayISO(),
    meals: { breakfast: true, lunch: false, snack: false, dinner: true },
    hydration_l: 2, quick_added: [false, false, false], current_weight: 180,
    checkin: { submitted: true, energy: 7, recovery: 6, sleep: 8, confidence: 9, soreness: 4, motivation: 8 },
  });
  (dom.window as any).sb = sb;
  await loadDay(UID);
  expect(DAY.meals.breakfast).toBe(true);
  expect(DAY.meals.dinner).toBe(true);
  expect(DAY.hydrationL).toBe(2);
  expect(DAY.currentWeight).toBe(180);
  expect(DAY.ciSubmitted).toBe(true);
  expect(DAY.ci.energy).toBe(7);
  expect(upserts).toHaveLength(0); // nothing local to heal — no write amplification
});

test('no server row + local progress → healing push creates the row', async () => {
  seedCache({ meals: { breakfast: true, lunch: false, snack: false, dinner: false } });
  const { sb, upserts } = makeSb(null);
  (dom.window as any).sb = sb;
  await loadDay(UID);
  expect(DAY.meals.breakfast).toBe(true);
  expect(upserts).toHaveLength(1);
  expect(upserts[0].meals.breakfast).toBe(true);
});

test('a locally SUBMITTED check-in outranks unsubmitted server answers', async () => {
  seedCache({ ciSubmitted: true, ci: { energy: 9, recovery: 9, sleep: 9, confidence: 9, soreness: 2, motivation: 9 } });
  const { sb, upserts } = makeSb({
    athlete_id: UID, date: todayISO(),
    meals: { breakfast: false, lunch: false, snack: false, dinner: false },
    hydration_l: 0, quick_added: [false, false, false], current_weight: null,
    checkin: { submitted: false, energy: 5 },
  });
  (dom.window as any).sb = sb;
  await loadDay(UID);
  expect(DAY.ciSubmitted).toBe(true);
  expect(DAY.ci.energy).toBe(9); // local submitted answers kept, not clobbered by 5
  expect(upserts).toHaveLength(1);
});

test('slotMacros merge per-slot: local slots win, server fills the rest', async () => {
  seedCache({
    meals: { breakfast: true, lunch: false, snack: false, dinner: false },
    slotMacros: { breakfast: { protein: 42, quality: 90 } },
  });
  const { sb } = makeSb({
    athlete_id: UID, date: todayISO(),
    meals: { breakfast: false, lunch: true, snack: false, dinner: false },
    hydration_l: 0, quick_added: [false, false, false], current_weight: null,
    checkin: { slotMacros: { breakfast: { protein: 10 }, lunch: { protein: 35 } } },
  });
  (dom.window as any).sb = sb;
  await loadDay(UID);
  expect(DAY.slotMacros.breakfast.protein).toBe(42); // local wins its own slot
  expect(DAY.slotMacros.lunch.protein).toBe(35);     // server fills the slot we lacked
  expect(DAY.meals.lunch).toBe(true);                // OR-merge both directions
});
