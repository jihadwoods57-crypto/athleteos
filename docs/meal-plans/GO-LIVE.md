# Meal Plans — Go-Live Checklist

Wave 1 is merged (PR #15 → `claude/crew-update-wvkvhh`). Everything below the line is
**already done**; the two boxes at the top are the only steps that need a human with
Supabase DB access + an app build pipeline.

## ⛔ Remaining (needs your creds)

- [ ] **Apply migration `0029_meal_plans.sql` to live AthleteOS** (`ftwrvylzoyznhbzhgism`).
      Additive only (3 new tables + RLS; no alters), so it is safe and dormant until the
      client flag flips. From a repo checkout linked to the project:
      ```bash
      supabase link --project-ref ftwrvylzoyznhbzhgism   # prompts for the DB password
      supabase db push                                    # applies 0029 (0001–0028 already live)
      ```
- [ ] **Flip the client flags + rebuild the app.** The flags are `EXPO_PUBLIC_*` baked in
      at build time, so users only get the feature after an EAS/web rebuild with:
      ```
      EXPO_PUBLIC_MEAL_PLANS_ENABLED=true
      EXPO_PUBLIC_ENGINES_ENABLED=true   # only if you also want Restaurant Coach + adherence surfaces
      ```
      The Meal Plans core now works behind `MEAL_PLANS` alone (fixed in c4e8d2a); `ENGINES`
      is only needed for the other engine surfaces.

## ✅ Done

- Wave 1 code merged (PR #15).
- `plan-generate` edge function **deployed** to live and smoke-tested (returns a real
  multi-slot plan with options + restaurant alternatives).
- `analyze-meal` **redeployed** with the optional `slotTarget`/`substitution` fields
  (backward compatible — existing clients send no `slotTarget`, behaviour unchanged).
- Feature verified end-to-end in the running app (coach Generate + athlete Prescribed
  Meals), including the deterministic offline fallback and the flag gating.

## Rollback

- Client: set the flags back to `false` and rebuild — every surface goes inert.
- Functions: redeploy the prior version from git if ever needed (they are inert while the
  client flag is off, since nothing calls them).
- Migration: additive tables; drop them only if you truly need to (no data depends on them
  until the feature is used).
