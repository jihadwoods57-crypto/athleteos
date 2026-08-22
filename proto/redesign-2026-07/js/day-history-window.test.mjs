/* loadDay's trailing history is fetched SPLIT: the near window rides the heavy jsonb
   (meals/checkin/quick_added/signals), the far tail travels light (date,score,plan_style),
   and pass eligibility comes from the meals table (lifetime, the same rows grant_pass counts)
   instead of a proxy bounded by the history window. This is the regression net for all of it.
   It runs the REAL loadDay against a recording stub client — one that hands back ONLY the
   columns the client asked for, generated from the query's own date range so the suite cannot
   flake across a midnight boundary — and proves:
     1. the heavy jsonb is requested ONLY for the near HISTORY_HEAVY_DAYS window,
     2. the two ranges merge into ONE date-ascending scoreHistory spanning HISTORY_DAYS,
     3. a far row reconstructs to null (its consumers skip it) while a near row reconstructs
        whole — trends and medians read real recent data, never a truncated fabrication,
     4. weight from the weight_series RPC still stitches onto FAR rows,
     5. DAY.photoDays counts DISTINCT lifetime photo days — including days older than the
        heavy window, the exact case a history-bounded proxy would understate — and a failed
        meals read keeps the last known value instead of fabricating 0, and
     6. a failed history read aborts the merge-and-heal path: no wholesale upsert of a local
        day over a server row this device never read. */
import test from 'node:test';
import assert from 'node:assert/strict';

const store = new Map();
globalThis.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, v), removeItem: (k) => store.delete(k) };
globalThis.sessionStorage = globalThis.localStorage;
globalThis.window = {};

const { loadDay, dayFromHistoryRow, DAY, HISTORY_DAYS, HISTORY_HEAVY_DAYS, addDaysISO } = await import('./day.js');

/* A complete server day row for any past date. The stub strips each row down to the SELECTed
   column list, so what reaches loadDay is exactly what the wire would carry. */
function serverRow(date) {
  return {
    date, score: 84, plan_style: 'structured', hydration_l: 2, quick_added: [false, false, false],
    meals: { breakfast: true, lunch: true, snack: false, dinner: true },
    checkin: {
      submitted: true, energy: 8, recovery: 7, sleep: 8, confidence: 9,
      slotMacros: { dinner: { protein: 45, kcal: 700, source: 'live' } }, mealLoggedAt: { dinner: 1130 },
    },
    signals: {},
  };
}

const CALLS = [];        // every awaited days RANGE query: { cols, gte, lt }
let MEAL_CALLS = 0;      // meals-table eligibility reads
let FAIL_HISTORY = false;
let FAIL_MEALS = false;
let UPSERTS = 0;
/* Photo-day fixture for the meals table: 40 distinct days, every one OLDER than the heavy
   window (so a history-bounded proxy would see none of them), plus a duplicate second meal on
   the oldest day to prove the count is distinct-days, not rows. Dates derive from DAY.date at
   query time — no import-time clock to go stale. */
function photoRows(today) {
  const rows = [];
  for (let n = 0; n < 40; n++) rows.push({ day_date: addDaysISO(today, -(HISTORY_HEAVY_DAYS + 1 + n)) });
  rows.push({ day_date: rows[rows.length - 1].day_date }); // second plate, same day
  return rows;
}

function daysBuilder() {
  const q = { cols: null, gte: null, lt: null };
  const b = {
    select(c) { q.cols = String(c); return b; },
    eq() { return b; }, not() { return b; }, order() { return b; }, limit() { return b; },
    gte(col, v) { if (col === 'date') q.gte = v; return b; },
    lt(col, v) { if (col === 'date') q.lt = v; return b; },
    maybeSingle() { return Promise.resolve({ data: null, error: null }); },  // no row for today yet
    upsert() { UPSERTS++; return Promise.resolve({ data: null, error: null }); },
    then(res, rej) {
      CALLS.push(q);
      if (FAIL_HISTORY) return Promise.resolve({ data: null, error: { message: 'transient 5xx' } }).then(res, rej);
      const cols = String(q.cols || '').split(',');
      const rows = [];
      // Generate straight from the requested range: whatever date loadDay's clock landed on,
      // the fixture agrees with it.
      for (let d = q.gte; d != null && q.lt != null && d < q.lt; d = addDaysISO(d, 1)) {
        const r = serverRow(d);
        rows.push(Object.fromEntries(cols.filter((c) => c in r).map((c) => [c, r[c]])));
      }
      return Promise.resolve({ data: rows, error: null }).then(res, rej);
    },
  };
  return b;
}
function mealsBuilder() {
  const b = {
    select() { return b; }, eq() { return b; }, gte() { return b; }, lt() { return b; },
    in() { return b; }, is() { return b; }, not() { return b; }, order() { return b; }, limit() { return b; },
    maybeSingle() { return Promise.resolve({ data: null, error: null }); },
    then(res, rej) {
      MEAL_CALLS++;
      if (FAIL_MEALS) return Promise.resolve({ data: null, error: { message: 'transient 5xx' } }).then(res, rej);
      return Promise.resolve({ data: photoRows(DAY.date), error: null }).then(res, rej);
    },
  };
  return b;
}
const emptyBuilder = () => {
  const b = {
    select() { return b; }, eq() { return b; }, gte() { return b; }, lt() { return b; },
    in() { return b; }, is() { return b; }, not() { return b; }, order() { return b; }, limit() { return b; },
    maybeSingle() { return Promise.resolve({ data: null, error: null }); },
    then(res, rej) { return Promise.resolve({ data: [], error: null }).then(res, rej); },
  };
  return b;
};
globalThis.window.sb = {
  from: (name) => (name === 'days' ? daysBuilder() : name === 'meals' ? mealsBuilder() : emptyBuilder()),
  async rpc(fn) {
    // One weight deep in the FAR tail — it must still reach that row's scoreHistory entry.
    if (fn === 'weight_series') return { data: [{ date: addDaysISO(DAY.date, -50), weight: 172 }], error: null };
    return { data: [], error: null };
  },
};

