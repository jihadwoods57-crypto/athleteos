# Founder Sessions Backlog

Ranked queue for the daily cloud sessions (see `founder-sessions.md`). The 7 PM session
rewrites the ranking each night. Reranked 2026-09-02 by the 7 PM POLISH session. Items
marked **[verify first]** came from a July audit of the legacy `src/` engine — confirm
they're still real against the live DB before building.

Done 2026-09-02: the dietitian queue's scaling cliff is gone client-side (8 AM,
`4921d31` — one server RPC replaces chunked 60-id reads, fallback proven both
directions, and the session built a local-Postgres rig so SQL is now provable
in-sandbox); the 1 PM audit caught and fixed the decimal-splitting bug the morning's
sentence work introduced (a "3.5 oz" would have reached athletes as "5 oz") in all
three splitters, with pinning tests; the 7 PM session closed the blue-bright ink audit
(old #5) — parent hub scores now speak scoreColor() band ink like the coach roster,
the ob2-parent pitch demo matches, the invite token judged fine as a code accent.
NONE of it has reached a phone — see #1.

## Ranked

### 1 · ship · publish the stacked OTA from the PC  (impact 5, effort s)
The cloud token is still dead (re-proved 2026-09-02 7 PM: "bearer token is invalid";
that makes four sessions in a row). The stack riding the next PC publish keeps growing:
the meal-read "keep advice whole" upgrade + its decimal fix (WITHOUT which the upgrade
actively garbles portion advice — do not publish the first half alone; master carries
both), the dietitian-queue client (safe either side of 0214), and tonight's parent-hub
score-ink polish. Also deploy the edge functions (meal-opener.ts) in the same sitting.
Everything is committed on master; `npx eas update` from the PC as usual.

### 2 · security (live DB) · apply 0210: `base_age` server-authoritative  **[verify first — done]**  (impact 5, effort m)
**BUILT 2026-08-27 8 AM — still awaiting live apply.** The hole is real (reproduced on a
local Postgres with all migrations: two self-UPDATEs flip a 15-year-old to adult on both
gates). Migration `0210_age_server_authoritative.sql` closes it; the client half already
sits in the committed zip and is safe in either deploy order. Sequence for the first
credentialed session, in THIS order: (1) publish the OTA (the client falls back cleanly
on a pre-0210 server); (2) `supabase db push` 0210 (schema dump first per charter);
(3) re-run the suite. Applying 0210 BEFORE that OTA breaks dob edits and onboarding's
phase-2 sync on every phone running current code.

### 3 · security (live DB) · client-set `days.score` can fake ≥80 without a photo  **[verify first]**  (impact 3, effort m)
Tampered client persists a high score with no photo evidence; trust-pass grants gate on
score ≥ 80. Fix: tighten the evidence-ceiling SQL to require real photo evidence.
Re-verify against live schema first (score logic has been rebuilt since July). Same
credential blocker as #2 — but the 2026-09-02 local-Postgres rig means the FIX can now
be built and proven in-sandbox before credentials ever show up. Good 8 AM pick.

### 4 · scale (live DB) · apply 0214: `team_activity_batch`  (impact 3, effort s)
**BUILT AND PROVEN 2026-09-02 8 AM (`4921d31`)** — client shipped in the zip, deploy
order safe in BOTH directions (fallback to chunked reads on any error). 7/7 SQL suites
green on a local Postgres with all 214 migrations, plus direct attack probes. Apply
whenever credentials exist; until then users silently keep the chunked path.

### 5 · scale follow-up · the coach inbox's roster-wide read still takes the slow path  (impact 2, effort m)
Noted by the 8 AM session: the inbox's separate roster-wide read (20 newest meals, no
athlete filter) still does the chunked client-side merge that #4 just fixed for the
queue. Smaller harm (one page, capped at 20), same shape of fix — either widen
`team_activity_batch` or add a sibling RPC. Provable on the local rig first.

### 6 · perf · 3MB eager boot graph in the proto  (impact 3, effort l)
Everything loads at boot. Lazy-load heavy screens/modules so first paint is fast on a
real phone. Careful: no build step — dynamic import() patterns must be click-time-safe.

### 7 · a11y follow-through · heading outline maintenance gate  (impact 2, effort s)
The outline is complete and worth protecting: a cheap verify gate (or qc-capture audit
rule) that flags a screen rendering h2s with no h1, or a new uppercase section label
class that isn't a heading. Prevents next month's new screen from silently regressing
what two sessions finished.

## Notes for tomorrow's sessions
- Fresh sandboxes need `npm install` before `npm run verify` — 4 gates (typecheck, test,
  test:admin, bundle) fail on missing deps otherwise and it looks like real breakage.
  Verify now prints **13 gates** (test:admin joined the count).
- The 2026-09-01 clone landed on a detached HEAD after the remote's forced update;
  check `git status -sb` before committing and `git checkout -B master origin/master`
  if detached (tonight's session hit this).
- `npm install` churns package-lock.json (12 deleted lines, platform-optional deps);
  revert it rather than committing lockfile noise.
- The blue-bright ink audit (old #5) is CLOSED — don't reopen it; the remaining ~210
  uses were scoped legitimate 2026-09-01 and the score cases are fixed as of tonight.
- Drive uploads of screenshots >~20KB through the connector are unreliable; keep proof
  shots small. The connector still cannot edit an existing Doc (re-checked 2026-09-02).

## Awaits founder ruling — recommend only, never ship
- Locked In floor 75 → 80.
- Re-enabling pinch zoom app-wide (WCAG 1.4.4).
- Proactive AI spend (ai-followup cron).
- A way for sessions to write into the Daily Ops doc (the Drive connector can't edit an
  existing Doc — re-tested 2026-08-26 7 PM, update_file still only renames/moves;
  reports land in `.crew/reports/` until this is ruled on).

## Out of reach from the cloud — park, never fake
- Build #27 App Store submission, HealthKit device QA, geofencing device QA, key rotation.
