// OnStandard — "Next best action" (pure TS, no RN imports).
// The app should coach forward, not just grade backward: surface the SINGLE
// highest-impact thing the athlete can do right now to move today's plan, derived
// from their real logged data + the time of day. Priority follows the score levers
// — protein (50% of the score) and meals lead, then hydration, check-in, tasks.
// Honest by construction: every line reads off real derived values, no fabrication.
import { HYDRATION_TARGET } from './constants';
import type { AppState, Derived, MealKey } from './types';

export type NextActionCta = 'meal' | 'water' | 'checkin' | 'plan' | null;

export interface NextAction {
  /** Which lever this addresses — also a stable key for tests/telemetry. */
  key: 'log-meal' | 'protein-topup' | 'hydrate' | 'checkin' | 'task' | 'done';
  /** The action, imperative + short (e.g. "Log lunch"). */
  title: string;
  /** The why/how — specific and time-aware (e.g. "You're 40g of protein short…"). */
  detail: string;
  /** Which store action the card should trigger when tapped (null = informational). */
  cta: NextActionCta;
  /** True only when the whole day is genuinely on plan — the all-clear state. */
  done: boolean;
}

/** Meal slots in day order with the local hour each is "due" by. */
const SLOTS: { key: MealKey; label: string; due: number }[] = [
  { key: 'breakfast', label: 'breakfast', due: 9 },
  { key: 'lunch', label: 'lunch', due: 13 },
  { key: 'snack', label: 'a snack', due: 16 },
  { key: 'dinner', label: 'dinner', due: 20 },
];

/**
 * The meal the athlete should log RIGHT NOW, chosen by the clock — not just the first
 * unlogged slot. At 9pm a fresh athlete is nudged toward DINNER (the current window),
 * never "log breakfast" (the audit bug). Order: the current time-window meal if it's
 * unlogged; else the next upcoming unlogged meal; else the earliest still-missed one.
 * `overdue` means the chosen slot's due hour has already passed.
 */
function targetMeal(meals: AppState['meals'], hour: number): { slot: (typeof SLOTS)[number]; overdue: boolean } | null {
  let current = SLOTS[0];
  for (const slot of SLOTS) if (hour >= slot.due) current = slot;
  if (!meals[current.key]) return { slot: current, overdue: hour >= current.due };
  const upcoming = SLOTS.find((slot) => slot.due > hour && !meals[slot.key]);
  if (upcoming) return { slot: upcoming, overdue: false };
  const missed = SLOTS.find((slot) => !meals[slot.key]);
  return missed ? { slot: missed, overdue: hour >= missed.due } : null;
}

/**
 * The single most impactful next step, given today's real state + the current hour.
 * `now` is injectable for tests (mirrors clock.ts). Returns a `done` action only
 * when protein is met, every meal is logged, the check-in is in, and hydration is
 * on target — i.e. there is genuinely nothing more worth doing today.
 */
export function nextBestAction(s: AppState, d: Derived, now: Date = new Date()): NextAction {
  const hour = now.getHours();
  const target = targetMeal(s.meals, hour);
  const litersLeft = Math.max(0, +(HYDRATION_TARGET - s.hydrationL).toFixed(1));

  // 1) Protein is the dominant lever (half the score). If the athlete is short,
  //    that is the move — log the time-appropriate meal, or top up if every meal is in.
  if (d.proteinGap > 0) {
    if (target) {
      return {
        key: 'log-meal',
        title: `Log ${target.slot.label}`,
        detail: target.overdue
          ? `You're ${d.proteinGap}g of protein behind and ${target.slot.label} is overdue — logging it now is the fastest way to catch up.`
          : `You're ${d.proteinGap}g of protein short today. ${cap(target.slot.label)} is your next chance to close the gap.`,
        cta: 'meal',
        done: false,
      };
    }
    return {
      key: 'protein-topup',
      title: 'Close your protein gap',
      detail: `Every meal is logged but you're still ${d.proteinGap}g short. A protein shake adds ~30g — add one under quick add to finish the day in the green.`,
      cta: 'meal',
      done: false,
    };
  }

  // 2) Protein is met but a meal is still missing — keep the day complete.
  if (target) {
    return {
      key: 'log-meal',
      title: `Log ${target.slot.label}`,
      detail: `Protein's already on target — nice. Log ${target.slot.label} to keep the day complete.`,
      cta: 'meal',
      done: false,
    };
  }

  // 3) Nutrition's done. Hydration is the next-biggest daily lever.
  if (litersLeft > 0.2) {
    return {
      key: 'hydrate',
      title: 'Top up your water',
      detail: `Nutrition's locked in. You're ${litersLeft}L from your hydration goal — a couple of glasses gets you there.`,
      cta: 'water',
      done: false,
    };
  }

  // 4) The weekly check-in is the only score lever the daily log can't fill.
  if (!s.ciSubmitted) {
    return {
      key: 'checkin',
      title: 'Do your weekly check-in',
      detail: "Your plate's handled. The 2-minute check-in is the last thing standing between you and a complete day.",
      cta: 'checkin',
      done: false,
    };
  }

  // 5) Anything left is the daily tasks.
  if (d.tasksDone < d.tasksTotal) {
    return {
      key: 'task',
      title: "Finish today's tasks",
      detail: `You're ${d.tasksTotal - d.tasksDone} task${d.tasksTotal - d.tasksDone === 1 ? '' : 's'} from a clean sweep. Knock them out on your Plan.`,
      cta: 'plan',
      done: false,
    };
  }

  // 6) Genuinely nothing left — the all-clear.
  return {
    key: 'done',
    title: "You're on plan today",
    detail: 'Protein, meals, hydration and your check-in are all in. This is exactly what a strong day looks like — bring it again tomorrow.',
    cta: null,
    done: true,
  };
}

const cap = (w: string) => w.charAt(0).toUpperCase() + w.slice(1);
