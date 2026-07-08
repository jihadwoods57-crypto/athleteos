// OnStandard — capture-proof context (pure TS, no RN imports; 2026-07-04).
//
// The capture screen is the product's make-or-break moment, and it should feel like
// CAPTURING PROOF, not filling in a diary: which requirement this photo satisfies, the
// real window it belongs to, how much time is left, and who sees it the moment it lands.
// All of it derives from the existing plan-window model (DEFAULT_PLAN.windows) and the
// linked support team — nothing here is invented, and the late line only threatens a
// score consequence when late scoring is actually collected (the engines switch).
import { DEFAULT_PLAN, formatWindowTime, type MealWindow } from './coachPlan';
import type { MealKey, MealLabel } from './types';

export interface CaptureProofInfo {
  /** "DINNER · closes 8:30 PM", or null when the slot has no window. */
  windowLine: string | null;
  /** The urgency read: "2h 10m left" / "Closes in 25m" / the honest past-window line. */
  timeLine: string;
  urgency: 'open' | 'closing' | 'late';
  /** "Your coach sees this the moment you log it." — null when nobody is linked. */
  seenLine: string | null;
}

const LABEL_TO_KEY: Record<string, MealKey> = {
  breakfast: 'breakfast',
  lunch: 'lunch',
  snack: 'snack',
  dinner: 'dinner',
};

/** Minutes-to-deadline at or under this reads as "closing" (urgent color). */
export const CLOSING_SOON_MIN = 45;

function remaining(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h <= 0) return `${m}m left`;
  return m === 0 ? `${h}h left` : `${h}h ${m}m left`;
}

export function captureProof(opts: {
  mealType: MealLabel;
  /** Local minutes from midnight (caller supplies; keeps this pure/testable). */
  nowMin: number;
  /** True when a linked coach/trainer will really see the log (supportTeam non-empty + live). */
  overseer: 'coach' | 'trainer' | null;
  /** Whether late logging actually affects the score (isEnginesEnabled) — the late line
   *  must not threaten a consequence the engine is not collecting. */
  lateMatters?: boolean;
  windows?: MealWindow[];
}): CaptureProofInfo {
  const { mealType, nowMin, overseer, lateMatters = false } = opts;
  const windows = opts.windows ?? DEFAULT_PLAN.windows;
  const key = LABEL_TO_KEY[mealType.toLowerCase()];
  const w = windows.find((x) => x.key === key);
  const seenLine = overseer ? `Your ${overseer} sees this the moment you log it.` : null;
  if (!w) return { windowLine: null, timeLine: '', urgency: 'open', seenLine };

  const windowLine = `${w.label.toUpperCase()} · closes ${formatWindowTime(w.deadlineMin)}`;
  const left = w.deadlineMin - nowMin;
  if (left < 0) {
    return {
      windowLine,
      timeLine: lateMatters
        ? 'Past the window. Still counts, logs as late.'
        : 'Past the usual window. Still counts.',
      urgency: 'late',
      seenLine,
    };
  }
  if (left <= CLOSING_SOON_MIN) {
    return { windowLine, timeLine: `Closes in ${left}m`, urgency: 'closing', seenLine };
  }
  return { windowLine, timeLine: remaining(left), urgency: 'open', seenLine };
}
