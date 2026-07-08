// OnStandard — the comeback moment (churn build 2026-07-04; pure TS, no RN imports).
//
// The #1 way accountability apps lose people: an athlete misses a few days, opens the app
// to a dead streak and a red score, feels behind, and never comes back. The product answer
// is to make the RE-ENTRY welcoming instead of shaming — the streak math stays honest
// (history.ts does not bend), but the first thing a returning athlete sees is "good to see
// you, today counts", not a graveyard.
//
// This module is the pure detector + copy. Home renders the card when it fires and it
// disappears the moment the athlete does anything today (logging kills it, not time).
import { daysBetweenStamps } from './clock';
import type { DayScore } from './types';

/** Days away (calendar) before a return counts as a comeback. 1-2 days is normal cadence
 *  (grace territory); 3+ is a real lapse worth a deliberate welcome. */
export const COMEBACK_THRESHOLD = 3;

export interface ComebackInfo {
  /** True when the comeback card should show. */
  isComeback: boolean;
  /** Calendar days since the last logged day (0 when unknown/none). */
  daysAway: number;
  headline: string;
  /** The honest, forgiving line under it. */
  detail: string;
  /** The one CTA label — always the smallest next action, never a catch-up list. */
  cta: string;
}

const NONE: ComebackInfo = { isComeback: false, daysAway: 0, headline: '', detail: '', cta: '' };

/**
 * Detect a comeback: the athlete has real history, their last logged day is >= 3 calendar
 * days ago, and they have not done anything yet today. Brand-new athletes (no history) get
 * the Day-1 empty state, not this. `hasActivityToday` = any meal/check-in/commitment today —
 * the card is killed by ACTION, not by being seen.
 */
export function comebackInfo(
  history: DayScore[],
  today: string,
  hasActivityToday: boolean,
): ComebackInfo {
  if (hasActivityToday || history.length === 0) return NONE;
  // The most recent logged date strictly before today (history is oldest -> newest, but
  // don't trust ordering — scan for the max date).
  let last: string | null = null;
  for (const h of history) {
    if (h.date < today && (last === null || h.date > last)) last = h.date;
  }
  if (!last) return NONE;
  const daysAway = daysBetweenStamps(last, today);
  if (daysAway < COMEBACK_THRESHOLD) return NONE;

  const away = daysAway >= 14 ? 'a while' : `${daysAway} days`;
  return {
    isComeback: true,
    daysAway,
    headline: 'Good to see you back.',
    detail: `It's been ${away}. None of that changes what you can do today, and today is the only day on the board. One meal photo starts it.`,
    cta: 'Log your first meal',
  };
}
