/* The first-run tour: which steps a given person gets, and in what order.
 *
 * Onboarding collected answers and then dropped people onto a screen nobody had ever explained.
 * This module decides what to explain. It is pure — no DOM, no clock, no storage — so the whole
 * personalization matrix is testable (tour-plan.test.mjs IS the spec).
 *
 * Three axes of personalization:
 *   WHETHER at all ← only a brand-new account auto-tours (isNewAccount). Existing users are never
 *                    ambushed by an OTA; Settings replay is the deliberate way back in.
 *   WHICH steps    ← the role. Four lists: athlete, coach, trainer, parent.
 *   WHICH WORDS    ← what they set up. Goal shapes the plan line; a linked coach and a connected
 *                    wearable each unlock an optional step; a fitness client hears "trainer".
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
    body: "One number for the whole day. Every meal, session, and commitment you log moves it, and it settles when the day locks at midnight. Tap it any time to see exactly what's counted and what's still open.",
  },
  {
    key: 'log', anchor: 'log',
    title: 'Everything starts here',
    body: 'Photograph a meal and the AI reads the plate — the breakdown lands in seconds. Training, weight, and check-ins live behind this button too. Gold dot means something is due; red means it is overdue.',
  },
  {
    key: 'plan', anchor: 'plan',
    title: 'Your plan lives here',
    body: (ctx) => `The Plan tab is what today asks of you — meals, training, and check-ins, in order.${GOAL_TAIL[ctx.goal] || ''} It marks itself off as you log, so a glance tells you what's left.`,
  },
  {
    key: 'progress', anchor: 'progress',
    title: 'Proof it adds up',
    body: 'Score trend, streak, and weight over time. One day is a data point — this tab is where weeks of showing up become something you can see.',
  },
  {
    key: 'coach-seen', anchor: 'coach-seen',
    when: (ctx) => !!ctx.hasCoach,
    title: (ctx) => `Your ${operatorNoun(ctx)} sees this`,
    body: (ctx) => `Everything you log reaches your ${operatorNoun(ctx)} the moment it lands — meals, training, the number itself. This line shows when they've looked, so you never wonder whether the work went noticed.`,
  },
  {
    key: 'standards', anchor: 'standards',
    when: (ctx) => !!ctx.hasStandards,
    title: 'Some of it verifies itself',
    body: 'Connected Standards read your watch and confirm the work without you logging a thing. A dead battery never becomes a miss — you can always log it yourself.',
  },
  {
    key: 'profile', anchor: 'profile',
    title: 'Yours to adjust',
    body: 'Your goal, your connections, and your settings live under Profile. You can replay this tour from there any time.',
  },
  {
    key: 'close', anchor: 'log',
    title: "That's the whole loop",
    body: 'Log, watch your number move, keep the streak alive. Start now — photograph your next meal and see your Standard answer.',
  },
];

/* Coach and trainer render the same screen module, so they share anchors. Only the nouns differ:
   a trainer has a practice full of clients where a coach has a team full of athletes.

   `invite` is planned unconditionally and DOM-filtered: the invite card only renders on the
   empty-team dashboard, where the four board anchors below it don't exist. So a populated board
   drops `invite`, and a brand-new operator — who used to get NO tour at all, because the empty
   board had no anchors — gets a real orientation: the code, the create menu, and the tabs. */
