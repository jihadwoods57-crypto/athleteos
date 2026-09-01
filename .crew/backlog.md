# Founder Sessions Backlog

Ranked queue for the daily cloud sessions (see `founder-sessions.md`). The 7 PM session
rewrites the ranking each night. Reranked 2026-09-01 by the 7 PM POLISH session. Items
marked **[verify first]** came from a July audit of the legacy `src/` engine — confirm
they're still real against the live DB before building.

Done 2026-09-01: the heading-outline pass is COMPLETE — all 309 section labels became
real h2s at 8 AM (`e6c9322`), and the 7 PM session finished the parked judgment residue
(15 .xgrp/.cs-eyebrow labels → h2, athlete Home's missing h1 fixed; three labels stay
controls on purpose — the two <summary> collapse headers and the coach board card's
data-go label, since a heading inside a button role reads as nothing; the adversarial
review caught the third). All of it proven pixel-identical (18 before/after captures
byte-equal, 139-screen sweep clean on the morning pass). None has reached a phone — #1.

## Ranked

### 1 · ship · publish the stacked OTA the moment a live token exists  (impact 5, effort s)
Users run Aug 30 code. Stacked behind the dead cloud `EXPO_TOKEN` (re-proved 2026-09-01
7 PM, same "bearer token is invalid"): the zero-state ring fix, the full heading-outline
pass (8 AM + 7 PM halves), and whatever lands tomorrow. Everything is ready: gates green,
committed zip current. First session with a working token: publish
(`eas update --branch production --environment production`), fetch the live manifest,
match md5 + sha256 against the committed zip, and report which commit users now run.
NOTE: the roll-call deploy session of 2026-08-26 published with a token that is NOT the
one in this environment. If the token is still dead, say exactly that in one line and
move on — the founder already has the key email; do not re-send it.

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
credential blocker as #2.

### 4 · scale · dietitian queue filters client-side → move to a server RPC  (impact 4, effort m)
The dietitian review queue fetches broadly and filters in the proto. Breaks at real
roster sizes. Build a server-side RPC (remember: explicit grants to authenticated).
Without DB credentials the RPC can be authored and parked in `supabase/migrations/`,
but the proto can't switch to it until the RPC exists on live — sequence accordingly.

### 5 · design · blue-bright TEXT ink audit  (impact 2, effort s)
Scoped 2026-09-01 7 PM: most of the ~213 `--blue-bright` uses are legitimate (links,
tabs, icon-chip tints, active states) — do NOT sweep. The judgment cases are big NUMBERS
painted flat blue-bright where the taste rule says score surfaces carry the blue→teal
signature: coach.js:3535 (30px roster score), coach.js:3597 (30px invite token — a code,
not a score; maybe fine), ob2-parent.js:197/209 (34px "88" and "A−" in the parent
pitch). Judge each against "blue→teal lives on score surfaces"; small diff, taste call.

### 6 · perf · 3MB eager boot graph in the proto  (impact 3, effort l)
Everything loads at boot. Lazy-load heavy screens/modules so first paint is fast on a
real phone. Careful: no build step — dynamic import() patterns must be click-time-safe.

### 7 · a11y follow-through · heading outline maintenance gate  (impact 2, effort s)
The outline is now complete and worth protecting: a cheap verify gate (or qc-capture
audit rule) that flags a screen rendering h2s with no h1, or a new uppercase section
label class that isn't a heading. Prevents next month's new screen from silently
regressing what two sessions just finished.

## Notes for tomorrow's sessions
- The 1 PM audit slot did not run 2026-09-01 (only build + sentries fired); the heading
  judgment calls from tonight (h1 = athlete's first name on Home; summaries stay
  controls) deserve fresh-eyes scrutiny.
- qc-capture 18-shot before/after on tonight's diff: byte-identical, sweep clean.
- Drive uploads of screenshots >~20KB through the connector are unreliable; keep proof
  shots small. The connector still cannot edit an existing Doc (re-checked 2026-09-01).

## Awaits founder ruling — recommend only, never ship
- Locked In floor 75 → 80.
- Re-enabling pinch zoom app-wide (WCAG 1.4.4).
- Proactive AI spend (ai-followup cron).
- A way for sessions to write into the Daily Ops doc (the Drive connector can't edit an
  existing Doc — re-tested 2026-08-26 7 PM, update_file still only renames/moves;
  reports land in `.crew/reports/` until this is ruled on).

## Out of reach from the cloud — park, never fake
- Build #27 App Store submission, HealthKit device QA, geofencing device QA, key rotation.
