/* Plan > Today (goals and eating plan, phase A1, 2026-09-25).
 *
 * What this pins, in the order the spec's "Done means" lists it:
 *   1. the slot and target math, and that it is meal-opener's own ("Land around Xg at each of your
 *      last N meals"): the plan and the thread may never disagree about the next meal;
 *   2. plans are stored on the day and NO scoring path reads them (the device engine, the history
 *      reconstruction, and the server ceiling's SQL);
 *   3. the idea ranking (usuals first, dislikes and allergies out, Nia fills to three) and the
 *      per-athlete, per-day, per-slot cache;
 *   4. the Intuitive and minor gates on everything Today prints;
 *   5. the planned-meal hint carries a NAME only.
 * Run: node --test proto/redesign-2026-07/js/plan-today.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const read = (...p) => readFileSync(join(HERE, ...p), 'utf8');

/* ---- the same minimal browser the intuitive-surface tests stand up ---- */
const el = () => ({
  style: { setProperty() {}, removeProperty() {} },
  classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
  setAttribute() {}, getAttribute: () => null, addEventListener() {},
  querySelectorAll: () => [], querySelector: () => null, appendChild() {}, remove() {}, insertAdjacentHTML() {},
});
const mem = new Map();
const fakeStore = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) };
globalThis.window = {
  location: { hash: '' }, addEventListener() {},
  matchMedia: () => ({ matches: false, addEventListener() {}, addListener() {} }),
  __render: () => {}, localStorage: fakeStore,
};
globalThis.document = Object.assign(el(), { createElement: el, getElementById: () => null, documentElement: el(), body: el(), head: el() });
globalThis.localStorage = fakeStore;
globalThis.sessionStorage = { getItem: () => null, setItem() {}, removeItem() {} };
globalThis.location = globalThis.window.location;

const { S, RT } = await import('./state.js');
const day = await import('./day.js');
const { DAY } = day;
const M = await import('./plan-today-model.js');
const F = await import('./food-prefs.js');
const PT = await import('./plan-today.js');
const { warmFoodMemory } = await import('./food-memory-data.js');
const { composeOpener, perMealProtein } = await import('../../../supabase/functions/_shared/meal-opener.ts');
const { openingMessage } = await import('./meal-intel.js');

const classic = M.slotOrder(null);
const blankDay = () => ({ breakfast: false, lunch: false, dinner: false, snack: false });

/* ---------------------------------------------------------------- 1. slots and targets */

test('the classic day: three required meals, snack last and optional', () => {
  assert.deepEqual(classic.required, ['breakfast', 'lunch', 'dinner']);
  assert.deepEqual(classic.all, ['breakfast', 'lunch', 'dinner', 'snack']);
});

test("a coach standard's slots are all required, and the snack still goes last", () => {
  const o = M.slotOrder({ slots: ['breakfast', 'lunch', 'snack', 'dinner'] });
  assert.deepEqual(o.all, ['breakfast', 'lunch', 'dinner', 'snack']);
  assert.deepEqual(o.required, ['breakfast', 'lunch', 'snack', 'dinner']);
  assert.deepEqual(M.slotOrder({ slots: ['meal-1', 'meal-2', 'meal-3', 'meal-4', 'meal-5'] }).all, ['meal-1', 'meal-2', 'meal-3', 'meal-4', 'meal-5']);
});

test('PARITY: the per-meal share IS meal-opener perMealProtein, for every gap and meal count', () => {
  for (let gap = 1; gap <= 300; gap++) {
    for (let r = 2; r <= 6; r++) assert.equal(M.perMealShare(gap, r), perMealProtein(gap, r), `gap ${gap}, ${r} meals`);
    assert.equal(M.perMealShare(gap, 1), gap, 'one meal left carries the whole gap, as the opener says');
  }
  assert.equal(M.perMealShare(0, 3), 0);
  assert.equal(M.perMealShare(-20, 3), 0);
});

