/* Review pass 2026-09-23, stream C: athlete-side truths, pinned. */
import assert from 'node:assert';
import test from 'node:test';
import { readFileSync } from 'node:fs';

/* A frozen clock: Thursday 2026-07-23, 7:30 AM local (a weigh-in is Mon / Wed / Fri). */
let FIXED = new Date(2026, 6, 23, 7, 30, 0).getTime();
const RealDate = Date;
class FrozenDate extends RealDate {
  constructor(...a) { if (a.length) super(...a); else super(FIXED); }
  static now() { return FIXED; }
}
globalThis.Date = FrozenDate;

const el = () => ({
  style: { setProperty() {}, removeProperty() {} },
  classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
  setAttribute() {}, getAttribute: () => null, addEventListener() {},
  querySelectorAll: () => [], querySelector: () => null, appendChild() {}, remove() {}, insertAdjacentHTML() {},
});
const store = new Map();
globalThis.window = { location: { hash: '' }, addEventListener() {}, dispatchEvent() {}, matchMedia: () => ({ matches: false, addEventListener() {}, addListener() {} }), __render() {} };
globalThis.document = Object.assign(el(), { createElement: el, getElementById: () => null, documentElement: el(), body: el(), head: el() });
globalThis.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, v), removeItem: (k) => store.delete(k) };
globalThis.sessionStorage = globalThis.localStorage;
globalThis.location = globalThis.window.location;

const { S, RT } = await import('./state.js');
const src = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');

test('A-B3: Morning Weight is not "missed" on a day it is not scheduled', () => {
  RT.weightLogged = false; RT.weightLoggedAt = null;
  FIXED = new Date(2026, 6, 23, 11, 0, 0).getTime(); // Thursday, past 9 AM
  assert.strictEqual(S.weightLine.state, 'off');
  FIXED = new Date(2026, 6, 22, 11, 0, 0).getTime(); // Wednesday, past 9 AM
  assert.strictEqual(S.weightLine.state, 'missed');
  FIXED = new Date(2026, 6, 22, 8, 0, 0).getTime();
  assert.strictEqual(S.weightLine.state, 'open');
});

test('A-B3: a weight logged before the due time is not "logged late tonight"', () => {
  RT.weightLogged = true; RT.weightLoggedAt = 7 * 60;
  assert.strictEqual(S.weightLine.state, 'logged');
  assert.doesNotMatch(S.weightLine.note, /late/i);
  RT.weightLoggedAt = 20 * 60;
  assert.strictEqual(S.weightLine.state, 'late');
  assert.doesNotMatch(S.weightLine.note, /tonight/);
  RT.weightLoggedAt = null; // logged on another device: unknown time is not "late"
  assert.strictEqual(S.weightLine.state, 'logged');
  RT.weightLogged = false;
  const bd = src('screens/breakdown.js');
  assert.match(bd, /S\.weightLine\.state === 'off' \? '' :/, 'the row is absent on an off day');
});

test('A-B2: on the activation day a closed window is never the NOW card or "Later today"', () => {
  const home = src('screens/home.js');
  assert.match(home, /const pastWindow = \(i\) => !!i && i\.required && i\.state === 'overdue';/);
  assert.match(home, /\.filter\(\(i\) => i\.state !== 'not_required' && !pastWindow\(i\)\);\n\s*const first = ahead\[0\] \|\| null;/);
  assert.match(home, /Not counted on your first day/);
});

test('A-M4 / A-M5 / Rep 1: the breakdown and score-explained say the same true things', () => {
  const bd = src('screens/breakdown.js');
  assert.doesNotMatch(bd, /Every point that was on the table is in/);
  assert.match(bd, /Every requirement is in\./);
  assert.doesNotMatch(src('screens/recovery.js'), /your answers set the exact number/);
  const model = src('breakdown-model.js');
  assert.doesNotMatch(model, /Recovery quality \$\{/);
  assert.doesNotMatch(model, /'How you answered'/);
  assert.doesNotMatch(model, /A rough night is a few points/);
  const sx = src('screens/score-explained.js');
  assert.match(sx, /<div class="lt">Nutrition<\/div>/);
  assert.doesNotMatch(sx, /<div class="lt">Food<\/div>/);
  assert.match(sx, /Recovery: every question answered/);
});

test('A-M8: the empty trends line branches on the real number of scored days', () => {
  const p = src('screens/progress.js');
  assert.match(p, /function trendsEmptyLine\(\)/);
  assert.match(p, /if \(scored >= 3\) return 'Your daily scores are in/);
});

test('A-Polish 1/3/5/7: dev route gone, error has a way out, the hours add up, no unverified socials', () => {
  assert.doesNotMatch(src('screens/index.js'), /states: lazy/);
  assert.match(src('screens/trust.js'), /data-go="history">\$\{icon\('clipboard', 17\)\} Activity history/);
  const ob = src('screens/ob2-athlete.js');
  assert.doesNotMatch(ob, /The other twenty \(|~20 unseen|140 hrs|140 hours/);
  assert.match(ob, /countStat\('154 hrs'/);
  assert.doesNotMatch(src('screens/profile.js'), /instagram\.com\/onstandard|x\.com\/onstandard/);
  assert.match(src('../css/wide.css'), /html\[data-layout\] \.ob \{ max-width: 720px;/);
});

test('A-concern keepRecordCard: the record is free, so the card sells nothing', () => {
  const home = src('screens/home.js');
  const card = home.slice(home.indexOf('function keepRecordCard()'), home.indexOf('let dayRollFailed'));
  assert.doesNotMatch(card, /Individual|plan|\$\d/i);
  assert.match(home, /act\.markKeepRecordSeen\(\);\n\s*if \(window\.__go\) window\.__go\('history'\)/);
});

test.after(() => { globalThis.Date = RealDate; });
