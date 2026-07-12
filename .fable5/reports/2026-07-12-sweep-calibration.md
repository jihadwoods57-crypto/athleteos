# Pass-2 Sweep — Calibration Gate (Audit / Opus)

Date: 2026-07-12 · Branch: `fable5/2026-07-12-founder-worklist`
Shipped UI under audit: `proto/redesign-2026-07/js/screens/*` (src/screens is LEGACY, untouched).

Context honored (SETTLED, not re-litigated): grace-calibrated streak urgency; `{error:true}` offline
sentinel over catch-around-loader; never render a control that persists nothing; router wires
`[data-go]`/`[data-act]` once at render (mount-injected nodes self-wire); `.chp`/`.wb2`/`.c5` CSS
scoping traps. Pass-1 closed all 30 ledger rows (one improvement each). This run built T1/T2 (camera
integrity) + T4 (profile avatar) and designed T3 (home score-box) + T5 (notifications). This gate ranks
the NEXT pick for the founder's per-screen gap sweep and tears down #1.

---

## 1. Ranked screens for pass 2 (user impact, adjusted for in-flight work)

Ranked by remaining user impact given what pass 1 and this run's T1–T5 already captured. Coverage.md's
ranked pass-2 backlog is folded in. `index.js` (route registry) and `states.js` (dev-only gallery, no
`data-go` anywhere) are not shipping surfaces — listed last, excluded from work.

| # | Screen | One-line reason (pass-2 impact) |
|---|--------|--------------------------------|
| 1 | **plan.js** | Daily coach-set reference; offline/loading false-negative tells athletes "coach set no targets" — data-honesty defect on a trust-first product; pass 1 only bumped tab height. TOP backlog item. |
| 2 | progress.js | Retention/trend surface; `.bigstat .d` hardcodes green (screens.css:180) so a negative week renders success-green — number honesty. |
| 3 | recovery.js | 25% of score, daily; pass 1 only sized chips — projection/feedback surface unexamined for pass 2. |
| 4 | meal.js | Nutrition detail; thread-comment load has no failure state (unguarded refresh → "Loading the thread…" forever on a throw). |
| 5 | log.js | Action Hub write surface; every +8/+16 water tap replays the 320ms sheet-entrance + scroll reset — perceived-speed regression. |
| 6 | breakdown.js | "logging streak reset" copy shows all day before the weigh-in window passes (boolean-driven, not time-aware). |
| 7 | home.js | Highest daily weight, but the score-box gap is already designed (T3, awaiting build); residual = evening all-overdue NEXT/LATER-vs-OVERDUE hierarchy contradiction. |
| 8 | camera.js | Core log verb; T1/T2 shipped this run; residual = `.vf-tool` + back button at 40px, under the 44px floor. |
| 9 | notifications.js | Accountability feed; T5 redesign designed this run; residual = dead "Earlier today" branch (founder delete-flag). |
| 10 | weight.js | Trend log; pass 1 made the late-label time-honest; low residual. |
| 11 | checkin.js | Weekly; real "Latest readiness" card renders below the now-inert preview form (rearrange). |
| 12 | foodsearch.js | No-camera log path; pass 1 fixed steppers + Clear; low residual. |
| 13 | requirement.js | Single-req detail; pass 1 added the unknown-id empty state; low residual. |
| 14 | trust.js | Trust Pass; pass 1 fixed the next-check + YOU-dot derivations; low residual. |
| 15 | profile.js | Identity hub; T4 (avatar) shipped this run; low residual. |
| 16 | coach.js | Buyer dashboards (coach/trainer/parent roots); pass 1 fixed offline honesty + parent exit; residual is roadmap-locked build, founder-gated — not polish. |
| 17 | roles.js | Role / Practice HQ screens; pass 1 fixed coachProfile copy-code; low residual. |
| 18 | guardian.js | Minor-athlete consent; pass 1 added same-parent remind; low residual. |
| 19 | connect.js | Coach/practice linking; pass 1 fixed offline preflight + aria; low residual. |
| 20 | settings.js | Settings + notifSettings; pass 1 fixed quiet-hours honesty + 44px seg; low residual. |
| 21 | onboarding.js | First-run; pass 1 swept 44px chrome; low residual. |
| 22 | ob-account.js | Account step; pass 1 added aria + keyboard pw-eye; low residual. |
| 23 | signin.js | Sign-in; pass 1 added aria + Enter-submit; low residual. |
| 24 | reset.js | Password reset; pass 1 fixed the stuck-disabled resend; low residual. |
| 25 | bio-optin.js | Bio opt-in; pass 1 gave "Not now" a 44px floor; low residual. |
| 26 | features.js | Feature tour; pass 1 killed the deceptive coachVoice toggle; low residual. |
| 27 | auth.js | Welcome shell; audited clean in pass 1 — two correctly-wired CTAs, nothing to add. |
| — | states.js | Dev-only design gallery, no `data-go` link anywhere — not user-reachable. Exclude. |
| — | index.js | Route registry (30 → screen map), not a screen. Exclude. |

---

