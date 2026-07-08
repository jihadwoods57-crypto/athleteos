# Phase 6 worklist — make the athlete surface HONEST (cloud-agent handoff, 2026-07-08)

**Context.** The `:8124` proto now ships AS the app in a native WebView shell (see `PLAN.md`).
Phases 1–5 are done: shell, bridges, real Supabase auth, parity-proven score engine
(`proto/redesign-2026-07/js/day.js`, guarded by `src/core/scoreParity.test.ts`), and the real
camera → `analyze-meal` → macros loop. **Phase 6 is the product**: wire all screens/4 roles to
live data. Founder gate: all four roles real before public App Store submission.

**This session already fixed (committed just before this file):**
- Recovery check-in now submits the athlete's REAL chip answers (was: silently submitted
  `DEFAULT_CI` constants regardless of the sliders). Questions are engine-config-driven with
  honest polarity; projected "+N tonight" is computed (`checkinProjection` in `state.js`), never
  a hardcoded +6. Fake "Verified · Apple Watch" biometrics panel deleted (founder ruling:
  wearables are an honest "coming soon" in v1 — never fabricate hardware data). `RT.wearable`
  is forced false on load.
- `S.scoreYesterday` derives from real `DAY.scoreHistory` (row must be literally yesterday,
  else the ring hides the "vs yesterday" delta). Was hardcoded 76.
- Breakdown recovery note no longer claims "Carried from Tuesday check-in" / "Watch-verified".

**Baseline: `npm test` = 124 suites / 1555 tests green. `npm run typecheck` clean.
Keep it that way after every task.** The proto is plain ESM JS served statically
(`npx http-server proto/redesign-2026-07 -p 8124 -c-1`) and rendered via `device.innerHTML`
(router.js). No build step. jest imports `day.js` directly for score parity — do not change
scoring math without that test.

**Hard rules (founder):**
1. Never fabricate data about the real user's behavior. If no real source exists yet, show an
   honest empty/`coming soon` state — never a fake value.
2. The score engine (`day.js` pure functions) is parity-locked to the RN engine. UI reads it;
   UI never invents numbers.
3. Free v1; paywall stays inert. Wearables = honest coming-soon. No EAS builds / `npm run ship`
   from the cloud (local certs only). No Supabase migrations applied from the cloud.
4. Commit per completed task with tests green; small, reviewable commits on this branch
   (`feat/activation-scoring-ops`).

---

## PRIORITY 1 — Critical fake writes to the real backend

### 1a. Sign-up persists the fabricated identity "Jihad Woods"
`onboarding.js:159` calls `act.signUp(email, password, S.athlete.name, 'athlete')` —
`S.athlete.name` falls back to `'Jihad Woods'`; the step-1 name `<input value="Jihad Woods">`
(line 28) is NEVER read. Line 163 then writes `sport:'Football', position:'Wide Receiver'`
defaults to `athlete_profiles`. Every real signup gets a fake identity server-side.
**Fix:** capture onboarding selections into a persisted scratch (e.g. `RT.ob`) as the user
interacts (each step is a separate route; DOM is wiped between steps): step-1 name input
(blank + placeholder, required), sport/position/level chips; step-2 goal; step-3 current/target
weight (convert the static `bignum` divs into real number inputs) + allergies multi-chips
(also: `DEFAULT_RT.allergies` must default `[]`, not `['Peanuts · severe']` — state.js:72);
step-5 pressure chip. On step-6 submit: `signUp(email, pass, RT.ob.name, 'athlete')`, then
`saveAthleteProfile({ sport, position, level, base_weight, base_goal, season_goal: {start, target} })`
— columns per `supabase/migrations/0001_schema.sql:119-132` (`athlete_profiles`: level, sport,
position, base_weight, base_goal, targets jsonb, season_goal jsonb, team_code).
Step-4 (coach code) shows fake filled boxes `M4RK7` + fake "Coach Mark's Group · Match" card —
replace with a real text input + honest copy; actual team-code join is Priority 4 (backend
exists: `team_code` column + roster views; check migrations 0022–0025, 0040).
Also `S.athlete` getter (state.js:306-317): when `RT.profile` is unset, read from the signed-in
profile (load `profiles.full_name` + `athlete_profiles` after sign-in into RT) instead of
defaulting to Jihad Woods. `profile.js:235-236` re-defaults blanks to 'Jihad Woods'/'Central
Catholic' — remove.

