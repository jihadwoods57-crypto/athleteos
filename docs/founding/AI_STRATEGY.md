# AI_STRATEGY — how AthleteOS uses AI (board altitude)

> **Status:** FOUNDING DEEP-DIVE. This **elevates and integrates** the AI canon already specified in
> `docs/architecture/05-ai-systems.md` (fully designed) plus the AI moats/philosophy in
> `00_STRATEGIC_QUESTIONS` §3/§18-C and `05_SYNTHESIS_AND_CHALLENGES`, and the built seams in
> `src/lib/ai/` + `supabase/functions/analyze-meal/`. It does **not** override or re-derive them. The
> seven keystone decisions (D1-D7) and the Constitution §11a Scoring Contract remain canon.

## A. The one principle

**AI rewords and assists; the deterministic core decides; the numbers never change.** Every AI surface
in AthleteOS sits on top of a pure, testable engine in `src/core` that computes the truth. The model may
phrase, explain, draft, and warm the language. It may not change a number, invent a fact, or re-decide
structure. This is not a guideline; it is enforced in code and on the server.

## B. The authority boundary (immutable hierarchy, `05-ai-systems` §3)

Inputs to any model, highest authority first. Lower never overrides higher:

1. **Safety floor** (medical disclaimers, minor calorie bounds, stated allergies). Nobody overrides this.
2. **The coach's plan** (targets, windows, profile). Deterministic, immutable input.
3. **The deterministic engine** (Development/Execution Score, at-risk ranking, macro grounding). Source of truth.
4. **The AI language layer** (explanation, drafting, phrasing). May suggest, never decide.
5. **The model's free generation** (prose only, inside 1-4).

The rule on the record: *if the AI disagrees with the deterministic source, the deterministic source wins
and the disagreement is surfaced, not silently resolved.*

## C. The seam pattern (generalize this to every future AI feature)

The built features all follow one shape, and every new AI capability must too:

1. **Deterministic core computes ground truth** (pure, no network): macro grounding (food-DB +
   Atwater bounds), memory insights (computed from logged history), restaurant orders (goal-aware builder).
2. **AI rewords prose only**, given that output: it may change wording and warmth, never a number,
   figure, or the structural decision.
3. **A strict guard validates before showing.** The numeric-token multiset must match exactly or the
   rephrase is rejected and the engine's text stands (`nutritionMemoryVoice.orderRephraseIsSafe`,
   `restaurantCoachVoice`). Founder ruling 2026-06-29: *the multiset of numeric tokens must match EXACTLY.*
4. **Fallback on any hiccup.** Timeout, refusal, or a rejected rephrase all degrade to the deterministic
   result. The loop never breaks: the meal always logs, the insight always shows.

## D. Honest naming (Founder Rule #8, the brand-trust rule)

