/* Season phase (goals and eating plan, phase B, 2026-09-26).
 *
 * Pins: the phase table is the spec's table; it moves goal-derived CALORIES only (protein never,
 * a coach-set number never, the 1500 floor always); an unset phase is exactly today; the athlete's
 * device, the coach's reconstruction and the Why screen all run the one function; the server never
 * derives a calorie target of its own (so there is nothing there to drift); the phase control's
 * role list is the database's; the words hold the minor and Intuitive rails.
 * Run: node --test proto/redesign-2026-07/js/season-phase.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..', '..');

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

const { RT, nutritionConfigForGoal, PHASE_CAL, phaseCalAdjust, seasonPhase } = await import('./state.js');
const { DAY } = await import('./day.js');
const SP = await import('./season-phase.js');
const WM = await import('./plan-why-model.js');
const { whyModel } = await import('./screens/plan-why.js');

const GOAL_KEYS = { gain: ['gain', 'build', 'gain_muscle', 'gain_weight'], lose: ['lose', 'lose_fat'], maintain: ['maintain', 'health'], perform: ['perform', 'performance'] };
const WEIGHT_WORDS = /\b(lb|lbs|pounds?|bodyweight|weight|gain|gaining|lose|losing|deficit|surplus|cut|cutting|bulk|scale)\b/i;

test('the table is the spec table (founder-approved defaults)', () => {
  assert.deepEqual(PHASE_CAL, {
    gain: { off: 0, pre: 0, in: -150, post: -100 },
    lose: { off: 0, pre: 100, in: 250, post: 0 },
    maintain: { off: 0, pre: 100, in: 150, post: -100 },
    perform: { off: 0, pre: 100, in: 150, post: -100 },
  });
});

test('goal-derived calories move by the table; protein never moves', () => {
  for (const [fam, keys] of Object.entries(GOAL_KEYS)) {
    for (const key of keys) {
      for (const bw of [150, 187, 230]) {
        const base = nutritionConfigForGoal(key, bw, null, null);
        for (const phase of ['off', 'pre', 'in', 'post']) {
          const c = nutritionConfigForGoal(key, bw, null, phase);
          assert.equal(c.proteinTarget, base.proteinTarget, `${key} ${phase} protein`);
          assert.equal(c.calTarget, base.calTarget + PHASE_CAL[fam][phase], `${key} ${bw} ${phase}`);
          assert.equal(phaseCalAdjust(key, phase), PHASE_CAL[fam][phase]);
          assert.equal(c.scoringProfile, base.scoringProfile);
        }
      }
    }
  }
});

test('an unset phase (or garbage) is exactly today', () => {
  for (const key of ['gain', 'lose', 'maintain', 'performance']) {
    const today = nutritionConfigForGoal(key, 187, null);
    for (const p of [null, undefined, '', 'playoffs', 'IN']) assert.deepEqual(nutritionConfigForGoal(key, 187, null, p), today);
  }
  // No goal: the shipped defaults, whatever the season.
  assert.deepEqual(nutritionConfigForGoal(null, 187, null, 'in'), nutritionConfigForGoal(null, 187, null));
});

test('coach-set numbers are never altered by the season', () => {
  for (const phase of ['off', 'pre', 'in', 'post']) {
    const both = nutritionConfigForGoal('gain', 200, { protein: 240, calories: 3800 }, phase);
    assert.equal(both.proteinTarget, 240);
    assert.equal(both.calTarget, 3800);
    // Only protein coach-set: the calories are still goal-derived, so they still follow the season.
    const p = nutritionConfigForGoal('gain', 200, { protein: 240 }, phase);
    assert.equal(p.proteinTarget, 240);
    assert.equal(p.calTarget, nutritionConfigForGoal('gain', 200, null, phase).calTarget);
  }
});

test('the 1500 floor still holds under a negative adjustment', () => {
  // gain at 90 lb: 90 x 17 = 1530 -> 1550, minus 150 in-season would be 1400: the floor wins.
  assert.equal(nutritionConfigForGoal('gain', 90, null, 'in').calTarget, 1500);
  // maintain at 100 lb: 1500 floor, post-season -100 cannot go under it.
  assert.equal(nutritionConfigForGoal('maintain', 100, null, 'post').calTarget, 1500);
  for (const key of ['gain', 'lose', 'maintain', 'performance']) {
    for (const bw of [70, 80, 95, 110]) {
      for (const phase of ['off', 'pre', 'in', 'post']) assert.ok(nutritionConfigForGoal(key, bw, null, phase).calTarget >= 1500);
    }
  }
});

test('ONE function: the athlete device grades with the phase season_phase_for returned', () => {
  RT.userId = 'u-season';
  RT.profile = { baseGoal: 'gain', baseWeight: 200 };
  RT.season = { phase: 'in', source: 'team', canSetSelf: false };
  assert.equal(seasonPhase(), 'in');
  // The Why screen explains the graded day with the same function and the same phase.
  DAY.proteinTarget = nutritionConfigForGoal('gain', 200, null, 'in').proteinTarget;
  DAY.calTarget = nutritionConfigForGoal('gain', 200, null, 'in').calTarget;
  const m = whyModel();
  assert.equal(m.calories.value, DAY.calTarget.toLocaleString('en-US'));
  assert.equal(m.season.label, 'In-season');
  assert.match(m.season.text, /smaller surplus, so energy for games comes first/);
  assert.match(m.season.text, /150 calories less a day/);
  // The comparison rows are derived under the same phase.
  const gainRow = m.compare.find((c) => c.fam === 'gain');
  assert.equal(gainRow.kcal, DAY.calTarget);
  RT.season = null;
});

test('the coach reconstruction passes the athlete\'s phase to the same function', () => {
  const coach = readFileSync(join(HERE, 'screens', 'coach.js'), 'utf8');
  assert.match(coach, /nutritionConfigForGoal\(b\.base_goal, b\.base_weight, b\.targets, b\.season_phase \|\| null\)/);
  const roles = readFileSync(join(HERE, 'roles.js'), 'utf8');
  assert.match(roles, /season_phase_for', \{ p_athlete: athleteId \}/);
  const state = readFileSync(join(HERE, 'state.js'), 'utf8');
  assert.match(state, /rpc\('season_phase_for', \{ p_athlete: userId \}\)/);
  assert.match(state, /nutritionConfigForGoal\(goal, bw, p\.targets, seasonPhase\(\)\)/);
});

/* The server never derives a goal-based calorie target: every function reads the numbers the device
   pushes (meal-opener's day, suggest's slot target, analyze-meal's dayContext) or the coach-set
   athlete_profiles.targets. So there is no second copy of the phase table to drift, and this test
   keeps it that way: no per-pound calorie factor anywhere in the functions. */
