/* The first-run tour: which steps a given person gets, and in what order.
 *
 * Onboarding collected answers and then dropped people onto a screen nobody had ever explained.
 * This module decides what to explain. It is pure — no DOM, no clock, no storage — so the whole
 * personalization matrix is testable (tour-plan.test.mjs IS the spec).
 *
 * Two axes of personalization:
 *   WHICH steps  ← the role. Four lists: athlete, coach, trainer, parent.
 *   WHICH WORDS  ← what they set up. Goal shapes the plan line; a linked coach and a connected
 *                  wearable each unlock an optional step; a fitness client hears "trainer".
 *
 * Every optional step is genuinely optional: a solo athlete with no watch gets four steps and a
 * linked athlete with one gets six, and both read as a complete tour rather than a truncated one.
 *
 * The driver (tour.js) never decides what to include. It only asks where things are on screen and
 * drops steps whose element isn't there — see filterSteps.
 */

/** Tour ids double as the seen-flag keys in RT.tourSeen. Trainer is its own id even though it
    shares the coach step list, so a coach who is also a trainer gets told about both. */
export const TOUR_IDS = Object.freeze({
  athlete: 'tour:athlete',
  coach: 'tour:coach',
  trainer: 'tour:trainer',
  parent: 'tour:parent',
});

/** The landing route for each role — a tour only ever opens there. Mirrors routeForRole()
    in state.js; duplicated rather than imported to keep this module free of app state. */
const LANDING = Object.freeze({ athlete: 'home', coach: 'coach', trainer: 'trainer', parent: 'parent' });

/* The plan line's tail, by the goal captured in onboarding. Two flows contribute values:
   athlete (gain|lose|maintain|performance) and fitness client (lose|maintain|build|health).
   Anything else — legacy slug, missing answer, a goal we add later — falls back to no tail,
   which reads as a complete sentence on its own. */
const GOAL_TAIL = Object.freeze({
  gain: ' Yours is built around adding size.',
  lose: ' Yours is built around cutting.',
  maintain: ' Yours is built around holding your weight.',
  performance: ' Yours is built around performing.',
  build: ' Yours is built around building strength.',
  health: ' Yours is built around feeling better day to day.',
});

/** A fitness client's operator is a trainer, not a coach. One noun, several sentences. */
const operatorNoun = (ctx) => (ctx.audience === 'client' ? 'trainer' : 'coach');

/* ---------------- step definitions ----------------
   A step is { key, anchor, title, body }. `anchor` is a data-tour value — never a CSS id, because
   Home's surfaces have no stable ids and render on four different branches.
   `when` (optional) decides inclusion and is resolved here, so the returned array is final.
   `body` may be a function of ctx for copy that varies. */

const ATHLETE_STEPS = [
  {
    key: 'score', anchor: 'score',
    title: 'This is your Standard',
    body: 'One number for the day. It moves when you log.',
  },
  {
    key: 'log', anchor: 'log',
    title: 'Everything starts here',
    body: 'Photograph a meal, log training, mark a commitment.',
  },
  {
    key: 'plan', anchor: 'plan',
    title: 'Your plan lives here',
    body: (ctx) => `What the day asks of you.${GOAL_TAIL[ctx.goal] || ''}`,
  },
  {
    key: 'coach-seen', anchor: 'coach-seen',
    when: (ctx) => !!ctx.hasCoach,
    title: (ctx) => `Your ${operatorNoun(ctx)} sees this`,
    body: (ctx) => `What you log reaches your ${operatorNoun(ctx)}. This line shows when they've looked.`,
  },
  {
    key: 'standards', anchor: 'standards',
    when: (ctx) => !!ctx.hasStandards,
    title: 'Some of it verifies itself',
    body: 'Connected Standards confirm the work from your watch, without you logging it.',
  },
  {
    key: 'close', anchor: 'log',
    title: "That's it",
    body: 'Log something and watch your number move.',
  },
];

/* Coach and trainer render the same screen module, so they share anchors. Only the nouns differ:
   a trainer has a practice full of clients where a coach has a team full of athletes. */
const OPERATOR_STEPS = [
  {
    key: 'roster', anchor: 'roster',
    title: 'Everything here is scoped',
    body: (ctx) => (ctx.role === 'trainer'
      ? 'Switch between your whole practice and a single group.'
      : 'Switch between your whole team and a single group.'),
  },
  {
    key: 'priority', anchor: 'priority',
    title: 'Who needs you today',
    body: (ctx) => (ctx.role === 'trainer'
      ? 'Your clients, ranked by who needs attention. Start here every morning.'
      : 'Your athletes, ranked by who needs attention. Start here every morning.'),
  },
  {
    key: 'activity', anchor: 'activity',
    title: 'Live activity',
    body: 'Meals and logs as they land, newest first.',
  },
  {
    key: 'followups', anchor: 'followups',
    title: 'Nothing gets lost',
    body: 'Anything you flag waits here until you close it.',
  },
];

