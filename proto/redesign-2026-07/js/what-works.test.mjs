/* What works for you (goals and eating plan, A2, 2026-09-25).
 *
 * Pins the thresholds (10 days with a meal AND a submitted check-in, 3+ days a side, a 1.5 point
 * gap), CHECK-IN POLARITY (soreness is stored raw, high = very sore: a behaviour that lines up with
 * MORE soreness is never offered as working, one that lines up with less is), the "better direction
 * only" rule, at most two with no behaviour or field twice, the Intuitive wording, and that the
 * Progress section is athlete-only.
 * Run: node --test proto/redesign-2026-07/js/what-works.test.mjs
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
const { DAY, CI_INVERSE } = await import('./day.js');
const WW = await import('./what-works-model.js');
const WF = await import('./weekly-focus-model.js');
const { slotOrder } = await import('./plan-today-model.js');
const section = await import('./what-works.js');

const order = slotOrder(null);
const ctx = { order, target: 180, deadline: () => 720 };
const titleOf = (k) => k[0].toUpperCase() + k.slice(1);

/** n days; `hit(i)` decides whether breakfast landed 60g (else 20g); `ci(i, hit)` the check-in. */
function days(n, hit, ci, { submitted = true } = {}) {
  return Array.from({ length: n }, (_, i) => {
    const h = hit(i);
    const r = {
      date: WF.addDays('2026-09-01', i),
      meals: { breakfast: true, lunch: true, dinner: true, snack: false },
      score: 80,
      checkin: {
        slotMacros: { breakfast: { protein: h ? 60 : 20 }, lunch: { protein: 60 }, dinner: { protein: 60 } },
        mealLoggedAt: { breakfast: 600, lunch: 600, dinner: 600 },
        submitted, ...ci(i, h),
      },
    };
    return WF.dayFacts(r, ctx);
  });
}
const alt = (i) => i % 2 === 0;

test('the polarity table is day.js CI_INVERSE, never a sixth copy that can drift', () => {
  for (const [k, f] of Object.entries(WW.FIELDS)) assert.equal(f.inverse, !!CI_INVERSE[k], k);
});

test('ten days, three a side, a 1.5 gap: the pattern is found and said honestly', () => {
  const d = days(10, alt, (i, h) => ({ energy: h ? 8 : 5 }));
  const { patterns } = WW.findPatterns(d, { ...ctx, fields: ['energy'] });
  const top = WW.topInsights(patterns);
  assert.equal(top.length, 1);
  assert.equal(top[0].behaviour, 'protein:breakfast');
  assert.equal(WW.insightText(top[0], { numbers: true, share: 60, titleOf }),
    'On days your breakfast hit about 60g of protein, your energy averaged 8 out of 10. On days it didn\'t, 5.');
  const i = WW.insightText(top[0], { numbers: false, share: 60, titleOf });
  assert.equal(i, 'On days you had a palm of protein at breakfast, your energy averaged 8 out of 10. On days you didn\'t, 5.');
  assert.doesNotMatch(i, /\d+\s*g\b/);
});

test('below the thresholds there is nothing', () => {
  assert.equal(WW.findPatterns(days(9, alt, (i, h) => ({ energy: h ? 9 : 3 })), { ...ctx, fields: ['energy'] }).patterns.length, 0);
  // Only two days on one side.
  assert.equal(WW.findPatterns(days(12, (i) => i < 2, (i, h) => ({ energy: h ? 9 : 3 })), { ...ctx, fields: ['energy'] }).patterns.length, 0);
  // A 1.4 gap.
  assert.equal(WW.findPatterns(days(10, alt, (i, h) => ({ energy: h ? 7.4 : 6 })), { ...ctx, fields: ['energy'] }).patterns.length, 0);
  // An unsubmitted check-in still stores numbers; none of them count.
  assert.equal(WW.findPatterns(days(12, alt, (i, h) => ({ energy: h ? 9 : 3 }), { submitted: false }), { ...ctx, fields: ['energy'] }).eligible, 0);
});

