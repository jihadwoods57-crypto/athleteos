# Crew Priorities — 4-Day Founder-Away Sprint (Thu Jun 25 → Sun Jun 28, 2026)

The founder is away Thu-Sun. **Two** Max-intensity autonomous runs each day at **6am ET
(10:00 UTC)** and **1pm ET (17:00 UTC)** work a single RANKED PRIORITY QUEUE top-down,
continuing from the log. The app is APP COMPLETE — this sprint adds backend wiring +
five new features + readiness, all behind flags/seams; nothing goes live.

## WORK MODEL (read every run)
- Work the **RANKED QUEUE (P0 → P8) below, top-down**, continuing from where
  `NIGHTSHIFT-LOG.md` leaves off. Do NOT restart finished items. Finish an item's safe
  scope before moving to the next; it's fine if the queue isn't fully drained by Sunday —
  the ranking guarantees the most valuable work ships first.
- **Build each feature to the SAFE LINE:** ship the pure `src/core` logic, the flag-gated
  UI, and the integration **seams**. Anything needing a real device, an external send, a
  paid API, or real/live data is OUT OF SCOPE — build the seam, leave it inert, and record
  exactly what the founder must do to finish it in `docs/FOUNDER-DECISIONS.md`.
- Every new feature ships with unit tests for its pure logic.

## ⚑ SPRINT MECHANICS
**Branch, never master.** All work on `crew/4day-sprint` (Day 1 AM creates it from master;
every other run `git checkout crew/4day-sprint && git pull`). NEVER push master. The PM run
each day pushes an annotated tag `dayN-end`.
**AM run** opens the day: re-run all three gates on the branch (confirm no drift), then work
the queue. **PM run** continues, then CLOSES the day: adversarial self-review of the day's
full diff (regressions, dead/broken UI, dishonest "done" claims, any flag-OFF behavior
change → fix or `git revert`), append a per-commit report + test count to NIGHTSHIFT-LOG.md
(honesty rule: label flag-gated/seam code "built, not runtime-verified"), push tag `dayN-end`.
**Judgment calls are QUEUED, never guessed** → `docs/FOUNDER-DECISIONS.md` (what, why ambiguous,
options). **Circuit breaker:** if a job can't keep all gates green after two honest attempts,
`git revert` it, log it, move on — never leave the tree red. **The Sun 1pm run** (final) writes
`docs/FOUNDER-RETURN-2026-06-28.md` regardless of how far the queue got.

## STANDING GUARDRAILS (never violate)
- **NEVER enable `EXPO_PUBLIC_BACKEND_LIVE`. NEVER create real accounts or collect real
  (esp. minor) data. NEVER run `supabase db push`/any live-DB mutation. NEVER send anything
  external** (no real push, email, or message to a real person — building the logic/seam is
  fine; firing it at people is not).
- `src/core` stays PURE TypeScript (no RN imports). Never create `src/app`. One job = one
  commit on the branch; EVERY commit keeps `npm run typecheck` + `npm run test` (559+, never
  drop) + `npm run bundle` green; push the branch after each. No paid services. No `expo start`.
- Setup each run: `cd` repo root → `npm install --legacy-peer-deps` → checkout the branch →
  read this file, NIGHTSHIFT-LOG.md, `docs/PERSONA-REVIEW-2026-06-24.md`,
  `docs/specs/2026-06-24-phase1-backend-go-live.md`, `docs/APP-STORE-READINESS.md`, git log.

---

## RANKED PRIORITY QUEUE

### P0 — Backend wiring, flag-gated OFF (the keystone; later features sync through it)
Wire auth (Stage B), the day-sync hooks (Stage C, every real `pushDay` gated by
`realDataConsent`), the athlete consent screen, and roster reads (Stage D) all behind
`isBackendLive`; flag-OFF behavior stays IDENTICAL. Then runtime-verify LOCALLY: if Docker,
`supabase start` a throwaway local stack + an auth→joinTeam→pushDay→fetchLinkedDays
round-trip against localhost (NOT the live project); else a typed mock-client harness.
Report which path. Do NOT enable the flag.

### P1 — Performance signal (FEATURE #1; closes the #1 persona gap)
The app sells performance/scholarships but only measures food + mood. Add it.
- New pure `src/core/performance.ts`: a PR/entry model (lift, sprint/40, jump/vertical, body
  weight, custom), with best/trend/personal-record computation over time.
