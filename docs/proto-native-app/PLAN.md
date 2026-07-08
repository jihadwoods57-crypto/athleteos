# OnStandard — ship the proto AS the app (approved plan)

**Decision (2026-07-07, founder):** the `:8124` proto is the master. Ship the proto's
*real* HTML/CSS/JS as the app (pixel-perfect **by construction** — it's literally the
proto), wrapped in a native shell, with the existing athleteos Supabase backend wired
in behind it. Reuse the working EAS/TestFlight pipeline (`com.onstandard.app`, ASC
6787705639, `npm run ship`).

Founder calls locked:
- **All four roles** (athlete/coach/trainer/parent) wired to real data **before** public App Store submission.
- **Free v1**, paywall inert (no live in-app charge → avoids Apple 3.1.1). Apple IAP later.
- **Wearable data (sleep/HRV/recovery) = honest "coming soon"** for v1; real HealthKit/Whoop later.

## Architecture
- **Shell:** Expo (SDK 57, this repo) + `react-native-webview` renders the proto full-screen,
  offline, no browser chrome. WKWebView loads `index.html` with read-access scoped to the
  proto root so relative `./js` (ES modules), `./css`, `./assets/*` resolve exactly as at :8124.
- **Packaging (OTA-updatable):** proto ships as a bundled `assets/proto.zip`, extracted to
  `FileSystem.documentDirectory/proto/` on first launch (version-gated). Because it's driven
  from JS-shipped content, proto edits during the wiring phases ship over `eas update` in
  seconds — not a 15-min rebuild each time. (The webview native module itself needs one full build.)
- **Data:** `supabase-js` runs **inside** the WebView (direct HTTPS/WSS; RLS is the real authz).
  Only the **session token** goes native — persisted to iOS Keychain via a postMessage-bridged
  `expo-secure-store` adapter (chunked to dodge the ~2KB Keychain item limit).
- **Native bridges** (typed postMessage router): camera meal-capture (`expo-camera` → downscale
  → Storage upload → `analyze-meal` → inject result), push (`expo-notifications`), haptics
  (`expo-haptics`), share, secure-store, and **Sign in with Apple** (`expo-apple-authentication`
  → `signInWithIdToken`). These native capabilities are what clears Apple **4.2**.

## Required proto edits (additive, pixel-preserving — the "only the font" claim was false)
1. **Localize the font** — replace the `fonts.googleapis.com` `<link>` with a local `@font-face`
   (Plus Jakarta Sans, bundled) so typography is identical offline.
2. **`viewport-fit=cover`** on the viewport meta + render the WebView **edge-to-edge** so
   `env(safe-area-inset-*)` resolves non-zero (notch/Dynamic Island/home-indicator safe).
3. **Disable `-webkit-tap-highlight-color`** so WKWebView doesn't flash grey on every tap.
- **Fidelity baseline:** QC against the **on-device ≤520px phone breakpoint** (which hides the
  desktop device-frame), not the framed :8124 desktop mock. Screenshot every screen on a real notch device.

## Phases (each ends installable)
1. **Wrapper** — real proto on device via TestFlight (demo data). *Fast win.*
2. **Native bridges** — haptics/share/secure-store/push + typed router (4.2 signal).
3. **Real auth** — Supabase auth + Apple sign-in; Keychain session (chunked); gate first authed render on rehydration.
4. **Scoring spine** — port `computeDerived`/`scoring.ts` (+deps) + requirements CATALOG to proto JS
   (generate from TS + CI parity test — do not hand-transcribe a score engine) OR an edge fn. Home/Breakdown/Progress/Streak go real.
5. **Camera → AI meal loop** — native capture → upload → `analyze-meal` → live score move. Handle permission-denied state.
6. **Backend wiring by screen-group** — all 58 screens/4 roles to live data + RLS.
7. **App Store compliance** — in-app account deletion (confirm `delete_account` migration applied),
   inert paywall, review notes + demo login → external submission.

## Critique-driven guardrails (from adversarial review)
- App Store 4.2 is **moderate, not "cleared by construction"** — camera loop + all bridges must
  ship in the SAME externally-submitted build, with demo login + reviewer notes.
- Edge-fn CORS: file:// presents `Origin: null` — `supabase-js` REST/Auth/Storage/Realtime work
  (Supabase returns `*`), but custom-allowlisted edge fns (`analyze-meal`, billing, food) must
  allowlist null origin (JWT is the real authz). Name this honestly.
- Meal-result injection: **post back over the bridge** or strictly escape (`</script>`, U+2028/2029) — no raw JS concat.
- `allowsBackForwardNavigationGestures=false`; every screen needs an in-UI back; cold-start push
  deep-link must queue until the router attaches.
- Haptics shim via `injectedJavaScriptBeforeContentLoaded` (before proto code runs).

## Non-negotiable
Phase 1 delivers a **beautiful demo-data app**. "On TestFlight" ≠ "done" — the product is Phases 3–6
(data wiring + scoring port). Set this expectation every time.
