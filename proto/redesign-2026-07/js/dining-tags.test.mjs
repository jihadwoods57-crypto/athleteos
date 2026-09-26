// Phase C review round (2026-09-26): the ONE dietary tag vocabulary and what each allergen tag
// covers; the plate filter and Nia's menu context both drop what the athlete's allergies,
// intolerances and dislikes rule out; plate wording; late hours across midnight; a week per upload.
// Run: node --test proto/redesign-2026-07/js/dining-tags.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  MENU_TAGS, TAG_KEYS, cleanTag, allergenKey, allergenKeysFrom, tagsHitAllergens, itemAllowed, cleanMenuItem,
  menuContextBlock, DEFAULT_HOURS, cleanHours, periodWindow, hmToMin, MENU_MAX_DAYS, cleanMenuEntries,
} from './dining-menu.js';
import { safeItems, plateName, buildHallPlates, planButtonLabel } from './dining-plate-model.js';
import { avoidWords, namesAny } from './food-prefs.js';
import { hoursFromForm, hoursLines } from './dining-staff-model.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..', '..');
const R = (allergies = [], intolerances = []) => ({ allergies: allergies.map((name) => ({ name, severity: 'severe' })), intolerances });
const keys = (r) => allergenKeysFrom(r);

/* ---------------------------------------------------------------- 1. the vocabulary */

test('VOCABULARY: exactly the agreed allergen tags plus the dietary markers, each with a short code', () => {
  const allergens = MENU_TAGS.filter((t) => t.covers.length).map((t) => t.key).sort();
  assert.deepEqual(allergens, ['contains dairy', 'contains eggs', 'contains fish', 'contains gluten', 'contains nuts', 'contains peanuts',
    'contains sesame', 'contains shellfish', 'contains soy', 'contains tree nuts', 'contains wheat']);
  for (const t of MENU_TAGS) assert.match(t.code, /^[a-z_]{2,12}$/, t.key);
  assert.equal(new Set(MENU_TAGS.map((t) => t.code)).size, MENU_TAGS.length, 'codes are unique');
  // "free of" markers never cover anything.
  for (const k of ['gluten free', 'dairy free', 'vegan', 'vegetarian']) assert.deepEqual(MENU_TAGS.find((t) => t.key === k).covers, [], k);
});

test('VOCABULARY: printed markers normalise onto it; anything else is dropped', () => {
  const cases = {
    'Contains Dairy': 'contains dairy', milk: 'contains dairy', 'contains milk': 'contains dairy', Lactose: 'contains dairy',
    egg: 'contains eggs', 'Contains: Eggs': 'contains eggs', peanut: 'contains peanuts', 'tree nut': 'contains tree nuts',
    'Tree Nuts': 'contains tree nuts', nuts: 'contains nuts', 'may contain nuts': 'contains nuts', soya: 'contains soy',
    wheat: 'contains wheat', gluten: 'contains gluten', sesame: 'contains sesame', crustaceans: 'contains shellfish',
    GF: 'gluten free', 'Gluten-Free': 'gluten free', 'dairy-free': 'dairy free', Vegan: 'vegan', halal: 'halal',
    dairy: 'contains dairy', treenut: null, '<img>': null, 'spicy': null, ['x'.repeat(80)]: null,
  };
  for (const [raw, want] of Object.entries(cases)) assert.equal(cleanTag(raw), want, raw);
  assert.equal(cleanTag('tree_nuts'), 'contains tree nuts', 'the tool code maps too');
  assert.deepEqual(cleanMenuItem({ name: 'Pad thai', tags: ['Contains Nuts', 'nuts', 'Spicy'] }).tags, ['contains nuts']);
});

test('ALLERGIES: every declared name lands on its canonical key', () => {
  const cases = { Dairy: 'dairy', Milk: 'dairy', 'Lactose': 'dairy', Eggs: 'egg', Egg: 'egg', Fish: 'fish', Shellfish: 'shellfish',
    Shrimp: 'shellfish', Peanuts: 'peanut', 'Peanut allergy': 'peanut', 'Tree nuts': 'tree nut', 'Tree nut': 'tree nut', Nuts: 'nuts',
    Soy: 'soy', Soya: 'soy', Wheat: 'wheat', Gluten: 'gluten', Celiac: 'gluten', Sesame: 'sesame', 'Dairy · severe': 'dairy', Kiwi: null };
  for (const [name, want] of Object.entries(cases)) assert.equal(allergenKey(name), want, name);
  assert.deepEqual([...keys(R(['Peanuts'], ['Lactose']))].sort(), ['dairy', 'peanut']);
});

