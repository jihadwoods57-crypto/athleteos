# AthleteOS — Nightshift Build Log

Newest entries at the top. Each entry = what shipped + anything the founder needs.

## 2026-06-23 (run 4) — the Parent portal goes fully data-driven (no static charts)

Four commits, all three gates green every commit (`tsc --noEmit`, jest,
`expo export -p ios`). Test count 182 → **203** (never dropped). Router
untouched (app/_layout + app/index, no src/app). Phase-2 Supabase scaffold not
touched. This run retired every remaining hardcoded chart on the **Parent View**
(item 6 of the Definition of Done: "wire the Parent/Coach chart geometry to real
history") so the parent's whole screen now reflects the athlete's real week.

- **feat(parent): Weekly Compliance derived from real score history.** The
  card's day dots (a fixed WEEK array), "6 of 7 days on plan", and the cosmetic
  86% were static. New pure `weeklyCompliance()` reuses the SAME padded series
  the Home trend chart draws (so the dots and the trend line can never disagree):
  each completed day at/above `COMPLIANCE_THRESHOLD` (80 — the coach alert bar)
  counts as on-plan, **today** renders as an in-progress indicator and is never
  counted, and the headline % is the completed-day mean (so an early-morning live
  score can't tank the week). +4 tests.
- **feat(parent): Weight Trend drawn from real recorded weights.** The weight
  chart was a hand-drawn SVG path + a fixed dashed goal line at y=30 + an end dot
  at a literal coordinate. Added a **per-day body-weight history** (new
  `WeightPoint` type + persisted `weightHistory`, `appendDayWeight`, and
  `recordDayWeight` snapshotting the cross-day `currentWeight` against its day on
  rollover). New pure `weightSeries()` (real weights, live `currentWeight` as the
  last point, ramping from `WEIGHT_START` while history fills) +
  `weightTrendGeometry()` which **fits the y-axis to the data AND the goal** so
  neither the line nor the dashed goal marker clips, and returns the goal line's
  y on the same axis. The line/area/end-dot and goal line are now live; the goal
  line tracks the editable weight target. +10 tests.
- **feat(parent): Nutrition Trend bars driven from real history.** The last
  static chart — a frozen `NUTRI_BARS` array + cosmetic 92% — now reads a per-day
  **nutrition-score history** (persisted `nutritionHistory` +
  `recordDayNutrition` snapshotting the derived nutrition sub-score on rollover).
  Pure `nutritionTrend()` reuses the score-trend series shape: today's live
  nutrition score is the final (accent) bar; the weekly-avg headline is the
  completed-day mean (today excluded). Bars use real weekday labels + clamped
  heights. +5 tests.
- **test(store): rollover records weight + nutrition history end-to-end.** Two
  store-level integration cases drive the real Zustand persist/merge: a stale-day
  rehydrate now asserts `weightHistory` (the cross-day `currentWeight`, stamped to
  the stale day) and `nutritionHistory` (the derived nutrition sub-score) are each
  appended exactly once, and a same-day rehydrate appends neither — locking the
  run-4 wiring against regressions. +2 tests.

### For the founder (QC this run)
- **Parent View** — every chart is now live. There are **no remaining hardcoded
  numbers/paths** on this screen: Weekly Compliance, the Weight Trend line +
  dashed goal, and the Nutrition bars all derive from persisted history +
  today's live derived state. On a fresh install the charts still read as a
  believable build (seed/ramp padding) and converge on **real** data as the app
  survives day rollovers on a device. Today's column is shown as in-progress and
  is intentionally excluded from the weekly summaries (% / on-plan / avg).
- Nothing to wire up — these are deterministic, offline, and persist across
  reload + rollover via the existing `aos_day` store (no Supabase touched).

## 2026-06-23 (run 3) — editable weight goal, weight-trend drift fix, live Coach KPIs

Three commits, all three gates green every commit (`tsc --noEmit`, jest,
`expo export -p ios`). Test count 175 → **182** (never dropped). Router
untouched (app/_layout + app/index, no src/app). Phase-2 Supabase scaffold not
touched.

- **feat(targets): the season weight goal is now one editable source of truth.**
  The 184 lb season weight target was a magic literal in four places — the Home
  SEASON GOAL card, the Profile "WEIGHT" target tile, and the Check-In + Parent
  weight-trend captions ("goal 184 lb") plus the Check-In chart's "Goal 184" SVG
  label — and it wasn't editable (Profile's "Edit" card stepped only protein +
  calories). Centralized it: new `WEIGHT_START`/`WEIGHT_TARGET` constants, a
  persisted athlete-editable `weightTarget` state field (cross-day pref, clamped
  120–350 lb via the new `adjustWeightTarget` action), and every screen now reads
  the live value with a constant fallback for legacy persisted blobs. The Profile
  target editor gains a **Weight stepper on its own row** (kept off the
  protein/calorie row so the "3,200" calorie value can't clip). +4 store tests.
- **fix(weight): drive the Parent + Check-In weight trend from live state.** The
  Parent portal printed a hardcoded "178 lb" current weight while Home already
  showed the live `currentWeight`, and both the Parent and Check-In trend cards
  hardcoded "↑ +7 lb" — so the parent view drifted the instant the athlete logged
  a new weight at check-in. Wired the current weight to `s.currentWeight` and the
  gain to `currentWeight - WEIGHT_START` (the same start anchor Home's season goal
  uses), with a down-arrow + alert color if the athlete drops below start.
- **feat(coach): derive the Coach dashboard KPIs from the live roster.** The
  Coach header KPIs (TEAM AVG 84, COMPLIANCE 88%, ALERTS 2) were static literals
  while the roster below already injected the athlete's live score, so the headline
  could contradict the roster and never moved. New pure
  `coachRosterKpis(roster)` (mean score, mean compliance, count below
  `COACH_ALERT_THRESHOLD` = 80); CoachView renders those. When the athlete tanks
  their own score the team average drops and they roll into the alert count. The
  honest defaults read 82 / 82% / 2 (vs the old cosmetic 84 / 88% / 2). +3 tests.

### For the founder (QC this run)
- **Profile → Your Targets → Edit**: a third **Weight** stepper now appears; the
  goal flows live into the Home SEASON GOAL card ("N lb target" + the progress
  bar / "to go"), the Check-In and Parent weight-trend captions, and persists
  across reload + a day rollover.
- **Check-In → step the current weight → submit**, then open the **Parent view**:
  the parent's "current weight" and the "↑ +N lb" gain now track the athlete's
  real weight instead of the old static 178 / +7.
- **Coach view header KPIs** now reflect the roster: tank the athlete's own score
  (skip meals/tasks) and the TEAM AVG should drop and ALERTS should tick up.

## 2026-06-23 (run 2) — reduce-motion, editable targets, onboarding validation

Three commits, all three gates green every commit (`tsc --noEmit`, jest,
`expo export -p ios`). Test count 165 → **175** (never dropped). Router
untouched (app/_layout + app/index, no src/app). Phase-2 Supabase scaffold not
touched.

- **feat(a11y): respect Reduce Motion in the Ring + ProgressBar fills.** The
  score-ring draw and every ProgressBar grow-in animated unconditionally,
  ignoring the OS "Reduce Motion" preference that Overlay already honored. Added
  a shared, live `src/ui/useReduceMotion.ts` hook (reads the setting on mount,
  updates if toggled mid-session, resolves false on web) and gated both: with
  Reduce Motion on, the ring offset and bar fills **snap to their final value**
  instead of animating. No change when the setting is off; native animation is
  byte-for-byte identical.
- **feat(targets): editable daily protein + calorie targets that flow into
  scoring.** The Profile "Your Targets" card was dead UI — hardcoded
  `180g / 3,200 / 184lb` tiles and an inert "Edit" label — while the engine read
  fixed constants. Now protein + calorie targets are real, persisted,
  athlete-editable state: `computeDerived` reads `s.proteinTarget`/`s.calTarget`
  (constant fallback for legacy blobs) for the protein gap/pct, nutrition
  sub-score, and the drift-proof protein task (id 2). Store adds
  `adjustProteinTarget` (clamp 80–320g) + `adjustCalTarget` (clamp
  1200–6000 kcal), persisted as cross-day prefs (survive rollover). Profile tiles
  now show live targets; the "Edit" toggle reveals two `Stepper`s. The Nutrition
  protein ring label reads the live target too. +5 store tests.
- **feat(onboarding): validate name + email before Continue.** The account step's
  "Continue" fired unconditionally. New pure `src/core/validate.ts`
  (`isValidName` / `isValidEmail` / `accountStepValid`); Continue is now disabled
  until the name has 2+ chars and the email is well-formed, with a small
  alert-colored hint under the email field that appears only after invalid input
  (never nags an empty field). +5 core tests.

### For the founder (QC this run)
- Turn on iOS/Android **Reduce Motion**: the score ring and progress bars should
  appear already-filled (no sweep) while everything else still works.
- **Profile → Your Targets → Edit**: stepping protein/calories should move the
  Nutrition macro ring/label and the Athlete Score live, and the new values
  persist across reload and a day rollover.
- **Onboarding → Create your account**: Continue stays greyed until a real name +
  email are entered.

## 2026-06-23 — QC finding cleared + accessibility / micro-interaction pass

Six commits, gates green every commit (`tsc --noEmit`, 165 jest tests, `expo
export -p ios`). Router untouched (app/_layout + app/index, no src/app).

- **fix(ring): collapsable web warning — QC finding #1 cleared.** Tracked the
  intrusive red web dev toast to its real source: react-native-web's Animated
  forces `collapsable: false` onto every animated component's props; `Animated.View`
  strips it via RNW's allowlist, but `AnimatedCircle` in `src/ui/Ring.tsx` wraps
  react-native-svg's `Circle`, which forwards unknown props straight to the DOM
  `<circle>` — leaking an invalid attribute. Fix: a **web-only** forwardRef shim
  that drops `collapsable` before it reaches the SVG element. Native keeps the raw
  Circle, so the ring-draw animation is byte-for-byte unchanged on device.
- **feat(haptics): tactile feedback + interaction a11y on key actions.** The app
  shipped with ZERO haptics despite expo-haptics being a dependency. Added
  `src/ui/haptics.ts` — a safe, native-only wrapper (web no-op, swallows errors)
  with three intents (`tap` / `select` / `success`). Wired through the shared
  primitives (Btn fires `tap`, opt-in `haptic="success"`; Chip/Toggle/± steppers
  fire `select`) and the key athlete moments: completing a Plan task → `success`,
  Check-In submit → `success`, meal capture shutter + "Add to Log" → tap/`success`.
- **feat(a11y): label every icon-only button & tab.** Screen readers had nothing
  to announce. Added accessibilityRole + accessibilityLabel (+selected/checked
  state) to the tab bar + camera FAB, overlay close/back, role-view chrome menus
  (Coach/Parent/Trainer), Home header (Notifications/Profile), Messages/Meal-Detail
  send buttons, the Coach check-in + Profile notification toggles, and Sign-out.
- **feat(a11y): 44px minimum touch targets.** No hitSlop existed anywhere; the
  Toggle (28px), ± steppers (38px), 40px chrome buttons and the Squad segmented
  control (~31px) were all under the accessible minimum. Added hitSlop to extend
  each past 44px with **no visual/layout change**.
- **feat(account): Notifications is now a real persisted toggle.** The Account
  overlay's "Notifications" row was dead UI ("On ›" that did nothing) while `notif`
  is a real persisted flag wired into Profile. Replaced it with a live Toggle (+a
  state-reflecting subtitle) so the setting persists from the role-view account
  chrome too.
- **fix(nutrition): derive the Macros calorie target.** The Macros card drew its
  progress bar from `d.calTarget` but printed a hardcoded "/ 3,200 cal" label;
  now the label uses `d.calTarget` so bar and number can never drift apart.

### For the founder (QC this run with a browser/device pass)
- The red `collapsable` dev toast on web preview should be **gone** — taps in QC
  no longer get intercepted by it.
- On a physical iOS/Android device you should now feel light haptics on button
  presses, a selection tick on toggles/steppers, and a success buzz when you
  finish a task, submit a check-in, or add a meal. (Web is silent by design.)
- VoiceOver/TalkBack now announce every icon-only control by name.

## REMAINING TO COMPLETE (mapped to the Definition of Done)

1. **QC findings** — ✅ `collapsable` web warning cleared this run. (No open QC
   findings remain in NIGHTSHIFT-PRIORITIES.)
2. **UX/UI fidelity, every screen/overlay/role** — athlete tabs, overlays, and
   role chrome have had fidelity + a11y passes. Still worth a dedicated
   critique+audit on: **Squad** (leaderboard), **Onboarding** (multi-step),
   **PersonDetail**, **MealDetail**, and **TrainerView** body. Verify type scale /
   spacing / radii against the `.dc.html` handoff one screen per commit.
3. **Motion / micro-interactions** — ring draw, bar grow, overlay slide-up,
   meal scan-line, spinner, and haptics are in. Reduce-motion now honored in
   Overlay **and Ring + ProgressBar** ✅ (shared `useReduceMotion` hook). Remaining:
   add press/active opacity to a few remaining raw Pressables (StepHeader back
   button, Onboarding role/level/sport tiles use Pressable without a pressed style).
4. **Empty / edge states** — Plan "all done" ✅, Nutrition logged/unlogged rows ✅.
   Note: the always-populated seed + no "un-log" action means a true zero-state is
   only reachable on a brand-new install pre-onboarding; the score-floor/100 states
   are reachable by interaction and render. Low remaining risk; nice-to-have: an
   explicit "no history yet" treatment for the Home trend on a first-ever day.
5. **Accessibility** — labels ✅, 44px hit targets ✅. Remaining: audit color
   contrast of `textTertiary`/`#CBD5E1` on white vs WCAG AA, and test large system
   font sizes for clipping (Dynamic Type) on the score hero + KPI rows.
6. **Feature completeness (phase-2 backlog)** — `notif` persists ✅; score history
   feeds Home trend + week delta ✅; **editable protein + calorie targets** flow
   into scoring + Nutrition ✅; **onboarding name/email validation** gates Continue
   ✅; **editable weight target** is now one source of truth ✅; **Parent + Check-In
   weight captions read live `currentWeight` / WEIGHT_START gain** ✅; **Coach
   header KPIs derive from the live roster** ✅. **The entire Parent View is now
   data-driven** ✅ (run 4): Weekly Compliance (`weeklyCompliance`), the Weight
   Trend line + dashed goal (`weightSeries`/`weightTrendGeometry` on a new
   persisted `weightHistory`), and the Nutrition bars (`nutritionTrend` on a new
   persisted `nutritionHistory`) all derive from real history + today's live state.
   Still open: the **Coach view** still has a static NEEDS ATTENTION list (Silva /
   Cole are fixed mock athletes — the ROSTER is a fixture by design, so this is
   "demo data", not a hardcoded chart) and a static AI team summary string; no
   per-day chart remains on Coach. Trainer view not yet audited for static charts.
7. **Test safety net** — ✅ recommendation/leaderboard/content + store-level
   addMeal/toggleTask/addWater/submitCi score-movement tests exist; `npm run
   verify` green. 165 tests. (Optional: a smoke test for the Ring web-shim.)
8. **No dead UI** — Account Notifications now live ✅. Remaining static/no-op
   affordances: Account "Team & roster / Billing / Help" rows and the Profile
   "Units" row show a "›" but have no destination (they are non-interactive
   informational rows, not dead buttons). Decide: build the destinations, make them
   real toggles, or drop the chevron affordance.

## 2026-06-22

- **feat(history): real persisted daily score history feeding the Home trend.**
  Day-rollover now records the prior day's final accountability score
  (`computeDerived`) into a date-keyed, 14-day-capped `scoreHistory` log that
  survives the day reset. New pure helpers in `src/core/history.ts`
  (`appendDayScore`, `trendSeries`) and `dayRollover.ts` (`recordDayScore`);
  the store persists `scoreHistory` and records the prior day on merge. Home's
  trend chart now draws from real history (`trendSeries`), with the seed lead
  padding the left only while history is still filling. +11 tests.
- **fix(scoring): "this week" score delta from real history, not a magic 86.**
  The Home hero and Parent portal show "{delta} this week" beside a 7-day trend;
  the delta was `athleteScore - 86` (disconnected from the chart). It's now
  today's score minus the start of the same visible window, so the number and
  the trend slope always agree. +3 tests.

Verification each commit: `tsc --noEmit` clean, `jest` green (140 tests),
`expo export -p ios` bundles. Router intact (app/_layout.tsx + app/index.tsx,
no src/app).

### For the founder
- Real history only starts accumulating once the app survives a real calendar
  rollover on a device; until then the trend/delta fall back to the seeded lead
  (by design, so a fresh install still renders a believable trend). No action
  needed — just context for why early days still show seed-shaped trends.
- Next obvious history step (deferred — needs more data plumbing): feed the
  Parent/Coach trend charts (still hardcoded SVG paths) and a per-day **weight**
  history from the same persistence, replacing ParentView's static weight curve.
