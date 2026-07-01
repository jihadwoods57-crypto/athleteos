# Founder Return — 2026-06-28 (end of the 4-day founder-away sprint)

**For:** the founder, on your return. **Branch:** `crew/4day-sprint` (NOT merged — yours to
review + merge). **Final gates:** `npm run typecheck` clean · `npm run test` **894 passing**
(62 suites) · `npm run bundle` (iOS export) green — on every commit.

**The one-line truth:** the app was already app-complete; this sprint added the backend
wiring, five new features, readiness/hardening, and a clean go-live runbook — **all behind
flags/seams, nothing live, no real data, no external sends.** Everything that still stands
between you and a closed beta is now a **human** step (legal, two vendors, applying DB
migrations, a real phone, Apple). Those are listed under **NEEDS YOU** at the bottom.

**How to read this:** each feature is marked **VERIFIED** (pure logic unit-tested, or a local
round-trip proven) or **BUILT — NOT RUNTIME-VERIFIED** (the code + seam exist and are
unit-tested where pure, but they have not run on a real device / live backend, by guardrail).

> **Two master switches, both OFF by default (unchanged this sprint):**
> `EXPO_PUBLIC_BACKEND_LIVE` (real auth + data sync + roster) and `EXPO_PUBLIC_ENGINES_ENABLED`
> (the two new engines' UI + the Accountability punctuality signal). Off → the app runs the
> proven core loop with identical scoring. Flip either via env only (rebuild, no code change);
> each doubles as an instant kill-switch.

---

## What shipped, by priority item

### P0 — Backend wiring (the keystone), flag-gated OFF — VERIFIED (locally)
Auth (Stage B), day-sync hooks (Stage C, every `pushDay` gated by `realDataConsent`), the
athlete consent screen, and roster reads (Stage D) are wired behind `isBackendLive`; with the
flag off, behavior is byte-for-byte identical. The full round-trip
(**auth → joinTeam → pushDay → fetchLinkedDays**) was proven against a **throwaway LOCAL
Supabase stack on localhost** — never the live project. Two go-live migrations authored +
locally verified: `0004_create_team` (atomic `create_team(name, sport)` RPC returning a real
6-char join code, replacing the static `EAGLES24`) and `0005_grants` (explicit table/seq/func
GRANTs). **The flag was never enabled; nothing was applied to the live project.**

### P1 — Performance signal (Feature #1; the #1 persona gap) — VERIFIED (pure) / seams noted
`src/core/performance.ts`: a PR/entry model (lift, sprint/40, jump/vertical, body weight,
custom) with best/trend/personal-record computation; an athlete **Performance** view to log a
PR and see PRs + trends; a compact performance line for the coach's PersonDetail. Persists
locally + survives day rollover; kept **OUT** of the daily score (ratified D3). PR date entry
is a `YYYY-MM-DD` validated text field (native date-picker = device step); cloud sync needs a
`performance_entries` table (**seam — D4**). Pure logic unit-tested; **UI built, not
runtime-verified.**

### P2 — Better meal logging (Feature #6; the dietitian's ask) — VERIFIED (pure) / barcode = seam
`src/core/foodDb.ts`: a curated **offline starter table (~55 common foods)** with honest
per-serving macros, plus pure search. Food search + manual quick-add add a real food and the
existing `mealEdit` engine recomputes the meal from real macros. **Barcode scan is an INERT
seam** (`src/lib/foodscan`, `isFoodScanAvailable=false`) — needs a camera + a product DB
(D5). Pure logic unit-tested; **UI built, not runtime-verified.**

### P3 — Reminders / notifications (Feature #2; the engine's fuel) — VERIFIED (pure) / device = seam
`src/core/reminders.ts`: the schedule model (which reminders, default time + on/off, the
condition each fires on — "protein behind", "dinner unlogged", "check-in due"), athlete-first
copy. A persisted per-reminder settings UI. The store calls the local-notification seam
(`refreshReminderSchedule`, `src/lib/notify`, `isNotifyAvailable=false`) on every settings
change — **a no-op today; nothing fires** (D6). Pure logic unit-tested; **scheduling glue +
UI built, not runtime-verified.**

### P4 — Messaging + weekly auto-report (Feature #3; coach/parent leverage) — VERIFIED (pure) / delivery = seam
`src/core/weeklyReport.ts`: a per-athlete weekly digest (score, compliance, what moved, one
flag) — now surfaced on the athlete **Profile** and a **team weekly report** on the Coach
dashboard. `src/core/messaging.ts`: compose/validate/thread model; the Messages overlay
honestly labels a message **"not yet delivered"** when the backend is off. Real delivery is
flag-gated to P0 and stays the founder step (**seam — D7**); a **minor-messaging relationship
gate** (`messagingAllowed` + RLS `0006`) restricts a minor to an authorized coach/trainer/
guardian, fail-closed (**D10, needs legal**). Pure logic unit-tested; **overlay + delivery
built, not runtime-verified.**

### P5 — Wearable recovery (Feature #5; score credibility) — VERIFIED (pure) / device = seam
`src/core/recovery.ts`: a pure mapping from a real `RecoverySample` (sleep/HRV/resting HR) to
a 0..100 recovery score, and `blendRecovery(selfReport, sample)` that folds it in **only when
a sample exists** and returns the self-report **unchanged otherwise** — so the daily score is
byte-for-byte unchanged today. Device ingestion is an inert seam (`src/lib/health`,
`isHealthAvailable=false`). NOT wired into live scoring (**D8**). Pure logic unit-tested.

### P6 — Persona voice fixes (safe subset) — VERIFIED (pure)
AI-coach voice moved prescriptive → educational with a scope disclaimer; the non-athlete
trainer's `clientType` (fat-loss/general/muscle-gain) re-frames the trainer dashboard; the
parent weekly read is honest (real score band + a "building history: N of 7 days" coverage
line). A **trust pass** stopped calling deterministic coaching "AI" until a real model runs,
and hides sample/demo stats once the backend is live. The two deeper items (a real parent
"last synced" timestamp; a full non-athlete client SCORE) need the backend / a product call
(**D9** — spec authored: `docs/specs/2026-06-28-D9-...md`). Pure logic unit-tested.

### P7 — App Store readiness + hardening — VERIFIED (pure + local SQL)
In-app **account deletion + data export** (Apple 5.1.1(v), GDPR/CCPA); `0007_delete_account`
+ `0008_guardian_consent` (COPPA VPC) authored and **verified on a throwaway local Postgres**
(6 assertions, caught + fixed one real `ON CONFLICT` bug). Consent gate **fails closed**: a
minor's data cannot sync until a guardian is `verified`. Local-only activation for minors
(D11). Draft **Privacy Policy + Terms** in `docs/legal/`. Body-image safeguard on weight
entry; analyze-meal input validation; iPhone-only launch scope; AI-honesty labeling
throughout. Pure logic + SQL locally verified; **device/Apple/live-DB steps remain.**

### P8 — Full QA + regression — VERIFIED
Locked the keystones with regression tests: Coach Plan (`activePlan`/`formatWindowTime`/
`mealTarget` fallbacks), the body-image safeguard copy, the store meal-loop, `mealFoods`
day-rollover reset + score clamp, and **this run's flag-OFF fix** (below). Tests grew
559 → **894** across the sprint; all three gates green on every commit.

### Beyond the queue (Day 3–4 product additions)
The **single engines master switch** (`isEnginesEnabled`, default OFF — prove the core loop
first); the **Development Score** rename + the **Daily Game Plan / "finish-today" projection**;
the **Coach Plan editor** (the one plan both engines read); **Restaurant Coach** widened to 13
chains + an off-menu fallback; **profile-aware scoring** (`athlete` default = byte-for-byte the
shipped formula; `general` is an inert D9 seam, never auto-assigned); the **Product
Constitution**, **Launch Checklist**, and **GO-LIVE-NOW runbook**.

---

## This run's adversarial self-review (Day-4 diff)

I reviewed the full Day-4 diff (UI + core/store) adversarially. **The UI was clean.** One real
**flag-OFF behavior change** was found and **fixed** (commit
`fix(score): gate the late-meal punctuality penalty behind the engines switch`):

> Feature 8 folds an on-time meal-logging penalty into the Development Score (a late meal
> counts half). The engines switch gated the Accountability Engine's **UI** but not this
> **scoring signal** — so with engines OFF a user who logged a meal late scored lower
> (84 → 82) than pre-sprint, with the explaining windows UI hidden. That contradicted the
> ratified keystone ("engines off → score untouched"). **Fix:** the store now records the
> punctuality timestamp only when `isEnginesEnabled`; engines OFF → no timestamp → every meal
> on-time → score byte-for-byte the pre-engines number. Two store-level regression tests lock
> it; `src/core` stayed pure.

Two known, documented non-issues left as-is (not regressions): the dark-mode `theme.tsx` is
intentionally inert (light-only, no component migrated), and `itemsByTag` in `restaurants.ts`
is an exported-but-uncalled helper (left for you to remove if unwanted — removing an exported
API is a behavior-risking change not worth a closing-run commit).

---

## docs/FOUNDER-DECISIONS.md — the queued judgment calls (full contents)

The crew logged every product/judgment call here instead of guessing. **Ratified by you this
session:** the engines-OFF keystone; **D1** apply migrations as-written at go-live; **D2**
email confirmation ON; **D3** keep PRs out of the daily score; **D4** PR date-picker + sync
NOT yet; **D5** keep the 55-food starter list; **D6** approve on-device reminders (device
wiring remains); **D7** messaging delivery NOT yet; **D8** wearable recovery NOT in the score
for beta; **D9** start speccing parent-sync + non-athlete scoring; **D10** minor-messaging
relationship-gated (legal review still required); **D11** local-only activation for minors YES.

**Still open / awaiting you** (built to the safe line, no code blocked): the *deeper* halves of
D4 (a `performance_entries` table), D5 (license USDA / a barcode source), D6 (the reschedule
trigger + notification library), D7 (delivery + the minors policy first), D8 (fold real
recovery into the score), D9 (build the `general` scoring profile after RD sign-off — the
weights are a one-line edit), D10 (the legal review itself). **D12:** the two missing go-live
RPCs (`delete_account`, `request_guardian_consent`) are now authored + locally verified.

Read `docs/FOUNDER-DECISIONS.md` for each entry's full what / why-ambiguous / options.

---

## ✅ NEEDS YOU — the exact checklist to finish each feature + go live

Work top-down; later items depend on earlier ones. The deeper "why" for any line is in
`docs/FOUNDER-DECISIONS.md`; the desk-side runbook is `docs/GO-LIVE-NOW.md` /
`docs/LAUNCH-CHECKLIST.md`.

**Phase 0 — legal + vendors (gate everything):**
- [ ] **Counsel review + host the legal docs** (`docs/legal/` Privacy + Terms); COPPA/FERPA
      sign-off (minors' health data); publish at public URLs the app links to.
- [ ] **Pick a parental-verification (VPC) vendor** — the thing that flips a guardian from
      `pending` → `verified` (identity/payment, not a checkbox). Until it exists every minor
      stays local-only and no coach sees their data.
- [ ] **Pick an email sender** — for the guardian approval link AND the sign-up confirmation
      (you chose confirmation ON).
- [ ] **Bless minor-messaging with counsel** (mandatory-reporting, retention, blocking/
      reporting) before any under-18 user messages. Until then leave messaging off (it is).

**Phase 1 — turn the backend on (your hands on the keyboard):**
- [ ] **Apply the migrations to the live project, one at a time, in order:** `0004` (team
      create/join code), `0005` (grants), `0006` (minor-messaging RLS gate), `0007` (account
      deletion), `0008` (guardian consent). Written + locally verified; apply as-written.
- [ ] **Flip email confirmation ON** in the Supabase dashboard (config file already set).
- [ ] **Set `EXPO_PUBLIC_BACKEND_LIVE=true`** (env only, rebuild) and decide
      `EXPO_PUBLIC_ENGINES_ENABLED` (recommend OFF for the first cohort — prove the loop).
- [ ] **Manually run the coach-invites-athlete flow** end-to-end on the live project, then
      **verify RLS cross-team isolation** (coach A cannot read team B's athletes; a minor's
      data is invisible until a guardian is verified). *Built + locally round-tripped; NOT
      verified on the live project.*

**Phase 2 — device wiring (needs a real phone; out of crew scope):**
- [ ] **Notifications:** `npx expo install expo-notifications`, request permission + Android
      channel, implement the bodies in `src/lib/notify/index.ts`, set `isNotifyAvailable=true`,
      test firing on-device.
- [ ] **Barcode:** `npx expo install expo-camera`, pick a product DB (Open Food Facts is
      free/open), wire `scanBarcode → lookupBarcode → addFood`, set `isFoodScanAvailable=true`.
- [ ] **HealthKit / Health Connect:** add the health module, request read for sleep + HRV +
      resting HR, set `isHealthAvailable=true`, pass `readRecoverySample()` into
      `blendRecovery` (confirm the 0.6/0.4 blend weight first — D8).
- [ ] **PR date picker** (optional): wire a native date picker behind the Performance form
      (text field works for beta — D4).

**Phase 3 — Apple:**
- [ ] **Apple Developer enrollment + a real bundle id**, then submit (account-deletion is in
      place for 5.1.1(v); iPhone-only scope is set).

---

*Built-but-not-runtime-verified, by guardrail (no device / no live backend this sprint):* all
flag-gated UI (Performance view, food search/quick-add, reminders settings, messaging overlay,
Coach Plan editor, Restaurant Coach), every device seam (notify/foodscan/health), the backend
sync path (proven locally, not against the live project), and migrations `0004`–`0008` (locally
verified on a throwaway stack, not applied to live). All pure `src/core` logic is unit-tested.