const OPERATOR_STEPS = [
  {
    key: 'invite', anchor: 'invite',
    title: 'The code is the door',
    body: (ctx) => (ctx.role === 'trainer'
      ? 'Clients join by entering your practice code — set it up here and hand it out. From then on your board fills itself in: their meals, their scores, who needs you.'
      : 'Athletes join by entering your team code — set it up here and hand it out. From then on your board fills itself in: their meals, their scores, who needs you.'),
  },
  {
    key: 'roster', anchor: 'roster',
    title: 'Everything here is scoped',
    body: (ctx) => (ctx.role === 'trainer'
      ? 'This board answers one question: how is your practice doing right now. Use this switch to narrow it from every client to a single group — every card below follows.'
      : 'This board answers one question: how is the team doing right now. Use this switch to narrow it from the whole team to a single group — every card below follows.'),
  },
  {
    key: 'priority', anchor: 'priority',
    title: 'Who needs you today',
    body: (ctx) => (ctx.role === 'trainer'
      ? 'Your clients, ranked by who needs attention — slipping scores, overdue logs, flags you set. Handle one and it leaves the queue. Start here every morning and nobody slips through.'
      : 'Your athletes, ranked by who needs attention — slipping scores, overdue logs, flags you set. Handle one and it leaves the queue. Start here every morning and nobody slips through.'),
  },
  {
    key: 'activity', anchor: 'activity',
    title: 'Live activity',
    body: 'Every meal and log the moment it lands, newest first. The blue dot marks what you haven\'t opened. Tap any card to see the plate and answer in the thread.',
  },
  {
    key: 'followups', anchor: 'followups',
    title: 'Nothing gets lost',
    body: "Join requests, unopened logs, anything you flag — it waits here until you close it. An empty list means you're genuinely caught up, not that something slipped.",
  },
  {
    key: 'create', anchor: 'create',
    title: 'Set the standard',
    body: (ctx) => (ctx.role === 'trainer'
      ? "Assign requirements, set verified standards, send announcements, message a client — everything you put in motion starts here, and it shows up on their Home as part of their day."
      : "Assign requirements, schedule verified commitments, send announcements, message anyone — everything you put in motion starts here, and it shows up on each athlete's Home as part of their day."),
  },
  {
    key: 'tab-roster', anchor: 'tab-roster',
    title: (ctx) => (ctx.role === 'trainer' ? 'Your full book' : 'Your full roster'),
    body: (ctx) => (ctx.role === 'trainer'
      ? 'Every client with their score and streak. Tap anyone to open their full book — trends, meals, targets, and a direct thread.'
      : 'Every athlete with their score and streak, and the groups you\'ve made. Tap anyone to open their full book — trends, meals, targets, and a direct thread.'),
  },
  {
    key: 'tab-inbox', anchor: 'tab-inbox',
    title: 'Where conversations live',
    body: (ctx) => (ctx.role === 'trainer'
      ? 'Join requests and client threads in one place. The badge counts what\'s waiting on you.'
      : 'Join requests and athlete threads in one place. The badge counts what\'s waiting on you.'),
  },
  {
    key: 'tab-you', anchor: 'tab-you',
    title: 'Your account',
    body: (ctx) => (ctx.role === 'trainer'
      ? 'Practice settings, plans and billing, and sign-out live under You. You can replay this tour from there any time.'
      : 'Team settings, plans and billing, and sign-out live under You. You can replay this tour from there any time.'),
  },
];

/* Four steps, and that is honestly the whole parent surface. Padding it would be worse than
   ending early. The visibility step is the one that matters — it is the answer to the question
   every parent actually has. */
const PARENT_STEPS = [
  {
    key: 'children', anchor: 'children',
    title: 'The athletes you follow',
    body: "Everyone you're linked to shows up here with their daily score and grade. It updates as they log — a quiet way to know the work is happening without hovering.",
  },
  {
    key: 'link', anchor: 'link',
    title: 'Linking takes one code',
    body: 'Ask your athlete for their invite code and enter it here. You can follow more than one.',
  },
  {
    key: 'visibility', anchor: 'visibility',
    title: "What you can see — and what you can't",
    body: 'Their daily score, their grade, and the date of their latest logged day. Meal photos, weight, and check-in answers stay between your athlete and their coach. That line is deliberate.',
  },
  {
    key: 'funding', anchor: 'funding',
    title: 'You can cover their plan',
    body: "Fund an athlete's plan from here and they keep full access — nothing about their day changes. Everything you're paying for stays listed under Funded plans.",
  },
];

