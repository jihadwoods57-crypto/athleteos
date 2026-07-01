// OnStandard — Nutrition Memory (pure TS, no RN / Supabase imports).
//
// The differentiator: OnStandard doesn't just grade today's meal, it REMEMBERS. This engine
// reads the athlete's logged history and surfaces longitudinal insights a tracker never
// could — "3 weeks ago you averaged 18g protein at breakfast; now 37g", "you've skipped
// dinner 3 of the last 5 days", "down 4 lb, on track to your goal". That's coaching, not
// tracking, and it's hard to copy because it compounds with every meal logged.
//
// Pure + deterministic: every insight is COMPUTED from real logged data (StoredMeal rows
// when the backend is live; the daily nutrition-score + weight series otherwise). Nothing
// is invented — when there isn't enough history, the engine says so (readiness) rather than
// fabricating a trend. The AI layer later only rephrases these; the numbers are ours.
import type { AppState, DayScore, MealKey, StoredMeal, WeightPoint } from './types';
import { daysAgoStamp } from './clock';

/** Direction of the athlete's weight goal, to read a weight change as progress or drift. */
export type WeightGoalDirection = 'lose' | 'gain' | 'maintain';

export interface NutritionMemoryInput {
  /** Per-meal rows across days (rich, backend-live). May be empty offline. */
  meals: StoredMeal[];
  /** Daily nutrition sub-score, one point per past day (accumulates at day rollover). */
  nutritionHistory: DayScore[];
  /** Daily body-weight points. */
  weightHistory: WeightPoint[];
  /** The athlete's protein target (g), to judge streaks and slot gaps. */
  proteinTarget: number;
  /** Goal weight (lb), when set. */
  weightTarget?: number | null;
  /** Which way "good" is for weight, so a change reads as progress vs drift. */
  weightDirection?: WeightGoalDirection;
}

/** Tone token-NAME (UI maps to a color token, never a hex here). */
export type MemoryTone = 'win' | 'watch' | 'neutral';

export type MemoryKind =
  | 'slot_protein_trend'
  | 'score_trend'
  | 'protein_streak'
  | 'slot_gap'
  | 'weight_progress'
  | 'signature_meal'
  | 'description_bias'
  | 'logging_completeness';

/** One remembered insight — a headline, a plain-English detail, and a compact metric. */
export interface MemoryInsight {
  id: string;
  kind: MemoryKind;
  tone: MemoryTone;
  /** Short headline, e.g. "Breakfast protein is climbing". */
  headline: string;
  /** The evidence in plain English, e.g. "3 weeks ago you averaged 18g; now you're at 37g." */
  detail: string;
  /** Compact at-a-glance figure, e.g. "+19g" or "5 days". */
  metric?: string;
  /** Internal ranking weight (bigger = more prominent). Not rendered. */
  rank: number;
}

export interface MemoryReadiness {
  /** Distinct days that carry any logged signal (meals or a nutrition score). */
  daysLogged: number;
  /** Total per-meal rows available (0 offline until the backend is live). */
  mealsLogged: number;
  /** True once there's enough history for at least one trend insight. */
  ready: boolean;
}

const SLOTS: MealKey[] = ['breakfast', 'lunch', 'snack', 'dinner'];
const SLOT_LABEL: Record<MealKey, string> = { breakfast: 'Breakfast', lunch: 'Lunch', snack: 'Snack', dinner: 'Dinner' };

function mean(xs: number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}
function round(n: number): number {
  return Math.round(n);
}

/** Normalize a StoredMeal.type to a slot key, or null if unrecognized. */
function slotOf(m: StoredMeal): MealKey | null {
  const t = (m.type ?? '').toLowerCase();
  return (SLOTS as string[]).includes(t) ? (t as MealKey) : null;
}

/** Distinct day count across meals + nutrition history. */
function daysLoggedCount(input: NutritionMemoryInput): number {
  const days = new Set<string>();
  for (const m of input.meals) days.add(m.day_date);
  for (const d of input.nutritionHistory) days.add(d.date);
  return days.size;
}

