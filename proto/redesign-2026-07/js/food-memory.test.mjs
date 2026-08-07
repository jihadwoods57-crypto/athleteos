import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mealSignature, findRepeats, matchSaved, remainingToday, rankForRemaining,
  memoryContextForAnalysis, itemFromMeal, cleanText, dominantBrand,
} from './food-memory.js';

test('mealSignature is order-insensitive, deduped, and case-normalized', () => {
  assert.equal(mealSignature(['Rice', 'grilled chicken', 'rice ']), 'grilled chicken|rice');
  assert.equal(mealSignature(['grilled chicken', 'Rice']), mealSignature(['rice', 'Grilled Chicken']));
  assert.equal(mealSignature([]), '');
  assert.equal(mealSignature([{ name: 'Eggs' }, 'toast']), 'eggs|toast');
});

const row = (detected, macros = {}, name = 'Chicken & Rice') => ({
  name, detected, protein: 40, kcal: 600, carbs: 55, fat: 18, fiber: 4, ...macros,
});

test('findRepeats surfaces a plate eaten 3+ times, skipping saved and dismissed', () => {
  const rows = [
    row(['grilled chicken', 'rice']), row(['rice', 'grilled chicken']), row(['grilled chicken', 'rice']),
    row(['salmon', 'quinoa'], {}, 'Salmon bowl'), row(['salmon', 'quinoa'], {}, 'Salmon bowl'),
  ];
  const out = findRepeats(rows, new Set(), new Set());
  assert.equal(out.length, 1);
  assert.equal(out[0].count, 3);
  assert.equal(out[0].name, 'Chicken & Rice');
  assert.equal(out[0].protein, 40);
  const sig = out[0].signature;
  assert.equal(findRepeats(rows, new Set([sig]), new Set()).length, 0, 'already saved');
  assert.equal(findRepeats(rows, new Set(), new Set([sig])).length, 0, 'dismissed');
});

test('findRepeats never suggests generic slot-name or zero-macro groups', () => {
  const generic = [row([], {}, 'Dinner'), row([], {}, 'Dinner'), row([], {}, 'Dinner')];
  assert.equal(findRepeats(generic, new Set(), new Set()).length, 0);
  const zeros = [row(['mystery'], { protein: 0, kcal: 0 }), row(['mystery'], { protein: 0, kcal: 0 }), row(['mystery'], { protein: 0, kcal: 0 })];
  assert.equal(findRepeats(zeros, new Set(), new Set()).length, 0);
});

test('matchSaved finds the usual above threshold and refuses weak echoes', () => {
  const items = [
    { id: '1', name: 'Usual Subway order', items: [{ name: 'turkey sandwich' }, { name: 'provolone cheese' }], status: 'active' },
    { id: '2', name: 'Morning shake', items: [{ name: 'protein shake' }], status: 'active' },
  ];
  const hit = matchSaved(items, ['turkey sandwich', 'provolone cheese'], 'Subway order');
  assert.ok(hit && hit.item.id === '1');
  assert.equal(matchSaved(items, ['pepperoni pizza'], 'Pizza night'), null);
  assert.equal(matchSaved([{ ...items[0], status: 'archived' }], ['turkey sandwich', 'provolone cheese'], 'Subway order'), null);
});

test('remainingToday keeps unset targets null and floors at zero', () => {
  assert.deepEqual(remainingToday({ proteinSoFar: 120, kcalSoFar: 1800, proteinTarget: 180, kcalTarget: 2400 }),
    { protein: 60, kcal: 600 });
  assert.deepEqual(remainingToday({ proteinSoFar: 10, kcalSoFar: 0, proteinTarget: null, kcalTarget: 0 }),
    { protein: null, kcal: null });
  assert.deepEqual(remainingToday({ proteinSoFar: 300, kcalSoFar: 9000, proteinTarget: 180, kcalTarget: 2400 }),
    { protein: 0, kcal: 0 });
});

