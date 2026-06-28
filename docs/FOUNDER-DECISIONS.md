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

---

## D6 — Local notifications: device wiring + the firing model (P3 seam)

**What.** P3 shipped the reminders feature to the safe line: the pure schedule model
(`src/core/reminders.ts` — which reminders, their condition, copy, and active set), a
persisted per-reminder settings UI (toggle + local hour), and the device seam
(`src/lib/notify`, `isNotifyAvailable=false`). `refreshReminderSchedule(specs, notif)`
is the glue that WOULD (re)schedule one daily LOCAL notification per active reminder; it
no-ops until the seam is wired. Nothing fires today.

**Why it needs you.** Local notifications need `expo-notifications` installed, on-device
permission, and a real device to test (untestable in this runner). Two product calls
also sit on top: (a) when should the app recompute + reschedule the active set (on app
foreground? after each meal/check-in? a daily background task?), and (b) the conditional
reminders read a `ReminderSnapshot` (protein/hydration behind, dinner unlogged, check-in
due) — confirm those are the right triggers + the default hours (protein 4pm, hydration
2pm, dinner 8pm, check-in 6pm).

**Options.**
1. At go-live: `npx expo install expo-notifications`, request permission, set
   `isNotifyAvailable=true`, and call `refreshReminderSchedule(reminderNotifySpecs(...))`
   on foreground + after the day's meals/check-in change. LOCAL only (no push server).
   (Recommended — the pure model + gating are already tested.)
2. Adjust the catalog (add/remove reminders, change default hours/conditions) — tell the
   crew and it will re-author the pure model + tests.
3. Add REMOTE push (overseer -> athlete nudge) — a bigger step needing the backend to
   store device tokens + send; out of the local-only scope shipped here.

**Status:** pure model + settings UI + scheduling glue built + tested (UI/seam built,
not runtime-verified; nothing fires). Device wiring + the reschedule-trigger call await
you.

---

## D7 — Messaging: real delivery to a real person (P4 seam)

**What.** P4 shipped lightweight two-way messaging to the safe line: the pure model
(`src/core/messaging.ts` — compose/validate/append + an honest delivery note), the
existing Messages overlay now shows whether a message is delivered or only saved on this
device, and a delivery seam (`src/lib/messaging`, `deliverMessage`) gated on
`isBackendLive`. With the backend off, a sent message is kept locally and the composer
says so; **nothing is sent to a real person.**

**Why it needs you.** Actual delivery (write to a backend `messages` table under RLS, and
optionally a push) is the go-live step, and it carries a minors/safety dimension: who can
message a student-athlete, retention/moderation, and parent visibility all need a policy.

