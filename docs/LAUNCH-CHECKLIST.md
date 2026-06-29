# AthleteOS — Launch Checklist (the human to-do list)

**For:** the founder. **Updated:** 2026-06-29.
**The one-line truth:** the code side is in good shape. Everything that still stands between
you and a real closed beta is a *human* step — legal, a couple of vendors, applying database
changes, a real phone, and Apple. Work this list top to bottom; later phases depend on earlier
ones.

This is the single source of truth for go-live. The deeper "why" for any item lives in
`docs/FOUNDER-DECISIONS.md`; the beta plan is `docs/BETA-TEST-PLAN.md`.

---

## What's already done (so you don't redo it)
- Core loop (photo → score → log → tasks), the daily score, onboarding, the role dashboards.
- The two new engines (Restaurant Coach + Accountability) are built, tested, and hidden behind
  one off-by-default switch (your call: prove the loop first).
- **Accounts:** sign-up (email + password) wired into onboarding behind the live flag, sign-in,
  forgot-password, and the Sign in with Apple seam (gated — see Phase 2). The mock/local flow is
  byte-identical until you flip the flag.
- **Settings:** coach/trainer/parent self-profile (edit name + team/practice), athlete
  data-sharing controls (pause-all + remove a viewer, wired into the consent gate), the coach's
  per-athlete targets + scoring editor (via the `coach_set_goals` RPC), and per-event overseer
  alert preferences.
- **Meal library:** logged meals + photos persist (the `meals` table + `meal-photos` bucket),
  with client + coach meal-history views. Needs only the backend flag on.
- Account deletion + guardian-consent database functions written and tested on a throwaway DB.
- The consent gate fails closed: a minor's data cannot sync until a real guardian is verified.
- Email-confirmation default set to ON in the config file.
- Reminders integration wired (waiting only on the phone library + a device).
- 1100+ automated tests passing; the app builds.

### Shipped 2026-06-29 (this session)
- **Guardian "verified" read-back (security G2) — DONE.** Sign-in now hydrates the real
  server-set guardian status, so a verified guardian actually unblocks the minor. Server value
  only; never client-writable to 'verified'. (The Phase 1 list below still names it; it's done.)
- **Auth token encrypted at rest (security L1) — DONE.** The Supabase session moved out of plain
  AsyncStorage into the OS keychain (expo-secure-store), web falls back to AsyncStorage.
- **Under-13 signup barred (COPPA scope) — DONE.** The onboarding age picker floored at 8; now
  floors at 13 (`MIN_SIGNUP_AGE`), so the app does not knowingly collect data from a child under
  13 and COPPA (an under-13 law) is out of scope by construction. The under-18 guardian gate is
  unchanged for 13-17. The code's inaccurate "COPPA" labels were corrected to "minor guardian
  consent." **Open decision for counsel:** confirm the 13-17 parental-consent path (a light
  email-confirmation flow may suffice now that under-13 is barred) and whether to set the floor at 14.
- **AI surfaces (warmer voice, numbers guarded) — DONE & inert.** "Remembered by AI" nutrition
  memory + "AI Restaurant Coach" both reword prose in a warmer voice only when a model is
  configured, with a guard that makes the numbers impossible to change. Dormant until the AI
  endpoint is deployed.

---

## PHASE 0 — Before you switch anything on (legal + vendors)
These gate everything. Do them first.

- [ ] **Lawyer review + host the legal docs.** Have counsel review the drafts in
      `docs/legal/` (Privacy Policy + Terms), get COPPA/FERPA sign-off (you're handling minors'
      health data), and host them at public URLs. The app needs to link to live pages.
- [ ] **Pick a parent-verification (VPC) vendor.** Something that can actually confirm a parent
      is a parent (identity/payment check), not just a checkbox. This is what flips a guardian
      from "pending" to "verified" — until it exists, every minor stays local-only and no coach
      can see their data.
- [ ] **Pick an email sender.** Needed for two things: the guardian approval link, and the
      sign-up confirmation email (you chose to require email confirmation).
- [ ] **Decide the messaging-for-minors question with counsel.** The app already restricts a
      minor to messaging only their own coach/trainer/parent. Before any under-18 user messages,
      a lawyer needs to bless it (mandatory-reporting posture, retention, blocking/reporting).
      Until then, leave messaging off (it already is).
- [ ] **Anthropic data-processing agreement (subprocessor).** Real meal photos of athletes (incl.
      13-17 minors) leave to Anthropic for analysis. Sign a DPA with Anthropic, confirm their
      data-retention terms, and disclose Anthropic as a subprocessor + the retention window in the
      privacy policy. (The §4 "photo sent to Anthropic" framing already matches the code.)
- [ ] **Disordered-eating / health-guidance posture with counsel.** This is a teen nutrition tool.
      The "education, not medical advice" disclaimers are in the UI and the scoring avoids
      good/bad-food framing, but counsel should bless the liability posture for under-18 athletes
      explicitly (it is a sensitive area). Consider tech E&O / general-liability insurance.