/* Three steps, and that is honestly the whole parent surface. Padding it would be worse than
   ending early. The visibility step is the one that matters — it is the answer to the question
   every parent actually has. */
const PARENT_STEPS = [
  {
    key: 'children', anchor: 'children',
    title: 'The athletes you follow',
    body: 'Everyone you are linked to shows up here.',
  },
  {
    key: 'visibility', anchor: 'visibility',
    title: 'What you can see',
    body: "Their standard and whether the work is happening. Not their photos, not their messages.",
  },
  {
    key: 'funding', anchor: 'funding',
    title: 'You can cover their plan',
    body: 'Fund an athlete from here and they keep full access.',
  },
];

const STEPS_BY_ROLE = Object.freeze({
  athlete: ATHLETE_STEPS,
  coach: OPERATOR_STEPS,
  trainer: OPERATOR_STEPS,
  parent: PARENT_STEPS,
});

const resolve = (v, ctx) => (typeof v === 'function' ? v(ctx) : v);

/**
 * Plan the tour for one person, right now.
 *
 * Pure: everything judged is passed in. An empty `steps` array means "do not open" — the caller
 * needs no other signal, and a repaint after completion is a no-op by construction.
 *
 * @param {object} ctx
 * @param {string|null} ctx.role         RT.authRole — 'athlete'|'coach'|'trainer'|'parent'
 * @param {string} [ctx.audience]        S.audience — 'client' swaps coach→trainer in athlete copy
 * @param {string} [ctx.goal]            baseGoal or the onboarding answer
 * @param {boolean} [ctx.hasCoach]       linked to a coach or a trainer
 * @param {boolean} [ctx.hasStandards]   has at least one Connected Standard
 * @param {string|null} [ctx.seenAt]     RT.tourSeen[id] — any truthy value suppresses
 * @param {string} [ctx.route]           current hash route, must be the role's landing route
 * @param {boolean} [ctx.replay]         Settings replay — bypasses the seen check only
 * @returns {{id: string|null, steps: Array<{key,anchor,title,body}>, reason: string}}
 *          reason is always set, so a silent no is diagnosable.
 */
export function planTour(ctx) {
  if (!ctx || typeof ctx !== 'object') return { id: null, steps: [], reason: 'no-context' };

  const role = ctx.role;
  const id = TOUR_IDS[role];
  const defs = STEPS_BY_ROLE[role];
  // 'client' and 'nutritionist' are onboarding role keys with no user_role of their own; whoever
  // signed up that way carries a real role here, and audience handles the wording.
  if (!id || !defs) return { id: null, steps: [], reason: 'unknown-role' };

  // Never over onboarding, never over a detour into Settings. The landing screen is the only
  // place where every anchor this tour points at can exist.
  if (ctx.route !== LANDING[role]) return { id, steps: [], reason: 'wrong-route' };

  if (ctx.seenAt && !ctx.replay) return { id, steps: [], reason: 'already-seen' };

  const steps = defs
    .filter((d) => (typeof d.when === 'function' ? !!d.when(ctx) : true))
    .map((d) => ({
      key: d.key,
      anchor: d.anchor,
      title: resolve(d.title, ctx),
      body: resolve(d.body, ctx),
    }));

  return { id, steps, reason: 'ok' };
}

/**
 * Drop steps whose element isn't on screen, and decide whether what's left is still a tour.
 *
 * Home fills #cs-slot and #seen-row asynchronously and renders its hero on only some branches, so
 * a planned step can have no element by the time we paint. A missing anchor is normal, never an
 * error. But a "tour" of one lone step is worse than no tour — so below `min` we abandon entirely.
 *
 * Pure: `resolveRect` is injected, so the whole thing tests with plain objects.
 *
 * @param {Array} steps
 * @param {(anchor: string) => ({width:number,height:number}|null)} resolveRect
 * @param {{min?: number}} [opts] min surviving steps to still be worth showing (default 2)
 * @returns {Array} the surviving steps, or [] if fewer than min survived
 */
export function filterSteps(steps, resolveRect, opts) {
  const min = opts && Number.isFinite(opts.min) ? opts.min : 2;
  const list = Array.isArray(steps) ? steps : [];
  const alive = list.filter((s) => {
    let r = null;
    try { r = resolveRect(s.anchor); } catch { return false; }
    return !!r && Number(r.width) > 0 && Number(r.height) > 0;
  });
  return alive.length >= min ? alive : [];
}
