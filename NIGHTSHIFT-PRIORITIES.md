# Crew Priorities — 4-Day Founder-Away Sprint (Thu Jun 25 → Sun Jun 28, 2026)

The founder is away Thu-Sun. **Two** Max-intensity autonomous runs start each day at
**6am ET (10:00 UTC)** and **1pm ET (17:00 UTC)**; each works the day's themed queue,
the PM run also closes the day. The app is APP COMPLETE — this is hardening, wiring, and
launch-readiness, not a rebuild.

## ⚑ HOW THIS SPRINT IS RUN (read every run)

**1. Work on a BRANCH, never master.** All work lands on `crew/4day-sprint`.
- First thing every run: `git fetch origin`; if `crew/4day-sprint` exists,
  `git checkout crew/4day-sprint && git pull`; else `git checkout -b crew/4day-sprint` from
  `master`. Commit + push to that branch only. NEVER push to `master`.
- The PM run each day creates an annotated tag `dayN-end` (N = 1..4) after its report and
  pushes the tag, so the founder can diff/revert a whole day.

**2. Two runs/day.** The **AM run** opens the day: re-run all three gates on the existing
branch to confirm no drift, then work the day's queue. The **PM run** continues the queue,
then CLOSES the day: an adversarial self-review of the day's diff, the daily report, the
`dayN-end` tag.

**3. Adversarial self-review closes each day (PM run).** Before the report, re-read the full
day's diff (`git diff master...crew/4day-sprint` since the day's start tag) hunting for: real
regressions, dead/broken UI, dishonest "done" claims, and ANY change to flag-OFF behavior.
Fix or revert what it finds. Only then write the report.

