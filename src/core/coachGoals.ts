// OnStandard — coach goal-setting model (pure TS, no RN imports).
// The Scoring Contract (Constitution 11a / Rule #13): the COACH owns the plan —
// targets + which scoring profile measures the athlete — and the platform owns the
// formula. The AI RECOMMENDS, it never dictates. This module is the deterministic
// recommendation the coach editor shows next to the editable fields, plus the
// option metadata for the profile picker. The coach's saved values always win.
import type { ScoringProfile } from './types';
import { PROTEIN_TARGET, CAL_TARGET, WEIGHT_TARGET } from './constants';

export interface GoalTargets {
  protein: number;
  calories: number;
  weight: number;
}

/** Clamp ranges mirror the athlete's own Profile steppers, so a coach can't set a
 *  target the app can't render or score sanely. */
export const TARGET_LIMITS = {
  protein: { min: 80, max: 320, step: 10 },
  calories: { min: 1200, max: 6000, step: 50 },
  weight: { min: 120, max: 350, step: 1 },
} as const;

export interface ScoringProfileOption {
  key: ScoringProfile;
  label: string;
  desc: string;
}

/** The two shipped scoring profiles (Constitution 11b "design for many, ship two").
 *  The coach picks which one measures this athlete; the platform owns each formula. */
export const SCORING_PROFILE_OPTIONS: ScoringProfileOption[] = [
  { key: 'athlete', label: 'Athlete', desc: 'Performance-first: protein + recovery weighted highest.' },
  { key: 'general', label: 'General', desc: 'Habit-first: balanced nutrition, hydration, and consistency.' },
];

/**
 * The science-based recommendation the editor shows as a suggestion (the coach can
 * accept or override). Athlete profiles lean higher protein for performance; general
 * profiles use a moderate, sustainable floor. Deterministic — the same inputs always
 * yield the same suggestion. Body weight stays at the platform default (the coach
 * sets the real season target from the athlete's own number).
 */
export function recommendTargets(profile: ScoringProfile): GoalTargets {
  if (profile === 'general') {
    return { protein: 140, calories: 2400, weight: WEIGHT_TARGET };
  }
  return { protein: PROTEIN_TARGET, calories: CAL_TARGET, weight: WEIGHT_TARGET };
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** Clamp a coach-entered target into its rendered/scoreable range. */
export function clampTarget(kind: keyof GoalTargets, value: number): number {
  const l = TARGET_LIMITS[kind];
  return clamp(Math.round(value), l.min, l.max);
}

/** A one-line plain-language summary of the plan, for the editor's confirmation row. */
export function goalPlanSummary(name: string, t: GoalTargets, profile: ScoringProfile): string {
  const lens = profile === 'general' ? 'General' : 'Athlete';
  return `${name || 'This athlete'}: ${t.protein}g protein · ${t.calories} cal · ${lens} scoring.`;
}
