/* This week's focus, the tracker and the Sunday recap (goals and eating plan, A2, 2026-09-25).
 *
 * Pins: the candidates and the weakest-with-data pick, the 5-day gates, stability across the ISO
 * week, the tracker's day states, the recap's content and its Sunday / Monday-morning window, the
 * Intuitive and minor gates, and that the Home card is an athlete-only surface.
 * Run: node --test proto/redesign-2026-07/js/weekly-focus.test.mjs
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
const fakeStore = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) };
globalThis.window = {
  location: { hash: '' }, addEventListener() {},
  matchMedia: () => ({ matches: false, addEventListener() {}, addListener() {} }),
  __render: () => {}, localStorage: fakeStore,
};
globalThis.document = Object.assign(el(), { createElement: el, getElementById: () => null, documentElement: el(), body: el(), head: el() });
globalThis.localStorage = fakeStore;
globalThis.sessionStorage = { getItem: () => null, setItem() {}, removeItem() {} };
globalThis.location = globalThis.window.location;

const { RT } = await import('./state.js');
const { DAY } = await import('./day.js');
const WF = await import('./weekly-focus-model.js');
const { slotOrder, perMealShare } = await import('./plan-today-model.js');
const card = await import('./weekly-focus.js');

const order = slotOrder(null);
const ctx = { order, target: 180, deadline: () => 720 };
const SHARE = perMealShare(180, 3);   // 60

/** A history row. meals: { breakfast: 30 } = logged with 30g; null = logged, read not landed;
 *  absent = not logged. late: slots logged after the window. */
function row(date, meals, { late = [], ci = null, score = 80 } = {}) {
  const m = {}, sm = {}, at = {};
  for (const k of ['breakfast', 'lunch', 'dinner', 'snack']) {
    if (!(k in meals)) { m[k] = false; continue; }
    m[k] = true;
    sm[k] = meals[k] == null ? { pending: true } : { protein: meals[k] };
    at[k] = late.includes(k) ? 800 : 600;
  }
  return { date, meals: m, score, checkin: { slotMacros: sm, mealLoggedAt: at, ...(ci ? { ...ci, submitted: true } : { energy: 8, submitted: false }) } };
}
const facts = (rows) => rows.map((r) => WF.dayFacts(r, ctx));
const dates = (from, n) => Array.from({ length: n }, (_, i) => WF.addDays(from, i));

test('ISO weeks and the Monday..Sunday span', () => {
  assert.equal(WF.isoWeekKey('2026-09-21'), '2026-W39');   // a Monday
  assert.equal(WF.isoWeekKey('2026-09-27'), '2026-W39');   // its Sunday
  assert.equal(WF.isoWeekKey('2026-09-28'), '2026-W40');
  assert.equal(WF.isoWeekKey('2027-01-01'), '2026-W53');
  assert.deepEqual(WF.weekDates('2026-09-24'), dates('2026-09-21', 7));
  assert.equal(WF.weekdayIndex('2026-09-27'), 6);
});

test('a day as facts: a duplicate photo is not a meal, a pending read has no protein, an unsubmitted check-in is none', () => {
  const r = row('2026-09-20', { breakfast: 30, lunch: null, dinner: 70 });
  r.checkin.slotMacros.dinner.flagged = 'dup';
  const d = WF.dayFacts(r, ctx);
  assert.equal(d.logged.breakfast, true);
  assert.equal(d.logged.dinner, false);
  assert.equal(d.protein.lunch, null);
  assert.equal(d.dayProtein, 30);
  assert.equal(d.ci, null);
  assert.equal(WF.dayFacts({ date: 'x', meals: null }, ctx), null);
});

test('the candidates follow the slot model: a required snack adds one', () => {
  assert.deepEqual(WF.candidates(order), ['protein:breakfast', 'protein:lunch', 'protein:dinner', 'missed', 'late']);
  const six = slotOrder({ slots: ['breakfast', 'lunch', 'snack', 'dinner'] });
  assert.deepEqual(WF.candidates(six), ['protein:breakfast', 'protein:lunch', 'protein:dinner', 'missed', 'late', 'snack']);
});

