# OnStandard Redesign Prototype — Build Notes

Serve: any static server from this directory (dev: `npx http-server -p 8124 -c-1`).
Entry: `index.html` → `#home`. Reset the demo day from Profile → Prototype controls.

## What this artifact is
A fully **interactive** design prototype of the athlete app. It is not wired to the
backend, but it is *stateful*: logging dinner really moves the score 82 → 88, the
recovery check-in takes it to 94 and promotes the tier to OnStandard, the streak,
notifications, requirement rows, activity trail, and Finish Today all update live,
and everything persists in localStorage until you reset. One `computeScore()` in
`js/state.js` feeds every screen, so numbers can never disagree.

## Decisions that override the product brief (on purpose)
1. **Score model** stays the shipped honest engine (`src/core/scoring.ts`):
   Nutrition 50% / Recovery 25% / Commitment 15% / Weekly check-in 10% — not the
   brief's 45/25/15/10/5 pools. Weight is a season trend, never daily points.
   The brief's **tier names were adopted**: Off Standard 0–59 · Building 60–74 ·
   Locked In 75–89 · OnStandard 90–100.
2. **Navigation** stays the locked 5 tabs (Home / Plan / Camera / Progress /
   Profile). The brief's "Team" tab lives inside Profile for athletes; coaches get
   the dedicated Coach view (`#coach`).
3. No confetti anywhere; the reward language is glow, score movement, tier chips.

## The 28-point checklist → where each item stands

| # | Brief item | Status |
|---|---|---|
| 1 | Core loop | **BUILT + LIVE** — open → see 82 → log → 88 → recovery → 94 OnStandard |
| 2 | Navigation | **BUILT** — 5 tabs, camera FAB opens quick-log sheet |
| 3 | Onboarding | **BUILT** — `#welcome` → 6 steps → "Your Standard is set" → Day 1 empty state |
| 4 | Today page | **BUILT** — ring + tier, requirements, next-action CTA, Finish Today |
| 5 | Requirements engine | **DESIGNED** here (rows/schedule/proof types); real engine is the RN backlog (`core/projection.ts` is hardcoded today) |
| 6 | Camera logging | **BUILT** — viewfinder, deadline chip, gallery/search/label, retake |
| 7 | AI meal analysis | **BUILT** — foods, component read (protein/carb/micros/portion), plan match, score-change line; mirrors `analyze-meal` edge fn |
| 8 | Log confirmation | **BUILT + LIVE** — animated score move, next remaining, Log Next |
| 9 | Scoring system | **BUILT + LIVE** — honest weights, tiers, instant update, Breakdown explains it |
| 10 | Progress page | **BUILT** — trend, 30-day, best streak, consistency, pattern, lost points, weekly summary, coach + AI feedback |
| 11 | Coach dashboard | **BUILT** — team avg, R/Y/G roster, needs-attention, athlete review + comment, assign/plan/Copilot tools (RN has Copilot already) |
| 12 | Role visibility | **BUILT** — Coach view, Parent view (privacy-scoped), roles noted for trainer/nutritionist |
| 13 | Meal plan system | **BUILT (design)** — Plan tabs + plan-match verdicts; RN Meal Plans feature exists behind `isMealPlansEnabled` |
| 14 | Notifications | **BUILT + LIVE** — graded urgency, specific copy, badge clears on read, list reacts to logging |
| 15 | Empty states | **BUILT** — Day-0 Home + states gallery (`#states`) |
| 16 | Loading states | **BUILT** — branded analyzing interstitial ("Checking meal quality…") |
| 17 | Error states | **BUILT (gallery)** — upload-failed / AI-failed / offline patterns with next steps |
| 18 | Authentication | **DESIGNED** — `#welcome` entry; real auth exists in the RN app (Supabase) |
| 19 | Profile & settings | **BUILT** — identity, coach connection, squad, accountability, settings, billing row |
| 20 | Design system | **BUILT** — tokens.css; color = meaning (green/amber/blue/purple/red) |
| 21 | Component library | **BUILT** — ring, req rows, act cards, chips, sheets, notifs, roster rows (`components.js` + CSS) |
| 22 | Data model | **EXISTS in RN app** (Supabase migrations 0001–0040); proto mirrors its shapes |
| 23 | Admin tools | **BACKEND BACKLOG** — not a proto concern |
| 24 | Payments | **SEAM EXISTS in RN** (inert Stripe checkout); proto shows Plan & billing row |
| 25 | Privacy/permissions | **DESIGNED** — parent scoping, photos-private-by-default, consent flows exist in RN (0038) |
| 26 | Analytics | **BACKEND BACKLOG** |
| 27 | App Store readiness | **RN-app work** (EAS build already on the launch list) |
| 28 | Polish details | **BUILT** — ring draw, count-ups, pop-in check, sheet slide, tier promotion, no dead buttons (31 routes verified) |

