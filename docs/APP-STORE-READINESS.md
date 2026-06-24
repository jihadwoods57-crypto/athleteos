# AthleteOS — iOS App Store Readiness

> Status as of the 2026-06-24 PRE-LAUNCH AUDIT run. The app is **APP COMPLETE**
> (see `NIGHTSHIFT-LOG.md`); this document is the launch-readiness checklist for
> shipping to the Apple App Store. Three buckets: **✅ already compliant**,
> **🔧 fixed this run** (with the commit), and **👤 NEEDS HUMAN** (account
> enrollment, the App Store Connect listing, signing, device testing, and the
> product/legal decisions a no-eyes / offline crew cannot make).
>
> The single biggest review-risk for this app is at the bottom: **AthleteOS
> targets minors (13-22) with nutrition + body-weight data.** Read that section.

---

## ✅ Already compliant (verified this run)

- **No secret is bundled.** A repo-wide scan (`src/`, `app.json`, `app/`) finds
  no `sk-ant-...`, no `ANTHROPIC_API_KEY`, no `service_role` key in any client
  code. The only reference is a comment in `src/lib/ai/client.ts` explaining the
  key lives server-side.
- **The Anthropic key is server-only.** Meal analysis goes through the
  `analyze-meal` Supabase Edge Function (`supabase/functions/analyze-meal`),
  which holds `ANTHROPIC_API_KEY` in Deno env and calls Claude vision
  server-side. The app only ever sends a photo + receives a `MealResult`. The
  client falls back to the deterministic analysis if the endpoint is unset, so
  no key is ever required in the bundle.
- **The Supabase anon key is public-by-design and RLS-gated.** `0002_rls.sql`
  enables row-level security on every table with `security definer` helper
  functions (`is_self`, `can_view`, `is_team_coach_of`, etc.), self-only writes,
  overseer-scoped reads, and secure join-by-code RPCs (athletes never read the
  codes table). This is a correctly-scoped public anon key.
- **AI / camera / push stay deterministic and offline.** `isAiConfigured`,
  `isCameraAvailable`, and `isNotifyAvailable` are all `false` until a backend +
  native modules are wired. The app runs entirely on local mock data, so the
  build that ships today has no runtime network dependency and no hidden
  account-creation surface.
- **No medical / clinical claims in shipped copy.** A sweep for
  `cure|treat|diagnos|clinical|medical|prescri|disease|disorder|therap` over
  `src/**/*.{ts,tsx}` finds only internal code comments and a trainer-type label
  ("Clinical" as a trainer category) — nothing user-facing claims to diagnose,
  treat, or cure. The AI coach system prompt explicitly forbids extreme /
  restrictive advice and disordered-eating framing.
- **No placeholder / demo / beta strings leak to real users.** Every "demo"
  reference is the internal seeded-showcase identity, gated behind
  `athleteName === ''`; a real onboarded user never sees it (closed across many
  prior coherence runs).
- **No em dashes in shipped copy** (DESIGN.md ban) — enforced by existing tests
  and re-checked in the new usage strings.
- **App icon is a valid 1024x1024 PNG** (`assets/icon.png`, 1024x1024 RGB) — the
  App Store marketing icon requirement.
- **Orientation is declared** (`portrait`) and the iOS bundle exports cleanly
  (`expo export -p ios`, ~3 MB hbc).
- **No leaked timers / animation loops.** Every `Animated.loop` in the overlays
  (`MealCapture` scan-line + spinner) and every `AccessibilityInfo` listener
  (`useReduceMotion`, `Overlay`) is cleaned up in its effect teardown; haptics
  swallow errors so a missing engine can never break an interaction.

---

## 🔧 Fixed this run (pure config / code, all three gates green)

