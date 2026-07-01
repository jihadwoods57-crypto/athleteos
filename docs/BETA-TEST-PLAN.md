# Closed-Beta Test Plan — real-user validation

**Status:** ready to execute once the founder flips go-live. This is the one testing
layer that cannot run from an automated session — it needs real coaches and athletes.
Authorized by founder Decision D-C (closed cohort). Pairs with the Day 3–4 work queue.

## Why this is the unlock
Automated coverage is strong (770+ unit/integration tests green; the meal loop is
verified end-to-end in the real web build — editing a meal moved the headline score
75 → 77). What's NOT yet proven is whether real people *do the loop on their own* and
get value. That's the only thing that moves Business and Market readiness off the floor.

## Cohort (scoped so minor-consent is not load-bearing on day one)
- **3–5 high-school or performance coaches**, each with **5–15 athletes**.
- **No parents and no guardian-of-minor flows yet** — those wait for the verifiable
  parental-consent (VPC) flow. Coaches and adult athletes only for round one.
- Recruit warm contacts; you want feedback, not scale.

## Go-live prerequisites (≈30 min, founder-gated)

> **SUPERSEDED for the migration steps — follow [`docs/RUNBOOK-go-live.md`](RUNBOOK-go-live.md).**
> This section predates the `0009→0013` migrations: step 1 below lists only `0004`+`0005`, but the
> live sequence is `0004→0013` (incl. the `0012` `can_view` cutover + `0013` hardening), staging-first.
>
> **UNRESOLVED CONTRADICTION (founder must decide): email confirmation ON vs OFF.** This doc (step 2)
> says **OFF** for the beta; the runbook (C1), `supabase/config.toml` (`enable_confirmations = true`),
> and FOUNDER-DECISIONS D2 say **ON**. The real dependency is the one named in step 2: confirm-ON
> strands users unless a "check your email" screen exists. So the decision is coupled to a small build:
> **either keep OFF for beta (accept the security tradeoff) or turn ON and add the confirmation screen
> first.** Pick one and reconcile both docs before go-live. (Buildable now: the confirmation screen, if ON.)

1. **Apply migrations** `0004→0013` to the live project, staging-first, per the runbook (NOT just
   `0004`+`0005`). Both early ones verified locally; see Decision D1.
2. **Email confirmation** — see the contradiction banner above; decide ON vs OFF before this step.
3. **Flip** `EXPO_PUBLIC_BACKEND_LIVE=true`. The consent gate stays fail-closed.
4. **Smoke test before inviting anyone:** one coach creates a team → gets a real join
   code (the EAGLES24 placeholder is now wired to the real `create_team` code) → one
   athlete joins with it → logs a meal → coach sees the athlete on their roster.

## What each persona should be asked to do (the loop, unscripted)
- **Athlete:** onboard → log a meal → open it, adjust a portion / add a food → Save →
  confirm the score and protein gap move → check in once.
- **Coach:** create the team, invite athletes, and answer "who needs my attention
  today?" from the roster without being told where to look.

## Success signals (what to watch in week one)
| Question | Signal | Honest bar for "promising" |
|----------|--------|----------------------------|
| Can they get in? | % invited who complete onboarding + join a team | > 60% |
| Does the loop land? | athletes who log ≥1 edited meal unprompted | > half the cohort |
| Does it stick? | D1 / D7 return rate | any repeat use is signal at this size |
| Does the coach get value? | coach can name an at-risk athlete from the roster | qualitative yes/no |
| Trust | unprompted "this number/date is wrong" reports | track every one |

## Known issues to expect (so beta feedback isn't a surprise)
These are already on the crew's queue (Tier 1.5 / Tier 2) — flag them to testers as
"known, being fixed," or hold the beta until the crew lands them:
- Hardcoded demo strings on Home/Check-In (e.g. "38 days left", "by Playoffs · Nov 14",
  a static "AI weekly summary" that ignores the sliders, an always-on notification dot).
- A **pace-projection bug**: the Nutrition weekly-goal card can show absurd advice
  (observed: "ease back ~13183 cal/day") because it feeds season-total weight progress
  into a weekly projection with hardcoded "4 days elapsed" (`src/core/content.ts`
  `paceProjection`). Fix before a real athlete with real season progress sees it.
- The headline is still labeled "Accountability Score"; the rename to "Development
  Score" (Decision D-A) is queued.
- Messaging shows an "Active now" presence with no backing data, and adult↔minor
  messaging has no governance yet — keep messaging out of the beta or scope it
  adults-only until the safety policy is set (Decision D7).

## Instrumentation (lightweight, before scaling)
Add basic activation events (onboarding complete, team joined, meal saved, check-in
submitted) so the signals above are measurable rather than anecdotal. This is a small
backend task, not a blocker for the first handful of users.
