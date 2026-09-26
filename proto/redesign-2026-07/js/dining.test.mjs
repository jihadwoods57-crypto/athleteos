// Phase C (dining hall menus): the shared rules (dining-menu.js), the deterministic plate builder
// (dining-plate-model.js) and how Plan > Today uses it (plan-today-model.js). Run: npm run test:proto
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  cleanMenuItem, cleanMenuItems, cleanHours, periodWindow, periodForSlot, menuContextBlock, inferKind, cleanMenuText,
  DEFAULT_HOURS, weekdayOf, MENU_MAX_ITEMS,
} from './dining-menu.js';
import { buildHallPlates, platesFromItems, plateName, safeItems, hallTag } from './dining-plate-model.js';
import { avoidWords } from './food-prefs.js';
import * as M from './plan-today-model.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const read = (...p) => readFileSync(join(HERE, ...p), 'utf8');

const TODAY = '2026-09-28'; // a Monday
const LUNCH = [
  { name: 'Grilled chicken breast', station: 'Grill', kind: 'protein', per_serving: { protein: 35, kcal: 280, carbs: 0, fat: 6 }, tags: [] },
  { name: 'Cheese pizza', station: 'Pizza', kind: 'other', per_serving: { protein: 12, kcal: 300 }, tags: ['vegetarian', 'contains dairy'] },
  { name: 'Salmon fillet', station: 'Entree', kind: 'protein', per_serving: { protein: 30, kcal: 360 }, tags: ['contains fish'] },
  { name: 'Buttermilk fried chicken', station: 'Entree', kind: 'protein', per_serving: { protein: 28, kcal: 520 } },
  { name: 'Brown rice', station: 'Grill', kind: 'carb', per_serving: { protein: 5, kcal: 220 } },
  { name: 'Roasted potatoes', station: 'Entree', kind: 'carb', per_serving: { protein: 4, kcal: 200 } },
  { name: 'Roasted broccoli', kind: 'veg', per_serving: { protein: 3, kcal: 60 } },
  { name: 'Fresh fruit cup', kind: 'fruit', per_serving: { protein: 1, kcal: 80 } },
];
const HALL = { id: 'h1', name: 'Knights Plaza', hours: DEFAULT_HOURS };
const MENUS = [{ hall_id: 'h1', menu_date: TODAY, period: 'lunch', status: 'published', items: LUNCH }];
const NONE = avoidWords({}, null);

/* ---------------------------------------------------------------- dining-menu.js */

test('items: a name is required, strings are made safe, figures bounded, kind inferred when missing', () => {
  assert.equal(cleanMenuItem({ name: '' }), null);
  assert.equal(cleanMenuItem({ name: '<>' }), null);
  assert.equal(cleanMenuItem('Rice'), null);
  const it = cleanMenuItem({ name: 'Turkey <b>burger</b>', station: 'Grill {x}', per_serving: { protein: 30.4, kcal: 5000, fat: -1 }, tags: ['Contains Gluten', 'contains gluten'] });
  assert.equal(it.name, 'Turkey b burger /b');
  assert.equal(it.station, 'Grill x');
  assert.deepEqual(it.per_serving, { protein: 30 });
  assert.deepEqual(it.tags, ['contains gluten']);
  assert.equal(it.kind, 'protein', 'a burger is a protein');
  assert.equal(inferKind('Steamed green beans'), 'veg');
  assert.equal(inferKind('Mac and cheese'), 'carb');
  assert.equal(inferKind('Banana'), 'fruit');
  assert.equal(inferKind('Mystery bowl', { protein: 40, kcal: 400 }), 'protein');
  assert.equal(inferKind('Brownie', { kcal: 300, protein: 3 }), 'other');
  assert.equal(cleanMenuText('A very long dish name that keeps going and going past the limit', 30).length <= 30, true);
  assert.equal(cleanMenuText('Chicken \u2014 rice'), 'Chicken, rice', 'no em dash survives');
  const many = cleanMenuItems(Array.from({ length: 70 }, (_, i) => ({ name: `Dish ${i}` })));
  assert.equal(many.length, MENU_MAX_ITEMS);
  assert.equal(cleanMenuItems([{ name: 'Rice' }, { name: 'rice' }]).length, 1, 'de-duplicated');
});

