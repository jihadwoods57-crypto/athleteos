# App Store review notes (template — founder fills the credentials)

Draft reviewer guidance for the OnStandard submission. Fill the **`<<…>>`** placeholders with
real values before submitting. Everything else reflects what's actually in the app today.

## Demo account (required — Apple reviews behind auth)
- **Email:** `<<reviewer demo email>>`
- **Password:** `<<reviewer demo password>>`
- Athlete role by default. To see the coach view, sign in with `<<coach demo email>>` /
  `<<coach demo password>>` (an account whose `profiles.primary_role = 'coach'` on a team that has
  the athlete demo account as an active member).

> Seed the demo accounts before submitting: an athlete with a few logged days + meals, and a coach
> on the same team, so the reviewer sees real roster/review/comment data rather than empty states.

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
4. **Profile → Plan & billing** → the paywall is **inert** (no live charge) — the app is free in
   v1, so there's no in-app purchase to test (avoids 3.1.1). Named honestly in-app.

## How to review (coach)
1. Sign in with the coach demo account → **Team** shows the real roster (RLS-scoped to the coach's
   team), each athlete's live score.
2. Tap an athlete → review their real day + logged meals → **comment on a meal** (the athlete sees
   it) → **set nutrition targets** → optionally **grant a Trust Pass**.

## Native capabilities present (the 4.2 story — must all ship in this build)
- Camera meal capture (`expo-camera`) → downscale → Storage upload → `analyze-meal`.
- Push notifications (`expo-notifications`) — coach nudges / comment pings via the `send-push` fn.
- Haptics, share, secure-store (Keychain session), and **Sign in with Apple**
  (`expo-apple-authentication` → `signInWithIdToken`).

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