- An athlete **Performance** view to log a PR (metric, value, date) and see PRs + trends;
  surface a compact performance summary on the coach's PersonDetail.
- Store + persist locally (syncs through P0 when the backend is live). Tests.
- Keep it OUT of the daily Accountability Score (it's a separate development track), unless
  a clean opt-in weighting is obvious — if ambiguous, log to FOUNDER-DECISIONS.md.

### P2 — Better meal logging (FEATURE #6; the dietitian's accuracy ask)
- A curated **local food database** (JSON: common foods + per-serving macros) under `src/core`.
- **Food search + manual quick-add** that adds a real food (with real per-serving macros) to a
  meal and recomputes via the existing `core/mealEdit.ts` engine (extend it to accept added
  foods, not just even-split). Tests.
- **Barcode scan = a SEAM only** (needs camera/device): build `src/lib/foodscan` inert behind
  a flag; do not implement the scanner. Note device work in FOUNDER-DECISIONS.md.

### P3 — Reminders / notifications (FEATURE #2; the engine's fuel)
- Pure `src/core/reminders.ts`: the schedule model (which reminders, when, and conditions like
  "protein still behind by 4pm", "check-in due", "log dinner") + reminder copy generation.
- A **Reminders settings** UI (toggle/time per reminder), persisted.
- Wire to a **local-notification seam** (`expo-notifications` LOCAL scheduling only, gated by
  the existing `isNotifyAvailable`) — build the scheduling glue; do NOT fire remote/push or
  external notifications. Untestable without a device → label as seam. Tests for the pure logic.

### P4 — Messaging + weekly auto-report (FEATURE #3; coach/parent leverage, "don't nag")
- Pure `src/core/weeklyReport.ts`: generate a per-athlete weekly digest (score, compliance,
  what moved, one flag) as in-app/exportable content. Tests.
- Lightweight **two-way messaging**: extend the existing Messages overlay + a thread/message
  model; flag-gated to the real backend (P0). Building the UI + model is in scope; ACTUAL
  delivery to a real person (push/email) is NOT — leave that as the backend/founder step.

### P5 — Wearable recovery (FEATURE #5; score credibility)
- A recovery-source **seam** `src/lib/health` modeling sleep/HRV/steps ingestion
  (Apple Health / Health Connect), inert behind a flag (`isHealthAvailable`, default false).
- Pure mapping logic to fold a REAL recovery metric into the recovery sub-score WHEN available,
  else today's self-report slider (unchanged when off). Tests.
- Native HealthKit/Health-Connect wiring + device testing = founder; note it in FOUNDER-DECISIONS.md.

### P6 — Remaining persona voice fixes (safe)
AI-coach voice prescriptive→educational; non-athlete trainer support from the collected
`clientType` (fat-loss/general/muscle-gain); surface `trainingFreq`; parent data-freshness;
finish Sample-tag consistency. Tie each to its persona finding.

### P7 — App Store readiness + hardening
Code-side 🔧 items in `docs/APP-STORE-READINESS.md`; full a11y sweep (labels, WCAG-AA contrast,
Dynamic Type); perf (no leaked timers/animations); error resilience (graceful fallback on every
network/AI path); bug hunt with a regression test per fix; copy/legal.

### P8 — Full QA + regression + edge-case pass
Close coverage gaps, harden edge states, tidy rough edges accumulated across the sprint
(always with a regression test).

### ALWAYS (Sun 1pm, final run) — Founder-return report
Write `docs/FOUNDER-RETURN-2026-06-28.md`: what shipped (by P-item), final test count, the
contents of FOUNDER-DECISIONS.md, and the exact **"NEEDS YOU"** checklist to finish each
feature + go live (flip `EXPO_PUBLIC_BACKEND_LIVE`, email-confirmation policy, Apple enrollment
+ bundle id, device wiring for barcode/notifications/HealthKit, and the manual coach-invites-
athlete + RLS-isolation verification). Mark anything built-but-not-runtime-verified. Put a
PR-style whole-sprint summary atop NIGHTSHIFT-LOG.md, tag `day4-end`, leave the branch ready to
review + merge — do NOT merge it yourself.
