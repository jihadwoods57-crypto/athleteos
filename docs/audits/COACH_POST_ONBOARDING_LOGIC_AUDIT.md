# Coach Post-Onboarding — Code-Level Logic Audit

**Product:** OnStandard · coach experience from the end of coach onboarding onward.
**Codebase audited:** the shipped proto WebView, `proto/redesign-2026-07/` (this is the real UI, not `src/screens`), plus `supabase/` for server logic, traced click → handler → destination → data → persistence.
**Date:** 2026-07-19
**Scope:** AUDIT ONLY. No code, schema, migration, policy, or test was changed.

> **Working-tree note (read first).** Earlier in this session the first-run activation batch was modified in the working tree (uncommitted): `RT.coachSetup` completion tracking, and the checklist routes for *Share code*, *Add staff*, and *Create groups*. **This audit reflects the current working tree** and, for each known problem, states the current behavior, whether the recent change resolved it, and the underlying root cause. Three of the five "known routing problems" were touched by that change; two (*Review your standard*, and the deeper scoring/notification issues) were not. Nothing here is marked fixed unless the current code proves it.

---

## Executive summary

**The score itself is trustworthy on the default path, but the surfaces around it diverge.** For an `athlete`-profile athlete in the coach's timezone with grace = 0, the score, the athlete's Home, and the coach's roster all agree, and the coach's grace/late-credit settings *do* flow into the client score. Every finding is a reachable condition where that agreement breaks.

- **Findings:** **P0 = 1 · P1 = 5 · P2 = 7 · P3 = 5.**
- **The one P0 (P0-1):** the coach roster and the coach notification planner compute "overdue" with **no grace** and on the **coach's device clock** (`status.js`, `coach-data.js`, `coach-notify-plan.js`), while scoring and the athlete's Home use `due + grace` on the **athlete's** clock (`day.js`, `exec.js`). Result: with a grace window the coach sees "Overdue" and can push "you missed it" up to 4 hours before the real deadline; across timezones it happens with grace = 0. This directly violates the product's one promise — an honest read of whether the athlete did the work.
- **Top P1s:** the athlete's Home score is a **second, fixed-weight implementation** that disagrees with the coach's `days.score` for `gain`/`general` athletes (P1-1); the score **breakdown contradicts the score** because it ignores grace and hardcodes half-credit (P1-2); **"Review your standard" opens the Plan hub**, not the editor, with no back button and the wrong tab lit (P1-3); the **Team Standard editor jumps to top** on every control tap (P1-4); there is **no real high-school directory** and search is name-only (P1-5).
- **Server truth:** there is **no server-side scoring** — `days.score` is client-authored and only clamped by an evidence ceiling that never reads grace/late-policy (P2-3). This is a documented deferral, but it means timing correctness lives entirely in the client.

### The seven-surface parity verdict (as requested)

| Consumes the same authoritative result? | SCORE | STATUS / overdue |
|---|---|---|
| Athlete Home | fixed-weight `computeScore` — diverges for gain/general (**P1-1**) | grace-aware ✓ (`exec.js`) |
| Coach Home | `days.score` ✓ | `athleteStatus` but **grace-blind + coach-clock** (**P0-1**) |
| Roster | `days.score` ✓ | `athleteStatus` (P0-1); legacy list uses a 60-cutoff flag (**P2-1**) |
| Score calculation | `scoreFor` → `days.score` (the persisted truth) | `day.js` on-time = `due+grace` ✓ |
| Notifications | n/a | **grace-blind + coach-clock** (**P0-1**); athlete reminders grace-blind but no false-overdue |
| AI feedback | meal-quality is a separate metric; impact line matches Home | n/a |
| Insights | `days.score` ✓ | `athleteStatus` ✓ |

**One persisted score consumed cleanly by all coach surfaces, plus a parallel athlete-side re-derivation; one modern status engine plus one legacy flag; and an overdue definition that is grace-and-timezone-consistent for scoring + athlete Home but not for the coach roster/notifications.** Thresholds (80 / 90-75-60 / 75-50) are duplicated ~20× (**P2-2**).

---

## Part A — The five actions, click to completion

Each trace is against the **current working-tree code**. Line numbers are current.

### 1. Share your athlete code

| Field | Finding |
|---|---|
| **Source screen / component** | Coach Home empty dashboard, `coach-home.js` → `emptyTeamDashboard()` → `coachInviteCard()` (the code + QR + Copy/Share card) and `setupChecklistCard()` (the checklist row). |
| **Click handler** | Two paths. (a) Inline card buttons `#coach-copy-code` / `#coach-share-invite`, wired in `coachHome.mount` (`coach-home.js:275-295`): clipboard write / `OnStandardNative.share` → `navigator.share` → clipboard fallback, and now `act.markCoachSetup('sharedCode')`. (b) Checklist row → router `data-go="coach-profile/code"` (`coach-home.js:66`) → `navigateTo` → Coach Profile scrolled to the code section. |
| **Destination** | Stays on Home (inline Copy/Share) or Coach Profile `#cp-code` anchor. |
| **Data required** | `RT.team.code` (the real join code) + team name. Empty code → the card is replaced by a "minting…" sidebox (see Part C, minting). |
| **Current result** | The inline Copy/Share **works** (real clipboard + native share sheet). The checklist row now **navigates** to the code section. |
| **Can it be completed?** | Yes, once a real code exists. |
| **Persisted?** | Yes — `act.markCoachSetup('sharedCode')` persists to `RT.coachSetup` (`state.js`), reset per-account by `_wipeUserScopedState`. |
| **Home updates after?** | The flag persists, but the copy/share handlers do **not** call `window.__render()`, so the checklist checkmark repaints on the *next* render, not instantly. Minor. |
| **Back behavior** | From the checklist row: `coach-profile/code` includes `/`, so `navigateTo` pushes Home as origin; Back returns to Home with scroll restored. |
| **Root cause of the "does nothing" report** | In the pre-change code the checklist row had `go: null` — it rendered as a static row with **no `data-go`, so tapping it did nothing**; the only working share affordance was the separate inline card. The recent change gave the row a destination. The *inline* Copy/Share always worked. So "Share Athlete Code does nothing" was accurate for the checklist row specifically. |

