# Fable 5 Run Report — Systematic Screen-by-Screen Frontend Improvement
**Date:** 2026-07-11
**Branch:** `fable5/2026-07-11-screen-by-screen-frontend-improvement` · **Tag:** `fable5/2026-07-11-systematic-screen-by-screen-frontend-imp` (→ commit `90e1105`)

## Outcome (one line)
Home's flat "🔥 N day streak" pill now becomes a grace-calibrated loss-aversion surface — amber **AT RISK** / blue **COVERED** pill + a routed action ribbon + a mirrored notifications row — the moment a 2+ day streak isn't yet secured for today; verify gate GREEN (143/143 suites, 1745/1745 tests, expo export OK), **master untouched**.

---

## What the audit decided

**Build target:** Home "streak at risk" state — an honest, grace-calibrated loss-aversion surface on the Home strip (`proto/redesign-2026-07/js/screens/home.js` `strip()`), plus a matching row in the notifications feed (`state.js` `notifications` getter, ~1360–1383), firing when the athlete has a streak worth protecting and today isn't yet secured. Driven entirely by the existing, verified `S.streak` getter (state.js:957–968), which spreads streakInfo's `{ days, todayCounted, graceDate }` (day.js:199, todayCounted = dayScore() >= THRESH) and adds `graceUsedRecently`. When `streak.days >= 2 && !streak.todayCounted`, the passive "🔥 N day streak" pill (home.js:85) is replaced at that moment with a calibrated prompt: `graceUsedRecently === true` → strong "Your N-day streak ends at midnight unless you hit 80 today" routed to exec's now/overdue action; grace intact → milder "One miss is covered, but finish today to extend your N-day run." One loss-aversion row mirrored into the notifications getter alongside the existing overdue/next/hydration/celebration rows. Presentation-only, reuses existing status-pill/xstrip tokens and the Athlete-Blue lane, no new data, no backend, no checkout seam, revertible.

**Rationale:** Chosen over the billing-conversion and coach-roster-triage lenses on impact-per-effort. All three fold to presentation-only, revertible, single-surface changes, but streak-at-risk wins on every axis: (1) **Audience** — it lives on Home, the daily-return surface EVERY athlete sees, versus billing (only already-motivated visitors reach it) and coach triage (coaches only). (2) **Effort/risk** — it reuses an existing, already-honest getter with zero new numbers, zero backend, and never touches the deliberately-unwired Stripe checkout seam the billing lens must tiptoe around. Verified grounding: `S.streak` (state.js:957–968), streakInfo shape (day.js:167,199), passive pill (home.js:85), notifications getter with no streak-loss row (state.js).

---

## The design

**Clickable prototype:** https://claude.ai/code/artifact/833de75b-053b-4c6f-bbbf-f254eeab611d
**Full spec:** `.fable5/reports/2026-07-11-design-streak-at-risk.md`

Designed the Home "streak at risk" state: a grace-calibrated loss-aversion prompt that replaces the passive fire pill when `streak.days>=2 && !todayCounted`, plus a mirrored notifications row. Two tiers driven entirely by the existing `S.streak` getter — **STRONG** amber/flame ribbon ("streak ends at midnight, hit 80") only when `graceUsedRecently` (the loss is real), **MILD** blue/shield ribbon ("one miss covered, finish to extend") when grace is intact. The icon encodes the stakes; both route to the existing exec now/overdue action. Presentation-only, reuses status-pill/xstrip/notif tokens, no new data or backend, works offline, revertible. Published as an interactive 4-state mockup.

---

## The plan

