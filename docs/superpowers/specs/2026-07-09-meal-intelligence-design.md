# AI Meal Logging — Conversation + Meal Intelligence — Design

**Date:** 2026-07-09
**Status:** Approved in brainstorm (all sections), pending founder spec review
**Surface:** `proto/redesign-2026-07/` (live WebView app) + one new edge function + authored-only migration touch-ups
**Sub-project 3 of the 2026-07-09 product feedback dump.** Predecessors merged: onboarding overhaul (`91eb861`), execution loop (`542fdca` — the exec engine powers the Execution Summary). Remaining: Plan page.

## 1. Goals

Make every logged meal feel acknowledged, educational, collaborative, and motivating — a conversation with the user's support team, not a nutrition report:

1. Post-log lands on ONE page, in this order: **Execution Summary → Meal Breakdown → Team Discussion → Next Action** — answering, in order: did I complete the requirement, what did I eat, what does my team think, what's next.
2. **Execution quality is separated from nutrition quality**: honest logging always reads as a win; nutrition coaching educates, never punishes.
3. Every meal is a **persistent conversation thread**: the AI Nutritionist responds to every meal immediately, answers follow-up questions grounded in the user's plan/history/day, and the coach participates lightly (comments + emoji reactions) without obligation.
4. Richer, honest structured data: per-food AI confidence, fiber, up to 3 micronutrient highlights — uncertainty always explicit, never fabricated precision.

## 2. Decisions (locked with founder, 2026-07-09)

| Question | Decision |
|---|---|
| Cycle scope | **Core team-thread v1**: four-section page, free AI opening message, grounded in-thread follow-up Q&A, coach comments + emoji reactions, persistent threads. **Deferred**: voice notes; parent/trainer thread participants; long-term pattern learning (recent-history context only); push notifications for replies. |
| Page shape | **One unified meal thread page** — logging lands on it (with the celebration/count-up built into the Execution Summary); revisiting opens the same page settled into its logged state. `meal-confirm` + `meal-detail` merge. |
| Data depth | **Confidence + fiber + highlights**: per-detected-food confidence (high/medium/low), fiber grams, ≤3 micronutrient highlights when clearly present. No full micronutrient panel (fabricated precision). |
| AI architecture | **New `meal-chat` edge function, client-grounded**, under the codebase's authority boundary: the AI discusses, never fetches, never computes or changes a number; all context is client-composed, user-visible data. Opening message costs nothing (assembled from the analysis already returned). |

## 3. The unified meal thread page

Route `#meal-thread/<slot>` (registered in `screens/index.js`; legacy routes `meal-confirm` and `meal-detail/<slot>` render the same module for compatibility). `logMeal`'s post-log navigation targets it.

