# Fable 5 — Project Memory (OnStandard / athleteos)

## Product Vision
OnStandard is honest athlete nutrition + performance: real habit formation over vanity metrics; coaches are the
buyers, parents pay, athletes are taught (not just scored).

## Features shipped
- 2026-07-12 — **Screen-by-screen engine, FULL COVERAGE (30/30 ledger rows)** (branch `fable5/2026-07-11-screen-by-screen-frontend-improvement`, 31 commits, tags `fable5/2026-07-12-screens-batch1..5` + `-final`; NOT merged): 40+ improvements across 24 screens — grace-calibrated streak tiers on home/progress/notifications; honest offline on coach/trainer/connect (supabase-js `{error}` sentinel plumbing); real failure states (meal analyzing, camera capture, profile avatar, requirement 404, reset resend, guardian remind); deceptive controls killed (weekly-preview chips, coachVoice toggle, quiet-hours invite); 44px floor swept (recovery chips, plan tabs, foodsearch steppers, ob chrome, .seg, pw-eye, avatar badge); aria semantics (radiogroups, input names, alert regions, humanized notification pills). Verify GREEN after every batch (143/143 · 1745/1745). Full report: `reports/2026-07-12-screen-by-screen-run.md`; per-change QA in `coverage.md`.
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
- 2026-07-12 — Router wires [data-go]/[data-act] ONCE at render; mount()-injected elements MUST self-wire clicks (bug found 3×). SETTLED.
- 2026-07-12 — supabase-js resolves network failures into `{error}` WITHOUT throwing — offline detection must use the `{error:true}` sentinel from the fetch layer, never a catch around the loader. SETTLED (fetchMyTeams/fetchMyPractices now follow fetchMyPracticeIdentity).
- 2026-07-12 — Never render a control that persists nothing (data-toggle-group theater): make it honestly inert + labeled preview, or remove it. SETTLED (checkin, coachVoice, quiet-hours).
- 2026-07-12 — CSS scoping traps: `.wb2` requires `.water-btns` ancestor, `.chp` requires `.chip-row` — bare use silently unstyles. Check the selector, not just the class name.

## Tech Debt
- Trainer identity needs two table reads (practices + profiles); an optional `practice_identity()` RPC would make it one round-trip — FOUNDER-GATED (requires migration; author-only, never apply).
- Practice HQ roadmap sections (business health, client health, AI assistant, analytics, default-standard mgmt, branding, integrations, business tools) exist only as LOCKED rows.
- Surfaces reading `e.now||e.overdue[0]` must handle the "everything time-locked" case (both null while score <80) — streakPrompt/notifications now fall back to score-breakdown (`2444ce5`); a shared `S.exec.nextActionable` helper is still worth it if a third surface appears.

## Open Bugs
- ~~Parent tab root back-nav~~ FIXED in-tree (verified 2026-07-11 by screen-run audit + grep): parent root uses `titleHead('Parent view','Setting up access')` at coach.js:679. Memory was stale.
- ~~Offline trainer shown "minting"~~ FIXED in-tree (verified 2026-07-11): `fetchMyPracticeIdentity` returns `{error:true}` on fetch failure (roles.js:78) and `_loadPracticeIntoRt` sets `RT.practiceOffline` distinct from minting (state.js:489–505, surfaced at :902). Memory was stale.
- ~~Streak-run QA #1 (locked-window no-op CTA)~~ + ~~#2 (notif rows route:'home')~~ FIXED 2026-07-12 in `2444ce5`: shared root fix — `e.now || e.overdue[0] || score-breakdown` fallback with "View standard" CTA, notification rows compute the same route.
- ~~Streak-run QA #3 (green secured pill)~~ BUILT 2026-07-12 in `0485fea` — founder approved green over quiet.

## Roadmap
- 2026-07-12: FULL COVERAGE COMPLETE — all 30 ledger rows done, 40+ improvements shipped, branch awaiting founder merge. Next: (0) founder merge decision on the branch; then pass 2 from the ranked backlog in `coverage.md` (plan offline false-negative copy, progress green-on-negative delta, camera vf-tools 40px, meal thread-load failure state, log sheet re-animation, home NEXT/LATER-vs-OVERDUE hierarchy); (a) first unlocked Practice HQ section — client health list is the highest-value candidate (real client rows already reachable via widened `fetchMyPractices`); (4) founder decision on the `practice_identity()` RPC proposal.
- Streak surface follow-on candidates (audit runners-up, still valid): billing-conversion polish (must respect the deliberately-unwired Stripe checkout seam) and coach-roster triage. Both fold to presentation-only changes.
- Coach profile likely shares the stale-scratch identity pattern trainer had (roles.js `coachProfile` read `RT.ob` too) — audit it before building coach-side HQ.

## Launch Checklist
- See docs/LAUNCH-CHECKLIST.md