- [ ] **Operational data-rights process.** Export + delete are built as in-app buttons, but decide
      WHO answers when a parent emails "delete my child's data" and on what SLA. A monitored inbox +
      a written runbook, not just the button. (`SUPPORT_EMAIL` must be a real, monitored address.)

## PHASE 1 — Turn the backend on (technical, but your hands on the keyboard)
Do these together, in order. Nothing here should touch the live database until Phase 0 is done.

- [ ] **Apply the database changes to the live project, one at a time.** In order:
      `0004` (team create/join code), `0005` (grants), `0007` (account deletion),
      `0008` (guardian consent), `0009` (profiles.org_name), `0010` (subscriptions seam).
      They're written and tested; apply as-written.
- [ ] **Apply the org-membership keystone — `0011` then `0012`** (the enterprise-architecture
      foundation; validated on a throwaway Postgres). `0011` is purely additive (the
      `org_memberships` table + `can_view_via_memberships`, changes no behavior). `0012`
      **backfills** memberships from the team link tables and **swaps `can_view`'s body** to the
      membership model. **Before trusting `0012` on live:** re-run the equivalence check on a
      throwaway DB with a copy of real data — confirm `can_view()` returns the same as the
      legacy `is_team_coach_of` disjunction for a sample of athletes (the check the crew ran on
      seed data). `0012` is teams-only by design; trainers/families get their own backfill when
      they go live. See `docs/architecture/PHASE-A-LOG.md` + `01-data-model-and-org-hierarchy.md`.
- [ ] **Apply the security-audit hardening — `0013`** (after `0012`; validated on a throwaway
      Postgres, 18/18 checks). Locks down direct writes to the `subscriptions`/`org_memberships`
      tables, makes the minor-messaging gate govern both thread parties, keeps trainer/guardian
      view access after the `0012` cutover, and scopes the org-list read. Full write-up in
      `docs/SECURITY-AUDIT-2026-06-29.md`.
- [ ] **Wire "Remove viewer" to a real server revoke (security G1).** Today `removeViewer` only
      edits a local list; once the backend is live a removed coach/guardian would keep `can_view`
      access. Add a `revoke_viewer` RPC that sets the link row's `status <> 'active'` (which
      `can_view` already excludes) and call it from `removeViewer` when live. **Do this before any
      real minor's data syncs** — it's a safety affordance, not cosmetic.
- [x] **Hydrate the guardian `verified` state back (security G2) — DONE 2026-06-29.** Sign-in now
      reads the server-set guardian status back (`db.fetchGuardianRequests` -> `hydrateGuardianConsent`),
      so a server-verified guardian unblocks the minor. Server value only; still fails closed.
- [ ] **In the Supabase dashboard, turn on email confirmation** (the config file is set to ON,
      but the live project needs the same toggle flipped once).
- [ ] **Set the three environment variables and rebuild:** the Supabase URL, the Supabase anon
      key, and `EXPO_PUBLIC_BACKEND_LIVE=true`. This is what actually turns the backend on. It's
      a rebuild, not a server switch — and it doubles as your instant kill-switch (set it back to
      turn everything off).
- [ ] **Wire the guardian-consent verify step.** The database records the request and a token;
      you still need the small endpoint that the parent's email link hits to mark them
      "verified." (Vendor + a short function — flagged in the D12 decision note.)
- [x] **`profiles.org_name` column — written (migration `0009`).** The column, the
      `ProfileRow` type, and `db.updateProfile` now carry `org_name`, and the OverseerProfile
      edit debounce-pushes it. Just apply `0009` with the others above. (One small follow-up left:
      reading it back on a *new* device on sign-in — the write is wired, a profile-fetch hydrate
      is the remaining piece.)
- [ ] **Wire the overseer alert pipeline.** The per-event alert preferences (athlete below the
      line, missed logging, check-in submitted, weekly digest) are stored + editable per overseer;
      connect them to whatever pushes those notifications so they actually fire. The master
      notifications toggle already gates them.
- [ ] **Harden the AI endpoint (security G4).** The `analyze-meal` Edge Function ships open CORS
      (`*`) and no rate limiting. Before it serves real users, restrict CORS to the app origin and
      add per-user rate limiting, so the paid Anthropic endpoint can't be hammered or run up a bill.
      (Also deploy the `memory` + `order` rephrase modes here if you want the warmer AI voice live.)
- [ ] **Smoke-test on a STAGING project first.** Before pointing real coaches at it: apply the
      migrations to a throwaway Supabase project, point a local `.env` at it, flip
      `BACKEND_LIVE=true` locally, and run 2-3 real accounts end to end (sign up, log a meal, coach
      sees it, minor stays gated). Catches "compiled fine but live RLS does something unexpected"
      before a user does. Never test against the real project.

## PHASE 2 — The phone + the App Store
Needs a real device; can't be done in the cloud.

