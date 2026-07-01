# OnStandard — Day 3–4 Work Queue (crew handoff)

**Source:** Night-2 advisory-board review (`docs/board-review/2026-06-27-executive-report.md`) +
founder decisions (2026-06-27). **Authored by the board convener (review-only); the *crew* executes.**
Branch: `crew/4day-sprint`. Window: Day 3 (Sat) → Day 4 (Sun).

> **Goal, stated honestly:** get readiness as high as the work actually earns — not the number by fiat.
> Realistic ceiling for two days: **Product 3→6, Reliability 4→5, Trust & safety 2→3.** Business (2)
> and Market (2) do NOT move without a real cohort + a price — that's the post-loop milestone, not this
> weekend. The next board scores whatever actually lands.

## Founder decisions driving this queue
- **D-A.** Rename the headline score. *Founder call: "Development Score."* **Board reservation (unresolved):**
  the score measures adherence/nutrition/self-report, not athletic development, so "Development" over-claims
  exactly what the board asked to stop claiming; honest alternatives are **Accountability / Adherence /
  Consistency**. **Confirm the final string with the founder before the find-replace.**
- **D-B.** Remove the 57-point nutrition floor — a zero-effort day must score low. Trust > feel-good.
- **D-C.** Prioritize real-user validation over new features. **No new feature areas** until the loop is
  validated. Reminders / weekly-report / recovery / messaging-delivery stay deferred.

## Guardrails the crew must keep
- `EXPO_PUBLIC_BACKEND_LIVE` stays **OFF** unless the founder explicitly authorizes a closed cohort.
  Flipping it forces the consent gate live (fails closed for minors) — do not flip unilaterally.
- `src/core` stays pure; one job = one commit; `npm run verify` green on every commit; push after each.
- No live-DB mutation, no `supabase db push`, no merge to master.

---

## TIER 1 — the loop you defined (moves Product 3 → 6)

The Day 3–4 objective: *meal uploads → saves → score updates → coach sees it → coach gets the insight.*
The hidden blocker is **not** the Save button — it's that the nutrition score reads a constant keyed on a
boolean. Fix in this order.

