# Approved Builds + Sweep 1 — Run Report — 2026-07-12

**Branch:** `fable5/2026-07-12-founder-worklist` (never merged — founder integrates).
**Governing decision:** the 2026-07-12 FOUNDER APPROVED checkpoint (memory Decisions): T3 = Variant A dial-first WITH honest red at 0; T5 = zero-new-data slice only (per-row read persistence / timestamps / dismiss store remain FOUNDER-GATED); T2 integrity = **Rule A** — non-live (gallery) meals are NEVER scored (the single approved scoring-adjacent exception, disclosed to the athlete before they commit a gallery pick); sweep ranking approved as-is, plan.js A1 first.
**Shipped UI:** the vanilla-JS proto WebView at `proto/redesign-2026-07/` (src/screens is legacy, untouched).
**Gate:** `npm run verify` GREEN after every build cycle — 143/143 suites · 1745/1745 tests · expo export OK (recorded in each build commit). `assets/proto.zip` + `src/proto/protoVersion.ts` rebuilt via `scripts/build-proto-zip.mjs` on every code cycle.
**Evidence root:** `.fable5/shots/2026-07-12-worklist/` (all live probes at 390×844 in a real browser via the localStorage/module-seeded Playwright smoke recipe).

## Cycle summary

✅ t2a · approved build (T2 Rule A): non-live (gallery) meals never count toward score/streak — `mealScored()` gates all 6 completion contexts, disclosure at 5 copy points; commit `110609f` + QA fix `89a7538`, verify GREEN, 8/8 acceptance, tag `fable5/2026-07-12-t2a-nonlive-never-scored`.
✅ t3 · approved build (Variant A dial): score number inside the 64px ring, dotted ready-track + no comet at 0, honest muted-red "Off Standard" pill, single "N of TOTAL in · reach POSSIBLE today" line — commit `f4b9438`, verify GREEN, 8/8 acceptance, tag `fable5/2026-07-12-t3-score-dial-build`.
✅ t5 · approved build (zero-new-data slice): read/unread rows off the existing coarse `readNotifs()` model, "Mark all read" header, upgraded empty state, bell badge 9+ cap + aria + 44px iconbtn floor — commit `324bdc0`, verify GREEN, tag `fable5/2026-07-12-t5-notifications-slice`.
✅ plan-a1 · sweep fix: offline/loading no longer masquerade as "coach hasn't set targets" — `{error}` sentinel → `S.planTargetsState` (set > loading > offline > unset) + retry; commit `94b3fc9`, verify GREEN, 5 states + retry live-verified, tag `fable5/2026-07-12-sweep-plan-a1-offline-honesty`.
✅ plan-u1 · sweep fix: shared `components.composer()` gives all 4 real send controls native-button semantics, accessible names, 48px targets; foodsearch glyph stays honestly decorative — commit `f571727`, tag `fable5/2026-07-12-sweep-plan-u1-composer-a11y`.
✅ progress-delta · sweep fix: weekly score delta colors by sign (up green / down red / +0 neutral) instead of always-green; weight delta stays neutral (goal-dependent) — commit `6ea3693`, verify GREEN, tag `fable5/2026-07-12-sweep-progress-delta-color`.
✅ meal-thread · sweep fix: comment-thread load failure gets an honest failure line + 48px Retry on athlete AND coach views ( `{error}` sentinel in `fetchMealComments`, coach refetch-loop guard) — commit `e447aa3`, verify GREEN, tag `fable5/2026-07-12-sweep-meal-thread-failure`.
✅ persona-sim · live persona simulation + fixes: 4 confirmed findings fixed (coach_set_goals silent no-op HIGH; revoked-consent state; Copilot offline card; dead deep-link guard) — commit `0a66a01`; **scope flag: authored migration `0054` (see below)**.
✅ log-water · sweep fix: +8/+16 water taps patch the counter in place instead of replaying the 320ms sheet entrance — commit `37a8710`, tag `fable5/2026-07-12-sweep-log-water-reanimation`.
✅ breakdown-streak · sweep fix: weigh-in copy is time-aware — actionable "Weigh in by 9:00 AM…" before the window closes, reset copy only after — commit `a531092`, verify GREEN, tag `fable5/2026-07-12-sweep-breakdown-timeaware-copy`.
✅ recovery-teardown · audit (no code): ranked 10-item ADD/UPGRADE/REARRANGE/DELETE teardown of the Recovery Check-In projection/feedback surface, grounded in code lines + a live 390×844 smoke — commit `d0d804d`, report `2026-07-12-recovery-teardown.md`, seeds the next batch.