test('PARITY: the number Plan shows for the next meal is the number Nia says in the thread', () => {
  for (const [soFar, target, rem] of [[60, 180, 3], [0, 180, 3], [100, 200, 2], [150, 180, 1], [37, 163, 3]]) {
    const meals = blankDay();
    const logged = 3 - rem;
    classic.required.slice(0, logged).forEach((k) => { meals[k] = true; });
    const T = M.buildToday({ order: classic, meals, target: { protein: target, kcal: 3000 }, consumed: { protein: soFar, kcal: 0 }, nowMin: 0 });
    assert.equal(T.mealsRemaining, rem);
    const server = composeOpener({ analysis: 'Solid plate.' }, { day: { proteinIncludingThisMeal: soFar, proteinTarget: target, mealsRemaining: rem } }).text;
    const client = openingMessage({ analysis: 'Solid plate.', day: { proteinSoFar: soFar, proteinTarget: target, mealsRemaining: rem } });
    if (rem > 1) {
      assert.match(server, new RegExp(`Land around \\*\\*${T.slotTarget.protein}g of protein\\*\\* at each of your last ${rem} meals`));
      assert.match(client, new RegExp(`Land around ${T.slotTarget.protein}g of protein at each of your last ${rem} meals`));
    } else {
      assert.match(server, new RegExp(`around \\*\\*${T.slotTarget.protein}g of protein\\*\\*`));
    }
  }
});

test('up next: the first required meal still on time, else the first one still open (late counts)', () => {
  const due = (k) => ({ breakfast: 570, lunch: 840, dinner: 1230, snack: 1020 })[k];
  const meals = blankDay();
  let T = M.buildToday({ order: classic, meals, deadline: due, nowMin: 600 });
  assert.equal(T.upNext, 'lunch', 'breakfast closed at 9:30, lunch is the live window');
  assert.deepEqual(T.later, ['breakfast', 'dinner', 'snack']);
  assert.equal(T.slots.find((s) => s.key === 'breakfast').late, true);
  T = M.buildToday({ order: classic, meals, deadline: due, nowMin: 1300 });
  assert.equal(T.upNext, 'breakfast', 'every window closed: the first open required meal, late still counts');
  T = M.buildToday({ order: classic, meals, deadline: due, nowMin: 600, focus: 'snack', target: { protein: 180, kcal: 3000 }, consumed: { protein: 40 } });
  assert.equal(T.upNext, 'snack', 'a tapped later slot takes the card');
  assert.equal(T.slotTarget.protein, null, 'an optional snack never carries the whole day while required meals remain');
});

test('every required meal in: the snack is up and carries the whole gap; everything in: nothing is up', () => {
  const meals = { breakfast: true, lunch: true, dinner: true, snack: false };
  let T = M.buildToday({ order: classic, meals, target: { protein: 180, kcal: 3000 }, consumed: { protein: 140, kcal: 2500 } });
  assert.equal(T.allRequiredIn, true);
  assert.equal(T.upNext, 'snack');
  assert.equal(T.slotTarget.protein, 40);
  assert.equal(T.slotTarget.kcal, 500);
  T = M.buildToday({ order: classic, meals: { ...meals, snack: true }, target: { protein: 180 }, consumed: { protein: 190 } });
  assert.equal(T.upNext, null);
  assert.equal(T.allIn, true);
  assert.equal(T.left.protein, 0, 'over target is met, never negative');
});

test('a duplicate photo does not count as a meal in: it stays in the remaining count, like the score', () => {
  const meals = { breakfast: true, lunch: false, dinner: false, snack: false };
  const T = M.buildToday({ order: classic, meals, scored: (k) => k !== 'breakfast' && !!meals[k], target: { protein: 180 }, consumed: { protein: 0 } });
  assert.equal(T.mealsRemaining, 3);
});

test('calories split the same way, rounded to 50', () => {
  const T = M.buildToday({ order: classic, meals: blankDay(), target: { protein: 180, kcal: 3200 }, consumed: { protein: 0, kcal: 0 } });
  assert.equal(T.slotTarget.protein, 60);
  assert.equal(T.slotTarget.kcal, M.perMealShare(3200, 3, 50));
  assert.equal(T.slotTarget.kcal % 50, 0);
});

test('mealsRemaining is the SAME count S.mealDayProgress hands the opener', () => {
  RT.stdMeals = null;
  Object.assign(DAY.meals, { breakfast: true, lunch: false, dinner: false, snack: true });
  DAY.slotMacros = { breakfast: { protein: 40, kcal: 500 }, snack: { protein: 20, kcal: 200 } };
  const T = M.buildToday({ order: M.slotOrder(RT.stdMeals), meals: DAY.meals, scored: (k) => day.mealScored(DAY, k), target: { protein: 180 }, consumed: S.dayConsumed });
  assert.equal(T.mealsRemaining, S.mealDayProgress.mealsRemaining);
  assert.equal(T.left.protein, S.mealDayProgress.proteinTarget - S.mealDayProgress.proteinSoFar);
});

