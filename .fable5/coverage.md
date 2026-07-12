# Screen Coverage Ledger — screen-by-screen frontend improvement engine

Phase 0 artifact (mandated once per the 2026-07-11 run brief). Every screen in
`proto/redesign-2026-07/js/screens/`, ranked by user impact. Work top-down; no screen skipped.
Ranks are provisional — refine when a screen's teardown reveals its real weight. `index.js` is
the route registry (not a screen); `coach.js` bundles ~9 role screens — track its sub-screens
individually when it comes up.

Status: `pending` → `teardown` → `shipping` → `done`. One improvement per cycle.

| # | Screen (file) | Why this rank | Status |
|---|---|---|---|
| 1 | home.js | Daily-return surface every athlete sees first | **done** (pass 1) — 3 shipped: streak-at-risk `90e1105`, SECURED pill `0485fea`, CTA route fix `2444ce5`; calibration gate PASSED 2026-07-12 |
| 2 | camera.js | Primary log action (photo proof) — the core loop's verb | **done** (pass 1) — error-recovery link fixed (route + dead-tap wiring) |
| 3 | meal.js | Meal detail/log — nutrition is 50% of score | **done** (pass 1) — analysis-failure gets real retry button; phase-timer race fixed |
| 4 | log.js | Action Hub sheet — primary inline write surface | **done** (pass 1) — sync/consent honesty row (mirrors Home's syncBanner) |
| 5 | breakdown.js | Score breakdown — the strip's tap target; where "why is my score X" gets answered | **done** (pass 1) — tier chip on hero ring |
| 6 | checkin.js | Weekly check-in (NOT daily recovery — that's recovery.js) | **done** (pass 1) — preview form made honestly inert (was swallowing taps) |
| 7 | plan.js | Plan tab — coach-set targets, daily reference | **done** (pass 1) — sub-tabs raised to 44px+ |
| 8 | progress.js | Progress tab — retention surface, streak/trend story | **done** (pass 1) — grace-aware current-streak ribbon leads the populated view |
| 9 | notifications.js | Accountability feed — leads with streak row | **done** (pass 1) — pills humanized (urgent/reminder/nice work) + chevrons on routed rows |
| 10 | foodsearch.js | Food search — no-camera path + capture-failure recovery | **done** (pass 1) — 44px pill steppers + dead Clear link wired |
| 11 | profile.js | Athlete profile root — identity hub | **done** (pass 1) — avatar upload: error feedback, no-reload repaint, 44px badge/Edit |
| 12 | weight.js | Weight log — trend-only surface | **done** (pass 1) — "late" label is time-honest (exec window state, not hardcoded) |
| 13 | recovery.js | DAILY recovery check-in — 25% of score | **done** (pass 1) — chips to 44px + radiogroup semantics |
| 14 | requirement.js | Single-requirement detail view | **done** (pass 1) — unknown-id dead end → full empty state with Plan CTA |
| 15 | trust.js | Trust Pass — coach-granted state, low frequency high meaning | **done** (pass 1) — dynamic next-check line + real YOU dot on decay curve |
| 16 | coach.js (coach root) | Coach dashboard — buyer-facing | **done** (pass 1) — stat tiles no longer fabricate zeros while loading/offline |
| 17 | coach.js (trainer root) | Trainer view — Practice HQ adjacency | **done** (pass 1) — honest offline state (outage no longer reads "No clients yet") |
| 18 | coach.js (parent root) | Parent view — payer-facing | **done** (pass 1) — sign-out row added (was a total dead end: hideTabs + no exit) |
| 19 | roles.js | Role screens (6 exports; Practice HQ re-checked, no regressions) | **done** (pass 1) — coachProfile Copy-code copies the displayed server code (was silently copying '') |
| 20 | guardian.js | Guardian consent — minor-athlete gate | **done** (pass 1) — pending state can remind the same parent (prefilled email + inline confirmation) |
| 21 | connect.js | Coach/practice linking | **done** (pass 1) — offline preflight (valid code no longer reads "didn't match") + alert/aria |
| 22 | onboarding.js | First-run flow — one-shot but sets tone | **done** (pass 1) — 44px chrome: .ob-back 34→44, text links get .ob-textlink floor |
| 23 | ob-account.js | Account creation step | **done** (pass 1) — aria labels ×3, pw-eye is a keyboard-operable 44px button |
| 24 | signin.js | Sign-in | **done** (pass 1) — aria labels ×2, Enter submits from email field too |
| 25 | auth.js | Auth shell/welcome | **done** (pass 1) — audited: genuinely simple and correct, no defects; nothing shipped by design |
| 26 | bio-optin.js | Bio opt-in step | **done** (pass 1) — "Not now" gets the 44px .ob-textlink floor |
| 27 | features.js | Feature tour/marketing | **done** (pass 1) — coachVoice fake On/Off toggle → honest Preview pill; fabricated "learned phrases / In use" → "will reinforce / Example" |
| 28 | settings.js | Settings + notifSettings | **done** (pass 1) — quiet-hours copy no longer invites input that doesn't save; .seg buttons 38→44px |
| 29 | reset.js | Password reset | **done** (pass 1) — aria label; post-send button re-enables as "Send again" (was stuck disabled while Enter silently re-fired) |
| 30 | states.js | Dev-only design gallery — NOT user-reachable (no data-go anywhere; registered but unlinked) | **done** — audited reachability, correctly skipped |

## Shipped improvements
- 2026-07-11 · **home** · add: tiered streak-at-risk pill + ribbon + notifications mirror (`90e1105`, tag `fable5/2026-07-11-systematic-screen-by-screen-frontend-imp`) — verify gate GREEN 143/143 · 1745/1745.
- 2026-07-12 · **home** · add: green SECURED pill once today counts — completes the risk/covered/secured tier system (`0485fea`, tag `fable5/2026-07-12-home-secured-pill`) — verify GREEN; 4 pill states verified live at 390px; founder approved.
- 2026-07-12 · **home** · upgrade: streak CTA route fix — locked-window fallback routes to score-breakdown as "View standard" (never a no-op "Log …"), notification rows mirror the ribbon's actionable route (`2444ce5`, tag `fable5/2026-07-12-home-streak-route-fix`) — closes QA #1+#2; verify GREEN; both cases verified live.
- 2026-07-12 · **camera** · upgrade: capture-failure recovery link now routes to food-search (was `log`, whose photo hero loops back to the broken camera) AND is actually tappable — router only wires data-go at render time, so the post-mount note now wires its own click. QA: real decode failure → note → tap → `#food-search` verified live.
- 2026-07-12 · **meal (analyzing)** · add: real failure state — scanline stops, honest error + "nothing was logged" reassurance, 48px green "Retake photo" button (was a 13px gray text tap under a still-animating scan). Also fixes a race: fast failures were overwritten by the 1s phase timer. QA: genuine edge-function failure verified live; evidence `shots/2026-07-12-screens-batch1/after-meal-analyze-fail.png`.
- 2026-07-12 · **log (Action Hub)** · add: sync/consent honesty row mirroring Home's syncBanner — amber guardian-consent row (routes to guardian) or gray "Saved on your phone" offline row, in both sheet modes; healthy sheet byte-identical. QA: error row appears/disappears with SYNC.last, 76px tall, non-interactive; evidence `shots/2026-07-12-screens-batch1/after-log-sync-row.png`.
- 2026-07-12 · **breakdown** · add: tier chip on the hero ring (`tierName`/`tierCls` from `S.tier`, same params Home's ring uses) — the score number now carries instant meaning. QA: chip text/class verified equal to `S.tier` live.
- 2026-07-12 · **checkin (weekly)** · delete: removed deceptive wireToggles on the preview form — chips lit up purple then silently discarded the answer ("did that save?" doubt on a trust-first product). Card is now pointer-events:none + aria-hidden with a 🔒 preview label. QA: tap produces no .on state, 0 toggle groups.
- 2026-07-12 · **plan** · upgrade: sub-tab strip raised from ~39px to 46px (min-height 44px + flex centering) — the screen's core interaction now clears the tap floor. QA: all 4 tabs measure 46px; underline intact.
- 2026-07-12 · **progress** · add: grace-aware current-streak ribbon leads the populated view (same S.streak getter + grace-calibrated urgency rule as Home; secured state = green check + "locks at midnight"; <2 days renders nothing). QA: all 3 states verified live; evidence `shots/2026-07-12-screens-batch1/after-progress-streak.png`.
- 2026-07-12 · **notifications** · upgrade ×2: severity pills humanized (high→URGENT, medium→REMINDER; no more raw enum jargon, colour-independent meaning) and routed rows get a trailing chevron so the streak-save tap is visible. QA: no raw "high"/"medium" text; 2/2 routed rows show chevrons.
- 2026-07-12 · **recovery** · upgrade: nightly chips raised 42→44px (shared .c5 rule; only interactive consumer) + role=radiogroup/radio with live aria-checked. QA: 44px measured, aria flips on tap, projection line still updates.
- 2026-07-12 · **foodsearch** · fix ×2: plate ± steppers were bare ~21px text (`.wb2` needs a `.water-btns` ancestor it didn't have) — now `.chip-row .chp` 44px pills; dead "Clear" link wired (3rd instance of the render-time-wiring bug class). QA: 44px, one line, qty/remove/clear all verified live. NOTE for future audits: `.chp` is scoped `.chip-row .chp` (flows.css:111) — bare `.chp` gets nothing.
- 2026-07-12 · **weight** · upgrade (honesty): button hardcoded "Log Weight (late · trend only)" at all times — now derives late from the exec engine's real window state (overdue/done_late), honest on non-weigh-in days and before 9 AM. QA: Sunday renders no "late".
- 2026-07-12 · **profile** · upgrade: avatar upload — corrupt file now shows inline error (was silent no-op), success repaints in place via window.__render (was a full location.reload white-flash reboot), busy state blocks re-taps, camera badge 22→44px, Edit 40→44px. QA: both paths verified live.
- 2026-07-12 · **requirement** · add: unknown-id case (stale deep-links, removed assigned tasks) now renders a full empty state with icon/sub/56px "Go to your Plan" CTA — was a bare "Nothing here" dead end. QA: CTA lands on #plan; valid ids byte-identical.
- 2026-07-12 · **trust** · fix ×2 (honesty): "Next check: day 5" was a frozen literal — now derived from real t.day (5 → 10 → "both checks cleared"); the decay curve's YOU marker was an invisible r="0" circle with a `? 20 : 20` no-op ternary — now a real dot sitting on the curve at the athlete's actual credit level. QA: all 3 day-bands + dot y-position verified.
- 2026-07-12 · **coach root + trainer root + data layer** · fix (honesty): supabase-js resolves network failures into {error} WITHOUT throwing, so the coach's offline catch was mostly dead and trainer had none — a full client book read as "No clients yet" during an outage. fetchMyTeams/fetchMyPractices now return the {error:true} sentinel (settled fetchMyPracticeIdentity pattern), loaders throw on it, trainer gets the same "Can't reach your clients" state-demo as coach, and coach stat tiles show "—" instead of fabricated green-0/red-0 while loading/offline. QA: real fetch-rejection drill verified both roots + tiles; genuine empty still reads "No clients yet".
- 2026-07-12 · **parent root** · add: sign-out row (same .lrow pattern as coach/trainer profiles) — the parent pending screen was a total dead end (hideTabs, no exit affordance). QA: 68px row routes to welcome.
- 2026-07-12 · **connect** · fix (honesty+a11y): offline athlete typing a VALID code was told "that code didn't match" (joinByCode's RPC error conflation) — definitive-offline preflight now shows the honest connection message without calling the RPC; error node gains role=alert/aria-live; input gains an accessible name. QA: offline drill verified, button never enters "Connecting".
- 2026-07-12 · **roles (coachProfile)** · fix (functionality): Copy-code copied RT.ob.teamCode (onboarding scratch — empty on fresh-device sign-in) while displaying the server code: silent empty clipboard. Now copies S.coachIdentity.code first (trainerProfile pattern) + "Copied" label reverts after 1.6s. QA: clipboard spy captured the displayed code with RT.ob empty.
- 2026-07-12 · **guardian** · upgrade: pending state could not remind the SAME parent (empty input + "wrong address?" framing forced a retype) — now prefills the stored guardian email, button reads "Send reminder", success shows green inline confirmation instead of an invisible identical repaint. Consent logic untouched. QA: prefill + confirmation verified with stubbed action.
- 2026-07-12 · **onboarding (+ob flows in roles.js)** · upgrade (a11y): .ob-back 34→44px and the three ~18-32px text links (Skip for now / Remove connection / I have a coach code) get a shared .ob-textlink 44px floor. QA: 44/44/44 measured at 390px.
- 2026-07-12 · **signin + reset + ob-account** · upgrade (a11y+interaction): 6 placeholder-only inputs gain accessible names; Enter submits from signin's email field; reset's post-send button re-enables as "Send again" (was permanently disabled while Enter could silently re-fire — now guarded); pw-eye is a keyboard-operable 44px role=button with live aria-pressed. QA: all verified live incl. Enter/Space toggle.
- 2026-07-12 · **features (coachVoice)** · delete (deceptive interactivity): the "Speak as {coach}" On/Off toggle persisted nothing, defaulted On, with zero disclosure — now an honest amber Preview pill; fabricated "Phrases it learned from you"/"In use" reframed to "Phrases it will reinforce"/"Example". QA: toggle gone, 4 Example pills, no console errors.
- 2026-07-12 · **settings (notifSettings)** · upgrade (honesty): quiet-hours copy invited "set your preference here now" over controls that persist nothing — now says the controls are a preview and don't save yet; shared .seg buttons 38→44px. QA: copy + 44px verified.
- 2026-07-12 · **bio-optin** · upgrade (a11y): "Not now" escape was a bare ~32px div — now .ob-textlink 44px. QA: 44px measured.
- 2026-07-12 · **auth.js** · audited, nothing shipped: static welcome with two correctly-wired CTAs — genuinely simple and correct.
- 2026-07-12 · **states.js** · audited: dev-only gallery, no data-go link anywhere in the codebase — not a shipping surface.

## Home — teardown v1 (pass 1 complete)
- **ADD (shipped):** streak-at-risk state `90e1105`; green SECURED pill `0485fea`.
- **UPGRADE (shipped):** CTA route fix + notification mirror consistency `2444ce5`.
- **REARRANGE (shipped):** ribbon as sibling directly under strip.
- **DELETE:** nothing clearly dead found.
- **Open observation (pass 2 candidate):** evening all-overdue state renders "NEXT/LATER" group labels over rows that all carry OVERDUE pills — hierarchy reads contradictory (seen in 390px smoke 2026-07-11).

## Pass 2 candidates (from batch teardowns, ranked)
- **plan #1 (trust):** `S.planTargets===null` collapses "coach set nothing" / "still hydrating" / "offline fetch failed" into the definitive "Your coach hasn't set targets yet" (plan.js:47,62,74) — offline athletes with real targets are told their coach set nothing. Copy-level fix possible; a `profileLoading` flag would be cleaner (state.js change — keep in scope, it's presentation-supporting).
- **progress (token bug):** `.bigstat .d` hardcodes green (screens.css:180) but weekDelta can be negative — a down week renders success-green. 1-line conditional class.
- **camera #2 (a11y):** `.vf-tool` 40px and camera back button inline-shrunk to 40px — under the 44px floor.
- **checkin #2 (rearrange):** real "Latest readiness" card renders below the dead preview form — real data should lead.
- **meal #2:** thread comment load has no failure state (refresh() unguarded — "Loading the thread…" forever on a throw).
- **camera #3 (honesty):** fake "LIVE" pill over a static blurred stock photo in the simulated viewfinder.
- **log R2 (perceived speed):** every +8/+16 water tap replays the 320ms sheetUp entrance animation + scroll reset (data-then="log" re-render).
- **breakdown (copy honesty):** "Missed today … your logging streak reset" shows all day before the weigh-in window has even passed (S.weightLine is boolean-driven, not time-aware).
- **notifications (delete-flag):** "Earlier today" branch is dead (getter always returns earlier:[]) — placeholder contract, founder call.
- **shared a11y:** `.c5` chips 42px (screens.css:159) and `.back-head .bk` 40px (app.css:365) — shared-component bumps, not per-screen forks.
- **plan #4 (a11y):** Notes composer send control is an icon-only div with no accessible name (shared wireComposer pattern).