/* Every tag against every allergy it must, and must not, cover. */
const MATRIX = {
  'contains dairy': ['Dairy', 'Milk', 'Lactose'],
  'contains eggs': ['Eggs', 'Egg'],
  'contains fish': ['Fish'],
  'contains shellfish': ['Shellfish', 'Shrimp'],
  'contains peanuts': ['Peanuts', 'Nuts'],
  'contains tree nuts': ['Tree nuts', 'Nuts'],
  'contains nuts': ['Peanuts', 'Tree nuts', 'Nuts'],
  'contains soy': ['Soy'],
  'contains wheat': ['Wheat', 'Gluten', 'Celiac'],
  'contains gluten': ['Gluten', 'Wheat', 'Celiac'],
  'contains sesame': ['Sesame'],
};
const ALL_NAMES = [...new Set(Object.values(MATRIX).flat())];

test('MATRIX: each allergen tag covers exactly its allergies (as an allergy AND as an intolerance)', () => {
  for (const [tag, hits] of Object.entries(MATRIX)) {
    for (const name of ALL_NAMES) {
      const want = hits.includes(name);
      assert.equal(tagsHitAllergens([tag], keys(R([name]))), want, `${tag} vs allergy ${name}`);
      assert.equal(tagsHitAllergens([tag], keys(R([], [name]))), want, `${tag} vs intolerance ${name}`);
    }
  }
  for (const free of ['gluten free', 'dairy free', 'vegan', 'vegetarian', 'halal']) {
    for (const name of ALL_NAMES) assert.equal(tagsHitAllergens([free], keys(R([name]))), false, `${free} vs ${name}`);
  }
});

test("REVIEWER'S PROBES: pad thai, alfredo, sesame, wheat", () => {
  const menu = [
    { name: 'Pad thai', kind: 'protein', tags: ['contains nuts'] },
    { name: 'Alfredo', kind: 'carb', tags: ['contains dairy'] },
    { name: 'Tahini bowl', kind: 'protein', tags: ['contains sesame'] },
    { name: 'Farro salad', kind: 'carb', tags: ['contains wheat'] },
    { name: 'Gluten-free pasta', kind: 'carb', tags: ['gluten free'] },
    { name: 'Rice bowl', kind: 'carb', tags: [] },
  ];
  const left = (r) => safeItems(menu, avoidWords({}, r), allergenKeysFrom(r)).map((i) => i.name);
  assert.ok(!left(R(['Peanuts'])).includes('Pad thai'), 'nuts tag, peanut allergy');
  assert.ok(!left(R(['Tree nuts'])).includes('Pad thai'), 'nuts tag, tree-nut allergy');
  assert.ok(!left(R(['Milk'])).includes('Alfredo'), 'dairy tag, milk allergy');
  assert.ok(!left(R([], ['Lactose'])).includes('Alfredo'), 'dairy tag, lactose intolerance');
  assert.ok(!left(R(['Sesame'])).includes('Tahini bowl'));
  assert.ok(!left(R(['Wheat'])).includes('Farro salad'));
  assert.ok(!left(R(['Gluten'])).includes('Farro salad'), 'wheat covers gluten');
  assert.ok(left(R(['Gluten'])).includes('Gluten-free pasta'), 'a "gluten free" tag and name never trigger a gluten match');
  assert.ok(left(R(['Dairy'])).includes('Rice bowl'));
  assert.deepEqual(left(R([])), menu.map((m) => m.name), 'no allergies, nothing dropped');
});

