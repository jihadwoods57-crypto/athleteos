# Plan Page → Nutrition Intelligence Hub (Food Memory) — Design

**Date:** 2026-08-06 · **Status:** Phase 1 (this build) + documented follow-ups
**Founder brief:** turn Plan into a living system that answers "What am I supposed to hit?" and
"What does OnStandard already know about how I eat?" — with a Food Memory that learns
automatically from normal logging, one-tap re-log, memory-first AI reads, an explicit
accuracy hierarchy, and a never-hallucinate rule for wrapped/closed food.

## The loop

Eat → Log → Learn → Remember → Recommend → Repeat. After ~30 days of normal use, an
athlete's usual meals, places, and orders are known, and common meals log in seconds.

## Decomposition (Phase 1 vs later)

**Phase 1 (this build):**
1. `food_memory_items` + `food_memory_places` tables (0192), athlete-owned, coach-readable,
   coach verify via RPC.
2. Plan page rebuilt: compact set-only targets strip · **What Should I Eat** (remaining
   kcal/protein + saved options ranked by fit, pure client math, no AI cost) · **Food
   Memory** usuals with one-tap re-log · **Places I Eat** · passive "You've eaten this 3×
   — save it?" suggestions computed from the existing 14-day recent-meals cache ·
   **Memory tab** ("What OnStandard Knows": saved items, places, learned facts — edit /
   remove / forget) · **Coach Rules** on the Nutrition tab from real data only (the
   hardcoded demo "Build Your Plate"/"Approved Swaps" constants are removed — they were
   the last fabricated content on the screen).
3. One-tap re-log: tap a saved meal → the SAME `#meal-analysis` confirm gate every other
   path uses (WS7 rule: review before it counts) → Log. No photo, no AI call, macros from
   the saved item, `source:'memory'`.
4. Memory-first AI: the analyze request carries a bounded, sanitized `foodMemory` context
   (≤10 items). New system rules: saved-meal match beats visual estimate; **wrapped/closed/
   opaque packaging must never get invented contents** — ask "Is this your usual X?" when
   asking is available, otherwise report the generic wrapped item at low confidence.
5. Coach verify: coach sees the athlete's saved items on `#coach-athlete/<id>` and can mark
   one **Coach Verified** (`coach_verify_memory_item` definer RPC — no coach UPDATE policy,
   column-safe). Verified items rank first in recommendations and carry a subtle badge.

**Deferred (documented, not built):** auto-bump on photo-matched saved meals; quick-answer
chips + receipt/menu entry options in the clarify UI; coach macro-editing of saved items;
barcode deep-link from the usual-order question; restaurant official-menu database.

## Data model (migration 0192)

`food_memory_places`: id, athlete_id, name, kind('restaurant'|'campus'|'team'|'home'|'store'|'other'),
times_eaten, last_eaten_at, status('active'|'archived'), created_at.

`food_memory_items`: id, athlete_id, place_id (null → not place-bound), name,
kind('meal'|'order'|'food'|'supplement'), items jsonb (component list, mirrors detectedRich),
protein/kcal/carbs/fat/fiber ints, basis('label'|'database'|'confirmed'|'estimate'),
source('auto'|'manual'|'athlete_saved'), times_logged, last_logged_at, verified_by,
verified_at, status('active'|'archived'), created_at.

RLS mirrors 0019: athlete full control (`athlete_id = auth.uid()` for ALL commands); coach
SELECT via `can_view(athlete_id)`. Explicit grants (0013 revoked defaults). "Forget" =
`status:'archived'`, never a hard delete (times_logged history stays honest).

## Accuracy hierarchy (single source of truth for trust)

1. `label` — printed label claims / official product data (existing).
2. `database` — resolved exact product from `food_cache source='product'` (existing).
3. `confirmed` — a saved meal the athlete has logged repeatedly / confirmed (new tier).
4. user-entered (manual/label typed) — existing `source` semantics.
5. `estimate` — photo-only visual estimate (existing).

Coach-verified saved items are `confirmed`-tier data with the verified flag as an extra
signal. A `source:'memory'` log shows "From your saved meals" instead of the `~` estimate
marker — uncertain nutrition is never presented as certain, and vice versa.

## New/changed files

- `supabase/migrations/0192_food_memory.sql` — tables, RLS, grants, verify RPC.
- `proto/.../js/food-memory.js` — pure logic (import-free, node-tested): name normalization,
  meal signatures, repeat detection (≥3 in 14 days), saved-item matching, remaining-day
  math, fit ranking, bounded AI context builder. + `food-memory.test.mjs`.
- `proto/.../js/food-memory-data.js` — recent-meals-style cache (60s TTL, roles passed in).
- `proto/.../js/roles.js` — fetch/save/update/archive/bump item + place helpers; verify RPC.
- `proto/.../js/state.js` — `act.stageSavedMeal`, `act.saveMemorySuggestion`,
  `act.forgetMemoryItem`; `_analysisBody` gains `foodMemory`; `logMeal` bumps a re-logged
  item (fire-and-forget).
- `proto/.../js/screens/plan.js` — the hub (tabs: Overview · Nutrition · Schedule · Memory;
  'notes' route aliases to Memory, which keeps the Ask-AI composer).
- `proto/.../js/screens/memory-edit.js` — one small sheet for manual add/edit (name, place,
  kind, macros). Memory is otherwise built passively; this exists so manual control is
  possible, not required.
- `proto/.../js/screens/coach.js` — Food Memory section on the athlete detail screen with
  Verify.
- `supabase/functions/analyze-meal/index.ts` — `foodMemory` request field (sanitized,
  bounded), memory block in userContent, wrapped-food + saved-meal-first system rules.

## Error handling / honesty rules

- Memory fetch failure → Plan renders targets + existing sections; memory sections show
  nothing (no fake empty-state that implies data was checked when it wasn't loaded).
- All memory writes are best-effort fire-and-forget; they can never block or break logging.
- Suggestions are dismissible and dismissed signatures persist in RT (never re-nag).
- What Should I Eat shows numbers only when a calorie/protein target is actually set.
- The athlete never sees confidence percentages — only the saved/verified/estimate framing.

## Testing

`food-memory.test.mjs` covers signatures, repeat detection incl. dismissals, fit ranking
(edge: no targets, overshoot filter), context sanitization (markup stripping, caps).
`npm run verify` (xss lint, copy lint, tsc, node tests, bundle) must pass. RLS pattern
follows 0019 verbatim (can_view), reviewed against the 0013 grant law.