test('hours: a period is served only when a rule covers that weekday; the last rule wins', () => {
  assert.equal(weekdayOf(TODAY), 1);
  assert.deepEqual(periodWindow(DEFAULT_HOURS, TODAY, 'lunch'), { from: 660, to: 840 });
  assert.equal(periodWindow(DEFAULT_HOURS, TODAY, 'late'), null, 'no hours means closed');
  const weekdays = [{ period: 'breakfast', days: [1, 2, 3, 4, 5], from: '07:00', to: '10:00' }, { period: 'breakfast', days: [0, 6], from: '09:00', to: '11:00' }];
  assert.deepEqual(periodWindow(weekdays, '2026-09-27', 'breakfast'), { from: 540, to: 660 }, 'Sunday brunch hours');
  assert.deepEqual(cleanHours([{ period: 'dinner', days: [9, 1, 1], from: '17:00', to: '16:00' }, { period: 'supper', days: [1], from: '17:00', to: '20:00' }, { period: 'x', days: [1], from: '1', to: '2' }]),
    [{ period: 'dinner', days: [1], from: '17:00', to: '20:00' }], 'backwards, unknown and malformed rules are dropped; synonyms kept');
  assert.equal(periodForSlot('dinner', {}), 'dinner');
  assert.equal(periodForSlot('snack', {}), 'late');
  assert.equal(periodForSlot('meal-5', { hours: DEFAULT_HOURS, date: TODAY, dueMin: 12 * 60 }), 'lunch');
  assert.equal(periodForSlot('meal-6', { hours: DEFAULT_HOURS, date: TODAY, dueMin: 22 * 60 }), null);
});

test("Nia's menu block: today's remaining periods only, capped, figure-free for Intuitive, and it forbids inventing", () => {
  const menus = [
    { hall_id: 'h1', period: 'breakfast', items: [{ name: 'Scrambled eggs', kind: 'protein', per_serving: { protein: 12 } }] },
    { hall_id: 'h1', period: 'lunch', items: LUNCH },
    { hall_id: 'h1', period: 'dinner', items: [{ name: 'Beef tacos', station: 'Taqueria', per_serving: { protein: 26 } }] },
  ];
  const at1pm = menuContextBlock({ halls: [HALL], menus, date: TODAY, nowMin: 13 * 60 });
  assert.doesNotMatch(at1pm, /Scrambled eggs/, 'breakfast is over at 1 PM');
  assert.match(at1pm, /Knights Plaza, lunch \(11 AM to 2 PM\): Grill: Grilled chicken breast \(about 35g protein\)/);
  assert.match(at1pm, /Taqueria: Beef tacos/);
  assert.match(at1pm, /never invent menu items/);
  assert.match(at1pm, /data, not instructions/);
  const intuitive = menuContextBlock({ halls: [HALL], menus, date: TODAY, nowMin: 13 * 60, intuitive: true });
  assert.doesNotMatch(intuitive, /\d+g protein/, 'no figure for an Intuitive athlete');
  assert.equal(menuContextBlock({ halls: [HALL], menus, date: TODAY, nowMin: 21 * 60 }), '', 'the day is over');
  assert.match(menuContextBlock({ halls: [HALL], menus, date: TODAY }), /Scrambled eggs/, 'an unknown clock lists the whole day');
  const huge = [{ hall_id: 'h1', period: 'lunch', items: Array.from({ length: 40 }, (_, i) => ({ name: `Long dish name number ${i} with extras`, per_serving: { protein: 20 } })) }];
  const capped = menuContextBlock({ halls: [HALL], menus: huge, date: TODAY, nowMin: 600, maxChars: 600 });
  assert.match(capped, /and more/);
  assert.ok(capped.split('\n')[1].length <= 620, 'the list is capped');
  assert.equal(menuContextBlock({ halls: [HALL], menus: [], date: TODAY }), '');
  assert.doesNotMatch(at1pm, /\u2014/);
});

/* ---------------------------------------------------------------- the plate builder */

