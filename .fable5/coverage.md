# Screen Coverage Ledger — screen-by-screen frontend improvement engine

Phase 0 artifact (mandated once per the 2026-07-11 run brief). Every screen in
`proto/redesign-2026-07/js/screens/`, ranked by user impact. Work top-down; no screen skipped.
Ranks are provisional — refine when a screen's teardown reveals its real weight. `index.js` is
the route registry (not a screen); `coach.js` bundles ~9 role screens — track its sub-screens
individually when it comes up.

Status: `pending` → `teardown` → `shipping` → `done`. One improvement per cycle.

| # | Screen (file) | Why this rank | Status |
|---|---|---|---|
| 1 | home.js | Daily-return surface every athlete sees first | **done** (pass 1) — 3 shipped: streak-at-risk `90e1105`, SECURED pill `0485fea`, CTA route fix `2444ce5`; calibration gate PASSED 2026-07-12 |
| 2 | camera.js | Primary log action (photo proof) — the core loop's verb | pending |
| 3 | meal.js | Meal detail/log — nutrition is 50% of score | pending |
| 4 | log.js | Manual log path — fallback for the core verb | pending |
| 5 | breakdown.js | Score breakdown — the strip's tap target; where "why is my score X" gets answered | pending |
| 6 | checkin.js | Recovery check-in — second scored daily habit | pending |
| 7 | plan.js | Plan tab — coach-set targets, daily reference | pending |
| 8 | progress.js | Progress tab — retention surface, streak/trend story | pending |
| 9 | notifications.js | Accountability feed — now leads with streak row (cycle 1 mirror) | pending |
| 10 | foodsearch.js | Food search — logging friction lives here | pending |
| 11 | profile.js | Athlete profile root — settings/identity hub | pending |
| 12 | weight.js | Weight log — trend-only surface | pending |
| 13 | recovery.js | Recovery detail | pending |
| 14 | requirement.js | Single-requirement detail view | pending |
| 15 | trust.js | Trust Pass — coach-granted state, low frequency high meaning | pending |
| 16 | coach.js (coach root) | Coach dashboard — buyer-facing | pending |
| 17 | coach.js (trainer root) | Trainer view — Practice HQ adjacency | pending |
| 18 | coach.js (parent root) | Parent view — payer-facing; back-nav bug fixed in-tree | pending |
| 19 | roles.js | Role screens (trainer HQ etc.) — Practice HQ shipped last run | pending |
| 20 | guardian.js | Guardian consent — minor-athlete gate | pending |
| 21 | connect.js | Coach/practice linking | pending |
| 22 | onboarding.js | First-run flow — one-shot but sets tone | pending |
| 23 | ob-account.js | Account creation step | pending |
| 24 | signin.js | Sign-in | pending |
| 25 | auth.js | Auth shell/welcome | pending |
| 26 | bio-optin.js | Bio opt-in step | pending |
| 27 | features.js | Feature tour/marketing | pending |
| 28 | settings.js | Settings | pending |
| 29 | reset.js | Password reset | pending |
| 30 | states.js | State showcase — verify whether user-reachable or dev-only before teardown | pending |

## Shipped improvements
- 2026-07-11 · **home** · add: tiered streak-at-risk pill + ribbon + notifications mirror (`90e1105`, tag `fable5/2026-07-11-systematic-screen-by-screen-frontend-imp`) — verify gate GREEN 143/143 · 1745/1745.
- 2026-07-12 · **home** · add: green SECURED pill once today counts — completes the risk/covered/secured tier system (`0485fea`, tag `fable5/2026-07-12-home-secured-pill`) — verify GREEN; 4 pill states verified live at 390px; founder approved.
- 2026-07-12 · **home** · upgrade: streak CTA route fix — locked-window fallback routes to score-breakdown as "View standard" (never a no-op "Log …"), notification rows mirror the ribbon's actionable route (`2444ce5`, tag `fable5/2026-07-12-home-streak-route-fix`) — closes QA #1+#2; verify GREEN; both cases verified live.

## Home — teardown v1 (pass 1 complete)
- **ADD (shipped):** streak-at-risk state `90e1105`; green SECURED pill `0485fea`.
- **UPGRADE (shipped):** CTA route fix + notification mirror consistency `2444ce5`.
- **REARRANGE (shipped):** ribbon as sibling directly under strip.
- **DELETE:** nothing clearly dead found.
- **Open observation (pass 2 candidate):** evening all-overdue state renders "NEXT/LATER" group labels over rows that all carry OVERDUE pills — hierarchy reads contradictory (seen in 390px smoke 2026-07-11).
