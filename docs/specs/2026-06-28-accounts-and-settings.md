# Spec — Accounts & Settings Upgrade

**Date:** 2026-06-28
**Status:** Phases 1–5 BUILT (gated; verify-green)

## Go-live follow-ups (need the founder's machine / Apple portal / a migration)
- **Apple Sign-In:** add `expo-apple-authentication`, the Apple Sign-In capability,
  and a Services ID (app.json + Apple Developer portal). The seam + button are wired
  and gated; they light up once the native module resolves. (src/lib/auth/apple.ts)
- **Org name persistence:** add an `org_name` column to `profiles` (or write a team
  row) so the overseer's edited org/practice name syncs; it's local-display today.
- **Overseer alert delivery:** the per-event prefs are stored + edited; wire them to
  the backend alert pipeline that pushes the notifications at go-live.
**Owner:** founder (jihadwoods57)

Closes the gaps the profile/auth audit surfaced. Two buckets: **(1) the
sign-in / sign-up system** (the actual go-live blocker — there is currently *no*
way to create an account), and **(2) the "what could be upgraded" settings work**
across every role. Everything stays behind `isBackendLive` so the flag-OFF beta is
byte-identical until the founder flips it; `src/core` stays pure; `verify` green at
every commit.

## Guiding rules (unchanged all session)
- `isBackendLive` (not `isSupabaseConfigured`) gates every real-data path; flag-OFF
  keeps today's local/mock behaviour exactly.
- `src/core` is pure TS — no RN, no Supabase. Backend code lives in `src/lib` /
  `src/store`.
- Consent fails closed; no fabricated data on any surface; honest empty states.
- Never commit `EXPO_PUBLIC_BACKEND_LIVE=true`; never push migrations to live.

---

## Phase 1 — Sign in / Sign up (the blocker)

**Problem:** onboarding collects a name + habits but never an email or password;
`signUpLive` exists in the store but nothing calls it. The moment the backend goes
live, a new user hits a dead end. Sign-in ignores its fields when the flag is off.

**Build:**
1. **Account-creation step** — a new onboarding step (email + password + confirm),
   inserted **only when `isBackendLive`** (mirrors how the consent step is inserted
   via `athleteFlowKeys(backendLive)`), placed right before activation for the
   athlete flow and before the invite for the overseer flows. Wires to the existing
   `signUpLive(email, password, fullName)`. Flag-OFF: not inserted → onboarding
   byte-identical to today.
2. **Email-verification state** — after sign-up, a "check your inbox to confirm"
   panel (their Supabase project has email-confirmation ON). Account stays usable
   locally; sync waits on confirmation + consent.
3. **Forgot password** — `auth.resetPassword(email)` wrapper + `resetPassword`
   store action + a "Forgot password?" link on Sign-In → a reset-request screen
   with an honest "email sent" confirmation. Inert without backend.
4. **Sign in with Apple** — gated `AppleSignInButton` + `signInWithApple` store/
   auth scaffold. **NOTE:** real Apple OAuth needs native entitlements
   (`expo-apple-authentication`) + an Apple Developer service id that can only be
   configured on the founder's machine + Apple portal — it cannot be built or
   runtime-verified in this environment. Shipped as a gated, clearly-marked stub
   with a GO-LIVE checklist item; the button only renders on iOS when live.
5. **Validation** — pure `validateCredentials(email, password)` in `src/core`
   (email shape, password ≥ 8 incl. a letter+number) driving inline field errors.

**Tests:** core credential validation; store sign-up/sign-in/reset gating
(flag-OFF inert, flag-ON routes through wrappers, fails closed).

---

## Phase 2 — Coach / Trainer / Parent self-profile (upgrade)

**Problem:** these four roles can't edit their own name, org/school, or team title
after onboarding — identity is frozen and only *displayed* in Account.

**Build:** an `OverseerProfile` overlay (entry from each role-view header avatar/menu
and from Account), editing:
- display name, org/team/program title, role-appropriate subtitle;
- a read-only roster/client count + join/team code (with copy);
- the same notification + units controls the athlete has (shared section).
Store actions `setDisplayName`, `setOrgTitle` persist locally; when live they push
to the `profiles` / team row (scaffolded query, gated). Honest "synced / on this
device" labeling.

---

## Phase 3 — Athlete data-sharing controls (upgrade)

**Problem:** the Profile "Who can see your data" panel is read-only; an athlete
can't revoke or pause a viewer — table stakes for a privacy surface.

**Build:** make each viewer row actionable — **pause** (temporarily stop sharing)
and **remove** (revoke a link). New state `sharingPaused: boolean` +
`revokedViewers`. A master "Pause all sharing" toggle. When live these call a gated
`setSharing` / `revokeLink` RPC seam; locally they update the panel + are reflected
in the consent context. No data leaves the device while paused.

---

## Phase 4 — Per-athlete coach scoring & targets (upgrade)

**Problem:** the Constitution says the coach owns each athlete's targets + scoring
profile, but there's no mobile UI — only the team check-in toggles exist.

**Build:** an editor sheet in `PersonDetail` (coach/trainer): set this athlete's
protein/calorie/weight targets + scoring profile (`athlete` | `general`), with the
AI's science-based recommendation shown as a suggestion (recommends, doesn't
dictate — Rule #13). Wires to the existing `db.coachSetGoals(athleteId, targets,
seasonGoal)` RPC, gated. Demo shows the editor with the sample athlete's values and
a "connect to push" note.

---

## Phase 5 — Overseer notification granularity (upgrade)

**Problem:** coaches/trainers/parents get a single on/off; no per-event control.

**Build:** extend `reminderSettings` (or a sibling `overseerAlerts`) with
per-event prefs (athlete fell below the line, missed logging, check-in ready,
weekly digest). Surfaced in the OverseerProfile (Phase 2) settings section. Pure
defaults in `src/core`; scheduling stays behind the existing notify seam.

---

## Sequencing & integration

Phases land in order, each its own commit with green `verify`. Phase 1 first
(it's the only *functional* hole; the rest are upgrades). The shared foundation
(new `AppState` fields + store actions + `src/core` validators) goes in with the
phase that first needs it, so there's never a half-wired field. Apple Sign-In and
the live `profiles`/RPC writes are scaffolded + gated here and finished at go-live
(GO-LIVE-NOW.md / LAUNCH-CHECKLIST.md updated).
