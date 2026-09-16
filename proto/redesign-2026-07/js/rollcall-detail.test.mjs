/* The athlete's roll-call detail screen must RENDER. All of it, in every phase.
 *
 * 2026-09-15, found by an audit and shipped live in 8374e018 / OTA eb55f780: `howItWorks()` is a
 * module-scope sibling of `wakeupDetail(row, d)` and reads `d.actionLabel`. There is no `d` in its
 * scope, so opening a roll call threw a ReferenceError on EVERY athlete, on every phase, on every
 * open. The router caught it and bounced to Home, so from the athlete's side the tap did nothing.
 *
 * All sixteen verify gates were green the whole time, and `lint:undef` cannot catch it by design:
 * its rule (b) suppresses any identifier bound ANYWHERE in the file, and `d` is bound at line 514
 * inside a different function. Nothing rendered this screen.
 *
 * So this suite renders it. Not a regex over source, which would have been just as blind: the real
 * screen module, seeded through the harness seam, at four clocks, asserting no throw and that the
 * words an athlete needs are actually on the page. Run:
 *   node --test proto/redesign-2026-07/js/rollcall-detail.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';

/* The screen graph touches the DOM at module eval; same shim as roll-call-resolve.test.mjs. */
const el = () => ({
  style: { setProperty() {}, removeProperty() {} },
  classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
  setAttribute() {}, getAttribute: () => null, addEventListener() {},
  querySelectorAll: () => [], querySelector: () => null, appendChild() {}, remove() {}, insertAdjacentHTML() {},
});
globalThis.window = { location: { hash: '' }, addEventListener() {}, matchMedia: () => ({ matches: false, addEventListener() {}, addListener() {} }) };
globalThis.document = Object.assign(el(), { createElement: el, getElementById: () => null, documentElement: el(), body: el(), head: el() });
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
globalThis.sessionStorage = { getItem: () => null, setItem() {}, removeItem() {} };
globalThis.location = globalThis.window.location;

const screen = (await import('./screens/roll-call.js')).default;
const { seedMineForHarness } = await import('./commitment-data.js');

/* Times are built RELATIVE TO NOW so each phase is reachable without faking the clock: the screen
   reads `new Date()` itself. Shape copied from the real board row (commitments.test.mjs `wake`). */
const iso = (msFromNow) => new Date(Date.now() + msFromNow).toISOString();
const MIN = 60_000;
const today = new Date().toISOString().slice(0, 10);

function wake(over = {}) {
  return {
    instance_id: 'rc-1', type: 'morning_roll_call', title: 'Wake-Up Roll Call',
    message: 'Everyone up and ready to go?', action_label: 'I am up', coach_name: "Coach D'Onofrio",
    repeat_days: [1, 2, 3, 4, 5], starts_on: '2026-01-01', ends_on: null,
    starts_min: 360, respond_by_min: 365, opens_min: 360, ends_min: 390,
    timezone: 'America/New_York', occurs_on: today,
    starts_at: iso(-1 * MIN), respond_by_at: iso(4 * MIN), closes_at: iso(29 * MIN),
    status: 'pending', acknowledged_at: null, arrived_at: null, completed_at: null,
    device_tapped_at: null, disputed_at: null, excused_reason: null,
    ...over,
  };
}

const render = (row) => {
  seedMineForHarness([row], today);
  return screen.render({ sub: row.instance_id });
};

/* The four clocks. Each one is a different branch of the verdict card, and every one of them
   reaches `howItWorks` at the foot of the template, which is where the crash lived. */
const PHASES = [
  ['before the roll call opens', { starts_at: iso(30 * MIN), respond_by_at: iso(35 * MIN), closes_at: iso(60 * MIN) }],
  ['while it is open', {}],
  ['once it is late', { starts_at: iso(-20 * MIN), respond_by_at: iso(-15 * MIN), closes_at: iso(10 * MIN) }],
  ['after it closed unanswered', { starts_at: iso(-60 * MIN), respond_by_at: iso(-55 * MIN), closes_at: iso(-30 * MIN) }],
];

for (const [label, over] of PHASES) {
  test(`the detail screen renders ${label}`, () => {
    let html;
    assert.doesNotThrow(() => { html = render(wake(over)); }, `wakeupDetail threw ${label}`);
    assert.ok(html && html.length > 400, 'it rendered something real');
    assert.match(html, /Wake-Up Roll Call/, 'the athlete sees which roll call this is');
    assert.match(html, /How roll call works/, 'the explainer is on the page, not swallowed by a throw');
  });
}

test('an acknowledged roll call renders its receipt', () => {
  let html;
  assert.doesNotThrow(() => {
    html = render(wake({ acknowledged_at: iso(-2 * MIN), status: 'acknowledged' }));
  });
  assert.match(html, /Checked in at/, 'the stamp the athlete came to see');
});

test("the explainer quotes the coach's own button words", () => {
  // The exact line that threw. `action_label` is what the coach typed, and the explainer tells the
  // athlete to look for THOSE words on the lock screen, so it has to receive them.
  const html = render(wake({ action_label: 'Rise and grind' }));
  assert.match(html, /Rise and grind/, 'the action label reaches the explainer');
});

test('a roll call with no coach-set label still explains itself', () => {
  // action_label null is the common case: deriveCommitment supplies the default. The explainer must
  // print that default rather than "undefined".
  const html = render(wake({ action_label: null }));
  assert.match(html, /How roll call works/);
  assert.doesNotMatch(html, /undefined/, 'no undefined leaked into athlete-facing copy');
});
