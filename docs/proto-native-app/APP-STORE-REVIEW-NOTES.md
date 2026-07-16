# App Store review notes (template — founder fills the credentials)

Draft reviewer guidance for the OnStandard submission. Fill the **`<<…>>`** placeholders with
real values before submitting. Everything else reflects what's actually in the app today.

## Demo account (required — Apple reviews behind auth)
- **Email:** `athlete1@onstandard.app`
- **Password:** `Demo1234!`
- Athlete role by default (Marcus Reed, WR). To see the coach view, sign in with
  `coach@onstandard.app` / `Demo1234!` (Coach Dave Reynolds, `primary_role = 'coach'` on team
  "Demo Varsity" / code `KDRFG3`, with athlete1–3 as active members).

> ⚠️ **BEFORE SUBMITTING — seed history.** As of the last seed (2026-07-13) these accounts are FRESH
> with **zero logged days/meals**, so the reviewer would land on empty states. Log a few days + meals
> for the athlete (and let the coach comment) so the reviewer sees real roster/review data. Re-run
> `scratchpad/seed_demo.sql` with a history block, or log manually in-app before you submit.

## What the app is
OnStandard is an athlete-accountability app. The athlete logs meals with the camera; an AI reads
the plate; a daily score (four weighted components) reflects real logged behavior. Coaches see a
real roster and can comment on meals, set nutrition targets, and grant a "Trust Pass."

## How to review (athlete)
1. Sign in with the athlete demo account → **Home** shows the day's score, requirements, and recent
   activity, all from real logged data.
2. Tap the camera FAB → **capture a meal photo** → it uploads, the `analyze-meal` function reads it,
   and logging it moves the score. (Camera + AI loop — the App Store 4.2 signal.)
3. **Profile → Delete account** → two-tap confirm performs a real in-app deletion
   (`delete_account` RPC + sign-out + local wipe). This satisfies Apple 5.1.1(v).
4. **Profile → Plan & billing** → for the athlete, plans are consumer IAP tiers shown as **"available
   at launch"** — the paywall is **inert** (no live charge, no in-app purchase to test). Avoids 3.1.1.

## How to review (coach)
1. Sign in with the coach demo account → **Team** shows the real roster (RLS-scoped to the coach's
   team), each athlete's live score.
2. Tap an athlete → review their real day + logged meals → **comment on a meal** (the athlete sees
   it) → **set nutrition targets** → optionally **grant a Trust Pass**.

> ✅ **3.1.1 — enforced by the build (coach/org billing).** The coach/trainer Plans screen uses a
> **Stripe** rail for B2B org/gym subscriptions, NOT Apple IAP. To guarantee review never reaches an
> external purchase flow, the live checkout CTA is now behind an explicit off-by-default kill-switch
> (`EXPO_PUBLIC_BILLING_CHECKOUT_LIVE`, see `src/lib/billing/portal.ts` → `isCheckoutLive`). It is
> **unset in the production build**, so every plan CTA falls back to the honest "available at launch"
> copy regardless of whether the `billing-checkout` function is deployed — no 3.1.1 surface. Flip the
> env flag to `1` only after approval + IAP wiring. **Do not add this var to `eas.json` production.**

## Native capabilities present (the 4.2 story — must all ship in this build)
- Camera meal capture (`expo-camera`) → downscale → Storage upload → `analyze-meal`.
- Push notifications (`expo-notifications`) — coach nudges / comment pings via the `send-push` fn.
- Haptics, share, secure-store (Keychain session).

> Sign in with Apple is **NOT in this build** — `expo-apple-authentication` isn't installed and the
> capability isn't wired, so the Apple button stays hidden. This is compliant: the app offers only
> email/password (no third-party/social login), so Guideline 4.8 isn't triggered. Do not tell the
> reviewer to test an Apple sign-in button. (The typed seam exists in `src/lib/auth/apple.ts` for a
> later build if we add it.)

## Data & privacy
- Auth + all data run through Supabase; **RLS is the authorization** — a coach only sees athletes
  linked via an active team membership; a trainer only sees their practice clients.
- Meal photos are private (signed URLs, coach-connection only). No ad tracking, no third-party
  analytics identifiers.
- Account deletion is immediate in-app and cascades server-side.

## Known honest "coming soon" (intentional, not broken)
Leaderboards, requirement assignments, the parent role's child data, and recruiter-share links are
honest coming-soon states — they have no backend yet, so the app shows a clear "coming soon" rather
than fabricated data. This is deliberate (the product's principle is: never show a number that
isn't real).

## Pre-submission checklist (founder)
- [ ] Confirm the role-layer migrations are applied live (`team_roster` 0040, `meal_comments` 0046,
      `trust_passes` 0033/0039, `coach_views` 0043, `coach_set_goals`, `delete_account`, and
      `0036_fix_table_grants`).
- [ ] `send-push` and `analyze-meal` edge functions allowlist the `file://` **null origin**
      (the WebView presents `Origin: null`; JWT is the real authz).
- [ ] Seed + verify the athlete and coach demo accounts (a real coach↔athlete round-trip).
- [ ] Fill the credential placeholders above.
