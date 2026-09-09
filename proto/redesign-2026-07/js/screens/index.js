/* The screen registry: route name -> screen module.
 *
 * Two kinds of entry live in `screens`. An EAGER entry is the module object itself, imported
 * statically above: the athlete tab bar (home / plan / log / progress / profile), the welcome
 * door, and the two fallbacks the router resolves synchronously (notfound, notpermitted). A LAZY
 * entry is a thunk made by lazy() below: `() => import('./x.js')` resolved on first use, after
 * which loadScreen() writes the module back over the thunk so every later read is the plain
 * object. Until 2026-09-05 this file imported all 78 modules statically, which put 3.45 MB of
 * JS between the HTML parse and the first frame for every boot, most of it operator screens an
 * athlete can never open.
 *
 * Consumers that read `screens[x]` synchronously (the router's badge and transient checks, the
 * tests, scripts/qc-capture.mjs's route sweep) go through isLazy() / loadScreen() / loadAllScreens()
 * so a thunk is never mistaken for a module. qc-capture enumerates routes by regex over this file
 * (`^\s*'?name'?\s*:`), so every route stays one `name: value,` line here; nothing else in this
 * file may start a line that way.
 *
 * Aliases (`coach` and `coach-home`, the trainer-* routes) share one thunk on purpose, so
 * loadScreen() fills every alias the moment any of them resolves. */
import home from './home.js';
import plan from './plan.js';
import log from './log.js';
import progress from './progress.js';
import profile from './profile.js';
import auth from './auth.js';
import notfound from './notfound.js';
import notpermitted from './notpermitted.js';

/** A lazy registry entry. `load` is a `() => import(...)`, `name` the export to pick (default
 *  export when omitted). The thunk carries `lazy: true` so consumers can tell it from a module. */
function lazy(load, name) {
  const thunk = () => load().then((m) => {
    const mod = name ? m[name] : m.default;
    if (!mod) throw new Error(`screens: ${name || 'default'} export missing`);
    return mod;
  });
  thunk.lazy = true;
  thunk.exportName = name || 'default';
  return thunk;
}

/** True for a registry entry that has not been loaded yet. */
export function isLazy(entry) { return typeof entry === 'function' && entry.lazy === true; }

const INFLIGHT = new Map();
/** Resolve a route's module, loading it on first use and caching it back into the registry (and
 *  into every alias that shares the same thunk). Resolves to the module, or undefined for an
 *  unregistered route. Rejects when the import fails; the registry keeps the thunk so a retry
 *  can try the network again. */
export function loadScreen(route) {
  const entry = screens[route];
  if (!isLazy(entry)) return Promise.resolve(entry);
  if (INFLIGHT.has(entry)) return INFLIGHT.get(entry);
  const p = entry().then((mod) => {
    for (const k of Object.keys(screens)) if (screens[k] === entry) screens[k] = mod;
    INFLIGHT.delete(entry);
    return mod;
  }, (err) => { INFLIGHT.delete(entry); throw err; });
  INFLIGHT.set(entry, p);
  return p;
}

/** Load several routes at once (an operator's tab set at boot). Failures are per-route and
 *  swallowed here: the router renders a real error state when it actually needs one. */
export function preloadScreens(routes) {
  return Promise.all(routes.map((r) => loadScreen(r).catch(() => undefined)));
}

/** Every registered module, loaded. For tests and tooling that walk the whole table. */
export async function loadAllScreens() {
  await Promise.all(Object.keys(screens).map((r) => loadScreen(r)));
  return screens;
}

// Shared modules: one import() per FILE, so two routes off the same module share one fetch.
const meal = () => import('./meal.js');
const camera = () => import('./camera.js');
const recovery = () => import('./recovery.js');
const profileMod = () => import('./profile.js');
const coach = () => import('./coach.js');
const coachHome = () => import('./coach-home.js');
const coachRoster = () => import('./coach-roster.js');
const coachCreate = () => import('./coach-create.js');
const settings = () => import('./settings.js');
const foodsearch = () => import('./foodsearch.js');
const trust = () => import('./trust.js');
const roles = () => import('./roles.js');
const features = () => import('./features.js');
const connectedStandards = () => import('./connected-standards.js');
const coachConnected = () => import('./coach-connected.js');
const coachCommitments = () => import('./coach-commitments.js');
const coachWakeup = () => import('./coach-wakeup.js');

