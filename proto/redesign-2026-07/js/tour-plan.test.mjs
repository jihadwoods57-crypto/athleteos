/* The first-run tour's personalization matrix, exhaustively.
 *
 * planTour is the only place that decides what a person is shown, so this file is the spec for
 * every role, every goal, and every optional step. If a step list changes, this fails first.
 *
 * Run: node --test proto/redesign-2026-07/js/tour-plan.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planTour, filterSteps, placeCard, TOUR_IDS, isNewAccount, FIRST_RUN_WINDOW_DAYS } from './tour-plan.js';

const keys = (r) => r.steps.map((s) => s.key);

/* A fixed clock and a day-old account: the brand-new-signup case every fixture starts from. */
const NOW = Date.parse('2026-08-05T12:00:00.000Z');
const FRESH = '2026-08-04T12:00:00.000Z';
const DAY = 24 * 60 * 60 * 1000;

/* A linked athlete with a watch, sitting on Home, who has never seen the tour: the maximal case. */
const athlete = (over = {}) => ({
  role: 'athlete', route: 'home', goal: 'gain',
  hasCoach: true, hasStandards: true, seenAt: null, createdAt: FRESH, now: NOW, ...over,
});
const coach = (over = {}) => ({ role: 'coach', route: 'coach', seenAt: null, createdAt: FRESH, now: NOW, ...over });
const trainer = (over = {}) => ({ role: 'trainer', route: 'trainer', seenAt: null, createdAt: FRESH, now: NOW, ...over });
const parent = (over = {}) => ({ role: 'parent', route: 'parent', seenAt: null, createdAt: FRESH, now: NOW, ...over });

/* ---------------- step lists ---------------- */

test('the fully set-up athlete gets all eight steps in order', () => {
  assert.deepEqual(keys(planTour(athlete())),
    ['score', 'log', 'plan', 'progress', 'coach-seen', 'standards', 'profile', 'close']);
});

test('the solo athlete with no watch still gets a complete six-step tour', () => {
  const r = planTour(athlete({ hasCoach: false, hasStandards: false }));
  assert.deepEqual(keys(r), ['score', 'log', 'plan', 'progress', 'profile', 'close']);
});

test('each optional step drops on its own', () => {
  assert.deepEqual(keys(planTour(athlete({ hasCoach: false }))),
    ['score', 'log', 'plan', 'progress', 'standards', 'profile', 'close']);
  assert.deepEqual(keys(planTour(athlete({ hasStandards: false }))),
    ['score', 'log', 'plan', 'progress', 'coach-seen', 'profile', 'close']);
});

test('coach and parent lists', () => {
  assert.deepEqual(keys(planTour(coach())),
    ['invite', 'roster', 'priority', 'activity', 'followups', 'create', 'tab-roster', 'tab-inbox', 'tab-you']);
  assert.deepEqual(keys(planTour(parent())), ['children', 'link', 'visibility', 'funding']);
});

test('the empty-board operator still has a tour once the DOM filter runs', () => {
  // A brand-new coach's dashboard renders NO board anchors — only the invite card, the FAB and
  // the tabs. That must survive as a real tour, not collapse below the min-2 rule.
  const emptyBoard = new Set(['invite', 'create', 'tab-roster', 'tab-inbox', 'tab-you']);
  const alive = filterSteps(planTour(coach()).steps, (a) => (emptyBoard.has(a) ? { width: 40, height: 40 } : null));
  assert.deepEqual(alive.map((s) => s.key), ['invite', 'create', 'tab-roster', 'tab-inbox', 'tab-you']);
});

test('the populated board drops the invite step, nothing else', () => {
  const board = (a) => (a === 'invite' ? null : { width: 40, height: 40 });
  const alive = filterSteps(planTour(coach()).steps, board);
  assert.deepEqual(alive.map((s) => s.key),
    ['roster', 'priority', 'activity', 'followups', 'create', 'tab-roster', 'tab-inbox', 'tab-you']);
});

test('trainer shares the coach anchors but carries its own id', () => {
  const c = planTour(coach());
  const t = planTour(trainer());
  assert.deepEqual(t.steps.map((s) => s.anchor), c.steps.map((s) => s.anchor));
  assert.equal(c.id, TOUR_IDS.coach);
  assert.equal(t.id, TOUR_IDS.trainer);
  assert.notEqual(c.id, t.id);
});

test('trainer copy says practice and clients; coach copy says team and athletes', () => {
  const by = (r, k) => planTour(r).steps.find((s) => s.key === k);
  assert.match(by(trainer(), 'invite').body, /practice/);
  assert.match(by(trainer(), 'priority').body, /clients/);
  assert.match(by(coach(), 'invite').body, /team/);
  assert.match(by(coach(), 'priority').body, /athletes/);
});

/* ---------------- goals ---------------- */

