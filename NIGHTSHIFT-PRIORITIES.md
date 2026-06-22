# AthleteOS — Autonomous Build Priorities

The overnight crew ranks the work queue toward these. Higher = more valuable.
Each job must end with the app still compiling (`tsc --noEmit`), tests passing
(`jest`), and bundling (`expo export -p ios`). One job = one clean commit.

## Doctrine
- This is a real Expo + React Native + TypeScript app at this repo root.
- `src/core` is **pure TS** (no RN imports) — the scoring engine + domain. Keep it pure.
- `src/store` Zustand + AsyncStorage. `src/ui` tokens/primitives. `src/screens` per role.
- Match existing conventions. Read neighboring files before writing. No new heavy deps
  without a clear need. Never break the two-layer discipline (pure core vs UI).
- AI features are deterministic simulations for now (no API keys). Keep them offline.

## QC findings to fix FIRST (from a live web walkthrough, 2026-06-21)
These were found by actually running the app and clicking every screen — prioritize them.
1. **Nutrition screen is unreachable.** `src/screens/athlete/Nutrition.tsx` is fully built
   but nothing navigates to it — the bottom tab bar is Home · Plan · [Camera FAB] · Squad ·
   Check-In, and `goNutrition` is never called. Give Nutrition a real entry point. The design
   handoff's athlete bar was **Home · Plan · [FAB] · Nutrition · Squad** with Check-In reached
   from the Home banner. Reconcile the navigation to match the handoff so Nutrition is reachable
   AND Check-In still has an entry. Verify by rendering, not just compiling.
2. **Web dev warning: `collapsable={false}` leaks to the DOM** via react-native-web, throwing
   a red dev error toast on the web preview ("Received `false` for a non-boolean attribute
   `collapsable`"). Harmless on native, but it muddies the web QC. Track down the source
   (likely an Animated/SVG wrapper — check `src/ui/Ring.tsx`) and stop passing `collapsable`
   on web, or filter it at a shared wrapper. Must not change native behavior.

## Phase 2 backlog (highest value first)

### 1. Test coverage + safety net (do early — protects every later job)
- Unit-test `recommendation.ts`, `leaderboard.ts`, `content.ts` (paceProjection, mealResultFor, aiInsight).
- Add a store-level test: simulate addMeal / toggleTask / addWater / submitCi and assert the
  derived score moves the way the prototype intends.
- Add a tiny CI-style script `npm run verify` = typecheck + test + bundle.

### 2. Desktop dashboards (the deferred phase-2 surfaces)
- Stand up a sibling web target that **reuses `src/core`** (extract to `packages/core` or a
  shared path alias). Recreate the 3 desktop dashboards from the design handoff
  (`../athleteos-design-ref/design_handoff_athleteos/Coach Dashboard.dc.html`,
  `Parent Portal.dc.html`, `Trainer Portal.dc.html`): 1320×880, left sidebar (248px),
  top bar (72px), KPI rows, roster table, trend + bar charts, empty states.
- Use the SAME design tokens and scoring engine. Coach = roster table + breakdown;
  Parent = score ring + KPIs + weight/nutrition charts + coach notes; Trainer = multi-org
  client table (org tag colors) + book-compliance trend + needs-follow-up.

### 3. Polish + parity pass on the mobile app
- Audit each screen against the handoff (`AthleteOS.dc.html`) for spacing, color, copy,
  and interaction fidelity. Fix drift. Add the animations called out in the README
  (ring draw, bar grow, overlay slide-up, scan-line, pulse) where missing.
- Empty/edge states: zero meals logged, all tasks done, score at 100 / at floor.
- Accessibility: hit targets ≥44px, color contrast, screen-reader labels on icon buttons.

### 4. Real persistence depth
- Day-rollover logic (a new calendar day resets the day slice but preserves streak/history).
- A simple local history store (last N days of scores) feeding the Home "Score Trend" and
  the Parent/Coach trends from real data instead of static SVG paths.

### 5. Settings & account depth
- Make the Profile/Account toggles actually persist (units, notifications).
- Editable targets (protein/calories/weight) that flow into the scoring + nutrition screens.

### 6. Onboarding completeness
- Validate inputs (name/email), disable Continue until required fields are set per step.
- Persist onboarding selections so a returning user lands in the right role.

## Free-pick
Beyond this list, pick the highest-leverage improvement to correctness, fidelity, or
robustness. Prefer small, verifiable, revertible jobs over big risky ones.

## Never
- Never send anything external. Never add paid services/signups. Never run `expo start`
  or any long-running/interactive command (only `tsc`, `jest`, `expo export`).
- Never delete `node_modules`, `.git`, or another job's committed work.