export function memoryReadiness(input: NutritionMemoryInput): MemoryReadiness {
  const daysLogged = daysLoggedCount(input);
  const mealsLogged = input.meals.length;
  // One trend needs a before AND an after; 4 distinct days is the floor where a split mean
  // is meaningful (2 early + 2 recent), or 6 per-meal rows for a slot trend.
  const ready = daysLogged >= 4 || mealsLogged >= 6;
  return { daysLogged, mealsLogged, ready };
}

/** Split a chronologically-sorted series into an early third and a recent third (≥1 each). */
function endWindows<T>(sorted: T[]): { early: T[]; recent: T[] } {
  const n = sorted.length;
  const w = Math.max(1, Math.floor(n / 3));
  return { early: sorted.slice(0, w), recent: sorted.slice(n - w) };
}

/** Per-slot protein: early-window avg vs recent-window avg. The flagship insight. */
function slotProteinTrends(meals: StoredMeal[]): MemoryInsight[] {
  const out: MemoryInsight[] = [];
  for (const slot of SLOTS) {
    const rows = meals
      .filter((m) => slotOf(m) === slot && typeof m.protein === 'number')
      .sort((a, b) => a.day_date.localeCompare(b.day_date));
    if (rows.length < 6) continue; // need real before/after evidence
    const { early, recent } = endWindows(rows);
    const earlyAvg = mean(early.map((m) => m.protein as number));
    const recentAvg = mean(recent.map((m) => m.protein as number));
    const delta = recentAvg - earlyAvg;
    if (Math.abs(delta) < 5) continue; // ignore noise
    const up = delta > 0;
    out.push({
      id: `slot_protein_${slot}`,
      kind: 'slot_protein_trend',
      tone: up ? 'win' : 'watch',
      headline: `${SLOT_LABEL[slot]} protein is ${up ? 'climbing' : 'slipping'}`,
      detail: up
        ? `Earlier you averaged ${round(earlyAvg)}g of protein at ${slot}; now you're at ${round(recentAvg)}g. One of your biggest improvements.`
        : `You used to average ${round(earlyAvg)}g of protein at ${slot}; lately it's ${round(recentAvg)}g. Worth rebuilding that habit.`,
      metric: `${up ? '+' : ''}${round(delta)}g`,
      rank: 100 + Math.abs(delta),
    });
  }
  return out;
}

/** Nutrition sub-score over time: early avg vs recent avg. */
function scoreTrend(history: DayScore[]): MemoryInsight | null {
  const sorted = [...history].sort((a, b) => a.date.localeCompare(b.date));
  if (sorted.length < 4) return null;
  const { early, recent } = endWindows(sorted);
  const earlyAvg = mean(early.map((d) => d.score));
  const recentAvg = mean(recent.map((d) => d.score));
  const delta = recentAvg - earlyAvg;
  if (Math.abs(delta) < 3) return null;
  const up = delta > 0;
  return {
    id: 'score_trend',
    kind: 'score_trend',
    tone: up ? 'win' : 'watch',
    headline: up ? 'Your nutrition is trending up' : 'Your nutrition has slipped',
    detail: up
      ? `Your nutrition score has gone from about ${round(earlyAvg)} to ${round(recentAvg)} over the stretch you've logged. The work is showing.`
      : `Your nutrition score has drifted from about ${round(earlyAvg)} to ${round(recentAvg)}. Let's get back on it.`,
    metric: `${up ? '+' : ''}${round(delta)}`,
    rank: 70 + Math.abs(delta),
  };
}

/** Total protein per day from meals → trailing consecutive days at/above target. */
function proteinStreak(meals: StoredMeal[], target: number): MemoryInsight | null {
  if (!meals.length || target <= 0) return null;
  const byDay = new Map<string, number>();
  for (const m of meals) {
    if (typeof m.protein === 'number') byDay.set(m.day_date, (byDay.get(m.day_date) ?? 0) + m.protein);
  }
  const days = Array.from(byDay.keys()).sort((a, b) => b.localeCompare(a)); // newest first
  let streak = 0;
  for (const d of days) {
    if ((byDay.get(d) ?? 0) >= target) streak++;
    else break;
  }
  if (streak < 3) return null;
  return {
    id: 'protein_streak',
    kind: 'protein_streak',
    tone: 'win',
    headline: 'Protein streak going',
    detail: `${streak} days in a row you've hit your ${target}g protein target. Don't break the chain.`,
    metric: `${streak} days`,
    rank: 80 + streak,
  };
}