test('every goal from both onboarding flows produces a distinct plan line', () => {
  const goals = ['gain', 'lose', 'maintain', 'performance', 'build', 'health'];
  const bodies = goals.map((goal) => planTour(athlete({ goal })).steps.find((s) => s.key === 'plan').body);
  bodies.forEach((b, i) => assert.match(b, /Yours is built around/, `goal ${goals[i]} has no tail`));
  assert.equal(new Set(bodies).size, goals.length, 'two goals share a line');
});

test('an unknown or missing goal still reads as a finished paragraph', () => {
  for (const goal of [undefined, null, '', 'scholarship', 'NIL opportunities']) {
    const body = planTour(athlete({ goal })).steps.find((s) => s.key === 'plan').body;
    assert.doesNotMatch(body, /Yours is built around/, `goal ${goal} grew a tail`);
    assert.doesNotMatch(body, /  /, `goal ${goal} left a double space`);
  }
});

/* ---------------- audience ---------------- */

test('a fitness client hears trainer, an athlete hears coach', () => {
  const c = planTour(athlete({ audience: 'client' })).steps.find((s) => s.key === 'coach-seen');
  const a = planTour(athlete()).steps.find((s) => s.key === 'coach-seen');
  assert.match(c.title, /trainer/);
  assert.match(c.body, /trainer/);
  assert.doesNotMatch(c.body, /coach/);
  assert.match(a.title, /coach/);
});

/* ---------------- suppression ---------------- */

test('a seen tour returns nothing', () => {
  const r = planTour(athlete({ seenAt: '2026-07-30T12:00:00.000Z' }));
  assert.deepEqual(r.steps, []);
  assert.equal(r.reason, 'already-seen');
  assert.equal(r.id, TOUR_IDS.athlete, 'the id still comes back so the caller can mark it');
});

test('replay overrides the seen flag but not the route guard', () => {
  assert.equal(planTour(athlete({ seenAt: 'x', replay: true })).steps.length, 8);
  assert.deepEqual(planTour(athlete({ seenAt: 'x', replay: true, route: 'settings' })).steps, []);
});

/* ---------------- the first-signup gate ---------------- */

test('an account older than the window is never auto-toured', () => {
  const r = planTour(athlete({ createdAt: new Date(NOW - (FIRST_RUN_WINDOW_DAYS + 1) * DAY).toISOString() }));
  assert.deepEqual(r.steps, []);
  assert.equal(r.reason, 'existing-account');
  assert.equal(r.id, TOUR_IDS.athlete, 'the id still comes back');
});

test('the gate holds for every role', () => {
  const old = { createdAt: new Date(NOW - 90 * DAY).toISOString() };
  for (const ctx of [athlete(old), coach(old), trainer(old), parent(old)]) {
    const r = planTour(ctx);
    assert.deepEqual(r.steps, [], `${ctx.role} toured an old account`);
    assert.equal(r.reason, 'existing-account');
  }
});

test('a missing birthday suppresses without a verdict, so a later boot can self-heal', () => {
  for (const createdAt of [null, undefined, '']) {
    const r = planTour(athlete({ createdAt }));
    assert.deepEqual(r.steps, []);
    assert.equal(r.reason, 'no-birthdate');
  }
});

test('replay bypasses the age gate and the missing birthday', () => {
  const old = new Date(NOW - 90 * DAY).toISOString();
  assert.equal(planTour(athlete({ createdAt: old, replay: true })).steps.length, 8);
  assert.equal(planTour(athlete({ createdAt: null, replay: true })).steps.length, 8);
});

test('the boundary sits at the window, inclusive', () => {
  const inside = new Date(NOW - FIRST_RUN_WINDOW_DAYS * DAY).toISOString();
  const outside = new Date(NOW - FIRST_RUN_WINDOW_DAYS * DAY - 1).toISOString();
  assert.equal(planTour(athlete({ createdAt: inside })).reason, 'ok');
  assert.equal(planTour(athlete({ createdAt: outside })).reason, 'existing-account');
});

test('isNewAccount is strict about garbage', () => {
  assert.equal(isNewAccount(FRESH, NOW), true);
  assert.equal(isNewAccount(new Date(NOW - 90 * DAY).toISOString(), NOW), false);
  assert.equal(isNewAccount(null, NOW), false);
  assert.equal(isNewAccount(undefined, NOW), false);
  assert.equal(isNewAccount('not a date', NOW), false);
  assert.equal(isNewAccount(FRESH, NaN), false);
  assert.equal(isNewAccount(FRESH, undefined), false);
});

test('only the landing route opens a tour', () => {
  for (const route of ['settings', 'ob2', 'plan', 'score-breakdown', '', undefined]) {
    assert.deepEqual(planTour(athlete({ route })).steps, [], `route ${route} opened a tour`);
  }
  assert.deepEqual(planTour(coach({ route: 'home' })).steps, [], 'a coach on home is the mirror guard case');
});

test('an unknown role is silent, not an error', () => {
  for (const role of [null, undefined, '', 'client', 'nutritionist', 'sponsor', 'admin']) {
    const r = planTour({ role, route: 'home', seenAt: null });
    assert.deepEqual(r.steps, []);
    assert.equal(r.id, null);
    assert.equal(r.reason, 'unknown-role');
  }
});

