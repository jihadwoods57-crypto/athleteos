/* The first-run tour's personalization matrix, exhaustively.
 *
 * planTour is the only place that decides what a person is shown, so this file is the spec for
 * every role, every goal, and every optional step. If a step list changes, this fails first.
 *
 * Run: node --test proto/redesign-2026-07/js/tour-plan.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planTour, filterSteps, placeCard, TOUR_IDS } from './tour-plan.js';

const keys = (r) => r.steps.map((s) => s.key);

/* A linked athlete with a watch, sitting on Home, who has never seen the tour: the maximal case. */
const athlete = (over = {}) => ({
  role: 'athlete', route: 'home', goal: 'gain',
  hasCoach: true, hasStandards: true, seenAt: null, ...over,
});
const coach = (over = {}) => ({ role: 'coach', route: 'coach', seenAt: null, ...over });
const trainer = (over = {}) => ({ role: 'trainer', route: 'trainer', seenAt: null, ...over });
const parent = (over = {}) => ({ role: 'parent', route: 'parent', seenAt: null, ...over });

/* ---------------- step lists ---------------- */

test('the fully set-up athlete gets all six steps in order', () => {
  assert.deepEqual(keys(planTour(athlete())), ['score', 'log', 'plan', 'coach-seen', 'standards', 'close']);
});

test('the solo athlete with no watch still gets a complete four-step tour', () => {
  const r = planTour(athlete({ hasCoach: false, hasStandards: false }));
  assert.deepEqual(keys(r), ['score', 'log', 'plan', 'close']);
});

test('each optional step drops on its own', () => {
  assert.deepEqual(keys(planTour(athlete({ hasCoach: false }))), ['score', 'log', 'plan', 'standards', 'close']);
  assert.deepEqual(keys(planTour(athlete({ hasStandards: false }))), ['score', 'log', 'plan', 'coach-seen', 'close']);
});

test('coach and parent lists', () => {
  assert.deepEqual(keys(planTour(coach())), ['roster', 'priority', 'activity', 'followups']);
  assert.deepEqual(keys(planTour(parent())), ['children', 'visibility', 'funding']);
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
  const t = planTour(trainer()).steps;
  const c = planTour(coach()).steps;
  assert.match(t[0].body, /practice/);
  assert.match(t[1].body, /clients/);
  assert.match(c[0].body, /team/);
  assert.match(c[1].body, /athletes/);
});

/* ---------------- goals ---------------- */

test('every goal from both onboarding flows produces a distinct plan line', () => {
  const goals = ['gain', 'lose', 'maintain', 'performance', 'build', 'health'];
  const bodies = goals.map((goal) => planTour(athlete({ goal })).steps.find((s) => s.key === 'plan').body);
  bodies.forEach((b, i) => assert.match(b, /Yours is built around/, `goal ${goals[i]} has no tail`));
  assert.equal(new Set(bodies).size, goals.length, 'two goals share a line');
});

test('an unknown or missing goal still reads as a finished sentence', () => {
  for (const goal of [undefined, null, '', 'scholarship', 'NIL opportunities']) {
    const body = planTour(athlete({ goal })).steps.find((s) => s.key === 'plan').body;
    assert.equal(body, 'What the day asks of you.');
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

test('replay overrides the seen flag but nothing else', () => {
  assert.equal(planTour(athlete({ seenAt: 'x', replay: true })).steps.length, 6);
  assert.deepEqual(planTour(athlete({ seenAt: 'x', replay: true, route: 'settings' })).steps, []);
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