test('server parity: no edge function derives calories from bodyweight', () => {
  const files = [];
  const walk = (d) => { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) walk(p); else if (/\.(ts|mjs)$/.test(f) && !/\.test\./.test(f)) files.push(p); } };
  walk(join(ROOT, 'supabase', 'functions'));
  assert.ok(files.length > 20);
  for (const f of files) {
    const src = readFileSync(f, 'utf8');
    assert.doesNotMatch(src, /\*\s*(12|15|17)\b[^\n]*(cal|kcal)|(cal|kcal)[^\n]*\*\s*(12|15|17)\b/i, f);
  }
  const shared = readFileSync(join(ROOT, 'supabase', 'functions', '_shared', 'season-phase.mjs'), 'utf8');
  const code = shared.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
  assert.doesNotMatch(code, /[+-]\s?\d{3}\b/, 'no calorie figure in the server phase module');
});

test('the phase control\'s roles are the database\'s (0252 can_set_team_phase, 0253 can_decide_targets_for)', () => {
  const mig = readFileSync(join(ROOT, 'supabase', 'migrations', '0252_season_phase.sql'), 'utf8');
  const m = mig.match(/function can_set_team_phase[\s\S]*?role::text in \(([^)]*)\)/);
  assert.ok(m);
  const sqlRoles = m[1].split(',').map((s) => s.trim().replace(/'/g, '')).filter((r) => r !== 'assistant').sort();
  assert.deepEqual(sqlRoles, [...SP.PHASE_SETTER_ROLES].sort());
  const m2 = readFileSync(join(ROOT, 'supabase', 'migrations', '0253_target_suggestions.sql'), 'utf8').match(/function can_decide_targets_for[\s\S]*?role::text in \(([^)]*)\)/);
  assert.equal(m2[1], m[1]);
});

