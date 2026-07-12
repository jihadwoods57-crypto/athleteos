# Fable 5 — Project Memory (OnStandard / athleteos)

## Product Vision
OnStandard is honest athlete nutrition + performance: real habit formation over vanity metrics; coaches are the
buyers, parents pay, athletes are taught (not just scored).

## Features shipped
- 2026-07-11 — **Streak-at-risk (Home loss-aversion surface)** (branch `fable5/2026-07-11-screen-by-screen-frontend-improvement`, commit `90e1105`, tag `fable5/2026-07-11-systematic-screen-by-screen-frontend-imp`; NOT merged): the passive "🔥 N day streak" pill tiers the moment a 2+ day streak isn't yet counted today — amber "N-DAY · AT RISK" pill + STRONG flame ribbon when `graceUsedRecently` (loss is real), blue "N-DAY · COVERED" pill + MILD shield ribbon when grace is intact. Ribbon is a sibling of `strip()` (data-go isolation), routes to exec now/overdue, self-retires on celebration/day0/<2 days. Matching tiered row leads the notifications feed. Driven 100% by existing `S.streak` (state.js:957-968) / streakInfo (day.js:199) — no new data, backend, or migrations. Verify gate GREEN (143/143 suites, 1745/1745 tests, expo export OK); proto.zip + protoVersion.ts rebuilt; 5 states + routing smoke-tested via localStorage-seeded Playwright. Rationale: chosen over billing-conversion and coach-triage lenses — Home is the daily-return surface every athlete sees, and this reuses an already-honest getter with zero backend risk and never touches the unwired Stripe seam.
- 2026-07-11 — **Practice HQ v1** (branch `fable5/2026-07-11-trainer-profile-practice-hq`, commit `b47d925`, tag `fable5/2026-07-11-redesign-the-trainer-profile-into-a-prem`; NOT merged): trainer profile rebuilt from dead settings page into Practice HQ — server-hydrated real identity (`RT.practice` + `act._loadPracticeIntoRt` + `S.trainerIdentity`), 4-state invite loop (live/loading/minting/offline), dependency-free tested ISO 18004 QR encoder (`src/core/qr.ts`, ported to `proto/redesign-2026-07/js/qr.js`), Copy/Share via native bridge → navigator.share → clipboard, honest LOCKED roadmap rows, and cross-role back-nav fix on coach+trainer tab roots via new `titleHead()`. Verify gate GREEN (135/135 suites, 1679/1679 tests, expo export OK).

## Decisions (with rationale)
- Fable 5 never merges to master; the founder integrates. Rationale: LLM output is reviewed before it ships.
- 2026-07-11 — Trainer identity is server-hydrated into RT (never `RT.ob` scratch, never hardcoded personas like "Tracy Boone"/"Coach Mark"). Rationale: profile must survive reinstall/new device and never show another persona. SETTLED — do not re-litigate.
- 2026-07-11 — Tab-root role dashboards get chevron-less headers (`titleHead`), not `backHead(...,'profile')`. Rationale: back on a root routed cross-role into the athlete profile. SETTLED.
- 2026-07-11 — QR generation is a from-scratch, dependency-free encoder (no CDN in the WebView, no npm dep). SETTLED.
- 2026-07-11 — Practice HQ visual lane: trainer purple as accent inside the existing dark redesign system; Athlete Blue remains the athlete spine. SETTLED (design taste, founder may override).
- 2026-07-11 — Streak urgency is grace-calibrated, never flat: strong loss-aversion copy ("ends tonight") ONLY when grace is genuinely spent (`graceUsedRecently`); mild "covered" framing otherwise. Honesty over engagement pressure. SETTLED.
- 2026-07-11 — Home ribbons/prompts render as siblings of `strip()`, never children — strip owns `data-go="score-breakdown"` and nested data-go targets must not compete. SETTLED (pattern for future Home surfaces).

## Tech Debt
- Trainer identity needs two table reads (practices + profiles); an optional `practice_identity()` RPC would make it one round-trip — FOUNDER-GATED (requires migration; author-only, never apply).
- Practice HQ roadmap sections (business health, client health, AI assistant, analytics, default-standard mgmt, branding, integrations, business tools) exist only as LOCKED rows.
- `streakPrompt()` (home.js:115-116) shares exec's "everything locked" blind spot: when now/overdue are empty because remaining items are time-locked, it falls back to a no-op `home` route with a "Log …" CTA (see Open Bugs #3). Any future surface reading `e.now||e.overdue[0]` inherits the same hole — consider an `S.exec.nextActionable` helper.

## Open Bugs
- ~~Parent tab root back-nav~~ FIXED in-tree (verified 2026-07-11 by screen-run audit + grep): parent root uses `titleHead('Parent view','Setting up access')` at coach.js:679. Memory was stale.
- ~~Offline trainer shown "minting"~~ FIXED in-tree (verified 2026-07-11): `fetchMyPracticeIdentity` returns `{error:true}` on fetch failure (roles.js:78) and `_loadPracticeIntoRt` sets `RT.practiceOffline` distinct from minting (state.js:489–505, surfaced at :902). Memory was stale.
- 2026-07-11 QA streak-run (LOW, correctness-ux): at-risk ribbon falls back to `target='home'` + "Log today's standard" CTA when now/overdue are empty because remaining requirements are time-LOCKED (home.js:115-117, exec.js:113-116) — a no-op tap that promises an unavailable log action. Fix: suppress ribbon or swap CTA to "View standard" → score-breakdown when target resolves to 'home'.
- 2026-07-11 QA streak-run (LOW, consistency): both streak notification rows hardcode `route:'home'` (state.js:1390, 1394) while the ribbon they mirror routes to the actionable now/overdue route. Fix: compute the same next-action route for the rows.
- 2026-07-11 QA streak-run (LOW, design-deviation): design spec (reports/2026-07-11-design-streak-at-risk.md:21,51) calls for a green "secured" pill once todayCounted; build falls back to the old passive grey pill (home.js:91). ~5-line fix, but green-vs-quiet is a founder taste call.

## Roadmap
- Next sprint, in order: (1) fix the three LOW streak-run QA bugs above on the same branch before the founder merges — #1 and #2 share a root fix (an `S.exec.nextActionable` route helper), #3 needs a founder yes/no on the green pill; (2) continue the screen-by-screen coverage ledger (`.fable5/coverage.md`) after founder calibration — camera.js is next; (3) first unlocked Practice HQ section — client health list is the highest-value candidate (real client rows already reachable via widened `fetchMyPractices`); (4) founder decision on the `practice_identity()` RPC proposal.
- Streak surface follow-on candidates (audit runners-up, still valid): billing-conversion polish (must respect the deliberately-unwired Stripe checkout seam) and coach-roster triage. Both fold to presentation-only changes.
- Coach profile likely shares the stale-scratch identity pattern trainer had (roles.js `coachProfile` read `RT.ob` too) — audit it before building coach-side HQ.

## Launch Checklist
- See docs/LAUNCH-CHECKLIST.md