test('the weakest candidate with 5+ days of its own data wins', () => {
  const days = facts(dates('2026-09-07', 7).map((d) => row(d, { breakfast: 22, lunch: 60, dinner: 65 })));
  assert.equal(WF.pickFocus(days, ctx), 'protein:breakfast');
  const s = WF.candidateStats('protein:breakfast', days, ctx);
  assert.deepEqual([s.n, s.rate, s.avg, s.share], [7, 0, 22, SHARE]);
  // Breakfast light on only 4 days: not enough of ITS data, so the next weakest is chosen.
  const few = facts(dates('2026-09-07', 7).map((d, i) => row(d, i < 4 ? { breakfast: 20, lunch: 30, dinner: 60 } : { lunch: 30, dinner: 60 })));
  assert.equal(WF.pickFocus(few, ctx), 'protein:lunch');
});

test('missed meals and logging late are candidates too', () => {
  const missed = facts(dates('2026-09-07', 6).map((d) => row(d, { breakfast: 60, dinner: 60 })));
  assert.equal(WF.pickFocus(missed, ctx), 'missed');
  const late = facts(dates('2026-09-07', 6).map((d) => row(d, { breakfast: 60, lunch: 60, dinner: 60 }, { late: ['breakfast', 'lunch', 'dinner'] })));
  assert.equal(WF.pickFocus(late, ctx), 'late');
});

test('under 5 logged days: no focus; stable for the ISO week once chosen', () => {
  const four = facts(dates('2026-09-14', 4).map((d) => row(d, { breakfast: 20 })));
  assert.deepEqual(WF.resolveFocus({ stored: null, days: four, ctx, todayISO: '2026-09-21' }), { key: null, stored: null });
  const light = facts(dates('2026-09-10', 8).map((d) => row(d, { breakfast: 20, lunch: 60, dinner: 60 })));
  const first = WF.resolveFocus({ stored: null, days: light, ctx, todayISO: '2026-09-21' });
  assert.equal(first.key, 'protein:breakfast');
  assert.equal(first.stored.week, '2026-W39');
  // Mid-week the data swings to dinner being the weak one: the week's focus holds.
  const swung = facts(dates('2026-09-12', 8).map((d) => row(d, { breakfast: 80, lunch: 60, dinner: 10 })));
  const later = WF.resolveFocus({ stored: { ...first.stored, tips: [true] }, days: swung, ctx, todayISO: '2026-09-25' });
  assert.equal(later.key, 'protein:breakfast');
  assert.deepEqual(later.stored.tips, [true]);
  // A new ISO week picks again, and the ticks start clean.
  const next = WF.resolveFocus({ stored: later.stored, days: swung, ctx, todayISO: '2026-09-28' });
  assert.equal(next.key, 'protein:dinner');
  assert.deepEqual(next.stored.tips, []);
  // The stored focus lost ALL its data: that is the one case a week picks again.
  const noBreakfast = facts(dates('2026-09-12', 8).map((d) => row(d, { lunch: 60, dinner: 10 })));
  assert.equal(WF.resolveFocus({ stored: first.stored, days: noBreakfast, ctx, todayISO: '2026-09-24' }).key, 'protein:dinner');
});

test('the tracker: hits, misses, today open until it is a hit, the future faint', () => {
  const rows = [row('2026-09-21', { breakfast: 60 }), row('2026-09-22', { breakfast: 20 }), row('2026-09-23', { lunch: 40 })];
  const byDate = Object.fromEntries(facts(rows).map((d) => [d.date, d]));
  const t = WF.tracker('protein:breakfast', byDate, { ...ctx, todayISO: '2026-09-24' });
  assert.deepEqual(t.map((d) => d.state), ['hit', 'miss', 'miss', 'open', 'future', 'future', 'future']);
  byDate['2026-09-24'] = WF.dayFacts(row('2026-09-24', { breakfast: 58 }), ctx);   // 58 >= 90% of 60
  assert.equal(WF.tracker('protein:breakfast', byDate, { ...ctx, todayISO: '2026-09-24' })[3].state, 'hit');
  assert.deepEqual(t.map((d) => d.label), ['M', 'T', 'W', 'T', 'F', 'S', 'S']);
});

