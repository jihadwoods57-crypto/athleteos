# Nutrition plan styles — go-live

**Branch:** `feat/founder-command-center` · **Plan:** [`~/.claude/plans/add-three-nutrition-plan-peppy-crane.md`](../../..)

A spectrum of nutrition structure — **Structured / Guided / Intuitive** — instead of one fixed
scoring philosophy. Style is orthogonal to the existing goal-derived profile (athlete/general/
gain): goal sets direction, style sets how tightly it's measured.

## What ships when

| Slice | Contents | Status |
|---|---|---|
| **1 — Foundation** | `plan-style.js` + `src/core/planStyle.ts` (presets, caps, resolution, adherence curves) | Shipped, tested |
| **2 — Data model** | migration `0142`: `profiles`/`days` columns, `validate_plan_style_overrides`, extended `validate_requirement_items`, `plan_style_events`, `athlete_governing_plan_style`, `set_my_plan_style`, `set_athlete_plan_style`, `coach_set_goals` extension | Shipped, RLS-verified, **not applied to prod** |
| **3 — Engine** | `day.js` style branch, per-day stamp, `weightsForDay` | Shipped — gated on `scoreParity`/`scoreIntegrity` passing **unmodified** |
| **4 — Signals** | check-in `digestion`/`cravings` fields, post-meal 2-tap prompt, `days.signals` | Shipped |
| **5 — Athlete surfaces** | Plan style card, meal-numbers gate, Progress style bands, Settings picker, Intuitive AI-copy variant | Shipped |
| **6 — Pro surfaces** | roster style pill, per-athlete assignment + override editor, preference signal | Shipped |
| **7 — Onboarding** | the structure question across all six OB2 role flows | Shipped |
| **8 — AI prompts** | `_shared/plan-style.ts` + `_shared/plan-style-load.ts`, wired into `analyze-meal`, `meal-chat` (both prompts), `deep-analysis`, `monthly-report`; Intuitive language rail + correct-and-retry ladder | Shipped, 58 unit tests |
| **9 — Release mechanics** | grandfather resolution, one-time in-app prompt | Shipped |

**`weekly-digest` is deliberately NOT in that list.** It has no AI call at all — it is a
deterministic, COACH-facing roster digest computed from `days` rows. There is no prompt to make
style-aware, and figures are correct for a coach regardless of any athlete's style. The original
plan said "five edge functions"; the real number is four.

`meal-chat` needed BOTH its prompts styled, not just the athlete-facing one: `DRAFT_SYSTEM` drafts
replies a coach then SENDS to the athlete, so an unstyled draft would let a coach unknowingly hand
macro figures to someone who is deliberately not tracking them. In that function the style resolves
for the **meal owner**, never the caller.

## The two invariants that constrain everything here

1. **No style weight may exceed migration `0041`'s per-component cap** (nutrition .55 / recovery
   .25 / commitment .15 / checkin .10). `src/core/planStyleCaps.test.ts` sweeps every preset ×
   override permutation to enforce it. Because the four weights must also sum to 1, this pins
   nutrition into `[0.50, 0.55]` — the `athlete` goal profile already sits at the 0.50 floor with
   recovery at its cap, so it has **zero** headroom; style differentiation lives entirely in what
   the nutrition sub-score *measures* (`NUTRITION_PARTS`), not in the headline mix.
2. **Default Structured is today's exact per-goal-profile formula, byte for byte**
   (`nutrition.formula: 'legacy'`), not the `NUTRITION_PARTS` composition. That identity —
   `STYLE_WEIGHTS.structured === PROFILE_WEIGHTS` — is what grandfathers every existing account:
   nobody's score moves on release day. A professional who customizes Structured (e.g. turning on
   `hydrationScored`) opts into the composition path explicitly. `src/core/scoreParity.test.ts`
   and `scoreIntegrity.test.ts` are the gate — both must pass **unmodified** by this feature.

## Apply

```bash
supabase db push          # 0142
npm run test:rls          # expect 419/419 (was 382/382 before this feature)
npx jest                  # expect 2549 (was 2407)
```

0142 is forward-only and idempotent. **No backfill runs against existing rows** — that's
deliberate, not an oversight. Grandfathering is a *resolution-time* rule
(`resolvePlanStyle({ hasHistory })` in `plan-style.js`/`planStyle.ts`), not a written value:
an athlete with real scored history and no explicit choice resolves to Structured on the
`legacy` formula every time their day computes, forever, without a migration ever touching
their row. Writing `structured` into `profiles.plan_style` for every existing athlete would have
been a **weaker** guarantee — it would look like a deliberate choice they never made, and a
later bug in the write could silently move scores a migration-only approach can't.