- **iOS App Store compliance config** — `chore(ios): App Store compliance
  config` (commit `4ae1a04`). All in `app.json`, verified with
  `expo config --type public` + a green `expo export -p ios`:
  - `ios.bundleIdentifier` = `com.athleteos.app` (**PLACEHOLDER** — see NEEDS
    HUMAN) and `ios.buildNumber` = `1`.
  - `ios.config.usesNonExemptEncryption = false` **and**
    `ITSAppUsesNonExemptEncryption = false` in `infoPlist`, so the
    export-compliance question is auto-answered (the app uses only standard
    HTTPS) and TestFlight/submission won't block on it.
  - **Info.plist usage strings** (Apple rejects camera/photo access without
    them): `NSCameraUsageDescription` (meal camera),
    `NSPhotoLibraryUsageDescription`, `NSPhotoLibraryAddUsageDescription`.
  - **Privacy manifest** (`ios.privacyManifests` -> `PrivacyInfo.xcprivacy`):
    `NSPrivacyTracking = false`, empty tracking domains, empty collected-data
    types (the offline build collects nothing remotely), and the
    required-reason API declarations the RN/AsyncStorage runtime needs
    (UserDefaults `CA92.1`, FileTimestamp `C617.1`, SystemBootTime `35F9.1`,
    DiskSpace `E174.1`).
- **VoiceOver labels on three navigation controls** — `fix(a11y): label the Home
  nutrition/check-in cards and the Notifications Clear button` (commit
  `7d25db5`). The Home -> Nutrition entry card (the only path to the Nutrition
  screen, which is intentionally not a bottom-tab), the Home -> weekly Check-In
  banner, and the Notifications "Clear" action were tappable but had no button
  role / label. Now each has `accessibilityRole="button"` + a clear label (and
  Clear has a `hitSlop` for the 44px target). No visual change.
- **Regression guard for the compliance config** — `test(ios): lock the App
  Store compliance config` (commit `8a04300`). `app.config.test.ts` asserts the
  bundle id, build number, encryption flags, every usage string (non-empty,
  em-dash-free), and the privacy manifest. A future change that drops any of
  these — each a guaranteed App Review rejection — now fails CI. Test count
  517 -> **522**.

---

## 👤 NEEDS HUMAN

### A. Apple account + build pipeline (cannot be done in this repo)
1. **Apple Developer Program enrollment** ($99/yr) — required to sign, upload to
   TestFlight, and submit.
2. **Own the real bundle identifier.** `com.athleteos.app` is a placeholder.
   Register the real reverse-DNS id in App Store Connect (and update
   `ios.bundleIdentifier` to match) before the first upload — it is permanent
   for the app record.
3. **EAS Build / native signing.** There is no `/ios` folder (it is gitignored
   and generated). Run `eas build -p ios` (or `expo prebuild` + Xcode) to
   produce a signed `.ipa`. This needs an Apple Distribution certificate + an
   App Store provisioning profile (EAS can manage these).