**Section 1 — Execution Summary** (top): big check + "⟨Meal⟩ Logged", score count-up `from → to` (from `RT.lastMove`, animation preserved from today's confirm screen; static on revisit), timing line ("Captured on time · Added to today's score" / "Logged late · still counts" — derived from `DAY.mealLoggedAt` vs `DEADLINE`), requirement impact ("Counted toward Nutrition · 50%"), today's progress from `S.exec` (met/total segments), streak line, tier-up chip when promoted. **Binding tone rule:** this section celebrates the act of logging regardless of meal quality; no red, no shame, ever.

**Section 2 — Meal Breakdown** (§4).

**Section 3 — Team Discussion** (§5).

**Section 4 — Next Action**: the exec engine's NOW (or celebration line when the day is complete): icon, label, countdown, updated `score → possible`, one CTA routed via the item's route. Reuses ExecState — no new derivation.

Not-logged slots keep the current honest empty state (camera CTA). The pre-log flow (camera → analyzing → analysis) is unchanged except the analysis screen gains the confidence display + confirm/remove affordance from §4.

## 4. Meal Breakdown — richer, honest data

**Schema extension** (`analyze-meal`'s `report_meal_analysis` tool):
- `detected`: array of `{ name: string, confidence: 'high'|'medium'|'low' }` (was `string[]`). Client parsing is backward-compatible: a legacy string item is treated as `{ name, confidence: 'high' }`.
- `fiber`: integer grams (clamp ≤ 60).
- `highlights`: 0–3 short strings, only when clearly visible in the meal (e.g. "Strong iron source — supports oxygen delivery"); each sanitized (`<>` stripped) and length-capped (≤120 chars).
- Grounding: `groundResult` in `state.js` extends for the three fields; the canonical rules mirror into `src/core/macroGrounding.ts` with parity tests (existing pattern).

**Rendering** (breakdown section): photo hero + meal quality chip; detected chips with a subtle confidence tick — low-confidence chips carry a "?" marker and, **pre-log only**, a tap-to-confirm-or-remove affordance (the existing edit mode, extended). **Post-log, foods and macros are immutable** (score-integrity guardrail — the evidence trail never changes after it counts). Macros + fiber vs coach targets (real `S.planTargets` when set; honest "—" when not); Guardian allergen/restriction line (existing); goal-alignment verdict; coach-requirement satisfaction line when coach targets exist ("Coach wants 40g protein at breakfast — this hits 44g"). Every estimated figure is labeled estimated; uncertainty is explicit.

## 5. Team Discussion — the conversation thread

Backed by the existing `meal_comments` table + thread renderer (which already renders an `ai` role with the OnStandard AI identity).

- **AI opening message (no extra AI call):** at log time the client assembles the AI Nutritionist's first message from the analysis result — the coaching `note`, a why-it-matters line for the user's goal, and one practical improvement when `quality < 75` (skipped for high-quality meals — praise instead). Built by a pure, unit-tested `openingMessage(result, goal, exec)` helper; persisted via `postMealComment(..., 'ai', text)` right after `insertMeal` resolves the meal id. Every meal gets an immediate personalized response even if the coach never reviews it.
- **Follow-up Q&A:** the composer ("Ask about this meal…") posts the athlete's message to the thread, then invokes `meal-chat` (§6) with client-composed context: this meal (foods + confidence, macros, fiber, quality, timing), plan targets + goal + allergies, today's exec summary (met/total, score, next), the last 7 days of meals (name/macros/quality from the `meals` table, best-effort fetch), and the thread messages so far (≤20, truncated oldest-first). The prose reply persists as role `ai`. Answers are contextual to *their* plan — never generic nutrition advice.
- **Coach layer (lightweight):** coach text comments render as today. **Emoji reactions** (🔥 💪 👏 👍) are `meal_comments` rows with `kind:'reaction'` and the emoji as `text`; the thread renders all reactions as one compact strip (grouped with counts), not bubbles. The coach meal-review screen gains a one-tap reaction bar + sees AI messages labeled in the thread (the coach always knows what the athlete was told). The AI defers to explicit coach guidance when present and coaches independently when not.
- **Degradation:** no mealId yet (offline/unsynced) → the AI opening renders locally with "syncs when connected", composer disabled with that copy; `meal-chat` failure → athlete's message stays, quiet retry line "Couldn't reach your AI coach — try again"; thread fetch failure → breakdown stands alone. Nothing ever blocks logging.
- **Migrations (authored only, founder applies at go-live):** audit `meal_comments.role` — extend the constraint to include `'ai'` if it doesn't already; add `kind text default 'message'` for reactions. RLS additions follow the existing meal_comments policies (coach/athlete of the meal).

## 6. `meal-chat` edge function

New Deno function, modeled on the established guard stack:

- **Contract:** POST `{ context: { meal, plan, exec, recentMeals, thread }, question }` → `{ reply: string }` (or `{ error }`). Forced single tool `reply` returning prose only, ≤ ~150 words, coach voice, no em dashes; the prompt forbids inventing or altering numbers — it may only reference figures present in the provided context.
- **Authority boundary (binding):** the function never reads the database and never computes nutrition/score numbers. All context arrives from the client and is already user-visible data.
- **Guards:** per-athlete daily chat cap via `claim_ai_usage` (separate key from analysis, default 20/day), global cap via `claim_ai_usage_key`, per-IP/min rate limit, CORS allowlist, prompt caching, 8KB context cap (client truncates first), model `claude-sonnet-5` (env-overridable). Fail behavior: structured error the client renders as the quiet retry line — logging and the thread never break.

## 7. Adaptivity & tone

- Copy adapts by goal/profile (athlete gain/lose/maintain/perform; client general profile) using the same goal labels the app already carries — recovery/performance framing for athletes, energy/habit framing for general clients. Never assumes macro-tracking or competition.
- The AI voice: specific, encouraging, coach-like; consistency praised before choices critiqued; weight/food shame never (mirrors the notification copy rules).

## 8. Out of scope (explicit)

Voice notes; parent/trainer/practitioner thread participation; long-term memory & pattern learning beyond the 7-day context window; post-log food/macro editing; push notifications for coach/AI replies; coach-side redesign beyond the reaction bar + AI-message visibility; scoring/day-engine changes of any kind.

## 9. Testing

- **Pure units:** `openingMessage()` builder (quality branches, goal adaptation, coach-guidance deference); confidence parsing incl. legacy string arrays; fiber/highlights grounding clamps with `macroGrounding` parity.
- **Edge function:** contract shape, prose-only tool, cap/ratelimit guards (static review + existing patterns; deployed at go-live with the others).
- **Regression:** exec engine, scoring parity, and all existing suites stay green.
- **Flow QA:** log → land on the thread page with all four sections; count-up plays once; late meal shows the still-counts line with no red; low-confidence chip editable pre-log, immutable post-log; ask a follow-up (offline shows the retry line gracefully); coach reaction renders as a strip; revisit shows the same thread settled.