/* ---------------------------------------------------------------- 2. plans never score */

test('a plan is stored on the day and synced inside checkin, and the score ignores it', () => {
  Object.assign(DAY.meals, { breakfast: true, lunch: true, dinner: false, snack: false });
  DAY.slotMacros = { breakfast: { protein: 40, kcal: 600, quality: 80 }, lunch: { protein: 45, kcal: 700, quality: 82 } };
  DAY.plans = {};
  const before = day.clampedScore(DAY);
  const comps = JSON.stringify(day.computeComponents(DAY));
  DAY.plans = { dinner: M.planFromIdea({ name: 'Chicken burrito bowl', protein: 60, kcal: 900, source: 'usual' }, '2026-09-25T18:00:00Z') };
  assert.equal(day.clampedScore(DAY), before, 'the device score does not move');
  assert.equal(JSON.stringify(day.computeComponents(DAY)), comps, 'no component moves');
  assert.equal(S.dayConsumed.protein, 85, 'consumed is what the camera read, never the plan');
  // The history reconstruction the coach and Progress use: a row with plans scores like one without.
  const row = { date: DAY.date, meals: { ...DAY.meals }, checkin: { submitted: false, slotMacros: DAY.slotMacros, mealLoggedAt: { breakfast: 500, lunch: 780 } } };
  const a = day.scoreFor(day.dayFromHistoryRow(row));
  const b = day.scoreFor(day.dayFromHistoryRow({ ...row, checkin: { ...row.checkin, plans: DAY.plans } }));
  assert.equal(a, b);
  DAY.plans = {};
});

test('pushDay writes plans into checkin, projectRowToDay merges them back, local wins, a clear sticks', () => {
  const src = read('day.js');
  assert.match(src, /arrival: DAY\.arrival \|\| null, plans: DAY\.plans \|\| \{\} \}/, 'plans ride the checkin jsonb');
  assert.match(src, /DAY\.plans = \{ \.\.\.\(ck\.plans && typeof ck\.plans === 'object' \? ck\.plans : \{\}\), \.\.\.DAY\.plans \}/);
  assert.match(src, /DAY\.plans = \{\};/, 'a local reset forgets them');
});

test('THE SERVER: no migration and no edge function scores or bounds anything off checkin.plans', () => {
  const migDir = join(HERE, '..', '..', '..', 'supabase', 'migrations');
  for (const f of readdirSync(migDir).filter((x) => x.endsWith('.sql'))) {
    const sql = readFileSync(join(migDir, f), 'utf8');
    assert.doesNotMatch(sql, /checkin\s*->>?\s*'plans'/, `${f} reads checkin.plans`);
  }
  // The ceiling reads named keys only; the newest definition is the one in force.
  const withCeiling = readdirSync(migDir).filter((f) => readFileSync(join(migDir, f), 'utf8').includes('function clamp_day_score_to_evidence')).sort();
  const newest = readFileSync(join(migDir, withCeiling[withCeiling.length - 1]), 'utf8');
  const body = newest.slice(newest.indexOf('function clamp_day_score_to_evidence'));
  assert.doesNotMatch(body.slice(0, body.indexOf('$function$;') > 0 ? body.indexOf('$function$;') : undefined), /plans/);
  const core = readFileSync(join(HERE, '..', '..', '..', 'src', 'core', 'scoreIntegrity.ts'), 'utf8');
  assert.doesNotMatch(core, /\.plans\b|'plans'/, 'the server-side evidence mirror never reads plans');
});

/* ---------------------------------------------------------------- 3. ideas and the cache */

const USUALS = [
  { id: 'a', name: 'Chicken burrito bowl', protein: 52, kcal: 780, times_logged: 6 },
  { id: 'b', name: 'Tuna melt', protein: 38, kcal: 610, times_logged: 3, items: [{ name: 'Tuna' }] },
  { id: 'c', name: 'Egg scramble', protein: 30, kcal: 420, times_logged: 9, items: [{ name: 'Eggs' }] },
  { id: 'd', name: 'Protein shake', protein: 40, kcal: 250, times_logged: 2 },
  { id: 'e', name: 'Old wrap', protein: 20, kcal: 400, status: 'archived' },
];

