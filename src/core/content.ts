// AthleteOS — content data + display-string helpers (pure).
// Ported from the prototype: meal log, meal-analysis results, AI insight, pace.
import type { AppState, Derived, MealKey, MealLabel } from './types';
import { MEAL_MACROS } from './constants';

export interface LoggedMeal {
  id: string;
  name: string;
  time: string;
  quality: number;
  kcal: number;
  protein: number;
  carbs: number;
  fat: number;
  thumb: [string, string];
  foods: { n: string; p: string }[];
  sub: { l: string; s: number }[];
  note: string;
}

export const MEALS_LOG: LoggedMeal[] = [
  {
    id: 'b',
    name: 'Overnight Oats & Berries',
    time: '7:40 AM',
    quality: 88,
    kcal: 520,
    protein: 42,
    carbs: 68,
    fat: 12,
    thumb: ['#FDE68A', '#F59E0B'],
    foods: [
      { n: 'Rolled oats', p: '1 cup' },
      { n: 'Greek yogurt', p: '¾ cup' },
      { n: 'Blueberries', p: '½ cup' },
      { n: 'Almond butter', p: '1 tbsp' },
    ],
    sub: [
      { l: 'Protein density', s: 90 },
      { l: 'Whole foods', s: 94 },
      { l: 'Macro balance', s: 84 },
      { l: 'Meal timing', s: 86 },
    ],
    note: 'Great recovery breakfast. The yogurt and oats give you slow-release energy for a morning lift.',
  },
  {
    id: 'l',
    name: 'Chicken & Rice Bowl',
    time: '12:30 PM',
    quality: 91,
    kcal: 680,
    protein: 51,
    carbs: 72,
    fat: 16,
    thumb: ['#BBF7D0', '#22C55E'],
    foods: [
      { n: 'Grilled chicken', p: '6 oz' },
      { n: 'Brown rice', p: '1.5 cups' },
      { n: 'Black beans', p: '½ cup' },
      { n: 'Avocado', p: '¼' },
    ],
    sub: [
      { l: 'Protein density', s: 94 },
      { l: 'Whole foods', s: 90 },
      { l: 'Macro balance', s: 92 },
      { l: 'Meal timing', s: 88 },
    ],
    note: 'Excellent lunch — high protein with clean carbs. Ideal 2-3 hours before practice.',
  },
  {
    id: 's',
    name: 'Greek Yogurt & Almonds',
    time: '3:15 PM',
    quality: 89,
    kcal: 300,
    protein: 49,
    carbs: 24,
    fat: 10,
    thumb: ['#DDD6FE', '#8B5CF6'],
    foods: [
      { n: 'Greek yogurt', p: '1 cup' },
      { n: 'Almonds', p: '¼ cup' },
      { n: 'Honey', p: '1 tbsp' },
      { n: 'Blueberries', p: '½ cup' },
    ],
    sub: [
      { l: 'Protein density', s: 92 },
      { l: 'Whole foods', s: 88 },
      { l: 'Macro balance', s: 80 },
      { l: 'Meal timing', s: 90 },
    ],
    note: 'Smart high-protein snack between lunch and dinner — keeps you in a surplus.',
  },
];

export interface MealResult {
  name: string;
  quality: number;
  protein: number;
  kcal: number;
  carbs: number;
  fat: number;
  detected: string[];
  note: string;
}

export const MEAL_RESULTS: Record<MealLabel, MealResult> = {
  Breakfast: { name: 'Veggie Omelette & Toast', quality: 90, protein: 38, kcal: 480, carbs: 34, fat: 22, detected: ['Eggs', 'Spinach', 'Whole-grain toast', 'Feta'], note: 'Strong protein start. Add fruit for micronutrients and you’re at an A.' },
  Lunch: { name: 'Turkey & Quinoa Bowl', quality: 92, protein: 46, kcal: 620, carbs: 58, fat: 18, detected: ['Ground turkey', 'Quinoa', 'Peppers', 'Avocado'], note: 'Excellent lunch — lean protein with clean carbs, ideal pre-practice.' },
  Dinner: { name: 'Chicken, Rice & Broccoli', quality: 94, protein: 52, kcal: 680, carbs: 64, fat: 18, detected: ['Grilled chicken', 'Brown rice', 'Broccoli', 'Olive oil'], note: 'Excellent protein hit for dinner. Add a piece of fruit and this is a perfect plate.' },
  Snack: { name: 'Greek Yogurt & Berries', quality: 89, protein: 24, kcal: 240, carbs: 22, fat: 6, detected: ['Greek yogurt', 'Blueberries', 'Honey', 'Almonds'], note: 'Great high-protein snack to close the gap before bed.' },
};

export function mealResultFor(mealType: MealLabel): MealResult {
  return MEAL_RESULTS[mealType] ?? MEAL_RESULTS.Dinner;
}

/** Tone token-name for a quality badge — the UI maps it to color tokens (never a hex). */
export type QualityTone = 'success' | 'accent' | 'warning';
export interface QualityLabel {
  label: string;
  tone: QualityTone;
}

