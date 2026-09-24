/* The Progress screen after the 2026-09-23 cleanup: what it says, and what it no longer says. */
import { test } from 'node:test';
import assert from 'node:assert/strict';

// The roll call is switched off (commitments.js, 2026-09-24). This file tests the roll call itself,
// so it runs it switched ON, as it will be when it comes back; rollcall-off.test.mjs pins the off state.
import { rollcallOnForTests } from './commitments.js';
rollcallOnForTests();


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

const { RT } = await import('./state.js');
const { DAY } = await import('./day.js');
const progress = (await import('./screens/progress.js')).default;

const back = (n) => { const [y, m, d] = DAY.date.split('-').map(Number); const t = new Date(y, m - 1, d - n); return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`; };
const athlete = (hist, extra = {}) => {
  RT.userId = 'u1'; RT.day0 = true;
  RT.myCoach = { teamId: 't1', teamName: 'Lincoln', name: 'Coach J' }; RT.myTrainer = null;
  RT.profile = { name: 'X' }; RT.activationDate = extra.start || back(40);
  DAY.scoreHistory = hist.map(([b, s]) => ({ date: back(b), score: s, weight: null }));
  DAY.currentWeight = extra.weight ?? null;
  return progress.render();
};

test('a missed day is shown as missed, and the headline is a sentence over finished days', () => {
  const html = athlete([[6, 90], [5, 88], [3, 92], [2, 85], [1, 91], [9, 70], [10, 70]]);
  assert.match(html, /On standard 5 of 6 days/);
  assert.match(html, /Averaging 89, up 19 on the week before\. One day with no log\./);
  assert.match(html, /class="wb wb-missed"/);
  assert.match(html, /no log/, 'the chart says the miss out loud too');
  assert.match(html, />Today</);
});

test('no jargon, no apology, no "+0", no Premium pill on a free report, no share of today', () => {
  const html = athlete([[8, 88], [1, 88]]);
  assert.match(html, /same as the week before/);
  assert.doesNotMatch(html, /\+0|vs prior week|Compare within a band|not available for those days|≥80/);
  assert.doesNotMatch(html, /Premium/);
  assert.doesNotMatch(html, /Share today|pg-share/);
});

test('day one: the week starts today, a meal is the one primary action, no row of zeros', () => {
  const html = athlete([], { start: DAY.date });
  assert.match(html, /Your first week starts today/);
  assert.match(html, /btn primary sm pg-wbtn" data-go="camera"/);
  assert.doesNotMatch(html, /pf-stats/);
  assert.match(html, /No weigh-ins yet/);
  assert.doesNotMatch(html, /btn primary sm pg-wbtn" data-go="weight"/, 'weight is secondary to the first meal');
});

test('the records list: nobody to send a roll call means no roll call row; Squad is team only', () => {
  const team = athlete([[1, 90]]);
  assert.match(team, /Roll call record/);
  assert.match(team, /Teammates who share their score/);
  RT.myCoach = null; RT.myTrainer = null;
  const solo = progress.render();
  assert.doesNotMatch(solo, /Roll call record|>Squad</);
  assert.match(solo, /Monthly report/);
});

test('a best streak longer than the fetched history reads "N+", never a reset', () => {
  const html = athlete(Array.from({ length: 60 }, (_, i) => [i + 1, 90]), { start: back(200) });
  assert.match(html, /<b>60\+<\/b><small>best streak<\/small>/);
  // Today is still open, so the last 30 days hold 29 finished ones, all known.
  assert.match(html, /<b>29 of 29<\/b><small>days on standard<\/small>/);
});
