/* The star prompt: when to ask, and the one call that asks.
 *
 * Both app stores require their own native prompt (SKStoreReviewController on iOS, Play In-App
 * Review on Android). We cannot style it, cannot place it on a button, and cannot learn whether
 * anyone actually rated. iOS silently discards it after three asks per user per year.
 *
 * Two consequences shape everything here:
 *
 *   1. An ask is a scarce, unobservable resource. Spending one on someone having a bad day is gone
 *      for a year and we never find out. So the decision is conservative by construction, and the
 *      predicate below is pure so it can be tested exhaustively (review-ask.test.mjs IS the spec).
 *
 *   2. We must not ask the athlete how they feel first. The familiar "Enjoying the app? → Yes →
 *      native prompt" pattern is a Google Play policy violation: no question may precede or
 *      accompany the review card. So the app never asks — it infers, from a day it already scored.
 *
 * The moment chosen is the streak milestone stamp: 7, 30 or 100 days locked in. It is the only place
 * in the product where the app tells you something irreversible went your way, which is the honest
 * version of "are you happy with us".
 */

/** Streak lengths that earn an ask. Deliberately few — a milestone every week is not a milestone. */
export const MILESTONES = Object.freeze([7, 30, 100]);

/* Our own cooldown, stricter than the platform's. iOS allows three prompts a year and tells us
   nothing about which landed; 120 days means at most three in a year even if every milestone lines
   up, so we never burn the year's budget in one good month. */
export const ASK_COOLDOWN_DAYS = 120;

const DAY_MS = 86400000;

/**
 * May the app ask for a rating right now?
 *
 * Pure: no DOM, no clock, no storage. Everything it judges is passed in, including `now`.
 *
 * @param {object} s
 * @param {number}  s.streakDays      the run length the stamp just celebrated
 * @param {boolean} s.onStandard      is TODAY on standard (>= 80)
 * @param {boolean} s.milestoneShown  did the milestone stamp actually appear
 * @param {boolean} s.analysisFailed  did a meal read fail recently
 * @param {string|null} s.syncIssue   'error' | 'blocked' | null
 * @param {boolean} s.online
 * @param {number|null} s.lastAskedAt epoch ms of the last ask on this device
 * @param {number}  s.now             epoch ms
 * @returns {{ask: boolean, reason: string}} reason is always set, so a silent no is diagnosable
 */
export function shouldAskForReview(s) {
  if (!s || typeof s !== 'object') return { ask: false, reason: 'no-state' };

  // The moment first: this rides the milestone stamp and must never arrive cold.
  if (!s.milestoneShown) return { ask: false, reason: 'no-moment' };

  const streak = Number(s.streakDays);
  if (!Number.isFinite(streak) || !MILESTONES.includes(streak)) {
    return { ask: false, reason: 'not-a-milestone' };
  }

  // Anything broken outranks any milestone. A prompt landing next to a failure reads as gall.
  if (s.online === false) return { ask: false, reason: 'offline' };
  if (s.analysisFailed) return { ask: false, reason: 'recent-failure' };
  if (s.syncIssue) return { ask: false, reason: 'recent-failure' };

  // A milestone can coincide with a day that is still below the bar (the run is graced, today is
  // not). Rating us on a day they missed is the most expensive ask available.
  if (!s.onStandard) return { ask: false, reason: 'day-not-on-standard' };

  const last = Number(s.lastAskedAt);
  if (Number.isFinite(last) && last > 0) {
    const now = Number(s.now);
    const elapsed = (Number.isFinite(now) ? now : 0) - last;
    if (elapsed < ASK_COOLDOWN_DAYS * DAY_MS) return { ask: false, reason: 'asked-recently' };
  }

  return { ask: true, reason: 'ok' };
}

/**
 * Ask, via the native bridge. Resolves to whether the prompt was actually requested.
 *
 * Every failure mode is a silent false: no bridge (web, QC harness), a binary built before this
 * shipped, the store SDK unavailable (notably TestFlight, where iOS reports the prompt as
 * unavailable), or the founder having flipped the kill switch. None of them are errors — there is
 * simply no prompt to show, and nothing in the app should behave differently because of it.
 */
export async function requestReview() {
  try {
    const N = typeof window !== 'undefined' ? window.OnStandardNative : null;
    if (!N || !N.review || typeof N.review.request !== 'function') return false;
    return !!(await N.review.request());
  } catch {
    return false;
  }
}
