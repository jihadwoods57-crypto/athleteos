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

## 2026-07-09 — Execution loop (spec: docs/superpowers/specs/2026-07-09-execution-loop-design.md)
Daily execution rebuilt around one pure state machine so Home, the Action Hub, the FAB
badge, and native notifications can never disagree:
- `js/exec.js` — new pure execution engine (`deriveExec`), no DOM/state/Date calls (the
  clock is an argument). Per-item 4-state machine (locked → ready → due_soon → overdue →
  done/done_late), NOW/NEXT/LATER/DONE grouping (overdue-first, optional items never NOW
  while a required item is open), day progress + celebration flag, and a pressure-scaled
  notification plan (`gentle` / `accountable` / `max`).
- **Home** (`js/screens/home.js`) redesigned execution-first: compact score strip, red
  overdue pins ("still counts, log it late"), a dominant NOW card with live countdown and
  a proof-aware CTA verb (photo→Log, form→Complete, scale→Log, counter→Add), collapsed
  Next/Later/Done groups, and a celebration flip (full ring hero + "Today's record") when
  every required item is in. A 30s tick re-derives `S.exec` and repaints only on change,
  covering live countdowns, state transitions, and day rollover.
- **Action Hub** (`js/screens/log.js`) rebuilt as an execution dashboard reading the same
  `S.exec`: progress header, NOW hero (red when overdue), Quick Logs (water +8/+16,
  weight trend-only), Recovery Check-In, Weekly Check-In (Sunday-only), a folded Done
  line, and its own celebration panel.
- **FAB dot** (`js/router.js` tabbar): status dot on the camera FAB — gold when anything
  is actionable, red when anything is overdue, absent once the day is complete. Reads the
  same `S.exec` at render time; the camera glyph itself never changes.
- **State-driven notifications**: `NOTIFY_SYNC` bridge message (`src/proto/bridge.ts`) +
  native scheduling seam (`src/lib/notify/execSync.ts`) — cancel-then-schedule against the
  engine's plan, fired on boot, every completion action, pressure changes, and day
  rollover; skipped when the plan is unchanged (`samePlan`) so completions auto-cancel
  their own reminders with zero redundant churn. The legacy static path (`initReminders()`
  in `src/store/useStore.ts` / `src/screens/athlete/AthleteApp.tsx`) no longer schedules
  for athlete sessions, so the two systems can never double-fire.
- `S.notifications` (`js/state.js`) now reads the same `S.exec` (overdue/now/next +
  celebration), so the in-app bell always agrees with Home/Hub/OS notifications.

