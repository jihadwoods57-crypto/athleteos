# Meal Plans — Go-Live Status

## ✅ Done (live)

- **Wave 1 + Wave 2 code** merged/open (PR #15 merged, PR #16 open) — behind `isMealPlansEnabled`.
- **Migration applied to live AthleteOS** (`ftwrvylzoyznhbzhgism`): the meal-plans migration
  landed as `0032_meal_plans.sql` (the crew renumbered it from 0029; content is identical) and
  `supabase migration list --linked` now shows `0032 | 0032 | 0032`. The `meal_plans`,
  `plan_assignments`, and `meal_templates` tables + RLS are live. Confirmed by regenerating types
  from the live schema (the new tables are present).
- **Edge functions deployed** to live: `plan-generate` (new, smoke-tested) and `analyze-meal`
  (updated with `slotTarget`/`substitution`, backward compatible).
- **Client flag flipped in the build config**: `eas.json` now sets
  `EXPO_PUBLIC_MEAL_PLANS_ENABLED: "true"` in the `preview` and `production` profiles (alongside
  the existing `EXPO_PUBLIC_BACKEND_LIVE: "true"`). The next EAS build ships the feature on.
  (ENGINES left OFF — the meal-plans feature works standalone; flip `EXPO_PUBLIC_ENGINES_ENABLED`
  too only if you also want the Restaurant Coach / adherence surfaces.)

## ⛔ Remaining (needs your Expo credentials — can't run headless here)

- **Trigger the build.** No Expo session is available in this environment (`eas login` is
  interactive), so the actual build must be run by you / CI:
  ```bash
  npm i -g eas-cli
  eas login                       # or set EXPO_TOKEN in CI
  eas build --profile preview --platform android   # internal build for testers, no store submit
  # or: eas build --profile production --platform all   (then eas submit for the stores)
  ```
  The flag + backend are already in place, so the build just needs to run.

## Optional follow-up

- Regenerate `src/lib/supabase/database.types.ts` from the live schema and drop the `(supabase as any)`
  casts in `src/lib/mealPlans.ts` (the tables now exist; the casts are only there because the
  generated types predated the migration). Left as a follow-up to avoid churning the crew's types file.

## Rollback

- Client: remove `EXPO_PUBLIC_MEAL_PLANS_ENABLED` from `eas.json` and rebuild — every surface goes inert.
- Functions: redeploy the prior version (they're inert while the client flag is off).
- Migration: additive tables; nothing depends on them until the feature is used.
