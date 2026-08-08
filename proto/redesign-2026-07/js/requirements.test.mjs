/* Semantic-accent pinning — the lint layer the token ratchet can't provide.
 *
 * The drift this exists to stop was live in production review: Dinner carried the ACTION blue
 * while Breakfast and Lunch stated the identical "Nutrition · 50% of score" fact in green, so
 * the same fact rendered two colours on one screen. The token layer can't catch that — the
 * letters were all valid tokens. The MEANING layer can: a requirement's accent is a function of
 * what it impacts, so pin the function and a typo'd letter fails the suite the day it is typed.
 *
 * DESIGN.md's hue table is the authority: green = nutrition, purple = recovery, cyan = weekly
 * check-in, blue = action/commitment, muted = tracked-not-scored facts, amber = WARNING ONLY
 * (which is why no catalog entry may ever carry it — a requirement's identity is never a
 * warning; its STATE can be). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CATALOG } from './requirements.js';

const ACCENT_FOR_COMP = { nutrition: 'g', recovery: 'p', checkin: 'c', commitment: 'b' };

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