test('itemAllowed: tags, then the name (rule terms inside words), then dislikes; "X free" phrases never match', () => {
  const av = avoidWords({ dislikes: ['mushrooms'] }, R(['Dairy']));
  const al = allergenKeysFrom(R(['Dairy']));
  const ok = (it) => itemAllowed(cleanMenuItem(it), { avoid: av, allergens: al, namesAny });
  assert.equal(ok({ name: 'Buttermilk biscuits' }), false, 'dairy inside a word');
  assert.equal(ok({ name: 'Mushroom risotto' }), false, 'a dislike');
  assert.equal(ok({ name: 'Dairy-free sorbet' }), true, 'the words "dairy free" are not a dairy match');
  assert.equal(ok({ name: 'Dairy-free yogurt' }), false, 'unmarked, "yogurt" still reads as dairy (the safe direction)');
  assert.equal(ok({ name: 'Dairy-free yogurt', tags: ['dairy free'] }), true, 'a PRINTED "dairy free" marker vouches for its family');
  assert.equal(ok({ name: 'Dairy-free yogurt', tags: ['dairy free', 'contains dairy'] }), false, 'an allergen tag always wins');
  assert.equal(ok({ name: 'House salad', tags: ['contains dairy'] }), false);
  assert.equal(ok({ name: 'House salad', tags: ['dairy free'] }), true);
});

/* ---------------------------------------------------------------- 2. Nia's context */

test("NIA: the menu block drops what the athlete can't eat and shows the rest's allergen tags compactly", () => {
  const HALL = { id: 'h1', name: 'Knights Plaza', hours: DEFAULT_HOURS };
  const menus = [{ hall_id: 'h1', period: 'lunch', items: [
    { name: 'Alfredo', kind: 'carb', per_serving: { protein: 20 }, tags: ['contains dairy', 'contains wheat'] },
    { name: 'Pad thai', kind: 'protein', per_serving: { protein: 25 }, tags: ['contains nuts', 'contains soy'] },
    { name: 'Mushroom risotto', kind: 'carb', tags: [] },
    { name: 'Grilled chicken', kind: 'protein', per_serving: { protein: 35 }, tags: ['gluten free'] },
  ] }];
  const r = R(['Peanuts']);
  const keep = (it) => itemAllowed(it, { avoid: avoidWords({ dislikes: ['mushrooms'] }, r), allergens: allergenKeysFrom(r), namesAny });
  const block = menuContextBlock({ halls: [HALL], menus, date: '2026-09-28', nowMin: 600, keep });
  assert.doesNotMatch(block, /Pad thai/, 'nuts, for a peanut allergy');
  assert.doesNotMatch(block, /Mushroom/, 'a dislike');
  assert.match(block, /Alfredo \(about 20g protein; dairy, wheat\)/, 'allergen tags ride along, compactly');
  assert.match(block, /Grilled chicken \(about 35g protein\)/, 'a "free of" marker is not an allergen note');
  const intuitive = menuContextBlock({ halls: [HALL], menus, date: '2026-09-28', nowMin: 600, keep, intuitive: true });
  assert.match(intuitive, /Alfredo \(dairy, wheat\)/);
  assert.doesNotMatch(intuitive, /\d+g/);
  // The cap still holds with the tags.
  const huge = [{ hall_id: 'h1', period: 'lunch', items: Array.from({ length: 40 }, (_, i) => ({ name: `Long dish name number ${i}`, per_serving: { protein: 20 }, tags: ['contains dairy', 'contains soy'] })) }];
  const capped = menuContextBlock({ halls: [HALL], menus: huge, date: '2026-09-28', nowMin: 600 });
  assert.ok(capped.length <= 1400 + 400, 'list capped at 1400, plus the fixed header and rules');
  assert.ok(capped.split('\n')[1].length <= 1400);
});

test("NIA (server): diningContextFor filters by the athlete's own restrictions, prefs and confirmed facts", () => {
  const src = readFileSync(join(ROOT, 'supabase', 'functions', '_shared', 'dining-context.mjs'), 'utf8');
  assert.match(src, /itemAllowed\(it, \{ avoid, allergens, namesAny \}\)/);
  assert.match(src, /from\('dietary_restrictions'\)/);
  assert.match(src, /select\('food_prefs'\)/);
});

/* ---------------------------------------------------------------- 5. plate wording */

