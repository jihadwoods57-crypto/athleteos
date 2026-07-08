# Phase 6 run report — athlete surface made honest (cloud-agent, 2026-07-08)

**Branch:** `feat/activation-scoring-ops` · **Base of this run:** `f07ff00` · **Head:** `83c0c85`
**Final status:** `npm test` = **124 suites / 1555 tests green** · `npm run typecheck` **clean**.
Every commit below was green before push. Score parity (`src/core/scoreParity.test.ts`) is intact —
no scoring math changed.

Priorities **1, 2, and 3 of `PHASE6-WORKLIST.md` are complete and verified.** Priority 4 (role
wiring) was intentionally **not started** — see "Remaining / next" below.

---

## What landed (in worklist order, with SHAs)

### Priority 1 — critical fake writes to the real backend
- **`f6d2955` — 1a: sign-up persists the REAL athlete identity, never "Jihad Woods".**
  Onboarding now captures the athlete's real selections into `RT.ob` as they move through the
  (DOM-wiped) steps — name (blank placeholder, **required**, gates Next), sport/position/level,
  goal, current/target weight (now real number inputs), allergies (none pre-selected), reminder
  pressure. Step 6 signs up with the real name and writes only real `athlete_profiles` columns.
  Step 4's fake "M4RK7 · Coach Mark's Group · Match" card is gone (real optional code input; the
  actual join is P4). `S.athlete` reads `RT.profile` (loaded from `profiles.full_name` +
  `athlete_profiles` after sign-in) with honest-neutral fallbacks — never the demo identity.
  `DEFAULT_RT.allergies` is now `[]`. Profile/edit no longer re-default blanks to Jihad Woods /
  Central Catholic / Football.
- **`c9c0e93` — 1b: weight screen logs the REAL stepper value, not the demo `183.8`.**
  `act.logWeight(value)` takes the on-screen value; `S.weight` is now a getter derived from real
  data only (today's log or latest historical `current_weight`; target/start from `season_goal`;
  `deltaMonth`/`pace` stay null until ≥2 real points / a real target). `loadDay`'s 60-day history
  select now includes `current_weight`. Weight/Progress hide the season-goal card, trend line,
  and pace pill until the real data exists.

### Priority 2 — XSS hardening (landed before any cross-user wiring)
- **`818fc00` — escape every `device.innerHTML` sink.** Added `esc()` (HTML-entity, both quote
  styles) and `safeImg()` (allow only bundled `assets/` or self-produced `data:image` base64;
  reject anything with quotes/parens/whitespace) to `components.js`. Applied at every catalogued
  sink: Category 1 AI-meal strings (meal.js food chips / componentsRead / planMatch / AI notes /
  confirm / detail) + `groundResult` strips angle brackets at the source; Category 2 cross-user
  text (coach-assigned titles, plan updates, trainer notes, coach comments → home/plan/
  notifications/requirement/meal-thread); Category 3 profile self-XSS incl. the `value="…"`
  attribute sinks + avatar/photo `url()` contexts + allergies + the settings composer echo.

### Priority 3 — the athlete surface stops lying
- **`d707fff` — standalone Home fabrications removed.** Real on-device clock + greeting (no frozen
  7:12). Deleted the three unconditional notification lies ("Coach Mark liked your lunch",
  "Morning Weight overdue · 1:12 PM", "Breakfast logged on time · 95") and de-fabricated the
  remaining nudges (no "+6" / "5-day streak" / fake deadlines). Trust Pass always inactive until
  its real backend (migration 0039) is wired. Breakdown notes derive from real DAY. Removed the
  hardcoded "D. Okafor checked in" partner card; the "vs yesterday" delta shows only on a real
  increase, the streak pill only when real.
- **`d72d26e` — real per-slot meal model.** `captureMeal`/`logMeal(slot)` fill the next OPEN slot
  by time of day (or the slot a requirement row passes via `camera/<slot>`); `logDinner`/`day0Meal`
  are aliases. The AI plate (quality/foods/note) persists per slot (rides `checkin.slotMacros`
  jsonb) so meal-detail survives reload. requirements / activity / metCount / reqTotal /
  remainingCount / nextMove / reachPlan / finish all derive from real DAY (real logged times, real
  meal scores only when the AI saved one, `late` = past the slot deadline). `logging` shows the
  real analyzed plate, a real revisited plate, or an **honest empty state** — never steak-and-
  potatoes. New `mealDetail(slot)` builds detail from the real plate with only real coach comments.
  Food-search / label-scan now log the **real assembled plate** into the real slot (they logged
  demo macros before). Dropped the "Butter or oil on the potatoes?" question shown for every meal.
