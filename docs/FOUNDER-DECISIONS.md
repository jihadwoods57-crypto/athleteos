# Founder Decisions — queued judgment calls (4-day sprint)

The crew logs here instead of guessing on anything that needs a product call or that
changes a documented assumption. Each entry: what, why it's ambiguous / needs you, and
the options. Newest first.

---

## D1 — Two new go-live migrations (0004, 0005) must be applied to the live project

**What.** Stage A recorded migrations `0001`-`0003` as the applied set on the live
project (`ftwrvylzoyznhbzhgism`). The P0 backend wiring needs **two more**, both
authored this sprint and applied only to a throwaway LOCAL stack to verify the
round-trip — never to the live project (guardrail):

- **`0004_create_team.sql`** — a `create_team(name, sport)` RPC. Stage B says "the coach
  creates a team + a real invite code," but there was no such RPC and `team_staff` RLS
  blocks a coach from self-inserting the first staff row (chicken-and-egg). The RPC does
  it atomically (SECURITY DEFINER) and returns a real, unique 6-char join code that
  replaces the static `EAGLES24`.
- **`0005_grants.sql`** — explicit table/sequence/function GRANTs to
  `anon`/`authenticated`/`service_role`. The local round-trip failed with
  `permission denied for table days` (42501) until these were added: RLS decides which
  *rows* a role may touch, but a role must also hold table-level privileges first. A
  hosted Supabase project is usually saved by the platform's default-privileges, so the
  live project *may* already work without 0005 — but applying it is harmless and idempotent
  and makes the schema portable to any fresh/self-hosted apply.

**Why it needs you.** Applying migrations to the live project is a guardrailed action the
crew will not take. Also a judgment call: do you want `create_team` exactly as written
(no org row, head_coach only, server-generated code), or tied into an `orgs` row and the
college/HS staff model?

**Options.**
1. Apply both `0004` + `0005` as-is at go-live (`supabase db push`), then verify a coach
   can create a team and an athlete can join by the returned code. (Recommended — the
   round-trip is proven locally.)
2. Apply `0004` only if you confirm the live project already has the anon/authenticated
   grants from the platform; still safe to apply `0005` too.
3. Revise `create_team` first (org linkage, staff roles, code format/length) — tell the
   crew the shape and it will re-author.

**Status:** built + runtime-verified locally; NOT applied to the live project. Awaiting you.

---

## D2 — Email-confirmation policy for the live auth flow

**What.** The local round-trip ran with `enable_confirmations = false` (sign-up returns a
session immediately). The auth wrappers already handle confirmations-on gracefully
("check your email"), but the beta UX differs a lot between the two.

**Why it needs you.** It's a product + deliverability decision (and minors: a confirmation
email may go to a guardian).

**Options.** (1) Confirmations OFF for the closed beta (fastest onboarding).
(2) Confirmations ON (standard, needs a working email sender configured in Supabase).

**Status:** seam handles both; default not chosen. Awaiting you.

---

## D3 — Performance track (P1): should PRs ever fold into the daily score?

**What.** The new Performance feature (lifts/sprints/jumps/body weight/custom PRs,
`src/core/performance.ts`) is shipped as a SEPARATE development track — it does NOT touch
the daily Accountability Score. The P1 spec asked to keep it out "unless a clean opt-in
weighting is obvious." It is not obvious: PRs are episodic (logged every few weeks), while
the daily score measures today's adherence — mixing a stale PR into a daily number would
distort it, and there is no clean per-day signal from a sparse PR log.

**Why it needs you.** Whether "getting stronger/faster" should influence the headline
Accountability Score is a product-philosophy call (accountability vs. outcomes).

**Options.**
1. Keep them fully separate (current). Performance answers "am I improving?"; the score
   answers "did I stay on plan?". (Recommended.)
2. Add an optional, athlete-visible "recent PR" bonus/streak that nudges the score when a
   new PR lands in the last N days — tell the crew the rule and it will build it as pure
   logic + tests.

**Status:** shipped separate; no score coupling. Awaiting you if you want option 2.

---

## D4 — Performance PR date entry + backend sync (P1 seams)

**What.** Two device/backend parts of the Performance feature were built only to the safe
line:
- **Date entry.** The "log a result" form takes the date as a `YYYY-MM-DD` text field
  (defaulting to today), validated by a format check. A native date picker
  (`@react-native-community/datetimepicker` or Expo equivalent) is a device concern and
  was not added.
- **Backend sync.** PR entries persist locally (`perfEntries`, AsyncStorage) and survive
  day rollover. They do NOT yet sync to Supabase: the `days` table holds the daily slice,
  not a PR history, so syncing performance needs its own table + a `pushPerf`/`fetchPerf`
  seam (mirroring the Stage C day-sync). The coach PersonDetail performance line
  (`topPerformanceLine`) is built and renders when a caller supplies real PR data, but the
  live roster does not carry per-athlete PRs yet — so it is intentionally absent on the
  demo roster rather than fabricated.

**Why it needs you.** A new `performance_entries` table + RLS is a schema/migration
decision (guardrailed), and the date picker is a device/dependency choice.

**Options.**
1. Add a native date picker dependency (tell the crew; it will wire it behind the existing
   UI) — or keep the text field for the beta.
2. At go-live, author a `performance_entries` table (athlete_id, metric_key, custom_*,
   value, date) + RLS mirroring `days`, then the crew wires `pushPerf`/`fetchPerf` and
   populates the PersonDetail line from the live roster.

**Status:** local persistence shipped + tested; sync + date picker are seams. Awaiting you.

---

## D5 — Food database scope + barcode data source (P2 seams)

**What.** P2 (better meal logging) shipped food search + manual quick-add against a
**curated, offline STARTER table** (`src/core/foodDb.ts`, ~55 common foods across
protein/grain/dairy/fruit/veg/fat/snack/drink, with honest per-serving macros). An
athlete can search it and add a real food, and the existing `mealEdit` engine recomputes
the meal from real macros. Two parts were left to the safe line:

- **Database breadth.** The starter table is everyday whole foods, not a full nutrition
  database (no thousands of items, no branded/restaurant products, no per-100g vs.
  per-serving toggle). A real catalog is a data/licensing step, not crew-authorable
  offline. The in-app "no match" copy already tells the user a fuller DB lands with the
  backend, so the UI is honest about the gap.
- **Barcode scan.** Shipped as an INERT seam only (`src/lib/foodscan`,
  `isFoodScanAvailable=false`): it needs a real camera AND a product database. Both
  `scanBarcode()` and `lookupBarcode()` no-op; nothing fires.

**Why it needs you.** The food catalog and the barcode lookup are both **external data
sources with licensing implications**, and the barcode scanner is a device concern — all
guardrailed. The crew will not pick a paid/licensed data source or fire a network lookup
without your call.

**Options.**
1. **Food catalog.** (a) Keep the curated starter table for the beta (recommended to start
   — it covers the common athlete plate). (b) License/import a nutrition DB (USDA
   FoodData Central is free/public-domain; commercial DBs add branded items) — tell the
   crew the source and it will wire an importer + search against it.
2. **Barcode.** At go-live: `npx expo install expo-camera`, pick a product DB (Open Food
   Facts is free/open; a licensed DB is richer), then the crew wires
   `scanBarcode -> lookupBarcode -> addFood` (the same add path the manual quick-add
   already uses). Until then the seam stays inert.

**Status:** curated search + quick-add shipped + tested (UI built, not runtime-verified);
barcode is an inert seam; catalog breadth + barcode source await you.
