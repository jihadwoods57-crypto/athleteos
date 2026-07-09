# OnStandard Crew Constitution

Non-negotiables. A change that violates **any** of these is auto-rejected by the crew, regardless of
whether the tests pass. These are as binding as a red gate. Every crew agent reads this file first.

## Scoring truth
- Score weighting is **N50 / R25 / C15 / K10**. Do not re-weight.
- **Weight is tracked, never scored.**
- Trust-pass day credit = `f(answer) × trailing median of last 10 photo-earned days`; the median
  firewall stays; grace is 1 per 7. A pass day never exceeds the photo-earned median.
- Targets are **goal-aware**: a lose-fat athlete is never told to gain.
- Photo logging is the only path to a score ≥ 80.

## Security & privacy
- RLS is team-scoped on every table. Never weaken it.
- Minor/parent consent gate stays enforced; guardian input is sanitized (no XSS).
- Notifications are server-authoritative; `notify()` cannot be forged by a client.
- AI spend caps and the daily cap stay in force.

## Honesty
- Error and empty states tell the truth; no feel-good mush that hides a real state.
- The coach's live roster shows silent athletes; demo data is never the default state.
- AI never fabricates meal metadata; only real analysis is persisted.
- **Engagement is earned, never manufactured.** Increase *real* habit and earned reward; never add fake
  dopamine, vanity metrics, artificial streak pressure, or dishonest mechanics to juice engagement. Honesty
  beats stickiness — this is why the score multiplier and demo-as-default were killed; do not reintroduce that
  class of thing.

## Measurement
- A shipped change that alters user-facing behavior must also emit the analytics event that will prove it
  worked. "We can't tell if it helped" means it is not done.

## Roles
- Athlete, coach, trainer, parent surfaces stay coherent; a change to one must not silently break
  another's hydration on fresh sign-in.

## Hard guardrails — the crew must NEVER autonomously:
- Apply live database migrations (it may author a migration file and flag it; the founder applies it
  per the go-live runbook).
- Deploy edge functions to live, or run `eas build` / `eas submit` / `npm run ship`.
- Touch Stripe, EAS, or App Store secrets.
- Merge to `master`.
- Delete or weaken a test, or relax a rule in this file, to make a gate go green.
- Weaken RLS or any security check to pass.

---
Source of truth: `docs/superpowers/specs/2026-07-09-onstandard-autonomous-crew-design.md` §7.
