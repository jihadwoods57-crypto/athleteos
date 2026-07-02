// OnStandard core — Performance Profile projection (doc-05 §4). PURE, framework-agnostic.
//
// The athlete-owned, portable record, projected read-only from immutable history + the profile row +
// AI Memory. It never writes anything and never invents a number — consistency comes from the score
// history, preferences from confirmed memory facts, strengths/weaknesses from deterministic signals.
// The LLM reads this as immutable context; recommendations go through ai_recommendations + arbitrate.

import { activeFacts, safetyConstraints, type MemoryFact } from './memory';
import type { TrendDir } from './types';

export interface ProfilePreferences {
  favoriteFoods: string[];
  favoriteRestaurants: string[];
  allergies: string[];
  dislikes: string[];
  budgetBand: string | null;
}

export interface CoachFeedback {
  authorId: string;
  scope: string;
  text: string;
  at: string;
}

export interface PerformanceProfileView {
  athleteId: string;
  consistency: { last7: number; last30: number; trend: TrendDir };
  preferences: ProfilePreferences;
  strengths: string[];
  weaknesses: string[];
  feedback: CoachFeedback[];
}

export interface ProfileInputs {
  athleteId: string;
  /** Daily scores, most-recent LAST. Immutable history (doc-03); never rewritten here. */
  recentScores: number[];
  facts: MemoryFact[];
  profileRow?: { feedback_log?: CoachFeedback[] } | null;
}

const avg = (xs: number[]): number => (xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : 0);

function trendOf(xs: number[]): TrendDir {
  if (xs.length < 2) return 'flat';
  const delta = xs[xs.length - 1] - xs[0];
  return delta > 2 ? 'up' : delta < -2 ? 'down' : 'flat';
}

/** Project the read-only profile view. Pure: derives everything from the inputs, invents nothing. */
export function buildProfileView(input: ProfileInputs): PerformanceProfileView {
  const scores = input.recentScores;
  const last7 = avg(scores.slice(-7));
  const last30 = avg(scores.slice(-30));
  const trend = trendOf(scores.slice(-7));

  const active = activeFacts(input.facts);
  const valuesOf = (kind: MemoryFact['kind']): string[] =>
    active.filter((f) => f.kind === kind).map((f) => String(f.value));
  const safety = safetyConstraints(input.facts);

  const preferences: ProfilePreferences = {
    favoriteFoods: valuesOf('favorite_food'),
    favoriteRestaurants: valuesOf('favorite_restaurant'),
    allergies: safety.filter((c) => c.kind === 'allergy').map((c) => String(c.value)),
    dislikes: safety.filter((c) => c.kind === 'dislike').map((c) => String(c.value)),
    budgetBand: valuesOf('budget')[0] ?? null,
  };

  const strengths: string[] = [];
  const weaknesses: string[] = [];
  if (last7 >= 80) strengths.push('consistently on standard');
  if (trend === 'up') strengths.push('trending up');
  if (last7 > 0 && last7 < 65) weaknesses.push('below standard recently');
  if (trend === 'down') weaknesses.push('trending down');

  return {
    athleteId: input.athleteId,
    consistency: { last7, last30, trend },
    preferences,
    strengths,
    weaknesses,
    feedback: input.profileRow?.feedback_log ?? [],
  };
}
