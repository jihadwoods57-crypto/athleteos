// OnStandard — team activation (churn build 2026-07-04; pure TS, no RN imports).
//
// A coach who signs up but only gets 5 of 40 athletes onto the app churns before he ever
// feels the value — his dashboard is empty because his TEAM is missing, not because the
// product failed. This module turns "get the team on" into a visible, finishable job:
// the coach states how many athletes should be here, and the Roster tab tracks the join
// rate until it's done. The target is the coach's own number (stored in their onboarding
// meta), so nothing is guessed.

export interface ActivationStatus {
  /** Show the activation card (a target exists and is not reached, or no target and the
   *  roster is still tiny — the moment to ask). */
  show: boolean;
  /** True when we should ASK for the roster size (no target yet). */
  needsTarget: boolean;
  /** "12 of 40 joined" (or '' when needsTarget). */
  line: string;
  /** Join progress 0..100 for the bar (0 when needsTarget). */
  pct: number;
  /** How many are still missing (0 when needsTarget). */
  missing: number;
}

/** Rosters at or under this size with no stated target get the "set your roster size"
 *  prompt; a coach with a big joined roster clearly needs no activation help. */
export const TINY_ROSTER = 5;

export function activationStatus(joined: number, target: number | null | undefined): ActivationStatus {
  const j = Math.max(0, Math.floor(joined));
  const t = typeof target === 'number' && Number.isFinite(target) ? Math.floor(target) : null;
  if (t == null || t <= 0) {
    // No stated target: only prompt while the roster is tiny (the empty-dashboard danger zone).
    return { show: j <= TINY_ROSTER, needsTarget: true, line: '', pct: 0, missing: 0 };
  }
  if (j >= t) return { show: false, needsTarget: false, line: '', pct: 100, missing: 0 };
  return {
    show: true,
    needsTarget: false,
    line: `${j} of ${t} joined`,
    pct: Math.round((j / t) * 100),
    missing: t - j,
  };
}

/** Clamp a coach-entered roster size to something sane (1..500). Null for garbage. */
export function parseRosterTarget(raw: string): number | null {
  const n = Math.floor(Number(String(raw).trim()));
  if (!Number.isFinite(n) || n < 1 || n > 500) return null;
  return n;
}
