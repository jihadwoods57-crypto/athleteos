# Founder Product Backlog

Judgment / security-migration items the crew found but will **not** ship on its own — they need a DB
migration (crew never touches live schema) or a product decision only the founder makes. The crew ranks
them; you decide. Seeded by cycle i1 (2026-07-09).

## Format
```
### #<rank> · <pillar> · <title>   (impact 1-5, effort s/m/l)
- Why: ...
- Fix: ...
- Evidence: file:line
```

## Backlog

### P1 · reliability/security (migration) · `base_age` is athlete-editable → minor bypasses parental consent + supervision   (impact 5, effort m)
- Why: a 15-yo who sets `base_age = 18` (a write RLS permits) flips BOTH the minor-messaging gate and the
  guardian-consent gate — unsupervised adult threads AND real health-data sync with no parental consent.
  COPPA-adjacent. Independently re-confirmed; already noted in `docs/audit/2026-07-02-PHASE-0-GO-LIVE.md`.
- Fix (needs a migration you apply to live): make age server-authoritative + immutable by the athlete —
  capture at signup into a `service_role`-only column (or `profiles` via `handle_new_user`) and forbid the
  athlete update path from changing `base_age` (a `WITH CHECK`, or move it off `athlete_profiles`). Both
  gates keep reading the same value; only the write becomes untrusted-client-proof.
- Evidence: `0001_schema.sql:126`, `0002_rls.sql:91`, `0006_messaging_minor_gate.sql:50-53`, `src/core/consent.ts:36-37`.

### P2 · reliability/security (migration) · `days.score` is client-set → fabricate a ≥80 with no photo → game trust-pass   (impact 3, effort m)
- Why: the 0041 evidence ceiling derives from client-authored JSON (a bare `meals` toggle counts as full
  nutrition), so a tampered client persists `score=100` with no photo; `grant_trust_pass` gates on
  `score >= 80`. Breaks "photo is the only path to ≥80."
- Fix (needs a migration): tighten 0041's nutrition-evidence clause to require real photo evidence (a
  `meals` row with `photo_path` / `slotMacros` / active trust pass), not a `days.meals` boolean; cap the
  ceiling below 80 when no photo evidence exists.
- Evidence: `0041_score_evidence_ceiling.sql:41-50,61-81`, `0033_trust_passes.sql:47`.

### P3 · reliability (verify) · confirm fix #2's baseGoal/scoringProfile consistency   (impact 2, effort s)
- The plan hydration sets targets + scoring profile; verify the goal-direction tone fully tracks it, or hydrate `baseGoal` too.

## Judgment items (scout findings, your call)
- **Trust-pass median counts non-photo 0-days** — `trailingEarnedNutritionMedian` takes the last 10
  `nutritionHistory` entries unfiltered, but rollover archives a 0 for every opened-but-unlogged day; so
  "median of last 10 **photo-earned** days" is really the last 10 **calendar** days. Firewall-safe (only
  ever lowers credit) but deviates from the literal spec. `trustPass.ts:19-29`, `dayRollover.ts:74-78`.
- **No realtime anywhere** — coach/trainer roster is fetch-on-open; a dashboard left open won't reflect a
  live log. Constitution mentions realtime board updates. Decide for v1. (grep `.channel(`/`.subscribe(` empty.)
- **Round-trip parity has no exhaustive test** — `mapStateToDayRow`/`dayRowToState` is hand-maintained
  field-by-field; `ciLast` was the 2nd field to slip (after the 2026-07-04 weight/ci fixes). Add a
  property-based round-trip test to fence the whole class.
- **`send-push` reports `ok: true` without checking the notification-insert error** — a failed feed write
  is reported as success. `supabase/functions/send-push/index.ts:73`.
- **quick-add + bare meal toggles vs "photo-only ≥80"** — `addMeal` sets `meals[key]=true` even with a
  null analysis; assert `addMeal` is unreachable without photo evidence. `useStore.ts:1071-1095`.

## Deferred by the 2026-07-10 fix-all run (sound reasons — not shipped)
- **Role hydration drops the granular role on a fresh device** — `hydrateProfile` can only restore the
  coarse DB enum (`profiles.primary_role`), so a nutritionist/trainer-subtype loses personalization on a
  new device. Real fix needs a **migration**: persist the granular Role server-side (new `profiles`
  column or metadata), then hydrate from it. `useStore.ts:1187-1189`, `constants.ts:107-114`.
- **`base_age` immutability (P1 above) + `days.score` photo-evidence (P2 above)** — security migrations
  I could not author safely because **`test:rls` can't run here** (needs `supabase start`/docker on
  54322). Author + test these in a local Supabase before applying. COPPA-adjacent — do not skip.
- **Meal-thumbnail N+1 signed URLs** — `MealCardItem`'s `MealThumb` signs one URL per card in a per-card
  effect. Fix: add `db.signedMealPhotoUrls(paths[])` (storage `createSignedUrls` plural), have
  `MealCardItem` accept an optional pre-resolved `photoUrl`, and prefetch a path→url map in the 3 list
  parents (`MealHistory` DaySection, `PersonDetail`, `MealReview`). 5 files, perf-only, un-unit-tested
  surfaces — do it deliberately, not at the tail of a session. `MealCardItem.tsx:16-30`, `queries.ts:101`.