**4. Judgment calls are QUEUED, never guessed.** If a change needs a PRODUCT decision (renaming
something, changing what a number/word means, a real UX tradeoff, dropping a feature), DO NOT
decide it. Append it to `docs/FOUNDER-DECISIONS.md` (what, why it's ambiguous, the options) and
move on. The `weightScore` rename was exactly this kind of call — log, don't guess.

**5. Definition of Done + scope lock + circuit breaker + honesty:**
- Each day has a Definition of Done (below). Meet it; do NOT bleed into the next day's theme.
- Circuit breaker: if a job can't keep all gates green after two honest attempts, `git revert`
  it, log it to `FOUNDER-DECISIONS.md`, and move on. NEVER leave the tree red.
- Honesty rule: in the report, flag-gated code that was NOT runtime-verified must be labeled
  "built, not runtime-verified" — never claimed "working."

## STANDING GUARDRAILS (never violate)
- **NEVER enable `EXPO_PUBLIC_BACKEND_LIVE`. NEVER create real accounts or collect real (esp.
  minor) athlete data. NEVER run `supabase db push` or any live-DB mutation.** The remote DB is
  live (migrations applied) but the data backend stays OFF until the founder flips it in person.
- `src/core` stays PURE TypeScript (no RN imports). Never create a `src/app` dir.
- Never send anything external. Never spend money / add paid services. Never run `expo start`.
- One logical job = one commit (on the branch). EVERY commit keeps all three gates green:
  `npm run typecheck`, `npm run test` (never drop the count, 559+), `npm run bundle`
  (`expo export -p ios`). Push the branch after each (`git pull --rebase`; if `git push` 403s,
  push via the GitHub API and verify).
- Honor DESIGN.md (no OKLCH, no em dashes, no banned patterns). No visual-QC claims (no eyes).
- Setup each run: `cd` repo root → `npm install --legacy-peer-deps` → checkout the branch (rule 1)
  → read this file, NIGHTSHIFT-LOG.md, `docs/PERSONA-REVIEW-2026-06-24.md`,
  `docs/specs/2026-06-24-beta-blocker-build-plan.md`, `docs/specs/2026-06-24-phase1-backend-go-live.md`,
  `docs/APP-STORE-READINESS.md`, and `git log --oneline -40`.

---

## Day 1 — Thu Jun 25: Phase 1 backend wiring (FLAG-GATED, OFF) + local verification
Build the go-live so the founder flips ONE switch on return. All behind `isBackendLive`
(false by default); the deterministic local-mock path stays IDENTICAL when off.
- **Auth (Stage B):** wire sign-in / sign-up screens to `lib/supabase/auth` when `isBackendLive`,
  else today's mock. Store `userId` + role. Coach creates team + real invite code; athlete
  `joinTeam(code)` binds to the roster. Handle email-confirmation-on gracefully ("check your email").
- **Day sync (Stage C):** the two TODO hooks in `src/store/sync.ts` — `hydrateDay(userId)` after
  auth, debounced `pushDay(get(), userId)` in addMeal/addWater/toggleTask/submitCi. Gate every real
  `pushDay` behind `realDataConsent(...)` (core/consent.ts). AsyncStorage stays the offline cache.
- **Consent screen:** an athlete onboarding step recording consent (guardian wording for minors via
  `consentSummary`), flag-gated; it's the hard gate before any real-data push.
- **Roster reads (Stage D):** when `isBackendLive`, swap CoachView/TrainerView from seeded
  ROSTER/TRAINER_CLIENTS to `fetchLinkedDays` + `fetchAthleteProfile`; Phase-5 filters run on real
  rows; drop "Sample" tags only on now-real screens. OFF = unchanged.
- **★ Runtime-verify the backend locally (improvement #5):** if Docker is available, `supabase start`
  a throwaway LOCAL stack, apply the migrations, and write an integration test of the auth →
  `joinTeam` → `pushDay` → `fetchLinkedDays` round-trip against localhost (NOT the live project).
  If Docker is unavailable, build a typed mock-client harness instead. Report which path was used.
- Unit-test every pure seam (mapping, consent gating, flag logic). **Do NOT enable the flag.**
- **DoD:** go-live is fully wired behind the off-flag, gates green, backend round-trip verified
  locally or by mock; flag-OFF behavior provably unchanged.

## Day 2 — Fri Jun 26: Remaining persona fixes + credibility (safe, no backend)
- AI-coach voice **prescriptive → educational** (RD): meal coaching reads as guidance, never a
  directive ("general guidance; your nutritionist sets the plan").
- **Non-athlete trainer support** (Marcus): goal-based targets + AI voice from the `clientType`
  already collected (fat-loss / general / muscle-gain), not athlete defaults (180g / "glycogen").
- Surface the collected-but-unused `trainingFreq`; parent data-freshness caption; finish any
  "Sample"-tag consistency. Deepen tests; tie each change to the persona finding it closes.
- **DoD:** the safe persona findings are closed or queued to FOUNDER-DECISIONS.md; tests up.

## Day 3 — Sat Jun 27: App Store readiness + hardening
- Work the code-side 🔧 items in `docs/APP-STORE-READINESS.md`. Full a11y sweep (labels, WCAG-AA
  contrast, Dynamic Type), perf (no leaked timers/animations), error resilience (every network/AI
  path has a graceful fallback). Bug hunt with a regression test per fix. Copy/legal (no placeholder
  or medical claims; privacy/consent wording).
- **DoD:** the code-side readiness checklist is green or queued; a11y/perf/resilience pass done.

## Day 4 — Sun Jun 28: QA, regression, polish + founder-ready report
- Full coverage + edge-case pass; tidy rough edges. Then write `docs/FOUNDER-RETURN-2026-06-28.md`:
  what changed each day, final test count, and the exact **"Needs You to go live"** checklist —
  flip `EXPO_PUBLIC_BACKEND_LIVE`, set the email-confirmation policy, Apple enrollment + bundle id,
  and the manual verification steps to run together (coach invites athlete; RLS cross-team isolation).
- **DoD:** branch is green and tagged `day4-end`; FOUNDER-RETURN doc is complete and honest; a clear
  PR-style summary of the whole sprint sits at the top of NIGHTSHIFT-LOG.md.
