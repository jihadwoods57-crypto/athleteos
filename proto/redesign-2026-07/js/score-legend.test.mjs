/* The legend page can never disagree with the product. These pin the legend to the ONE tier
   ladder and the ONE pair of meal floors, from both directions: every tier is on the page with
   its real range, and the meal bands wear the labels the meal thread prints.
   Run: node --test proto/redesign-2026-07/js/score-legend.test.mjs */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dailyLegend, mealLegend } from './score-legend.js';
import { TIERS, tierRange, MEAL_QUALITY_GOOD, MEAL_QUALITY_OK, ON_STANDARD } from './score-band.js';
import { qualityBand } from './meal-intel.js';

test('every tier is on the legend, in ladder order, with the ladder\'s own range', () => {
  const rows = dailyLegend();
  TIERS.forEach((t, i) => {
    assert.equal(rows[i].name, t.name);
    assert.equal(rows[i].range, tierRange(i));
    assert.ok(rows[i].meaning.length > 10, `${t.name} has a meaning`);
  });
  assert.equal(rows[TIERS.length].dashed, true, 'the not-started ring is last and dashed');
  assert.equal(rows.length, TIERS.length + 1);
});

test('the legend says on standard begins where the engine says it does', () => {
  const locked = dailyLegend().find((r) => r.name === 'Locked In');
  assert.ok(locked.range.startsWith(String(ON_STANDARD)), `Locked In range starts at ${ON_STANDARD}: ${locked.range}`);
});

test('meal bands carry the labels the meal thread prints, at the shared floors', () => {
  const rows = mealLegend();
  assert.equal(rows[0].label, 'Perfect plate');
  assert.equal(rows[0].range, '100');
  assert.equal(rows[1].label, qualityBand(MEAL_QUALITY_GOOD).label);
  assert.equal(rows[1].range, `${MEAL_QUALITY_GOOD}–99`);
  assert.equal(rows[2].label, qualityBand(MEAL_QUALITY_OK).label);
  assert.equal(rows[3].label, qualityBand(0).label);
  assert.equal(rows[3].range, `0–${MEAL_QUALITY_OK - 1}`);
});

test('a 100 is its own band: Perfect plate, still status-green, flagged perfect', () => {
  assert.deepEqual(qualityBand(100), { cls: 'good', label: 'Perfect plate', perfect: true });
  assert.equal(qualityBand(99).label, 'Strong');
  assert.equal(qualityBand(99).perfect, undefined);
});