// The operator tab set (coach and trainer bars): NAVS in router.js names these routes, and the
// tab badges read badge() off coach-inbox / coach-profile / trainer-grow. Preloaded at boot for
// a persisted operator session so the bar renders with its counts on the first paint.
export const OPERATOR_TAB_ROUTES = [
  'coach-home', 'coach-roster', 'coach-create', 'coach-inbox', 'coach-profile',
  'trainer', 'trainer-roster', 'trainer-create', 'trainer-inbox', 'trainer-profile',
];

export const screens = {
  home,
  'score-breakdown': lazy(() => import('./breakdown.js')),
  plan,
  'memory-edit': lazy(() => import('./memory-edit.js')),
  'plan-ask': lazy(() => import('./plan-ask.js')),
  camera: lazy(camera),
  'camera-confirm': lazy(camera, 'cameraConfirm'),
  analyzing: lazy(meal, 'analyzing'),
  'meal-questions': lazy(meal, 'mealQuestions'),
  'meal-analysis': lazy(meal, 'analysis'),
  'meal-thread': lazy(meal, 'thread'),
  'nutrition-chat': lazy(() => import('./nutrition-chat.js')),
  'meal-confirm': lazy(meal, 'confirm'),
  'meal-detail': lazy(meal, 'detail'),
  weight: lazy(() => import('./weight.js')),
  recovery: lazy(recovery),
  'recovery-confirm': lazy(recovery, 'recoveryConfirm'),
  progress,
  squad: lazy(() => import('./squad.js')),
  'monthly-report': lazy(() => import('./monthly-report.js')),
  profile,
  connect: lazy(() => import('./connect.js')),
  guardian: lazy(() => import('./guardian.js')),
  notifications: lazy(() => import('./notifications.js')),
  log,
  welcome: auth,
  onboarding: lazy(() => import('./onboarding.js')),
  commitment: lazy(() => import('./commitment.js')),
  // `coach` is an alias: the old route renders the new Home. Same thunk, filled together.
  'coach-home': lazy(coachHome, 'coachHome'),
  coach: lazy(coachHome, 'coachHome'),
  'coach-roster': lazy(coachRoster, 'coachRoster'),
  'coach-rooms': lazy(() => import('./coach-rooms.js'), 'coachRooms'),
  'coach-create': lazy(coachCreate, 'coachCreate'),
  'coach-announce': lazy(() => import('./coach-announce.js'), 'coachAnnounce'),
  'coach-insights': lazy(() => import('./coach-insights.js'), 'coachInsights'),
  'coach-athlete': lazy(coach, 'coachAthlete'),
  'coach-meal': lazy(coach, 'coachMeal'),
  'coach-assign': lazy(coach, 'coachAssign'),
  'coach-plan': lazy(coach, 'coachPlan'),
  'coach-plan-set': lazy(coach, 'coachPlanSet'),
  'coach-inbox': lazy(coach, 'coachInbox'),
  copilot: lazy(coach, 'copilot'),
  // Trainer dashboard = the SAME operator modules the coach renders, under role-coherent routes
  // so a trainer's URL never reads #coach-*. The modules declare nav:'operator'; the router picks
  // the tab bar from RT.authRole and coach-data.js reduces them by capability.
  trainer: lazy(coachHome, 'coachHome'),
  'trainer-roster': lazy(coachRoster, 'coachRoster'),
  'trainer-create': lazy(coachCreate, 'coachCreate'),
  'trainer-inbox': lazy(coach, 'coachInbox'),
  // Coach Marketplace (0183 to 0186): client side + coach side
  parent: lazy(coach, 'parent'),
  'invite-parent': lazy(coach, 'inviteParent'),
  'parent-link': lazy(coach, 'parentLink'),
  states: lazy(() => import('./states.js')),
  notfound,
  notpermitted,
  requirement: lazy(() => import('./requirement.js')),
  messages: lazy(settings, 'messages'),
  settings: lazy(settings, 'settings'),
  feedback: lazy(() => import('./feedback.js'), 'feedback'),
  'plan-upgrade': lazy(() => import('./plan-upgrade.js'), 'planUpgrade'),
  'plan-style': lazy(settings, 'planStylePicker'),
  privacy: lazy(settings, 'privacy'),
  billing: lazy(settings, 'billing'),
  'food-search': lazy(foodsearch, 'foodSearch'),
  'label-scan': lazy(foodsearch, 'labelScan'),
  'barcode-scan': lazy(foodsearch, 'barcodeScan'),
  trust: lazy(trust, 'trust'),
  streak: lazy(trust, 'streak'),
  history: lazy(trust, 'history'),
  'meal-view': lazy(trust, 'mealView'),
  // OB2 adaptive onboarding (2026-07 redesign): the 6-role narrative flow owns the `role` route;
  // the legacy picker stays reachable as `legacy-role` for rollback.
  role: lazy(() => import('./ob2-role.js'), 'ob2Role'),
  'legacy-role': lazy(roles, 'role'),
  oba: lazy(() => import('./ob2-athlete.js'), 'obAthlete'),
  obf: lazy(() => import('./ob2-client.js'), 'obClient'),
  obk: lazy(() => import('./ob2-coach.js'), 'obCoach'),
  obt: lazy(() => import('./ob2-trainer.js'), 'obTrainer'),
  obp: lazy(() => import('./ob2-parent.js'), 'obParent'),
  obn: lazy(() => import('./ob2-nutrition.js'), 'obNutrition'),
  obd: lazy(() => import('./ob2-dietitian.js'), 'obDietitian'),
  signin: lazy(() => import('./signin.js')),
  reset: lazy(() => import('./reset.js')),
  'coach-ob': lazy(roles, 'coachOb'),
  'trainer-ob': lazy(roles, 'trainerOb'),
  'client-ob': lazy(roles, 'clientOb'),
  'coach-profile': lazy(roles, 'coachProfile'),
  'trainer-profile': lazy(roles, 'trainerProfile'),
  'edit-profile': lazy(profileMod, 'editProfile'),
  'notif-settings': lazy(settings, 'notifSettings'),
  'coach-notif-settings': lazy(settings, 'coachNotifSettings'),
  'delete-account': lazy(settings, 'deleteAccount'),
  terms: lazy(settings, 'terms'),
  recruiting: lazy(features, 'recruiting'),
  restrictions: lazy(features, 'restrictions'),
  'team-diet': lazy(features, 'teamDiet'),
  'coach-voice': lazy(features, 'coachVoice'),
  'trust-pass-policy': lazy(features, 'trustPassPolicy'),
  'week-pattern': lazy(features, 'weekPattern'),
  safety: lazy(features, 'safety'),
  'bio-optin': lazy(() => import('./bio-optin.js')),
  'pass-grant': lazy(() => import('./pass-grant.js')),
  paywall: lazy(() => import('./paywall.js')),
  'log-training': lazy(() => import('./log-training.js')),
  'training-history': lazy(() => import('./training-history.js')),
  // Verified Commitments (0138). Athlete: the roll-call detail + the Accountability rollup +
  // the athlete-controlled recruit profile. Operator: the live board + the composer.
  'roll-call': lazy(() => import('./roll-call.js')),
  accountability: lazy(() => import('./accountability.js')),
  'verified-profile': lazy(() => import('./verified-profile.js')),
  'coach-commitments': lazy(coachCommitments, 'coachCommitments'),
  'coach-commit-edit': lazy(coachCommitments, 'coachCommitEdit'),
  'coach-commit-manage': lazy(coachCommitments, 'coachCommitManage'),
  // Wake-Up Roll Call (0211): the fast composer for a morning_roll_call commitment.
  'coach-wakeup-edit': lazy(coachWakeup, 'coachWakeupEdit'),
  'coach-wakeup-new': lazy(coachWakeup, 'coachWakeupNew'),
  // Connected Standards (0155). Athlete: the standard detail, the list, and the personal editor.
  // The Home card itself is injected into #cs-slot by home.js, not routed.
  'connected-standard': lazy(connectedStandards),
  'connected-standards': lazy(connectedStandards, 'connectedStandardsList'),
  'connected-standard-edit': lazy(connectedStandards, 'connectedStandardEdit'),
  // Operator: the live board, the builder, and the manage list. nav:'operator' renders each of
  // these for a coach's team AND a trainer's practice.
  'coach-standards': lazy(coachConnected, 'coachStandards'),
  'coach-standard-edit': lazy(coachConnected, 'coachStandardEdit'),
  'coach-standards-manage': lazy(coachConnected, 'coachStandardsManage'),
  'health-consent': lazy(() => import('./health-consent.js')),
  'apple-health': lazy(() => import('./apple-health.js')),
};