### 2. Review your standard

| Field | Finding |
|---|---|
| **Source screen / component** | Coach Home checklist, `coach-home.js:67` — `{ t:'Review your standard', go:'coach-plan' }`. |
| **Click handler** | Router `data-go="coach-plan"` → `navigateTo('coach-plan')`. |
| **Destination** | `coachPlan` (`coach.js:203`) — the **Plan HUB**, not the Team Standard editor. The hub is a room list (Team default / position rooms), per-athlete targets, trust passes, and program-control links. The actual editor is a *further* tap: the "Team default" row → `coach-plan-set/team` → `coachPlanSet` (`coach.js:534`). |
| **Data required** | `CD.roster`, `SETS` (requirement_sets, lazy-loaded by `loadSets`). |
| **Current result** | Lands on the hub. To "review your standard" the coach must recognize the "Team default" row and tap again. **This is the known problem, and it is UNCHANGED — the route was not touched by the recent activation edit.** |
| **Can it be completed?** | Yes, but indirectly (extra hop through a middle page). |
| **Persisted?** | `act.markCoachSetup('standard')` only fires on a real editor **save** (`coach.js:804`), not on merely viewing the hub — so the checklist step correctly stays unchecked until a standard is actually saved. |
| **Home updates after?** | Yes, once a standard saves (flag → next render marks the step done). |
| **Back behavior** | **Problem:** `coach-plan` is a `ROOT_TAB` (`router.js:86` → `'coach-plan':'roster'`) with no `/`, so `navigateTo` calls `resetTab(NAV,'roster')` instead of pushing Home as origin (`router.js:118-119`). The hub renders with `titleHead` (`coach.js:227`) — **no back chevron** — and lights the **Roster** bottom tab. So tapping "Review your standard" drops the coach on a back-button-less hub with the wrong tab highlighted; the only way back to Home is the Home tab. |
| **Root cause** | The checklist targets the hub route `coach-plan` rather than the editor route `coach-plan-set/team`; and `coach-plan` is registered as a Roster-tab root, so it has no back affordance and mis-lights the tab. |

### 3. Set notification rules

| Field | Finding |
|---|---|
| **Source screen / component** | Coach Home checklist, `coach-home.js:68` — `go:'coach-notif-settings'`. |
| **Click handler** | Router `data-go` → `navigateTo('coach-notif-settings')`. |
| **Destination** | `coachNotifSettings` (`settings.js:408`) — a real, functional settings screen: master On/Off, morning briefing time, evening recap time, hourly-while-overdue, immediate-critical, quiet-hours start, my-room-only. |
| **Data required** | `RT.coachNotifPrefs` via `normalizeCoachPrefs` (defaults when null). |
| **Click → completion** | Each control calls `act.setCoachNotifPrefs(patch)` (`state.js:720`): merges into `RT.coachNotifPrefs`, `save()`, `syncNotifications()`, and (master only) best-effort writes `profiles.notifications_opt_out`. |
| **Can it be completed?** | Yes. |
| **Persisted?** | Yes — `RT.coachNotifPrefs` persisted locally; master opt-out mirrored server-side. |
| **Home updates after?** | Yes — the checklist derives this step's done-state from `RT.coachNotifPrefs != null` (`coach-home.js:55`), so touching any control marks it complete next render. |
| **Back behavior** | `backHead(..., 'coach-profile')` fallback; origin stack returns to Home (pushed because `coach-notif-settings` is not a ROOT_TAB). Correct. |
| **Open logic questions (Part B)** | (a) Do these preferences actually drive delivered notifications, and (b) does the notification deadline/overdue logic match the scoring engine's? Copy issues (title "Notifications" vs the checklist's "Set notification rules"; a confusing subtitle) were noted in the prior UX audit. |

### 4. Add another staff member

| Field | Finding |
|---|---|
| **Source screen / component** | Coach Home checklist, `coach-home.js:70` — `go:'coach-profile/staff'` (recently changed from `'coach-profile'`). Also the `+` Create menu `invite_staff` → `coach-profile/staff` (`coach-create.js:19`). |
| **Click handler** | Router `data-go="coach-profile/staff"` → `navigateTo` (pushes Home origin). |
| **Destination** | `coachProfile` (`roles.js:1000`) with `sub:'staff'`; `mount` smooth-scrolls the `#cp-staff` section into view (`roles.js:1133-1141`). The staff section offers 7 role chips that each mint a single-use invite code via `createStaffInvite`. |
| **Data required** | `RT.team.id`; `loadStaff` (team_staff_list). Only the **head coach** sees invite controls (`iAmHead` gate, `roles.js:1073-1074`); scoped staff see a read-only note. Server enforces regardless (0078). |
| **Current result** | Lands on Coach Profile **scrolled to the staff section**. It is **not** a standalone invitation flow — invite = tap a role chip → a code appears → "text it to them; they pick Coach at sign-up and enter it." |
| **Can it be completed?** | Yes for a head coach (mint + share code). |
| **Persisted?** | Yes — the invite is a server row (`createStaffInvite`); `act.markCoachSetup('staff')` on success (`roles.js:1154`). |
| **Home updates after?** | Yes (flag → next render). |
| **Back behavior** | Correct: origin (Home) restored. |
| **Root cause of the known problem** | "Opens Coach Profile instead of an invitation flow" was accurate: there is **no dedicated staff-invitation route**; staff management is embedded in the dense Coach Profile page. The recent change deep-links + auto-scrolls to that section, which mitigates the "buried" symptom, but the architecture (no invitation flow) is unchanged. |

