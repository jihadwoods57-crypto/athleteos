# Founder Sessions Backlog

Ranked queue for the daily cloud sessions (see `founder-sessions.md`). The 7 PM session
rewrites the ranking each night. Reranked 2026-09-04 by the 7 PM POLISH session.

Done 2026-09-04: the Friday scout filed six ranked market opportunities (M1–M6 below);
the 8 AM session closed old #7 (fetchTeamMealComments now has its RPC — client live-ready,
DB half parked as 0219 beside 0210/0214); the 7 PM session fixed the meal screen's
"+N from this meal" credit rendering in alarm red on every on-time midday meal (a 2-of-4
day is under 60 by construction, so the day-tier tint painted the reward line red all
day) — it is now a neutral chip per the app's own "a live day has no verdict yet" rule,
pinned by score-credit.test.mjs. Gates 13/13, zip rebuilt, committed; NOT live (publish
token dead, eighth session running). No 1 PM audit ran (Friday scout takes the slot).

## Ranked

### 1 · audit · the founder's 2026-09-03 nav + composer work has STILL had no audit pass  (impact 4, effort m)
Two days live, zero human-style attack. The composer pill (`ea0c656`), Liquid Glass
chrome + edge-swipe gestures (`9d03598`), two-layer push/pop (`2428f2d`), notification
voice (`4ca1808`). Machine evidence so far is all green — tonight's full 282-shot sweep
(141 screens × dark+light) found zero errors, zero overflow, zero contrast flags, and
the glass honours reduced-motion, reduced-transparency and light theme in CSS — but
nobody has hand-walked: swipe-back on every pushed screen (three thread renderers
especially), the Plan strip pager, keyboard over the floating tab bar, the sticky header
on long meal titles, notification copy arriving in the feed. Two sweep threads to close
while there: `sweep-parent-link` flags thin/empty two sweeps running (real screen or
seed?), and `cs-coach-board` flagged thin on 09-03 but was CLEAN tonight — likely a seed
quirk, confirm and close the thread.

### 2 · security (live DB) · apply 0210: `base_age` server-authoritative  (impact 5, effort s)
Client half is live; the hole is real and reproduced (two self-UPDATEs flip a 15-year-old
to adult on both gates). `supabase db push` directly (schema dump into `.crew/db-backups/`
first, per charter), then re-run the suite. Built 2026-08-27; only credentials missing.

### 3 · scale (live DB) · apply 0214 + 0219 in the same sitting  (impact 3, effort s)
Both client halves are live or live-ready with proven fallbacks; both RPCs are written and
suite-tested. One credentialed session applies 0210 + 0214 + 0219 together — three
migrations, one sitting, then `verify:full` where Docker exists.

### 4 · ship · publish the stacked polish  (impact 2, effort s)
Two small changes ride whenever a publish works: the composer hit-target/tap-to-focus fix
(09-03) and tonight's neutral score-credit chip. Rides the founder's next PC publish, or
the first cloud session whose EXPO_TOKEN is valid. Not worth a dedicated sitting.

