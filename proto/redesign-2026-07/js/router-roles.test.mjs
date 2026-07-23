/* Router role matrix. Both role guards in render() `return` after setting location.hash, so a
   wrong answer is a SILENT redirect loop — nothing throws, nothing logs, the screen just never
   paints. That failure mode is why this matrix is asserted rather than eyeballed. */
import assert from 'node:assert';

/* router.js pulls in the whole screen graph on import; stub the DOM it touches at module eval. */
const el = () => ({
  style: { setProperty() {}, removeProperty() {} },
  classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
  setAttribute() {}, getAttribute: () => null, addEventListener() {},
  querySelectorAll: () => [], querySelector: () => null, appendChild() {}, remove() {}, insertAdjacentHTML() {},
});
globalThis.window = { location: { hash: '' }, addEventListener() {}, matchMedia: () => ({ matches: false, addEventListener() {}, addListener() {} }) };
globalThis.document = Object.assign(el(), { createElement: el, getElementById: () => null, documentElement: el(), body: el(), head: el() });
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
globalThis.sessionStorage = { getItem: () => null, setItem() {}, removeItem() {} };
globalThis.location = globalThis.window.location;   // node supplies `navigator` itself (getter-only)

const { navFor, navAdmits } = await import('./router.js');
const { screens } = await import('./screens/index.js');

const ROLES = ['athlete', 'coach', 'trainer', 'parent'];
const OPERATOR = { nav: 'operator' };
const COACH_ONLY = { nav: 'coach' };
const TRAINER_ONLY = { nav: 'trainer' };
const ATHLETE = { nav: 'athlete' };
const BARE = {};                       // no nav declared → athlete, the shared-screen default

/* ---------------- navAdmits: who may render what ---------------- */
{
  // An operator screen admits exactly the two operator roles — never an athlete or a parent.
  const admitted = ROLES.filter(r => navAdmits(OPERATOR, r));
  assert.deepStrictEqual(admitted, ['coach', 'trainer']);
}
{
  assert.deepStrictEqual(ROLES.filter(r => navAdmits(COACH_ONLY, r)), ['coach']);
  assert.deepStrictEqual(ROLES.filter(r => navAdmits(TRAINER_ONLY, r)), ['trainer']);
  assert.deepStrictEqual(ROLES.filter(r => navAdmits(ATHLETE, r)), ['athlete']);
  assert.deepStrictEqual(ROLES.filter(r => navAdmits(BARE, r)), ['athlete'], 'an undeclared nav must default to athlete');
}

/* ---------------- navFor: which tab bar paints ---------------- */
assert.strictEqual(navFor(OPERATOR, 'coach'), 'coach');
assert.strictEqual(navFor(OPERATOR, 'trainer'), 'trainer');
assert.strictEqual(navFor(COACH_ONLY, 'coach'), 'coach');
assert.strictEqual(navFor(TRAINER_ONLY, 'trainer'), 'trainer');
assert.strictEqual(navFor(ATHLETE, 'athlete'), 'athlete');
assert.strictEqual(navFor(BARE, 'athlete'), 'athlete');
assert.strictEqual(navFor(null, 'coach'), 'athlete', 'a missing module must not throw');
// Pre-hydrate: authRole is null before the profile lands. An operator screen must fall back to
// the coach shell rather than crashing or painting the athlete bar.
assert.strictEqual(navFor(OPERATOR, null), 'coach');
assert.strictEqual(navFor(OPERATOR, undefined), 'coach');

/* ---------------- every registered screen resolves to a real tab bar ---------------- */
{
  const NAV_IDS = {
    athlete: ['home', 'plan', 'camera', 'progress', 'profile'],
    coach: ['home', 'roster', 'create', 'inbox', 'insights'],
    trainer: ['home', 'roster', 'create', 'inbox', 'insights'],
  };
  const bad = [];
  for (const [route, mod] of Object.entries(screens)) {
    if (!mod || mod.hideTabs) continue;
    for (const role of ROLES) {
      if (!navAdmits(mod, role)) continue;
      const shell = navFor(mod, role);
      if (!NAV_IDS[shell]) bad.push(`${route}: unknown shell '${shell}'`);
    }
  }
  assert.deepStrictEqual(bad, [], 'every admitting role must resolve to a real tab bar');
}

/* ---------------- the trainer dashboard is actually wired ---------------- */
{
  // Each trainer tab route must exist, admit a trainer, and paint the trainer shell.
  for (const route of ['trainer', 'trainer-roster', 'trainer-create', 'trainer-inbox', 'trainer-grow']) {
    const mod = screens[route];
    assert.ok(mod, `trainer tab route '${route}' is not registered`);
    assert.ok(navAdmits(mod, 'trainer'), `'${route}' must admit a trainer`);
    assert.strictEqual(navFor(mod, 'trainer'), 'trainer', `'${route}' must paint the trainer shell`);
  }
  // 0136 opened standards/assignments; 0137 opened insights (practice rollups). What stays
  // coach-only is what is TEAM-shaped BY DESIGN — rooms and broadcast announcements have no
  // practice equivalent to build.
  for (const route of ['coach-rooms', 'coach-announce']) {
    const mod = screens[route];
    assert.ok(mod, `${route} missing`);
    assert.strictEqual(navAdmits(mod, 'trainer'), false, `a trainer must not render '${route}'`);
  }
  // The shared operator screens serve a coach exactly as before.
  for (const route of ['coach-home', 'coach-roster', 'coach-create', 'coach-inbox', 'coach-athlete',
                       'coach-plan', 'coach-plan-set', 'coach-assign', 'coach-meal', 'coach-insights']) {
    assert.ok(navAdmits(screens[route], 'coach'), `a coach must still render '${route}'`);
    assert.strictEqual(navFor(screens[route], 'coach'), 'coach');
    assert.strictEqual(navAdmits(screens[route], 'athlete'), false, `an athlete must not render '${route}'`);
  }
}

/* ---------------- declared tabs exist in the shell that renders them ---------------- */
{
  const NAV_IDS = {
    athlete: ['home', 'plan', 'camera', 'progress', 'profile'],
    coach: ['home', 'roster', 'create', 'inbox', 'insights'],
    trainer: ['home', 'roster', 'create', 'inbox', 'insights'],
  };
  // A tab id outside its shell lights NO tab — the screen paints with a dead bar. Profile-ish
  // screens legitimately do this (neither operator shell has a profile tab), so they're exempt.
  const EXEMPT = new Set(['profile', 'copilot', 'note', 'grow', 'clients', 'team']);
  const orphans = [];
  for (const [route, mod] of Object.entries(screens)) {
    if (!mod || mod.hideTabs || !mod.tab || EXEMPT.has(mod.tab)) continue;
    for (const role of ROLES) {
      if (!navAdmits(mod, role)) continue;
      const ids = NAV_IDS[navFor(mod, role)];
      if (ids && !ids.includes(mod.tab)) orphans.push(`${route} (tab '${mod.tab}' not in ${navFor(mod, role)} shell)`);
    }
  }
  assert.deepStrictEqual(orphans, [], 'a declared tab must exist in the shell that renders it');
}

console.log('router role matrix: all assertions passed');
