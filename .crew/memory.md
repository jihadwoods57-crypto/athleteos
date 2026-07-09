# Crew Memory

Cross-cycle learnings. The orchestrator reads this **before** each cycle and appends to it **after**.
Newest entry at the top.

**Purpose:** so a later cycle doesn't re-propose what an earlier cycle's verifier or oracle already
killed. Discovery dedups against what's been **seen** here, not just what shipped — that's what makes
the loop converge instead of thrashing.

## Format
```
### <date> · cycle iN · <area>
- Tried: <what>
- Result: shipped (<tag>) | rejected by <oracle|verifier|constitution> because <why>
- Lesson: <what a future cycle should know>
```

## Entries

### 2026-07-10 · CRITICAL ARCHITECTURE · the shipped app is the PROTO, not the RN screens
- **The crew has been editing dormant code.** `app/index.tsx` renders `<ProtoApp/>` — a WebView that
  loads the `:8124` HTML/CSS/JS prototype (`proto/redesign-2026-07/`, bundled to `assets/proto.zip`).
  Founder-approved 2026-07-07 (`docs/proto-native-app/PLAN.md`): "the proto is the master."
  `src/Root.tsx`/`AthleteApp` (the RN screens) is imported NOWHERE. So EVERYTHING under `src/screens/*`
  and `src/core/*` is DORMANT in production — the proto has its own JS logic + talks to Supabase directly;
  the native bridge (`src/proto/bridge.ts`) carries ONLY camera/push/haptics/share/secure-store, no business logic.
- **The `.crew` oracle (tsc+jest+expo-bundle) tests the RN code, which does not ship.** That is why every
  crew cycle passed green while changing code users never run. FIX THE ORACLE before the next run: point the
  crew at the proto (`proto/redesign-2026-07/js/`) with a browser-based check (serve the dir, drive with
  Playwright — it IS a runnable web app), OR explicitly scope the crew to `src/core` engine reuse only.
- **Audit of the proto vs. this session's RN "fixes":** the shipped proto is MORE honest and does NOT have
  the bugs I fixed in RN — parent compliance (i1): proto uses `scoreHistory:[]` + honest empty states
  ("we won't invent it", coach.js:612); score delta (i2): proto hides the delta when yesterday has no real
  row (state.js:472); sign-out data-loss (i5): proto signOut is a session sign-out, not a local wipe, and
  DELETE has a two-tap confirm (settings.js:260). The recruiting Discipline Record (i7) ALREADY EXISTS in
  the proto (features.js `recruiting` + profile.js:92 row). Only genuine gaps: the comeback churn card and
  Deep Dive (neither in the proto). ONLY the deployed analyze-meal edge-fn spend-ceiling fix was a real,
  live win this session (edge fns are shared by any client).
- Lesson: for THIS repo, "run the app" means serve `proto/redesign-2026-07/` and drive it in a browser —
  never trust the RN gate as evidence a change reaches users.

### 2026-07-10 · founder-directed features · deploy + push + wire orphans
- Founder greenlit the "biggest wins" (built-but-unrendered features), authorized deploying
  analyze-meal (done — live, version 27) and pushing to origin (done — master + tags pushed).
- Shipped i6: comeback re-entry card (computeDerived.comeback → athlete Home). Clean win, conflicted
  with nothing.
