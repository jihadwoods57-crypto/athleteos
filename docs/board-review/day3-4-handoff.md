# Day 3–4 Handoff — founder decisions + crew redirect

**From:** board convener (review-only). **To:** the build crew. **Date:** 2026-06-27 (UTC).
Pairs with `docs/board-review/day3-4-work-queue.md` and the Night-2 executive report.

## Founder decisions (confirmed 2026-06-27)
- **D-A — Score name: "Development Score."** Founder confirmed. *Board reservation on record:* the score
  measures adherence/nutrition/self-report, not athletic development, so the name over-claims; founder has
  **overruled** and the crew proceeds with "Development Score." Do the rename completely (every screen,
  onboarding copy, the "What's in this score?" panel) — no half-renamed strings.
- **D-C — Closed-cohort go-live authorized.** Founder authorizes flipping `EXPO_PUBLIC_BACKEND_LIVE` for a
  **closed beta cohort**. Scope the cohort so minor-consent is not load-bearing on day one: **HS / perf
  coaches + their athletes, parents not yet in the loop** (per the executive-report beta rec). The consent
  gate (`consent.ts`) stays fail-closed; do not loop in parents/minors-with-guardians until the VPC flow
  exists. No `supabase db push` to live without the founder's per-migration sign-off (D1).

## CREW REDIRECT (priority change)
Day-3 AM ran **P6 (persona voice fixes)** from the old ranked queue. Per founder Decision D-C
(*validation over new features*), **stop adding feature/copy breadth and switch to
`day3-4-work-queue.md`.** Order: **Tier 1 (make the loop persist + score consumes real macros + coach sees
it) → Tier 2 (rescale out the 57-pt floor, close the minor-messaging hole, land the rename) → Tier 1.5
(kill demo strings, add the AI medical disclaimer).** Keep the P6 parent "honest weekly read" already
shipped (it closes a board finding); **defer remaining P6** until the loop is validated.

## Path to all-5-dimensions = 7 (honest timeline)
Sprint-reachable now (name + flag unblocked): **Product 3→6-7 · Reliability 4→5 · Trust 2→3-4 · Market
2→4-5 · Business 2.** Board-wide ~3 → **5–6 (GO-WITH-FIXES, narrow HS-coach cohort).**

| Dimension | To reach **7** | Gated on |
|-----------|----------------|----------|
| Product | Loop complete + demo strings gone + rename clean | Crew (this sprint) |
| Reliability | Server-side score recompute + sync conflict handling | ~1 wk backend work |
| Trust & safety | Verifiable parental consent + privacy policy + AI disclaimer + messaging governance + FERPA determination | ~2–3 wks **+ legal sign-off** |
| Business | Validated price + willingness-to-pay (LOIs) + early unit economics | ~2–4 wks, needs cohort first |
| Market | Live invite/join + activation instrumentation + early D1/D7 retention | ~2–4 wks of a live cohort |

**All five at 7 ≈ a one-month roadmap, not a weekend.** Trust and Business cannot be brute-forced — they
need outside legal review and real people paying, respectively. The board re-scores all five next night on
what actually shipped; the numbers stay earned.