test('usuals come first, ranked for the slot by the Plan ranking that already existed', () => {
  const ideas = M.rankIdeas({ usuals: USUALS, slotTarget: { protein: 50, kcal: 800 } });
  assert.equal(ideas.length, 3);
  assert.ok(ideas.every((i) => i.source === 'usual'));
  assert.equal(ideas[0].name, 'Chicken burrito bowl', 'closest to a 50g slot wins');
  assert.ok(!ideas.some((i) => i.name === 'Old wrap'), 'archived never comes back');
});

test('a dislike or an allergy removes a usual, even when only an item inside it names the food', () => {
  const avoid = F.avoidWords({ dislikes: ['tuna'] }, { allergies: [{ name: 'Eggs', severity: 'severe' }] });
  const ideas = M.rankIdeas({ usuals: USUALS, slotTarget: { protein: 40 }, avoid, max: 5 });
  assert.deepEqual(ideas.map((i) => i.name).sort(), ['Chicken burrito bowl', 'Protein shake']);
});

test("Nia's ideas fill up to three, deduped against the usuals and filtered the same way", () => {
  const nia = [
    { name: 'chicken burrito bowl', protein: 50, kcal: 800, tags: ['budget'] },
    { name: 'Turkey rice bowl', protein: 45, kcal: 650, tags: ['budget', 'bogus'] },
    { name: 'Tuna poke', protein: 40, kcal: 500 },
    { name: 'Greek yogurt parfait', protein: 28, kcal: 350, tags: ['grabGo'] },
  ];
  const ideas = M.rankIdeas({ usuals: USUALS.slice(0, 1), nia, slotTarget: { protein: 45 }, avoid: ['tuna'] });
  assert.deepEqual(ideas.map((i) => [i.name, i.source]), [['Chicken burrito bowl', 'usual'], ['Turkey rice bowl', 'nia'], ['Greek yogurt parfait', 'nia']]);
  assert.deepEqual(ideas[1].tags, ['budget'], 'unknown tags are dropped');
  assert.equal(M.ideaTag(ideas[1], true), 'Under $5');
  assert.equal(M.ideaTag(ideas[0], true), 'Usual');
  assert.equal(M.rankIdeas({ usuals: [], nia }).length, 3, 'no usuals: three new ideas');
});

test('the ideas cache is per athlete, day, slot and preferences, and only today is kept', () => {
  const s = new Map();
  const st = { getItem: (k) => (s.has(k) ? s.get(k) : null), setItem: (k, v) => s.set(k, v) };
  const ideas = [{ name: 'Turkey rice bowl', protein: 45, kcal: 650, tags: [] }];
  assert.equal(M.readIdeasCache(st, 'u1', '2026-09-25', 'dinner', 'k1'), null);
  M.writeIdeasCache(st, 'u1', '2026-09-25', 'dinner', 'k1', ideas);
  assert.deepEqual(M.readIdeasCache(st, 'u1', '2026-09-25', 'dinner', 'k1'), ideas);
  assert.equal(M.readIdeasCache(st, 'u1', '2026-09-25', 'lunch', 'k1'), null, 'another slot is another answer');
  assert.equal(M.readIdeasCache(st, 'u1', '2026-09-25', 'dinner', 'k2'), null, 'changed prefs are a miss');
  assert.equal(M.readIdeasCache(st, 'u2', '2026-09-25', 'dinner', 'k1'), null, 'another athlete is a miss');
  M.writeIdeasCache(st, 'u1', '2026-09-26', 'lunch', 'k1', ideas);
  assert.equal(M.readIdeasCache(st, 'u1', '2026-09-25', 'dinner', 'k1'), null, 'yesterday is dropped');
});