### 1b. Logging weight writes the demo number
`state.js` `act.logWeight()` does `dayLogWeight(RT.userId, parseFloat(S.weight.current))` where
`S.weight.current` is the hardcoded `'183.8'`. The weight screen's stepper value is ignored —
the demo constant is upserted into the real `days.current_weight`.
**Fix:** `weight.js` must pass its actual UI value: `act.logWeight(value)`. `S.weight` demo
object (state.js ~line 600): `current` from `DAY.currentWeight` (or last real log), `history`
from real rows, hide `deltaMonth/pace/target/start` until real data exists (season_goal from
`athlete_profiles` once 1a lands). Extend `loadDay`'s 60-day history select in `day.js` from
`date,score` to `date,score,current_weight` to power the trend sparkline honestly.

## PRIORITY 2 — XSS hardening (must land BEFORE cross-user wiring)

Sink: every screen renders template literals via `device.innerHTML` (router.js:65). There is NO
escape helper. Add `export function esc(v)` (HTML-entity escape incl. quotes) in
`components.js` and apply at every site below. For `url('${...}')` CSS contexts add a
`safeImg(v)` that allows only `^data:image\//` or `^assets/` values.

**Category 1 — AI response strings (`MEAL.result` via `S.logging`), 8 sites in meal.js:**
lines 69 (`${f}` food chips), 87 (componentsRead "Foods" row), 98 (`planMatch.detail` = r.note),
109 (`L.ai`), 187 (`S.logging.ai`), 237 (`${f}` dinner detail), 254 (`M.planNote`), 272
(`m.text` thread — carries `S.logging.ai` AND `RT.coachComments`). Also harden at the source:
`groundResult` (state.js:23-33) should strip `<`/`>` from `name`, `note`, and every `detected[]`
item (belt-and-braces; escaping at render is still required).

**Category 2 — cross-user text (stored XSS once coach→athlete goes live):**
- `RT.coachComments` → meal.js:272 (the same string IS escaped on the coach's own echo,
  coach.js:298 — the recipient side is the raw one).
- `RT.planUpdate.text` → plan.js:155 (`n.text` in P.notes), notifications.js:11 (`n.body`).
- `RT.trainerNotes` → notifications.js:11.
- `RT.assigned[].title` (coach custom title) → home.js:16 (`r.title`), plan.js:133
  (`a.title`), requirement.js:29 via components.js:131 (`${title}` in backHead), notifications.js:10.

**Category 3 — profile self-XSS + attribute breakout:**
- `RT.profile.name/school` → components.js:117,123; profile.js:28,30; features.js:69; and the
  two ATTRIBUTE sinks `value="${a.name}"` profile.js:199 and `value="${a.school}"`
  profile.js:214 (quote-escape mandatory).
- `RT.profile.avatar` / `MEAL.photoDataUrl` in `url()` contexts → components.js:122,
  profile.js:8, camera.js:23, meal.js:59, meal.js:227 → `safeImg`.
- `RT.allergies` render sites: profile.js:115, meal.js:103, features.js:157.
- `settings.js:28` composer echo escapes only `<` — switch to full `esc()`.

## PRIORITY 3 — the athlete surface must stop lying (real sources EXIST)

All in `state.js` unless noted. The real day is `DAY` (day.js): `meals`, `mealLoggedAt`
(minutes-from-midnight), `slotMacros`, `currentWeight`, `ciSubmitted`, `ciLast`,
`dailyCommitment`, `scoreHistory` (past 60 days).

- **`get requirements` (≈line 375):** `resolve()` hardcodes breakfast/lunch `done:true`;
  `decorate()` fakes 'Scored 95/91', 'Logged 8:14 AM/12:18 PM', forced green. Derive all four
  meal slots from `DAY.meals[k]` / `DAY.mealLoggedAt[k]` (format real times; late = after
  `DEADLINE[k]` in day.js) / `DAY.slotMacros[k].quality` if stored. Route an OPEN slot to
  `camera` (see slot fix below), a DONE slot to its detail.
- **`metCount` / `reqTotal` / `remainingCount` / `finish`:** stop baking in "2" fake meals;
  count from real DAY.
- **`get activity`:** drop fabricated breakfast/lunch/hydration cards + canned times ('8:14 AM',
  '7:12 PM', '183.8 lb'); build from real `DAY.mealLoggedAt`/`slotMacros`/photos (photo persists
  in-session via `MEAL.photoDataUrl`; across reloads a neutral placeholder or a Storage signed
  URL `sb.storage.from('meal-photos').createSignedUrl(...)`).