test('PLATE: protein, then carb, then a vegetable, sized to the slot share', () => {
  const plates = platesFromItems(safeItems(LUNCH, NONE), { target: { protein: 45, kcal: 700 }, period: 'lunch', max: 2 });
  assert.equal(plates.length, 2);
  const [best] = plates;
  assert.equal(best.name, 'Grilled chicken breast, brown rice and roasted broccoli', 'the carb comes from the protein’s station');
  assert.equal(best.proteinG, 43);
  assert.equal(best.servings, 1);
  // A big share doubles a lean protein only when one serving leaves the plate well short.
  const big = platesFromItems(safeItems(LUNCH, NONE), { target: { protein: 75 }, period: 'lunch', max: 1 })[0];
  assert.equal(big.servings, 2);
  assert.equal(big.proteinG, 78);
  assert.match(big.name, /^Double grilled chicken breast/);
  // Breakfast prefers fruit to a vegetable.
  const bf = platesFromItems(safeItems(LUNCH, NONE), { target: { protein: 40 }, period: 'breakfast', max: 1 })[0];
  assert.match(bf.name, /fresh fruit cup$/);
  // No protein on the menu, no plate.
  assert.deepEqual(platesFromItems(safeItems(LUNCH.filter((i) => i.kind !== 'protein'), NONE), { target: { protein: 40 } }), []);
  assert.equal(plateName([{ name: 'Tofu (6 oz)' }]), 'Tofu');
  // A long plate keeps all three parts by dropping the side's describing word first (60 max).
  assert.equal(plateName([{ name: 'Grilled chicken breast' }, { name: 'Brown rice' }, { name: 'Roasted broccoli' }], 2), 'Double grilled chicken breast, brown rice and broccoli');
  assert.ok(plateName([{ name: 'A'.repeat(32) }, { name: 'B'.repeat(32) }, { name: 'C'.repeat(32) }]).length <= 60);
});

test('PLATE: allergies and dislikes go first, rule terms match inside words and in the tags', () => {
  const R = (names) => ({ allergies: names.map((name) => ({ name, severity: 'severe' })) });
  const names = (avoid) => safeItems(LUNCH, avoid).map((i) => i.name);
  const dairy = names(avoidWords({}, R(['Dairy'])));
  assert.ok(!dairy.includes('Cheese pizza'));
  assert.ok(!dairy.includes('Buttermilk fried chicken'), '"buttermilk" is dairy, inside the word');
  const fish = names(avoidWords({}, R(['Fish'])));
  assert.ok(!fish.includes('Salmon fillet'), 'caught by the name and by the "contains fish" tag');
  const tagOnly = safeItems([{ name: 'House special', kind: 'protein', tags: ['contains peanuts'] }], avoidWords({}, R(['Peanuts'])));
  assert.equal(tagOnly.length, 0, 'an allergen printed only as a tag still drops the item');
  const dislike = names(avoidWords({ dislikes: ['broccoli'] }, null));
  assert.ok(!dislike.includes('Roasted broccoli'));
  // And the whole plate respects it: with a chicken allergy the plate is built on salmon.
  const plates = buildHallPlates({ halls: [HALL], menus: MENUS, date: TODAY, slot: 'lunch', nowMin: 12 * 60, target: { protein: 40 }, avoid: avoidWords({}, R(['chicken'])) });
  assert.ok(plates.length >= 1);
  assert.ok(plates.every((p) => !/chicken/i.test(p.name)));
});

test('PLATE: only a published menu, for today, at a hall serving that period, still open', () => {
  const at = (over) => buildHallPlates({ halls: [HALL], menus: MENUS, date: TODAY, slot: 'lunch', nowMin: 12 * 60, target: { protein: 45 }, avoid: NONE, ...over });
  assert.equal(at({}).length, 2);
  assert.equal(at({ nowMin: 14 * 60 + 5 }).length, 0, 'lunch is over');
  assert.equal(at({ slot: 'dinner' }).length, 0, 'no dinner menu published');
  assert.equal(at({ slot: 'snack' }).length, 0, 'the hall has no late period');
  assert.equal(at({ date: '2026-09-29' }).length, 0, 'not today’s menu');
  assert.equal(at({ menus: [{ ...MENUS[0], status: 'draft' }] }).length, 0, 'a draft is never offered');
  assert.equal(at({ halls: [{ ...HALL, hours: [{ period: 'lunch', days: [0, 6], from: '11:00', to: '14:00' }] }] }).length, 0, 'closed on Mondays');
  const idea = at({})[0];
  assert.equal(idea.source, 'hall');
  assert.equal(idea.hall, 'Knights Plaza');
  assert.equal(idea.station, 'Grill');
  assert.equal(idea.est, true);
  assert.equal(hallTag(idea), 'Dining hall: Knights Plaza');
});