const STEPS_BY_ROLE = Object.freeze({
  athlete: ATHLETE_STEPS,
  coach: OPERATOR_STEPS,
  trainer: OPERATOR_STEPS,
  parent: PARENT_STEPS,
});

const resolve = (v, ctx) => (typeof v === 'function' ? v(ctx) : v);

/** How long after signup an account still counts as brand-new. Generous on purpose: signup on a
    laptop Friday, first app open the next week, still toured. The seen flag — not this window —
    is what guarantees at-most-once. */
export const FIRST_RUN_WINDOW_DAYS = 7;

/**
 * Is this account new enough to be on its first-signup run?
 *
 * The founder call (2026-08-05): the tour is for people who just signed up, full stop. An account
 * that predates the window — every user who existed before a tour change ships — must never be
 * ambushed by an OTA. Unparseable or missing createdAt is NOT new: failing silent beats touring
 * an account of unknown age, and the caller's seen flag stays unwritten so a later boot with a
 * hydrated profile self-heals.
 *
 * @param {string|null|undefined} createdAt  profiles.created_at — the server birthday
 * @param {number} nowMs                     Date.now(), passed in so this stays pure
 */
export function isNewAccount(createdAt, nowMs) {
  if (!createdAt || !Number.isFinite(nowMs)) return false;
  const t = Date.parse(createdAt);
  if (!Number.isFinite(t)) return false;
  return nowMs - t <= FIRST_RUN_WINDOW_DAYS * 24 * 60 * 60 * 1000;
}

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
 * @param {string|null} [ctx.createdAt]  profiles.created_at — only a brand-new account auto-tours
 * @param {number} [ctx.now]             Date.now(), injected for purity
 * @param {string} [ctx.route]           current hash route, must be the role's landing route
 * @param {boolean} [ctx.replay]         Settings replay — bypasses seen + the first-signup gate
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

  // First-signup only (2026-08-05): the tour auto-opens for brand-new accounts, never for
  // accounts that predate it. Replay from Settings is the deliberate exception. A missing
  // createdAt suppresses WITHOUT marking seen — same self-healing shape as unknown-role.
  if (!ctx.replay) {
    if (!ctx.createdAt) return { id, steps: [], reason: 'no-birthdate' };
    if (!isNewAccount(ctx.createdAt, ctx.now)) return { id, steps: [], reason: 'existing-account' };
  }

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

/** Breathing room between the highlighted rect and the card that describes it. */
const GAP = 12;

/**
 * Where the card goes, given the thing it points at.
 *
 * Below the anchor by default; flipped above when there isn't room below; clamped to the viewport
 * on both axes so a card never hangs off an edge. Pure arithmetic on plain objects, which is why
 * it lives here rather than in the driver — this is where a card ends up covering the very thing
 * it is describing, and that is worth pinning exactly.
 *
 * @param {{top:number,left:number,width:number,height:number}} a  anchor rect
 * @param {{width:number,height:number}} c  card size
 * @param {{width:number,height:number}} vp viewport size
 * @param {number} [pad] minimum distance from any viewport edge
 * @returns {{top:number,left:number,placement:'below'|'above'}}
 */
export function placeCard(a, c, vp, pad = 12) {
  const below = a.top + a.height + GAP;
  const above = a.top - GAP - c.height;
  // Prefer below; go above only when below would run off the bottom AND above actually fits.
  const fitsBelow = below + c.height + pad <= vp.height;
  const fitsAbove = above >= pad;
  const placement = fitsBelow || !fitsAbove ? 'below' : 'above';
  let top = placement === 'below' ? below : above;
  top = Math.min(Math.max(pad, top), Math.max(pad, vp.height - c.height - pad));

  // Centre on the anchor, then clamp. Centring on a full-width anchor is the same as centring
  // on the screen, which is what we want anyway.
  let left = a.left + a.width / 2 - c.width / 2;
  left = Math.min(Math.max(pad, left), Math.max(pad, vp.width - c.width - pad));

  return { top, left, placement };
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