**Options.**
1. At go-live: implement `deliverMessage` against a `messages` table (RLS so only the
   thread's two parties read it); it already gates on `isBackendLive` so it stays inert
   until the flag flips. Decide the push half separately.
2. Keep messaging local-only for the beta (current honest behaviour) and revisit delivery
   later.
3. Define the messaging safety policy first (who may message whom, moderation, parent
   visibility) — tell the crew and it will encode the allowed-pairs logic as pure rules.

**Status:** model + overlay note + inert delivery seam built + tested (pure logic
verified; overlay built, not runtime-verified; delivery inert). Delivery + policy await
you.

---

## D8 — Wearable recovery: fold real sleep/HRV into the score? + device wiring (P5 seam)

**What.** P5 shipped the recovery-credibility groundwork to the safe line: a pure mapping
(`src/core/recovery.ts`) that turns a real `RecoverySample` (sleep / HRV / resting HR)
into a 0..100 recovery score and `blendRecovery(selfReport, sample)` that folds it into
the recovery sub-score when a sample exists — and returns the self-report **unchanged**
when it does not. The device seam (`src/lib/health`, `isHealthAvailable=false`,
`readRecoverySample -> null`) models HealthKit / Health Connect ingestion inert. It is
**not yet wired into live scoring** (no real sample source), so the daily score is
byte-for-byte unchanged today.

**Why it needs you.** Two calls: (a) **should** an objective recovery reading move the
Accountability Score at all (it currently weights a real sample 0.6 vs self-report 0.4 in
`blendRecovery`) — this changes what the headline number means, and the HRV/HR maps are
generic population bands, not person-calibrated; and (b) native HealthKit/Health-Connect
wiring + on-device permission + testing is a device step the crew cannot do.

**Options.**
1. At go-live: add a health module, request read permission for sleep + HRV + resting HR,
   set `isHealthAvailable=true`, and pass `readRecoverySample()` into `blendRecovery` at
   the recovery fold point in scoring. Confirm the 0.6/0.4 blend weight + the band cutoffs
   first (or ask the crew to make them configurable).
2. Keep recovery fully self-report for the beta (current behaviour) and ship the wearable
   fold later.
3. Person-calibrate the HRV/HR maps (rolling baseline per athlete instead of fixed bands)
   — a richer model the crew can author as pure logic once you confirm the approach.

**Status:** pure mapping + inert health seam built + tested; NOT wired into live scoring
(score unchanged). Blend-weight sign-off + device wiring await you.

---

## D9 — Persona-voice fixes shipped to the safe line; two deeper items still need you (P6)

**What.** P6 (Day 3 AM) shipped the safe, copy/logic subset of the persona review:
- **AI coach scoped as education, not a prescription** (RD finding). The meal coaching now
  suggests foods as optional ("if that fits your plan") instead of directing ("closes the
  gap"), and every payload carries a scope line ("General guidance to learn from, not a
  prescription. If a nutritionist or doctor set your plan, theirs comes first.").
- **Non-athlete trainer book reflected in the dashboard** (personal-trainer finding). A real
  trainer's onboarding `clientType` (weight-loss / muscle-gain / general) re-frames the
  trainer header + empty state so a non-athlete book reads first-class.
- **Honest parent weekly read** (parent finding). The parent AI summary now derives from the
  athlete's real score band instead of a frozen "no action needed", and a coverage line
  ("Building history: N of 7 days logged this week") labels a partial week.

**Why these two still need you.**
1. **Real parent data-freshness needs the backend.** The coverage line currently counts real
   recorded days (`scoreHistory.length`) as an honest proxy. The persona's actual ask — a
   true "last synced from [child]: today 6:40pm" timestamp — needs the live backend + the
   parent↔athlete link (P0, flag-off today). Until then there is no real sync clock to read.
2. **Full non-athlete trainer support is bigger than header copy.** Reflecting `clientType` in
   the chrome is the safe slice. The persona's deeper ask — a non-athlete client SCORE,
   goal-based targets, and an AI voice tuned per population (fat-loss / general / muscle-gain)
   instead of athlete metaphors — is a real feature (new per-population targets + scoring) that
   wants a product call on what those targets are before the crew builds it.

**Options.**
1. Confirm the parent freshness should become a real synced timestamp at go-live (wired through
   P0) and keep the day-count proxy until then. (Recommended.)
2. Specify the non-athlete trainer targets (e.g. a fat-loss client's protein floor + calorie
   ceiling, a general-fitness adherence target) and the crew will encode them as pure
   per-population scoring, or defer the full trainer-as-first-class build past the beta.

**Status:** all three voice fixes shipped pure + tested (coaching scope, trainer clientType
lens, parent digest); UI labels built, not runtime-verified. The two deeper items above are
queued, not attempted (one needs the backend, one needs a product call).

---

## D10 — Minor-messaging governance model + the RLS gate (Tier 2 Trust & safety)

**What.** Day-2 shipped athlete<->counterpart messaging whose RLS (`0002_rls.sql:139-149`)
let ANY thread participant read/write with no age or relationship governance — a minor
athlete could sit in an unsupervised thread with an arbitrary adult. This run closed the
hole to the safe line:
- A pure app-layer guard `messagingAllowed` / `messagingGateNote` (`src/core/messaging.ts`,
  unit-tested) encoding the beta rule: an adult athlete messages anyone; a **minor** athlete's
  only permitted counterpart is an **authorized relationship** (a coach on their team, a
  trainer whose client they are, or an active guardian). **Fail-closed:** unknown age = minor.
- A server-side gate `0006_messaging_minor_gate.sql` (the REAL enforcement) adding
  `messaging_authorized(athlete, counterpart)` to the threads-insert + messages-insert RLS.
- Removed the fabricated **"Active now"** presence claim in the Messages overlay (no real
  presence signal exists); persisted `msgThread` so a coach<->athlete message survives reload.

**Why it needs you.** The governance *model* is a legal/product call, not an engineering one:
1. **Policy choice.** The crew picked "minor messaging restricted to authorized coach/guardian
   relationships" (keeps the HS-coach beta working while closing open adult->minor DMs). The
   work-queue offered an alternative: "scope messaging to **adults-only** for beta." Adults-only
   would *disable* coach<->athlete messaging for an all-minor HS cohort, so the crew did not pick
   it — confirm you agree with the relationship-gated model over adults-only.
2. **Legal review.** Minor messaging touches COPPA / FERPA / state minor-safety law. The
   relationship gate is a floor, not a compliance sign-off. Before any real cohort messages,
   this needs counsel (mandatory-reporting posture, message retention/audit, guardian
   visibility, blocking/reporting tooling).
3. **`0006` is NOT runtime-verified** (no live DB this run). Review it and run it against a
   LOCAL supabase stack (the path the P0 round-trip used) before applying; do NOT `supabase db
   push` to the live project without per-migration sign-off (D1).

**Options.**
1. Keep the relationship-gated model as shipped; book legal review before the cohort messages.
   (Recommended — preserves the beta use case while closing the open hole.)
2. Switch to adults-only messaging for beta (disables coach<->minor DMs) — say so and the crew
   flips the guard + RLS.
3. Defer messaging from the beta entirely until the governance + legal layer exists.

**Status:** app-layer guard shipped pure + unit-tested; "Active now" lie removed and `msgThread`
persisted (built, not runtime-verified — no device render here); RLS `0006` authored as a
documented seam, NOT applied, NOT runtime-verified.

---

## D11 — Local-only activation for minors (loosened the onboarding consent gate)

**What.** The persona play-test (athlete persona) flagged the guardian-consent step as a
day-0 activation killer: a minor was hard-blocked at onboarding until a guardian request was
sent, a typo'd guardian email left them permanently stuck with no feedback, and a pending
request locked the field with no way to resend. This run changed the policy to **local-only
activation**:
- A minor can **start the app immediately** in local-only mode. The onboarding continue CTA
  now needs only the athlete's own agreement, with a banner: *"your meals and score stay
  private on this device. Nothing is shared with a coach until a guardian approves."*
- This is only safe because the **sync gate was hardened first** (`src/core/consent.ts`,
  commit `f7f1e8b`): `realDataConsent` now **fails closed** for a minor whose `guardianStatus`
  is not `verified` — a self-tapped checkbox or a merely `pending` request never pushes a
  minor's real data. So nothing leaves the device until a guardian is verified.
- Guardian email now validates (`isValidGuardianEmail`) with inline typo feedback, and the
  request can be **resent / the email corrected** while pending.
- Only renders when the backend is live (flag off today) — this is go-live prep.

**Why it needs you.** Loosening a minor-consent gate is a **legal/product call, not an
engineering one**, even though the data-protection invariant is intact (no sync until a
verified guardian):
1. **Policy choice.** The crew picked "activate local-only, prompt for guardian approval"
   over the prior "hard-block until a request is sent." Confirm you want minors to be able to
   use the app on-device before any guardian action — the alternative is to keep the hard gate.
2. **Legal review.** COPPA's "verifiable parental consent" still governs *collection*. The
   crew's read is that on-device-only use with nothing transmitted is not "collection," so
   local activation is permissible and the verified-guardian gate covers the moment data would
   leave the device. **This needs counsel sign-off** before a real minor cohort runs.
3. **"Re-prompt after ~3 meals" not yet built.** The synthesis recommended nudging a
   local-mode minor to get guardian approval after a few meals. That in-app reminder banner is
   NOT in this change — flag if you want it next.

**Options.**
1. Keep local-only activation as shipped; book legal review before a minor cohort.
   (Recommended — fixes the activation killer while keeping data on-device until verified.)
2. Revert to the hard gate (block onboarding until a guardian request is sent) — say so and
   the crew restores the prior disabled-until-sent CTA.
3. Keep local activation but require the guardian **request to be sent** (not verified) before
   proceeding — a middle ground.

**Status:** sync gate hardened pure + unit-tested (`f7f1e8b`); onboarding local-mode + email
validation + resend shipped (`ec185e4`), behind the backend-live flag, not device-rendered
this run; the "re-prompt after N meals" banner is NOT built.

---

## D12 — The two missing go-live RPCs are now authored + locally verified (delete_account, guardian consent)

**What.** The app already called `delete_account` and `request_guardian_consent` (and
database.types.ts declared them), but **no migration created them** — they'd have failed at
runtime the moment the backend flipped. Written as additive migrations and **verified on a
throwaway local Postgres running the real 0001→0008 set**:
- `0007_delete_account.sql` — Apple 5.1.1(v) account deletion. SECURITY DEFINER, deletes the
  caller's meal-photo storage objects then their `auth.users` row, which FK-cascades the
  profile + every day/meal/checkin/link. Only ever targets `auth.uid()`; fails closed when
  signed out.
- `0008_guardian_consent.sql` — COPPA VPC. New `guardian_consent_requests` table + a
  SECURITY DEFINER `request_guardian_consent(guardian_email)` that records/refreshes a
  PENDING request (email normalized, token rotated on resend). Athletes can READ their own
  request but never write it — only the RPC and a service_role verify endpoint can — so a
  minor can't self-verify.

Local verification (6 assertions, all green): consent created pending + email normalized;
resend rotates the token with no duplicate; invalid email rejected; both RPCs fail closed
when signed out; delete_account wipes all of A's data + photo and leaves an unrelated user
intact. The run caught one real bug (an ambiguous `ON CONFLICT` from the RPC parameter
shadowing the column) which is fixed.

**Why it needs you.**
1. **Apply per-migration at go-live (D1).** These are authored only, NOT applied to live.
2. **Guardian consent is only half a system in SQL.** `request_guardian_consent` records the
   request and a token; it does NOT send email or grant consent. Before relying on it you
   must wire (a) an email sender for the verification link and (b) a **service_role** endpoint
   that flips a row to `verified` after a real identity/payment check. Until then every minor
   stays local-only (which is safe — the client gate blocks sync until 'verified').
3. **delete_account assumes the platform FK cascade.** Verified against the real schema
   locally; still re-confirm on the live project that no table was added outside the
   profiles-cascade chain.

**Status:** `0007` + `0008` authored and locally verified; NOT applied to live; guardian
email-send + verify endpoint still founder/vendor work.

---

## RATIFIED (founder, this session) + the engines keystone

The founder ruled on the four highest-leverage calls; all went the crew's recommended way:

- **KEYSTONE — engines OFF for the first beta.** The two new engines (Nutrition Intelligence
  / Restaurant Coach + the Accountability surfaces) are now behind a SINGLE master switch,
  `isEnginesEnabled` (`src/lib/features.ts`), **default OFF**, so the first closed beta proves
  the core loop (log a meal -> score moves). Flip on with `EXPO_PUBLIC_ENGINES_ENABLED=true`
  (env only, rebuild — no code change), exactly like the backend flag. Gated entry points:
  the Restaurant Coach card (Nutrition), the Plan-execution card + Coach Plan editor (Plan),
  and the per-meal Plan check (Meal Detail). The engines stay fully built + unit-tested; only
  their UI is hidden. The core meal loop, macros, tasks, score are untouched.
- **D1 — apply the go-live migrations as-written at go-live.** Approved. 0004/0005/0007/0008
  applied per-migration by the founder when flipping the backend; never by the crew.
- **D2 — require email confirmation for real sign-up.** `enable_confirmations = true` set in
  `supabase/config.toml` (live project still needs the same toggle in the dashboard).
- **D11 — local-only activation for minors: YES.** A minor may use the app on-device before
  any guardian action; nothing syncs until a guardian is `verified` (gate hardened earlier).

Still open for a later round (built to the safe line, awaiting your call): D3 (PRs into the
score — crew: keep separate), D4 (PR date picker + sync table), D5 (food DB: keep starter vs
license USDA + barcode source), D6 (reminder triggers + notification library), D7 (messaging
delivery + minors policy first), D8 (wearable recovery into the score), D9 (parent "last
synced" + non-athlete-trainer scoring), D10 (minor-messaging governance model + legal review).