test('WORDING: a doubled protein is "2 servings of", and the button names the plate', () => {
  const parts = [{ name: 'Turkey burger' }, { name: 'Brown rice' }, { name: 'Roasted broccoli' }];
  assert.equal(plateName(parts, 2), '2 servings of turkey burger, brown rice and roasted broccoli');
  assert.equal(plateName(parts, 1), 'Turkey burger, brown rice and roasted broccoli');
  assert.doesNotMatch(plateName([{ name: 'Grilled chicken breast' }, { name: 'Brown rice' }, { name: 'Roasted broccoli' }], 2), /Double/);
  assert.ok(plateName([{ name: 'Grilled chicken breast' }, { name: 'Brown rice' }, { name: 'Roasted broccoli' }], 2).length <= 60);
  assert.equal(planButtonLabel({ source: 'hall', protein_name: 'Turkey burger' }), 'Plan the turkey burger plate');
  assert.equal(planButtonLabel({ source: 'hall', protein_name: 'Slow roasted herb crusted pork loin' }), 'Plan this plate');
  assert.equal(planButtonLabel({ source: 'hall' }), 'Plan this plate');
  const src = readFileSync(join(HERE, 'plan-today.js'), 'utf8');
  assert.match(src, /picked\.source === 'hall' \? planButtonLabel\(picked\)/);
  const plates = buildHallPlates({ halls: [{ id: 'h1', name: 'K', hours: DEFAULT_HOURS }], date: '2026-09-28', slot: 'lunch', nowMin: 700, target: { protein: 70 },
    menus: [{ hall_id: 'h1', period: 'lunch', items: [{ name: 'Turkey burger', kind: 'protein', per_serving: { protein: 28, kcal: 420 } }, { name: 'Brown rice', kind: 'carb', per_serving: { protein: 5, kcal: 220 } }] }] });
  assert.equal(plates[0].name, '2 servings of turkey burger and brown rice');
  assert.equal(plates[0].protein_name, 'Turkey burger');
});

/* ---------------------------------------------------------------- minors: midnight, a week */

test('HOURS: a late period may cross midnight (the end is the next day)', () => {
  const h = cleanHours([{ period: 'late', days: [5], from: '21:00', to: '01:00' }, { period: 'lunch', days: [5], from: '14:00', to: '11:00' }]);
  assert.deepEqual(h, [{ period: 'late', days: [5], from: '21:00', to: '01:00' }], 'only late may wrap');
  assert.deepEqual(periodWindow(h, '2026-10-02', 'late'), { from: 21 * 60, to: 25 * 60 });
  assert.deepEqual(hoursLines(h), ['Late or grab-and-go · Fri · 9 PM to 1 AM']);
  assert.deepEqual(hoursFromForm([{ period: 'late', on: true, from: '21:00', to: '01:00', days: [5] }]).hours, h);
  assert.match(hoursFromForm([{ period: 'dinner', on: true, from: '21:00', to: '01:00', days: [5] }]).error, /Dinner has to end after it starts/);
  assert.equal(hmToMin('24:00'), null);
});

test('A WEEK PER UPLOAD: at most 7 days from the start', () => {
  assert.equal(MENU_MAX_DAYS, 7);
  const raw = Array.from({ length: 10 }, (_, i) => ({ date: `2026-10-0${i}`.replace('2026-10-00', '2026-09-30'), period: 'lunch', items: [{ name: `Dish ${i}` }] }));
  const out = cleanMenuEntries(raw, { startDate: '2026-09-30' });
  assert.equal(out.length, 7);
  assert.equal(out[out.length - 1].date, '2026-10-06');
});

test('the vocabulary is the database vocabulary (0255 dining_items_ok)', () => {
  const sql = readFileSync(join(ROOT, 'supabase', 'migrations', '0255_dining_halls.sql'), 'utf8');
  const m = /v_tags constant text\[\] := array\[([^\]]*)\]/.exec(sql);
  assert.ok(m, 'the migration lists the tag vocabulary');
  assert.deepEqual(m[1].split(',').map((x) => x.trim().replace(/'/g, '')).sort(), [...TAG_KEYS].sort());
});