test('phase gating by role: standards editors only, closed while loading', () => {
  for (const r of ['head_coach', 'coordinator', 'assistant', 'nutritionist', 's_and_c', 'team_admin']) assert.equal(SP.canSetSeason(r), true, r);
  for (const r of ['readonly', 'position_coach', 'athletic_trainer', null, undefined, '', 'owner']) assert.equal(SP.canSetSeason(r), false, String(r));
});

test('the Why line: coach-set says the season leaves it, minors get no weight words, plate gets no figures', () => {
  for (const phase of ['off', 'pre', 'in', 'post']) {
    const c = SP.whyPhaseLine({ phase, family: 'gain', coachSet: true, adjust: -150 });
    assert.match(c.text, /does not move numbers your coach set/);
    for (const family of ['gain', 'lose', 'maintain', 'perform']) {
      const minor = SP.whyPhaseLine({ phase, family, minor: true, adjust: phaseCalAdjust(family, phase) });
      assert.doesNotMatch(minor.text, WEIGHT_WORDS, minor.text);
      assert.doesNotMatch(minor.text, /\d/, minor.text);
      const adult = SP.whyPhaseLine({ phase, family, adjust: phaseCalAdjust(family, phase) });
      assert.ok(adult.text.startsWith(`${SP.phaseLabel(phase)}:`));
      assert.doesNotMatch(adult.text, /[—–]/);
      const hidden = SP.whyPhaseLine({ phase, family, numbers: false, adjust: phaseCalAdjust(family, phase) });
      assert.doesNotMatch(hidden.text, /\d/);
    }
    const plate = SP.whyPhaseLine({ phase, mode: 'plate' });
    assert.doesNotMatch(plate.text, /\d|calorie/i);
  }
  assert.equal(SP.whyPhaseLine({ phase: null }), null);
  assert.equal(SP.whyPhaseLine({ phase: 'playoffs' }), null);
});

test('the Why model carries the season line only when a phase applies', () => {
  const d = nutritionConfigForGoal('gain', 187, null, 'in');
  const base = { goalKey: 'gain', bodyweight: 187, protein: d.proteinTarget, kcal: d.calTarget, derive: (k, bw) => nutritionConfigForGoal(k, bw, null, 'in'), showMacros: true, showCalories: true };
  assert.equal(WM.explainTargets({ ...base }).season, null);
  const x = WM.explainTargets({ ...base, phase: 'in', phaseAdjust: -150 });
  assert.equal(x.season.label, 'In-season');
  const plate = WM.explainTargets({ ...base, phase: 'in', showMacros: false, showCalories: false });
  assert.doesNotMatch(plate.season.text, /\d/);
  const self = WM.explainTargets({ ...base, coachSet: { protein: true, calories: true }, who: 'self' });
  assert.equal(self.lead, 'You set these numbers from a suggested change.');
});

test('the hero line joins the phase to the goal', () => {
  assert.equal(SP.heroGoalLine('Gaining', 'in', null), 'Gaining · In-season');
  assert.equal(SP.heroGoalLine('Gaining', 'in', '200 to 210 lb'), 'Gaining · In-season · 200 to 210 lb');
  assert.equal(SP.heroGoalLine('Gaining', null, '200 to 210 lb'), 'Gaining · 200 to 210 lb');
  assert.equal(SP.heroGoalLine('Maintaining', null, null), 'Maintaining');
});

test('the coach confirm line says what changes and that coach numbers stay', () => {
  for (const p of ['off', 'pre', 'in', 'post', null]) {
    const t = SP.confirmLine(p);
    assert.match(t, /stay/);
    assert.doesNotMatch(t, /[—–]/);
  }
});
