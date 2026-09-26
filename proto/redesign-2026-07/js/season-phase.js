/* The season phase, the words half (goals and eating plan, phase B, 2026-09-26).
 *
 * The phase belongs to the team (0252 teams.season_phase); a solo athlete may set their own. The
 * NUMBERS live in state.js (PHASE_CAL, goalDerivedTargets): this file never computes a target, it
 * only names the phase and says what it does, so every surface that speaks about it (the coach's
 * sheet, the Plan hero, Why these numbers) says the same thing. Pure: no DOM, no Supabase, no
 * clock. Lazy: nothing here is in the boot graph.
 *
 * THE RULES
 *  1. Goal-derived calories only. A coach-set number is never moved, and the line says so.
 *  2. Minors: no weight words (surplus, deficit, weight, lose, cut, bulk). A minor's line is the
 *     training-and-recovery family, whatever their goal says (the opener-why rule).
 *  3. Intuitive: no figures. The plate says what changes instead.
 *  4. Deterministic text the app writes, never signed as Nia. No em dashes.
 */
import { canEditStandards, normalizeRole } from './staff-access.js';

export const PHASES = [
  { key: 'off', label: 'Off-season', short: 'Off', meaning: 'Build. The full plan for each goal.' },
  { key: 'pre', label: 'Pre-season', short: 'Pre', meaning: 'Ramp up. A little more fuel as training climbs.' },
  { key: 'in', label: 'In-season', short: 'In', meaning: 'Perform and recover. Fuel for games comes first.' },
  { key: 'post', label: 'Post-season', short: 'Post', meaning: 'Recover and reset. A little less fuel as training eases.' },
];

export const isPhase = (k) => PHASES.some((p) => p.key === k);
export const phaseInfo = (k) => PHASES.find((p) => p.key === k) || null;
export const phaseLabel = (k) => { const p = phaseInfo(k); return p ? p.label : null; };

/** Who may set the TEAM's phase: the staff who edit its standard (0252 can_set_team_phase holds
 *  the same list). Fails CLOSED while the role loads: the spec says the control never renders for
 *  view-only staff, and a control that flashes then vanishes is worse than one that arrives late. */
export const PHASE_SETTER_ROLES = ['head_coach', 'coordinator', 'nutritionist', 's_and_c', 'team_admin'];
export function canSetSeason(role) {
  const r = normalizeRole(role);
  return !!r && PHASE_SETTER_ROLES.includes(r) && canEditStandards(r);
}

/** The line the coach confirms before a change: what it does for athletes, in plain words. */
export function confirmLine(phase) {
  if (!phase) return 'Clears the season. Goal-based targets go back to their base plan. Numbers you set stay as they are.';
  const say = {
    off: 'Goal-based targets go back to the full plan for each goal.',
    pre: 'Athletes on goal-based targets get a little more fuel as training ramps up.',
    in: 'Athletes on goal-based targets get more fuel for games. Gainers keep a smaller surplus.',
    post: 'Athletes on goal-based targets ease back a little while they recover.',
  }[phase];
  return `${say} Numbers you set stay exactly as they are.`;
}

/* What each phase means for each goal, as one sentence. The minor set carries no weight words. */
const LINES = {
  gain: {
    off: 'Off-season: the full surplus. This is the time to build.',
    pre: 'Pre-season: the full surplus while training ramps up.',
    in: 'In-season: a smaller surplus, so energy for games comes first.',
    post: 'Post-season: a smaller surplus while your body recovers and resets.',
  },
  lose: {
    off: 'Off-season: the full plan for your goal.',
    pre: 'Pre-season: a little more fuel as training ramps up.',
    in: 'In-season: more fuel than your off-season plan, so games and practice come first.',
    post: 'Post-season: the full plan for your goal while you recover.',
  },
  maintain: {
    off: 'Off-season: holding steady on the base plan.',
    pre: 'Pre-season: a little more fuel as training ramps up.',
    in: 'In-season: more fuel for games and practice.',
    post: 'Post-season: a little less fuel while training eases off.',
  },
  perform: {
    off: 'Off-season: the base plan while you build.',
    pre: 'Pre-season: a little more fuel as training ramps up.',
    in: 'In-season: more fuel for games, practice and recovery.',
    post: 'Post-season: a little less fuel while you recover and reset.',
  },
};
const PLATE_LINES = {
  off: 'Off-season: build every plate like this, every day.',
  pre: 'Pre-season: add the second fist of carbs on the hard ramp-up days.',
  in: 'In-season: the extra fist of carbs goes around games and practice.',
  post: 'Post-season: plates like this while your body recovers and resets.',
};

/**
 * The Why screen's season line. null when no phase applies.
 *   phase       'off' | 'pre' | 'in' | 'post' | null
 *   family      'gain' | 'lose' | 'maintain' | 'perform' | null (plan-why-model goalFamily)
 *   coachSet    the calories were set by a coach or trainer (or accepted by the athlete)
 *   minor       a provable minor (0050)
 *   numbers     the plan style shows calories
 *   adjust      state.js phaseCalAdjust(goal, phase): the calories the phase moved
 *   mode        'numbers' | 'plate'
 */
export function whyPhaseLine({ phase, family = null, coachSet = false, minor = false, numbers = true, adjust = 0, mode = 'numbers' } = {}) {
  const info = phaseInfo(phase);
  if (!info) return null;
  if (mode === 'plate') return { label: info.label, text: PLATE_LINES[phase] };
  if (coachSet) return { label: info.label, text: `${info.label}: the season does not move numbers your coach set.` };
  const fam = minor || !family ? 'perform' : family;
  let text = LINES[fam][phase];
  if (numbers && !minor && adjust) {
    text += ` That is ${Math.abs(adjust)} calories ${adjust > 0 ? 'more' : 'less'} a day than the off-season plan.`;
  }
  return { label: info.label, text };
}

/** The Plan hero's goal line: "Gaining · In-season". The phase joins the goal label, never
 *  replaces it; a weight range, when the hero has one, stays last. */
export function heroGoalLine(label, phase, range) {
  return [label, phaseLabel(phase), range].filter(Boolean).join(' · ');
}
