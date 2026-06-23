# AthleteOS — Nightshift Build Log

Newest entries at the top. Each entry = what shipped + anything the founder needs.

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
   meal scan-line, spinner, and (new) haptics are in. Reduce-motion is honored in
   Overlay; **extend the reduce-motion check to ProgressBar + Ring** (they animate
   unconditionally). Add press/active opacity to a few remaining raw Pressables.
4. **Empty / edge states** — Plan "all done" ✅, Nutrition logged/unlogged rows ✅.
   Note: the always-populated seed + no "un-log" action means a true zero-state is
   only reachable on a brand-new install pre-onboarding; the score-floor/100 states
   are reachable by interaction and render. Low remaining risk; nice-to-have: an
   explicit "no history yet" treatment for the Home trend on a first-ever day.
5. **Accessibility** — labels ✅, 44px hit targets ✅. Remaining: audit color
   contrast of `textTertiary`/`#CBD5E1` on white vs WCAG AA, and test large system
   font sizes for clipping (Dynamic Type) on the score hero + KPI rows.
6. **Feature completeness (phase-2 backlog)** — `notif` persists (Profile +
   Account) ✅; score history feeds Home trend + week delta ✅ (prior run). Still
   open: **editable protein/calorie/weight targets** flowing into scoring +
   Nutrition (currently `PROTEIN_TARGET`/`CAL_TARGET` are constants); **Parent &
   Coach trend charts** are still hardcoded SVG/arrays (Weekly Compliance 86%,
   NUTRI_BARS, Coach KPIs 84/88%/2) — wire to real history/derived where possible;
   **onboarding input validation** (disable Continue until name/email valid).
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