### 5 · marketing · claim "accountability without calorie-counting" on the landing page (M1)  (impact 4, effort s)
The scout's sharpest finding is shippable from the cloud: rivals are walking into an
eating-disorder backlash over mandatory tracking, and we already are the alternative.
Write the landing-page section + App Store copy line in the founder's voice ("no calorie
counts, no weigh-ins in your face — just show up and fuel"), and add the design red line
to PRODUCT.md: never surface a raw calorie number to a teen athlete by default. Copy
only; nothing in-app changes. Good 8 AM build candidate if the audit (#1) is done.

### 6 · perf · 3MB eager boot graph in the proto  (impact 3, effort l)
Everything loads at boot; lazy-load heavy screens so first paint is fast on a real phone.
Careful: no build step — dynamic import() must be click-time-safe, and it rewires the
exact navigation code #1 audits. Do NOT start this before #1 is done.

### 7 · a11y follow-through · heading outline maintenance gate  (impact 2, effort s)
A cheap verify gate (or qc audit rule) flagging a screen that renders h2s with no h1, or
a new uppercase label class that isn't a heading. Protects finished outline work from
next month's new screen.

## Market opportunities — 2026-09-04 Friday scout (ranked)

Research pass over MacroFactor, MyFitnessPal (+ its new Cal AI), Hexis, Teamworks
Nutrition (ex-Notemeal), Eat 2 Win, and what athletes/coaches/dietitians say in public.
These are inputs for the 7 PM planner to weigh against the build queue, not orders.
Sources live in `.crew/reports/2026-09-04.md`. (M1 is promoted to ranked #5 above.)

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
- Honest-states audit input from the 09-05 build's adversarial review (each verified against
  code, not guessed): (a) index.html loop step 1 and the FAQ time answer claim "no typing, no
  food database" — but `foodsearch.js` is a searchable food database reachable from the camera
  screen ("Log without a photo"), and the meal AI can ask the athlete to type protein/calories;
  (b) dietitians.html:294 claims Intuitive scores hydration, but `plan-style.js` force-disables
  hydration app-wide ("no way to log water") and awareness credit is now unconditional once food
  is logged; (c) the pre-log analysis macro row (`meal.js` ~line 678) and food-search totals are
  NOT gated by plan style, so an Intuitive athlete still sees calories there — the new PRODUCT.md
  red line names these as known gaps; (d) `.rp-sect` has no padding rule in site.css (only in
  role.css), so #thread and the new #fuel section render with zero vertical section padding on
  index — a polish item, not a break. The new #fuel copy avoids all of (a)/(b); the old lines
  still carry them. Fold into #1's hand-walk or the 7 PM polish.
- Build `assets/proto.zip` LAST, after every review fix has landed, and commit
  `src/proto/protoVersion.ts` with it. Two burns on 2026-09-04 alone: the 8 AM session
  built before its final review edits (the committed zip missed its own fixes), and the
  7 PM session committed the zip but forgot the version stamp, without which nothing
  re-extracts. Proof-of-scope (entry-by-entry diff vs HEAD's zip) catches the first;
  `git status` before pushing catches the second.
- Fresh sandboxes need `npm install` before `npm run verify` — 4 gates fail on missing
  deps otherwise and it looks like real breakage. Verify prints **13 gates**.
- `npm install` churns package-lock.json; revert it rather than committing the noise.
- EXPO_TOKEN exists in the cloud env but is INVALID ("bearer token is invalid" — eight
  sessions in a row, last re-proved 2026-09-04 7 PM). Say "ready but not shipped" and
  move on; don't burn time re-diagnosing.
- The Drive connector still cannot edit an existing Doc: the `update_file` tool's schema
  takes only title/parentId (confirmed from the schema itself, 2026-09-04 7 PM — no live
  call needed). Reports land in `.crew/reports/`.
- The qc audit flags composer textareas at ~30px tall. Known and accepted: they sit in
  40px pills and the whole pill is the tap target (pinned in composer-pill.test.mjs).
  Don't "fix" the flag by inflating the pill.
- The remote was force-updated ~2026-09-03: if a stale clone's `master` shares no history
  with `origin/master`, `git reset --hard origin/master` from a clean tree. Probably the
  last night this note is needed.

## Awaits founder ruling — recommend only, never ship
- Locked In floor 75 → 80.
- Re-enabling pinch zoom app-wide (WCAG 1.4.4).
- Proactive AI spend (ai-followup cron).
- A way for sessions to write into the Daily Ops doc (the Drive connector can't edit an
  existing Doc — reports land in `.crew/reports/` until this is ruled on).
- M2 team-SKU price points (the scout's #2 — pricing is yours).

## Out of reach from the cloud — park, never fake
- Build #27 App Store submission, HealthKit device QA, geofencing device QA, key rotation.
