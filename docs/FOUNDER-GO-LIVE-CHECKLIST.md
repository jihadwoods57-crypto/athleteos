# Founder Go-Live Checklist — AthleteOS

**For:** Bo, in order. **Updated:** 2026-06-30. This is the human action list. The *technical* detail for the
backend steps lives in [`docs/RUNBOOK-go-live.md`](RUNBOOK-go-live.md); the full item list in
[`docs/LAUNCH-CHECKLIST.md`](LAUNCH-CHECKLIST.md). This page just orders it so you can work top to bottom.

**Where the code stands:** the app is in good shape (goal-adaptation done for all four goals, day-0 honesty,
first-run fixes, all tests green on `claude/crew-update-wvkvhh`). What's left is mostly *your* decisions + ops.
Already decided, off your list: **pricing** (blessed + seeded) and **email confirmation = ON** (screen built).

---

## Track A — Start now (these have lead time; run them in parallel)

- [ ] **Lawyer:** review + host the Privacy Policy and Terms. Fill the blanks (legal entity name + address,
      data-retention windows, effective date, governing law). Host at `athleteos.app/privacy` and `/terms`.
- [ ] **Sign the Anthropic DPA** and disclose Anthropic as a subprocessor (needed before any AI on real data).
- [ ] **Pick a parent-verification (VPC) vendor.** Until this exists, every minor (13–17) stays local-only.
- [ ] **Pick an email sender / SMTP** (Resend is the doc's recommendation) for sign-up confirmation + the
      guardian-approval link.
- [ ] **RD / sports-science sign-off** on (a) the score-weight rails and (b) the new goal-derived target
      numbers (lose/gain/maintain calories + protein). They're sensible defaults but flagged "pending RD."

## Track B — Stand up the backend (staging first — the biggest unlock)

Follow [`RUNBOOK-go-live.md`](RUNBOOK-go-live.md) Section A. Summary:

- [ ] Install the Supabase CLI; create a throwaway **`athleteos-staging`** project.
- [ ] Apply migrations **`0004 → 0013`** in order (`supabase db push`).
- [ ] Run the **`0012` `can_view` equivalence check** on representative data — must return **0 differing rows**.
- [ ] Run the **5 smoke tests:** sign up → log a meal → coach sees the athlete → a minor stays gated until
      verified → remove-viewer actually revokes access.
- [x] **`revoke_viewer` RPC (G1) — DONE + validated (2026-06-30).** Written as
      `supabase/migrations/0014_revoke_viewer.sql`, validated on a throwaway Postgres
      (`supabase/tests/revoke_viewer_test.sql`, all green), client half already wired. On staging it
      applies as part of the `0004→0014` sequence; confirm via the A7 smoke-test (remove-viewer revokes).

## Track C — Wire the endpoints + dashboard toggles (live project)

- [ ] Dashboard → **Email confirmation ON** + configure **custom SMTP** (the vendor from Track A) + send
      yourself a test confirmation that actually arrives.
- [ ] Deploy the **`guardian-verify`** function + set its vendor secret.
- [ ] Deploy **`analyze-meal`** with the live `ANTHROPIC_API_KEY` (CORS + rate-limit hardening already in).
- [ ] **Decide: AI on at launch, or later?** (You can ship the data backend without AI.)

## Track D — Go live (the flip)

- [ ] Confirm the RUNBOOK **pre-flight checklist (Section F1)** is all green.
- [ ] Set the three env vars on the **live** project (URL, anon key, `EXPO_PUBLIC_BACKEND_LIVE=true`) + rebuild.
- [ ] **Kill switch:** anything misbehaves → set `BACKEND_LIVE=false` + rebuild = instant revert to local mode.

## Track E — App Store (parallel, longest lead)

- [ ] Apple Developer enrollment; replace the placeholder bundle id (`com.athleteos.app`).
- [ ] Add **Sign in with Apple** (required because you offer email login).
- [ ] App Privacy "nutrition" label, age rating, screenshots, a demo account for review, submit.

## Track F — Beta

- [ ] Recruit 3–5 performance facilities / coaches + their athletes (the ratified wedge).
- [ ] Run [`docs/BETA-TEST-PLAN.md`](BETA-TEST-PLAN.md).

---

## What I (Claude) build the moment you flip each switch
- **Staging up** → `revoke_viewer` validated; Meal Review; real coach metrics; readiness-to-coach; parent live link.
- **AI endpoint on** → real coaching voice (deterministic fallback stops being the ceiling).
- **Stripe account** → finish the live checkout (the compliant disclosure screen already exists).
- **No switch needed (can do today):** the Stripe checkout *seam* (inert until your keys exist).

**The one move that unlocks the most:** standing up **staging** (Track B). It turns half a dozen backend-gated
items into buildable work in one session.
