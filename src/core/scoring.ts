// OnStandard — reactive scoring engine (pure functions).
// Ported verbatim from OnStandard.dc.html renderVals() / gradeFor().
import {
  CAL_TARGET,
  CARB_TARGET,
  FAT_TARGET,
  MEAL_MACROS,
  PROTEIN_TARGET,
  QUICK_FOODS,
  HYDRATION_TARGET,
  WEIGHT_START,
  WEIGHT_TARGET,
} from './constants';
import { trendSeries } from './history';
import { mealMacros, type MacroSet } from './mealEdit';
import { DEFAULT_PLAN } from './coachPlan';
import { profileNutritionScore, PROFILE_WEIGHTS, resolveProfile } from './scoringProfiles';
import type { AppState, CiConfig, Derived, Grade, MealKey } from './types';

/** A meal logged after its window deadline counts half toward the score's "meals" share. */
const LATE_MEAL_WEIGHT = 0.5;

/**
 * Logged meals weighted by punctuality — the Accountability Engine's execution signal in
 * the Development Score (Feature 8). A meal logged AFTER its window deadline counts half; a
 * slot with NO recorded time counts full (on-time), so the seeded demo + every legacy day
 * (no timestamps) score exactly as before. Only real late logging lowers the number.
 *
 * Whether punctuality is even collected is the engines master switch's call: the store only
 * stamps `mealLoggedAt` when `isEnginesEnabled` (see useStore `addMeal`/`saveMeal`). With the
 * engines OFF (first-beta config) no timestamps exist, so every meal is on-time here and the
 * score is untouched, honoring the ratified keystone. This function stays pure + flag-agnostic.
 */
export function effectiveMealsLogged(s: Pick<AppState, 'meals' | 'mealLoggedAt'>): number {
  return (Object.keys(s.meals) as MealKey[]).reduce((sum, k) => {
    if (!s.meals[k]) return sum;
    const at = s.mealLoggedAt?.[k];
    const deadline = DEFAULT_PLAN.windows.find((w) => w.key === k)?.deadlineMin ?? 1440;
    const onTime = at == null || at <= deadline;
    return sum + (onTime ? 1 : LATE_MEAL_WEIGHT);
  }, 0);
}

/**
 * The macros a single logged meal slot contributes. When the athlete has SAVED an
 * edited plate for the slot (`mealFoods[k]`), the totals come from those real
 * per-food macros; otherwise we fall back to the per-slot `MEAL_MACROS` constant.
 * This is what makes the loop real — a logged-and-edited meal moves the score,
 * while the seeded demo (no `mealFoods`) stays byte-for-byte unchanged.
 */
export function mealSlotMacros(s: Pick<AppState, 'mealFoods'>, k: MealKey): MacroSet {
  const saved = s.mealFoods?.[k];
  if (saved) return mealMacros(saved);
  const m = MEAL_MACROS[k];
  return { protein: m.p, kcal: m.k, carbs: m.c, fat: m.f };
}

