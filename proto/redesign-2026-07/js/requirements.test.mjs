/* Semantic-accent pinning — the lint layer the token ratchet can't provide.
 *
 * The drift this exists to stop was live in production review: Dinner carried the ACTION blue
 * while Breakfast and Lunch stated the identical "Nutrition · 50% of score" fact in green, so
 * the same fact rendered two colours on one screen. The token layer can't catch that — the
 * letters were all valid tokens. The MEANING layer can: a requirement's accent is a function of
 * what it impacts, so pin the function and a typo'd letter fails the suite the day it is typed.
 *
 * DESIGN.md's hue table is the authority: green = nutrition, purple = recovery, blue =
 * action/commitment, muted = tracked-not-scored facts, amber = WARNING ONLY (which is why no
 * catalog entry may ever carry it — a requirement's identity is never a warning; its STATE can
 * be). Cyan ('c') was minted for the Weekly Check-In ritual; v2 deletes that ritual entirely
 * (requirements.js's own CATALOG comment says the same), so cyan is RETIRED — no live catalog
 * entry's impact.comp is ever 'checkin', which is why ACCENT_FOR_COMP below carries no entry for
 * it: a map that pinned 'checkin' -> 'c' would document a mapping the CATALOG can never exercise. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CATALOG, IMPACT_LABEL, catalogFromItems } from './requirements.js';

const ACCENT_FOR_COMP = { nutrition: 'g', recovery: 'p', commitment: 'b' };

test('every component-impact requirement wears its component\'s hue', () => {
  for (const req of CATALOG) {
    if (req.impact && req.impact.kind === 'component') {
      assert.equal(req.accent, ACCENT_FOR_COMP[req.impact.comp],
        `${req.id} impacts ${req.impact.comp} but wears accent '${req.accent}'`);
    }
  }
});

test('tracked-not-scored requirements are muted, never a semantic hue', () => {
  for (const req of CATALOG) {
    if (req.impact && req.impact.kind === 'trend') {
      assert.equal(req.accent, 'muted',
        `${req.id} is tracked-not-scored but wears accent '${req.accent}' — provenance is a fact, not a status`);
    }
  }
});

test('no requirement identity ever wears the warning hue', () => {
  for (const req of CATALOG) {
    assert.notEqual(req.accent, 'a',
      `${req.id} wears amber — amber is reserved for warning STATES (overdue, at risk), never identity`);
  }
});

test('the same fact never renders two colours: identical impacts share one accent', () => {
  const byComp = {};
  for (const req of CATALOG) {
    if (!req.impact || req.impact.kind !== 'component') continue;
    const k = req.impact.comp;
    if (byComp[k] && byComp[k] !== req.accent) {
      assert.fail(`${k} renders as both '${byComp[k]}' and '${req.accent}' across the catalog`);
    }
    byComp[k] = req.accent;
  }
});

test('the weekly check-in requirement is gone', () => {
  assert.equal(CATALOG.find((r) => r.id === 'checkin'), undefined,
    'v2 has one check-in: the nightly recovery one');
});

test('no requirement routes to the deleted weekly check-in screen', () => {
  for (const r of CATALOG) {
    assert.notEqual(r.route, 'checkin', `${r.id} still routes to the deleted screen`);
  }
});

test('IMPACT_LABEL has no weekly check-in entry', () => {
  assert.equal(Object.prototype.hasOwnProperty.call(IMPACT_LABEL, 'checkin'), false);
});

test('a stored item that still carries kind:checkin never routes to the deleted screen', () => {
  // Task 8: KIND_DEFAULTS.checkin (which carried route:'checkin') is gone. A pre-cutover
  // requirement_sets row can still have an item shaped like this; it must fall through to
  // the 'custom' default — which has no route — rather than resurrect the deleted screen
  // (screens/requirement.js:17's catalogFromItems(...).find(...) fallback would otherwise
  // emit a dangling data-go="checkin").
  const [req] = catalogFromItems([
    { id: 'weekly', title: 'Weekly Check-In', kind: 'checkin', proof: 'form', freq: { type: 'weekly', day: 0, label: 'Sundays' }, window: { due: 1260 } },
  ]);
  assert.notEqual(req.route, 'checkin', 'a stale checkin-kind item still routes to the deleted screen');
  assert.equal(req.route, undefined, 'a stale checkin-kind item should carry no route at all (falls to custom)');
});

test('review finding 1: a stored standard with no recovery item still surfaces one to the coach', () => {
  // A pre-cutover requirement_sets row can have no recovery item at all (the old "off" knob
  // serialized as its absence). Recovery is never optional under v2 — coach-data.js's
  // entriesFor/loadAthleteProfile, screens/coach.js's requirementsSection, and
  // screens/coach-insights.js's buildReqsByAthlete all route every stored standard through
  // catalogFromItems, so forcing it in here is the one chokepoint that keeps the coach's view
  // from ever disagreeing with the athlete's real, always-scored day.
  const noRecovery = catalogFromItems([
    { id: 'meal-1', title: 'Breakfast', kind: 'meal', proof: 'photo', freq: { type: 'daily' }, window: { due: 570 } },
  ]);
  const recovery = noRecovery.find((r) => r.id === 'recovery');
  assert.ok(recovery, 'catalogFromItems dropped Recovery entirely for a standard with no recovery item');
  assert.equal(recovery.required, true);
  assert.deepEqual(recovery.impact, { kind: 'component', comp: 'recovery' });
});

test('review finding 1: a stored standard that already has recovery is never duplicated', () => {
  const items = [
    { id: 'meal-1', title: 'Breakfast', kind: 'meal', proof: 'photo', freq: { type: 'daily' }, window: { due: 570 } },
    { id: 'recovery', title: 'Recovery Check-In', kind: 'recovery', proof: 'form', freq: { type: 'daily' }, window: { due: 1410, label: 'Before bed' } },
  ];
  const reqs = catalogFromItems(items);
  assert.equal(reqs.filter((r) => r.id === 'recovery').length, 1);
});

test('review finding 3: IMPACT_LABEL.recovery is the SUM, never the lone engine slot', () => {
  // liveWeightPct('recovery') alone is 12 (the FALLBACK_WEIGHTS athlete row) — half the real
  // pillar. The athlete's actual Recovery card, and every other live surface, quotes
  // checkin + recovery (24). This label (screens/requirement.js's "what it touches" fact, on
  // the real nightly Recovery Check-In requirement) must match.
  assert.equal(IMPACT_LABEL.recovery, 'Recovery · 24% of score');
});
