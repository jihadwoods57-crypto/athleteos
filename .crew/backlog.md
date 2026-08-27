# Founder Sessions Backlog

Ranked queue for the daily cloud sessions (see `founder-sessions.md`). The 7 PM session
rewrites the ranking each night. Seeded 2026-08-22 by the founder + Claude; reranked
2026-08-26 by the 7 PM POLISH session. Items marked **[verify first]** came from a July
audit of the legacy `src/` engine — confirm they're still real against the live DB
before building.

Done this week: the day.js near/far split (`22b1cda` + `9a5b1bb`), the operator
repaint whitelist retired with four hung screens fixed and a new gate (`adff540`),
the ~140-fix full-app UX audit (`53a00a0`), and the em-dash ban finished (`919cf8b`,
see old #6 below). None of it has reached a phone — see #1.

## Ranked

### 1 · ship · prove the OTA actually carries this week's work  (impact 5, effort s)
**DONE 2026-08-26 ~9 PM** — the roll-call deploy session published with a working token and
proved it (md5+sha256 vs the live manifest, both platforms; see `9777b54` /
`docs/go-live/ROLLCALL-LOCKSCREEN.md`). NOTE for later sessions: the `EXPO_TOKEN` in the
cloud sandbox env is STILL the dead one (re-proved 2026-08-27 8 AM, same "bearer token is
invalid") — whatever token that session used, it is not the one in this environment.
Users are running Aug 20 code (`00e994e`), now EIGHT user-facing commits behind
(`919cf8b` added tonight). Everything is ready: gates green, committed zip current and
byte-reproducible. Blocked only on credentials: `EXPO_TOKEN` is dead — re-proved
against the GraphQL API tonight (2026-08-26 7 PM), same "bearer token is invalid".
The sentry's "OS? incident" email asking for fresh keys sits in the founder's inbox
unanswered. First session with a working token: publish
(`eas update --branch production --environment production`), fetch the live manifest,
match md5 + sha256 against the committed zip, and report which commit users now run.
If the token is still dead, say exactly that in one line and move on — do not re-send
the email.

### 2 · security (live DB) · `base_age` is athlete-editable → bypasses minor gates  **[verify first]**  (impact 5, effort m)
**BUILT 2026-08-27 8 AM — awaiting live apply.** The [verify first] was done for real: a
local Postgres 16 with all 209 migrations applied reproduced the hole (two self-UPDATEs
flip a 15-year-old to adult on both gates). Migration `0210_age_server_authoritative.sql`
closes it (column-wall on base_age/dob + a `set_my_dob` door whose ratchet refuses
minor→adult flips) and the client OTA half shipped in the same commit (safe in either
deploy order). Proven: new rls_authz "0210" section, 565/565 checks, all 7 SQL suites
green. Sequence for the first credentialed session, in THIS order: (1) publish the OTA —
the committed zip's client calls the door and falls back cleanly on a pre-0210 server, so
it is safe to ship first; (2) `supabase db push` 0210 (schema dump first per charter);
(3) re-run the suite. Applying 0210 BEFORE that OTA would break dob edits and onboarding's
dob+standard phase-2 sync on every phone still running last night's update.

### 3 · security (live DB) · client-set `days.score` can fake ≥80 without a photo  **[verify first]**  (impact 3, effort m)
Tampered client persists a high score with no photo evidence; trust-pass grants gate on
score ≥ 80. Fix: tighten the evidence-ceiling SQL to require real photo evidence.
Same July caveat — re-verify against live schema (score logic has been rebuilt since).
Note: `9a5b1bb` made the CLIENT display honest about what the server counts; the server
wall itself (`grant_pass`, 0196) is what this item hardens. Same credential blocker as #2.

### 4 · scale · dietitian queue filters client-side → move to a server RPC  (impact 4, effort m)
The dietitian review queue fetches broadly and filters in the proto. Breaks at real
roster sizes. Build a server-side RPC (remember: explicit grants to authenticated).
Without DB credentials the RPC can be authored and parked in `supabase/migrations/`,
but the proto can't switch to it until the RPC exists on live — sequence accordingly.

### 5 · copy/design · eyebrow-h2 heading semantics  (impact 2, effort s)
The surviving half of the old copy item: eyebrow labels sit above h2s with the
semantics backwards on several screens. Fix the heading structure while keeping the
visual design. (The em-dash half is DONE — see below.)

### 6 · design · blue-bright ink cluster from the 2026-08-19 deep audit  (impact 2, effort s)
A cluster of screens uses bright blue as text ink where it should be reserved for the
score signature. Re-audit and normalize to the token system. Scoped tonight: most of
the 213 `--blue-bright` uses are legitimate icon-chip tinting; the audit is about TEXT
ink (e.g. coach.js:3494's 30px score number, listing links) — judge each against the
"blue→teal lives on score surfaces" rule rather than sweeping.

### 7 · perf · 3MB eager boot graph in the proto  (impact 3, effort l)
Everything loads at boot. Lazy-load heavy screens/modules so first paint is fast on a
real phone. Careful: no build step — dynamic import() patterns must be click-time-safe.

### ~~copy · em dashes in UI copy~~  DONE 2026-08-26 (`919cf8b`)
All 102 remaining prose em dashes rewritten as plain sentences; ratchet ceiling dropped
413 → 47, and everything left in the baseline is a placeholder glyph ('—' for a missing
value), one range-parsing regex, and the share-card canvas placeholder — i.e. the gate
now hard-bans any new dashed sentence. Two copy assertions and the src planStyle parity
twin updated with it. Adversarial review caught and fixed an orphaned " . " in exec.js.

## Notes from tonight's full-screen sweep (free audit input)
- qc-capture --all --audit-only over 139 screens: zero failures, overflows, JS errors,
  small taps, clipped text, or contrast flags. One "thin" flag: parent-link — it's a
  legitimately minimal code-entry form, not a defect; ignore unless it grows real content.
- Drive uploads of screenshots >~20KB through the connector are unreliable (two large
  payloads rejected as invalid base64; a 17KB one succeeded). Keep proof shots small.

## Awaits founder ruling — recommend only, never ship
- Locked In floor 75 → 80.
- Re-enabling pinch zoom app-wide (WCAG 1.4.4).
- Proactive AI spend (ai-followup cron).
- A way for sessions to write into the Daily Ops doc (the Drive connector can't edit an
  existing Doc — re-tested 2026-08-26 7 PM, update_file still only renames/moves;
  reports land in `.crew/reports/` until this is ruled on).

## Out of reach from the cloud — park, never fake
- Build #27 App Store submission, HealthKit device QA, geofencing device QA, key rotation.