- IMPORTANT design note: Discipline Record + Deep Dive were NOT accidental orphans — Profile.tsx:132
  documents they were DELIBERATELY cut on 2026-07-07 ("the 8124 prototype is the master, Profile is
  5 sections only"). Surfaced this to the founder; decision = build a NEW dedicated surface, not re-add
  to Profile. Shipped i7: new Record overlay (recordOpen) with both cards, reached by ONE Profile
  settings row (keeps the slim Profile intact). Deep Dive uses the deployed deep-analysis edge fn.
- Lesson: a scout calling something "orphaned" may be wrong — check for a deliberate-removal comment
  before re-adding. Both analyze-meal AND deep-analysis + assist edge fns ARE deployed on prod
  (ftwrvylzoyznhbzhgism / AthleteOS). RN UI can't be driven live here (no simulator) — bundle+tsc+jest
  is the only oracle for screen wiring.

### 2026-07-10 · founder-directed continuation · merge + fix-all
- Founder authorized merge to master and "fix all, don't stop to validate". Merged i1-i5 to master
  (local, not pushed). Shipped i4 (roster ORDER BY determinism) + i5 (shared confirmSignOut helper —
  Profile had a bare onPress={signOut} that erased local-only data with no confirm). Committed an
  UNGATED edge-function security fix (analyze-meal finalize/memory/order bypassed GLOBAL_CAP — phase
  is client-controlled) flagged for deploy.
- Deferred with reasons (record so a later cycle doesn't retry blindly): [11] role-hydration granular
  loss needs a schema migration to persist the granular role (server only stores coarse enum); base_age
  + days.score security migrations CANNOT be tested here (no docker/local supabase for test:rls) so
  blind-authoring auth SQL was refused; [4] meal-thumbnail N+1 is a 5-file refactor across un-unit-tested
  list surfaces (MealHistory/PersonDetail/MealReview) — backlog, don't rush.
- Lesson: test:rls needs `supabase start` (docker, port 54322) which isn't available in this env — any
  RLS/migration work is founder-side only until that's runnable.

### 2026-07-10 · cycle i3 · ai/honesty
- Tried: number-preservation guard (`rephraseIsSafe`) split decimals — `/\d+/g` made "2.3" -> {2,3},
  so a model rephrase flipping 2.3 -> 3.2 passed. `mealFrequencyInsight` emits `toFixed(1)` decimals.
- Result: shipped (`crew/2026-07-10-i3`). `numericTokens` now `/\d+(?:\.\d+)?/g`; decimal-flip test added.
- Lesson: the file's comment "the engine rounds every figure to an integer" was FALSE — meal-frequency
  emits a decimal. Any future numeric-guard work: assume decimals can reach the guarded prose.

### 2026-07-10 · cycle i2 · reliability/honesty
- Tried: athlete Home "this week" score delta baselined on `series[0]` = seed on days 2-6.
- Result: shipped (`crew/2026-07-10-i2`). Baseline now first REAL day (`series.length - realTrendDays`);
  seeded showcase demo (empty history) keeps `series[0]` slope. Existing "real delta" test only checked
  `typeof number` so it never caught the seed baseline — strengthened it.
- Lesson: `isDay0` only guarded literal day 0; days 2-6 were the unguarded window. The demo is
  distinguished by EMPTY scoreHistory — preserve its showcase slope, fix only real athletes.

### 2026-07-10 · cycle i1 · reliability/honesty
- Tried: kill the seeded-demo-data leak into the parent Weekly-Compliance headline (`SEEDED_LEAD`
  padded into `weeklyCompliance`/`nutritionTrend` aggregates).
- Result: shipped (`crew/2026-07-10-i1`). `npm run verify` green. Excludes seeded lead from
  onPlan/total/pct + avg via `realTrendDays`; flags `ComplianceDay.seeded` / `NutritionTrend.seededBefore`;
  ParentView renders seeded points neutral + honest "Building this week" empty state.
- Lesson: `trendSeries` deliberately keeps the seeded pad for CHART SHAPE — do NOT rip it out (6+
  chart callers depend on it and dots must match the line). The honesty fix is to exclude the pad
  from AGGREGATES + flag it for the UI, not to remove padding. **The identical leak still exists in
  `scoring.ts:375,385` (athlete Home score delta uses `series[0]` = a seed value)** — that is the
  natural next-cycle provable ship, same pattern.

### 2026-07-10 · run note · discovery vs. session limit
- The parallel discovery phase is token-heavy (~1.87M for 22 scouts) and can exhaust the account
  session limit before prioritize/implement/report run. Findings survive in the workflow journal and
  are recoverable. Lesson: on a limited budget, run FEWER scouts per round or checkpoint the founder
  report earlier so a mid-run limit still leaves a written deliverable.

### 2026-07-10 · discovery · recurring theme (for judgment scouts — do not re-file)
- Multiple COMPLETE, TESTED features are built but never rendered: `comeback.ts` (#1 churn card),
  `disciplineRecord.ts` (recruiting/Individual-Plus seller, orphaned by 2026-07-07 Profile redesign),
  `deepDive.ts` (paid weekly AI, no UI caller), Performance/Nutrition athlete screens. Future runs:
  treat "wire an orphaned feature" as the highest impact-to-effort product backlog class; don't
  re-discover them as new each cycle.