- [ ] **Notifications:** install the notification library (`expo install expo-notifications`),
      grant permission, finish the 5-step wiring in `src/lib/notify/index.ts`, and test that
      reminders actually fire on a real phone. (The app-side plumbing is already done.)
- [ ] **Camera + AI:** test photo capture and meal analysis on a real device (the simulator/web
      can't).
- [ ] **Accessibility pass:** run through with VoiceOver on; confirm labels and contrast.
      See `docs/APP-STORE-READINESS.md`.
- [ ] **Sign in with Apple** (Apple **requires** it because you offer email login — Guideline
      4.8): install the native module (`expo install expo-apple-authentication`), enable the Apple
      Sign-In capability + a Services ID in the Apple Developer portal and `app.json`, then confirm
      the button appears and completes on a real device. The app-side seam
      (`src/lib/auth/apple.ts`) + the Supabase token exchange are already wired and gated — the
      button stays hidden until the module resolves, then lights up automatically with no code
      change.
- [ ] **A demo account for Apple review.** With the backend live + email confirmation on, Apple's
      reviewer can't get past your login, and that is a near-automatic rejection (Guideline 2.1).
      Provide working test credentials (and a verified test guardian/minor pair if a reviewer would
      otherwise hit the consent gate) in App Review notes.
- [ ] **App Privacy "nutrition label" in App Store Connect.** Declare exactly what data you collect
      (health/fitness, photos, identifiers) and that it's used by a minor audience. It must match the
      app's real behavior and the privacy policy; mismatches get flagged for a health/minors app.
- [ ] **Apple submission:** confirm the bundle id (`com.athleteos.app`), set the age rating,
      prepare screenshots, and make sure the in-app account deletion is reachable (Apple
      requires it — the function is built). Submit for review.

## PHASE 2.5 — Production readiness (don't fly blind)
Cheap to set up, painful to be missing the first time something breaks for a real coach.

- [ ] **Crash + error monitoring.** There is deliberately no analytics/tracking SDK (good for
      privacy), which also means zero visibility into production errors. Add one privacy-respecting
      error monitor (e.g. Sentry) configured to scrub PII, so you actually find out when the app
      breaks in the field instead of hearing it from a coach.
- [ ] **Backup / recovery confidence.** Confirm the live Supabase project's backup cadence +
      retention is something you'd accept losing, and that you know the restore steps. Do this
      before real data exists, not after you need it.
- [ ] **Backend monitoring.** Watch Supabase usage + Edge Function error rates + the Anthropic
      spend, with an alert if any spikes (ties to the G4 rate-limit item).

## PHASE 3 — Run the actual beta (the real unlock)
- [ ] **Recruit 3–5 coaches** and their athletes. This is the point of all of the above.
- [ ] **Run the plan in `docs/BETA-TEST-PLAN.md`** and watch whether the core loop sticks.

---

## Subscriptions (deferred to post-beta — the seam is built, not the billing)
The entitlement plumbing is in and inert: every account reads "Free preview" until a
real plan exists. The model is **coach/org pays per athlete** (B2B per-seat). When
you're ready to charge (after the loop is validated):
- [ ] **Apply migration `0010` (subscriptions table).** Written + tested; apply with the others.
- [ ] **Set up Stripe** (per-seat product/prices), a Checkout/Billing-Portal link for coaches,
      and a webhook (service_role Edge Function) that upserts the `subscriptions` row on
      `customer.subscription.*` events. This is what flips an account from preview to a paid plan.
- [ ] **Add a "Manage plan" CTA** in Account that opens the coach's Stripe Billing Portal (a
      hosted URL — no in-app payment UI needed for B2B, so no Apple 30%).
- [ ] **Resolve an athlete's seat** from their coach's plan (an RPC/view over team membership)
      so seats are enforced. Gate any paid-only feature behind `isPro(entitlement)`.
- [ ] *(Optional later)* a direct consumer plan would need Apple/Google IAP via RevenueCat,
      with a webhook writing the same `subscriptions` shape. See
      `docs/specs/2026-06-29-subscriptions.md`.

## Decisions you can make any time (not blockers)
- [ ] **Flip the engines on when ready.** Once the core loop is validated, set
      `EXPO_PUBLIC_ENGINES_ENABLED=true` and rebuild to reveal the Restaurant Coach + the
      plan/accountability surfaces. No code change needed.
- [ ] **Turn messaging on** (after the Phase 0 legal review) by enabling delivery at go-live.
- [ ] **Revisit the "later" calls** when you have signal: a fuller food database, PR cloud sync,
      wearable data in the score, the D9 items (parent "last synced", non-athlete scoring).

---

## The honest bottom line
The crew has taken the code as far as it usefully can without real users. The next real
progress is **athletes actually using the loop** — and that's gated by Phase 0, which only you
can start. Get the lawyer and the two vendors moving; everything else falls into place behind
them.
