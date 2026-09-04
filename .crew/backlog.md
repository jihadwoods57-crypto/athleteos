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

## Market opportunities — 2026-09-04 Friday scout (ranked)

Research pass over MacroFactor, MyFitnessPal (+ its new Cal AI), Hexis, Teamworks
Nutrition (ex-Notemeal), Eat 2 Win, and what athletes/coaches/dietitians say in public.
These are inputs for the 7 PM planner to weigh against the build queue, not orders.
Sources live in `.crew/reports/2026-09-04.md`.

### M1 · positioning · own "accountability without calorie-counting" — rivals are walking into an eating-disorder backlash  (impact 5, effort s)
The sharpest thing I found all week: college athletes are publicly pushing back on
mandatory meal tracking in Teamworks Nutrition — a wrestler told his school paper that
"wrestling is already prone to eating disorders and I think tracking meals will only
add to that," and students asked for the app to say what TO eat instead of counting
what they ate. Every big rival is a calorie counter at heart. We already aren't: photos,
scores, and a coach who sees you showed up. Say that out loud on the landing page and in
App Store copy ("no calorie counts, no weigh-ins in your face — just show up and fuel"),
and treat "never surface a raw calorie number to a teen athlete by default" as a design
red line before some feature drifts into it. Cheap, honest, and nobody in team sports
is claiming this ground.

### M2 · pricing/packaging · the team middle market is empty  (impact 5, effort m)
Teamworks (ex-Notemeal) sells enterprise contracts to college athletic departments;
MacroFactor, MFP, Hexis and Cal AI sell to individuals. Nobody has a "one club coach,
one roster, one card" plan a high-school or club coach can buy in two minutes. Meanwhile
the individual apps are raising prices hard (MFP Premium up 60% in two years to $79.99/yr,
Lose It doubled to the same, MacroFactor ~$12/mo with no free tier, Hexis ~£10–20/mo) —
so "athlete rides free when a coach/team/parent funds them" reads as generous exactly when
rivals look greedy. We already have funded plans and sponsor flows in the proto; the work
is a priced team SKU and a landing-page story, not new engineering. Worth a founder
sitting on price points before anything ships.

### M3 · marketing ammo · photo-first just got validated — and the winners' weak spots are our strong spots  (impact 4, effort s)
MyFitnessPal bought Cal AI (15M downloads, ~$30M ARR, built by two teenagers) in March —
the giant paid real money to admit that photo logging is how the next generation logs.
Cal AI's public complaints: accuracy claims that don't hold on mixed dishes, and a
pattern of billing/cancellation grievances. MacroFactor still has no photo logging at
all. Our angle isn't "our AI counts calories better" — it's that we never pretended a
photo is a lab measurement: the photo is proof you fueled, the coach and score do the
rest. That's the honest-states rule as a market position. Use it in copy; don't chase
Cal AI into fake-precision territory.

### M4 · product gap · under-fueling is the parent conversation, and no consumer app owns it  (impact 4, effort m)
Everything written for sports parents right now is about RED-S and teens not eating
ENOUGH (hospital systems, USA Cheer, pediatrics orgs all publishing guides), yet every
big tracker is weight-loss-slanted. We already have the parent surface and meal-presence
data. A calm "fueling consistency" view for parents/coaches — missed-meal streaks,
"logged all 4 meals X days this week," never weights or calories — would make OnStandard
the app a dietitian can recommend to a worried parent instead of warning them off
trackers. Needs taste care (it must read as care, not surveillance), so spec before build.

### M5 · product gap (their win, our lack) · training-aware fueling guidance  (impact 3, effort l)
The one thing reviewers consistently PRAISE Hexis (~3.2★ otherwise) and Athlete's
FoodCoach for: telling athletes when to eat MORE because of today's session — "fuel for
the work required." We log training but meal advice doesn't breathe with it. A modest
version (hard-session day → advice and coach feed expect bigger fueling; rest day →
softer) gets us the praised behavior without their periodization machinery. Long-pole;
park until the audit/security queue clears, but it's the realest feature gap this scout
found.

### M6 · watch, don't build · meal check-in/QR attendance is Teamworks' stickiest team feature  (impact 2, effort m)
Their QR "meal check-in" for training tables is what athletic departments actually renew
for. Our roll-call screen is the same muscle. If M2's team SKU happens, a "fueling
check-in" for team meals is the natural sweetener; alone it's not worth a sitting. Noting
it so we don't rediscover it in October.

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