let DATE1 = null; // DAY.date as of the first load, for the cross-midnight guard in the last test

test('history splits into a heavy near window and a light far tail, merged in order', async () => {
  await loadDay('u1');
  DATE1 = DAY.date;
  const TODAY = DAY.date;
  const HEAVY_SINCE = addDaysISO(TODAY, -HISTORY_HEAVY_DAYS);
  const SINCE = addDaysISO(TODAY, -HISTORY_DAYS);

  assert.equal(CALLS.length, 2, 'exactly two range queries: near (heavy) + far (light)');
  const heavy = CALLS.find((c) => c.cols.includes('meals'));
  const light = CALLS.find((c) => !c.cols.includes('meals'));
  assert.ok(heavy && light, 'one heavy and one light query');

  assert.equal(heavy.gte, HEAVY_SINCE, 'heavy jsonb reaches back HISTORY_HEAVY_DAYS, no further');
  assert.equal(heavy.lt, TODAY);
  assert.ok(heavy.cols.includes('checkin') && heavy.cols.includes('signals') && heavy.cols.includes('quick_added'));

  assert.equal(light.cols, 'date,score,plan_style', 'the far tail asks for nothing heavy');
  assert.equal(light.gte, SINCE, 'the far tail still reaches the full HISTORY_DAYS back');
  assert.equal(light.lt, HEAVY_SINCE, 'the two ranges meet without overlap');

  const h = DAY.scoreHistory;
  assert.equal(h.length, HISTORY_DAYS, 'the merged history spans the full window');
  assert.equal(h[0].date, SINCE, 'oldest first');
  assert.equal(h[h.length - 1].date, addDaysISO(TODAY, -1), 'yesterday last');
  for (let i = 1; i < h.length; i++) assert.ok(h[i - 1].date < h[i].date, 'strictly date-ascending across the seam');

  const far = h.find((r) => r.date === addDaysISO(TODAY, -40));
  const near = h.find((r) => r.date === addDaysISO(TODAY, -3));
  assert.equal(far.meals, null, 'a far row carries no meals jsonb');
  assert.equal(far.checkin, null, 'a far row carries no checkin jsonb');
  assert.equal(far.planStyle, 'structured', 'but keeps its style stamp for the timeline');
  assert.equal(far.score, 84, 'and its real score for the streak walk');
  assert.equal(dayFromHistoryRow(far), null, 'far rows reconstruct to null — consumers skip them by design');
  const rebuilt = dayFromHistoryRow(near);
  assert.ok(rebuilt && rebuilt.meals.dinner === true, 'near rows still reconstruct whole for trends/medians');

  const weighted = h.find((r) => r.date === addDaysISO(TODAY, -50));
  assert.equal(weighted.weight, 172, 'weight_series still stitches onto far rows');
  assert.equal(UPSERTS, 0, 'nothing local to heal, so nothing was pushed');
});

test('pass eligibility is the lifetime distinct-day count, not a history-window proxy', async () => {
  assert.equal(MEAL_CALLS, 1, 'the day load read the meals table once');
  // 41 photo rows on 40 distinct days, every one older than the heavy window: the proxy would
  // say 0 and an earned athlete would watch their progress run backwards on update.
  assert.equal(DAY.photoDays, 40, 'distinct lifetime days, including days the history no longer holds');
});

test('a failed meals read keeps the last known count instead of fabricating 0', async () => {
  FAIL_MEALS = true;
  await loadDay('u1');
  FAIL_MEALS = false;
  if (DAY.date === DATE1) {
    // dayResetLocal nulls photoDays, the cache restore brings back the last known 40, and the
    // failed fetch must leave that standing.
    assert.equal(DAY.photoDays, 40, 'cache-restored count survives a failed meals read');
  }
});

test('a failed history read aborts the merge-and-heal path', async () => {
  FAIL_HISTORY = true;
  await loadDay('u1');
  FAIL_HISTORY = false;
  // The instant offline paint (cache from the loads above) stands; nothing is written. The
  // content assertion is guarded against the marginal case of the suite straddling midnight
  // (the cache key is date-scoped); the no-upsert wall holds unconditionally.
  if (DAY.date === DATE1) {
    assert.equal(DAY.scoreHistory.length, HISTORY_DAYS, 'cache-restored history survives the failed fetch');
  }
  assert.equal(UPSERTS, 0, 'a failed read never becomes a wholesale upsert over the server row');
});
