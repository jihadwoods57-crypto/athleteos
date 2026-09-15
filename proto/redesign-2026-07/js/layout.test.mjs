/* The layout tier and the master/detail pairing (js/layout.js), tested without a DOM.
 *
 * The tier is the one switch the whole iPad layout hangs on, and the pairing decides whether a
 * coach's list stays on screen while the detail opens. Both are arithmetic over plain values, so
 * both are tested as such. Run:
 *   node --test proto/redesign-2026-07/js/layout.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WIDE_MIN, SPLIT_MIN, layoutTier, masterFor } from './layout.js';

test('the tier is keyed on width and only on a touch device without hover', () => {
  assert.equal(WIDE_MIN, 700);
  assert.equal(SPLIT_MIN, 1000);
  assert.equal(layoutTier(699, true), null);
  assert.equal(layoutTier(700, true), 'wide');
  assert.equal(layoutTier(999, true), 'wide');
  assert.equal(layoutTier(1000, true), 'split');
  assert.equal(layoutTier(1366, true), 'split');
  assert.equal(layoutTier(1366, false), null, 'a desktop browser keeps the phone bezel');
  assert.equal(layoutTier(1366, false, true), 'split', '?layout=auto drops the pointer condition');
  assert.equal(layoutTier(320, true), null, 'Slide Over is the phone layout');
});

const TABS = [
  { id: 'home', route: 'coach-home' },
  { id: 'roster', route: 'coach-roster' },
  { id: 'create', route: 'coach-create', fab: true },
  { id: 'inbox', route: 'coach-inbox' },
];
const ROSTER = { pane: 'master' };
const ATHLETE = { pane: 'detail' };

test('a master route pairs with itself', () => {
  const r = masterFor({ mod: ROSTER, route: 'coach-roster', tab: 'roster', tabs: TABS, modOf: () => ROSTER });
  assert.deepEqual(r, { route: 'coach-roster', mod: ROSTER, self: true });
});

test('a detail pairs with the loaded master behind its origin tab', () => {
  const r = masterFor({ mod: ATHLETE, route: 'coach-athlete', tab: 'roster', tabs: TABS, modOf: (x) => (x === 'coach-roster' ? ROSTER : undefined) });
  assert.deepEqual(r, { route: 'coach-roster', mod: ROSTER, self: false });
});

test('a detail whose master has not loaded yet asks for it', () => {
  const r = masterFor({ mod: ATHLETE, route: 'coach-athlete', tab: 'roster', tabs: TABS, modOf: () => null });
  assert.deepEqual(r, { route: 'coach-roster', mod: null, pending: true });
});

test('a detail opened from Home, a plain screen, and a sheet all render one column', () => {
  assert.equal(masterFor({ mod: ATHLETE, route: 'coach-athlete', tab: 'home', tabs: TABS, modOf: () => ({}) }), null, 'Home is not a master');
  assert.equal(masterFor({ mod: {}, route: 'coach-home', tab: 'home', tabs: TABS, modOf: () => ROSTER }), null, 'a plain screen never pairs');
  assert.equal(masterFor({ mod: { pane: 'detail', transient: true }, route: 'log', tab: 'roster', tabs: TABS, modOf: () => ROSTER }), null, 'a sheet never pairs');
  assert.equal(masterFor({ mod: ATHLETE, route: 'coach-athlete', tab: 'nope', tabs: TABS, modOf: () => ROSTER }), null, 'an unknown tab has no master');
  assert.equal(masterFor({ mod: ATHLETE, route: 'coach-athlete', tab: 'create', tabs: TABS, modOf: () => ROSTER }), null, 'the FAB is never a master');
  assert.equal(masterFor({ mod: null, route: 'x', tab: 'roster', tabs: TABS, modOf: () => ROSTER }), null);
});

test('a tab whose module is not a master pairs nothing, even when loaded', () => {
  assert.equal(masterFor({ mod: ATHLETE, route: 'coach-athlete', tab: 'roster', tabs: TABS, modOf: () => ({ nav: 'operator' }) }), null);
});