### 5. Create position groups

| Field | Finding |
|---|---|
| **Source screen / component** | Coach Home checklist, `coach-home.js:72` — now `{ t:'Organize athletes into groups', go: st.hasAthletes ? 'coach-roster' : null }` (recently changed from `'Create position groups' → 'coach-roster'`). |
| **Click handler** | When athletes exist: router `data-go="coach-roster"`. When empty: **no `data-go`** (renders "Unlocks once athletes join," non-interactive). |
| **Destination** | `coachRoster` (`coach-roster.js:175`). Group creation lives inside it: enter Select mode → select athletes → `＋ Group` chip → `groupSheet` → name → "Create with N" (`saveCoachGroup`). |
| **Data required** | Roster with athletes; `CD.extras.groups`. |
| **Current result** | Empty case no longer dead-ends (it's gated). Populated case opens the roster — **not a dedicated group builder**; creation is a multi-step select-then-name flow that isn't obvious. |
| **Can it be completed?** | Yes when athletes exist (via the roster's multi-select group flow). Impossible when empty (correctly gated now). |
| **Persisted?** | Yes — `saveCoachGroup` server row; `act.markCoachSetup('group')` on success (`coach-roster.js:94`); also derived from `CD.extras.groups.length`. |
| **Home updates after?** | Yes. |
| **Back behavior** | Correct (origin restored). |
| **Root cause of the known problem** | Two issues. (a) "Position groups" is a **misnomer**: position *rooms* are auto-derived from athlete positions and cannot be hand-created; the roster builds *custom groups*. (b) There is **no group-builder route** — creation is buried in the roster's select-mode. The recent change fixed the empty-roster dead-end and renamed the step, but the missing builder and terminology overload remain. |

---

## Part B — Deep dive: Team Standard scroll-reset

**Symptom:** on the Team Standard editor (`coachPlanSet`, `coach.js:534`), tapping a control (meals count, grace window, late-credit, lift count, weigh cadence, any switch, a template) jumps the screen back to the top.

**This is not a React app.** There are no React keys, no `<form>` wrapping the editor, and no query cache. The proto is a hash router that rebuilds the whole screen's `innerHTML` on every render. The relevant mechanics:

- **The render model resets scroll.** `router.js` `render()` rebuilds `device.innerHTML` in full (a complete DOM teardown/rebuild — the analogue of a full remount), then sets scroll: `const targetScroll = (RESTORE && RESTORE.r === full) ? (RESTORE.s || 0) : 0; vp.scrollTo({ top: targetScroll })` (`router.js:243-245`). `RESTORE` is only set on a **back-pop**; a same-screen re-render leaves it null, so **targetScroll is 0 — every re-render scrolls to top.**
- **Every knob tap forces a re-render.** The editor's control handler ends with `window.__render()` (`coach.js:763`) for all `data-knob` controls (meals, lifts, weigh, recovery, checkin, hydration, photoProof, coachReview, hydrationOz, **grace**, **latePolicy**, template apply/save). So each tap → full innerHTML rebuild → scroll-to-0.

**Against the user's checklist of suspects:**

| Suspect | Verdict |
|---|---|
| Buttons missing `type="button"` | The late-credit control **is** `<button>` without `type` (`coach.js:630`), as is effective-from. **But there is no `<form>` wrapper**, so no implicit submit occurs — this is *not* the active cause. It is a latent bug: add a form and these would submit. Recommend adding `type="button"` defensively. |
| Form submission | N/A — no `<form>` in the editor. |
| Route refreshes | The hash does **not** change; `window.__render()` is a same-route re-render. But it runs the same `render()` that resets scroll. |
| Component remounting | **This is the mechanism.** `device.innerHTML = …` destroys and recreates the entire screen DOM, then re-runs `mount`. All scroll/focus state is discarded. |
| Unstable keys | N/A (no keyed reconciliation; full innerHTML replacement discards everything unconditionally). |
| Query invalidation | Not the per-tap cause. Post-**save**, `loadSets(true)` refetches and re-renders once — a legitimate refresh. |
| Scroll restoration | The router restores scroll **only** on a back-pop (`RESTORE`); there is **no** same-screen scroll preservation, which is exactly why `__render()` snaps to top. |
| Anchor navigation | N/A. |
| Focus behavior | The text/time inputs deliberately avoid `__render()` and write straight into `KNOB` on `change` (`coach.js:720-740`) to preserve focus — proving the team already knows `__render()` blows away focus/scroll. The chip/switch handlers do not follow that pattern. |

**Root cause (single sentence):** the editor mutates module state (`KNOB`) and calls `window.__render()` on every chip/switch tap, and the router's `render()` unconditionally rebuilds the screen and resets `viewport.scrollTop` to 0 for any non-back render — so each tap jumps to the top.

**Recommended correction (for the fix pass, not now):** patch only the affected control's DOM in place (the pattern the roster search at `coach-roster.js:158-173` and the effective-from toggle at `coach.js:781-784` already use), or have `render()` preserve and restore `viewport.scrollTop` across a same-route `__render()` (capture `currentScroll()` before rebuild, restore after when the route is unchanged and it's not an explicit back). The latter fixes this class of bug app-wide (the athlete profile section chips, `coach.js:1577`, have the same behavior).

---

## Part C — Cross-subsystem logic (scoring, notifications, directory, state)

### C1. Where the score comes from — there are two implementations

| | Persisted / coach score | Athlete Home score |
|---|---|---|
| Function | `day.js:201 scoreFor(day)` → `clampedScore` (`day.js:218`) | `state.js:110 computeScore(c)` |
| Weights | **profile-aware** `PROFILE_WEIGHTS[day.scoringProfile]` (`day.js:11`) | **fixed** `WEIGHTS {nutrition .5, recovery .25, commitment .15, checkin .1}` (`state.js:105`) |
| Evidence-ceiling clamp | yes (`clampedScore`) | no |
| Written to | `days.score` via `pushDay` (`day.js:497-513`) | `S.score` (`state.js:1849`), passed through `exec.js` unchanged (`exec.js:3,155`) |

They are **byte-identical for the default `athlete` profile** but **diverge for `general` (.55/.20/.15/.10) and `gain` (.55/.25/.10/.10)** profiles, which are reachable from the onboarding goal (`state.js:445` `setDayGoalConfig(scoringProfileForGoal(goal),…)`, applied at `state.js:942,1109`). A weight-gain athlete's Home hero can therefore read a few points different from the number the coach sees for the same day. There are in fact **three** copies of the weighted sum (`scoreFor` `day.js:201`, `computeScore` `state.js:110`, `dayScoreOf` `breakdown-model.js:18`) and a duplicated `tier()` (`state.js:120` vs `day.js:290`). A parity test keeps them in sync **for the athlete profile only**; nothing structurally forces the others to track.

### C2. Per-surface authority — the seven surfaces requested

| Surface | Value shown | Origin | Same authoritative source? |
|---|---|---|---|
| **Athlete Home** hero | `S.exec.score` ← `S.score` = `computeScore` | `home.js:192`, `state.js:1849` | Athlete-side fixed-weight, unclamped |
| **Score calculation** (persisted) | `days.score` = `clampedScore`(`scoreFor`) | `day.js:201,218,497` | The one persisted number |
| **Coach Home** group score | `teamPulse` = `mean(row.score)` | `status.js:101`, `coach-home.js:185` | `days.score` ✓ |
| **Coach Home / Roster** status | `athleteStatus` via `entriesFor` | `coach-data.js:160`, `status.js:78` | one status engine ✓ (but grace/clock bug, C3) |
| **Roster / priority** score | `row.score`, `buildPriorities` | `coach-roster.js:66`, `priority.js:52` | `days.score` ✓ |
| **Insights** | `entriesFor` status + `team_day_rollup` avg | `coach-insights.js:202`, `insights.js:96` | `days.score` + `athleteStatus` ✓ |
| **AI feedback** | meal `qualityBand` (75/50); score-impact = `computeScore` | `meal-intel.js:238,214` | meal-quality is a **separate metric**; impact matches Home |
| **Notifications** | overdue from `status.js` (coach) / `notify-plan` (athlete) | see C3 | **separate deadline logic** |

**Verdict.** *Coach ↔ coach is genuinely single-source* (`days.score` + `athleteStatus` everywhere). *Athlete ↔ coach is not:* the SCORE has a second, fixed-weight implementation that diverges for `gain`/`general` profiles, and one legacy STATUS path survives — `screens/coach.js` roster list + trainer book render `roles.js:734 tierFlag` (green ≥80 / yellow ≥60 / red) and `roles.js:750` note (≥80 "On standard" else "below the bar"), **cutoff 60**, while the Coach OS roster uses `athleteStatus` **cutoff 80** (`status.js:86 row.score < 80`). A logged athlete at **70** reads red "Below standard" in one coach view and a yellow flag in the other. The `80` threshold is hardcoded in **~15 places** (`status.js:86`, `roles.js:734,750`, `day.js:294`, `coach-home.js:200`, `coach-roster.js:55`, `coach.js:20,1007,1008,1119`, `state.js` ×8, `features.js:30`, `progress.js:109`, `trust.js:114`); meal-quality green is `75` in the canonical `qualityBand` but `80` inline at `state.js:2166`/`trust.js:184,273`/`coach.js:1301` (a 76–79 quality reads "Strong" one place, amber another). `DUE_SOON` is 90 min for the athlete (`exec.js:9`) but 60 min for the coach (`status.js:17`).

### C3. Notification vs scoring parity — NOT at parity (the core correctness defect)

| Path | Deadline used | Clock | Grace-aware? |
|---|---|---|---|
| **Scoring** (`day.js:94`) | `at <= due + grace` | athlete-local `minutesNow()` | **yes** |
| **Athlete Home status** (`exec.js:38-42`) | `nowMin > due + grace` | athlete-local | **yes** ✓ |
| **Coach roster status** (`status.js:48-52`) | `nowMin > due` | **coach-local** `new Date().getHours()` (`coach-data.js:149`) | **no** ✗ |
| **Coach alerts** (`coach-notify-plan.js:123,241`) | inherits `status.js` overdue → grouped/hourly/**immediate** "X missed" push | coach-local | **no** ✗ |
| **Athlete reminders** (`notify-plan.js:231-241`) | slots from raw `due`; last stage `'due'` (not overdue) | athlete-local | no, but no false-overdue |
| **Athlete secondary list** (`requirements.js:104 derive`, used `state.js:2130`) | `nowMin > due` | athlete-local | **no** ✗ |

Scoring and the athlete's own Home honor `due + grace`; the coach roster, coach notification planner, and a secondary athlete list use bare `due`. Two independent implementations that diverge. See finding **P0-1**.

### C4. Server enforcement — there is none

`days.score` is **client-authored** and uploaded (`day.js:497` `pushDay`; schema comment `supabase/migrations/0001_schema.sql:146` "computed client-side"). The only server code touching score is the evidence-ceiling **clamp** `clamp_day_score_to_evidence()` (`0041_score_evidence_ceiling.sql`, header: "NOT a recompute") and shape **CHECK** constraints (`0029_score_integrity_upload_guard.sql`). Neither reads `grace`, `latePolicy`, `mealLoggedAt`, or `minutes_late`. Coach-authored `grace`/`latePolicy` live in `requirement_sets.items` (`0055_requirements_engine.sql`) and are only **validated** (`0086_standard_item_depth.sql:48-54`), never consumed server-side (grep of `supabase/functions/**` for `requirement_sets|latePolicy|slotGrace` → no matches). See **P2-3**.

### C5. Timing boundary matrix (requested test cases)

Scoring uses the meal's **log time** `at` vs `due + grace` (`day.js:94-95`); `slotLateCredit` = half .5 (shipped default) / full 1 / none 0 (`day.js:83-86`). For deadline **D**, grace **G**:

| Meal logged at | `at <= D+G`? | Scored outcome | Credit |
|---|---|---|---|
| D − 1 | yes | on time | 1.0 |
| D (exact) | yes (`<=`) | on time | 1.0 |
| D + 1 | yes if G≥1; no if G=0 | on time (G>0) / late (G=0) | 1.0 / lateCredit |
| D + G (grace edge) | yes (`<=`) | on time | 1.0 |
| D + G + 1 | no | late | lateCredit (0.5/1/0) |

All three late policies are implemented and honored **by the score**. Caveat: every shipped standard defaults to **G = 0**, so D+1 is already late unless a coach sets grace. Two surfaces judge the same meal with **no grace and hardcoded half-credit** — see **P1-2**.

### C6. School directory

`ob-directory.js:11` `dir.search` → edge function `org-directory` (`supabase/functions/org-directory/index.ts:43`) → `orgs` table, `ilike("name", …)` **name-only** (`limit 20`). Colleges + pro are a **real, verifiable** dataset (`0057_directory_seed.sql`: ~364 NCAA + ~154 pro, verified badge via `verification_status`). **High schools are a ~9-row demo stub** (`0022_schools.sql:63-71`; header calls the production NCES/IPEDS import "a separate data-ops step pending"). City/state are returned for display but are **not** query filters, and the UI is a single box ("Search your school", `roles.js:145`). Free-text "add your school" writes local scratch on tap (`roles.js:452`) and inserts a real **unverified** `orgs` row at onboarding commit (`state.js:1594-1604`). See **P1-5**.

### C7. Minting, readiness, and the Team-Score/code seam

- **Minting is synchronous, not a backend process.** `create_team` generates the code inline (`gen_join_code()`, `0022_schools.sql:45-52`); the four-state getter is `state.js:1800` (`loading|offline|minting|live`). On the **empty dashboard** the branch keys on `code` truthiness only (`coach-home.js:111-113`) and shows one "minting… usually a few seconds. Nothing shows until it's real" box for the loading, offline, AND no-team cases; `RT.teamOffline` is never consulted there and `loadCoachRoster` never hydrates `RT.team` (`coach-data.js`), so a transient miss reads as "minting" and won't self-heal without re-sign-in; a silent `create_team` failure (`state.js:1611 return false`) leaves it "minting" indefinitely. Coach Profile copy, by contrast, is honest ("mints… on your next sign-in", `roles.js:1065`). See **P2-4**.
- **Readiness is unconditional.** "Your team is ready" (`coach-home.js:105-113`) is gated only on an empty roster; it renders above the still-incomplete setup checklist and even above the "minting…" box (the banner ignores `code`). See **P2-5**.
- **Team-Score / code "overlap" is a spacing defect, not a z-index overlap.** `.co-pulse` clips its aurora (`overflow:hidden`, content `z-index:1`, `coach.css:23-41`), so there is no element-on-element overlap; but `.co-pulse` has no bottom margin and the following `.card`/`.sidebox` have no top margin, so the tile and the code/minting box sit flush (0 px), and the tile's blue→green bloom is anchored exactly at that seam. Reads as crowding/bleed. See **P3-1**.

---

## Findings (P0–P3)

Severity: **P0** breaks core correctness on a reachable path (wrong data / wrong push) · **P1** major logic/flow defect, fix before release · **P2** real but bounded or documented · **P3** polish/latent.

> The **default path is correct**: an `athlete`-profile athlete, same timezone as the coach, grace = 0 → score, status, and Home all agree. Every finding below is about a *reachable* condition where that breaks. There is **one P0** (it needs no special config to trigger via timezone).

---

### P0-1 · Coach roster and notifications flag athletes overdue — and can push "you missed it" — before the real deadline

- **User-visible symptom:** On the coach roster an athlete flips to **"Overdue"** and the coach can receive a grouped/hourly/**immediate** "X missed \<meal\>" push, while the athlete's own app still shows the meal as **"Due soon / Open"** and it will still score **on time** if logged. With a grace window set, this happens up to **4 hours early**; across timezones it happens by the timezone offset even with grace = 0.
- **Reproduction steps:**
  1. Coach sets a meal standard with a grace window > 0 (e.g. Dinner due 8:30 PM, grace 60 min) — or leave grace 0 and have the athlete in a timezone behind the coach.
  2. As the athlete, do not log dinner. Watch the coach roster at 8:31 PM coach-local.
  3. Coach roster shows the athlete **Overdue**; `coach-notify-plan` schedules a "missed" alert. Meanwhile the athlete Home shows dinner **due until 9:30 PM** (grace) and `effectiveMeals` will credit a 9:00 PM log **on-time**.
- **Root cause:** Two independent overdue implementations. Scoring and athlete Home use `at/nowMin <= due + grace` on the **athlete-local** clock (`day.js:94`, `exec.js:38-42`). The coach roster uses `nowMin > due` with **no grace** (`status.js:48-52`) computed on the **coach's device clock** (`coach-data.js:149-150` `new Date().getHours()`) against the athlete's authored minute-of-day deadline. The coach notification planner inherits that verdict (`coach-notify-plan.js:123-134,241-266`). Not an off-by-one and not a `window.open`/`window.due` swap — it is missing grace + wrong clock.
- **Files / functions:** `status.js:48-52 openItems`; `coach-data.js:149-161 entriesFor` (coach-local `nowMin`); `coach-notify-plan.js:123-134,241-266`; parity references `day.js:94`, `exec.js:38-42`. Also `requirements.js:104 derive` (grace-blind, athlete secondary list at `state.js:2130`).
- **Recommended correction:** (1) Add grace to the coach/notification deadline: compare against `window.due + (window.grace||0)`, and thread `grace` into the window object `catalogFromItems` builds (`requirements.js:216`) so `status.js` sees it. (2) Fix the clock: evaluate an athlete's deadlines against **that athlete's** local day, not the coach's device clock (store/compare a tz-aware instant, or carry the athlete's tz offset on the roster row). (3) Route all four surfaces through one shared "is this requirement overdue at time T" helper so scoring, Home, roster, and notifications cannot diverge again.
- **Tests required:** Unit boundary tests for the coach overdue helper at `due-1/due/due+1/due+grace/due+grace+1` for grace ∈ {0,15,60}; a cross-timezone test (coach ET, athlete PT) asserting coach status == athlete status for the same instant; a notification test asserting no "missed" push fires before `due+grace`.
- **Migration / security implications:** No schema change strictly required if grace is threaded client-side, but a robust fix wants the athlete's timezone available to coach surfaces (roster row already crosses RLS via `fetchLinkedDaysSince`; adding a tz field is additive, no policy change). No security regression; this reduces false notifications.

---

### P1-1 · Athlete Home shows a different score than the coach for `gain`/`general` goal profiles

- **User-visible symptom:** A weight-gain athlete's Home hero score and the score the coach sees for the same day can differ by a few points; the athlete's own Score-Breakdown screen is internally inconsistent (the ring and the category cards use different formulas).
- **Reproduction steps:** Onboard an athlete with a "gain weight" goal (→ `scoringProfile='gain'`). Log a partial day. Compare the Home hero (`computeScore`, fixed weights, unclamped) with `days.score` (`scoreFor`, gain weights, clamped) that the coach reads. They disagree (bounded, ~2–5 pts). On the Breakdown screen, the big ring (`S.score`, fixed) and the category cards (`S.explain`, profile-aware) sum to different totals.
- **Root cause:** Two/three implementations of the weighted-sum score. `state.js:110 computeScore` uses hardcoded `WEIGHTS` and is **not** profile-aware and **not** evidence-clamped; `day.js:201 scoreFor`/`clampedScore` is. Byte-identical only for the `athlete` profile (the only one the parity test covers). `breakdown-model.js:18 dayScoreOf` is a third copy; `state.js:120 tier` duplicates `day.js:290 tierFor`.
- **Files / functions:** `state.js:105,110,1849` (`WEIGHTS`, `computeScore`, `S.score`); `day.js:11,201,218` (`PROFILE_WEIGHTS`, `scoreFor`, `clampedScore`); `breakdown.js:53,61`; `breakdown-model.js:18,147`; profile set at `state.js:445,942,1109`.
- **Recommended correction:** Make the athlete-side score profile-aware and clamp-aware — ideally delete `computeScore`/`WEIGHTS` and have Home read the single `scoreFor`/`clampedScore` (or make `computeScore` delegate to `PROFILE_WEIGHTS[day.scoringProfile]`). Unify `tier`/`tierFor`.
- **Tests required:** Extend the existing parity test to assert `computeScore(day) === scoreFor(day)` (and Breakdown ring === Σ category cards) for **all** profiles (`athlete`,`general`,`gain`), not just `athlete`.
- **Migration / security implications:** None (client-only). No policy change.

---

### P1-2 · The score breakdown contradicts the score when grace > 0 or late-policy ≠ half

- **User-visible symptom:** The athlete's Score-Breakdown labels an on-time-within-grace meal as **"late (half credit)"** and shows a reduced per-meal value, even though the score itself credited it in full; and it always says **"half credit"** even when the coach set the policy to full or none.
- **Reproduction steps:** Coach sets grace 30 and late-policy `full`. Athlete logs dinner 20 min after due (within grace). Score (`effectiveMeals`) credits it **on-time (1.0)**. The Breakdown card shows "· late (half credit)" and a `× 0.5` value.
- **Root cause:** `breakdown-model.js` judges lateness with `mealLoggedAt[k] > slotDeadline(k)` — **grace not added** (`:159`, `:165`, `:172`) — and hardcodes half-credit in copy and math (`:167` "late (half credit)", `:177` `× (late ? 0.5 : 1)`), ignoring `slotLateCredit`/`latePolicy`.
- **Files / functions:** `breakdown-model.js:159,165,167,172,177`; contrast the correct `day.js:83-86 slotLateCredit`, `day.js:94 slotGrace`. The `minutes_late` written to the `meals` row also omits grace (`state.js:499` → `day.js:598`).
- **Recommended correction:** In `breakdown-model.js`, add `slotGrace(k)` to the deadline and replace the hardcoded `0.5` with `slotLateCredit(k)` so the explanation matches `effectiveMeals`.
- **Tests required:** Assert the Breakdown per-meal state/value equals what `effectiveMeals` credited, across grace ∈ {0,30} and policy ∈ {half,full,none}.
- **Migration / security implications:** None (client display).

---

### P1-3 · "Review your standard" opens the Plan hub, not the Team Standard editor — and the hub has no back button and lights the wrong tab

- **User-visible symptom:** Tapping "Review your standard" lands on a room-list hub titled "Plan" (not the standard editor), with **no back chevron**, and the bottom nav highlights **Roster**. To actually review the standard the coach must spot the "Team default" row and tap again; to leave, they must tap a bottom tab.
- **Reproduction steps:** Coach Home → checklist → "Review your standard" → lands on `coachPlan` hub. Note: no back arrow, Roster tab lit. Tap "Team default" → *now* the editor (`coachPlanSet`).
- **Root cause:** The checklist targets the hub route `coach-plan` (`coach-home.js:67`), not the editor route `coach-plan-set/team`. And `coach-plan` is registered as a Roster-tab root (`router.js:86` `'coach-plan':'roster'`), so `navigateTo` calls `resetTab` instead of pushing Home as origin (`router.js:118-119`), the hub renders with `titleHead` (no back, `coach.js:227`), and the Roster tab lights.
- **Files / routes:** `coach-home.js:67`; `coach.js:203 coachPlan` (hub) vs `coach.js:534 coachPlanSet` (editor); `router.js:86,118-119`; `components.js:199 titleHead`.
- **Recommended correction:** Point the checklist step at `coach-plan-set/team` (the editor) so "Review your standard" reviews the standard directly. If the hub is still wanted as a stop, give it a back affordance and stop registering `coach-plan` as a tab root, or push Home as origin when it is reached from a non-tab context.
- **Tests required:** Nav test: from Coach Home, the "Review your standard" tap lands on the team-standard editor; Back returns to Coach Home at the prior scroll.
- **Migration / security implications:** None.

---

### P1-4 · Team Standard editor jumps to the top on every control tap

- **User-visible symptom:** Changing meals-per-day, grace, late-credit, lifts, weigh cadence, any switch, or applying a template scrolls the editor back to the top, losing the coach's place in a long form.
- **Reproduction steps:** Open the Team Standard editor, scroll to "Timing & late credit," tap a grace chip → the screen snaps to the top.
- **Root cause:** Every `data-knob` handler ends with `window.__render()` (`coach.js:763`), and the router's `render()` rebuilds the entire screen `innerHTML` and resets `viewport.scrollTop` to 0 for any non-back render (`router.js:243-245`; `RESTORE` is only set on a back-pop). Full details and the elimination of the other suspects (no `<form>`, no React keys, missing `type="button"` present but inert) are in **Part B**.
- **Files / functions:** `coach.js:741-764` (`data-knob` handler), `router.js:243-245` (scroll reset), contrast the in-place patterns already used at `coach-roster.js:158-173` and `coach.js:781-784`.
- **Recommended correction:** Patch only the tapped control's DOM in place instead of `window.__render()`, or have `render()` capture and restore `viewport.scrollTop` across a same-route re-render. The latter also fixes the athlete profile section-chip jump (`coach.js:1577`).
- **Tests required:** Interaction test asserting `viewport.scrollTop` is preserved after a knob tap; a focus test asserting a focused meal-name input is not blurred by a sibling control tap.
- **Migration / security implications:** None.

---

### P1-5 · No real high-school directory; the school search matches name only

- **User-visible symptom:** A high-school coach searching for their school finds nothing (only ~9 demo schools exist) and must free-text "add your school." Searching by city or state does not filter results.
- **Reproduction steps:** In coach onboarding step 2, search a real public high school by name → no match (unless it is one of the 9 seeds). Type a city/state → no effect (name-only match).
- **Root cause:** `org-directory` edge function queries `orgs` with `ilike("name", …)` only (`supabase/functions/org-directory/index.ts:43-47`); city/state are selected for display but never filtered. The HS dataset is a ~9-row demo stub (`0022_schools.sql:63-71`; production NCES/IPEDS import is a deferred data-ops step). Colleges/pro are real and verifiable (`0057_directory_seed.sql`).
- **Files / functions / tables:** `ob-directory.js:7,11`; `supabase/functions/org-directory/index.ts:43-57`; tables `orgs` (`0001`/`0055`), seeds `0022_schools.sql`, `0057_directory_seed.sql`; free-text create path `screens/roles.js:452`, `state.js:1594-1604` (`find_org` + insert, unverified).
- **Recommended correction:** Import a real US high-school dataset (NCES public + a private-school source) into `orgs`; add `city`/`state` as optional filters in the edge function and a state/city control in the UI. Keep the free-text escape hatch but dedupe against the imported set at commit.
- **Tests required:** Directory search returns a known real HS by name; a name+state query narrows correctly; the "add school" path creates exactly one unverified `orgs` row and dedupes on re-entry.
- **Migration / security implications:** A data-only seed/import migration (large). No RLS change (directory reads are already public/anon per `org-directory`). Licensing review for the dataset (noted in `0022`).

---

### P2-1 · Legacy coach roster/trainer status disagrees with the Coach OS status engine

- **Symptom:** The same athlete at score 70 reads red **"Below standard"** in the Coach OS roster but a **yellow flag / "below the bar"** in the legacy `screens/coach.js` roster list and the trainer book.
- **Repro:** View a 70-scoring athlete in the Coach OS roster vs a surface that renders `r.flag`/`r.note`.
- **Root cause:** Two status vocabularies. `status.js:78 athleteStatus` uses `< 80` (`status.js:86`); `roles.js:734 tierFlag` uses ≥80/≥60 and `roles.js:750` note uses ≥80. Legacy roster/trainer render the latter.
- **Files:** `status.js:78,86`; `roles.js:734,750`; consumers `screens/coach.js` (legacy roster list), trainer book.
- **Correction:** Route the legacy roster/trainer rows through `athleteStatus`/`STATUS_META`; delete `tierFlag`/`note` band logic.
- **Tests:** Same-score-same-label test across all coach roster renderers.
- **Migration/security:** None.

### P2-2 · "On-standard = 80" and the tier/grade/quality bands are duplicated ~20× (drift risk, one live inconsistency)

- **Symptom:** Thresholds can drift between surfaces; already, a meal quality of 76–79 reads "Strong" in one place and amber in another.
- **Root cause:** `80` hardcoded in ~15 files (list in C2); tier 90/75/60 duplicated (`day.js:290`, `state.js:120`, `trust.js:195`); grade 90/80/70/60 (`day.js:207`); meal-quality green 75 canonical (`meal-intel.js:242`) vs 80 inline (`state.js:2166`, `trust.js:184,273`, `coach.js:1301`).
- **Files:** as listed in **C2**.
- **Correction:** Centralize thresholds (one `THRESHOLDS`/`tier`/`qualityBand` module) and import everywhere.
- **Tests:** A lint/unit guard that no surface hardcodes 80/75/60 outside the central module.
- **Migration/security:** None.

### P2-3 · No server-side scoring — `days.score` is client-authored; grace/late-policy unenforced server-side

- **Symptom (integrity):** A modified or stale client can post a score the server cannot independently verify; timing settings are honored only if the client honors them.
- **Root cause:** `days.score` written by `pushDay` (`day.js:497`); server only clamps to an evidence ceiling (`0041`) and shape-checks (`0029`); grace/latePolicy validated (`0086`) but never consumed (no `supabase/functions` reader).
- **Files/policies:** `day.js:491-513`; `0041_score_evidence_ceiling.sql`, `0029_score_integrity_upload_guard.sql`, `0055_requirements_engine.sql`, `0086_standard_item_depth.sql`; RLS note `0002_rls.sql:192`.
- **Correction (deferred by design):** Implement the contemplated server-side recompute (a SQL/edge function that recomputes nutrition from `meals` + `requirement_sets` including grace/late-policy) as the authoritative score, with the client value advisory. Until then, keep the evidence ceiling.
- **Tests:** Server recompute parity vs client for a fixture set; tamper test (client posts inflated score → server recompute overrides).
- **Migration/security:** New server function + trigger; **security-positive** (removes client trust from the score). Additive migration.

### P2-4 · "Minting" is misleading on the empty dashboard

- **Symptom:** "Your athlete code is minting… usually a few seconds" can show for loading, offline, and no-team alike, and can persist forever if team creation silently failed.
- **Root cause:** The dashboard branches on `code` truthiness only (`coach-home.js:111-113`), never consults `RT.teamOffline`, and `loadCoachRoster` doesn't hydrate `RT.team` (`coach-data.js`); minting is actually synchronous (`create_team` `gen_join_code`, `0022_schools.sql:45-52`); a failed `create_team` returns false silently (`state.js:1611`).
- **Files:** `coach-home.js:111-113`; `state.js:1188-1207 _loadTeamIntoRt`, `:1800` state getter, `:1607-1611 persistCoachOnboarding`; `roles.js:75 fetchMyTeamIdentity`.
- **Correction:** Distinguish loading/offline/minting on the dashboard (consult `RT.teamOffline`/`RT.teamLoading`), drop the "few seconds" copy (there is no async mint), and surface a real retry when `create_team` failed.
- **Tests:** Dashboard renders the correct one of loading/offline/minting/live for each `RT` state; a failed create surfaces retry, not perpetual minting.
- **Migration/security:** None.

### P2-5 · "Your team is ready" shows before setup is complete (and while the code is still "minting")

- **Symptom:** The green "Your team is ready" banner appears the instant the roster loads empty, above an incomplete setup checklist and even above the "code is minting…" box.
- **Root cause:** Unconditional banner in `emptyTeamDashboard` (`coach-home.js:105-113`), gated only on empty roster (`coach-home.js:237-241`).
- **Correction:** Gate the "ready" language on the real prerequisites (a live code at minimum; ideally standard set), or soften to "Team created — finish setup to go live."
- **Tests:** Banner copy reflects setup/code state.
- **Migration/security:** None.

### P2-6 · Staff invite and group creation have no dedicated flow; "position groups" is a misnomer

- **Symptom:** "Add another staff member" lands inside the dense Coach Profile (now deep-linked/scrolled to the staff section by the recent working-tree change, but still not a standalone invite flow); "Create/Organize groups" opens the roster's multi-select group flow, not a builder; position *rooms* are auto-derived and cannot be hand-created.
- **Root cause:** No `coach-staff` / group-builder routes; staff management embedded in `roles.js:1000 coachProfile`; group creation embedded in `coach-roster.js` select mode. See Part A #4/#5.
- **Correction:** Extract a staff-invite screen and a group builder; settle one grouping vocabulary (rooms vs custom groups).
- **Tests:** Each checklist action terminates on its own action screen.
- **Migration/security:** None (server caps already enforce staff roles, `0078`).

### P2-7 · `coachReview` is written by the editor but never reaches scoring or anywhere client-side

- **Symptom:** The "Coach review on meals" toggle appears to do nothing.
- **Root cause:** `itemsFromKnobs` writes `meal.coachReview` (`coach.js:466`) but `stdFromItems` does not carry it into `STD` (`requirements.js:168-179`), so no client consumer reads it.
- **Correction:** Either wire `coachReview` into a real review surface/flag or remove the control until it does something.
- **Tests:** If kept, assert a reviewed meal surfaces in the coach's review queue.
- **Migration/security:** None.

---

### P3 · Polish / latent

- **P3-1 · Team-Score/code seam.** `.co-pulse` has no bottom margin; the following `.card`/`.sidebox` no top margin → 0 px seam with the aurora bloom bleeding across it (`coach.css:23-41`, `app.css:142`, `screens.css:28`). Add a margin. No true overlap.
- **P3-2 · `minutes_late` record + `requirements.js derive` omit grace** (`state.js:499`→`day.js:598`; `requirements.js:104`). Display/secondary only, but inconsistent with scored on-time; fold grace in when P0-1 is fixed.
- **P3-3 · Missing `type="button"`** on the late-credit and effective-from `<button>`s (`coach.js:630,697-699`). Inert today (no `<form>`), a latent submit bug; add `type="button"`.
- **P3-4 · `DUE_SOON` horizon differs** — 90 min athlete (`exec.js:9`) vs 60 min coach (`status.js:17`). Intentional per-surface, but undocumented; centralize or comment.
- **P3-5 · Share-code checklist checkmark** doesn't repaint until the next render (the Copy/Share handlers set `markCoachSetup('sharedCode')` but don't `__render()`, `coach-home.js:313,320`). Cosmetic.