/** A slot frequently missed across the recent logged days. */
function slotGap(meals: StoredMeal[]): MemoryInsight | null {
  if (meals.length < 6) return null;
  const days = Array.from(new Set(meals.map((m) => m.day_date))).sort((a, b) => b.localeCompare(a)).slice(0, 5);
  if (days.length < 4) return null;
  const daySet = new Set(days);
  let worst: { slot: MealKey; missed: number } | null = null;
  for (const slot of SLOTS) {
    const logged = new Set(meals.filter((m) => slotOf(m) === slot && daySet.has(m.day_date)).map((m) => m.day_date));
    const missed = days.length - logged.size;
    if (missed >= 3 && (!worst || missed > worst.missed)) worst = { slot, missed };
  }
  if (!worst) return null;
  return {
    id: `slot_gap_${worst.slot}`,
    kind: 'slot_gap',
    tone: 'watch',
    headline: `${SLOT_LABEL[worst.slot]} keeps slipping`,
    detail: `You've missed logging ${worst.slot} on ${worst.missed} of the last ${days.length} days. That's the gap to close first.`,
    metric: `${worst.missed}/${days.length}`,
    rank: 75 + worst.missed,
  };
}

/** Weight movement read against the goal direction. */
function weightProgress(history: WeightPoint[], target: number | null | undefined, dir: WeightGoalDirection | undefined): MemoryInsight | null {
  const sorted = [...history].sort((a, b) => a.date.localeCompare(b.date));
  if (sorted.length < 4) return null;
  const first = sorted[0].weight;
  const last = sorted[sorted.length - 1].weight;
  const delta = last - first;
  if (Math.abs(delta) < 1) return null;
  const down = delta < 0;
  // Progress when movement matches the goal direction (lose→down, gain→up).
  const onTrack = dir === 'lose' ? down : dir === 'gain' ? !down : false;
  const near = typeof target === 'number' ? ` ${Math.abs(last - target) <= 2 ? "You're basically at your goal." : `${round(Math.abs(last - target))} lb to your goal.`}` : '';
  return {
    id: 'weight_progress',
    kind: 'weight_progress',
    tone: onTrack ? 'win' : 'neutral',
    headline: onTrack ? 'Weight is moving your way' : 'Weight trend',
    detail: `${down ? 'Down' : 'Up'} ${round(Math.abs(delta))} lb over the days you've logged.${near}`,
    metric: `${down ? '-' : '+'}${round(Math.abs(delta))} lb`,
    rank: 50 + Math.abs(delta),
  };
}

/** The most-logged meal name (the athlete's go-to), with its average quality. */
function signatureMeal(meals: StoredMeal[]): MemoryInsight | null {
  const byName = new Map<string, { count: number; quality: number[] }>();
  for (const m of meals) {
    const name = (m.name ?? '').trim();
    if (!name) continue;
    const e = byName.get(name) ?? { count: 0, quality: [] };
    e.count++;
    if (typeof m.quality === 'number') e.quality.push(m.quality);
    byName.set(name, e);
  }
  let best: { name: string; count: number; quality: number[] } | null = null;
  for (const [name, e] of byName) {
    if (e.count >= 3 && (!best || e.count > best.count)) best = { name, ...e };
  }
  if (!best) return null;
  const q = best.quality.length ? round(mean(best.quality)) : null;
  return {
    id: 'signature_meal',
    kind: 'signature_meal',
    tone: 'neutral',
    headline: 'Your go-to meal',
    detail: `You've logged ${best.name} ${best.count} times${q != null ? `, averaging ${q} quality` : ''}. The OnStandard knows your kitchen.`,
    metric: `×${best.count}`,
    rank: 40 + best.count,
  };
}

/**
 * Description-vs-photo bias (Slice 4). When an athlete's typed notes consistently under-rate what
 * the photo shows (the AI set descriptionSignal='photo_heavier'), surface a SOFT pattern for the
 * coach — never per-incident. One fried plate is nothing; a habit of lowballing is a portion
 * conversation. Needs ≥5 described meals and ≥60% running lighter than the photo.
 */