- **`f6cb171` — progress / history / streak / weekly from real days.** `S.progress` computes real
  week scores, avg + delta, days-on-standard, best ≥80 streak, 30-day consistency from
  `DAY.scoreHistory` + today; metrics with no real source are gone (per-requirement consistency,
  "biggest pattern", nutrition macros, points-lost, weekly/coach/AI summaries). Meal history +
  streak week + weekly check-in derive from real rows; weekly no longer claims "Submitted Sunday ·
  readiness 84". Honest "one day in" / "opens Sunday, preview" empty states.
- **`eff517c` — honest coming-soon.** Devices screen drops the fake Apple Watch toggle + "7h 42m";
  connect.js drops the pre-filled "M4RK7" + fabricated group preview; settings.js messages drops
  the scripted coach thread; `smartReply` no longer states false specifics ("122g of 190g", "88 oz",
  "that's 94") — numbers come from real state or the reply stays general.
- **`75ddfab`** — guard reach-plan gain + coach readiness against the new honest nulls.
- **`83c0c85`** — fresh athlete starts at 0 oz hydration (was a demo 88), `startDay0` runs
  `syncRtFromDay` so every day-0 flag reflects the reset DAY.

---

## Verification

- `npm test` (124/1555) + `npm run typecheck` green after **every** commit.
- Logic driven in Node against the founder's acceptance bar (day.js + state.js are importable
  with a small `window`/`localStorage` shim; browser QA is for the founder's machine):
  - **Identity**: onboarding capture → `S.athlete` = "Sam Rivera / SR", never Jihad Woods.
  - **Fresh day**: `metCount 0`, activity shows no fabricated meals/hydration, notifications
    carry no lies.
  - **Log one meal (search)**: only that slot flips, with a real logged time; siblings stay open.
  - **Recovery**: low chips → recovery contribution 20, high chips → 90 (honestly different).
  - **Weight null / Trust inactive / Progress no-history / real clock** all confirmed.

## Decisions / surprises
- **Honest-neutral identity fallback.** Where a real field is unknown (e.g. school isn't captured
  in onboarding), `S.athlete` returns blank / "Athlete" / "Add your school" rather than inventing a
  real-sounding value.
- **Food-search / label-scan were logging demo macros**, not the plate you built (a real
  fabrication, not in the catalogue). Fixed as part of the meal-model rework via `captureManual`.
- **Snack** stays a loggable bonus slot but is not surfaced as a required row (kept CATALOG /
  Plan·Schedule untouched); required rows remain breakfast/lunch/dinner + recovery.
- **Meal photos across reloads**: the in-session capture shows; after reload there's no local
  photo, so detail shows the real data with **no fake stock plate** (Storage signed-URL fetch is
  left for later, as the worklist allows).
- **`S.now`/`greeting` are now real getters** — on device this reads the system clock; in these
  Node checks it reads the container clock (harmless).

## Remaining / next (Priority 4 — not started)
Per the worklist, P4 is coach/trainer/parent role wiring to real data: coach → real roster
(`team_roster` 0040, linking 0022–0025), real assign → athlete notifications, plan publish,
comments (Category-2 escaping is already load-bearing for this), real squad/leaderboard, and the
trainer/parent views. It requires reading and mirroring the RN app's queries (`src/screens/roles/*`,
`src/store`) rather than inventing endpoints — a substantial, self-contained effort. It was left
untouched rather than started partially. The coach/parent/trainer demo screens still contain
seeded "Jihad" copy and hardcoded roster/plan data; those are the P4 surface and are clearly
scoped as such.

**Nothing on the athlete surface fabricates data about a real user anymore.** Where a real source
exists it's wired; where none exists yet it's an honest empty or coming-soon state.
