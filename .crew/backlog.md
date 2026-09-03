# Founder Sessions Backlog

Ranked queue for the daily cloud sessions (see `founder-sessions.md`). The 7 PM session
rewrites the ranking each night. Reranked 2026-09-03 by the 7 PM POLISH session.

Done 2026-09-03: THE STACK SHIPPED — the founder published from the PC today (proved
against the live manifest: both platforms serve the zip of `4ca1808`), which closed old
item #1 and put five sessions of parked work on real phones (meal-read advice fix,
dietitian queue client, coach feed roster read, parent score ink) alongside his own
composer pill, Liquid Glass nav, and notification-voice work. The 8 AM session verified
old #3 stale and closed it; no 1 PM audit ran (the hours' commits are the founder's
own). The 7 PM session polished the new composer pill's accessibility (44px hit
targets restored on send / AI / attach; the whole pill now focuses the box, as in
Messages) — gates 13/13, zip rebuilt, committed; NOT live (cloud token still dead,
six sessions running).

## Ranked

### 1 · audit · the founder's 2026-09-03 nav + composer work has had NO audit pass  (impact 4, effort m)
Four PC commits landed today with no 1 PM session to attack them: the composer pill
(`ea0c656`), Liquid Glass chrome + edge-swipe gestures (`9d03598`), two-layer push/pop
(`2428f2d`), and the notification voice (`4ca1808`) — and they are ALL LIVE. Tonight's
polish covered hit targets only. Walk them like an athlete: swipe-back on every pushed
screen (three thread renderers especially), the pager on Plan's strip, keyboard over
the new floating tab bar, reduced-motion and reduced-transparency on the glass, the
sticky header on long meal titles, notification copy in the feed. The founder is
shipping fast from his PC; the audit session is the check. One thread to pull: tonight's
141-screen sweep flagged `cs-coach-board` as thin/empty — the overnight sentry's sweep
(same day, pre-publish) flagged only `sweep-parent-link`. Confirm whether the board
seed broke or the screen really renders empty.

### 2 · security (live DB) · apply 0210: `base_age` server-authoritative  (impact 5, effort s — was m, the hard half shipped)
**The client half is LIVE as of today's publish**, so the sequencing blocker is gone:
the next session with DB credentials can `supabase db push` 0210 directly (schema dump
into `.crew/db-backups/` first, per charter), then re-run the suite. The hole is real
and reproduced (two self-UPDATEs flip a 15-year-old to adult on both gates). Built
2026-08-27; only credentials are missing.

### 3 · scale (live DB) · apply 0214: `team_activity_batch`  (impact 3, effort s)
Same shape: client is live (today's publish), fallback proven in both directions,
7/7 SQL suites green locally. Apply whenever credentials exist; until then coaches
silently keep the chunked path.

### 4 · ship · publish tonight's polish  (impact 2, effort s)
One small zip (hit targets + pill-tap-to-focus, `css/focus.css` + `js/keyboard.js`
only, proof-of-scope 0/0/2). Rides the founder's next PC publish, or the first cloud
session with a working EXPO_TOKEN. Not worth a dedicated sitting — stack it.

### 5 · perf · 3MB eager boot graph in the proto  (impact 3, effort l)
Everything loads at boot. Lazy-load heavy screens/modules so first paint is fast on a
real phone. Careful: no build step — dynamic import() patterns must be click-time-safe.
More interesting now that the glass/gesture work added ~600 lines to the boot path.

### 6 · a11y follow-through · heading outline maintenance gate  (impact 2, effort s)
A cheap verify gate (or qc-capture audit rule) that flags a screen rendering h2s with
no h1, or a new uppercase section label class that isn't a heading. Protects two
sessions' worth of finished outline work from next month's new screen.

### 7 · scale · fetchTeamMealComments still chunks 1000/chunk with no RPC  (impact 2, effort m)
The last chunked roster read (noted 2026-09-02 when its sibling was fixed). Smaller
page, lower harm; ranks on its own merits.

## Notes for tomorrow's sessions
- Fresh sandboxes need `npm install` before `npm run verify` — 4 gates fail on missing
  deps otherwise and it looks like real breakage. Verify prints **13 gates**.
- `npm install` churns package-lock.json; revert it rather than committing the noise.
- The remote was force-updated ~2026-09-03: a stale clone's local `master` shares NO
  history with `origin/master`. Check `git log --oneline -1 origin/master` after
  fetching and `git reset --hard origin/master` from a clean tree if the histories
  diverge — tonight's session hit this.
- The qc audit flags the composer textarea itself at 30px tall. Known and accepted:
  it sits in a 40px pill and the whole pill now focuses it (keyboard.js, pinned in
  composer-pill.test.mjs). Don't "fix" the flag by inflating the pill.
- EXPO_TOKEN exists in the cloud env but is INVALID ("bearer token is invalid" —
  six sessions in a row, last re-proved 2026-09-03 7 PM). Say "ready but not shipped"
  and move on; don't burn time re-diagnosing.
- Drive uploads of screenshots >~20KB through the connector are unreliable; keep proof
  shots small. The connector still cannot edit an existing Doc (re-checked 2026-09-03).

## Awaits founder ruling — recommend only, never ship
- Locked In floor 75 → 80.
- Re-enabling pinch zoom app-wide (WCAG 1.4.4).
- Proactive AI spend (ai-followup cron).
- A way for sessions to write into the Daily Ops doc (the Drive connector can't edit an
  existing Doc — reports land in `.crew/reports/` until this is ruled on).

## Out of reach from the cloud — park, never fake
- Build #27 App Store submission, HealthKit device QA, geofencing device QA, key rotation.
