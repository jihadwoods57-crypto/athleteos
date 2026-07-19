/**
 * Standards editor knob<->item converters (proto/redesign-2026-07/js/screens/coach.js).
 *
 * coach.js's import chain pulls in state.js, whose `export const RT = load()` reads
 * localStorage at MODULE LOAD TIME — so, per the wireTogglesCapture.test.ts pattern, we
 * build a real DOM with the jsdom package and install window/document/localStorage globals
 * BEFORE lazily requiring the screen module. (src/core/coachPlan.test.ts, despite the name,
 * tests the unrelated src/core/coachPlan.ts keystone and does not import proto screens at
 * all — it doesn't establish an import pattern for this file; wireTogglesCapture.test.ts
 * is the actual precedent for pulling in a proto/screens module under Jest.)
 *
 * Runs under the default node environment (jest-environment-jsdom v29 is incompatible with
 * this repo's jest 30 runtime).
 */
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost' });
(globalThis as any).window = dom.window;
(globalThis as any).document = dom.window.document;
(globalThis as any).localStorage = dom.window.localStorage;
(globalThis as any).MouseEvent = dom.window.MouseEvent;

// Lazy CJS require so the globals above exist before the proto module graph evaluates.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { itemsFromKnobs, knobsFromItems } = require('../../proto/redesign-2026-07/js/screens/coach.js');

const base = {
  key: 'team:', meals: 3, lifts: 0, weigh: 'off', hydration: true, hydrationOz: 120,
  recovery: true, checkin: true, photoProof: true,
  mealNames: ['First Fuel', 'Lunch', 'Dinner'],
  mealWins: [{ open: 360, due: 540 }, { open: 720, due: 840 }, { open: 1080, due: 1230 }],
};

test('itemsFromKnobs carries custom names, windows, photo proof, hydration target', () => {
  const items = itemsFromKnobs(base);
  const meals = items.filter((i: any) => i.kind === 'meal');
  expect(meals.length).toBe(3);
  expect(meals[0]).toMatchObject({ id: 'meal-1', title: 'First Fuel', proof: 'photo', window: { open: 360, due: 540 } });
  const hyd = items.find((i: any) => i.kind === 'hydration');
  expect(hyd).toMatchObject({ target: 120, required: false });
  expect(hyd.title).toBe('Hydration · 120 oz');
});

test('photoProof=false downgrades meal proof to check', () => {
  const meals = itemsFromKnobs({ ...base, photoProof: false }).filter((i: any) => i.kind === 'meal');
  expect(meals.every((m: any) => m.proof === 'check')).toBe(true);
});

test('knobsFromItems round-trips names, windows, photo flag and target', () => {
  const k = knobsFromItems(itemsFromKnobs(base));
  expect(k.mealNames).toEqual(['First Fuel', 'Lunch', 'Dinner']);
  expect(k.mealWins).toEqual(base.mealWins);
  expect(k.photoProof).toBe(true);
  expect(k.hydrationOz).toBe(120);
});

test('Part B rails: grace, late policy, and coach review round-trip through items', () => {
  const meals = itemsFromKnobs({ ...base, grace: 30, latePolicy: 'none', coachReview: true }).filter((i: any) => i.kind === 'meal');
  expect(meals.every((m: any) => m.grace === 30 && m.latePolicy === 'none' && m.coachReview === true)).toBe(true);
  const k = knobsFromItems(meals);
  expect(k.grace).toBe(30);
  expect(k.latePolicy).toBe('none');
  expect(k.coachReview).toBe(true);
});

test('Part B defaults are omitted from items so existing standards stay byte-identical', () => {
  const meals = itemsFromKnobs({ ...base, grace: 0, latePolicy: 'half', coachReview: false }).filter((i: any) => i.kind === 'meal');
  meals.forEach((m: any) => {
    expect(m).not.toHaveProperty('grace');
    expect(m).not.toHaveProperty('latePolicy');
    expect(m).not.toHaveProperty('coachReview');
  });
  const k = knobsFromItems(meals); // defaults read back
  expect(k).toMatchObject({ grace: 0, latePolicy: 'half', coachReview: false });
});

test('legacy items (no custom fields) produce sane defaults', () => {
  const k = knobsFromItems([
    { id: 'meal-1', title: 'Breakfast', kind: 'meal', proof: 'photo', freq: { type: 'daily' }, window: { open: 420, due: 570 } },
    { id: 'hydration', title: 'Hydration · 120 oz', kind: 'hydration', proof: 'counter', freq: { type: 'daily' }, window: { due: 1290 }, required: false },
  ]);
  expect(k.meals).toBe(1);
  expect(k.mealNames).toEqual(['Breakfast']);
  expect(k.hydrationOz).toBe(120);
  expect(k.photoProof).toBe(true);
});

test('meal-count change resets names/windows to defaults for the new count', () => {
  // Editor rule: when KNOB.meals changes, mealNames/mealWins re-derive (documented behavior).
  const items = itemsFromKnobs({ ...base, meals: 2, mealNames: undefined, mealWins: undefined });
  const meals = items.filter((i: any) => i.kind === 'meal');
  expect(meals.map((m: any) => m.title)).toEqual(['Breakfast', 'Dinner']);
});
