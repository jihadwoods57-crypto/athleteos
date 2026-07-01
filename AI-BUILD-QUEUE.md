# AI-BUILD-QUEUE — OnStandard AI Forge

Dependency-ordered slice list the **OnStandard AI Forge** crew works through
(`.claude/workflows/onstandard-ai-forge.js`). Human-readable source of truth; the
workflow embeds a mirror of the `SLICES` array — **keep them in sync**.

The crew builds one slice at a time: **Build → Smoke → Critique (4 safety floors) →
Adversarial Verify → Gate → commit+tag**. It commits to the working branch only,
**authors** migrations but never applies them to live, and never sends anything external.

Spec source for every slice: `docs/architecture/05-ai-systems.md` (the authority-boundary
contract). Deterministic backings that already exist and must be **reused, not rebuilt**:
`src/core/{attention,weeklyReport,adherence,nutritionMemory,coaching,messaging,membership}.ts`.

---

## The four safety floors (hard blockers on every slice)

A slice ships only if a green build **and** all four floors clear **and** the adversarial
verifier fails to break them:

1. **Authority boundary** — the LLM never writes a score/target/plan and never sends. Every
   model output is validated server-side through `arbitrate()` and demoted to a suggestion on
   conflict. (doc-05 §8)
2. **Numbers-never-change** — every new AI language surface carries the number-preservation
   guard (pattern: `src/core/nutritionMemoryVoice.mergeRephrasedInsights`) with a test proving
   a numeric drift is rejected. (doc-05 §3)
3. **RLS / consent** — no athlete outside `membership.canView()` reaches a prompt; the consent
   gate (`src/core/consent.realDataConsent`) stays intact; no PHI / photos / raw names in
   Copilot context. (doc-05 §6.3)
4. **Green build** — `npm run typecheck && npm run test` passes (the smoke gate).

---

## Phase 1 — Foundations (pure core, inert)

- **S1 `aiAuthority`** — `src/core/aiAuthority.ts` → `arbitrate()`; demotes any model assertion
  to a suggestion (coach plan / deterministic engine win). +tests. builders: core. needs: —.
- **S2 `assist-contract`** — `src/core/assist.ts` → the ContextPack contract, task enum, and
  deterministic-fallback shape. +tests. builders: core. needs: —.
- **S3 `personality`** — `src/core/personality.ts` → `clampForAudience()` style token + minor
  safety clamp; never a content switch. +tests. builders: core. needs: —.

## Phase 2 — Coach Copilot (flagship)

- **S4 `copilot-core`** — `src/core/copilot.ts` → maps the 7 tools (`whoNeedsAttention`,
  `whoMissed`, `summarizeNutrition`, `positiveTrends`, `predictFallingBehind` [deterministic
  trend, labeled — no ML], `draftAccountabilityMessage`, `draftReport`) onto the existing cores;
  returns the `CopilotResult` frame (`tool/data/narration/isDraft/grounding`); scoped via
  `canView()`. +tests. builders: core. needs: S1, S2.
- **S5 `copilot-migration`** — `supabase/migrations/0016_copilot.sql` → `copilot_artifacts` +
  RLS + `activity_log` (audit) + `draft→sent` RPC (requires `msg.send` + audit write; the edge
  fn has **no** send capability). builders: migration. needs: S4.
- **S6 `assist-fn`** — `supabase/functions/assist/index.ts` → builds the RLS-scoped ContextPack
  (no PHI/photos/raw names), model picks+narrates a tool, validates via `arbitrate()`, falls
  back to deterministic on failure, logs every call. Model split: Fable 5 for deep roster
  analysis, Opus 4.8 for routine; server-side fallback on health-adjacent refusals. builders:
  edge. needs: S4, S5.
- **S7 `copilot-ui`** — Copilot surface in `src/screens/roles/CoachView.tsx` (query box + draft
  review/edit/send). builders: ui. needs: S6.

## Phase 3 — AI Memory + Performance Profile

- **S8 `memory-migration`** — `supabase/migrations/0017_athlete_memory_facts.sql` + RLS
  (`mem_self`, `mem_coach_rd`). builders: migration. needs: S5.
- **S9 `memory-core`** — `src/core/memory.ts` → validate/dedupe/promote/`retrieveForTask`;
  `candidateFactsFromCorrection()` wired into `src/core/mealEdit.ts`. **Cardinal rule: LLM
  proposes candidates only; deterministic pipeline validates; safety kinds (allergy/dislike)
  route to athlete confirmation; the LLM never writes the store.** +tests. builders: core.
  needs: S8.
- **S10 `profile-migration`** — `supabase/migrations/0018_performance_profiles.sql` + RLS
  (`pp_read`, `pp_self_update`) + RPCs (`add_coach_feedback`, `confirm_profile_fact`).
  builders: migration. needs: S5.
- **S11 `profile-core`** — `src/core/performanceProfile.ts` → `buildProfileView()` read-only
  projection. +tests. builders: core. needs: S10.
- **S12 `memory-extract`** — `memory_extract` task in the assist fn (LLM proposes → deterministic
  validate → safety confirmation) + athlete fact-confirmation UI. builders: edge, ui. needs:
  S6, S9.
- **S13 `profile-ui`** — coach-facing Performance Profile view. builders: ui. needs: S11.
- **S14 `behavior-job`** — scheduled deterministic job accruing behavior-pattern `evidence_n`.
  builders: edge. needs: S9.

## Phase 4 — Meal-coaching voice + Personality

- **S15 `meal-coaching-voice`** — `meal_coaching` task + voice guard (reuse `src/core/coaching.ts`
  + the `nutritionMemoryVoice` guard so numbers lock and disclaimers always append). The bounded
  athlete-facing win — no chat, no free generation. +tests. builders: edge, core. needs: S2, S3.
- **S16 `personality-wire`** — apply the AI Personality style token (`clampForAudience`) inside
  the assist fn. builders: edge. needs: S3, S6.

---

## Guardrails (tightened for a production minors' health backend)

- Commit to the **working branch only** — never master.
- **Author** migrations; **never apply** them to the live project (founder applies to a
  preview/branch DB first, then live).
- Never send external, never spend past the token ceiling.
- **Verify, don't assert** — a slice ships only if the critics confirmed it ran (typecheck +
  tests + read diffs), not because a builder claimed it.
- Run from a **clean tree** on the crew branch. Builders report the exact files they touch; the
  smoke step stages/reverts only those paths, never unrelated working-tree files.
