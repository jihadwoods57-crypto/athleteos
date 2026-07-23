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

describe('snack-optional round-trip (0086 item.snack)', () => {
  const four = { ...base, meals: 4, mealNames: undefined, mealWins: undefined };
  test('snackOptional true marks the snack-slot meal (index 3 — the 4th meal) as a snack', () => {
    const meals = itemsFromKnobs({ ...four, snackOptional: true }).filter((i: any) => i.kind === 'meal');
    expect(meals.length).toBe(4);
    // A 4-meal day reads Breakfast / Lunch / Dinner / Snack, so the SNACK is the bonus slot.
    expect(meals.map((m: any) => m.title)).toEqual(['Breakfast', 'Lunch', 'Dinner', 'Snack']);
    expect(meals[3].snack).toBe(true);
    expect(meals[2].snack).toBeUndefined();   // regression guard: Dinner must never be the optional one
    expect(meals[0].snack).toBeUndefined();
  });
  test('PARITY: snackOptional false writes no snack flag on any meal', () => {
    const meals = itemsFromKnobs({ ...four, snackOptional: false }).filter((i: any) => i.kind === 'meal');
    expect(meals.some((m: any) => m.snack)).toBe(false);
  });
  test('below 4 meals the flag is ignored (no snack slot)', () => {
    const meals = itemsFromKnobs({ ...base, meals: 3, mealNames: undefined, mealWins: undefined, snackOptional: true }).filter((i: any) => i.kind === 'meal');
    expect(meals.some((m: any) => m.snack)).toBe(false);
  });
  test('knobsFromItems reads snackOptional back from the saved standard', () => {
    const items = itemsFromKnobs({ ...four, snackOptional: true });
    expect(knobsFromItems(items).snackOptional).toBe(true);
    const plain = itemsFromKnobs({ ...four, snackOptional: false });
    expect(knobsFromItems(plain).snackOptional).toBe(false);
  });
});

describe('per-meal proof (Tier 2)', () => {
  test('mixed per-meal proofs write per meal and round-trip', () => {
    const meals = itemsFromKnobs({ ...base, mealProofs: ['photo', 'check', 'photo'] }).filter((i: any) => i.kind === 'meal');
    expect(meals.map((m: any) => m.proof)).toEqual(['photo', 'check', 'photo']);
    const k = knobsFromItems(meals);
    expect(k.mealProofs).toEqual(['photo', 'check', 'photo']);
    expect(k.photoProof).toBe(false); // "all photo?" summary is false when any meal is check
  });
  test('mealProofs takes precedence; an all-photo plate keeps photoProof true', () => {
    const k = knobsFromItems(itemsFromKnobs({ ...base, mealProofs: ['photo', 'photo', 'photo'] }));
    expect(k.photoProof).toBe(true);
  });
  test('PARITY: absent mealProofs falls back to photoProof for every meal', () => {
    const meals = itemsFromKnobs({ ...base, mealProofs: undefined, photoProof: false }).filter((i: any) => i.kind === 'meal');
    expect(meals.every((m: any) => m.proof === 'check')).toBe(true);
  });
});

describe('per-meal training/rest tagging (Tier 2, 0086 item.dayType)', () => {
  test('a tagged meal writes dayType; round-trips through knobsFromItems', () => {
    const meals = itemsFromKnobs({ ...base, mealDayTypes: ['any', 'training', 'rest'] }).filter((i: any) => i.kind === 'meal');
    expect(meals[0]).not.toHaveProperty('dayType'); // 'any' stays untagged
    expect(meals[1].dayType).toBe('training');
    expect(meals[2].dayType).toBe('rest');
    expect(knobsFromItems(meals).mealDayTypes).toEqual(['any', 'training', 'rest']);
  });
  test('PARITY: an all-any standard writes NO dayType key on any meal (byte-identical to before)', () => {
    const meals = itemsFromKnobs({ ...base, mealDayTypes: ['any', 'any', 'any'] }).filter((i: any) => i.kind === 'meal');
    expect(meals.some((m: any) => 'dayType' in m)).toBe(false);
    expect(knobsFromItems(meals).mealDayTypes).toEqual(['any', 'any', 'any']);
  });
});

describe('arbitrary weigh cadence (Tier 2)', () => {
  test('custom weekdays write a days-freq and round-trip as custom', () => {
    const weigh = itemsFromKnobs({ ...base, weigh: 'custom', weighDays: [2, 4] }).find((i: any) => i.kind === 'weigh');
    expect(weigh.freq).toMatchObject({ type: 'days', days: [2, 4] });
    expect(weigh.freq.label).toBe('Tue / Thu');
    const k = knobsFromItems([weigh]);
    expect(k.weigh).toBe('custom');
    expect(k.weighDays).toEqual([2, 4]);
  });
  test('daily and off round-trip', () => {
    expect(knobsFromItems(itemsFromKnobs({ ...base, weigh: 'daily' })).weigh).toBe('daily');
    expect(itemsFromKnobs({ ...base, weigh: 'off' }).some((i: any) => i.kind === 'weigh')).toBe(false);
    expect(knobsFromItems(itemsFromKnobs({ ...base, weigh: 'off' })).weigh).toBe('off');
  });
  test('a legacy MWF standard reads back as custom with M/W/F selected', () => {
    const legacy = [{ id: 'weight', title: 'Morning Weight', kind: 'weigh', proof: 'scale', freq: { type: 'days', days: [1, 3, 5], label: 'Mon / Wed / Fri' }, window: { due: 540 } }];
    const k = knobsFromItems(legacy);
    expect(k.weigh).toBe('custom');
    expect(k.weighDays).toEqual([1, 3, 5]);
  });
  test('days are de-duped, range-clamped, and sorted', () => {
    const weigh = itemsFromKnobs({ ...base, weigh: 'custom', weighDays: [5, 1, 5, 9, -1, 3] }).find((i: any) => i.kind === 'weigh');
    expect(weigh.freq.days).toEqual([1, 3, 5]);
  });
});