/**
 * Map a 0..100 meal-quality score to its badge label + tone so the word the badge
 * shows always tracks the number (89 must read GOOD, not EXCELLENT). Pure: returns a
 * tone token-NAME, never a color value, so it stays RN-import-free in src/core.
 */
export function qualityLabel(quality: number): QualityLabel {
  if (quality >= 90) return { label: 'EXCELLENT', tone: 'success' };
  if (quality >= 80) return { label: 'GOOD', tone: 'accent' };
  if (quality >= 70) return { label: 'FAIR', tone: 'accent' };
  return { label: 'NEEDS WORK', tone: 'warning' };
}

/** One row of the Nutrition "Today's Meals" list — logged data or a log-next prompt. */
export interface MealRow {
  key: MealKey;
  /** Capitalized label used by the capture flow (setMealType) and mealResultFor. */
  label: MealLabel;
  /** Id the detail overlay resolves against (MEALS_LOG ids: b/l/s, dinner fallback). */
  detailId: string;
  logged: boolean;
  name: string;
  protein: number;
  kcal: number;
  quality: number;
  /** Accent swatch / dashed-border color for the row. */
  thumb: string;
  /** Coach-voice "Due by ..." subtitle for the unlogged prompt. */
  dueTime: string;
}

/** Fixed slot order — mirrors computeDerived's iteration of s.meals. */
const SLOT_ORDER: MealKey[] = ['breakfast', 'lunch', 'snack', 'dinner'];

const SLOT_META: Record<MealKey, { label: MealLabel; detailId: string; thumb: string; dueTime: string }> = {
  breakfast: { label: 'Breakfast', detailId: 'b', thumb: '#F59E0B', dueTime: 'Due by 9:00 AM' },
  lunch: { label: 'Lunch', detailId: 'l', thumb: '#22C55E', dueTime: 'Due by 1:00 PM' },
  snack: { label: 'Snack', detailId: 's', thumb: '#8B5CF6', dueTime: 'Due by 4:00 PM' },
  dinner: { label: 'Dinner', detailId: 'dinner', thumb: '#EF4444', dueTime: 'Due by 8:00 PM' },
};

/**
 * Build the per-slot row model for all four meal slots from day state.
 * Name + quality come from mealResultFor(); protein + kcal come from MEAL_MACROS
 * (the same source computeDerived sums) so the rendered rows agree with the
 * "N of 4 logged" header and the macro totals.
 */
export function mealRowsFor(state: AppState): MealRow[] {
  return SLOT_ORDER.map((key) => {
    const meta = SLOT_META[key];
    const result = mealResultFor(meta.label);
    const macros = MEAL_MACROS[key];
    return {
      key,
      label: meta.label,
      detailId: meta.detailId,
      logged: state.meals[key],
      name: result.name,
      protein: macros.p,
      kcal: macros.k,
      quality: result.quality,
      thumb: meta.thumb,
      dueTime: meta.dueTime,
    };
  });
}

/** Reactive Home insight — celebrates only when the day is genuinely complete. */
export function aiInsight(state: AppState, derived: Derived): string {
  const dayComplete =
    derived.mealsLoggedCount === 4 && derived.proteinToday >= derived.proteinTarget;
  if (dayComplete) {
    return 'Day complete — every meal logged and protein over target. This is what an A week looks like; keep the streak alive.';
  }
  const close = state.meals.dinner
    ? 'log your remaining meals to close the day at an A.'
    : 'log dinner to close the day at an A.';
  return `Protein and recovery are tracking well. You’re ${derived.proteinGap}g from your protein target — ${close}`;
}

export type HeroTone = 'positive' | 'neutral' | 'warn';
export interface HeroStatus {
  line: string;
  standingLabel: string;
  tone: HeroTone;
}

/**
 * Reactive score-hero status — the most prominent surface in the app, so it must
 * never confidently tell a behind athlete they are "on pace". Branches off the
 * SAME dayComplete gate as aiInsight (mealsLoggedCount===4 && proteinToday>=target)
 * plus the live score band; the specific ask is built from real derived values
 * (proteinGap / meals remaining) so a line never claims completion that did not
 * happen. standingLabel is grade-derived — no fabricated precise percentile.
 */
