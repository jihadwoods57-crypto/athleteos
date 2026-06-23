// AthleteOS — pure helpers for the coach/trainer person-detail overlay.
// The roster only carries a single headline score per athlete, so the detail
// overlay's category breakdown has to be ANCHORED to that score rather than a
// fixed template — otherwise tapping a struggling athlete shows the same ~90s
// bars as a top performer and the breakdown silently contradicts the headline.

export interface PersonBreakdown {
  nutrition: number;
  recovery: number;
  tasks: number;
  checkin: number;
}

/**
 * Fixed category offsets from the headline score. They SUM TO ZERO, so before
 * clamping the four bars average exactly to the athlete's score — the breakdown
 * can never drift from the number shown in the ring. Recovery is the standing
 * laggard and check-in the strongest, matching the coaching copy ("watch
 * recovery") and the original prototype's shape (check-in highest, recovery
 * lowest).
 */
const OFFSETS: PersonBreakdown = { checkin: 10, nutrition: 4, tasks: -2, recovery: -12 };

const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)));

/**
 * Derive a per-athlete category breakdown from the headline score. Deterministic
 * (same score → same bars) and consistent with the headline: every bar tracks
 * the score, so a 68 shows mid-60s bars and a 92 shows low-90s bars instead of a
 * frozen 92/80/88/100 for everyone.
 */
export function personBreakdown(score: number): PersonBreakdown {
  return {
    nutrition: clamp(score + OFFSETS.nutrition),
    recovery: clamp(score + OFFSETS.recovery),
    tasks: clamp(score + OFFSETS.tasks),
    checkin: clamp(score + OFFSETS.checkin),
  };
}