function descriptionBiasInsight(meals: StoredMeal[]): MemoryInsight | null {
  const described = meals.filter(
    (m) => m.description_signal === 'match' || m.description_signal === 'photo_heavier' || m.description_signal === 'photo_lighter',
  );
  if (described.length < 5) return null;
  const heavier = described.filter((m) => m.description_signal === 'photo_heavier').length;
  if (heavier / described.length < 0.6) return null;
  return {
    id: 'description_bias',
    kind: 'description_bias',
    tone: 'watch',
    headline: 'Notes tend to run lighter than the plate',
    detail: `On ${heavier} of the last ${described.length} described meals, the photo showed more than the note said. Might be portion awareness worth a quick chat, not a red flag.`,
    metric: `${heavier}/${described.length}`,
    rank: 62 + heavier,
  };
}

/**
 * Logging completeness (Slice 4). The real coach counts logs: "only 3 pics yesterday, no
 * snacks/shakes." Track meals logged per active day and whether snacks/shakes show up. Flags a
 * SOFT pattern when logging is consistently thin — the between-meal calories that go untracked.
 */
function loggingCompletenessInsight(meals: StoredMeal[]): MemoryInsight | null {
  if (meals.length < 6) return null;
  const days = Array.from(new Set(meals.map((m) => m.day_date))).sort((a, b) => b.localeCompare(a)).slice(0, 7);
  if (days.length < 3) return null;
  const daySet = new Set(days);
  const inWindow = meals.filter((m) => daySet.has(m.day_date));
  const perDay = inWindow.length / days.length;
  const snackDays = new Set(inWindow.filter((m) => slotOf(m) === 'snack').map((m) => m.day_date)).size;
  const halfDays = Math.ceil(days.length / 2);
  // A full day is roughly three meals plus a snack/shake; only flag when it's genuinely thin.
  if (perDay >= 3 && snackDays >= halfDays) return null;
  const mainsOkSnacksThin = perDay >= 3 && snackDays < halfDays;
  return {
    id: 'logging_completeness',
    kind: 'logging_completeness',
    tone: 'watch',
    headline: mainsOkSnacksThin ? 'Snacks and shakes are going unlogged' : 'Some meals are going unlogged',
    detail: mainsOkSnacksThin
      ? `Main meals are logged, but a snack or shake showed up on only ${snackDays} of the last ${days.length} days. Those between-meal calories count.`
      : `About ${perDay.toFixed(1)} meals a day logged over the last ${days.length}. Getting all three plus a snack in gives the full picture.`,
    metric: `${perDay.toFixed(1)}/day`,
    rank: 56 + Math.round((3 - Math.min(3, perDay)) * 5),
  };
}

/**
 * Build the ranked list of remembered insights from the logged history. Pure: every line is
 * computed from real data, so an insight only appears when the evidence is there. Returns at
 * most `limit` insights, highest-signal first.
 */
export function nutritionMemory(input: NutritionMemoryInput, limit = 6): MemoryInsight[] {
  const insights: MemoryInsight[] = [
    ...slotProteinTrends(input.meals),
    scoreTrend(input.nutritionHistory),
    proteinStreak(input.meals, input.proteinTarget),
    slotGap(input.meals),
    weightProgress(input.weightHistory, input.weightTarget, input.weightDirection),
    signatureMeal(input.meals),
    descriptionBiasInsight(input.meals),
    loggingCompletenessInsight(input.meals),
  ].filter((x): x is MemoryInsight => x !== null);
  return insights.sort((a, b) => b.rank - a.rank).slice(0, limit);
}

/**
 * Coach-facing deterministic patterns over ONE linked athlete's recent meals (no app-state
 * needed): the description-vs-photo bias and logging-completeness signals, highest-signal first.
 * The same engine the athlete's memory uses, scoped for the coach's PersonDetail view. Pure;
 * inherits RLS scope from whoever fetched the rows. Empty when no pattern has formed.
 */
