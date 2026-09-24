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

// The roll call is switched off (commitments.js, 2026-09-24). This file tests the roll call itself,
// so it runs it switched ON, as it will be when it comes back; rollcall-off.test.mjs pins the off state.
import { rollcallOnForTests } from './commitments.js';
rollcallOnForTests();


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
const { seedMineForHarness, todayISO } = await import('./commitment-data.js');

/* Times are built RELATIVE TO NOW so each phase is reachable without faking the clock: the screen
   reads `new Date()` itself. Shape copied from the real board row (commitments.test.mjs `wake`). */
const iso = (msFromNow) => new Date(Date.now() + msFromNow).toISOString();
const MIN = 60_000;
// LOCAL dates, the app's own (commitment-data.js todayISO). A UTC date disagreed with the screen's
// "today" every evening in the Americas, and the redirect test failed at those hours only.
const today = todayISO();

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

/* ONE WAY IN (roll call rebuilt, 2026-09-23). Today's wake-up (or an earlier one) is the team
   board now. The detail screen stays for tomorrow's preview (it explains this phone's alarm for
   that morning) and for every other commitment type. The router asks `redirect` BEFORE it paints,
   so an old push to roll-call/<id> never shows a frame of this screen for a wake-up. The render
   tests above still render the full detail on purpose: it is what the preview shows. */
const tomorrow = (() => { const d = new Date(); d.setDate(d.getDate() + 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; })();
const { athleteRollcallRoute, isRollcall, ROLLCALL_ARRIVAL_TYPES } = await import('./commitments.js');

test('an old roll-call/<id> link to today’s wake-up hands over to the board before painting', () => {
  seedMineForHarness([wake()], today);
  assert.equal(screen.redirect({ sub: 'rc-1' }), 'rollcall-board/rc-1');
});

test('tomorrow’s preview and other commitments keep the detail screen', () => {
  seedMineForHarness([wake({ occurs_on: tomorrow })], today);
  assert.equal(screen.redirect({ sub: 'rc-1' }), null, 'the preview explains this phone’s alarm');
  seedMineForHarness([wake({ type: 'practice' })], today);
  assert.equal(screen.redirect({ sub: 'rc-1' }), null, 'a practice keeps its detail');
});

test('an id that is not cached yet shows the board’s skeleton, never the old detail or a blank', () => {
  seedMineForHarness([], today);
  const html = screen.render({ sub: 'cold-id' });
  assert.match(html, /Roll call/);
  assert.match(html, /sk-card|aria-busy/, 'the shared skeleton primitive, the same one the board loads with');
  assert.equal(screen.redirect({ sub: 'cold-id' }), null, 'nothing to hand over until the row resolves');
});

test('the preview is never a dead end once its window opens: it links to the board', () => {
  const html = render(wake({ occurs_on: tomorrow }));
  assert.match(html, /data-go="rollcall-board\/rc-1"/);
  const before = render(wake({ occurs_on: tomorrow, starts_at: iso(30 * MIN), respond_by_at: iso(35 * MIN), closes_at: iso(60 * MIN) }));
  assert.doesNotMatch(before, /data-go="rollcall-board\//, 'before it opens there is no board to show');
});

test('every athlete door asks one rule: board for today and earlier, detail otherwise', () => {
  const r = (over) => athleteRollcallRoute({ instance_id: 'i', type: 'morning_roll_call', occurs_on: today, ...over }, today);
  assert.equal(r({}), 'rollcall-board/i');
  assert.equal(r({ occurs_on: '2020-01-01' }), 'rollcall-board/i');
  assert.equal(r({ occurs_on: tomorrow }), 'roll-call/i');
  assert.equal(r({ type: 'study_hall' }), 'roll-call/i');
  assert.equal(athleteRollcallRoute({}, today), null);
});

test('isRollcall lives in the pure module and matches the setup screen’s arrival kinds', async () => {
  const { ARRIVAL_KINDS } = await import('./screens/rollcall-setup.js');
  assert.deepEqual(ARRIVAL_KINDS.map((k) => k.type), ROLLCALL_ARRIVAL_TYPES);
  assert.equal(isRollcall({ type: 'morning_roll_call' }), true);
  assert.equal(isRollcall({ type: 'practice', location_id: 'l', escalation: { rollcall: true } }), true);
  assert.equal(isRollcall({ type: 'practice', location_id: 'l', escalation: {} }), false, 'a composer practice is not claimed');
});

test('a local wake-up reminder opens the board; any other commitment its detail', async () => {
  const { planNotifications } = await import('./notify-plan.js');
  const { commitmentReminders } = await import('./commitments.js');
  const rows = [
    { instance_id: 'w1', type: 'morning_roll_call', occurs_on: today, status: 'pending', starts_min: 600, respond_by_min: 605, reminder_offsets_min: [5] },
    { instance_id: 'p1', type: 'practice', occurs_on: today, status: 'pending', starts_min: 900, reminder_offsets_min: [15] },
  ];
  const plan = planNotifications({ nowMin: 60, dateISO: today, commitments: commitmentReminders(rows, today) });
  const route = (id) => (plan.find((n) => String(n.id).startsWith(`vc:${id}:`)) || {}).route;
  assert.equal(route('w1'), 'rollcall-board/w1');
  assert.equal(route('p1'), 'roll-call/p1');
});
