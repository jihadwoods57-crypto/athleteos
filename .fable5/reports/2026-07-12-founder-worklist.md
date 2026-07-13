# Fable 5 — Founder Worklist Run Report

**Date:** 2026-07-12 · **Branch:** `fable5/2026-07-12-founder-worklist` (branched from `c3055b3`) · **HEAD:** `e9f3509`
**Verify gate:** GREEN after every build ticket — 143/143 suites, 1745/1745 tests, expo export OK (`npm run verify`).
**Master:** UNTOUCHED. Nothing was merged; merging is the founder's call.
**Shots:** `.fable5/shots/2026-07-12-worklist/` · **Run tag:** `fable5/2026-07-12-founder-worklist-run`

Run shape: 3 built tickets (T1, T2, T4), 2 design-only approval gates (T3, T5), 1 security hardening batch,
1 pass-2 sweep calibration gate. Every claim below is grounded in a commit, screenshot, or live-browser probe at 390×844.

---

## ✅ t1 · build: Log Meal — killed the fake meal image, fake LIVE pill, and fake flash/flip controls — commit `d41fa6f`, tag `fable5/2026-07-12-t1-kill-fake-meal-image`, verify GREEN 1745/1745

Removed the hardcoded `assets/meal-lunch.jpg` background and the fake green "LIVE" pill from the camera capture
viewfinder (`js/screens/camera.js`), replacing them with an honest empty state: camera glyph in a lens circle,
centered "Take a photo to analyze" prompt, and a hint line. Also removed the fake flash/flip `.vf-tool` controls
and their `mount()` listeners (they only made sense over a nonexistent live preview, and were a known sub-44px
item). The four `.vf-corner` framing guides and the real data-driven `.vf-deadline` pill (`L.remaining`) are
unchanged; the shutter → file input → `captureMeal` → `#analyzing` capture path is untouched. New `.vf-empty` CSS
reuses existing tokens only (`--text`, `--text-3`, `--hairline`, `--title-tight`); dead `.vf-img`/`.vf-tools`/`.vf-tool`
rules removed. `assets/proto.zip` + `src/proto/protoVersion.ts` rebuilt.

**Files:** `proto/redesign-2026-07/js/screens/camera.js`, `proto/redesign-2026-07/css/screens.css`, `assets/proto.zip`, `src/proto/protoVersion.ts`

