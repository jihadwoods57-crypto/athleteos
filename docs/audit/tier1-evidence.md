# Tier 1 Release-Blocker Evidence — Build Brief Audit (2026-07-21)

The founder's build brief (OnStandard_Claude_Code_Build_Brief.pdf) lists nine Tier 1
release blockers. A three-agent codebase audit found most already shipped on
`compliance-fixes`; the genuinely open gaps were all in the AI meal pipeline and were
closed in this change set. One acceptance artifact per blocker below — code reference,
test, and/or screenshot — so "fixed" is provable, not claimed.

Verification run 2026-07-21: `npm run verify` GREEN (xss-lint, `tsc --noEmit`, full jest
suite, expo bundle). `npm run test:rls` could not run in this environment (no `psql` on
PATH) — acceptable for this change set, which touches no migrations or policies; re-run
with the local Supabase stack before the next schema change ships.

## Already shipped (verified in code, no changes needed)

| # | Brief blocker | Evidence |
|---|---|---|
| 1 | Role routing — role is server-bound, never a demo "view" | `profiles.primary_role` fetched at sign-in AND restored-session boot (`js/state.js` `_syncSession`); router guards bounce a coach/trainer off any athlete route and vice-versa (`js/router.js:173-185`); no role-switcher seam exists. Regression test: `src/core/roleRouting.test.ts`. |
| 2 | No fake coach/athlete dashboard data | `js/coach-data.js` is 100% Supabase-backed (real `days.score`, real signed photo URLs, honest "No logs today"); demo data exists only inside the onboarding tryout flows (`ob2-meal.js` SAMPLE_MEAL), all on pre-auth `ob*` routes. |
| 3 | First-day activation — no retroactive overdue | `js/activation.js` (`windowPreActivation`, `notYetScored`) anchored to server `profiles.created_at`; day verdict withheld until the day is decided (`js/dayverdict.js`). Shipped commits `6afe6dd..931c712`; screenshots `qa-fix-s1..s4-*.jpeg`. |
| 4 | Pre-log = structured review only | The "Check it before it counts" screen (`js/screens/meal.js` `analysis`) shows detections + confidence, editable rows, macro tiles, restriction comparison, and a bounded photo-read paragraph; full coaching + conversation are post-log only (`thread`, "the ONE post-log surface"). |
| 5 | Meal conversation = group chat on the logged-meal screen | Per-meal thread on `meal-thread/{slot}` backed by `meal_comments` (migrations 0046/0049); athlete + coach + AI in one thread; AI rows are service-role-only writes (unforgeable, `meal-chat/index.ts`); coach auto-notified per event class (`classifyMealEvent`). |
| 6 | Share Athlete Code works | Copy/share from real team `join_code` (`js/screens/coach-home.js:361-388`); expire/revoke server-side (`0080_join_code_expiry`); tracked via setup checklist + real joins. |
| 7 | Setup progress persisted | `coach_setup_state` table (migration 0092) + required steps derived from real server signals (live code, saved requirement_set, roster) — survives logout/reinstall. |
| 8 | Bottom nav / back / scroll | Safe-area insets + scroll restoration in `js/router.js:246-256`; this pass added safe-area-aware global bottom clearance (`css/app.css` `.viewport`) so the tabbar can never cover the last action on any screen. |

## Gaps closed in this change set (2026-07-21)

### 9a. Meal-session isolation — a deleted food is gone from EVERYTHING
Was: pre-log food deletion removed the food from the list but left the AI's macro totals,
score inputs, and prose untouched ("macros stay the AI's estimate").
Now:
- `analyze-meal` returns per-food macro estimates (`MEAL_TOOL.detected[].protein/kcal/carbs/fat`,
  required; prompt demands per-food numbers sum to the totals).
- Totals are the SUM of per-food DB-grounded macros (`js/nutrition.js` `groundMealFromFoods`),
  so deletion subtracts exactly that food's share.
- `act.recomputeStagedMeal` (`js/state.js`) runs after every edit: totals re-sum, quality
  recomputes, and `stripFoodMentions` scrubs the removed food from analysis/note/highlights.
- Old payloads without per-food macros honestly keep the AI totals (`recomputed=false`,
  hint says "macros stay the AI's estimate"); the prose scrub runs regardless.
- Tests: `src/core/protoMealPropagation.test.ts` (delete subtracts to the gram; add prices
  from the DB; legacy fallback), `src/core/protoNutrition.test.ts` (grounding bounds).
- Screenshots: `qc/tier1-s1-analysis-staged.png` → `qc/tier1-s2-after-delete.png`
  (42g→7g protein, 100→67 quality, chicken gone from list AND prose, "recalculated" hint).

### 9b. Score & language from ONE deterministic evaluation
Was: `meals.quality` was the raw LLM number (invariant violation: AI set the score).
Now:
- `mealQualityScore` (`js/meal-intel.js`) computes quality in application code from the
  SAME `componentStates` evaluation the score rubric displays — score and explanation
  cannot disagree by construction. Band labels/thresholds unchanged (OPEN founder decision).
- The AI's own quality survives only as `aiQuality`, feeding the `meal_score_delta`
  cross-check analytic (client `analytics.js` + server `analytics-ingest` whitelist) —
  never displayed, never stored as the score.
- Tone validator `analysisAgreesWithBand`: AI prose that can't sit next to the computed
  band (the "keep it in rotation on a 62" bug) is replaced by the deterministic
  `qualityReason` line, and `meal_text_conflict` is tracked.
- Tests: `src/core/protoMealQuality.test.ts` (band boundaries, timing costs, rubric
  agreement, tone conflicts).

### 9c. DB-backed nutrition in the shipped flow (AI-architecture invariant)
Was: the shipped WebView applied only hard caps (protein≤120 etc.); the real food-DB
grounding existed only on the legacy RN path (`src/core/macroGrounding.ts`).
Now: `js/nutrition.js` ports the curated food DB + grounding into the proto — per-food
clamping against per-serving reference bands, Atwater kcal reconciliation, DB pricing for
user-added foods (`parseServings`). Table parity with `src/core/foodDb.ts` is asserted by
`protoNutrition.test.ts` so the two can never drift silently. Hard caps remain as the
outermost belt-and-braces.

### Done button (brief: "Missing Done button")
Full-width Done on the post-log meal thread (`js/screens/meal.js` `thread`) — returns
home, preserves the conversation, never auto-publishes. Screenshot:
`qc/tier1-s3-thread-done.png`.

## Founder ops required to activate server-side pieces
- Deploy `analyze-meal` (per-food macro schema) and `analytics-ingest` (two new event
  names). The client tolerates BOTH payload shapes, so deploy order is safe either way.
- Watch `meal_score_delta` after ship: it quantifies AI-vs-deterministic drift per meal.

## Surfaced OPEN decisions (not decided in code, per the brief)
- Final score bands/labels/thresholds (current 75/50 bands kept as-is).
- Staff sensitive-field visibility: staff gating is per-athlete-scope (`can_view` +
  `staff_scope_blocks`), NOT per-field — in-scope staff currently see weight/dietary.
- Blue-glow vs burnt-orange accent.
- Platform fees / tier pricing items.