test('CHECK-IN POLARITY: less soreness on hit days is what works; more soreness never is', () => {
  const less = days(10, alt, (i, h) => ({ soreness: h ? 3 : 7 }));
  const top = WW.topInsights(WW.findPatterns(less, { ...ctx, fields: ['soreness'] }).patterns);
  assert.equal(top.length, 1);
  assert.equal(top[0].field, 'soreness');
  // The sentence prints what the athlete answered (lower is less sore), never a flipped number.
  assert.match(WW.insightText(top[0], { numbers: true, share: 60, titleOf }), /your soreness averaged 3 out of 10\. On days it didn't, 7\./);
  const more = days(10, alt, (i, h) => ({ soreness: h ? 8 : 3 }));
  assert.equal(WW.findPatterns(more, { ...ctx, fields: ['soreness'] }).patterns.length, 0);
});

test('better direction only: lower energy on hit days is not "what works"', () => {
  assert.equal(WW.findPatterns(days(10, alt, (i, h) => ({ energy: h ? 4 : 8 })), { ...ctx, fields: ['energy'] }).patterns.length, 0);
});

test('at most two, never the same behaviour or field twice, strongest first', () => {
  const d = days(12, alt, (i, h) => ({ energy: h ? 9 : 4, sleep: h ? 8 : 5, confidence: h ? 8 : 6 }));
  const top = WW.topInsights(WW.findPatterns(d, { ...ctx, fields: ['energy', 'sleep', 'confidence'] }).patterns);
  assert.equal(top.length, 1);   // one behaviour varies here, so one line, on its strongest field
  assert.equal(top[0].field, 'energy');
  // Two behaviours: breakfast protein and on-time logging, each with its own field.
  const two = Array.from({ length: 12 }, (_, i) => {
    const h = i % 2 === 0, late = i % 3 === 0;
    return WF.dayFacts({
      date: WF.addDays('2026-09-01', i), meals: { breakfast: true, lunch: true, dinner: true, snack: false },
      checkin: { submitted: true, energy: h ? 9 : 4, sleep: late ? 3 : 8,
        slotMacros: { breakfast: { protein: h ? 60 : 20 }, lunch: { protein: 60 }, dinner: { protein: 60 } },
        mealLoggedAt: { breakfast: late ? 900 : 600, lunch: 600, dinner: 600 } },
    }, ctx);
  });
  const t2 = WW.topInsights(WW.findPatterns(two, { ...ctx, fields: ['energy', 'sleep'] }).patterns);
  assert.equal(t2.length, 2);
  assert.notEqual(t2[0].behaviour, t2[1].behaviour);
  assert.notEqual(t2[0].field, t2[1].field);
  assert.ok(t2.some((p) => p.behaviour === 'ontime' && p.field === 'sleep'));
});

test('strong enough for the recap: a 2 point gap with 4+ days a side', () => {
  const strong = WW.findPatterns(days(10, alt, (i, h) => ({ energy: h ? 8 : 5 })), { ...ctx, fields: ['energy'] }).patterns[0];
  assert.equal(WW.isStrong(strong), true);
  const mild = WW.findPatterns(days(10, alt, (i, h) => ({ energy: h ? 7 : 5.3 })), { ...ctx, fields: ['energy'] }).patterns[0];
  assert.equal(WW.isStrong(mild), false);
});

test('Progress: athletes only, and only fields the athlete is actually asked', () => {
  RT.userId = 'ww-athlete';
  RT.authRole = 'athlete';
  RT.stdMeals = null;
  DAY.date = '2026-09-30';
  DAY.proteinTarget = 180;
  DAY.ciConfig = { energy: true, recovery: true, sleep: true, confidence: true, soreness: true, motivation: false };
  const rows = Array.from({ length: 12 }, (_, i) => {
    const h = i % 2 === 0;
    return { date: WF.addDays('2026-09-10', i), score: 80, meals: { breakfast: true, lunch: true, dinner: true, snack: false },
      checkin: { submitted: true, energy: h ? 8 : 4, motivation: h ? 10 : 2,
        slotMacros: { breakfast: { protein: h ? 60 : 20 }, lunch: { protein: 60 }, dinner: { protein: 60 } }, mealLoggedAt: {} } };
  });
  DAY.scoreHistory = rows;
  const html = section.worksHtml();
  assert.match(html, /What works for you/);
  assert.match(html, /your energy averaged 8 out of 10/);
  assert.doesNotMatch(html, /motivation/);   // not asked, so its stored value is never compared
  for (const role of ['parent', 'coach', 'trainer']) {
    RT.authRole = role;
    assert.equal(section.worksHtml(), '', role);
  }
  RT.authRole = 'athlete';
  DAY.scoreHistory = rows.slice(0, 5);
  assert.match(section.worksHtml(), /for 10 days/);
  DAY.scoreHistory = [];
  assert.equal(section.worksHtml(), '');
});
