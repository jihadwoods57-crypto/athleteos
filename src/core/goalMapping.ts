// OnStandard — goal -> base-goal -> scoring config mapping (pure TS, no RN imports).
//
// The onboarding goal screen collects a rich `primaryGoal` (12 options grouped Performance /
// Body Composition / Athletic Development). The scoring engine reasons in 4 `BaseGoal` buckets, and
// a solo client never gets a coach to set their targets. Before this module, primaryGoal was never
// mapped to baseGoal (it stayed the 'gain' default) and the targets stayed athlete constants, so a
// "Lose Fat" user was scored as a performance athlete and pointed at a weight GAIN. This is the
// single keystone that makes goal selection actually drive the experience.
import type { BaseGoal, ScoringProfile } from './types';
import { CAL_TARGET, PROTEIN_TARGET, WEIGHT_START, WEIGHT_TARGET } from './constants';
import { profileForGoal } from './scoringProfiles';

/** Map a rich onboarding primaryGoal key to the platform's 4-bucket BaseGoal. Body-composition goals
 *  map by intent; Performance + Athletic-Development goals are all 'performance' (the athlete formula).
 *  An absent/unknown goal defaults to 'performance' so existing athletes/tests are unchanged. */
export function baseGoalForPrimary(primaryGoal: string | null | undefined): BaseGoal {
  switch (primaryGoal) {
    case 'gain_weight':
    case 'gain_muscle':
      return 'gain';
    case 'lose_fat':
      return 'lose';
    case 'maintain':
      return 'maintain';
    default:
      return 'performance';
  }
}

export interface GoalDerivedTargets {
  proteinTarget: number;
  calTarget: number;
  weightTarget: number;
}

const round5 = (n: number): number => Math.round(n / 5) * 5;
const round50 = (n: number): number => Math.round(n / 50) * 50;

/**
 * Daily targets derived from the goal + bodyweight (lb). These are the v1 DEFAULTS a solo client gets
 * at signup (a coach can still override). Tunable constants pending RD sign-off:
 *  - lose:    mild deficit (~12 kcal/lb), high protein (~0.9 g/lb), weight target ~8% below current.
 *  - gain:    surplus (~17 kcal/lb), ~1 g/lb protein, weight target ~8% above current.
 *  - maintain: ~15 kcal/lb, ~0.8 g/lb protein, weight target = current.
 *  - performance: the shipped athlete constants UNCHANGED (so the seeded demo + tests are byte-for-byte).
 */
// Safety floors so a low-bodyweight user (the weight stepper floors at 70 lb, and the app signs up
// 13+) is NEVER handed a clinically dangerous target. An unsupervised solo client is never told to
// eat below these, regardless of the per-lb formula. Tunable, but the floors are the safety contract.
const MIN_CAL_TARGET = 1500;
const MIN_PROTEIN_TARGET = 80;

export function deriveTargetsFromGoal(goal: BaseGoal, bodyweightLb: number): GoalDerivedTargets {
  const bw = bodyweightLb > 0 ? bodyweightLb : WEIGHT_START;
  const safeP = (n: number) => Math.max(MIN_PROTEIN_TARGET, round5(n));
  const safeCal = (n: number) => Math.max(MIN_CAL_TARGET, round50(n));
  switch (goal) {
    case 'lose':
      return { proteinTarget: safeP(bw * 0.9), calTarget: safeCal(bw * 12), weightTarget: Math.round(bw * 0.92) };
    case 'gain':
      return { proteinTarget: safeP(bw * 1.0), calTarget: safeCal(bw * 17), weightTarget: Math.round(bw * 1.08) };
    case 'maintain':
      return { proteinTarget: safeP(bw * 0.8), calTarget: safeCal(bw * 15), weightTarget: Math.round(bw) };
    case 'performance':
    default:
      return { proteinTarget: PROTEIN_TARGET, calTarget: CAL_TARGET, weightTarget: WEIGHT_TARGET };
  }
}

export interface GoalConfig extends GoalDerivedTargets {
  scoringProfile: ScoringProfile;
}

/**
 * The full goal-derived account config applied at activation: scoring profile + targets, from the
 * user's goal + bodyweight. A coach-set profile (existingProfile) always wins — we never override it.
 * Likewise, a target the user has already moved OFF the shipped default (proxy for "they edited it on
 * the about-you step") is preserved, not clobbered by the derived default. Both onboarding completion
 * paths (finishOb + startFirstMealChallenge) call this so the experience is identical either way.
 */
export function goalConfig(
  goal: BaseGoal,
  bodyweightLb: number,
  existingProfile?: ScoringProfile,
  existing?: Partial<GoalDerivedTargets>,
): GoalConfig {
  const derived = deriveTargetsFromGoal(goal, bodyweightLb);
  // Keep an existing value only when the user moved it off the shipped constant default; otherwise
  // apply the goal-derived default.
  const keep = (val: number | undefined, derivedVal: number, constDefault: number) =>
    val != null && val !== constDefault ? val : derivedVal;
  return {
    scoringProfile: existingProfile ?? profileForGoal(goal),
    proteinTarget: keep(existing?.proteinTarget, derived.proteinTarget, PROTEIN_TARGET),
    calTarget: keep(existing?.calTarget, derived.calTarget, CAL_TARGET),
    weightTarget: keep(existing?.weightTarget, derived.weightTarget, WEIGHT_TARGET),
  };
}
