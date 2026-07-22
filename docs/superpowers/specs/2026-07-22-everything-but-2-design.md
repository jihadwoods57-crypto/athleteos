# "Everything but 2" — A/B/C/D design + decisions (2026-07-22)

Autonomous batch requested by founder: "dive in, no human intervention, make the best
decisions and finish A–D." This doc records the decisions so the build is auditable.

Skipped by explicit founder instruction: **#2 (training/workout logging)**.

## Scope & honest ceiling

| # | Feature | Buildable here | Verifiable here | Hard external gate (no code can do it) |
|---|---------|---------------|-----------------|----------------------------------------|
| A | Close consumer checkout | Yes (all code) | Partial (pure logic + proto UI) | Store products in App Store Connect / Play, RevenueCat dashboard, signed build, sandbox purchase |
| B | Progress-photo timeline | Yes | **Yes, fully** | — |
| C | Wearables (Apple Health / Health Connect) | Yes (all code) | Partial (pure logic + proto UI) | HealthKit entitlement, native build, physical device |
| D | Honesty-debt cleanup | Yes | **Yes, fully** | — |

"Finish" therefore means: **code-complete + verified where possible + a go-live checklist
for the console/device steps.** A and C ship the moment the next EAS build + store setup lands.

Next migration number: **0133**. Repo is **Expo SDK 57** (AGENTS.md says 56 — stale; will fix).

---

## A — Close consumer checkout

**Rail decision (locked, not mine to relitigate):** consumer = App Store / Play IAP via
RevenueCat. Stripe hosted checkout is the wrong rail (App Store rule + ~30% conversion loss
per `docs/paywall/event-schema.md`). The server seam is already complete and inert-safe:
`revenuecat-webhook` → `subscriptions.tier='consumer'` → `isPro` / `has_premium_access`.

**What's missing = the client last mile. Build:**

1. **RN IAP integration** — add `react-native-purchases` (Expo config plugin), configure with
   **RC App User ID = profile UUID** (so webhook events carry the owner), expose offerings,
   purchase, and restore. Capability-gated: if the SDK isn't configured (no key / not built),
   every entry point degrades to an honest "Available at launch" state — never a dead button.
2. **New bridge messages** (`src/proto/bridge.ts`): `IAP_AVAILABLE`, `IAP_OFFERINGS`,
   `IAP_PURCHASE {planId,cadence}`, `IAP_RESTORE`, exposed as `window.OnStandardNative.iap.*`.
   Follows the existing request/response `call()` + `__onNativeResult` pattern.
3. **Proto paywall** — a real reusable paywall screen (`#paywall`) showing the three consumer
   plans (Individual / Individual+ / Family) with the 30%-off annual math already in
   `src/core/pricing.ts`, FTC disclosure strings, monthly/annual toggle. Calls
   `OnStandardNative.iap.purchase(...)`, then refreshes entitlement.
4. **Wire the dead trial button** — `monthly-report.js` `#mr-trial` now routes to `#paywall`
   (or invokes purchase directly) instead of the `track()+disable` stub.