---

## t2a — Rule A: non-live meals never count toward score/streak

**Build (commit `110609f`):** `day.js` gains pure `mealScored(day,k)` gating `effectiveMeals`/`proteinToday` (non-live meals score 0); `projectedDay()` clears `.live` on the reach projection. `state.js` swaps `mealScored(DAY,k)` into the 6 completion contexts (remainingCount, reachPlan, requirements.resolve, metCount, nextMove, exec mstat) plus honest "Gallery photo saved — capture live to count" in requirements.decorate. `camera.js`/`meal.js` disclosure rewritten at all 5 spots (gallery line, analyzing, pre-log analysis ph-s + score-change, post-log thread execTop + gallery line); the thread's +pts score-move block is suppressed for non-live logs. Live meals untouched — `mealScored === !!day.meals[k]` whenever `.live` is unset/true, proven by scoreParity.test.ts staying green.

**Acceptance — 8/8 PASS (live-probed at 390×844):**

| # | Criterion | Result |
|---|---|---|
| 1 | Non-live gallery meal leaves Home score byte-identical; live meal scores identically pre/post-change (scoreParity green) | PASS — non-live dinner 71→71, nutrition 48→48 (components byte-identical); identical live plate 69→83 / 48→75; end-to-end `logMeal` gave `lastMove{from:71,to:71,gain:0}`; scoreParity 16/16 |
| 2 | Non-live meal does NOT satisfy its slot; metCount/remaining unchanged; celebration cannot fire | PASS — metCount=3 (not 4), remainingCount=1, exec.celebration=false; Home shows dinner still open |
| 3 | Streak: non-live-only progress never increments (todayCounted stays false) | PASS — non-live dinner: dayScore 73, todayCounted=false, days=2; identical live dinner: 87, todayCounted=true, days=3 |
| 4 | Gallery pick moment shows explicit won't-count copy before analysis completes | PASS — camera line + analyzing interstitial both carry "won't count toward your score - live capture only" (screenshotted) |
| 5 | Pre-log analysis screen: NON-LIVE badge + won't-count copy, no "counts toward Nutrition (50%)" promise | PASS — hero copy + amber badge; hasCountsTowardNutrition=false |
| 6 | Post-log thread: badge + honest copy, no +pts / "Counted toward Nutrition", still in activity trail + coach-visible | PASS — plus late-case caveat caught by QA (below) and fixed |
| 7 | Requirements list reads honestly for an open non-live slot | PASS — meta "Gallery photo saved", sub "Gallery photo saved - capture live to count", amber, routes to camera |
| 8 | verify green; badge AA; disclosure/controls ≥44px | PASS — verify exit 0; badge amber 12:1; disclosure 5.85:1; Gallery 50×68, shutter 78, Log/Retake 48px. (Pre-existing, not this diff: "Enter Label" 18px tall) |

**QA — 1 confirmed finding, FIXED in-pass (`89a7538`):**
- **CONFIRMED (medium, honesty-correctness):** late non-live meal thread self-contradicted — `meal.js:201` timing `"Logged late · still counts"` was reused for non-live meals, colliding at the exec summary with the newly-added "Won't count toward your score" scoreStatus. Live-reproduced with a gallery dinner logged at 1300 past a 1200 deadline. **Fate: FIXED** — `timing` now branches on `M.live===false` ("Logged late" / "Logged from gallery", no "still counts" claim); live-capture timing byte-identical; browser-verified all 4 late/on-time × live/non-live permutations.

**Files:** `proto/redesign-2026-07/js/day.js`, `js/state.js`, `js/screens/camera.js`, `js/screens/meal.js`, `assets/proto.zip`, `src/proto/protoVersion.ts`.
**Shots:** `t2a-after-home-open.png`, `t2a-after-camera-copy.png`, `t2a-after-analyzing.png`, `t2a-after-analysis.png`, `t2a-after-thread.png` (+ `t2a-before-*.png`).
**Tag:** `fable5/2026-07-12-t2a-nonlive-never-scored`.

## t3 — Score dial (Variant A + honest red)