New signups default to **Guided** (`DEFAULT_STYLE` in `plan-style.js`).

## Grants gotcha this feature ran into

`days` grants **column-level** SELECT to `authenticated`, not table-level (INSERT/UPDATE/DELETE
are table-level, so writes to a new column succeed silently while reads 42501 until granted
explicitly). Migration 0142 includes `grant select (plan_style, signals) on days to
authenticated` for exactly this reason — the column-level sibling of the table-grants gotcha
documented for `0013`/`0098`.

## Who controls the setting, by role

| Role | Controls |
|---|---|
| Independent adult | Their own style, freely |
| Trainer client | Proposes (applies provisionally); the trainer's assignment wins once set |
| Team athlete | Preference only — the assigned coach/trainer/nutrition pro's setting always governs, enforced both client-side (`resolvePlanStyle` precedence: team > pro > self) and server-side (`set_my_plan_style` silently no-ops the style argument when `athlete_governing_plan_style`/`athlete_assigned_plan_style` resolves) |
| Coach / Trainer / Nutrition pro | Assigns + fully customizes per athlete (`set_athlete_plan_style`) |

A locked athlete's stated preference is **always** captured and **always** surfaced to whoever
governs them (`profiles.plan_style_preference`, read by any `connected()` party) — never a dead
end, never silently discarded.

## Verification run for this feature

- `npx jest` — 2549 passed (baseline 2407)
- `npm run typecheck` / `npm run lint:xss` / `npm run test:proto` — clean, 41/41
- `supabase/tests/rls_authz_test.sql` — 419/419 (baseline 382; +37 plan-style checks)
- Headless 3-style browser sweep (Playwright MCP) across Home/Plan/meal/check-in/Progress/
  Settings/roster/per-athlete editor, both grandfathered and fresh-signup paths — confirms **no
  calorie or macro figure reaches the athlete on Intuitive anywhere in the client**, and that a
  team-governed athlete's picker is replaced by an honest pointer to the standard rather than a
  silently-ignored control.

## The inverted fallback (read before touching any style retry code)

Coach voice's banned-word recovery re-runs the call WITHOUT its directive, because the base prompt
is the safe one and the voice introduced the risk. **Plan style is the exact opposite**: for
Intuitive, the DIRECTIVE is what makes the output safe — the base prompt is a macro-quoting
nutrition prompt. Re-running without it would produce a worse violation, confidently. So the
ladder in every style-aware surface is:

1. base + style directive
2. on violation → base + style directive + a correction naming the exact hit (the model's own bad
   output is replayed back to it, which corrects far more reliably than re-asking cold)
3. still violating → deterministic, style-safe copy. **Never a bare base-prompt re-run.**

Consequence in `analyze-meal`: the coach-voice fallback re-runs on `styledBase` (voice dropped,
style KEPT), so fixing a tone slip can never also drop the style rail.

## The language rail's false-positive discipline

The guard bans food *moralizing* as PHRASES ("good food", "cheat meal", "burn it off"), not bare
words. "good" and "bad" are far too common in ordinary encouraging prose to ban outright — doing so
would fire on nearly every response, and each false positive costs a paid retry and can end in
canned copy, losing real feedback to catch a phrase that was never harmful. Deliberately excluded
for that reason: bare "on track"/"off track", "be good"/"been good", and bare "shame" ("no shame in
a late log" is a supportive line). Macro figures are matched unit-anchored, so "1 cup of rice",
"6 oz", "3 meals", "8 hours" and "100 oz of water" all pass while "45g", "2,400 calories" and
"thirty grams of protein" do not.

## The client stamp

`analyze-meal` returns `styleApplied` alongside the result, and it is persisted with the meal. The
client shows server prose only when its OWN resolved style permits numbers, or the stamp matches
its current style exactly. An old deploy (no stamp) or a stamp from a style the athlete has since
left both fall back to suppression — so a stale edge function can never leak, and a stale stamp is
never treated as evidence about today's prose.

## Left for a future session

- Notification tone per style (`notify-plan.js` is still not style-aware).
- A founder pass on the Intuitive phrase list in `_shared/plan-style.ts` — it is deliberately
  conservative, and the honest way to tune it is against real generations, not in the abstract.
- `assist` and `coach-voice-nudge` are not style-aware. Both are short coach-voiced narration over
  data the app computed; neither currently quotes macros, but neither is *prevented* from doing so.
