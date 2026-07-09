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