5. **Reveal `settings.js` billing** — replace the redirect stub with a real **Plan & billing**
   screen: current tier, renewal/expiry, "Manage in App Store/Play" deep link (IAP is
   store-managed — we never render a cancel button we can't honor), restore-purchases,
   and an upsell to `#paywall` for free users.
6. **Entitlement refresh** — after purchase/restore, re-pull the subscription row so the UI
   unlocks without an app restart.

**Go-live checklist (founder/console):** create products matching `_shared/revenuecat.ts`
`CONSUMER_PRODUCTS`; RevenueCat dashboard offerings + public SDK key
(`EXPO_PUBLIC_REVENUECAT_*`); `supabase secrets set REVENUECAT_WEBHOOK_SECRET` + set the RC
webhook Authorization header; apply migration `0102`; deploy `revenuecat-webhook`; set
`MONTHLY_REQUIRES_PLAN=1` when ready to enforce the report paywall; EAS production build.

**No new migration for A** (0102 already exists).

---

## B — Progress-photo timeline (fully shippable)

**Reuse, don't reinvent:** capture via the existing in-WebView `encodeToJpeg` pipeline
(1000px / q0.82, `camera.js`); upload via the direct `storage.upload(base64ToBytes, {upsert})`
path (`mealSync.ts`); display via a `createSignedUrl` + repaint-once cache (`photo-store.js`).
No native bridge needed.

**Migration `0133_progress_photos.sql`:**
- New private bucket **`progress-photos`**, path `{athlete_id}/{ts}.jpg` (segment 0 = athlete_id
  for the RLS idiom). Four storage policies cloned from `0003_storage.sql`. Read =
  `can_view(athlete_id)` (same trust tier as meal photos — coaches already see meal photos and
  weight, and the whole product is built on coach visibility). Write/update/delete = owner only.
- Table **`progress_photos`** (`id, athlete_id, photo_path, taken_at date, weight_lb int null,
  note text null, pose text null, created_at`). RLS: read `athlete_id=auth.uid() OR
  can_view(athlete_id)`; insert/update/delete owner-only. **Explicit `grant insert,update,delete
  ... to authenticated`** (the 0013/0036 grant gotcha). SELECT via default grant (whole-row
  table, not weight-split like `days`, so no 0103 column-grant issue).

**Client + proto:**
- `roles.js`: `uploadProgressPhoto(base64, {takenAt, weightLb, note, pose})` (upload + row
  insert) + `listProgressPhotos()` + `signedProgressPhotoUrl(path)` (mirror `signedMealPhotoUrl`).
- New screen `#progress-photos` (timeline: reverse-chron grid, tap → detail) + `#progress-compare`
  (before/after side-by-side picker). Capture reuses camera UX (a `pose`/label + optional weight).
- `progress.js`: new `photoTimelineCard()` section right after `weightCard()` (line ~135), plus a
  matching entry in the day-0 branch. Add a `mount()` to `progress.js` to warm/resolve signed URLs.
- Register both screens in `screens/index.js` (+ `weight.js` gets a "Add progress photo" affordance).

**Verify:** `npm run test:rls` (new policies), proto render harness (timeline empty + populated,
capture flow, both themes), `npm run verify` / jest green.

---

## C — Wearables (Apple Health / Health Connect)

**The math + ingestion seam is pre-built** (`src/core/recovery.ts` `blendRecovery`,
`src/lib/health/index.ts` `readRecoverySample` stub returning null). Missing = the native module
+ bridge + the score-wiring decision.

**Scoring decision (respecting founder caution on the scoring pipeline):** device data flows
**into the existing recovery self-report transparently**, it does NOT silently override 25% of
the score with a parallel 0.6-weighted blend. Concretely: when a real device sample exists,
device **sleep hours** (and optional HRV/resting-HR context) **pre-fill the athlete's recovery
check-in**, clearly labeled "from your watch," fully editable. The existing `recoveryParts`
averaging is untouched — the score model stays stable and athlete-controlled. The heavier
`blendRecovery(0.6)` path stays available and documented as a future founder-gated deepening,
not auto-enabled.

**Build:**
1. Native health module — iOS `react-native-health` (HealthKit) + Android Health Connect, wired
   via a local config plugin next to `plugins/withDeferredAppleSignIn.js`; add `NSHealthShareUsage`
   / Health Connect permissions. Pin versions compatible with Expo 57 / RN 0.86.
2. Implement `src/lib/health/index.ts` `isHealthAvailable` + `readRecoverySample()` against the
   module (read sleep / HRV / resting HR, last night). Capability-gated (null if unavailable).
3. New bridge messages `HEALTH_AVAILABLE`, `HEALTH_CONNECT` (request permission),
   `HEALTH_READ_RECOVERY` → `window.OnStandardNative.health.*`.
4. Reveal `#devices` (currently a redirect stub) as a real **Connect health** screen: connect
   Apple Health / Health Connect, show last-night sleep/HRV/resting-HR when present, honest
   disconnected state. Flip the `RT.wearable` hard-off pin to reflect real connection state.
5. Recovery screen (`recovery.js`): when a sample exists, pre-fill sleep + show a "from your
   watch" chip; athlete can override.

**Migration `0135_recovery_samples.sql`** (optional but included): a `recovery_samples` table
(athlete_id, date, sleep_hours, hrv_ms, resting_hr, source, created_at) so device context is
coach-visible and historical — read `athlete_id=auth.uid() OR can_view_weight(athlete_id)`
(same sensitivity tier as weight/HRV health data), owner-write, explicit grant.

**Go-live checklist (founder/device):** enable HealthKit capability + entitlement in the Apple
provisioning profile; Health Connect app-store declaration for Android; EAS build; grant
permission on a physical device (HealthKit does not work in Simulator).

---

## D — Honesty-debt cleanup

Disposition (from the full inventory):

- **Squad** (dead stub, 0 entry points, no backend) → **delete** export + registration + note.
- **Partner** (dead stub, 0 entry points, dormant local `nudgePartner`/`partnerNudged`) →
  **delete** export + registration + the dormant action/flag.
- **Team Dietary Sheet** → **FINISH.** Athlete restrictions are currently `localStorage`-only
  (`saveRestrictions` → `RT.restrictions`). Add server persistence + coach read:
  - **Migration `0134_dietary_restrictions.sql`:** add `restrictions jsonb` (+ `restrictions_updated_at`)
    to `athlete_profiles`; **add the new columns to the explicit SELECT grant** (0103 gotcha);
    coach-readable via existing `can_view`.
  - `saveRestrictions` also writes to the server (mirror `saveAthleteProfile`); load hydrates
    from server; `DAY`/profile fetch select-cols updated.
  - `teamDiet.render()` fetches real per-athlete declarations (coach-data.js roster load),
    severity-flagged; still renders the honest empty state until real data returns. Never
    invents an allergy (safety surface).
- **Safety / Wellness flags** → **leave as-is.** Already unreachable (0 entry points) and clearly
  disclaimered as a design preview pending clinical review. Deleting founder-authored design-intent
  code overreaches; adding a link would imply monitoring that isn't happening. No change; noted.
- **Devices stub** → resolved by C (becomes a real screen).
- **Trial button** → resolved by A.
- **Trainer Practice HQ "coming soon" roadmap** → honestly labeled locked roadmap; leave.

**Verify:** `npm run test:rls`, render harness (team-diet coach view with + without declarations,
athlete restriction round-trip to server), grep confirms no dangling `data-go="squad|partner"`.

---

## Build order

A → B → C → D (honors founder's stated priority; A/C land code-complete + go-live-gated, B/D
land done+verified). Each verified before moving on. Final pass: full `npm run verify` +
`npm run test:rls` + founder report with the two go-live checklists.