## 2. Full teardown — #1 · plan.js

Why #1: Plan is the daily reference an athlete opens to see what their coach set. It is the single
highest-impact surface carrying an *unaddressed* defect — the top-ranked coverage.md backlog item — and
pass 1 only raised its tab height (screens.css:253). Every item below is grounded in current code.

### ADD — missing states / affordances / feedback

- **A1 · Offline/loading false-negative (TOP — data honesty).** `S.planTargets` (state.js:976–982)
  reads only `RT.profile.targets` and returns `null` identically for three distinct realities: coach set
  nothing, profile still hydrating, and an offline/failed profile fetch. Plan then asserts the null case
  *definitively*: overview body "Your coach hasn't set targets yet" (plan.js:44–47), Coach-Targets
  footnote "No targets set yet — your coach can add them any time" (:62), Nutrition eyebrow "· not set
  yet" (:74), and `targetsRow()` renders three "—" dashes (:31–33). An offline athlete **who has real
  coach targets** is told their coach set none — a trust-breaking lie on a trust-first product. Fix:
  resolve `null` into three honest states using the SETTLED `{error:true}` / a `profileLoading` sentinel
  (mirror fetchMyPracticeIdentity): hydrating → skeleton, offline → "Can't reach your plan — targets will
  show when you reconnect", genuine → the existing "not set yet". (RT/state plumbing is in scope as
  presentation-supporting; DATA-INTEGRITY: read-only, never fabricate a target.)
- **A2 · Notes thread has no load/error state.** `notes()` renders `P.notes` synchronously (:148–155)
  with only an empty-state (:145). A real plan-update thread fetch that throws or is offline has no
  loading skeleton and no error/retry — same gap class as meal #2. Add loading + failure affordances.
- **A3 · "Ask AI" composer has no pending/failure feedback.** `mount()` wires the composer only on the
  notes sub and injects a canned reply (plan.js:170–175 → settings.wireComposer). A send has no pending
  spinner and no failure state. If/when this calls a real AI endpoint it needs both. FOUNDER-GATED if it
  touches the AI backend — flag, don't wire.

### UPGRADE — weak a11y / clarity / redundancy

- **U1 · Notes composer a11y (shared wireComposer pattern — backlog plan #4).** Send control is an
  icon-only `<div class="send">` (plan.js:159): 48px visually (screens.css:148) but no `role="button"`,
  no accessible name, not keyboard-operable — invisible to assistive tech. The input (:158) is
  placeholder-only with no accessible name — the exact defect class swept across signin/reset/ob-account
  in pass 1, left unaddressed here. Give both accessible names + make send a real 44px button.
- **U2 · Duplicated macro data on overview.** Protein target renders twice — Plan-Summary tile (:56)
  and Coach-Targets `targetsRow` (:61); goal/target/current weight also echo between head pill (:23),
  tiles (:53–55). Reads as filler. Consolidate to one authoritative targets block.
- **U3 · Schedule row affordances under the 44px floor.** Requirement rows are full-width tap targets
  (`data-go`, :109 / :125) but their `req-icon` is 40px (:111, :127) and the chevron sits at 16px — the
  visible affordance is below floor even though the row itself clears it (same class as camera #2).
- **U4 · Competing dual CTAs.** "Ask Coach" (ghost → messages, :67) and "Ask AI" (primary → plan/notes,
  :68) sit side-by-side with inverted visual weight; the AI path is a canned stub. Clarify which is
  primary and make the AI affordance honest about being a preview until wired.

### REARRANGE — IA / flow

- **R1 · Targets should lead when set.** Overview order is Objective → Plan Summary → Coach Targets →
  Ask (plan.js:37–70); the real coach targets — the reason the athlete opened Plan — sit third (:59–63)
  under a generic objective card. When `planTargets` is present, surface targets first.
- **R2 · Two AI entry points.** "Ask about this nutrition plan" (nutrition tab, :99) duplicates
  overview's "Ask AI" (:68); both route to plan/notes. Collapse to one canonical AI entry.

### DELETE — clutter / placeholder (flag functionality drops for founder)

- **D1 · "Build Your Plate" + "Approved Swaps" (FOUNDER-GATED).** Both render from `P.plate` / `P.swaps`
  = static `S.plan` seed (plan.js:78–89), not coach-personalized — yet the Schedule tab frames the plan
  as "the rules, set by {coach}" (:103), so this static catalog reads as coach-authored guidance it is
  not. Founder call: keep and explicitly label as general guidance, or remove. Do NOT silently drop —
  flag for review.
- **D2 · Redundant Coach-Targets footnote.** The "Set by your coach…"/"No targets set yet" line (:62)
  restates what `targetsRow` dashes + Plan Summary already convey; merge-candidate, minor.

### Notes for the builder
- Tabs already clear 44px (screens.css:253, pass 1) — do not re-touch.
- `messages` route exists (index.js:62) — "Ask Coach" is correctly wired; leave it.
- A1 is the headline. It is a DATA-HONESTY fix on read-only presentation state; hold the SETTLED sentinel
  pattern and never invent a target value.