- **`get notifications`:** delete the three unconditional lies — 'Coach Mark liked your lunch'
  (line ~677), earlier 'Morning Weight overdue · 1:12 PM' (~683), 'Breakfast logged on time ·
  95' (~684). Keep the event-driven ones.
- **`get trustPass` (~461) + home.js:105-112 + trust.js:** fabricated "day 3 of 14" pass —
  make `{active:false}` until the real trust-pass backend is wired (it exists server-side:
  migration 0039), with an honest explainer screen.
- **`get breakdown` notes:** nutrition note claims breakfast+lunch logged (line ~341);
  commitment note claims "You confirmed you hit your plan today" even when null (~344); weekly
  note "Submitted Sunday" (~347). Derive each from real DAY fields.
- **Camera can only log breakfast-or-dinner:** `act.captureMeal` (state.js ~164) hardcodes
  `MEAL.key = RT.day0 ? 'breakfast' : 'dinner'`. Make the slot real: next OPEN slot by time of
  day by default, and let requirement rows pass their slot (`camera/<slot>` route param).
  `dayLogMeal` already supports all four keys. `act.logDinner`/`day0Meal` merge into one
  `logMeal(slot)`. Persist the AI result per slot: extend `DAY.slotMacros[k]` to also store
  `{quality, foods, note}` from `MEAL.result` (rides through the `checkin.slotMacros` jsonb
  already synced in `pushDay`/`projectRowToDay`) so meal-detail screens survive reload.
- **`get meal` (lunch detail, ~507):** fabricated lunch + fake coach thread ('Great lunch. Keep
  this structure.') — render per-slot from the persisted `slotMacros[k]` meta; no fake thread
  (real comments land with coach wiring).
- **`get logging` demo fallbacks (~544):** if `MEAL.result` is null and the slot has no
  persisted data, show an honest empty state — never steak-and-potatoes constants.
- **meal.js:72-79:** hardcoded clarifying question "Butter or oil on the potatoes?" shown for
  every meal — use the real `kind:'questions'` payload from `analyze-meal` (act.runAnalysis
  currently auto-finalizes with empty clarifications; surface the model's actual questions), or
  drop the beat.
- **`S.now` frozen '7:12' + static greeting:** real clock/greeting (statusbar renders on-device).
- **home.js:133-137:** hardcoded accountability-partner card ("D. Okafor checked in") — remove
  until partners are real.
- **`history[]` (~577) + trust.js history/streak-week (~100,133):** canned days — build from
  `DAY.scoreHistory` (per-day score/tier; extend the history select for meals if cheap).
- **`progress` object (~612) + progress.js:76-79,110-121,125-133:** entire tab fabricated —
  compute weekScores/weekAvg/onDays/bestStreak/monthConsistency from `scoreHistory`; replace
  pattern/insights/coach+AI text with honest "not enough data yet" until real sources exist.
- **`weekly` (~602) + checkin.js:** fake "Submitted Sunday · readiness 84" — derive status from
  `DAY.ciLast` (the engine already scores weekly carry honestly); readiness = last real
  check-in's recovery score or honest empty state; checkin.js:43 fake coach quote out.
- **settings.js `smartReply` (6-45):** canned "facts" ('122g of your 190g', '88 oz', 'that's 94')
  — compute from real DAY/RT values or reply generically; never state false specifics.
- **features.js `devices` screen:** fake Apple Watch connect toggle + '7h 42m' — honest
  "coming soon" (no toggle); `act.toggleWearable` can go. profile.js:120 'Apple Watch ·
  recovery verified' line → 'None connected · coming soon'.
- **connect.js / settings.js messages:** fake coach thread + 'M4RK7' — honest empty states
  until coach wiring (Priority 4).

## PRIORITY 4 — role wiring (next after the above)

Coach view to real roster (`team_roster` migration 0040, linking 0022-0025), real assign →
athlete notifications, plan publish, comments (then Category-2 escaping is load-bearing);
trainer + parent views; real squad/leaderboard. Requires reading the RN app's queries
(`src/screens/roles/*`, `src/store`) — mirror them, don't invent new endpoints.

## Verification bar for every task
`npm test` + `npm run typecheck` green; drive the changed flow in a real browser
(`npx http-server proto/redesign-2026-07 -p 8124`) — e.g. after Priority 3: sign in fresh,
log NOTHING → Home shows all four slots open, no fabricated activity/notifications; log a meal
via Search → that slot alone flips with a real time; recovery chips low → visibly lower
recovery than chips high. Commit per task.