1. **Persist meal edits.** `MealDetail` edits live in local `React.useState`; "Save Changes" →
   `s.closeMealDetail` (`src/screens/overlays/MealDetail.tsx:223`) discards them.
   - Add a store action (e.g. `saveMeal(mealId, foods)`) that writes the edited `EditableFood[]` into
     persisted day state (`s.meals` / day slice in `src/store/useStore.ts`).
   - "Save Changes" calls it; reopening the meal shows the saved foods, not the `DINNER` demo fallback
     (`MealDetail.tsx:39`).
   - **Accept:** edit a portion / add a food / hit Save / reopen → edits persist across close *and* app
     reload (it's in the persist whitelist).

2. **Route the score through real macros (the deep one).** `proteinToday`/`kcalToday` come from the
   `MEAL_MACROS` constant keyed on the boolean `state.meals[key]` (`src/core/content.ts:175`,
   `src/core/constants.ts:23`), so logging is binary and ignores what was eaten.
   - Compute the nutrition inputs from the *saved* per-meal macros (sum of `servings·per`), so an edited
     plate moves `nutritionScore` and the headline.
   - Keep `src/core` pure; add tests in `scoring.test.ts` / `mealEdit` proving an edit changes the score.
   - **Accept:** logging a high-protein meal vs. an empty day produces materially different scores; the
     number a coach sees derives from real logged macros, not a slot constant.

3. **Wire one coach surface end-to-end.** With the cohort authorized + flag on: persisted day →
   `pushDay` (`src/store/sync.ts`) → `useLiveRoster` (`src/screens/roles/useLiveRoster.ts`) → updated
   score + existing derived insight (`needsAttention`/reason, `src/core/attention.ts`) on `CoachView`.
   - The insight already exists; this step is the *delivery* (athlete day → coach roster read).
   - **Accept:** an athlete logs → a coach on a second context sees the updated score and the at-risk
     reason. (If the founder does NOT authorize the flag, demo this same-device and label it Sample.)

---

## TIER 2 — reliability + the regressions Day-2 opened (Reliability 4→5, Trust 2→3)

4. **Remove the 57-pt floor and RESCALE (D-B).** Today `nutritionScore = round(57 + protein·30 +
   meals·15)` (`src/core/scoring.ts:162`) → floored at 57. Deleting `57+` collapses the max to 45 and
   deflates everyone — **rescale** so a full day ≈100 and an empty day ≈0 (e.g. `protein·65 + meals·35`,
   keeping protein dominant). Update `scoring.test.ts`; expect the seeded roster to score lower (honest).
   - **Accept:** zero meals + zero protein → nutritionScore near 0; a full honest day → near 100.

5. **Close the minor-messaging hole.** Day-2 shipped minor↔adult messaging with no governance.
   - Either **scope messaging to adults-only for beta**, or add an age/guardian gate to the `messages`
     RLS (`supabase/migrations/0002_rls.sql:143-148`).
   - Remove the hardcoded **"Active now"** presence lie (`src/screens/overlays/Messages.tsx:42`).
   - Persist `msgThread` (add to the partialize whitelist, `src/store/useStore.ts:612-639`) so a
     coach→athlete message leaves a record.
   - **Accept:** no unsupervised adult→minor channel ships; no "Active now" while delivery is off; thread
     survives reload.

6. **Rename the headline score (D-A).** Find-replace the user-facing string across screens/onboarding
   (`Home.tsx`, `ScoreReveal.tsx`, the "What's in this score?" panel, onboarding copy) — **after** the
   founder confirms the final word (Development vs Accountability/Adherence). Verify no half-renamed
   strings remain. **Accept:** one consistent name everywhere; the onboarding "development plan" copy
   doesn't collide with it.

---

## TIER 1.5 — cheap trust wins (do alongside Tier 1; high points-per-hour)

7. **Kill demo strings on live screens** (mostly one-line deletes / trivial derivations):
   - `Home.tsx:179` "38 days left", `:193` "by Playoffs · Nov 14", `:244` "by Nov 7"; `:412` "2 days
     left"; the fake red notification dot `Home.tsx:112`.
   - `CheckIn.tsx:78` "Week 14"; the static weight-trend SVG `CheckIn.tsx:151-153`; the static "AI weekly
     summary" `CheckIn.tsx:63-65` (must reflect the actual slider inputs or be removed).
   - The `SEEDED_LEAD` streak pad (`src/core/history.ts:218,226,304`) → show real earned days only.
   - **Accept:** a fresh athlete sees no fabricated dates, charts, streaks, or praise that contradict
     their own data.

8. **Add a persistent "not medical advice — consult a doctor/RD" line** on every AI coaching surface
   (`src/core/coaching.ts` output rendered in `MealDetail`/coaching cards). Soften deficit/cut framing for
   a minor population. **Accept:** the disclaimer is visible wherever the app gives dietary direction.

---

## What this does NOT include (deferred per D-C)
Reminders firing, weekly-report UI, recovery/`blendRecovery` wiring, messaging *delivery*, server-side
score recompute, sync conflict handling, real VPC flow, privacy policy. These are post-validation or
founder-gated. Do not start them this sprint.

## Dimension targets (honest)
| Dimension | Now | Target if Tier 1 + 2 land |
|-----------|:---:|:-------------------------:|
| Product readiness | 3 | **6** |
| Reliability | 4 | **5** |
| Trust & safety | 2 ↓ | **3** |
| Business readiness | 2 | 2 (needs a cohort + price) |
| Market readiness | 2 | 2 (needs a real funnel) |

Verdict still gated by the weakest load-bearing dimension for the chosen cohort. The board re-scores all
five next night on what actually shipped.