## Verification (2026-07-04, final pass)
- All **48 routes** render, zero console errors, automated dead-button sweep clean.
- Live-loop: 82 Locked In → dinner → 88 → recovery → **94 OnStandard**; breakdown sums
  equal the score at every state; reset returns to 82.
- Round-trips proven in-browser: coach assigns (template or custom) → athlete Home +
  notification → complete → coach sees; coach publishes plan update → athlete Plan·Notes +
  notification; coach comment → athlete meal thread; hydration 120 oz → payoff + notification.
- Food search: plate math correct (2× chicken = 62g protein); label scan: serving
  multiplier correct (2 servings = 280 cal).
- Em-dash-free UI copy; real photography; honest clock (7:12 matches windows); composers
  never fabricate a human reply.

## Complete route map (48)
Athlete: home, score-breakdown, plan×4, camera, analyzing, meal-analysis, meal-confirm,
meal-detail(+/dinner), food-search, label-scan, weight, recovery(+confirm), checkin,
progress, history, streak, trust, requirement/<id>, log (quick sheet), notifications,
messages, profile, connect, settings, privacy, billing, welcome, onboarding×6, states.
Roles: coach, coach-athlete, coach-assign, coach-plan, copilot, trainer, trainer-client, parent.

## Port-to-RN map (when Bo says go)
- `state.js` getters → the existing `computeDerived()`/store; tiers are a pure add.
- Screens map 1:1 onto existing RN screens (see traceability table in the plan file);
  net-new RN screens: Score Breakdown, Plan tabs, daily Recovery, quick-log sheet,
  generic requirements engine.

## 2026-07-09 — Onboarding overhaul (spec: docs/superpowers/specs/2026-07-09-onboarding-overhaul-design.md)
Athlete onboarding rebuilt as an adaptive 7-step wizard (identity + DOB with under-13
block → school/coach discovery → sport → goal → baseline → adaptive standard with
hold-to-commit → hardened account), coach/trainer onboarding made real (org + team +
join code), and a light client flow on the same pattern. New modules:
- `js/ob-helpers.js` — pure helpers (DOB/age validation, password strength, goal→standard), unit-tested from `src/core`.
- `js/ob-directory.js` — anonymous directory client for the `org-directory` edge function (search/teams/practices/preview_code), always degrades to code-entry/skip.
- `js/ob-commit.js` — hold-to-commit button (1200ms press with fill sweep; reduced-motion falls back to tap).
- `js/screens/ob-account.js` — shared account-creation step (email + password + confirm + strength meter + terms line) reused by all four flows.
- `js/screens/bio-optin.js` — post-signup Face ID opt-in sheet.
Two gated seams stay inert until the native shell reports availability: **Sign in with
Apple** (`OnStandardNative.apple`) and **biometric app-unlock** (`OnStandardNative.biometrics`).
Verified 2026-07-09: full flow QA in-browser (back/forward retention, under-13 block,
skip paths, code vs solo step 6, hold-to-commit gating, password gate, terms detour);
directory-offline fallbacks and "Code pending" states confirmed — never a dead end.
