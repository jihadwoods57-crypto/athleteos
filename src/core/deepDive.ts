// OnStandard — Deep Dive payload + result model (add-on build 2026-07-04; pure TS).
//
// The weekly Deep Dive sends the model a BOUNDED summary of the athlete's real computed
// data (the deep-analysis edge function enforces the weekly cap server-side). This module
// builds that payload deterministically — every number in it comes from state the scoring
// engine already produced, so the model physically cannot see (or leak) anything the app
// didn't compute. Caps keep the paid call small: 28 days of scores/nutrition, 60 weight
// points, today's macro snapshot.
import type { DayScore, WeightPoint } from './types';

export interface DeepDiveSection {
  title: string;
  body: string;
}

export interface DeepDiveResult {
  headline: string;
  sections: DeepDiveSection[];
  focus: string;
}

export interface DeepDivePayload {
  goal: string | null;
  /** Daily accountability scores, oldest -> newest (bounded). */
  scores: DayScore[];
  /** Nutrition sub-scores, oldest -> newest (bounded). */
  nutrition: DayScore[];
  /** Weight points, oldest -> newest (bounded). */
  weights: WeightPoint[];
  /** Today's live macro snapshot. */
  today: { score: number; protein: number; proteinTarget: number; kcal: number; kcalTarget: number };
  /** The current streak + weekly compliance the app already shows. */
  streakDays: number;
  compliancePct: number;
}

export const DEEP_SCORE_DAYS = 28;
export const DEEP_WEIGHT_POINTS = 60;

export function buildDeepDivePayload(s: {
  baseGoal?: string | null;
  scoreHistory: DayScore[];
  nutritionHistory: DayScore[];
  weightHistory: WeightPoint[];
  liveScore: number;
  proteinToday: number;
  proteinTarget: number;
  kcalToday: number;
  calTarget: number;
  streakDays: number;
  compliancePct: number;
}): DeepDivePayload {
  return {
    goal: s.baseGoal ?? null,
    scores: s.scoreHistory.slice(-DEEP_SCORE_DAYS),
    nutrition: s.nutritionHistory.slice(-DEEP_SCORE_DAYS),
    weights: s.weightHistory.slice(-DEEP_WEIGHT_POINTS),
    today: {
      score: s.liveScore,
      protein: Math.round(s.proteinToday),
      proteinTarget: Math.round(s.proteinTarget),
      kcal: Math.round(s.kcalToday),
      kcalTarget: Math.round(s.calTarget),
    },
    streakDays: s.streakDays,
    compliancePct: s.compliancePct,
  };
}

/** Whether enough real history exists for a dive worth its weekly slot. The model is told
 *  to be honest about thin data, but below this the app shouldn't spend the slot at all. */
export const DEEP_MIN_DAYS = 7;

export function deepDiveReady(scoreHistory: DayScore[]): boolean {
  return scoreHistory.length >= DEEP_MIN_DAYS;
}

/** Validate/narrow a server response into a renderable result (defensive: the UI renders
 *  whatever survives; garbage in any field drops the whole result rather than half-render). */
export function parseDeepDiveResult(raw: unknown): DeepDiveResult | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.headline !== 'string' || !r.headline.trim()) return null;
  if (typeof r.focus !== 'string' || !r.focus.trim()) return null;
  if (!Array.isArray(r.sections)) return null;
  const sections: DeepDiveSection[] = [];
  for (const s of r.sections) {
    if (!s || typeof s !== 'object') return null;
    const sec = s as Record<string, unknown>;
    if (typeof sec.title !== 'string' || typeof sec.body !== 'string') return null;
    sections.push({ title: sec.title, body: sec.body });
  }
  if (sections.length === 0) return null;
  return { headline: r.headline, sections: sections.slice(0, 4), focus: r.focus };
}