**Acceptance (7/8 PASS, 1 partial — verified live via Playwright at 390×844 against localhost:8124):**
1. ✅ No element with a jpg/meal background — probed every `.cam` node: 0 background-image hits, 0 inline jpg styles; viewfinder is a pure CSS radial gradient.
2. ✅ No "LIVE" text anywhere — `viewfinder.innerText` and `.cam` textContent both clean.
3. ✅ Four `.vf-corner` guides present, 34×34 each, visible (z-index 3).
4. ✅ Centered "Take a photo to analyze" prompt with SVG camera glyph inside `.vf-empty`.
5. ✅ Real `.vf-deadline` pill still renders `S.logging.remaining` (but see QA #2 below).
6. ✅ Zero `.vf-tool`/`.vf-tools` elements; CSS + mount wiring removed.
7. ✅ Shutter still triggers `#cam-file.click()` (verified via stub); `accept=image/*`, `capture=environment`; downscale → `captureMeal` → `analyzing` unchanged.
8. ⚠️ Tap targets all ≥44px (cbtn 50×50, shutter 78×78) and no new colors — but the new hint text fails AA contrast (QA #1).

**Screenshots:** `t1-before-viewfinder.png`, `t1-before-priming.png`, `t1-after-capture.png` (committed in `066b803`).

**Confirmed QA findings (both real, both caused by this diff, both OPEN — fixes proposed, not yet applied; verified still in-tree at report time):**
- **QA #1 (medium · accessibility):** new `.vf-hint` uses `--text-3` (#7C8BA6) over the viewfinder gradient — measured 4.13:1, below the AA 4.5:1 floor for 12.5px/600 text (`css/screens.css:56`). **Proposed fix:** switch to `var(--text-2)` (#9AA9C2, ~5.2:1 even on the brightest stop; existing token, no fork). **Fate: OPEN → logged in memory Tech Debt.**
- **QA #2 (low · ux-copy):** the amber `.vf-deadline` pill renders `L.remaining`, which in the only reachable pre-capture state is literally "Take a photo to analyze" (`state.js:1233`) — byte-identical to the new prompt, so the phrase shows twice and the clock affordance conveys no time (`camera.js:62`). **Proposed fix (presentation-only):** hide the pill when `L.empty`, or fall back to `L.due` ("Due by 10:00 AM"); never alter `L.remaining` data. **Fate: OPEN → logged in memory Tech Debt.**

---

## ✅ t2 · build: Log Meal — Gallery works, with honest non-live disclosure end-to-end — commit `dce7558`, tag `fable5/2026-07-12-t2-gallery-integrity`, verify GREEN 1745/1745

The Gallery tile on the camera screen (previously a locked no-op) is now live. A second hidden file input
(`#cam-gallery`, `accept=image/*`, **no** `capture` attribute → OS photo library) funnels through a refactored
`pick(inputEl, live)` helper shared with the shutter. Gallery picks are flagged non-live end-to-end:
`MEAL.live` → `logMeal` meta → `DAY.slotMacros[slot].live` (scoring math in `day.js` untouched — `dayLogMeal`
only sets a passthrough flag; `computeScore` never reads `.live`). A shared `components.nonLiveBadge()`
(reuses `.status-pill.a`, measured 12.06:1 contrast) plus "Live capture only for scored meals" copy renders on
`#analyzing`, `#meal-analysis`, and the meal-thread breakdown whenever the meal is non-live. Shutter captures
show nothing new.

**Files:** `proto/redesign-2026-07/js/state.js`, `js/day.js`, `js/components.js`, `js/screens/camera.js`, `js/screens/meal.js`, `assets/proto.zip`, `src/proto/protoVersion.ts`

**Acceptance (8/8 PASS — live localStorage-seeded Playwright smoke at 390×844):**
1. ✅ Gallery tile enabled: opacity 1, image icon (not lock), tap target 50×68px.
2. ✅ `#cam-gallery` has `accept=image/*` and `hasCapture=false` in DOM (`#cam-file` keeps `capture`); tap opens the file dialog (self-wired in mount, per SETTLED router rule).
3. ✅ Gallery pick routes to `#analyzing` with the amber NON-LIVE badge visible.
4. ✅ `#meal-analysis`: badge in the photo hero + "Live capture only for scored meals" copy present.
5. ✅ Meal-thread: badge + "picked from your gallery" copy for the gallery meal; a control shutter meal shows NO badge anywhere.
6. ✅ Console: gallery → `MEAL.live===false`, after log `DAY.slotMacros.breakfast.live===false`; shutter path stays live.
7. ✅ Score/macros identical on both paths — no scoring divergence observed, and code-proven (`day.js:363` writes metadata only).
8. ✅ Badge is the shared `.status-pill.a` token — no per-screen color fork.

**Screenshots:** `t2-after-camera-gallery.png`, `t2-after-analyzing.png`, `t2-after-meal-analysis.png`, `t2-after-thread.png` (committed in `c248d46`), plus `t2-before-1/2.png`.

**Confirmed QA finding (real, caused by this ticket, OPEN — verified still in-tree at report time):**
- **QA (low · correctness-consistency):** `MEAL.live` leaks into manual entries — `captureManual` (`state.js:340`) never resets the flag, and `clearMeal` (the only reset) has zero call sites. Reproduced live: Gallery pick → back out → food-search log stamps NON-LIVE on a manual entry. **Proposed fix:** add `MEAL.live = true;` at the top of `captureManual` (manual entries are not photo captures; presentation-only, no score impact). **Fate: OPEN → logged in memory Open Bugs.**

### 🔒 FOUNDER-GATED PROPOSAL — live-capture integrity enforcement (spec committed, nothing built)
Full spec at `.fable5/reports/2026-07-12-t2-integrity-spec.md` (commit `ced5770`). Decision needed:
- **Enforcement rule:** **Option A (recommended)** — non-live meals log and show macros but contribute 0 to the Nutrition component and don't extend the streak (needs no detection stack; honest floor). **Option B** — score only if verified fresh (capture timestamp within N min AND not a prior submission).
- **Detection methods (all backend/model work, all gated):** EXIF freshness (weak/spoofable), server-side perceptual-hash reuse check (needs column + migration), in-app live capture-token required by analyze/insert endpoints (strongest anti-farming; auth work), AI liveness signal from `analyze-meal` (model work).
Until you decide, non-live meals flow through scoring unchanged; only the honest badge + copy set expectations.

---

## ✅ sec · hardening: guardianships self-appoint (CRITICAL) + plan_assignments IDOR (HIGH) closed; AI spend fairness — commit `b78f8ec`, verify GREEN 1745/1745, migration authored NOT applied

Full audit at `docs/SECURITY-AUDIT-2026-07-12.md` (4 parallel read-only auditors; every CRIT/HIGH/MED finding
adversarially re-verified against all 52 migrations before any fix).
- **C1 (CRITICAL, fixed in authored `0053_authz_hardening.sql`):** `guardianships` never got the `0038` self-insert
  fix its sibling link tables got — any signed-in user could appoint themselves guardian of anyone (PII read +
  minor-messaging bypass). `0053` drops `g_manage`, adds revoke-only policies, no INSERT policy (service-role/RPC
  only) + `REVOKE INSERT`. New probes in `rls_authz_test.sql §3b`.
- **H1 (HIGH, fixed in `0053`):** `plan_assignments` IDOR — `WITH CHECK` never verified plan ownership or athlete
  visibility. Feature not yet client-wired, so hardening breaks nothing.
- **M1:** per-caller AI spend fairness caps completed (`analyze-meal` finalize now counts; `assist` gained a cap;
  `plan-generate` now fails closed).
- **L1–L3:** password policy 6→8 + letters_digits; `verify_jwt=false` pinned for the 3 unpinned functions;
  `analyze-meal` magic-byte MIME sniff.

**⚠️ FOUNDER GO-LIVE ACTION:** migration `0053` is **authored only — NOT applied to the live project** (per
guardrail: never apply live DB migrations). You apply at go-live after `test:rls`. Note: this commit touched
`supabase/**` + `docs/**`, outside the proto-only modify scope — flagged here for your review rather than hidden;
it is security-critical, test-gated, and applies nothing to live.

---

## ✅ t3 · design: Home score box + score circle redesign — DESIGN ONLY, clickable prototype for approval — commit `402f85f`, no app code touched

Rationale at `.fable5/reports/2026-07-12-t3-design.md`. Grounded findings from the live strip at 390×844:
the ring's comet-spark floats orphaned at 12 o'clock when score=0; `tier(0)` returns `cls:'r'` but
`.status-pill.r` has **no CSS** so "Off Standard" renders unstyled; the big number duplicates the ring; the
"`0 → 63`" meta is unexplained. The redesign consolidates into a single score dial (number inside the ring,
dotted "ready" ring at 0 with no orphaned spark, honest tier pill at every tier including a real muted-red
"Off Standard", labeled requirement segments, "reach 63 today" projection) — all from existing tokens, one strip,
one `data-go="score-breakdown"` (SETTLED patterns honored). Presentation only: score/met/total/projection pass
straight through from `S.exec`.

**Screenshots:** `t3-current.png`, `t3-current-full.png`, `t3-A-dial-0.png`, `t3-A-dial-82.png`, `t3-B-progress-82.png`, `t3-celebration-hero.png`, `t3-prototype-390.png` (committed in `f020fc8`).

### 🚧 FOUNDER APPROVAL GATE — nothing is built until you pick
**Prototype:** https://claude.ai/code/artifact/1d7ec88b-a131-42ab-9aa3-0e5c9be62e2b
1. Approve **Variant A — Dial-first (recommended)**, or Variant B — Progress-first (task-forward alternative)?
2. Keep the honest red "Off Standard" treatment at 0, or prefer neutral/slate so a fresh day doesn't open red?

---

## ✅ t4 · build: Profile — avatar camera badge sized to the design, 44px hit target kept — commit `06568b2`, tag `fable5/2026-07-12-t4-avatar-camera-badge`, verify GREEN 1745/1745

The camera badge was a single 44px `.req-badge` element — oversized next to the 62px avatar. Split into a
transparent 44×44 hit box (`#avatar-btn`, still bound by `mount()`, now with `aria-label="Upload photo"`) containing
a 28px visible `.req-badge b` circle, camera icon bumped 12→14 to stay proportionate. One-line presentation change;
upload wiring untouched. `proto.zip` + `protoVersion.ts` rebuilt.

**Files:** `proto/redesign-2026-07/js/screens/profile.js`, `assets/proto.zip`, `src/proto/protoVersion.ts`
**Screenshots:** `t4-before-full.png`, `t4-before-avatar-closeup.png`, `t4-after.png`, `t4-after-badge.png` (committed in `f020fc8`).
**QA:** no confirmed findings.

---

## ✅ t5 · design: Notifications upgraded — DESIGN ONLY, clickable prototype for approval — commit `60c6d8a`, no app code touched

Rationale at `.fable5/reports/2026-07-12-t5-design.md`. Current screen is honest but a flat list: no per-row
read/unread state (read is one boolean, `RT.notifsRead`), every timestamp is the literal string `'now'`, and the
`earlier` group is hard-coded `[]`. The design keeps a **routed full screen** (drawer rejected: rows are actionable
accountability moments, the route already exists, and a drawer is a per-surface fork SETTLED memory forbids).
Upgrades, all inside existing tokens: per-row unread treatment (level-colored full border + dot — deliberately no
side-stripe; never color-alone), read rows dimmed but AA (8.3:1 / 5.7:1), header "N unread · Mark all read" mapping
1:1 to the existing `readNotifs()`, swipe-to-dismiss with undo, a real caught-up empty state, badge capped at 9+
with proper aria, bell/back held to the 44px floor (currently 42px).

**Screenshots:** `t5-current.png`, `t5-proto-unread.png`, `t5-proto-mixed-B.png`, `t5-proto-empty.png`, `t5-proto-entry.png` (committed with this report).

### 🚧 FOUNDER APPROVAL GATE — nothing is built until you pick
**Prototype:** https://claude.ai/code/artifact/61f0ebdb-f9bb-4cd1-a318-92711605b736
1. Approve **Variant A — group by recency (recommended)**, or Variant B — group by consequence (duplicates Home's urgency taxonomy)?
2. Shippable now with zero new data: header summary + Mark-all-read, empty state, row layout, badge cap/aria, 44px floor. **Gated (needs data plumbing):** per-row persistent read state and real timestamps (today read is all-or-nothing and `when` is always `'now'`) — approve the plumbing before that half is built.

---

## ✅ sweep · calibration gate: pass-2 ranked list + plan.js teardown — commit `e9f3509`, docs only

### 🚧 CALIBRATION GATE — the pass-2 sweep starts only after you bless this ranking
Full document at `.fable5/reports/2026-07-12-sweep-calibration.md`. Top of the ranked list (29 screens ranked,
`states.js`/`index.js` excluded as non-shipping):
1. **plan.js** — daily coach-set reference; offline/loading false-negative tells athletes "coach set no targets" (data honesty); TOP backlog item
2. **progress.js** — `.bigstat .d` hardcodes green so a negative week renders success-green (number honesty)
3. **recovery.js** — 25% of score, daily; projection/feedback surface unexamined in pass 1
4. **meal.js** — thread-comment load has no failure state (loads forever on a throw)
5. **log.js** — water taps replay the 320ms sheet entrance + scroll reset (perceived speed)
6. **breakdown.js** — "streak reset" copy shows before the weigh-in window passes
7. **home.js** — residual NEXT/LATER-vs-OVERDUE hierarchy (score box already designed in T3)
…through 24 low-residual screens (full table in the doc).

**First teardown (#1, plan.js), headline items:** A1 — `S.planTargets` (state.js:976–982) returns `null`
identically for coach-set-nothing, hydrating, AND offline, and plan.js asserts "coach hasn't set targets yet"
definitively — an offline athlete with real targets is told their coach set none; resolve into 3 honest states via
the SETTLED `{error:true}`/loading sentinel. A2 — notes thread has no load/error state. A3 — Ask-AI composer has no
pending/failure feedback (FOUNDER-GATED if it wires a real AI backend). Plus a11y on the composer (U1), deduped
macro blocks (U2), targets-lead-when-set (R1), and a founder flag on "Build Your Plate"/"Approved Swaps" reading as
coach-authored when they're static seed (D1 — do not silently drop).

---

## Founder decision queue (everything waiting on you)

| # | Decision | Where |
|---|----------|-------|
| 1 | Merge (or not) branch `fable5/2026-07-12-founder-worklist` — master is untouched | this branch |
| 2 | T3 score-box: Variant A vs B + red-at-zero question | prototype https://claude.ai/code/artifact/1d7ec88b-a131-42ab-9aa3-0e5c9be62e2b |
| 3 | T5 notifications: Variant A vs B + read-state/timestamp plumbing | prototype https://claude.ai/code/artifact/61f0ebdb-f9bb-4cd1-a318-92711605b736 |
| 4 | T2 integrity enforcement: Option A vs B + detection method authorization | `.fable5/reports/2026-07-12-t2-integrity-spec.md` |
| 5 | Apply migration `0053_authz_hardening.sql` at go-live (after `test:rls`) | `docs/SECURITY-AUDIT-2026-07-12.md` |
| 6 | Bless the pass-2 sweep ranking (plan.js first) | `.fable5/reports/2026-07-12-sweep-calibration.md` |

Open QA debt from this run (t1 hint contrast, t1 deadline-pill duplication, t2 captureManual live-flag leak) is
logged in memory and queued for pass 2 — all three have proposed one-line, presentation-only fixes.

Note: the prototype source files `.fable5/proto/t3-score-box.html` / `t5-notifications.html` exist locally but are
left uncommitted per this run's commit discipline (report + memory + shots only); the artifacts above are the
canonical review surfaces.
