# Next-Sprint Priorities — Validation + Go-Live Prep (post 4-day sprint)

**Authored:** 2026-06-28 (end of the 4-day sprint). **Branch:** continue on a fresh
`crew/<next>` cut from `crew/4day-sprint` after it's reviewed. **Theme:** the 4-day queue is
drained and the app is feature-rich but **NOT launch-ready**. Per the board's standing call
(D-C: *validate over features*), this sprint adds **NO new feature areas**. It does the
**code half of go-live** + **hardens what shipped** so the founder can open a real closed beta.

## ⚑ Read first — the situation
The last session added two large new feature areas (the Nutrition Intelligence Engine and
the Accountability Engine), a UI/IA overhaul, a design-token pass, the Coach Plan editor, and
folded on-time logging into the Development Score. All green (836 tests) but **unvalidated by
real users**. The real blockers to launch are **human** (legal, VPC vendor, backend flip,
device, Apple) — the crew can only do the *code-side* prep below.

## WORK MODEL (every run)
- Work the RANKED QUEUE top-down, continuing from `NIGHTSHIFT-LOG.md`.
- Build to the SAFE LINE: pure `src/core` logic + flag-gated UI + integration seams.
  Anything needing the live backend, an external send, a paid API, real/minor data, or a
  device is OUT — build the seam, leave it inert, log what the founder must do in
  `docs/FOUNDER-DECISIONS.md`.
- Every commit keeps `npm run verify` green (typecheck + tests + iOS bundle); push after each.

## STANDING GUARDRAILS (unchanged)
NEVER enable `EXPO_PUBLIC_BACKEND_LIVE`; NEVER `supabase db push` to live; NEVER send to a
real person; `src/core` stays pure; no `src/app`; one job = one commit; never drop the test
count; no paid services; no merge to master.

---

## RANKED QUEUE

### P0 — Reconcile + flag-gate the new feature areas (the keystone decision)
The board must rule on whether the new engines ship in the closed beta or wait for the core
loop to be validated. Make BOTH paths possible: put the Nutrition Engine (Restaurant Coach)
and the Accountability surfaces behind a single config flag (e.g. `isEnginesEnabled`,
default OFF for a minimal "prove the loop" beta) so the founder/board can toggle without a
code change. Do NOT add more engine breadth. Log the decision to FOUNDER-DECISIONS.md.

### P1 — Go-live engineering, verified LOCALLY (makes "flip the flag" actually work)
All gated behind `isBackendLive`, runtime-verified against a throwaway LOCAL supabase stack,
NEVER the live project:
- Author the `delete_account`, `request_guardian_consent`, and `create_team`/`0005_grants`
  migrations (SQL only; apply locally to verify; the founder applies to live — D1).
- Finish the day-sync hooks (`pushDay`/hydrate in `src/store/sync.ts`) + `pushPerf`/`fetchPerf`
  for the performance table; round-trip them locally.
- Implement `deliverMessage` against a `messages` table **only after** the messaging safety
  policy is set (D7/D10) — otherwise leave inert.

### P2 — Activation instrumentation (so the beta produces signal, not anecdotes)
A small, gated analytics seam emitting the events the beta plan needs: onboarding complete,
team joined, meal saved, check-in submitted, recommendation used. Local buffer + a backend
sink seam; nothing fires externally until the founder wires a real sink. Pure event model + tests.

### P3 — Harden the big new surface (QA + regression, no new features)
Adversarial review of everything added last session: the two engines, the score change, the
UI/IA overhaul. Edge-case + regression tests (empty/garbage state, day rollover with the new
fields, the on-time score boundaries). Fix-with-a-test per finding. Tidy any rough edges.

### P4 — Remaining audit code items
- **Ground the meal macros** against a food DB (USDA FoodData Central) so the score reads
  trustworthy macros, not the model's guess (`analyze-meal` `groundMacros` is a no-op).
- Wire the local-notification reschedule call (gated, `expo-notifications`) — the model is built.
- Finish the small honesty items: real notification timestamps, the unread red-dot logic, a
  real check-in due-date.

### P5 — Dark-mode migration (only with device QA; else defer)
Execute `docs/DARK-MODE-TODO.md`: migrate components to `useColors()`, tokenize hardcoded
surfaces, dark shadows/charts/StatusBar, OS-driven scheme + toggle, on-device contrast QA.
Foundation is laid; this needs a real device — defer if none is available.

### P6 — App Store readiness (code side)
The 🔧 items in `docs/APP-STORE-READINESS.md`: full a11y sweep (VoiceOver labels, AA contrast,
Dynamic Type), perf (no leaked timers/animations), graceful error fallback on every network/AI
path, copy/legal review, screenshot prep.

---

## ❌ NOT in scope (resist)
New feature areas; more restaurants/foods beyond a verified import; remote push; the
college/org multi-tenant model; wearables. The brief is **validate the loop**, not widen it.

## NEEDS YOU (founder-gated — the crew cannot do these)
1. **Legal:** finalize + host the drafted Privacy Policy + Terms (`docs/legal/`), COPPA/FERPA sign-off.
2. **VPC vendor** + the email sender, then flip `EXPO_PUBLIC_BACKEND_LIVE` for the HS-coach cohort.
3. **Apply the migrations** to the live project (per-migration, D1).
4. **Recruit 3–5 coaches** and run the beta (`docs/BETA-TEST-PLAN.md`) — the actual unlock.
5. **Device testing** (camera, notifications, VoiceOver) + **Apple submission** (bundle id,
   screenshots, age rating).
6. **Ratify** the engine decision (P0) and the queued D1–D10 founder decisions.

> Honest north star: the next real progress is **real athletes using the loop**, not more code.
> The crew's job this sprint is to make go-live a flag-flip and to not let the new breadth rot
> before it's validated. Business + Market readiness move only with a paying cohort.
