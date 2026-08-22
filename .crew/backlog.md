# Founder Sessions Backlog

Ranked queue for the daily cloud sessions (see `founder-sessions.md`). The 7 PM session
rewrites the ranking each night. Seeded 2026-08-22 by the founder + Claude from the
open-debts list. Items marked **[verify first]** came from a July audit of the legacy
`src/` engine — confirm they're still real against the live DB before building.

## Ranked

### 1 · security (live DB) · `base_age` is athlete-editable → bypasses minor gates  **[verify first]**  (impact 5, effort m)
A minor who edits their own age flips both the minor-messaging gate and guardian-consent
gate. COPPA-adjacent. Fix: make age server-authoritative (service-role-only write path).
Found 2026-07-09 against `0001_schema.sql` / `0002_rls.sql` — confirm the write path is
still open on live before migrating. Dump schema first per charter.

### 2 · security (live DB) · client-set `days.score` can fake ≥80 without a photo  **[verify first]**  (impact 3, effort m)
Tampered client persists a high score with no photo evidence; trust-pass grants gate on
score ≥ 80. Fix: tighten the evidence-ceiling SQL to require real photo evidence.
Same July caveat — re-verify against live schema (score logic has been rebuilt since).

### 3 · scale · dietitian queue filters client-side → move to a server RPC  (impact 4, effort m)
The dietitian review queue fetches broadly and filters in the proto. Breaks at real
roster sizes. Build a server-side RPC (remember: explicit grants to authenticated).

### 4 · scale · day.js reads ~60 days of JSONB to paint today  (impact 3, effort m)
The day screen's history read is unbounded-ish. Narrow the window or add a summary RPC.

### 5 · perf · 3MB eager boot graph in the proto  (impact 3, effort l)
Everything loads at boot. Lazy-load heavy screens/modules so first paint is fast on a
real phone. Careful: no build step — dynamic import() patterns must be click-time-safe.

### 6 · copy/design · 414 em dashes in UI copy + eyebrow-h2 semantics  (impact 2, effort s)
Founder taste: no em dashes in user-facing copy. Sweep and rewrite naturally (don't
search-and-replace into comma splices). Fix eyebrow-h2 heading semantics while in there.

### 7 · design · blue-bright ink cluster from the 2026-08-19 deep audit  (impact 2, effort s)
A cluster of screens uses bright blue as text ink where it should be reserved for the
score signature. Re-audit and normalize to the token system.

## Awaits founder ruling — recommend only, never ship
- Locked In floor 75 → 80.
- Re-enabling pinch zoom app-wide (WCAG 1.4.4).
- Proactive AI spend (ai-followup cron).

## Out of reach from the cloud — park, never fake
- Build #27 App Store submission, HealthKit device QA, geofencing device QA, key rotation.