const saved = (over = {}) => ({
  id: 'x', name: 'Chipotle bowl', protein: 45, kcal: 700, carbs: 70, fat: 22,
  times_logged: 4, status: 'active', ...over,
});

test('rankForRemaining prefers gap-closing protein and penalizes kcal overshoot', () => {
  const remaining = { protein: 50, kcal: 650 };
  const fit = saved({ id: 'fit', protein: 48, kcal: 620 });
  const blowout = saved({ id: 'blowout', name: 'Double burger combo', protein: 55, kcal: 1600 });
  const light = saved({ id: 'light', name: 'Protein shake', protein: 26, kcal: 160 });
  const ranked = rankForRemaining([blowout, light, fit], remaining);
  assert.equal(ranked[0].item.id, 'fit');
  assert.ok(ranked.find((r) => r.item.id === 'blowout').over, 'overshoot is flagged');
});

test('rankForRemaining: verified breaks ties; no targets still ranks by protein', () => {
  const a = saved({ id: 'a' });
  const b = saved({ id: 'b', verified_at: '2026-08-01T00:00:00Z' });
  assert.equal(rankForRemaining([a, b], { protein: 50, kcal: 800 })[0].item.id, 'b');
  const ranked = rankForRemaining([saved({ id: 'hi', protein: 45 }), saved({ id: 'lo', name: 'Snack', protein: 10 })], { protein: null, kcal: null });
  assert.equal(ranked[0].item.id, 'hi');
});

test('memoryContextForAnalysis bounds, sanitizes, and orders verified/frequent first', () => {
  const places = [{ id: 'p1', name: 'Subway <script>' }];
  const items = [
    saved({ id: '1', name: 'x'.repeat(200), times_logged: 9 }),
    saved({ id: '2', name: 'Usual [order] {at} Subway', place_id: 'p1', verified_at: '2026-08-01' }),
    saved({ id: '3', name: 'Archived thing', status: 'archived' }),
    saved({ id: '4', name: 'Zeroes', protein: 0, kcal: 0 }),
  ];
  const ctx = memoryContextForAnalysis(items, places);
  assert.equal(ctx.length, 2);
  assert.equal(ctx[0].place, 'Subway script');
  assert.ok(!ctx[0].name.includes('['), 'markup stripped');
  assert.ok(ctx[0].verified);
  assert.ok(ctx[1].name.length <= 60, 'name capped');
  assert.equal(memoryContextForAnalysis(new Array(30).fill(saved()), []).length, 10, 'hard cap of 10');
});

test('itemFromMeal carries components and picks the basis honestly', () => {
  const meta = {
    name: 'Shake + omelet', protein: 60, kcal: 700, carbs: 30, fat: 25, fiber: 2,
    detectedRich: [
      { name: 'Core Power 42g', brand: 'Fairlife', product: 'Core Power 42g chocolate', protein: 42, kcal: 230, carbs: 9, fat: 4, basis: 'label' },
      { name: 'Omelet', protein: 18, kcal: 470, carbs: 21, fat: 21, basis: 'database' },
    ],
  };
  const it = itemFromMeal(meta);
  assert.equal(it.basis, 'database', 'all label/database components → database trust');
  assert.equal(it.items.length, 2);
  assert.equal(it.items[0].brand, 'Fairlife');
  const est = itemFromMeal({ ...meta, detectedRich: [{ name: 'Plate', protein: 30, kcal: 500, carbs: 40, fat: 15, basis: 'estimate' }] });
  assert.equal(est.basis, 'confirmed');
  assert.equal(itemFromMeal(null), null);
});

test('cleanText strips markup and caps; dominantBrand picks the modal brand', () => {
  assert.equal(cleanText('  a<b>{c}[d]  e  '), 'abcd e');
  assert.equal(cleanText('x'.repeat(100), 10), 'x'.repeat(10));
  assert.equal(dominantBrand([{ brand: 'Fairlife' }, { brand: 'Fairlife' }, { brand: 'Gatorade' }]), 'Fairlife');
  assert.equal(dominantBrand([]), null);
});
