# Athlete Experience Overhaul — Traceability & QA Report

**Date:** 2026-07-16 · **Branch:** `compliance-fixes` (commits `60e6179` → `4c6a71a`) · **Target:** `proto/redesign-2026-07` (the shipped WebView athlete UI)
**Source of truth:** `onstandard_athlete_experience_improvement_spec.md` (handoff package)
**Verification:** `npm run verify` green (154 suites / 1,900 tests, typecheck, XSS lint, bundle export) · in-browser Playwright pass · `assets/proto.zip` rebuilt (`bc2f8508d5df2fa9`)

---

## 1. Traceability — every spec section → implementation

| Spec § | Requirement | Where | Status |
|---|---|---|---|
| 1.5 / 10 | Per-tab nav stacks, back → exact origin + scroll, correct tab highlight, swipe-back parity | `js/nav-stack.js` (new, tested), `js/router.js` (`data-back`, transient screens, history-replace through flows), `components.js backHead` | **Done** — verified in-browser: Home@250 → breakdown → back → Home@250; Profile stays lit on detail screens |
| 10.2 | Remove Back Home / Back to Profile buttons | checkin, recovery, trust, streak, meal thread, foodsearch, connect | **Done** — header back (stack-aware) is the one exit |
| 1.6 / 25 | No prototype/developer language (41 audited leaks) | settings, features, profile, checkin, home, log, state, foodsearch | **Done** — final sweep clean; devices/partner/squad/billing routes redirect safely |
| 1.7 | Bottom safe-area | global 128px viewport padding (pre-existing, confirmed) | **Done** |
| 2.2–2.4 | Category hierarchy, exact point loss, expandable per-requirement math | `js/breakdown-model.js` (new, pure, tested) + `screens/breakdown.js` | **Done** — recovery names the answers that cost points; every category shows remaining, guaranteed vs "up to" |
| 2.5 | Daily Commitment substance | `screens/commitment.js` (new): written intention (persists in the day's jsonb, coach-visible) + honest end-of-day reflection (engine: 15/9/0) | **Done** — verified live: partial = exactly +9 |
| 2.6 | "How to reach" mathematically exact | reach rows are marginal gains on the ceiling path; **sum exactly** to `maxPossible − score` (unit-tested); header says "up to" whenever variable | **Done** |
| 2.8 / 2.9 | Weight copy; visual refinements | breakdown weight card uses spec copy; reduced ring glow, low-contrast weight pills, tighter rhythm | **Done** |
| 3 | Quick-action sheet: hierarchy, completed collapsed, water units, offline copy, "completed" language | `screens/log.js` — NOW hero first (already exec-driven), commitment row added, "N of M completed", "Waiting to sync" | **Done** |
| 4 | Camera: guidance, no Enter Label, score line, secondary manual | `screens/camera.js` — "Photograph everything you're having" + checklist, "earn up to N points" (engine-exact), label entry moved into Log-without-a-photo | **Done** |
| 5 | Review step: header copy, Retake vs Choose another, completeness chips, invisible-details field, Analyze meal, neutral gallery badge | `camera.js cameraConfirm` — note rides the analysis request (`athleteNote`) and persists with the meal (`userNote`, shown in the thread) | **Done** |
| 6.1 | Full-screen image viewer | `js/image-viewer.js` (new): pinch, double-tap, pan, swipe-down, X; DOM overlay so scroll position is inherently preserved; wired on analysis, thread, historical meal view | **Done** |
| 7 | Meal photos render everywhere; honest placeholder | `js/photo-store.js` (new signed-URL cache) feeding Home Recent Results, revisited analysis, thread, history; "No photo submitted" only for manual/label logs | **Done** |
| 8 | Progress: day-one baseline, exact 3-day unlock, weight CTA, category trends, one insight | `screens/progress.js` rebuilt; `days` history fetch now carries meals/checkin jsonb → **real** per-category trends via the same `computeComponents`; insight priority: late-meal pattern → falling category → weakest → weekly-average nudge | **Done** |
| 9 / 11 | Profile IA; Edit Profile (first/last, DOB, dynamic positions, school search, dirty-save, unsaved warning) | `screens/profile.js` — one Connect card unconnected; coach card connected; DOB feeds the real minor gate; positions per sport; org-directory school search | **Done** |
| 12 | Connect: code → real preview → confirm; input behavior | `screens/connect.js` — `org-directory preview_code` shows the real team/coach/school; paste/uppercase/format-gate; degrades to direct redeem when the directory is unreachable | **Done** |
| 13 | Notifications: state-aware engine (already shipped 2026-07-16), tone vs urgency, locks, no dup controls, copy | `notify-plan.js` framework pre-existing (cancel-on-complete, dedupe, coalesce, quiet hours); settings gained Supportive/Direct/Intense tone (wording only), lock icons + explanation on coach urgency, real haptics pref, duplicate pressure control removed from Units | **Done** |
| 14 | Streak: grace framing, Mon–Sun calendar, lives in Progress | `screens/trust.js streak` + `S.streakCalendar`; "Today is still live…" copy; "Weekly grace available: N"; grace applies after day close | **Done** |
| 15 | History: real photos/time/late/score, naming, tap → analysis | `screens/trust.js history` — real `meals` rows (14 days) grouped under real day scores; **Activity History** everywhere; past meals open a read-only meal view (`meal-view/<id>`) with zoom | **Done** |
| 16 | Weekly check-in: compact closed state, anchors, correct soreness, no proto copy | `screens/checkin.js` rebuilt — Sunday renders the REAL six-question form through the same check-in engine | **Done** |
| 17 | Discipline record: real stats, verification gate, private-by-default | `screens/features.js recruiting` — days tracked / all-time avg / on-standard % / streaks / date range; "Not verified yet" without a coach | **Done** |
| 18 | Restrictions: 3 sections, severity, custom entries, honest safety language, severe-conflict alert | `features.js restrictions` + `RT.restrictions` + `meal-intel restrictionConflicts` (pure, tested, synonym-aware) — the meal analysis now runs a REAL comparison and never claims guaranteed safety | **Done** |
| 19 | Injury: role boundaries, athlete reports, privacy | `features.js injury` — report action, "who does what" card, privacy + urgent-care note | **Done** |
| 20 | Privacy: plain language, dynamic roles, per-role detail, Download my data, no body-photos claim | `settings.js privacy` + `act.exportMyData()` (real RLS-scoped JSON download) | **Done** |
| 21 | Billing hidden until functional | route redirects to profile; rows removed from athlete/coach/trainer profiles | **Done** |
| 22 | Units focused; no "· soon"; appearance ×3; no dup reminder controls | `settings.js settings` | **Done** — dark/light/system verified in-browser |
| 23 | Legal: separate links to real docs | `settings.js terms` → live `onstandard.app/terms` + `/privacy` (web/landing pages exist), in-app export/deletion, contact | **Done** |
| 24 | Empty states constructive, no dashed non-interactive borders | progress baseline, privacy no-connections card, history empty | **Done** |

## 2. Files changed

**New modules:** `js/nav-stack.js`, `js/breakdown-model.js`, `js/image-viewer.js`, `js/photo-store.js`, `js/screens/commitment.js`, plus `meal-view` route (in `trust.js`).
**Rewritten screens:** breakdown, camera (+confirm), progress, checkin, connect, restrictions/injury/recruiting (features.js), privacy/terms/notif-settings/units/billing/messages (settings.js), streak/history (trust.js), profile + edit-profile.
**Modified core:** router.js (nav stacks), state.js (explain/reach getters, photo resolution, export, restrictions, focus), day.js (commitmentFocus + mealLoggedAt persistence, history jsonb, `dayFromHistoryRow`, `checkinReal` export), exec.js (tone label mapping), meal-intel.js (restriction comparison), components.js (backHead, safeImg storage URLs, neutral badge), icons/CSS.
**Tests:** `src/core/navStack.test.ts`, `src/core/breakdownModel.test.ts` (new); `protoCameraCapture.test.ts` updated to spec'd copy.
**Shipped asset:** `assets/proto.zip` + `src/proto/protoVersion.ts` (version `bc2f8508d5df2fa9`).

## 3. Migrations / environment

**None required.** All new persisted fields ride existing jsonb columns (`days.checkin` gains `focus` and `mealLoggedAt` keys — additive, backward-compatible). Data export, photo URLs, and the connect preview use existing tables, storage RLS, and the deployed `org-directory` edge function. Optional (pre-existing, unrelated blockers): migration 0049 + `meal-chat` deploy remain awaiting founder go-live per earlier closeouts.

## 4. Intentionally deferred (with reasons)

1. **Real-time capture-quality feedback (spec 4.7, "where technically feasible")** — blur/lighting detection in a WebView needs native camera-frame analysis; deferred rather than shipping a fake "looks good" signal.
2. **Recruiter share links (spec 17.4)** — requires a server-side share-token + revocation backend that doesn't exist. The record is now honest ("private by default", no fake sharing UI) until that backend lands.
3. **Sound / notification-preview / digest toggles (spec 13.4)** — no real native seam for per-app sound or previews; shipping decorative toggles would violate the no-fake-controls rule. Haptics (real) was added instead. Digest exists server-side but has no per-user opt-out column yet.
4. **Metric units / 24-hour time (spec 22.2)** — hidden per spec ("either support them or hide them"); support is engine-wide work.
5. **Server sync for restriction declarations** — restrictions persist on-device (as before, now structured). Syncing them to the coach's team dietary sheet needs a column + RLS design; the coach sheet remains honestly empty until then.
6. **Historical per-category trends for days logged before today** — the trend needs the newly-persisted jsonb; it unlocks automatically as new days accumulate (old rows lack `mealLoggedAt`). No fabrication in the meantime.

## 5. Remaining risks / founder decisions

- **`meal-chat` edge fn + migration 0049** still undeployed (pre-existing): the thread composer degrades gracefully.
- **`support@onstandard.app`** is referenced in Terms/Contact and the export note — confirm the mailbox exists.
- **Legal text**: `onstandard.app/terms` + `/privacy` are live pages; counsel review of the in-app "short version" wording is a go-live item (tracked in `docs/compliance/GO-LIVE-COMPLIANCE-CHECKLIST.md`).
- **Guardian data flows**: the privacy screen states guardian rights (access/deletion); the operational process is manual until an admin tool exists.
- **Device QA**: the swipe-back ↔ stack interplay and pinch-zoom were verified in desktop Chromium; a pass on a real iPhone (edge-swipe, keyboard, safe areas) is the founder checklist below.

## 6. Confirmations

- **No prototype language** remains on any reachable athlete surface (final regex sweep clean; unreachable stubs redirect).
- **No misleading states**: fake weight "photo proof" removed; unconditional "Guardian: no conflicts" replaced by a real comparison that never over-claims; billing invisible; no decorative controls.
- **No random navigation**: every back/Done/Save pops the recorded origin; flow screens are transient; tab highlight follows origin.
- **No hidden content**: 128px scroll clearance above the tab bar everywhere.
- **Meal images consistent**: one photo-store resolves the same signed URL for Home, History, Analysis, and the thread; placeholders only for photo-less logs, labeled "No photo submitted".

## 7. Founder manual QA checklist (device pass)

1. **Fresh account:** onboard → Home day-0 → Progress shows "Progress starts today" with score/streak/best + "1 of 3 days"; no empty dashed card.
2. **Nav:** Profile → scroll to bottom → Notifications → back → land at the same scroll; bottom tab stays Profile. Repeat with edge-swipe. Home → Score Breakdown → back → same scroll.
3. **Score:** open Score Breakdown → expand each category → numbers sum to the ring; reach rows sum to the "up to" header; log a meal and watch every number move consistently.
4. **Commitment:** breakdown → Daily Commitment → Complete reflection → "Partially" → score rises exactly +9; sheet row disappears.
5. **Meal flow:** camera shows "Photograph everything…"; capture → review → "Make sure everything is visible" chips → add a note ("cooked in oil") → Analyze meal → note appears on the thread ("Your note"); tap the photo → pinch/double-tap/swipe-down all work; close lands at the same spot.
6. **Gallery:** pick from gallery → badge reads neutral "Gallery upload"; secondary button reads "Choose another" and re-opens the picker; duplicate photo re-pick is blocked with the honest message.
7. **Photos everywhere:** force-quit and reopen → Home Recent Results and Activity History still show the real plates.
8. **Allergies:** save Peanuts (severe) → log a meal the AI reads as peanut butter → red pre-confirm alert naming Peanuts and its uncertainty.
9. **Connect:** enter a real team code → preview shows the actual team/coach → confirm → connected card on Profile; try a garbage code → clear error, no connection.
10. **Notifications:** complete a meal right after its reminder is scheduled → no stale reminder fires; check tone chips change wording only; coach-urgency rows show locks.
11. **Appearance:** flip Dark/Light/System in Units & appearance → every screen above renders correctly in both.
12. **Export/deletion:** Privacy → Download my data → JSON file lands; deletion flow still double-confirms.
13. **Sunday:** Weekly Check-In shows the real six-question form with anchors; any other day shows the compact "Opens Sunday" card.
