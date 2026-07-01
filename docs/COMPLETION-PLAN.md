# OnStandard — Plan to Completion

The ordered roadmap the autonomous crew works against to reach **APP COMPLETE**. Work the
phases **in order** (later phases depend on earlier ones). Within a phase, finish every task
and meet the **acceptance criteria** before moving on. Check items off here (`[ ]` -> `[x]`) as
you complete them, and mirror progress in NIGHTSHIFT-LOG.md. Items marked **(HUMAN)** cannot be
done by a no-eyes crew run: implement the code/logic, then flag them under NEEDS HUMAN for the
founder's visual pass instead of claiming they are done.

Every commit keeps all three gates green (`npm run typecheck`, `npm run test` never dropping the
count, `npm run bundle`). One job = one commit. Guardrails in NIGHTSHIFT-PRIORITIES.md always apply.

---

## Founder QC findings to fold in (2026-06-24 visual pass)
A real new-athlete visual pass confirmed Phase 0/1 render correctly. Two nits to fold into the phases below:
- [x] **Season Goal "On track" lies at 0%** (honesty; do with Phase 0/5). Fixed (2026-06-24 run): pure `seasonGoalPhase()` gates the claim. A brand-new athlete still at their start anchor with empty `weightHistory` now sees a neutral first-run state ("Just getting started. Log your check-ins and weight to see your pace") on a muted background; the on-track/reached copy only renders once real weight movement exists. The seeded demo (178 from 171) is unchanged.
- [x] **Profile subtitle drops the position** (data-flow; do with Phase 0/4). The subtitle already surfaced position via `athleteSubtitle`; the 2026-06-24 run finished it by making `POSITION_LABELS` sport-keyed (a baseball "C" Catcher was rendering as a basketball "Center", and most sports' codes leaked raw). Every onboarding position code now expands per the athlete's sport.

## Phase 0 — Foundation reconcile (do FIRST; everything builds on this)
The new onboarding and dashboards are only honest if a real new athlete's state flows through.
- [x] **New-athlete day-0 reconcile**: a brand-new athlete's first day continues from the
  Starting Point Score (seed day-0 + write `startScore` into `scoreHistory`); no seeded demo
  data (Jihad / Eastside HS / Coach Davis note / seed weight) leaks for a real new user. Keep
  the seeded-demo experience intact and do not break day-rollover. (run 1 + run 2: the coach
  note and the body weight were the last two leaks.)
- [x] **Onboarding -> app data-flow**: `primaryGoal` (AI coach), `sport` + `position` (Profile),
  the editable targets (scoring), and the onboarding body weight (`startWeight`/current/check-in)
  all SURFACE in the app. Remaining: `trainingFreq` is collected + persisted but not yet
  displayed (a founder visual/product call on where it belongs — see NIGHTSHIFT-LOG).
- **Acceptance**: tests prove a fresh athlete (no persisted blob) who completes onboarding sees
  their own sport/position/targets and a Home score consistent with their reveal, with zero demo
  leakage. `npm run verify` green.

## Phase 1 — Navigation & coherence (no dead ends)
- [x] Complete `docs/NAV-MAP.md` (every screen -> entry points -> exits).
- [x] Fix every dead end / wrong destination (run 1: overseer Nudge, Profile Help row; run 2:
  the leaked Coach Davis guidance card now gates to an intentional state, PersonDetail title
  noun matches the opener). No known CTA-with-no-handler / unreachable screen remains.
- [x] Consistency sweep: role nouns consistent (coach=athletes, trainer/nutritionist=clients,
  parent=athlete; shared overlay titled per opener), "AI Nutrition Coach" naming consistent, NO
  em dashes in shipped copy (grep clean; comments exempt), no value showing two different numbers
  on two screens (the seed weight was the last; fixed run 2).
- **Acceptance**: NAV-MAP has zero unresolved dead ends; a grep finds no em dashes in `src/`;
  render-smoke tests (Phase 6) cover every screen.

## Phase 2 — AI Nutrition Coach completeness
- [x] Coaching content is goal-aligned across all goal themes (muscle / lean / engine) and reads
  like a nutritionist, not a tracker; macros stay demoted. (2026-06-24 run: a goal x meal matrix
  test locks theme-aligned copy for all 12 goals x 4 slots; unified the engine-theme insight to
  name the meal slot like the other two themes.)
- [x] The coach's note is carried forward and reinforced (loop #2, `coachEcho`); the score impact
  is the honest engine delta (`mealScoreImpact` recomputes the real engine).
- **Acceptance**: `coaching.ts` tests cover every theme + edge cases; the result renders for
  every meal type and goal ✅. **(HUMAN)** final visual polish of the coach screen.

## Phase 3 — Coach / overseer intervention ("who needs my attention today")
- [x] **At-risk detection** (pure core): per-athlete derived reason from real data, ranked
  most-at-risk first; replace the static "Needs Attention" strings. (run 3: pure
  `core/attention.ts` `needsAttention()` drives the Coach NEEDS ATTENTION and Trainer NEEDS
  FOLLOW-UP lists off the live roster/book; same `score < threshold` predicate as the
  alerts/follow-ups KPI so the list length always matches the badge; derived reason = compliance +
  trend + "days quiet" recency; tone-driven color. Fixed a real coherence bug: a phantom trainer
  client not in the book. run 4: pure `rankByRisk()` now sorts the full Coach Roster + Trainer
  All-Clients tables worst-first too, so the table agrees with the ranked Needs-Attention card.)
- [x] **Score language**: 95 "on standard" / 75 "on the bubble" / 60 "needs intervention", wired
  so words always match the number. (run 3: `scoreLanguage()` + a band-colored status word in the
  PersonDetail overlay.)
- [x] **Nudge + acknowledgement model** (loop #3): structured coach->athlete nudge + a
  derived "did compliance move after the nudge" read; store actions + selectors + tests, wired
  into the existing dashboard rows. (2026-06-24 run: pure `core/nudge.ts` records the athlete's
  compliance/score at send-time, `nudgeOutcome` derives the honest acknowledgement read by
  comparing that baseline against live compliance. Offline + deterministic, so it never fabricates
  an athlete response: the static demo honestly reads "No change yet since your nudge, follow up"
  and lights up the instant real compliance moves. Surfaced in the shared `PersonDetail` overlay;
  Coach/Trainer/PersonDetail all thread the baseline through `sendNudge`. Day-scoped alongside the
  `nudged` flag, cleared on rollover. +13 tests.) **(HUMAN)** the athlete-side "seen/acted-on"
  signal is deferred: an offline demo has no real athlete client to source it from, so faking it
  would fabricate a response. Flag for the founder when the real backend lands.
- **Acceptance**: detection + ranking + nudge model fully unit-tested. **(HUMAN)** the nudge UI /
  acknowledgement screen rendering.

## Phase 4 — Role personalization (all 7 roles)
- [x] Language / labels / goals personalize per role across dashboards + onboarding; nutritionist
  rides the trainer foundation with a nutrition lens (compliance, protein adherence, meal consistency).
  (2026-06-24 run: pure `trainerLens(role, isReal)` personalizes the shared trainer/client
  dashboard header, org label, compliance-card title, and follow-up empty state so a nutritionist
  reads "Your Nutrition Clients / Nutrition Compliance" while a personal trainer keeps the generic
  book framing - consistent with the Account "nutrition clients" copy. Coach archetype already
  personalizes via `coachTeamTitle`; the parent + athlete flows already surface their own nouns.)
- **Acceptance**: a tested personalization map (`trainerLens` + `accountRows` + `coachTeamTitle`,
  all unit + smoke tested); each role surfaces its own nouns ✅. **(HUMAN)** visual check of each
  role view.

## Phase 5 — Polish & hardening
- [x] Empty + edge states everywhere (zero meals, all done, score 100 / floor, brand-new athlete).
  (Plan "all done" + Nutrition logged/unlogged rows + honest 0g macros on a zero-meal day + the
  first-run Season-Goal neutral state + the score-floor/100 bands all render via the smoke net.)
- [x] Accessibility: `accessibilityLabel` on every icon-only control; >=44px targets;
  **Dynamic Type caps** on the big new numerals (score reveal, baseline counters/scales);
  WCAG-AA contrast (the failing `#CBD5E1` readable text retired to `textSecondary`, locked by a
  pure `core/contrast.ts` guard). (runs 6/7/9; `MAX_FONT_SCALE` caps the fixed-geometry chrome.)
- [x] Motion + `expo-haptics` where the design calls for it; reduce-motion honored (shared
  `useReduceMotion` across Overlay + Ring + ProgressBar; every Onboarding Pressable presses + haptics).
- **Acceptance**: a11y + contrast checks pass in code ✅; Dynamic Type caps present ✅. **(HUMAN)**
  on-device/browser visual QC of the polished screens.

## Phase 6 — Test net & verify (continuous, finalized here)
- [~] Render-smoke test (run 2): a node-env screen-DATA smoke net drives the same pure selectors
  every screen renders from across edge states + every role and asserts no throw + coherent
  values. A TRUE mount-the-React-tree test is blocked here (jest 30 vs jest-expo's
  `@react-native/jest-preset` peer) and needs a human toolchain call — flagged in NIGHTSHIFT-LOG.
- [x] Unit/store tests for all new logic (onboarding actions, startingScore, coaching, at-risk,
  nudge model, personalization). (at-risk: `core/attention.test.ts`; nudge model: `core/nudge.test.ts`
  + the store `nudge acknowledgement log` suite; coaching matrix, season-goal phase, trainer lens
  all locked. 517 tests green.)
- [x] `npm run verify` (typecheck + jest + bundle) green (517 tests).
- **Acceptance**: every screen has smoke coverage ✅; verify green ✅. **(HUMAN)** the true
  mount-the-tree harness remains toolchain-blocked.

---

## Definition of Done
All six phases complete and their acceptance criteria met, every **(HUMAN)** item implemented in
code and flagged for the founder's visual pass, `npm run verify` green. When that holds, write
**"APP COMPLETE — ready for founder review"** at the TOP of NIGHTSHIFT-LOG.md with the open
NEEDS HUMAN list.

## Out of scope (do NOT build)
Phase-2 Supabase wiring (scaffold stays inert), real LLM / camera (stay deterministic), wearables,
Apple Health / Garmin / Whoop, recruiting, NIL, social / community, advanced reporting, team chat.