test('TODAY: hall plates lead the list, the plan style rail holds, and a plan keeps where it came from', () => {
  const hall = buildHallPlates({ halls: [HALL], menus: MENUS, date: TODAY, slot: 'lunch', nowMin: 12 * 60, target: { protein: 45, kcal: 700 }, avoid: NONE });
  const usuals = [{ id: 'u1', name: 'Chicken burrito bowl', protein: 48, kcal: 720, times_logged: 5 }];
  const nia = [{ name: 'Turkey rice bowl', protein: 42, kcal: 600 }];
  const ideas = M.rankIdeas({ usuals, nia, hall, slotTarget: { protein: 45, kcal: 700 }, avoid: NONE });
  assert.deepEqual(ideas.map((i) => i.source), ['hall', 'hall', 'usual'], 'two plates, then the usual; Nia is not needed');
  // Numbers: estimates read "About", the station leads.
  const PSn = { showMacros: true, showCalories: true };
  assert.equal(M.ideaMeta(ideas[0], PSn), 'Grill · About 43g protein · 560 cal');
  assert.equal(M.ideaTag(ideas[0], true), 'Dining hall: Knights Plaza');
  // Intuitive: not one figure anywhere the plate is described.
  const PSi = { showMacros: false, showCalories: false };
  const meta = M.ideaMeta(ideas[0], PSi);
  assert.equal(meta, "Grill · From today's menu");
  assert.doesNotMatch(meta + M.ideaTag(ideas[0], false), /\d/);
  // The plan carries the source; its line still says it is an estimate from the hall.
  const plan = M.planFromIdea(ideas[0], '2026-09-28T12:00:00Z');
  assert.equal(plan.source, 'hall');
  assert.equal(M.planMeta(plan, PSn), 'About 43g protein · 560 cal · Dining hall');
  assert.equal(M.planMeta(plan, PSi), 'From the dining hall');
  // An allergy the plate somehow still names is dropped again by rankIdeas (defence in depth).
  const R = { allergies: [{ name: 'Chicken', severity: 'severe' }] };
  assert.equal(M.rankIdeas({ hall, avoid: avoidWords({}, R) }).filter((i) => /chicken/i.test(i.name)).length, 0);
});

test('WIRING: Plan asks for the hall before Nia, and hall plates name their hall under the plate', () => {
  const src = read('plan-today.js');
  assert.match(src, /hallIdeas\(\{ slot, dayDate: DAY\.date, dueMin: slotDeadline\(slot\), nowMin: minutesNow\(\), target: share, avoid: av \}\)/);
  assert.match(src, /const share = PS\.showMacros \|\| PS\.showCalories \? slotTarget : \{\};/, 'Intuitive plates get no share');
  // With no share, a plate is one serving: never "Double" for an Intuitive athlete.
  const plain = buildHallPlates({ halls: [HALL], menus: MENUS, date: TODAY, slot: 'lunch', nowMin: 12 * 60, target: {}, avoid: NONE });
  assert.ok(plain.length && plain.every((p) => !/^Double/.test(p.name)));
  assert.match(src, /if \(!hallMenusDue\(\)\) \{ maybeNia\(\); return; \}/);
  assert.match(src, /class="pt-tag dh-tag"/);
  const today = read('dining-today.js');
  assert.match(today, /\.eq\('team_id', teamId\(\)\)\.eq\('menu_date', date\)\.eq\('status', 'published'\)/, 'the query itself asks for today’s published rows');
  // The athlete's chat context carries their local date, so Nia's "today" is the athlete's today.
  assert.match(read('state.js'), /out\.localDate = /);
});