test('the copy: a real number for a numbers style, plate words and no grams for Intuitive', () => {
  const days = facts(dates('2026-09-07', 7).map((d) => row(d, { breakfast: 22, lunch: 60, dinner: 65 })));
  const s = WF.candidateStats('protein:breakfast', days, ctx);
  const titleOf = (k) => k[0].toUpperCase() + k.slice(1);
  const n = WF.focusCopy(s, { numbers: true, titleOf });
  assert.equal(n.title, 'Protein at breakfast');
  assert.match(n.why, /^Breakfasts average 22g\. About 60g there/);
  const i = WF.focusCopy(s, { numbers: false, titleOf });
  assert.equal(i.title, 'A palm of protein at breakfast');
  assert.doesNotMatch(i.title + i.why, /\d/);
  for (const k of WF.candidates(slotOrder({ slots: ['breakfast', 'lunch', 'snack', 'dinner'] }))) {
    const tips = WF.focusTips(k);
    assert.equal(tips.length, 3, k);
    for (const tip of tips) { assert.doesNotMatch(tip, /\d/); assert.doesNotMatch(tip, /—/); }
  }
  assert.doesNotMatch(WF.askQuestion(s, { numbers: false, titleOf }), /\d/);
});

test('the recap: Sunday and Monday morning only, the right week, and no weight unless given', () => {
  assert.equal(WF.recapDue('2026-09-27', 600), true);    // Sunday
  assert.equal(WF.recapDue('2026-09-28', 719), true);    // Monday 11:59
  assert.equal(WF.recapDue('2026-09-28', 720), false);   // Monday noon
  assert.equal(WF.recapDue('2026-09-26', 600), false);   // Saturday
  assert.deepEqual(WF.recapWeek('2026-09-28'), dates('2026-09-21', 7));
  const rows = dates('2026-09-21', 6).map((d, i) => row(d, i % 2 ? { breakfast: 60, lunch: 60, dinner: 70 } : { breakfast: 40, dinner: 50 }, { score: 70 + i * 4 }));
  const byDate = Object.fromEntries(facts(rows).map((d) => [d.date, d]));
  const titleOf = (k) => k[0].toUpperCase() + k.slice(1);
  const mon = WF.recapLine(byDate, { ...ctx, todayISO: '2026-09-28', numbers: true, titleOf, weightPace: 'On pace' });
  assert.equal(mon, 'Last week: protein hit on 3 of 7 days · lunch missed most · weight on pace · average score 80.');
  const intuitive = WF.recapLine(byDate, { ...ctx, todayISO: '2026-09-28', numbers: false, titleOf, weightPace: null });
  assert.equal(intuitive, 'Last week: every meal in on 3 of 7 days · lunch missed most · average score 80.');
  assert.equal(WF.recapLine({}, { ...ctx, todayISO: '2026-09-28', numbers: true, titleOf }), '');
  // Sunday: today is still open, so the dinner it has not logged yet is not "missed most".
  const sun = { ...byDate, '2026-09-27': WF.dayFacts(row('2026-09-27', { breakfast: 60, lunch: 60 }), ctx) };
  const sunLine = WF.recapLine(sun, { ...ctx, todayISO: '2026-09-27', numbers: true, titleOf });
  assert.match(sunLine, /^This week: /);
  assert.match(sunLine, /lunch missed most/);
});