export function coachMealPatterns(meals: StoredMeal[]): MemoryInsight[] {
  return [descriptionBiasInsight(meals), loggingCompletenessInsight(meals)]
    .filter((x): x is MemoryInsight => x !== null)
    .sort((a, b) => b.rank - a.rank);
}

/** The memory surface's full view-model: ranked insights + whether they're real or sampled. */
export interface NutritionMemoryView {
  insights: MemoryInsight[];
  /** True when there isn't enough real history yet, so the preview seed is shown (UI tags it). */
  sampled: boolean;
  readiness: MemoryReadiness;
}

/** Latest weight in a series, or null. */
function latestWeight(history: WeightPoint[]): number | null {
  if (!history.length) return null;
  return [...history].sort((a, b) => a.date.localeCompare(b.date))[history.length - 1].weight;
}

/**
 * Derive the memory view from app state. Uses REAL logged history (backend meal rows when
 * live, the daily nutrition-score + weight series otherwise) once there's enough of it;
 * until then it shows the SAMPLE seed (flagged sampled=true) so the surface is demonstrable
 * in the free preview — the same honest pattern the trend charts use. `today` is injectable.
 */
export function nutritionMemoryFromState(
  s: Pick<AppState, 'mealHistory' | 'nutritionHistory' | 'weightHistory' | 'proteinTarget' | 'weightTarget'>,
  today: Date = new Date(),
): NutritionMemoryView {
  const last = latestWeight(s.weightHistory ?? []);
  const target = s.weightTarget ?? null;
  const weightDirection: WeightGoalDirection | undefined =
    target != null && last != null ? (target < last ? 'lose' : target > last ? 'gain' : 'maintain') : undefined;
  const real: NutritionMemoryInput = {
    meals: s.mealHistory ?? [],
    nutritionHistory: s.nutritionHistory ?? [],
    weightHistory: s.weightHistory ?? [],
    proteinTarget: s.proteinTarget || 140,
    weightTarget: target,
    weightDirection,
  };
  const ready = memoryReadiness(real).ready;
  const input = ready ? real : sampleMemoryInput(today);
  return { insights: nutritionMemory(input), sampled: !ready, readiness: memoryReadiness(input) };
}

/**
 * A believable seeded history for the free-preview / not-enough-data state, so the memory
 * surface is demonstrable before a real history exists — the sibling of seededHistory() for
 * the trend charts. The UI tags this SAMPLE; it's replaced by real data the moment the
 * athlete has logged enough (or the backend is live). `today` is injectable for tests.
 */
export function sampleMemoryInput(today: Date = new Date()): NutritionMemoryInput {
  const d = (n: number) => daysAgoStamp(n, today);
  // Breakfast protein climbs 18g → 37g; dinner gets skipped lately; a clear go-to dinner.
  const meals: StoredMeal[] = [];
  const push = (dayAgo: number, type: MealKey, name: string, protein: number, quality: number) =>
    meals.push({ type, name, protein, kcal: protein * 9, quality, photo_path: null, day_date: d(dayAgo), logged_at: `${d(dayAgo)}T12:00:00Z` });
  // breakfasts across 18 days, rising protein
  [18, 16, 14].forEach((n) => push(n, 'breakfast', 'Toast & Juice', 17, 70));
  [11, 9, 7].forEach((n) => push(n, 'breakfast', 'Eggs & Oats', 28, 84));
  [4, 2, 1].forEach((n) => push(n, 'breakfast', 'Egg White Scramble', 37, 92));
  // a go-to dinner logged repeatedly
  [16, 12, 7, 3].forEach((n) => push(n, 'dinner', 'Chicken, Rice & Broccoli', 52, 94));
  // lunches steady
  [14, 9, 5, 2].forEach((n) => push(n, 'lunch', 'Turkey & Quinoa Bowl', 44, 90));
  const nutritionHistory: DayScore[] = [14, 12, 10, 8, 6, 4, 2, 1].map((n, i) => ({ date: d(n), score: 70 + i * 2 }));
  const weightHistory: WeightPoint[] = [21, 14, 7, 1].map((n, i) => ({ date: d(n), weight: 188 - i * 2 }));
  return { meals, nutritionHistory, weightHistory, proteinTarget: 140, weightTarget: 178, weightDirection: 'lose' };
}
