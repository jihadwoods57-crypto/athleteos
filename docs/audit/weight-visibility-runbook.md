# Weight Visibility (0103) — Founder Runbook

Item 3 of the three holds (2026-07-21). Per-field staff visibility, slice 1: **weight**,
deny-by-default. Allowed: **head coach, athletic trainer, S&C** (founder-confirmed;
nutritionist deliberately excluded — their protein/calorie lane is untouched), plus practice
trainers and the athlete themself. Guardians were already fail-closed out (0081).

## What enforces it (server truth, not UI politeness)
1. **`can_view_weight(athlete)`** — one predicate: self, OR the full existing wall (`can_view`:
   link + scope + minor-consent) AND (trainer OR one of the three allowed team-staff roles).
2. **Column-split SELECT grants** — `days.current_weight`, `checkins.weight`,
   `athlete_profiles.base_weight` + `targets` leave the `authenticated` SELECT grant entirely.
   Nobody (not even allowed roles) reads them by direct table select; a devtools query gets
   `42501`. Writes are untouched (the athlete's own pushDay upsert keeps working).
3. **RPC doors** — `weight_series()` (zero rows for the restricted) and `athlete_plan_meta()`
   (base_weight → null, targets minus its `weight` key; protein/calories always survive).
4. **Write guard** — `coach_set_goals()` preserves the stored target weight when a restricted
   role saves; their protein/calorie edits land normally.
5. **Client** — fail-**closed** `canViewWeight(role)` (unlike the create-menu's fail-open: a
   weight field that flashes during a slow role fetch is a leak, not a loading state). The
   Targets editor hides the weight row + suggestion card for restricted roles and sends no
   weight key at all; coach weight surfaces (activity "Weighed in" line, Score-tab weight)
   simply don't exist for them — absence, never a blank.

## Deploy order — LOAD-BEARING, unlike most migrations here
1. **Ship the client first** (this commit's proto.zip via the normal release/OTA train) and
   let it roll out. New clients are safe in BOTH orders (RPC-first with a pre-apply fallback
   select), but an OLD client's `select('*')` on `days` breaks once the grant splits —
   loadDay would degrade to cache-only on stale devices.
2. **Local stack**: apply all migrations incl. 0103, then `npm run test:rls` → must be GREEN
   (the suite gained a 20-check 0103 section: column denials, non-weight reads intact,
   zero-rows-for-restricted, nutritionist write-guard, allowed-role reads, self, stranger).
   This env has no psql — the suite has NOT been executed here, only authored.
3. **`supabase db push`** (0103 only; no edge functions changed in this slice).

## Column-list gotcha (cousin of the 0013 grants gotcha)
The 0103 SELECT grants enumerate columns. A future `alter table days|checkins|athlete_profiles
add column` is NOT covered until the new column is added to the matching grant in 0103's list
(and, for `days`, to `DAY_SELECT_COLS` in proto `day.js` + `DAY_COLS` in proto `roles.js`).

## What restricted roles still see (deliberate)
- The day row minus weight (score, meals, check-in state) — their job needs it.
- `team_day_rollup`'s `weight_logged` **boolean** (presence, not the value) — unchanged.
- Protein/calorie targets, both read and write.
- base_height / base_age / dob — unchanged; the founder's directive named weight. Extending
  per-field visibility to more fields is a follow-up decision, not a default.

## Evidence
- `qc/tier3-targets-restricted.png` / `qc/tier3-targets-headcoach.png` — the gated editor.
- `src/core/staffAccess.test.ts` — fail-closed capability cases.
- `supabase/tests/rls_authz_test.sql` §0103 — the server-wall checks (run with psql).