export function heroStatus(state: AppState, derived: Derived): HeroStatus {
  const dayComplete =
    derived.mealsLoggedCount === 4 && derived.proteinToday >= derived.proteinTarget;
  const score = derived.athleteScore;
  const g = derived.grade.g;

  const standingLabel =
    g === 'A' ? 'Top of your team' :
    g === 'B' ? 'Upper third of your team' :
    g === 'C' ? 'Middle of your team' :
    'Work to do this week'; // D / F

  const mealsLeft = 4 - derived.mealsLoggedCount;
  const ask =
    derived.proteinGap > 0
      ? `${derived.proteinGap}g of protein to go`
      : mealsLeft > 0
        ? `${mealsLeft} meal${mealsLeft === 1 ? '' : 's'} left to log`
        : 'finish the day strong';

  if (dayComplete) {
    // Genuinely complete day (every meal logged, protein cleared). Completion copy
    // is gated on dayComplete ALONE — never fall through to a score-band branch that
    // builds an `ask` from proteinGap/mealsLeft (both zero here), which would nag an
    // athlete who has nothing left to do. Band only sets tone/copy, never an ask.
    if (score >= 90) {
      return { line: 'Day complete and you cleared an A — keep the streak rolling.', standingLabel, tone: 'positive' };
    }
    if (score >= 80) {
      return { line: 'Day complete — every meal in and protein cleared. Recovery is the only thing keeping you off an A.', standingLabel, tone: 'positive' };
    }
    return { line: 'Day complete — everything logged. Lock in recovery to lift the grade.', standingLabel, tone: 'neutral' };
  }
  if (score >= 80) {
    // On pace (A/B), day not yet complete.
    return { line: `Tracking well — ${ask} to lock in an A today.`, standingLabel, tone: 'positive' };
  }
  if (score < 70) {
    // Behind (D/F) — honest, never "on pace".
    return { line: `You're behind today — ${ask} to climb back up.`, standingLabel, tone: 'warn' };
  }
  // Mid 70..79 (C): neutral nudge.
  return { line: `You're close — ${ask} to push into the green.`, standingLabel, tone: 'neutral' };
}

export interface PaceProjection {
  daysLeft: number;
  surplus: number;
  goalPct: number;
  onPace: boolean;
  paceLabel: string;
  paceAi: string;
  projected: number;
}

/** Nutrition weekly-goal pace projection from the coach-set weekly lb goal. */
export function paceProjection(weeklyGoalLb: number): PaceProjection {
  const goal = weeklyGoalLb;
  const daysLeft = 3;
  const progressLb = 0.6;
  const daysElapsed = 4;
  const surplus = Math.round((goal * 3500) / 7);
  const projected = +((progressLb / daysElapsed) * 7).toFixed(1);
  const onPace = projected >= goal - 0.001;
  const goalPct = Math.min(100, Math.round((progressLb / goal) * 100));
  const paceLabel = onPace ? '↑ On pace' : '↓ Behind pace';
  let paceAi: string;
  if (projected > goal) {
    paceAi = `You're tracking to +${projected} lb by Sunday — a touch ahead. Ease back ~${Math.round(((projected - goal) * 3500) / 3)} cal/day to land exactly on target.`;
  } else if (onPace) {
    paceAi = `You're tracking to +${projected} lb by Sunday — right on target. Keep the surplus steady.`;
  } else {
    paceAi = `At today's intake you'll reach +${projected} lb. Add ~${Math.round(((goal - projected) * 3500) / 3)} cal/day over the next ${daysLeft} days to stay on track.`;
  }
  return { daysLeft, surplus, goalPct, onPace, paceLabel, paceAi, projected };
}

export interface VisibilityRow {
  key: string;
  title: string;
  sub: string;
}

/**
 * "Who can see your data" rows derived from the athlete's chosen support team
 * (onboarding `supportTeam`). Empty when the athlete is solo, so the Profile can
 * show an intentional empty state instead of leaking the demo's Coach Davis /
 * Sarah to a brand-new athlete who connected no one.
 */
export function supportVisibilityRows(supportTeam: string[]): VisibilityRow[] {
  const map: Record<string, VisibilityRow> = {
    coach: { key: 'coach', title: 'Your coach', sub: 'Full profile & history' },
    trainer: { key: 'trainer', title: 'Your trainer', sub: 'Full profile & history' },
    nutritionist: { key: 'nutritionist', title: 'Your nutritionist', sub: 'Meals & nutrition' },
    parent: { key: 'parent', title: 'Parent / guardian', sub: 'Weekly reports & alerts' },
  };
  return supportTeam.map((k) => map[k]).filter(Boolean);
}

/** Position abbreviation → full label for the profile subtitle. */
export const POSITION_LABELS: Record<string, string> = {
  QB: 'Quarterback', RB: 'Running Back', WR: 'Wide Receiver', OL: 'Offensive Line',
  DL: 'Defensive Line', LB: 'Linebacker', DB: 'Defensive Back', PG: 'Point Guard',
  SG: 'Shooting Guard', SF: 'Small Forward', PF: 'Power Forward', C: 'Center',
};

/**
 * Profile subtitle from the athlete's REAL onboarding selections. A real athlete
 * who chose a sport gets "{position} · {sport}" (or "{sport} athlete" if they
 * skipped position), so it never hard-codes the seed school. With no sport set
 * (the seeded demo, athleteName ''), it falls back to the demo identity
 * "Linebacker · Eastside HS" so the showcase is unchanged.
 */
export function athleteSubtitle(position: string | null, sport?: string | null): string {
  const hasSport = !!(sport && sport.trim());
  if (!position) return hasSport ? `${sport} athlete` : 'Linebacker · Eastside HS';
  const label = POSITION_LABELS[position] ?? position;
  return `${label} · ${hasSport ? sport : 'Eastside HS'}`;
}
