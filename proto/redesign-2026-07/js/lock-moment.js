/* "Day N locked." — the moment a finished day becomes permanent.
 *
 * The streak is the app's retention spine and it had no moment. A day crossed midnight and simply
 * became a bigger number on the ring; the only place the lock was ever mentioned was a sentence
 * predicting it ("Day 35 of your streak locks at midnight"), which the athlete read the night
 * BEFORE and never got an answer to. This is the answer, shown once, the next time they open.
 *
 * What it is not: it never claims anything the app cannot prove. It reads yesterday's real score out
 * of DAY.scoreHistory, and if there is no row for yesterday it says nothing at all — a returning
 * athlete is not told their day locked because the app doesn't know that it did.
 *
 * A body-level overlay, like the image viewer, NOT part of a screen's markup: the router replaces
 * device.innerHTML on every render, so a stamp living inside a screen would be destroyed mid-
 * animation by any async repaint that happened to land (and Home repaints constantly).
 *
 * Nothing here writes to the database or touches scoring. The only persisted state is a marker
 * saying which lock has already been shown, so it is shown exactly once.
 */
import { RT, S, act } from './state.js';
import { DAY, addDaysISO, MEAL_KEYS } from './day.js';
import { icon } from './icons.js';
import { buzz } from './motion.js';
import { shouldAskForReview, requestReview } from './review-ask.js';
import { track, EVENTS } from './analytics.js';

/* The streak bar. Same 80 as streakInfo()/ON_STANDARD — a day locks into the run when it is on
   standard, and this must never disagree with the number the ring shows. */
const THRESH = 80;
/* Streak lengths worth naming. Deliberately few: a milestone every week would make none of them
   feel like one. */
const MILESTONES = [7, 30, 100];

let showing = false;

function dismiss(el, after) {
  if (!el) return;
  el.classList.remove('on');
  setTimeout(() => {
    try { el.remove(); } catch { /* already gone */ }
    // Anything that follows the stamp waits until the stamp is GONE. Stacking the OS rating modal
    // on top of our own would read as a pile-up, and on iOS a prompt shown over another modal is a
    // wasted ask out of three per year.
    if (typeof after === 'function') { try { after(); } catch { /* never break dismissal */ } }
  }, 240);
  showing = false;
}

/** Yesterday's score, or null when there is genuinely no row for it. */
function yesterdayScore() {
  const y = addDaysISO(DAY.date, -1);
  const row = (DAY.scoreHistory || []).find((h) => h.date === y);
  return { date: y, score: row && typeof row.score === 'number' ? row.score : null };
}

/**
 * Show the lock stamp if there is one owed. Safe to call on every Home mount — it is guarded on a
 * persisted marker, so it fires once per locked day and never on a repaint.
 * @param {number} streakDays the run length the ring is currently showing
 * @returns {boolean} whether a stamp was shown
 */
export function maybeShowLock(streakDays) {
  if (showing) return false;
  if (typeof document === 'undefined' || !document.body) return false;
  // The mirror of tour.js's own `.lockstamp` guard. That one stops a tour landing ON the stamp,
  // but nothing stopped the stamp landing on an OPEN tour: Home repaints several times during
  // early load, and a later repaint could fire this after the tour had already opened — two
  // modals on one paint, which is what a first-time athlete was actually getting. Returning
  // false here without claiming the marker means the stamp is simply owed on the next open.
  if (document.querySelector('.tour, .imgview, .memsheet, .sheet-scrim')) return false;
  const { date, score } = yesterdayScore();
  if (score === null || score < THRESH) return false;      // nothing provable to celebrate
  if (RT.lastLockSeen === date) return false;               // already shown
  // First run after this ships has no marker. Claim the marker for yesterday and show the stamp
  // once; every later open is a no-op.
  const milestone = MILESTONES.includes(streakDays) && RT.lastMilestone !== streakDays;

  const el = document.createElement('div');
  el.className = `lockstamp${milestone ? ' milestone' : ''}`;
  el.setAttribute('role', 'status');
  el.innerHTML = `
    <div class="ls-card">
      <div class="ls-mark">${icon('check', 26)}</div>
      <div class="ls-t">${milestone ? `${streakDays} days.` : `Day ${streakDays} locked.`}</div>
      <div class="ls-s">${milestone
        ? `Yesterday closed at ${score}. That is ${streakDays} straight days on standard.`
        : `Yesterday closed at ${score} and counted. It can't be taken back.`}</div>
      <button class="ls-x" type="button">Got it</button>
    </div>`;
  document.body.appendChild(el);
  showing = true;
  requestAnimationFrame(() => el.classList.add('on'));
  // 'lock' is the heavy impact — this is the one irreversible thing that happens in the app, and it
  // should feel like a stamp coming down rather than another tap.
  buzz(milestone ? 'milestone' : 'lock');

  /* A milestone is the app's one honest "that went your way" moment, so it is the only place we ask
     for a rating — and only after the athlete has closed it themselves. The predicate does the
     deciding (review-ask.js); this just hands it the state and reports what it chose, because an ask
     is otherwise invisible: no platform tells us whether a review was left. */
  const afterStamp = milestone ? () => askForReviewAfterMilestone(streakDays, score) : null;
  el.querySelector('.ls-x').addEventListener('click', () => dismiss(el, afterStamp));
  el.addEventListener('click', (e) => { if (e.target === el) dismiss(el, afterStamp); });

  // Mark it seen as soon as it is SHOWN, not when dismissed: an athlete who backgrounds the app mid
  // stamp has still had the moment, and re-showing it on the next open would make it feel like a bug.
  try { act.markLockSeen(date, milestone ? streakDays : null); }
  catch { /* storage unavailable — worst case it shows once more */ }
  return true;
}

/**
 * Consider a rating prompt after a milestone stamp closes.
 *
 * Everything that decides is in the pure predicate; this only gathers today's real state and records
 * the outcome. The ask is marked spent only when a prompt was ACTUALLY requested — if the platform
 * declined (TestFlight, an older Android, the kill switch), the cooldown must not be consumed or one
 * unavailable moment would cost the athlete the next four months of eligibility.
 */
async function askForReviewAfterMilestone(streakDays, yesterdayScoreValue) {
  try {
    const decision = shouldAskForReview({
      streakDays,
      onStandard: S.score >= THRESH,
      milestoneShown: true,
      analysisFailed: MEAL_KEYS.some((k) => (DAY.slotMacros[k] || {}).analysisFailed),
      syncIssue: S.syncIssue || null,
      online: typeof navigator === 'undefined' ? true : navigator.onLine !== false,
      lastAskedAt: RT.reviewAskedAt || null,
      now: Date.now(),
    });
    track(EVENTS.REVIEW_PROMPT_DECIDED, { ask: decision.ask, reason: decision.reason, streak: streakDays });
    if (!decision.ask) return false;

    const asked = await requestReview();
    if (asked) {
      act.markReviewAsked(Date.now());
      track(EVENTS.REVIEW_PROMPT_SHOWN, { streak: streakDays, score: yesterdayScoreValue });
    }
    return asked;
  } catch {
    return false;   // a rating prompt is never worth an error path
  }
}
