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

const { navFor, navAdmits, lateralStep } = await import('./router.js');
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

/* A PARENT must never inherit the athlete shell. `fund-plan`, `funded-plans` and
   `my-trainer-offers` declare no nav, and the old `mod.nav || 'athlete'` default handed a parent
   the athlete tab bar — Home/Plan/Camera/Progress/Profile, five tabs to places a parent has no
   account for — rendered under a parent screen. Neither role guard covers parents (both only
   bounce coach/trainer), so nothing caught it. */
assert.strictEqual(navFor(BARE, 'parent'), 'parent',
  'a shared screen must render in the parent shell for a parent, never the athlete one');
for (const route of ['fund-plan', 'funded-plans', 'my-trainer-offers']) {
  assert.strictEqual(navFor(screens[route], 'parent'), 'parent',
    `${route} must not paint the athlete tab bar for a parent`);
}
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
  // 0196: pass-grant moves an athlete's score without them logging anything. It must be reachable
  // by both operator books and by NEITHER athlete nor parent — an athlete opening their own grant
  // sheet would be a self-grant path the server-side wall (grant_pass's is_team_coach_of OR
  // is_trainer_of check) doesn't even get a chance to refuse, because there is nothing to render.
  {
    const mod = screens['pass-grant'];
    assert.ok(mod, 'pass-grant must be registered');
    assert.ok(navAdmits(mod, 'coach') && navAdmits(mod, 'trainer'), 'both operator books can reach pass-grant');
    assert.strictEqual(navFor(mod, 'coach'), 'coach');
    assert.strictEqual(navFor(mod, 'trainer'), 'trainer');
    assert.strictEqual(navAdmits(mod, 'athlete'), false, 'an athlete must never render pass-grant');
    assert.strictEqual(navAdmits(mod, 'parent'), false, 'a parent must never render pass-grant');
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

/* ---------------- every role can reach account deletion ----------------
   `delete-account` is linked from privacy and terms, which every role can open. It declared no
   nav, so it resolved to the athlete shell and the mirror guard (router.js:204) bounced any
   signed-in coach or trainer back to their own root — meaning an operator could not delete
   their account from the UI at all. That is a data-rights problem, not a cosmetic one. */
{
  const del = screens['delete-account'];
  assert.ok(del, 'delete-account must stay registered');
  // Its nav is a getter over roleNav(), which reads the SIGNED-IN role — so drive that, the way
  // the running app does, rather than asserting against a null session.
  const { RT } = await import('./state.js');
  const before = RT.authRole;
  try {
    for (const role of ROLES) {
      RT.authRole = role;
      assert.ok(navAdmits(del, role),
        `a signed-in ${role} must be able to render delete-account`);
    }
  } finally {
    RT.authRole = before;
  }
}

/* ---------------- an operator settings screen must admit BOTH operators ----------------
   Same defect as delete-account above, found again on 2026-08-10: `coachNotifSettings` declared a
   hardcoded `nav: 'coach'`, so navAdmits() refused a trainer and the router bounced them to their
   Home tab. trainerProfile links this screen (screens/roles.js, the "Notifications — Briefings,
   alerts, quiet hours" row in Practice HQ), which made it a DEAD TAP: a trainer had no path to
   their own notification preferences from anywhere in the UI, and nothing threw, logged, or
   painted a not-found screen.

   Note this is asserted per-screen rather than by walking every data-go link in the codebase. That
   walk was tried and abandoned: role-adaptive screens declare `nav` as a GETTER over roleNav(), so
   a static scan reads them all as athlete-only and reports ~157 "dead taps" that are nothing of the
   sort. A lint that cries wolf gets ignored, which is the failure this repo has been paying for
   all week — better a short list of real screens, asserted honestly. */
{
  const { RT } = await import('./state.js');
  const before = RT.authRole;
  // Screens an operator reaches from their own profile/HQ that are shared by both books.
  const SHARED = ['coach-notif-settings'];
  try {
    for (const route of SHARED) {
      const mod = screens[route];
      assert.ok(mod, `${route} must stay registered`);
      for (const role of ['coach', 'trainer']) {
        RT.authRole = role;
        assert.ok(navAdmits(mod, role), `a signed-in ${role} must be able to render ${route}`);
        // It must also land in that operator's own shell, not the other one's.
        assert.strictEqual(navFor(mod, role), role,
          `${route} must render inside the ${role} shell for a ${role}`);
      }
      // ...and it is still not an athlete screen.
      RT.authRole = 'athlete';
      assert.ok(!navAdmits(mod, 'athlete'), `${route} must not admit an athlete`);
    }
  } finally {
    RT.authRole = before;
  }
}

/* ---------------- lateralStep: sideways vs deeper ----------------
   The distinction the router had no way to make. Every sub-route looked like a detail page, so
   tapping across Plan's four-tab strip slid the screen in from the right AND pushed each tab onto
   the back stack: leaving Plan from Food Memory took four backs. Both failures are silent, which
   is why the rule is asserted here rather than trusted to a screenshot. */
{
  // Plan is the one screen with a declared strip, and it must stay declared.
  const plan = screens.plan;
  assert.ok(plan, 'plan must stay registered');
  assert.ok(Array.isArray(plan.subs) && plan.subs.length >= 2,
    'plan must declare its tab strip via `subs`, or every tab tap goes back to being a push');
  assert.strictEqual(plan.subs[0], 'overview',
    'the first sub must be what a bare #plan renders, since lateralStep treats "no sub" as index 0');

  // Forward and backward across the strip, with the sign carrying the direction.
  assert.strictEqual(lateralStep('plan', 'overview', 'plan/nutrition'), 1, 'one tab right is +1');
  assert.strictEqual(lateralStep('plan', 'overview', 'plan/memory'), 3, 'three tabs right is +3');
  assert.strictEqual(lateralStep('plan', 'memory', 'plan/overview'), -3, 'three tabs left is -3');
  assert.strictEqual(lateralStep('plan', 'requirements', 'plan/nutrition'), -1, 'one tab left is -1');
  // A bare #plan is resting on the first tab, not on "no tab".
  assert.strictEqual(lateralStep('plan', null, 'plan/requirements'), 2,
    'arriving from a bare #plan measures from the first tab');
  // Re-tapping the tab you are already on is not a move; 0 sends it down the ordinary path
  // rather than replacing history with the address it already has.
  assert.strictEqual(lateralStep('plan', 'nutrition', 'plan/nutrition'), 0, 're-tapping the active tab is not travel');

  // Everything that is NOT a sibling tab must stay a push, or Back stops working for it.
  assert.strictEqual(lateralStep('plan', 'overview', 'plan'), 0, 'the bare root is not a lateral target');
  assert.strictEqual(lateralStep('plan', 'overview', 'plan/bogus'), 0, 'an undeclared sub is not a tab');
  assert.strictEqual(lateralStep('plan', 'overview', 'progress'), 0, 'a different screen is never lateral');
  assert.strictEqual(lateralStep('home', null, 'home/anything'), 0, 'a screen with no strip has no lateral moves');
  // The exact shape that made this necessary: same two-segment form, but a real detail screen.
  assert.strictEqual(lateralStep('connected-standard', null, 'connected-standard/csr-steps'), 0,
    'a detail sub-route must still push, or it becomes unreachable by Back');
  assert.strictEqual(lateralStep('memory-edit', null, 'memory-edit/new'), 0, 'memory-edit/new is a detail, not a tab');

  // Every screen that declares subs must declare them as strings that its own router can route.
  for (const [route, mod] of Object.entries(screens)) {
    if (!mod || !Array.isArray(mod.subs)) continue;
    assert.ok(mod.subs.every((s) => typeof s === 'string' && s && !s.includes('/')),
      `${route}.subs must be plain sub keys, never paths`);
    assert.strictEqual(new Set(mod.subs).size, mod.subs.length,
      `${route}.subs must not repeat a key, or two tabs share an index and the travel direction is a coin flip`);
  }
}

console.log('router role matrix: all assertions passed');
