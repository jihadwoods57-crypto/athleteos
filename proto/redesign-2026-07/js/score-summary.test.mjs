/* The two-column status row under "You're OnStandard." on the day-complete hero.
 *
 * It replaced a single centered flex row of `·`-joined spans that wrapped mid-phrase at phone
 * width, so "+55 vs yesterday" and "your streak starts when today locks at midnight" read as two
 * unrelated fragments instead of one score summary. The row has FOUR shapes and every one of them
 * has to hold: delta or no delta (today can tie yesterday, or there may be no yesterday row at
 * all) times streak or no streak. The divider is a border on the second column precisely so it
 * cannot survive alone when the first column isn't rendered — that is asserted here, not assumed.
 */
import { test } from 'node:test';
import assert from 'node:assert';

/* ---- DOM + storage stubs (module-eval only) — same preamble as client-experience.test.mjs ---- */
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
const { scoreSummary } = await import('./screens/home.js');
RT.userId = 'u1';

const cols = (html) => (html.match(/class="xscore-c"/g) || []).length;
// scoreSummary takes its inputs rather than reaching into S — S.scoreYesterday and S.streakDays
// are derived getters (history lookup / streak walk), so a pure signature is both the honest
// boundary and the only way to exercise all four shapes without faking a calendar.
const at = (score, yesterday, streakDays) => scoreSummary({ score, yesterday, streakDays });

test('delta + no streak: both columns, and the streak side is the invitation', () => {
  const h = at(72, 17, 0);
  assert.equal(cols(h), 2, 'delta column and streak column both render');
  assert.match(h, /\+55/);
  assert.match(h, /vs yesterday/);
  assert.match(h, /Starts tonight/);
  assert.match(h, /locks at midnight/);
  assert.doesNotMatch(h, /Day 0/, 'a zero streak is never numbered');
});

test('delta + live streak: the same slot carries the day number, not "Starts tonight"', () => {
  const h = at(72, 17, 12);
  assert.equal(cols(h), 2);
  assert.match(h, /Day 12/);
  assert.doesNotMatch(h, /Starts tonight/, '"starts tonight" is false for anyone mid-streak');
  assert.match(h, /locks at midnight/, 'the secondary line is identical in both streak states');
});

test('a tie with yesterday drops the delta column, and the divider goes with it', () => {
  const h = at(72, 72, 12);
  assert.equal(cols(h), 1, 'no delta means one column, never an empty one');
  assert.doesNotMatch(h, /vs yesterday/);
  assert.match(h, /Day 12/);
});

test('no yesterday row at all drops the delta column', () => {
  const h = at(72, null, 0);
  assert.equal(cols(h), 1);
  assert.doesNotMatch(h, /vs yesterday/);
  assert.match(h, /Starts tonight/);
});

test('a down day is signed and muted, never a screaming red', () => {
  const h = at(60, 72, 3);
  assert.match(h, /xscore-k down/);
  assert.match(h, /−12/, 'a minus sign, so the delta cannot be read as the score itself');
  assert.doesNotMatch(h, /\+12/);
});

test('the flame only burns once a streak is actually live', () => {
  assert.match(at(72, 17, 5), /xscore-k streak on/);
  assert.doesNotMatch(at(72, 17, 0), /xscore-k streak on/);
});

test('no inline styles — the ratchet is pegged at its ceiling', () => {
  for (const h of [at(72, 17, 0), at(72, 17, 12), at(72, 72, 0), at(72, null, 9)]) {
    assert.doesNotMatch(h, /style="/, 'this row must be styled by class only');
  }
});

/* The row shipped as .xsum, which collapseSection() already owned for its <summary>. Nothing in
   either rule looked overridden, because .xcollapse .xsum simply does not set justify-content, so
   the bare rule won it uncontested and centred the header of every collapse section in the app. */
test('its class names do not collide with collapseSection', async () => {
  const { collapseSection } = await import('./components.js');
  // icon() stamps `ic ic-<name>` on every glyph in the app; that sharing is the point of the
  // primitive, not a collision. Everything else must be disjoint.
  const own = (html) => new Set([...html.matchAll(/class="([^"]+)"/g)]
    .flatMap((m) => m[1].split(/\s+/))
    .filter((c) => c && c !== 'ic' && !c.startsWith('ic-')));
  const mine = own(at(72, 17, 3));
  const theirs = own(collapseSection('x', 'T', null, '', false));
  const shared = [...mine].filter((c) => theirs.has(c));
  assert.deepEqual(shared, [], `shared class names with collapseSection: ${shared.join(', ')}`);
});

test('no bulky container: no card, radius, or background wrapper', () => {
  const h = at(72, 17, 0);
  assert.doesNotMatch(h, /class="[^"]*card/);
});
