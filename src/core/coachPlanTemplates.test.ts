/**
 * Standards editor: preview-as-athlete + template application (Task 6, Slice C).
 *
 * Same JSDOM-globals-before-lazy-require preamble as coachPlanKnobs.test.ts — coach.js's
 * import chain pulls in state.js, whose `export const RT = load()` reads localStorage at
 * MODULE LOAD TIME, so the globals must exist before the module graph evaluates.
 */
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost' });
(globalThis as any).window = dom.window;
(globalThis as any).document = dom.window.document;
(globalThis as any).localStorage = dom.window.localStorage;
(globalThis as any).MouseEvent = dom.window.MouseEvent;

// Lazy CJS require so the globals above exist before the proto module graph evaluates.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { previewFromKnobs, knobsFromItems } = require('../../proto/redesign-2026-07/js/screens/coach.js');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { seedTemplates } = require('../../proto/redesign-2026-07/js/templates.js');

test('previewFromKnobs renders the DRAFT through the same path as the athlete day', () => {
  const k = {
    key: 'team:', meals: 2, lifts: 0, weigh: 'off', hydration: false, hydrationOz: 120,
    recovery: false, checkin: false, photoProof: true,
    mealNames: ['A', 'B'], mealWins: [{ open: 400, due: 500 }, { open: 1000, due: 1100 }],
  };
  const p = previewFromKnobs(k)!;
  expect(p.std.mealsRequired).toBe(2);
  expect(p.std.titles[p.std.slots[0]]).toBe('A');
  expect(p.std.deadlines[p.std.slots[1]]).toBe(1100);
});

test('previewFromKnobs returns null when there are no meal items (never a fabricated card)', () => {
  const k = {
    key: 'team:', meals: 0, lifts: 0, weigh: 'off', hydration: false, hydrationOz: 120,
    recovery: false, checkin: false, photoProof: true, mealNames: [], mealWins: [],
  };
  expect(previewFromKnobs(k)).toBeNull();
});

test('applying a template = knobsFromItems over its items (no special path)', () => {
  const game = seedTemplates().find((s: any) => s.kind === 'game_week');
  const k = knobsFromItems(game.items);
  expect(k.meals).toBe(3);
  expect(k.mealWins.length).toBe(3);
});

test('every seed template round-trips through knobsFromItems -> itemsFromKnobs -> previewFromKnobs', () => {
  // Guards against a seed shape that would blow up the standards editor when applied.
  const { itemsFromKnobs } = require('../../proto/redesign-2026-07/js/screens/coach.js');
  for (const tpl of seedTemplates()) {
    const k = { key: 'team:', ...knobsFromItems(tpl.items) };
    const preview = previewFromKnobs(k);
    expect(preview).not.toBeNull();
    expect(preview!.std.mealsRequired).toBe(k.meals);
    // itemsFromKnobs(knobsFromItems(items)) preserves the meal count (the one thing a
    // coach applying a template must be able to trust).
    expect(itemsFromKnobs(k).filter((i: any) => i.kind === 'meal').length).toBe(k.meals);
  }
});
