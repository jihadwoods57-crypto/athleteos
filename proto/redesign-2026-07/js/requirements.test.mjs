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
    { id: 'recovery', title: 'Recovery check-in', kind: 'recovery', proof: 'form', freq: { type: 'daily' }, window: { due: 1410, label: 'Before bed' } },
  ];
  const reqs = catalogFromItems(items);
  assert.equal(reqs.filter((r) => r.id === 'recovery').length, 1);
});

test('review finding 3: IMPACT_LABEL.recovery is the SUM, never the lone engine slot', () => {
  // liveWeightPct('recovery') alone is 9 (the FALLBACK_WEIGHTS athlete row) — half the real
  // pillar. The athlete's actual Recovery card, and every other live surface, quotes
  // checkin + recovery (18). This label (screens/requirement.js's "what it touches" fact, on
  // the real nightly Recovery check-in requirement) must match.
  assert.equal(IMPACT_LABEL.recovery, 'Recovery · 18% of score');
});

/* 2026-09-15: the coach's status engine looked a logged breakfast up as meals['meal-1'] and called
 * it overdue. The athlete's day maps a standard's meal items to slot keys BY POSITION (stdFromItems
 * → STD_SLOT_MAP), writes days.meals and days.tasks under those keys, and every coach-side reader
 * of a stored set routes through catalogFromItems — so this is the one place the two sides can be
 * made to agree. A meal item's id IS its day slot. The original id and the kind ride along. */
import { STD_SLOT_MAP, stdFromItems } from './requirements.js';

test('a meal item is identified by the day slot stdFromItems gives it, not by its stored id', () => {
  const three = [
    { id: 'meal-1', title: 'Breakfast', kind: 'meal', proof: 'photo', window: { due: 570, open: 420 } },
    { id: 'meal-2', title: 'Lunch', kind: 'meal', proof: 'photo', window: { due: 840, open: 720 } },
    { id: 'meal-3', title: 'Dinner', kind: 'meal', proof: 'photo', window: { due: 1230, open: 1080 } },
    { id: 'weight', title: 'Morning Weight', kind: 'weigh', proof: 'scale' },
  ];
  const reqs = catalogFromItems(three);
  assert.deepEqual(reqs.filter((r) => r.kind === 'meal').map((r) => r.id), stdFromItems(three).slots);
  assert.deepEqual(reqs.filter((r) => r.kind === 'meal').map((r) => r.id), ['breakfast', 'lunch', 'dinner']);
  assert.deepEqual(reqs.filter((r) => r.kind === 'meal').map((r) => r.itemId), ['meal-1', 'meal-2', 'meal-3'], 'the stored id is kept');
  assert.equal(reqs.find((r) => r.id === 'lunch').window.due, 840, 'the window rides with the item, not the slot');
  assert.equal(reqs.find((r) => r.id === 'weight').id, 'weight', 'non-meal ids are untouched');
  assert.equal(reqs.find((r) => r.id === 'weight').kind, 'weigh', 'kind rides through for every item');
});

test('four meals put the third in the snack slot, exactly as the athlete day does', () => {
  const four = ['Pre-lift', 'Lunch', 'Afternoon', 'Dinner'].map((t, i) => ({ id: `meal-${i + 1}`, title: t, kind: 'meal', proof: 'photo' }));
  assert.deepEqual(catalogFromItems(four).filter((r) => r.kind === 'meal').map((r) => r.id), STD_SLOT_MAP[4]);
  assert.deepEqual(STD_SLOT_MAP[4], ['breakfast', 'lunch', 'snack', 'dinner']);
});

test('a meal item beyond the six slots the day can hold keeps its own id rather than inventing a slot', () => {
  const seven = Array.from({ length: 7 }, (_x, i) => ({ id: `meal-${i + 1}`, title: `Meal ${i + 1}`, kind: 'meal', proof: 'photo' }));
  const ids = catalogFromItems(seven).filter((r) => r.kind === 'meal').map((r) => r.id);
  assert.deepEqual(ids.slice(0, 6), STD_SLOT_MAP[6]);
  assert.equal(ids[6], 'meal-7');
});