test('the Home card: athletes only, stable, and ticks persist for the week', () => {
  RT.userId = 'wf-athlete';
  RT.authRole = 'athlete';
  RT.stdMeals = null;
  RT.profile = { baseGoal: 'gain' };
  DAY.date = '2026-09-24';
  DAY.proteinTarget = 180;
  DAY.meals = { breakfast: false, lunch: false, dinner: false, snack: false };
  DAY.slotMacros = {}; DAY.mealLoggedAt = {};
  DAY.scoreHistory = dates('2026-09-12', 12).map((d) => row(d, { breakfast: 22, lunch: 60, dinner: 65 }));
  const html = card.focusHtml();
  assert.match(html, /This week's focus/);
  assert.match(html, /Protein at breakfast/);
  assert.doesNotMatch(html, /Ask Nia why this matters/, 'no recent meal on file yet: no chat to open, so no button');
  assert.doesNotMatch(html, /—/);
  const kept = JSON.parse(mem.get('os.weekFocus.wf-athlete'));
  assert.equal(kept.key, 'protein:breakfast');
  for (const role of ['coach', 'trainer', 'parent']) {
    RT.authRole = role;
    assert.equal(card.focusHtml(), '', role);
  }
  RT.authRole = 'athlete';
  DAY.scoreHistory = dates('2026-09-20', 3).map((d) => row(d, { breakfast: 22 }));
  mem.clear();
  assert.match(card.focusHtml(), /Log a few more days/);
  DAY.scoreHistory = [];
  assert.equal(card.focusHtml(), '');
});

/* ---------------- review fix round (2026-09-26) ---------------- */

test('fix: "Ask Nia why this matters" only ever prefills the nutrition chat, never Plan > Ask', async () => {
  const src = (await import('node:fs')).readFileSync(new URL('./weekly-focus.js', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /plan-ask|seedAsk/, 'no route to the auto-asking Plan > Ask');
  RT.userId = 'wf-ask'; RT.authRole = 'athlete'; RT.stdMeals = null;
  DAY.date = '2026-09-24'; DAY.proteinTarget = 180;
  DAY.meals = { breakfast: false, lunch: false, dinner: false, snack: false }; DAY.slotMacros = {}; DAY.mealLoggedAt = {};
  DAY.scoreHistory = dates('2026-09-12', 12).map((d) => row(d, { breakfast: 22, lunch: 60, dinner: 65 }));
  // No recent meals known yet: the chat has no plate to open on, so there is no button.
  assert.doesNotMatch(card.focusHtml(), /data-wf-ask/);
  const rm = await import('./recent-meals.js');
  await rm.warmRecent({ fetchRecentMeals: async () => [], daysAgoISO: () => '2026-09-10' }, 'wf-ask');
  assert.doesNotMatch(card.focusHtml(), /data-wf-ask/, 'an empty read hides it too');
  await rm.warmRecent({ fetchRecentMeals: async () => [{ id: 'm1' }], daysAgoISO: () => '2026-09-10' }, 'wf-ask2');
  RT.userId = 'wf-ask2';
  assert.match(card.focusHtml(), /data-wf-ask/);
  const went = [];
  globalThis.window.__go = (r) => went.push(r);
  await card.askNia('Why does protein at breakfast matter so much for my goal?');
  assert.deepEqual(went, ['nutrition-chat']);
});

test('fix: a past day whose meal read failed is unknown on the tracker, not missed', () => {
  const failed = row('2026-09-22', { breakfast: 60 });
  failed.checkin.slotMacros.breakfast = { analysisFailed: true };
  const byDate = Object.fromEntries(facts([row('2026-09-21', { breakfast: 60 }), failed, row('2026-09-23', { lunch: 40 })]).map((d) => [d.date, d]));
  const t = WF.tracker('protein:breakfast', byDate, { ...ctx, todayISO: '2026-09-24' });
  assert.deepEqual(t.slice(0, 3).map((d) => d.state), ['hit', 'unknown', 'miss']);
});

test('fix: the recap\'s day protein is the Plan ring\'s own sum (S.dayConsumed), so "hit" means "met"', async () => {
  const { S } = await import('./state.js');
  const r = row('2026-09-22', { breakfast: 60, lunch: 50, dinner: 40 });
  r.meals['meal-5'] = true; r.checkin.slotMacros['meal-5'] = { protein: 25 };   // a standard's extra slot
  r.checkin.slotMacros.dinner.flagged = 'dup';                                   // never counts
  r.checkin.slotMacros.lunch = { protein: 50, pending: true };                   // counted as the ring counts it
  DAY.meals = { ...r.meals }; DAY.slotMacros = JSON.parse(JSON.stringify(r.checkin.slotMacros));
  DAY.quickAdded = [true, false, false];
  assert.equal(WF.dayFacts(r, ctx).dayProtein, S.dayConsumed.protein);
  DAY.quickAdded = [false, false, false];
});
