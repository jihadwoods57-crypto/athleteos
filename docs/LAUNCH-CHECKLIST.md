# AthleteOS — Launch Checklist (the human to-do list)

**For:** the founder. **Updated:** 2026-06-28.
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
- Account deletion + guardian-consent database functions written and tested on a throwaway DB.
- The consent gate fails closed: a minor's data cannot sync until a real guardian is verified.
- Email-confirmation default set to ON in the config file.
- Reminders integration wired (waiting only on the phone library + a device).
- 870+ automated tests passing; the app builds.

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

## PHASE 1 — Turn the backend on (technical, but your hands on the keyboard)
Do these together, in order. Nothing here should touch the live database until Phase 0 is done.

- [ ] **Apply the database changes to the live project, one at a time.** In order:
      `0004` (team create/join code), `0005` (grants), `0007` (account deletion),
      `0008` (guardian consent). They're written and tested; apply as-written.
- [ ] **In the Supabase dashboard, turn on email confirmation** (the config file is set to ON,
      but the live project needs the same toggle flipped once).
- [ ] **Set the three environment variables and rebuild:** the Supabase URL, the Supabase anon
      key, and `EXPO_PUBLIC_BACKEND_LIVE=true`. This is what actually turns the backend on. It's
      a rebuild, not a server switch — and it doubles as your instant kill-switch (set it back to
      turn everything off).
- [ ] **Wire the guardian-consent verify step.** The database records the request and a token;
      you still need the small endpoint that the parent's email link hits to mark them
      "verified." (Vendor + a short function — flagged in the D12 decision note.)

## PHASE 2 — The phone + the App Store
Needs a real device; can't be done in the cloud.

- [ ] **Notifications:** install the notification library (`expo install expo-notifications`),
      grant permission, finish the 5-step wiring in `src/lib/notify/index.ts`, and test that
      reminders actually fire on a real phone. (The app-side plumbing is already done.)
- [ ] **Camera + AI:** test photo capture and meal analysis on a real device (the simulator/web
      can't).
- [ ] **Accessibility pass:** run through with VoiceOver on; confirm labels and contrast.
      See `docs/APP-STORE-READINESS.md`.
- [ ] **Apple submission:** confirm the bundle id (`com.athleteos.app`), set the age rating,
      prepare screenshots, and make sure the in-app account deletion is reachable (Apple
      requires it — the function is built). Submit for review.

## PHASE 3 — Run the actual beta (the real unlock)
- [ ] **Recruit 3–5 coaches** and their athletes. This is the point of all of the above.
- [ ] **Run the plan in `docs/BETA-TEST-PLAN.md`** and watch whether the core loop sticks.

---

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