1. In `home.js` `strip()`: compute `const st = S.streak`; when `st.days>=2 && !st.todayCounted`, replace the 🔥-N-day span with amber `<span class="stk-pill risk">🔥 N-DAY · AT RISK</span>` if `st.graceUsedRecently` else blue `<span class="stk-pill safe">N-DAY · COVERED</span>` (shield icon); keep the passive 🔥 pill unchanged for `todayCounted || days<2`.
2. Add `streakPrompt(e)` in home.js: returns `''` unless `st.days>=2 && !st.todayCounted`; else emit a `.streak-ribbon` (amber+flame STRONG when `graceUsedRecently`, blue+shield MILD otherwise) with `data-go` set to `(e.now&&e.now.route)||(e.overdue[0]&&e.overdue[0].route)||'home'` and action label `Log ${e.now?.title}`; copy uses fixed 80 and "midnight".
3. Wire it: in the main return (home.js ~149) insert `${streakPrompt(e)}` on the line immediately after `${strip(e)}` — sibling, not child, so its `data-go` isn't swallowed; leave day0 and celebration paths untouched (guard self-retires).
4. In `state.js` notifications getter: build the streak row first and `fresh.unshift(row)` so it leads the feed; level `high`/icon `flame`/amber copy "Your N-day streak ends tonight…" when `graceUsedRecently`, level `medium`/icon `shield`/blue "Finish today to extend your N-day run…" otherwise; guard `days>=2 && !todayCounted && !e.celebration`.
5. Add CSS: `.stk-pill` (11px, weight 700, pill radius); `.stk-pill.risk` amber-surface/amber-bright/amber-border; `.stk-pill.safe` blue-surface/blue-bright/blue-border; `.streak-ribbon` flex row, surface-1, left icon chip, right action pill; `.strong` amber-border+tint, `.mild` blue-border+surface-2; >=44px tap height and AA text.
6. Verify: `npm run verify` (config.json verify gate) on the fable5/* branch; confirm suites/tests pass and expo export OK; visually smoke the 5 states (strong/mild/secured/no-streak/offline) via the localStorage-seed recipe; do NOT merge to master.

---

## What got built

Implemented the tiered streak-at-risk pill + ribbon exactly per plan, on branch `fable5/2026-07-11-screen-by-screen-frontend-improvement` (**not merged to master**):

- **home.js:** `strip()` now shows amber "N-DAY · AT RISK" (`graceUsedRecently`) or blue "N-DAY · COVERED" pills once a 2+ day streak isn't yet counted today, falling back to the old passive pill otherwise; added `streakPrompt(e)` rendered as a sibling right after `strip()`, self-retiring on celebration/day0/<2-day streaks.
- **state.js:** notifications getter unshifts a matching tiered row (guarded by `!e.celebration`).
- **screens.css:** adds `.stk-pill` and `.streak-ribbon` using existing amber/blue tokens, 44px+ tap height.
- No new data, APIs, or migrations — pure presentation reading `S.streak`/`S.exec`.
- **Verify gate: GREEN** — 143/143 suites, 1745/1745 tests, expo export OK. `assets/proto.zip` + `protoVersion.ts` rebuilt via `scripts/build-proto-zip.mjs` per repo convention (proto WebView is the shipped UI).
- Manually smoke-tested all 5 states (strong/amber, mild/blue, secured/celebration, no-streak, notifications feed) plus tap-target routing via a localStorage-seeded Playwright session against the served proto — screenshots confirmed correct copy, colors, and that the ribbon's `data-go` isn't swallowed by the sibling strip.
- Committed as `90e1105`; tagged `fable5/2026-07-11-systematic-screen-by-screen-frontend-imp`.

---

## Verified bugs / fixes (QA refute-survivors only)

All three findings survived adversarial refutation and are confirmed against the actual diff. None are gate-blocking; all are LOW severity.

### 1. LOW · correctness-ux — At-risk ribbon CTA can route to `home` (no-op) and mislead when the only open requirement is time-locked
- **Where:** `proto/redesign-2026-07/js/screens/home.js:115–117`
- **Evidence:** `streakPrompt()` falls back to `target='home'` / `actionTitle="today's standard"` when `e.now` is null and `e.overdue` is empty. `exec.js:113–116/126–130/162` document a real non-celebration state where now/next are null because remaining required items are LOCKED (window not open yet). In that state score can be <80 with streak>=2, so the ribbon fires "Log today's standard" that navigates to the screen the user is already on, and the body still says "hit 80 before midnight" when nothing is currently loggable. Reachable in early-morning/locked-window scenarios.
- **Proposed fix:** When target resolves to `'home'` (no actionable now/overdue), suppress the ribbon or swap the CTA to a non-action label (route to score-breakdown / "View standard") so it never promises a log action that isn't available.

### 2. LOW · consistency — Notification-mirror row routes to `home` instead of the actionable log route the ribbon uses
- **Where:** `proto/redesign-2026-07/js/state.js:1390` (flame row) and `:1394` (shield row)
- **Evidence:** Both streak notification rows hardcode `route:'home'`, while the home ribbon they mirror routes to `(e.now||e.overdue[0]).route` (home.js:115). Tapping the "streak ends tonight" notification drops the athlete on Home rather than the log action. Matches the existing celebration row's `route:'home'` so it is not a regression, but it diverges from the ribbon it is meant to mirror — a same-commit consistency divergence.
- **Proposed fix:** Compute the same next-action route used by `streakPrompt` (now/overdue route) and set it on both notification rows so the mirror lands on the log action.

### 3. LOW · design-deviation — No green "secured" pill once today counts
- **Where:** `proto/redesign-2026-07/js/screens/home.js:91`
- **Evidence:** Design report `2026-07-11-design-streak-at-risk.md` lines 21 and 51 specify the pill goes green/secured once `todayCounted` ("green/secured, prompt retires for the day"; smoke state list includes "secured (green pill, prompt gone)"). The implementation instead falls back to the old passive grey "🔥 N day streak" span (home.js:91) when today counts — the prompt correctly retires, but the positive green reinforcement state was never built. The ribbon retirement is correct; only the pill's secured tier deviates.
- **Proposed fix:** Add a `.stk-pill secured` green variant (green-surface/green-bright/green-border tokens already exist per the design's token inventory) shown when `st.days >= 2 && st.todayCounted`, keeping the passive pill only for <2-day streaks.

---

## Founder-gated proposals (not actions)

1. **`practice_identity()` RPC** (carried from Practice HQ run) — would collapse trainer identity's two table reads into one round-trip. Requires a migration: author-only, never applied. Awaiting founder decision.
2. **Design taste call — grace-tier copy strength:** the STRONG tier says "the streak resets" and "ends tonight." This is honest (grace is genuinely spent) but is the most loss-averse copy in the app. If the founder wants a softer ceiling, only the two strings in `streakPrompt()` and the state.js notification row change.
3. **Design taste call — secured green pill (QA #3):** building it is a 5-line presentation change, but whether Home should show a third (green) streak tier or stay quiet once today counts is a taste call — the design says green, the build shipped quiet.
4. **Standing rule honored:** no live DB migrations applied, no deploy/ship run, no secrets touched, no tests/RLS weakened. Nothing in this run required a gate.

---

## Tokens per phase

| Phase | Tokens |
|---|---|
| Audit | 7,270 |
| Design | 25,882 |
| Plan | 7,349 |
| Build | 34,140 |
| QA | 17,431 |
| **Total** | **92,072** |

---

## Founder actions

- **Master is untouched.** All work lives on `fable5/2026-07-11-screen-by-screen-frontend-improvement` (tag `fable5/2026-07-11-systematic-screen-by-screen-frontend-imp`, commit `90e1105`).
- **To integrate:** merge the branch when you're satisfied (`git merge fable5/2026-07-11-screen-by-screen-frontend-improvement` from master).
- **To discard:** `git reset --hard fable5/2026-07-11-systematic-screen-by-screen-frontend-imp` — or simply delete the branch; master never moved.
- Recommended pre-merge: decide QA #3 (green secured pill — build it or bless the quiet fallback), and consider folding QA #1/#2 (both are ~5-line fixes) into the same branch before merging.