test('garbage context is silent, not an error', () => {
  for (const ctx of [null, undefined, 'nope', 42]) {
    assert.deepEqual(planTour(ctx).steps, []);
  }
});

test('every step carries copy that is a string, never a leftover function', () => {
  for (const ctx of [athlete(), coach(), trainer(), parent()]) {
    for (const s of planTour(ctx).steps) {
      assert.equal(typeof s.title, 'string', `${s.key} title`);
      assert.equal(typeof s.body, 'string', `${s.key} body`);
      assert.ok(s.title.length && s.body.length, `${s.key} is empty`);
      assert.equal(typeof s.anchor, 'string');
    }
  }
});

/* ---------------- filterSteps ---------------- */

const rect = (w = 100, h = 40) => ({ width: w, height: h });
const steps = [{ anchor: 'a' }, { anchor: 'b' }, { anchor: 'c' }];

test('missing and zero-size anchors both drop', () => {
  // 'a' survives alone, so with the default min of 2 the whole tour is abandoned.
  const resolve = (a) => (a === 'b' ? null : a === 'c' ? rect(0, 0) : rect());
  assert.deepEqual(filterSteps(steps, resolve), []);
  assert.deepEqual(filterSteps(steps, resolve, { min: 1 }).map((s) => s.anchor), ['a']);
});

test('a lone survivor is not a tour', () => {
  assert.deepEqual(filterSteps(steps, (a) => (a === 'a' ? rect() : null)), []);
});

test('two survivors are', () => {
  const alive = filterSteps(steps, (a) => (a === 'c' ? null : rect()));
  assert.deepEqual(alive.map((s) => s.anchor), ['a', 'b']);
});

test('a contextual tip is allowed to be a single step', () => {
  const alive = filterSteps([{ anchor: 'a' }], () => rect(), { min: 1 });
  assert.equal(alive.length, 1);
});

test('a throwing resolver drops that step rather than the tour', () => {
  const alive = filterSteps(steps, (a) => { if (a === 'a') throw new Error('detached'); return rect(); });
  assert.deepEqual(alive.map((s) => s.anchor), ['b', 'c']);
});

test('order survives filtering', () => {
  const alive = filterSteps(steps, (a) => (a === 'b' ? null : rect()));
  assert.deepEqual(alive.map((s) => s.anchor), ['a', 'c']);
});

/* ---------------- placeCard ----------------
   Where a card ends up hanging off a screen edge, or covering the very thing it describes. */

const VP = { width: 390, height: 844 };       // iPhone-ish, the shipped target
const CARD = { width: 300, height: 130 };
const anchor = (top, height, left = 20, width = 350) => ({ top, left, width, height });

test('the card sits below the thing it describes', () => {
  const p = placeCard(anchor(120, 160), CARD, VP);
  assert.equal(p.placement, 'below');
  assert.equal(p.top, 120 + 160 + 12);
});

test('an anchor near the bottom flips the card above it', () => {
  const p = placeCard(anchor(700, 90), CARD, VP);
  assert.equal(p.placement, 'above');
  assert.equal(p.top, 700 - 12 - CARD.height);
});

test('the card centres on its anchor', () => {
  // Well clear of both edges, so centring is what is being measured and not the clamp.
  const p = placeCard(anchor(100, 80, 300, 100), CARD, { width: 900, height: 844 });
  assert.equal(p.left, 300 + 50 - 150);
});

test('a card never hangs off the left or right edge', () => {
  const left = placeCard(anchor(100, 80, 0, 40), CARD, VP);
  assert.ok(left.left >= 12, `left edge at ${left.left}`);
  const right = placeCard(anchor(100, 80, 350, 40), CARD, VP);
  assert.ok(right.left + CARD.width <= VP.width - 12 + 0.01, `right edge at ${right.left + CARD.width}`);
});

test('a card never hangs off the top or bottom edge', () => {
  for (const top of [0, 5, 400, 800, 843]) {
    const p = placeCard(anchor(top, 60), CARD, VP);
    assert.ok(p.top >= 12, `top ${top} placed at ${p.top}`);
    assert.ok(p.top + CARD.height <= VP.height - 12 + 0.01, `top ${top} overflows to ${p.top + CARD.height}`);
  }
});

test('an anchor taller than the viewport still gets a placed card', () => {
  const p = placeCard(anchor(0, 900), CARD, VP);
  assert.ok(Number.isFinite(p.top) && Number.isFinite(p.left));
  assert.ok(p.top >= 12 && p.top + CARD.height <= VP.height - 12 + 0.01);
});

test('a viewport too short for the card degrades to the top pad, never a negative offset', () => {
  const p = placeCard(anchor(10, 20), { width: 300, height: 400 }, { width: 390, height: 300 });
  assert.equal(p.top, 12);
});

test('below wins when both directions fit', () => {
  assert.equal(placeCard(anchor(300, 80), CARD, VP).placement, 'below');
});