A surface reads **"AI X"** only when a model is **actually configured AND actually did the work**; until
then the identical surface reads **"Coach X"** (`aiCoachTag`, `aiMemoryTag`, `aiRestaurantCoachTag`). The
label flips automatically the day the endpoint is set, with no code change, and (per this session's fix)
the memory/restaurant labels flip only when a rephrase genuinely lands, not merely because an endpoint
exists. This is the same discipline as the score's honest naming (`05` SD-5): never claim an authority we
are not delivering.

## E. The capability map (built / designed / not-yet)

**Built (live behind the AI flag, inert until configured):**
- **Meal-photo vision analysis** with server-side **macro grounding** (food-DB plausibility + Atwater) so
  a hallucinated macro never reaches the score. Falls back to the deterministic per-slot result.
- **Nutrition Facts label scan** (transcription, not estimation: the label is ground truth).
- **Nutrition Memory ("Remembered by AI")**: six deterministic insight kinds from logged history, warmed
  by AI prose under the number guard.
- **Restaurant Coach ("AI Restaurant Coach")**: deterministic goal-aware order builder, the `why` warmed
  by AI under the number guard.

**Designed, not built (`05-ai-systems` §4-§7):**
- **Coach Copilot:** a fixed tool catalog over the deterministic core (`whoNeedsAttention`, `whoMissed`,
  `predictFallingBehind` = a deterministic trend, **not** ML, `draftMessage`, `draftReport`). Drafts only,
  never auto-sends; sending is a separate human action.
- **AI Memory:** typed, append-with-supersede structured facts (allergy/dislike/favorite/budget/timing).
  Safety facts are hard constraints, never auto-superseded. **Embeddings deferred** (a missed allergy in a
  vector is a safety incident).
- **Performance Profile:** read-mostly, athlete-owned, portable record (the moat surface, see F).
- **AI Personality:** a tone token (encouraging / firm / educational / supportive ...) that changes only
  *tone*, never what the engine decided; clamped for minors (no shame, no body-image framing).

**Named, do-not-build-yet (`05-ai-systems` §12):** vector/semantic memory DB, a learned "who falls
behind" predictor, fine-tuned org/personality models, autonomous multi-agent send. Seams reserved;
implementations resisted until real outcome data exists (the Proof pillar).

## F. The moats: AI is on top of the moat, not the moat

Ranked (`00` §3, `05` §A). The AI is a multiplier on these, never the defensible asset itself:

1. **The portable, athlete-owned profile + score history** that compounds across every org (keystone
   **D1**). The only thing that gets stronger every day even if we ship nothing, because a competitor
   cannot own the athlete's past.
2. **The org graph** (one coach brings a roster; one athlete in six orgs is six switching costs), which
   rides on moat #1.
3. **The platform-owned formula** (keystone **D3**): the integrity that makes the score, and therefore
   the data, bankable. No per-coach formula, ever.

The behavioral-data flywheel (a future moat) only compounds at scale we do not have yet. Do not lead the
pitch with it.

## G. The "AI only if measurable value" rule (and the harvest)

The new founding prompt's AI philosophy ("never build AI because it is trendy; every AI feature must save
time, improve decisions, predict problems, or increase outcomes") **matches the canon** and is affirmed
here. Its named capabilities map cleanly onto existing designed work, with the guardrails attached:

- **"Intervention Engine"** = the Coach Copilot's surfacing of who needs attention + drafted outreach.
  Deterministic detection, AI-drafted language, human sends. Not autonomous.
- **"Organization Intelligence"** = the org/gym roll-up reading the one platform score (`GYM_STRATEGY` §F),
  not a new model or a second number.
- **"Behavior Prediction"** = today a **deterministic trend labeled as such**; a *learned* predictor stays
  in do-not-build-yet until the Proof pillar has real outcome data. Shipping a "prediction" we cannot back
  is the same credibility crack as an over-named score.

Every AI feature must pass: does it save time, improve a decision, or increase a measurable outcome? If
not, do not build it.

## H. Minors and the third-party model (the consent line)

Real meal photos leave to a third party (Anthropic) only behind the **fail-closed consent gate**: a
minor's photo never leaves the device until a guardian is verified, sharing is not paused, and consent is
recorded. The third-party processor is **already disclosed** in `consentSummary`. The API key lives only
as a server secret, never in the app bundle. Two go-live obligations carry into the legal chain: a
**subprocessor DPA + retention disclosure** with Anthropic, and counsel sign-off on minors' data
(`LAUNCH-CHECKLIST` Phase 0, keystone **D7** fail-closed governance).

---

**Deference footer.** Mechanics and exact tool catalogs: `docs/architecture/05-ai-systems.md` and the code
seams (`src/lib/ai/`, `supabase/functions/analyze-meal/`, `src/core/macroGrounding.ts`,
`src/core/*Voice.ts`). Moats and naming: `00` §3/§18-C, `05` RT-3/SD-5. Keystones: D1 (athlete owns data),
D3 (platform owns the formula), D7 (consent fail-closed). Where this doc and the canon touch, the canon
governs mechanics; this governs the board-readable synthesis.