test('Plan asks meal-chat for ideas only when the usuals leave room, and never pops the AI sheet', () => {
  const src = read('plan-today.js');
  assert.match(src, /filter\(\(i\) => i\.source === 'usual'\)\.length >= 3\) return;/);
  assert.match(src, /aiConsentCached\(uid\) !== true/, 'no yes to AI, no request (0243)');
  assert.doesNotMatch(src, /ensureAiConsent|openAiConsentSheet/);
  assert.match(src, /readIdeasCache\(s, uid, DAY\.date, slot, prefsKey\(myPrefs\(\)\)\)/, 'the cache is read before any request');
  assert.match(src, /functions\.invoke\('meal-chat', \{\s*body: \{ planIdeas:/);
});

test('the camera is the only way to log: Today plans and snaps, and the one-tap Log is gone from Plan', () => {
  const src = read('plan-today.js');
  const plan = read('screens', 'plan.js');
  assert.match(src, /data-go="camera\/\$\{esc\(slot\.key\)\}">\$\{icon\('camera', 18\)\}Snap it when you eat/);
  assert.doesNotMatch(src, /stageSavedMeal|dayLogMeal|logMeal|data-fm-log/);
  assert.doesNotMatch(plan, /stageSavedMeal|data-fm-log/);
});

/* ---------------------------------------------------------------- 4. the Intuitive and minor gates */

test('Intuitive: every line Today writes about an idea or a slot is number-free', () => {
  const PS = { showMacros: false, showCalories: false };
  const idea = { name: 'Chicken bowl', protein: 52, kcal: 780, source: 'usual', tags: [] };
  assert.equal(M.ideaMeta(idea, PS), 'One of your usuals');
  assert.equal(M.ideaMeta({ ...idea, source: 'nia' }, PS), 'A new idea');
  assert.equal(M.ideaTag(idea, false), '', 'the meta line already says usual');
  assert.equal(M.slotTargetLine({ protein: 45, kcal: 900 }, PS), 'Build it like the plate.');
  // Per figure: a pro who hides calories alone keeps protein.
  assert.equal(M.ideaMeta(idea, { showMacros: true, showCalories: false }), '52g protein');
  assert.equal(M.slotTargetLine({ protein: 45, kcal: 900 }, { showMacros: true, showCalories: false }), 'Land around 45g protein');
  assert.equal(M.slotTargetLine({ protein: 45, kcal: 900 }, { showMacros: true, showCalories: true }), 'Land around 45g protein · 900 cal');
});

test('the goal line: a weight range only for an adult with a goal weight on a numbers plan', () => {
  assert.deepEqual(M.goalWords({ goalKey: 'gain', current: 201.6, target: 210, minor: false, intuitive: false }), { label: 'Gaining', range: '202 to 210 lb' });
  assert.equal(M.goalWords({ goalKey: 'gain', current: 201, target: 210, minor: true, intuitive: false }).range, null, 'a minor never sees a weight figure');
  assert.equal(M.goalWords({ goalKey: 'gain', current: 201, target: 210, minor: false, intuitive: true }).range, null);
  assert.equal(M.goalWords({ goalKey: 'gain', current: 201, target: null, minor: false, intuitive: false }).range, null, 'no goal weight, no range');
  assert.equal(M.goalWords({ goalKey: 'performance' }).label, 'Fueling to perform');
  assert.equal(M.goalWords({ goalKey: null }), null);
});

const setStyle = (key) => {
  RT.profile = { ...(RT.profile || {}), planStyle: key };
  RT.planStyle = null;
  assert.equal(S.planStyle.key, key);
};
const NUMBERS_RE = /\d+\s?g\b|\d+\s?cal\b|\d+\s?kcal\b|protein<br>to go|cal to go/i;

async function seedToday() {
  RT.userId = 'u-plan';
  RT.profileLoading = false; RT.profileOffline = false;
  RT.stdMeals = null;
  RT.profile = { ...(RT.profile || {}), baseGoal: 'gain', targets: { protein: 180, calories: 3200, weight: 210 } };
  DAY.proteinTarget = 180; DAY.calTarget = 3200;
  Object.assign(DAY.meals, { breakfast: true, lunch: false, dinner: false, snack: false });
  DAY.slotMacros = { breakfast: { protein: 46, kcal: 620, quality: 88, name: 'Egg scramble' } };
  DAY.plans = {};
  await warmFoodMemory({ fetchFoodMemory: async () => ({ items: USUALS.slice(0, 3), places: [] }) }, RT.userId, true);
}

test('RENDER, Structured: ring, calories, ideas with figures, and a Plan button', async () => {
  await seedToday();
  setStyle('structured');
  const html = PT.todayHtml();
  assert.match(html, /protein<br>to go/);
  assert.match(html, /cal to go/);
  assert.match(html, /Why these numbers/);
  assert.match(html, /Up next/);
  assert.match(html, /\d+g protein · \d+ cal/);
  assert.match(html, /id="pt-plan"[^>]*>Plan /);
  assert.match(html, /Ask Nia for other ideas/);
  assert.match(html, /Egg scramble · 46g protein · Score 88/, 'the logged row shows the real read');
});

test('RENDER, Intuitive: the plate and its three rules, and not one figure anywhere', async () => {
  await seedToday();
  setStyle('intuitive');
  const html = PT.todayHtml().replace(/<svg[\s\S]*?<\/svg>/g, '');
  assert.match(html, /A palm of protein/);
  assert.match(html, /A fist of carbs, two after hard training/);
  assert.match(html, /Half the plate vegetables/);
  assert.match(html, /Build it like the plate\./);
  assert.match(html, /One of your usuals/);
  assert.doesNotMatch(html, NUMBERS_RE);
  assert.doesNotMatch(html, /210 lb|to 210/, 'no weight range on the intuitive hero');
});

test('RENDER, planned: the plan heading, Change, and the camera as the one primary button', async () => {
  await seedToday();
  setStyle('structured');
  // Every open slot planned, so whichever one the wall clock makes "up next" wears the plan.
  const p = M.planFromIdea({ name: 'Chicken burrito bowl', protein: 52, kcal: 780, source: 'usual' }, '2026-09-25T12:00:00Z');
  DAY.plans = { lunch: p, dinner: p, snack: p };
  const html = PT.todayHtml();
  assert.match(html, /Chicken burrito bowl/);
  assert.match(html, /id="pt-change"/);
  assert.match(html, /Snap it when you eat/);
  assert.doesNotMatch(html, /id="pt-plan"/);
  assert.match(html, /\d+g planned/, 'the ghost is labelled; the ring still fills from the real read');
  DAY.plans = {};
});

/* ---------------------------------------------------------------- 5. the planned-meal hint */

test('the analysis hint is the plan NAME only: no figure from the plan ever reaches the read', () => {
  DAY.plans = { dinner: { name: 'Chicken burrito bowl', protein: 60, kcal: 900, source: 'usual' } };
  assert.deepEqual(day.plannedHint('dinner'), { plannedMeal: { name: 'Chicken burrito bowl' } });
  assert.deepEqual(day.plannedHint('lunch'), {});
  DAY.plans = { dinner: null };
  assert.deepEqual(day.plannedHint('dinner'), {}, 'a cleared plan sends nothing');
  DAY.plans = {};
  const st = read('state.js');
  assert.match(st, /\.\.\.\(job\.date === DAY\.date \? plannedHint\(job\.slot\) : \{\}\),/, 'the outbox path, only for today');
  assert.match(st, /\.\.\.plannedHint\(MEAL\.key \|\| 'dinner'\),/, 'the live path');
});

test('stored plans are re-sanitized on read', () => {
  assert.equal(M.cleanPlan({ name: '<b>x</b>', protein: 9999, kcal: -5, source: 'hack' }).protein, 500);
  assert.equal(M.cleanPlan({ name: '', protein: 5 }), null);
  const p = M.cleanPlan({ name: ' Chicken   bowl ', protein: 52.4, kcal: 780, source: 'nia', at: 'x'.repeat(80) });
  assert.deepEqual(p, { name: 'Chicken bowl', protein: 52, kcal: 780, source: 'nia', at: 'x'.repeat(32) });
});

test('button and heading words', () => {
  assert.equal(M.shortName('Chicken burrito bowl with extra rice'), 'Chicken burrito bowl');
  assert.equal(M.shortName('Chicken burrito bowl'), 'Chicken burrito bowl');
  assert.equal(M.shortName('Supercalifragilisticexpialidocious bowl'), 'Supercalifragilisticexpialidocious');
  assert.equal(M.shortName('Greek yogurt (vanilla) parfait'), 'Greek yogurt parfait', 'the aside goes, the words stay');
  assert.equal(M.shortName('Turkey, rice and black bean bowl'), 'Turkey');
  assert.equal(M.shortName('Grilled salmon and roasted sweet potato'), 'Grilled salmon');
  assert.equal(M.planHeading('dinner', 'Dinner'), "Tonight's plan");
  assert.equal(M.planHeading('lunch', 'Lunch'), 'Lunch plan');
});

test('ring fractions: the ghost starts where the real fill ends and never passes full', () => {
  assert.deepEqual(M.ringFractions({ target: 200, consumed: 50, planned: 50 }), { fill: 0.25, ghost: 0.5 });
  assert.deepEqual(M.ringFractions({ target: 200, consumed: 180, planned: 60 }), { fill: 0.9, ghost: 1 });
  assert.deepEqual(M.ringFractions({ target: 0, consumed: 10, planned: 10 }), { fill: 0, ghost: 0 });
});