Verified 2026-07-09: browser QA via Playwright MCP against `proto/redesign-2026-07`
served locally — overdue pins + red NOW card + red FAB dot (real evening clock made every
meal overdue, exercising that path for free), logging via `__act.logMeal` promotes
NEXT → NOW on re-render, Action Hub progress header / NOW hero / water +8+16 / weekly
Sunday-only gating (verified both ways by stubbing `Date.prototype.getDay`), celebration
flip on both Home and the Hub once all required items are in (meals + recovery; weight
correctly excluded on a non-M/W/F day), CTA verb mapping confirmed for `photo` ("Log
Breakfast late") and `form` ("Complete Recovery Check-In"), in-app bell matches
`S.exec`-driven state. **Fixed one real defect found in QA**: `scoreRing()`'s inner echo
ring radius (`r - stroke/2 - 8`) went negative for the new compact 52px strip ring,
emitting an invalid SVG `r="-2"` and a console error on every Home render; clamped to
`Math.max(0, …)` in `js/components.js`.

## 2026-07-10 — Meal intelligence (spec: docs/superpowers/specs/2026-07-09-meal-intelligence-design.md)
The meal surface grew a real Team Discussion on top of the existing honest breakdown:
- `js/meal-intel.js` — new pure helpers: confidence-chip normalization (legacy string
  arrays and rich `{name, confidence}` arrays both settle to rich, unknown confidence
  defaults `high`), the derived AI opening line (`openingMessage`, never stored — built
  fresh from the meal/exec/goal each render so it can't drift from what's on screen),
  reaction-emoji grouping (`reactionGroups`), thread-message shaping (`threadMessages`),
  and the 8KB-safe chat context builder (`contextForChat`).
- **`analyze-meal`** → `groundResult` now threads confidence, fiber, and highlights out of
  the AI response into `DAY.slotMacros[slot]` meta, so a meal logged from a photo carries
  real per-food confidence (not just a flat "detected" list) all the way to the thread.
- **The unified `#meal-thread/<slot>` page** (`js/screens/meal.js`) replaces the old
  split confirm/detail screens with one immutable four-section surface: Execution
  Summary (celebrates the log, never shames — late meals get "Logged late · still
  counts" in the same green, no red anywhere in this section), Meal Breakdown (photo,
  confidence-dot food chips with a "?" on low-confidence ones, macros + fiber bars
  against real coach targets when set, an honest "No coach targets set yet" line when
  not, the Guardian allergen check), Team Discussion (the derived AI opening + the real
  coach↔athlete `meal_comments` thread + reaction strip + composer), and Next Action
  (reads `S.exec.now` directly — never its own copy of the execution state). `#meal-confirm`
  and `#meal-detail` are now aliases onto the same `thread` module (legacy routes still
  show the tab bar — intentional, unchanged chrome). The score count-up plays once per
  log via an in-memory `RT.lastMove._played` flag; because it's in-memory only, a hard
  page reload can replay it once — accepted as harmless.
- **`meal-chat` edge function** (`supabase/functions/meal-chat/`) — the Team Discussion's
  AI half. Same authority-boundary discipline as `assist`: the model only discusses the
  deterministic context the client already renders, never fetches or computes a number.
  Guarded by `claim_ai_usage_key` under two independent keys — `meal_chat:<athlete_id>`
  for the per-athlete daily budget (default 10/day, env-tunable) and `meal_chat_global`
  for the bill backstop — plus per-IP rate limiting and a CORS allowlist. **Undeployed**
  as of this closeout; the composer's "Couldn't reach your AI coach — tap to try again."
  is the correct, graceful shape of that gap, not a bug.
- **Coach reactions** — one-tap emoji reactions on the athlete's meal log, persisted as
  `meal_comments.kind='reaction'` rows (migration 0049, authored-only / unapplied),
  busy-locked so a double-tap can't double-post.
- **Migration 0049** — adds `meal_comments.kind` (`'message'` default, `'reaction'`
  allowed) with RLS re-verified including an AI-forgery negative test (a client can never
  insert a `role='ai'` row itself). Authored only; awaits founder apply at go-live
  alongside the `meal-chat` function deploy.

Verified 2026-07-10: `npm run verify` green (typecheck clean, 133 suites / 1653 tests,
bundle exports). Browser QA via Playwright MCP against `proto/redesign-2026-07` served on
`:8124` — no `__act`-adjacent dev route was needed beyond the documented `window.__act`
handle already exposed by `js/state.js`; the app's hash router only auth-gates on a true
full page load (`boot()`), so once past the initial `#welcome` bounce, driving screens via
`location.hash` + `window.__render()` is the correct console-QA pattern (confirmed by
forcing a real reload via `about:blank` round-trip, which does correctly bounce an
unauthenticated session to `#welcome`, proving the gate itself is sound). Confirmed: the
four thread sections render in fixed order for both an on-time and a real late log (clock
patched past `DEADLINE.dinner`), with "Logged late · still counts" carried in the same
green styling and zero red/shame anywhere in Execution Summary; confidence dots + the "?"
low-confidence marker render correctly (verified `high`/`medium`/`low` side by side) and
Edit mode makes chips removable and a tap-removal actually drops the chip; the fiber row
and "estimated from photo" label render; the honest "No coach targets set yet" line shows
with no targets, and with real coach targets set the protein×4 coachLine icon correctly
flips clock → check at the threshold (presentation-only, verified both states); the
derived AI opening differs correctly for on-time ("Captured on time. That's the standard.")
vs. late ("Logged. Late still beats missing, and it counts.") and picks up the coach's
protein bar in its copy when targets exist; `#meal-confirm` and `#meal-detail` alias onto
the identical rendered page (tab bar visible on both, as documented/intentional); Next
Action reflects `S.exec.now` exactly. **Composer/`meal-chat` round trip**: `insertMeal()`
requires a real signed-in `userId` before it will even attempt the network call, so an
anonymous console session can never acquire a real `mealId` and the composer correctly
never renders without one (verified: forcing a fake `userId` produced clean 401 RLS
rejections with no data written and no crash) — this is the expected, safe shape of
"undeployed edge function" in an unauthenticated QA pass, not a gap in this pass.
**Fixed one real defect found in QA** (an approved review finding from earlier review):
the daily-AI-limit note in `askAI()` was wired with a tappable retry even though its own
copy says "back tomorrow"; the `data.error === 'limit'` branch now omits the retry
affordance (`js/screens/meal.js`).

## 2026-07-16 — Notification system redesign (doc: docs/notifications/2026-07-16-notification-system-redesign.md)
The reminder plan is now generated by a reusable pure framework, `js/notify-plan.js`
(`planNotifications`), which `exec.js` delegates to. What changed for the athlete:
one reminder per meal instead of a "closes in 45" + "due now" pair; the duplicate
weigh-in pair collapsed to a single last-call; coach-set urgency (`reminder: high`)
finally drives who gets a deadline warning; near-simultaneous reminders coalesce into
one combined notification; copy is type-aware with day-rotated variants and never
exposes scoring formulas ("Photo proof keeps the 50%." is gone); quiet hours + the
deadline-override + a master switch are REAL settings now (`RT.notifPrefs`, wired in
`#notif-settings`, master switch mirrored to `profiles.notifications_opt_out`);
tomorrow's plan is pre-scheduled so a day without an app-open still gets reminders;
sign-out / account-switch / delete post an empty plan (cancel-all) before the wipe;
dated coach assignments (`due_at` today) get one reminder deep-linking to their
detail; and the proto registers the device push token via the new `PUSH_TOKEN`
bridge message + `register_device_token` RPC so coach nudges actually deliver.
Framework tests: `src/core/notifyPlan.test.ts`; exec contract updated in
`src/core/exec.test.ts`.
