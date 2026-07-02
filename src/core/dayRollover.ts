// OnStandard — calendar-day rollover (pure TS, no React/RN imports).
// The persisted `aos_day` slice carries day-level accountability (meals, hydration,
// tasks, check-in). On a new calendar day that data is stale and must reset to the
// fresh day defaults, while cross-day fields (weight, prefs) survive. This file owns
// the date stamp + the pure rollover used by the store on rehydrate.
import type { AppState, DayScore, WeightPoint } from './types';
import { createInitialState } from './defaultState';
import { computeDerived } from './scoring';
import { appendDayScore, appendDayWeight } from './history';

// `todayStamp` now lives in the leaf `clock` module to break the
// dayRollover <-> defaultState import cycle. Re-exported here so existing
// `./dayRollover` and `@/core` import sites keep working unchanged.
export { todayStamp } from './clock';

/** The day-level fields reset on rollover. The invariant is one-directional: every key
 *  that resets here MUST also be persisted in the store's partialize whitelist — but not
 *  every persisted key resets here. Cross-day settings persist yet are intentionally
 *  preserved across rollover (e.g. ciConfig, currentWeight, visibility, notif). ciWeight is
 *  handled specially (seeded from currentWeight); currentWeight is a cross-day field, not here. */
export const DAY_DEFAULT_KEYS = [
  'meals',
  'mealFoods',
  'mealLoggedAt',
  'hydrationL',
  'quickAdded',
  'nudged',
  'nudgeLog',
  'tasks',
  'dailyCommitment',
  'ciStage',
  'ciSubmitted',
  'ciEnergy',
  'ciRecovery',
  'ciSleep',
  'ciConfidence',
  'ciSoreness',
  'ciMotivation',
] as const;

/**
 * Record the prior day's final accountability score into history BEFORE the day
 * slice resets. Called with the pre-roll full state (last session's day data).
 * Only fires when the stamp is real and stale; same-day or a brand-new install
 * (no stamp) leaves history untouched, so we never log a phantom score.
 */
export function recordDayScore(preRoll: AppState, todayIso: string): DayScore[] {
  const history = preRoll.scoreHistory ?? [];
  if (!preRoll.dateStamp || preRoll.dateStamp === todayIso) return history;
  const score = computeDerived(preRoll).athleteScore;
  return appendDayScore(history, preRoll.dateStamp, score);
}

/**
 * Record the prior day's body weight into history BEFORE the day slice resets,
 * mirroring `recordDayScore`. currentWeight is a cross-day field, so it survives
 * the roll; we snapshot it against the day it belonged to. Same-day or a
 * stamp-less brand-new install leaves history untouched.
 */
export function recordDayWeight(preRoll: AppState, todayIso: string): WeightPoint[] {
  const history = preRoll.weightHistory ?? [];
  if (!preRoll.dateStamp || preRoll.dateStamp === todayIso) return history;
  return appendDayWeight(history, preRoll.dateStamp, preRoll.currentWeight);
}

/**
 * Record the prior day's nutrition sub-score into history BEFORE the day slice
 * resets, mirroring `recordDayScore`. Snapshots the derived nutrition score
 * against the day it belonged to; same-day or a stamp-less install is a no-op.
 */
export function recordDayNutrition(preRoll: AppState, todayIso: string): DayScore[] {
  const history = preRoll.nutritionHistory ?? [];
  if (!preRoll.dateStamp || preRoll.dateStamp === todayIso) return history;
  const nutrition = computeDerived(preRoll).nutritionScore;
  return appendDayScore(history, preRoll.dateStamp, nutrition);
}

/**
 * A genuinely EMPTY day slice for a brand-new athlete at activation: nothing
 * logged yet, every task still open, no hydration, no nudges. This is distinct
 * from `createInitialState`'s SEEDED DEMO day (which pre-logs 3 meals + marks
 * some tasks done for the showcase). The activation flow swaps the seeded day
 * for this one so a new athlete's first Home is honest — their live score builds
 * up from an empty day (continuing from the Starting Point Score anchor written
 * into scoreHistory) and rises as they log, instead of inheriting someone else's
 * demo day (the "reveal said 49, Home said 78" contradiction). It does NOT touch
 * the rollover defaults, so the seeded-demo experience is unchanged.
 */
export function emptyDaySlice(): Pick<AppState, 'meals' | 'hydrationL' | 'quickAdded' | 'nudged' | 'nudgeLog' | 'tasks'> {
  return {
    meals: { breakfast: false, lunch: false, snack: false, dinner: false },
    hydrationL: 0,
    quickAdded: [false, false, false],
    nudged: [],
    nudgeLog: [],
    tasks: createInitialState().tasks.map((t) => ({ ...t, done: false })),
  };
}

function pick<T extends object, K extends keyof T>(src: T, keys: readonly K[]): Pick<T, K> {
  const out = {} as Pick<T, K>;
  for (const k of keys) out[k] = src[k];
  return out;
}

/** Given the persisted partial slice and today's stamp, reset the day fields to fresh
 *  defaults when the stamp is stale (or missing, for legacy pre-fix blobs) while
 *  preserving cross-day fields. Same-day returns the input unchanged (idempotent). */
export function rollDayIfStale<T extends Partial<AppState>>(persisted: T, todayIso: string): T {
  if (!persisted) return persisted;
  if (persisted.dateStamp === todayIso) return persisted; // same day — untouched

  const init = createInitialState();
  return {
    ...persisted, // preserve cross-day fields (currentWeight, visibility, notif, ...)
    ...pick(init, DAY_DEFAULT_KEYS), // reset exactly the day fields to fresh defaults
    ciWeight: persisted.currentWeight ?? init.ciWeight, // next check-in starts from real weight
    dateStamp: todayIso,
  };
}