**Build (commit `f4b9438`):** `scoreRing()` gains `centerNum` (score inside the ring), a dotted "ready" track below score 6, and a spark guard (no comet on an empty ring). `home.js strip()` uses one 64px dial, deletes the redundant `.xsc`/`.xmeta`, folds the projection into "N of TOTAL in · reach POSSIBLE today". `app.css` adds real CSS for `.status-pill.r` (muted red #FF9B9B on `--red-surface`/`--red-border` — previously fell through unstyled). Presentation only; score/met/total/possible values untouched.

**Acceptance — 8/8 PASS (live-probed at 390×844, seeded scores 0/62/82):**

| # | Criterion | Result |
|---|---|---|
| 1 | Number inside the 64px ring, no sibling number | PASS — hasXsc=false, one `.ring-center`, centerNumText 0/62/82 == S.exec.score |
| 2 | Score 0: dotted track, no comet | PASS — `stroke-dasharray='1.4 5'`, `.ring-tip` count 0 |
| 3 | Mid/high: solid arc, exactly one spark, number unchanged | PASS — real scores 62/82; trackDash solid, tipCount 1, number == e.score (mid landed at 62, the state drivable; invariant holds) |
| 4 | Off Standard pill muted red, tier pills styled | PASS — rgb(255,155,155) on rgba(246,87,87,.13)/.30 border; a/b pills visibly styled |
| 5 | "N of TOTAL in · reach POSSIBLE today"; old "score → possible" gone | PASS — "0 of 4 in · reach 63 today" / "2 of 4 in · reach 95 today"; `.xmeta` count 0, no "→" |
| 6 | Pill contrast AA | PASS — measured red 7.94, amber 11.03, blue 7.24, green 10.56 |
| 7 | `.xstrip` single tap target, ≥44px, zero nested data-go | PASS — data-go='score-breakdown', 92px, nested count 0 |
| 8 | verify GREEN, no horizontal scroll | PASS — exit 0; scrollWidth===clientWidth (390===390) all states |

Also spot-checked the score-breakdown hero (larger dial, showCenter path) — no regression from the shared `scoreRing` change (`t3-after-breakdown-hero-check.png`).

**QA:** no confirmed findings.
**Files:** `proto/redesign-2026-07/css/app.css`, `css/screens.css`, `js/components.js`, `js/screens/home.js`, `assets/proto.zip`, `src/proto/protoVersion.ts`.
**Shots:** `t3-after-zero-offstandard.png` (= `t3-after-home-score0.png`), `t3-after-mid-62.png`, `t3-after-high-82.png`, `t3-after-home-score68.png`, `t3-after-home-score82.png`, `t3-after-breakdown-hero-check.png`.
**Tag:** `fable5/2026-07-12-t3-score-dial-build`.

## t5 — Notifications zero-new-data slice

**Build (commit `324bdc0`):** founder-approved coarse read model only — rows unread until existing `readNotifs()` marks everything read (`S.unreadNotifs===0`); **no per-row persistence, timestamps, or dismiss store (still FOUNDER-GATED)**. Unread rows: full level-colored 1px border + faint inset wash + level dot (never a side-stripe). Read rows: dimmed (icon .5, title `--text-2`) with chevron replacing the dot — read state never color-alone. Header: unread count + "Mark all read" wired to existing `data-act=readNotifs`, flipping to a green "All caught up" + inert button at zero. Empty feed: upgraded green check-ring state with a 3-item preview (replaces `.state-demo` for this screen only). Bell in appHead: `role=button`, aria-label with live unread count, badge caps at 9+. `.iconbtn` floor bumped 42→44px (closes the known T5 tech-debt gap); `.apphead .avatar` scoped to 44px; camera.js's inline 40px back-button override untouched (browser-verified).

**Acceptance:** live-probed at 390×844 per the build commit — unread/read/mixed/empty states, the mark-all-read click flow, row `data-go` routing, bell badge cap+aria+size, camera back unaffected; verify GREEN 143/143 · 1745/1745 · expo export OK; no new console errors.
**QA:** no confirmed findings recorded after the build commit (evidence sealed in `8f1af98`).
**Files:** `proto/redesign-2026-07/css/app.css`, `css/screens.css`, `js/components.js`, `js/screens/notifications.js`, `assets/proto.zip`, `src/proto/protoVersion.ts`.
**Shots:** `t5-after-unread.png`, `t5-after-read.png`, `t5-after-empty.png`, `t5-after-click.png`, `t5-unread-multi.png`, `t5-unread-single.png`, `t5-home-bell.png` (+ `t5-before-*.png`).
**Tag:** `fable5/2026-07-12-t5-notifications-slice`.

## plan-a1 — Offline/loading false-negative on Plan targets (sweep headline)

**Fix (commit `94b3fc9`):** `S.planTargets` returned `null` identically for coach-set-nothing / still-hydrating / offline, so an offline athlete with real coach-set targets was told "Your coach hasn't set targets yet." `_loadProfileIntoRt` now destructures the SETTLED `{error}` sentinel, sets `RT.profileLoading`/`RT.profileOffline`, never clears a cached target on a failed refetch. New `S.planTargetsState` getter (set > loading > offline > unset) drives plan.js header, objective card, Coach Targets card (shared sidebox loading / wifiOff+48px Retry via new `act.retryProfile`), Nutrition eyebrow. Genuinely-unset and set copy byte-identical to before.
**Evidence:** verify GREEN; all 5 states + retry recovery live-verified at 390×844 (localStorage+mock-supabase harness, no console errors). Shots: `plan-a1-after-*.png` (11 states incl. QA re-probes), `plan-a1-before-*.png`. **Tag:** `fable5/2026-07-12-sweep-plan-a1-offline-honesty`.

## plan-u1 — Composer accessibility (shared component)

**Fix (commit `f571727`):** notes/meal/coach-comment/coach-note composers rendered an icon-only `<div class="send">` — no accessible name, no keyboard path. New `components.composer()` is the single markup source: native `<button type="button" aria-label>` (Enter+Space, Tab, 48px, focus-visible ring) + aria-labeled input. foodsearch keeps an `aria-hidden` decorative span (its send has no click handler — a button would be a dead control). plan.js, meal.js, coach.js ×2, foodsearch.js all render from the one helper; settings.js `wireComposer` unchanged (selectors already matched).
**Evidence:** live at 390×844 — all four real composers expose the right names, hit 48px, fire on Enter and Space; foodsearch stays non-actionable. Shots: `plan-u1-after-foodsearch.png`, `plan-u1-after-notes-focus.png`. **Tag:** `fable5/2026-07-12-sweep-plan-u1-composer-a11y`.

## progress-delta — Direction-aware score delta color

**Fix (commit `6ea3693`):** `.bigstat .d` hardcoded success-green, so a regressing week rendered green. Base is now neutral `--text-2`; `.up`/`.down` modifiers derive from signed `weekDelta` via parseFloat (+0 stays neutral). Weight delta intentionally stays neutral always — direction is goal-dependent; the pace pill remains the only good/bad signal. No new tokens.
**Evidence:** verify GREEN; positive (+13 green), negative (-36 red), zero (+0 neutral) score deltas + negative weight delta (neutral) live-verified at 390×844. Shots: `progress-delta-after-{positive,negative,zero,weight-neutral}.png`. **Tag:** `fable5/2026-07-12-sweep-progress-delta-color`.

## meal-thread — Honest failure state + retry

**Fix (commit `e447aa3`):** thread had no failure state — a throw/offline left "Loading the thread..." forever (athlete) and could crash the coach view. `roles.fetchMealComments` now returns the `{error:true}` sentinel (mirrors fetchMyTeams); athlete `refresh()` branches to `showThreadError()` (in-place honest line + 48px self-wired Retry, threadBusy-guarded); coach `loadMealComments` gains a re-fetch guard (also fixes a latent refetch-on-every-render loop) and `coachMeal` shows the same failure+Retry instead of feeding the sentinel to `reactionGroups`/`threadMessages` (which would throw). Score, macros, AI opener untouched.
**Evidence:** verify GREEN; offline → failure+retry → restore → recover live-QA'd on both `#meal-detail` and `#coach-meal`; online load unchanged; no refetch loop. Shots: `meal-thread-after-athlete-{failure,recovered}.png`, `meal-thread-after-qa-{athlete-fail,athlete-recovered,coach-fail}.png`. **Tag:** `fable5/2026-07-12-sweep-meal-thread-failure`.

## persona-sim — Live persona simulation, 4 findings fixed

**Fix (commit `0a66a01`):** full multi-persona live walk (coach Marcus, athletes Tasha/Diego/Sam, trainer Priya, parent Karen, guest — evidence in `.fable5/shots/persona-sim/`, incl. FINDINGS.md/LEDGER.md/REPORT.md). All 4 confirmed findings fixed:
- **F-N1 (high):** `coach_set_goals` reported success while saving nothing — UPDATE matched 0 rows for an athlete with no `athlete_profiles` row. Now upserts via **authored-only migration `supabase/migrations/0054_coach_set_goals_upsert.sql`** (verified live on the test project; **NOT applied to prod**).
- **F-C2 (med):** guardian consent shows a distinct "approval was removed" state for a revoked minor (was identical to never-asked); mount() status-capture fix so none/revoked → pending repaints.
- **F-C1 (med):** coach Copilot renders an honest "Can't reach your roster" offline card instead of a stuck loader / false "no athletes".
- **B2 (low):** coach athlete review guards dead/stale deep-links with "Athlete not found" (only once the roster is loaded).

**SCOPE FLAG (founder attention):** this cycle touched `supabase/migrations/0054_coach_set_goals_upsert.sql` — outside the proto-only modify scope, same authored-never-applied lane as `0053_authz_hardening.sql`. Founder applies at go-live after `test:rls`. All other files in the commit are in-scope proto files.
**Evidence:** verified live on the test project (all 4 fixes + real-athlete/receipt regression), typecheck clean, 1745 jest green.

## log-water — Stop water taps replaying the sheet entrance

**Fix (commit `37a8710`):** +8/+16 taps self-wire via `mount()` instead of the router's `[data-act]` auto-wire+re-render, so the counter patches in place without replaying the 320ms sheetUp entrance or resetting scroll. Crossing the 120oz goal still triggers a real re-render (hydration row honestly flips to done). Water math/steps untouched.
**Evidence:** shots `log-water-after-72oz.png`, `log-water-after-goalhit.png` vs `log-water-before-*.png`. **Tag:** `fable5/2026-07-12-sweep-log-water-reanimation`.

## breakdown-streak — Time-aware weigh-in copy

**Fix (commit `a531092`):** `S.weightLine` unconditionally said "your logging streak reset" whenever weight wasn't logged — even before the 9:00 AM window closed. The false branch now splits on `minutesNow() <= WEIGHT_DUE` (existing requirements.js window, reused): before — actionable "Weigh in by 9:00 AM to keep your logging streak."; at/after — the byte-identical missed/reset copy. Late-logged branch untouched. Presentation only.
**Evidence:** verify GREEN; all 3 copy states + the inclusive 9:00 AM boundary live-verified at 390×844. Shots: `breakdown-streak-after-{open-0730,logged-early,logged-late,missed-1400,logged-viareal-action}.png`. **Tag:** `fable5/2026-07-12-sweep-breakdown-timeaware-copy`.

## recovery-teardown — Audit only (next batch seed)

**Doc (commit `d0d804d`):** `reports/2026-07-12-recovery-teardown.md` — ranked, code-line-grounded + live-smoked teardown of the Recovery Check-In (25% of score). Top items: **R1** form omits `hideTabs` → FAB (y743–805) + tab bar (top 748) collide with Submit (bottom 760) and occlude the caption (live-measured); **A1/D1** coachless athletes told "Coach can see your update" (unconditional caption, live-confirmed vs the correctly-branched sidebox); **A2** recovery-confirm reads GLOBAL `RT.lastMove` → "0 → 0 · +0 pts" false celebration + mis-attribution; **A3** points-only projection hides the readiness read-out; **U1–U5** chip magnitude fill, confirm color-forks, coach mentioned 3×, buried payoff, soreness polarity; **A4/A5** projection gain clamp + no completeness affordance; **R2** disclaimer placement. All presentation-only, nothing founder-gated. Smoke shot: `recovery-teardown-form.png`.

---

## Batch integrity notes
- Never merged to master; no deploys; no live DB changes. The one out-of-scope touch (migration `0054`) is authored-only and flagged above.
- Untracked local noise (`.playwright-mcp/`, `.env.prod.bak`, `sim/`, stray root pngs) deliberately NOT committed.
- Remaining gated work: T5 read-state/timestamp/dismiss plumbing; T2 detection backend (pHash/capture-token/model) — spec `reports/2026-07-12-t2-integrity-spec.md`; migrations `0053` + `0054` await founder `test:rls` + apply at go-live.