4. **Physical-device + TestFlight testing.** The crew has no device and no
   render harness (see `NIGHTSHIFT-LOG.md` NEEDS HUMAN #2). Smoke-test the real
   build on an iPhone: onboarding for each of the 7 roles, the meal-capture
   overlay, haptics, Reduce Motion, Dynamic Type, and the tab bar.

### B. App Store Connect listing (content + screenshots)
5. **Screenshots** for every required device size (6.7"/6.9" + 6.5", and iPad if
   `supportsTablet` stays `true` — see #11). No screenshots can be produced
   without a device/simulator render.
6. **Age rating questionnaire.** Answer it honestly — this app is for minors and
   involves health/fitness + body-weight tracking (see section D).
7. **App privacy "nutrition label."** Today the shipped build collects nothing
   remotely, so the answer is minimal. **The moment the Supabase backend is
   turned on** (auth + sync of meals, weight, check-ins), you must update both
   the App Store Connect privacy answers **and** the privacy manifest's
   `NSPrivacyCollectedDataTypes` (Health & Fitness, and an account identifier) —
   it is intentionally empty now.
8. **Real Privacy Policy URL + Support URL.** Both are required fields. There is
   no privacy policy in the repo. Given minors + health data, this needs legal
   review (COPPA / app-store data-from-kids rules).

### C. Config that needs a package install or a visual decision
9. **Launch screen (splash).** `assets/splash-icon.png` exists but no splash is
   configured (`expo-splash-screen` is **not installed**, so the crew did not
   add it blindly — that would risk the green gates). Before launch:
   `npx expo install expo-splash-screen`, add it to `plugins` with a background
   color and the icon, and verify the bundle. The background color is a visual
   call.
10. **iOS deployment target.** Defaults to the SDK 56 minimum (iOS 15.1), which
    is acceptable. To pin a different minimum you need
    `npx expo install expo-build-properties` and an `ios.deploymentTarget` in
    its plugin config. Left as a deliberate decision, not changed blind.
11. **iPad support decision.** `ios.supportsTablet` is `true`, so App Review
    will expect the app to run (and be screenshotted) on iPad. The app is
    portrait-only RN and will run letterboxed. Either commit to iPad (provide
    iPad screenshots, QC the layout) or set `supportsTablet: false` to scope the
    review to iPhone. This is a product/visual call.

### D. The big one — AthleteOS targets MINORS with health + body-weight data
This drives the heaviest App Review scrutiny. None of it is a code bug; it is
product / legal / process work only a human can own.
12. **Age rating + "made for kids" posture.** Onboarding collects ages
    **13-22** (`ageStep` clamps 8-24; the product positions 13-22). Apps
    directed at children have extra requirements (no third-party tracking/ads,
    stricter data handling). Decide and document the intended audience and set
    the age rating to match.
13. **Parental consent (COPPA / GDPR-K).** For users under the age of consent,
    you need a verifiable-parental-consent flow before collecting personal /
    health data. This lands with the real backend, not the offline build —
    design it alongside Supabase auth.
14. **Data-from-kids / no behavioral ads.** Confirm the analytics/ads posture is
    "none" for minors (it is today — the app has no analytics SDK and no ads).
    Keep it that way, and answer the App Store Connect "data from kids" section
    accordingly.
15. **No medical claims — keep it that way.** Shipped copy is clean today
    (verified above). The risk surface is the **live AI coach** once the backend
    is on: the `analyze-meal` system prompt already forbids extreme/restrictive
    advice and disordered-eating framing, but a human should review live model
    output during beta and add a visible "not medical advice / consult a
    professional" disclaimer given the minor + nutrition + body-weight context.

### E. Backend hardening before the Supabase seam goes live (Phase 2 — audit notes only, not touched)
> Per the hard rules, the backend seam was audited but not modified. These are
> for the human who turns it on.
16. **Rate-limit / authorize `analyze-meal`.** The function has
    `Access-Control-Allow-Origin: *` and no per-user rate limiting, so anyone
    with the public anon key could call it and burn Anthropic tokens. Add
    per-user auth verification + rate limiting (and consider tightening CORS)
    before launch. It checks `ANTHROPIC_API_KEY` presence but not the caller.
17. **Server-side score recompute.** `days.score` is client-posted. The RLS
    file already notes (lines 190-195) that a tampered client could write a fake
    score; add a trigger/edge function that recomputes the score from raw
    meals/tasks/check-in columns, keeping `src/core` `computeDerived` as the
    canonical formula.
18. **Ground the AI macros.** `groundMacros()` in the Edge Function is a
    passthrough TODO — the model's protein/calorie estimates feed scoring
    un-grounded. Ground them against a food database before trusting them for
    anything beyond coaching prose.

---

## Quick reference — what's in `app.json` for iOS now

| Key | Value | Why |
| --- | --- | --- |
| `ios.bundleIdentifier` | `com.athleteos.app` (placeholder) | required app id |
| `ios.buildNumber` | `1` | per-upload build number |
| `version` | `1.0.0` | marketing version |
| `ios.config.usesNonExemptEncryption` | `false` | skip export prompt |
| `infoPlist.ITSAppUsesNonExemptEncryption` | `false` | same, plist form |
| `infoPlist.NSCameraUsageDescription` | meal camera string | rejection if absent |
| `infoPlist.NSPhotoLibraryUsageDescription` | photo picker string | rejection if absent |
| `infoPlist.NSPhotoLibraryAddUsageDescription` | save-photo string | rejection if absent |
| `privacyManifests` | no tracking + required-reason APIs | App Store privacy req |
| `ios.supportsTablet` | `true` | **decide** (see #11) |
| splash | not configured | **add** (see #9) |
