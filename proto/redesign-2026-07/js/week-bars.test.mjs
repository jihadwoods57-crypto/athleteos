/* The shared seven-bar week (js/week-bars.js): Progress and the parent hub draw it from one
   builder, and the parent hub's calendar week must keep a day with no log as an EMPTY day
   rather than closing the week up around it. */
import { test } from 'node:test';
import assert from 'node:assert/strict';

/* week-bars.js imports components.js, which evaluates state.js: the same module-eval stubs the
   other screen tests use (client-experience.test.mjs). */
const el = () => ({
  style: { setProperty() {}, removeProperty() {} },
  classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
  setAttribute() {}, getAttribute: () => null, addEventListener() {},
  querySelectorAll: () => [], querySelector: () => null, appendChild() {}, remove() {}, insertAdjacentHTML() {},
});
const store = new Map();
globalThis.window = { location: { hash: '' }, addEventListener() {}, matchMedia: () => ({ matches: false, addEventListener() {}, addListener() {} }), __render() {} };
globalThis.document = Object.assign(el(), { createElement: el, getElementById: () => null, documentElement: el(), body: el(), head: el() });
globalThis.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, v), removeItem: (k) => store.delete(k) };
globalThis.sessionStorage = globalThis.localStorage;
globalThis.location = globalThis.window.location;
const { calendarWeek, daysBetween, weekBars, dayBars } = await import('./week-bars.js');

test('calendarWeek: seven calendar days ending today, oldest first, gaps kept as null', () => {
  const w = calendarWeek([{ day: '2026-07-22', score: 71 }, { day: '2026-07-17', score: 52 }], '2026-07-23');
  assert.equal(w.length, 7);
  assert.equal(w[0].key, '2026-07-17');
  assert.equal(w[6].key, '2026-07-23');
  assert.deepEqual(w.map((d) => d.score), [52, null, null, null, null, 71, null]);
  assert.equal(w[6].label, 'T'); // 2026-07-23 is a Thursday
});

test('calendarWeek crosses a month boundary', () => {
  const w = calendarWeek([], '2026-08-02');
  assert.deepEqual(w.map((d) => d.key), ['2026-07-27', '2026-07-28', '2026-07-29', '2026-07-30', '2026-07-31', '2026-08-01', '2026-08-02']);
});

test('daysBetween counts whole calendar days, null when a date is missing', () => {
  assert.equal(daysBetween('2026-07-23', '2026-07-23'), 0);
  assert.equal(daysBetween('2026-07-14', '2026-07-23'), 9);
  assert.equal(daysBetween('2026-02-28', '2026-03-01'), 1);
  assert.equal(daysBetween(null, '2026-07-23'), null);
});

test('weekBars: a gap day is an empty track, never a bar; the default keeps Progress markup', () => {
  const withGaps = weekBars({ scores: [84, null], labels: ['M', 'T'], gaps: true });
  assert.match(withGaps, /M 84, T no log/);
  assert.equal((withGaps.match(/class="bar"/g) || []).length, 1);
  assert.match(withGaps, /class="wb b-none"/);
  const plain = weekBars({ scores: [84, 52], labels: ['M', 'T'], cutIdx: 1, cutLabel: 'Scoring changed' });
  assert.equal((plain.match(/class="bar"/g) || []).length, 2);
  assert.match(plain, /class="wb-cutover"/);
  assert.match(plain, /The standard is 80\. Scoring changed\./);
});

test('dayBars: a number over every scored bar, a mark on a miss, Today labelled, all spoken', () => {
  const days = [
    { key: '2026-07-17', label: 'F', score: null, state: 'before' },
    { key: '2026-07-18', label: 'S', score: 92, state: 'scored' },
    { key: '2026-07-19', label: 'S', score: null, state: 'missed' },
    { key: '2026-07-20', label: 'M', score: 52, state: 'scored' },
    { key: '2026-07-21', label: 'T', score: 84, state: 'scored' },
    { key: '2026-07-22', label: 'W', score: 71, state: 'scored' },
    { key: '2026-07-23', label: 'T', score: 40, state: 'today' },
  ];
  const html = dayBars(days);
  assert.match(html, /aria-label="Last 7 days: Fri before you started, Sat 92, Sun no log, Mon 52, Tue 84, Wed 71, today 40 so far\. The standard is 80\."/);
  assert.equal((html.match(/class="bar"/g) || []).length, 5, 'no bar on a day before the start or a miss');
  assert.match(html, /class="wb wb-missed"[^>]*>\s*<span class="wb-n">/);
  assert.match(html, /<span class="wb-n tier-ink g">92<\/span>/);
  assert.match(html, /<span class="wb-n tier-ink b">84<\/span>/);
  assert.match(html, /<span class="wb-n tier-ink a">71<\/span>/);
  assert.match(html, /<span class="wb-n">52<\/span>/, 'below 60 stays neutral on the athlete own history');
  assert.match(html, /<span class="d">Today<\/span>/);
  assert.doesNotMatch(html, /wb-cutover/);
  assert.match(dayBars(days, { cutIdx: 2, cutLabel: 'Scoring changed' }), /The standard is 80\. Scoring changed\./);
  const open = dayBars([{ key: '2026-07-23', label: 'T', score: null, state: 'today' }]);
  assert.match(open, /today not scored yet/);
});
