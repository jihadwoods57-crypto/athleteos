# Screen Coverage Ledger — screen-by-screen frontend improvement engine

Phase 0 artifact (mandated once per the 2026-07-11 run brief). Every screen in
`proto/redesign-2026-07/js/screens/`, ranked by user impact. Work top-down; no screen skipped.
Ranks are provisional — refine when a screen's teardown reveals its real weight. `index.js` is
the route registry (not a screen); `coach.js` bundles ~9 role screens — track its sub-screens
individually when it comes up.

Status: `pending` → `teardown` → `shipping` → `done`. One improvement per cycle.

| # | Screen (file) | Why this rank | Status |
|---|---|---|---|
| 1 | home.js | Daily-return surface every athlete sees first | **shipping** — teardown v1 done; improvement 1 (streak-at-risk) SHIPPED `90e1105`; at calibration gate |
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

## Home — teardown v1 (cycle 1, feeds next cycles)
- **ADD (shipped):** streak-at-risk state — passive 🔥 pill was identical on safe days and the day the streak dies.
- **ADD (open):** green "secured" pill once todayCounted (QA #3, founder taste call); actionable fallback when all requirements are time-locked (QA #1).
- **UPGRADE (open):** notification mirror rows route to `home` instead of the log action (QA #2); evening all-overdue state renders "NEXT/LATER" group labels over rows that all carry OVERDUE pills — hierarchy reads contradictory (observed in 390px smoke, needs teardown).
- **REARRANGE (shipped):** ribbon placed as sibling directly under strip — urgency above the task list, tap targets independent.
- **DELETE:** nothing clearly dead found in cycle 1.
