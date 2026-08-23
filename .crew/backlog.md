# Founder Sessions Backlog

Ranked queue for the daily cloud sessions (see `founder-sessions.md`). The 7 PM session
rewrites the ranking each night. Seeded 2026-08-22 by the founder + Claude; reranked
2026-08-23 by the Sunday META session. Items marked **[verify first]** came from a July
audit of the legacy `src/` engine — confirm they're still real against the live DB
before building.

Done since seeding: old #4 (day.js hauled 60 days of meal jsonb to paint today) shipped
2026-08-22 as the near/far split in `22b1cda`, with the trust-pass count fix `9a5b1bb`
riding the adversarial review of it. Gates green, zips rebuilt and committed — but see
new #1: no publish was proven.

## Ranked

### 1 · ship · prove the OTA actually carries this week's work  (impact 5, effort s)
Nothing in this week's log claims an EAS publish or a manifest hash match — the zips are
rebuilt and committed, but per shipping discipline rule 4 that is "ready, not proven
shipped." First session with `EXPO_TOKEN`: fetch the live update manifest, compare
against the committed `assets/proto.zip` (md5 + sha256), publish if stale, prove it, and
report which commit users are actually running. If the token is missing, report exactly
that and move on.
**Status 2026-08-23 (8 AM):** diagnosed, blocked on credentials. Live manifest fetched:
users run `00e994e` (Aug 20 08:49; update group `6d8fcb2c`, published Aug 20 12:53 UTC —
live proto.zip md5 `d27eb984…` matched against every committed zip). Stale by three
user-facing commits: `ca92278`, `22b1cda`, `9a5b1bb`. `EXPO_TOKEN` exists but Expo
rejects it (permanent 401, format ruled out) — founder must mint a fresh token. Once it
works: gates are green, committed zip is current and byte-reproducible; just publish
(`eas update --branch production --environment production`) and prove hashes.

### 2 · security (live DB) · `base_age` is athlete-editable → bypasses minor gates  **[verify first]**  (impact 5, effort m)
A minor who edits their own age flips both the minor-messaging gate and guardian-consent
gate. COPPA-adjacent. Fix: make age server-authoritative (service-role-only write path).
Found 2026-07-09 against `0001_schema.sql` / `0002_rls.sql` — confirm the write path is
still open on live before migrating. Dump schema first per charter.

### 3 · security (live DB) · client-set `days.score` can fake ≥80 without a photo  **[verify first]**  (impact 3, effort m)
Tampered client persists a high score with no photo evidence; trust-pass grants gate on
score ≥ 80. Fix: tighten the evidence-ceiling SQL to require real photo evidence.
Same July caveat — re-verify against live schema (score logic has been rebuilt since).
Note: `9a5b1bb` made the CLIENT display honest about what the server counts; the server
wall itself (`grant_pass`, 0196) is what this item hardens.

### 4 · scale · dietitian queue filters client-side → move to a server RPC  (impact 4, effort m)
The dietitian review queue fetches broadly and filters in the proto. Breaks at real
roster sizes. Build a server-side RPC (remember: explicit grants to authenticated).

### 5 · perf · 3MB eager boot graph in the proto  (impact 3, effort l)
Everything loads at boot. Lazy-load heavy screens/modules so first paint is fast on a
real phone. Careful: no build step — dynamic import() patterns must be click-time-safe.

### 6 · copy/design · em dashes in UI copy + eyebrow-h2 semantics  (impact 2, effort s)
Founder taste: no em dashes in user-facing copy. `05c9faf` already removed 246 and the
`lint:dash` gate ratchets against growth, so RE-COUNT before sweeping — the seeded "414"
predates that commit. Current count 413 across 72 files (baseline refreshed 2026-08-23,
1 PM session, after a two-dash burn-down in coach-connected.js). Rewrite naturally
(don't search-and-replace into comma splices). Fix eyebrow-h2 heading semantics while
in there.

### 8 · robustness · loadBook's arrival-repaint hash whitelist is a footgun  (impact 3, effort s)
`coach-data.js` repaints on roster arrival only for a hard-coded list of hashes. Three
screens had fallen through it (coach-standards, coach-standards-manage, coach-rooms):
on direct entry (relaunch restoring the hash) nothing loaded the book and nothing
repainted — infinite spinner, or worse, manage swearing "No activity standards yet"
over a coach's real standards. The 1 PM audit 2026-08-23 fixed all three screen-side
(ensureBook kick + honest bookless states; proven by qc-capture, which reproduced the
hang before and a full board after). The whitelist itself remains: every new operator
screen must remember to join it or kick the load in mount. Systemic fix: replace the
hash list with an arrival subscription (subscribers register a repaint callback), then
delete the list. Audit any other mount that reads bookId()/CD.roster without kicking.

### 7 · design · blue-bright ink cluster from the 2026-08-19 deep audit  (impact 2, effort s)
A cluster of screens uses bright blue as text ink where it should be reserved for the
score signature. Re-audit and normalize to the token system.

## Awaits founder ruling — recommend only, never ship
- Locked In floor 75 → 80.
- Re-enabling pinch zoom app-wide (WCAG 1.4.4).
- Proactive AI spend (ai-followup cron).
- A way for sessions to write into the Daily Ops doc (the Drive connector can't edit an
  existing Doc; reports land in `.crew/reports/` until this is ruled on).

## Out of reach from the cloud — park, never fake
- Build #27 App Store submission, HealthKit device QA, geofencing device QA, key rotation.