/** Sum the macros across every LOGGED slot, using saved edited plates when present. */
export function loggedDayMacros(s: Pick<AppState, 'meals' | 'mealFoods'>): MacroSet {
  return (Object.keys(s.meals) as MealKey[]).reduce<MacroSet>(
    (a, k) => {
      if (!s.meals[k]) return a;
      const mm = mealSlotMacros(s, k);
      return {
        protein: a.protein + mm.protein,
        kcal: a.kcal + mm.kcal,
        carbs: a.carbs + mm.carbs,
        fat: a.fat + mm.fat,
      };
    },
    { protein: 0, kcal: 0, carbs: 0, fat: 0 },
  );
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/**
 * Pure season-goal progress against fixed start/target weights.
 * remaining = target - current ("+N to go"; <=0 once at/over target).
 * pctThere = clamped 0..100 of how far current sits between start and target.
 */
export function seasonGoalProgress(
  currentWeight: number,
  start: number,
  target: number,
): { remaining: number; pctThere: number } {
  const remaining = Math.round((target - currentWeight) * 10) / 10;
  // Degenerate range (start === target, e.g. a maintain goal, or a day-0 athlete
  // whose onboarding weight equals the default target): there is no span to
  // measure progress across, so (current - start)/(target - start) is 0/0 = NaN.
  // Treat "at or above the line" as 100% there, below as 0% — never NaN%.
  const span = target - start;
  const pctThere =
    span === 0
      ? currentWeight >= target
        ? 100
        : 0
      : Math.round(clamp(((currentWeight - start) / span) * 100, 0, 100));
  return { remaining, pctThere };
}

export type SeasonGoalPhase = 'first-run' | 'tracking' | 'reached';

/**
 * Decide whether the season-goal card may make a pace claim yet.
 * A brand-new athlete sits at their starting anchor with no recorded weight
 * history, so claiming "On track, you'll reach X by Nov 7" is a lie (there is no
 * pace to project from zero data). Return 'first-run' until they have moved off
 * the start weight OR logged at least one prior-day weight point; 'reached' once
 * at/over the goal; otherwise 'tracking'.
 */
export function seasonGoalPhase(opts: {
  pctThere: number;
  currentWeight: number;
  start: number;
  weightHistoryLen: number;
}): SeasonGoalPhase {
  if (opts.pctThere >= 100) return 'reached';
  if (opts.currentWeight === opts.start && opts.weightHistoryLen === 0) return 'first-run';
  return 'tracking';
}

export interface ScoreWeight {
  key: 'nutrition' | 'recovery' | 'tasks' | 'checkin';
  label: string;
  /** Whole-number percent weight in the Accountability Score (the four sum to 100). */
  pct: number;
  /** Plain-language, honest description of the input behind this component. */
  desc: string;
}

/**
 * Plain-language breakdown of what the Accountability Score is made of, mirrored
 * EXACTLY from computeDerived's athleteScore formula:
 *   0.5*nutrition + 0.25*recovery + 0.15*tasks + 0.1*checkin.
 * Surfaced by the Home "What's in this score?" panel so the number stops being
 * opaque. Descriptions are honest about which inputs are self-reported. Weight
 * progress is tracked SEPARATELY (a long-arc goal), not folded into this daily
 * score. No new data is introduced here; these are the existing weights, named.
 */
export const SCORE_WEIGHTS: ScoreWeight[] = [
  { key: 'nutrition', label: 'Nutrition', pct: 50, desc: 'Protein and the meals you log each day' },
  { key: 'recovery', label: 'Recovery', pct: 25, desc: 'Your own weekly check-in answers, so this part is self-reported' },
  { key: 'tasks', label: 'Tasks', pct: 15, desc: 'The daily tasks you complete' },
  { key: 'checkin', label: 'Check-in', pct: 10, desc: 'Completing your weekly check-in at all' },
];

/** Letter grade + colors for a 0–100 score. */
export function gradeFor(score: number): Grade {
  if (score >= 90) return { g: 'A', bg: '#DCFCE7', c: '#16A34A' };
  if (score >= 80) return { g: 'B', bg: '#EFF6FF', c: '#2563EB' };
  if (score >= 70) return { g: 'C', bg: '#FEF3C7', c: '#D97706' };
  if (score >= 60) return { g: 'D', bg: '#FFEDD5', c: '#EA580C' };
  return { g: 'F', bg: '#FEE2E2', c: '#DC2626' };
}

/**
 * Compute every value the UI derives from day state. One selector, called
 * everywhere, so Home / Nutrition / Squad / role views stay in sync.
 */
export function computeDerived(s: AppState): Derived {
  const mealKeys = Object.keys(s.meals) as MealKey[];
  const mealsLoggedCount = mealKeys.filter((k) => s.meals[k]).length;

  const quickGrams = QUICK_FOODS.reduce((a, f, i) => a + (s.quickAdded[i] ? f.g : 0), 0);
  const quickKcal = QUICK_FOODS.reduce((a, f, i) => a + (s.quickAdded[i] ? f.k : 0), 0);
  const quickCarbs = QUICK_FOODS.reduce((a, f, i) => a + (s.quickAdded[i] ? f.c : 0), 0);
  const quickFat = QUICK_FOODS.reduce((a, f, i) => a + (s.quickAdded[i] ? f.f : 0), 0);

  // Real macros: saved edited plates per slot when present, the slot constant
  // otherwise. The seeded demo carries no mealFoods, so its numbers are unchanged.
  const mealBase = loggedDayMacros(s);
  const proteinBase = mealBase.protein;
  const kcalBase = mealBase.kcal;
  const carbsBase = mealBase.carbs;
  const fatBase = mealBase.fat;

  // Athlete-editable daily targets; fall back to the constants for legacy
  // persisted blobs written before the targets were editable. The UI clamps these
  // to sane positive ranges (protein 80-320, calories 1200-6000), but a corrupt or
  // hand-edited persisted blob could carry 0/negative/NaN, which would divide into
  // the nutrition sub-score + protein ring as 0/0 -> NaN and poison athleteScore.
  // Treat any non-positive/NaN target as "missing" and fall back to the constant.
  const safeTarget = (v: number | undefined, fallback: number) =>
    typeof v === 'number' && v > 0 ? v : fallback;
  const proteinTarget = safeTarget(s.proteinTarget, PROTEIN_TARGET);
  const calTarget = safeTarget(s.calTarget, CAL_TARGET);

  const proteinToday = proteinBase + quickGrams;
  const kcalToday = kcalBase + quickKcal;
  const carbsToday = carbsBase + quickCarbs;
  const fatToday = fatBase + quickFat;
  const carbPct = clamp(Math.round((carbsToday / CARB_TARGET) * 100), 0, 100);
  const fatPct = clamp(Math.round((fatToday / FAT_TARGET) * 100), 0, 100);
  const proteinGap = Math.max(0, proteinTarget - proteinToday);
  const proteinPct = Math.min(100, Math.round((proteinToday / proteinTarget) * 100));
  const hydrationPct = clamp(Math.round((s.hydrationL / HYDRATION_TARGET) * 100), 0, 100);

  // Drift-proof: two tasks must reflect derived day-state, never a stored flag,
  // so the row can't lie regardless of which action last fired.
  //   id 2 "Hit 180g protein" -> done from the already-computed proteinToday.
  //   id 3 "Log dinner"        -> done from s.meals.dinner.
  // Non-mutating: spread a fresh task object for each override; s.tasks/s.meals
  // are never written.
  const effectiveTasks = s.tasks.map((t) => {
    if (t.id === 2) return { ...t, done: proteinToday >= proteinTarget };
    if (t.id === 3) return { ...t, done: Boolean(s.meals.dinner) };
    return t;
  });
  const tasksDone = effectiveTasks.filter((t) => t.done).length;
  const tasksTotal = effectiveTasks.length;

  // No floor (founder D-B): a zero-effort day must score near 0, not a feel-good
  // 57. Rescaled so a full honest day (protein target met + all four slots logged)
  // lands at ~100 and an empty day at ~0, with protein the dominant lever
  // (65 of 100) over slot count (35). Removing the old `57 +` baseline deliberately
  // deflates the seeded roster — that drop is the honesty, not a regression.
  // Profile-aware nutrition sub-score. 'athlete' (the default) reproduces the formula above
  // byte-for-byte; 'general' re-weights to calorie-adherence for a trainer's general-fitness
  // client. The platform owns these weights; the coach owns the targets (Constitution #13).
  const profile = resolveProfile(s.scoringProfile);
  const nutritionScore = profileNutritionScore(profile, {
    proteinToday,
    proteinTarget,
    kcalToday,
    calTarget,
    effectiveMeals: effectiveMealsLogged(s),
  });
  // Recovery sub-score averages ONLY the coach-enabled check-in questions
  // (s.ciConfig), each on a 0–10 scale — not a hard-coded energy/recovery/sleep
  // trio. Mirrors CheckIn.tsx's CI_KEYS so the score reflects exactly the
  // questions the athlete was actually asked.
  const CI_FIELDS: Record<keyof CiConfig, keyof AppState> = {
    energy: 'ciEnergy',
    recovery: 'ciRecovery',
    sleep: 'ciSleep',
    confidence: 'ciConfidence',
    soreness: 'ciSoreness',
    motivation: 'ciMotivation',
  };
  let recoveryScore = 86; // fallback: unsubmitted OR no enabled questions
  let recoveryScoreIsReal = false; // true only once a real check-in actually backs the number
  if (s.ciSubmitted) {
    let recoverySum = 0;
    let enabledCount = 0;
    (Object.keys(s.ciConfig) as (keyof CiConfig)[]).forEach((key) => {
      if (s.ciConfig[key] !== true) return;
      const raw = s[CI_FIELDS[key]] as number;
      // A corrupt/legacy persisted blob can carry ciSubmitted:true while an enabled
      // answer is undefined/NaN (written before that question existed, or hand-edited).
      // Averaging that in makes recoverySum -> NaN, poisoning recoveryScore AND the
      // whole athleteScore. Skip any non-finite answer so it never counts (and never
      // inflates the divisor); if EVERY enabled answer is missing, enabledCount stays
      // 0 and we fall back to 86, exactly as if no questions were enabled.
      if (typeof raw !== 'number' || !Number.isFinite(raw)) return;
      // Soreness has inverse polarity: high soreness = worse recovery, so it
      // contributes (10 - ciSoreness). All other questions contribute raw value.
      recoverySum += key === 'soreness' ? 10 - raw : raw;
      enabledCount += 1;
    });
    if (enabledCount > 0) {
      recoveryScore = Math.min(100, Math.max(0, Math.round((recoverySum / (enabledCount * 10)) * 100)));
      recoveryScoreIsReal = true;
    }
  }
  // Weight is a LONG-ARC goal, not a daily-accountability signal, so it is no
  // longer mixed into the daily score (a flawless day shouldn't be denied an A
  // because season weight progress is slow, which is partly outside daily control).
  // weightScore is kept as a REAL, separate progress indicator (replacing a
  // hardcoded 95 every athlete shared — the #1 "this is fake" persona finding):
  // clamped goal progress once tracking, a neutral baseline before any real
  // movement/history exists. Surfaced on its own, never folded into athleteScore.
  const startW = safeTarget(s.startWeight, WEIGHT_START);
  const targetW = safeTarget(s.weightTarget, WEIGHT_TARGET);
  const curW = safeTarget(s.currentWeight, startW);
  const weightProgress = seasonGoalProgress(curW, startW, targetW);
  const weightPhase = seasonGoalPhase({
    pctThere: weightProgress.pctThere,
    currentWeight: curW,
    start: startW,
    weightHistoryLen: (s.weightHistory ?? []).length,
  });
  const weightScore = weightPhase === 'first-run' ? 80 : clamp(weightProgress.pctThere, 0, 100);
  const tasksScore = tasksTotal > 0 ? Math.round((tasksDone / tasksTotal) * 100) : 0;
  const checkinScore = s.ciSubmitted ? 100 : 0;

  // Daily accountability score: what you did TODAY. Nutrition leads (the heaviest
  // lever and the one the staff cares most about); recovery is self-reported; tasks
  // and check-in round it out. Weights come from the account's scoring profile
  // ('athlete' default = the shipped .5/.25/.15/.1 mix, unchanged).
  const w = PROFILE_WEIGHTS[profile];
  const athleteScore = clamp(
    Math.round(w.nutrition * nutritionScore + w.recovery * recoveryScore + w.tasks * tasksScore + w.checkin * checkinScore),
    0,
    100,
  );

  const ringOffset = Math.round(540 * (1 - athleteScore / 100));
  const proteinRingOffset = Math.round(251 * (1 - proteinPct / 100));
  // "This week" change shown next to the trend chart: today's score minus the
  // start of the visible 7-day window, computed from the SAME series the chart
  // draws so the number and the slope always agree. The seed pads the window
  // (and supplies the start baseline) only until real history fills it.
  const series = trendSeries(s.scoreHistory ?? [], athleteScore);
  // Day 0 = no real PRIOR day recorded (the only history entry, if any, is today's provisional
  // anchor). On day 0 the visible series is seeded padding, so a "this week" delta would invent a
  // week of slippage the user never lived ("↓58 trending down" on the day they signed up). Zero it
  // and let the UI say "starting today" instead of fabricating a trend.
  // A real new athlete carries exactly the provisional anchor commitStartingScore wrote for TODAY
  // (and no prior day). The seeded demo has EMPTY history (it never ran activation) and keeps its
  // showcase trend — so require a non-empty, all-today history, which excludes the demo.
  const hist = s.scoreHistory ?? [];
  const isDay0 = hist.length > 0 && hist.every((h) => h.date === s.dateStamp);
  const scoreDelta = isDay0 ? 0 : series[series.length - 1] - series[0];
  const deltaStr = (scoreDelta >= 0 ? '↑ +' : '↓ ') + Math.abs(scoreDelta);
  const deltaColor = scoreDelta >= 0 ? '#22C55E' : '#EF4444';

  return {
    athleteScore,
    grade: gradeFor(athleteScore),
    ringOffset,
    scoreDelta,
    deltaStr,
    deltaColor,
    isDay0,
    nutritionScore,
    recoveryScore,
    recoveryScoreIsReal,
    weightScore,
    tasksScore,
    checkinScore,
    proteinToday,
    proteinTarget,
    proteinGap,
    proteinPct,
    proteinRingOffset,
    kcalToday,
    calTarget,
    carbsToday,
    carbTarget: CARB_TARGET,
    carbPct,
    fatToday,
    fatTarget: FAT_TARGET,
    fatPct,
    mealsLoggedCount,
    hydrationPct,
    tasksDone,
    tasksTotal,
  };
}
