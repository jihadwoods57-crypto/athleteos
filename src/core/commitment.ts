// OnStandard — daily plan-commitment (pure).
//
// The sub-30-second "Did you hit YOUR plan today? yes / partial / no" one-tap: the
// daily-loop heartbeat that keeps the app from going silent. For an un-passed athlete
// it registers "showed up" and on its own can NEVER reach on-standard (>=80) — photo
// logging remains the only road to 80 (nutrition, the 0.5 lever, is 0 without a photo).
// The Trust Pass mechanic (crediting a real camera-free day at the athlete's own proven
// baseline) builds ON TOP of this; see docs/council/2026-07-02-trust-pass.md.

export type CommitmentAnswer = 'yes' | 'partial' | 'no';

/**
 * The 0..100 commitment sub-score for a day. Honesty invariant (council-locked):
 * no <= partial <= yes, with an honest "no" scoring a hard 0 — never a quarter-credit
 * participation floor (the banned "feel-good" credit, founder ruling D-B). An unanswered
 * commitment (null/undefined) scores 0.
 */
export function commitmentScore(answer: CommitmentAnswer | null | undefined): number {
  switch (answer) {
    case 'yes':
      return 100;
    case 'partial':
      return 60;
    case 'no':
      return 0;
    default:
      return 0; // unanswered
  }
}
