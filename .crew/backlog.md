# Founder Sessions Backlog

Ranked queue for the daily cloud sessions (see `founder-sessions.md`). The 7 PM session
rewrites the ranking each night. Reranked 2026-09-15 by the 7 PM POLISH session
(day's full record: `.crew/reports/2026-09-15.md`).

> **THE 1 PM AUDIT SESSION IS RETIRED** (founder instruction, 2026-09-15). Nothing in this
> file is owed to an audit session; its absence is intended, never a missed slot. Practical
> consequence for the 8 AM session: nobody checks your ship a few hours later, so prove it
> yourself or park it.

Where things stand tonight (2026-09-15, 7 PM):
- **The founder shipped twice tonight from his PC.** The logged-meal restyle (`be2e3df`,
  "photo and score first", published ~6 PM, carrying the 1 PM audit batch `ecdd984`), then
  a declutter + animation fix on the same screen (`326e80a`, 7:21 PM: one door to the
  reasons, provenance as plain text, the score-chip reveal surviving the repaint).
  `verify-ota.mjs` proved live = `326e80a`'s zip byte-for-byte (md5 `a6109b5f…`) at the
  end of the 7 PM session. Everything proven today is in real users' hands except the item
  below.
- **Tonight's 7 PM polish** hardened that fresh meal read, rebased on and re-proved
  against `326e80a`: the "Nutrition" heading no longer collides with the estimate line at
  phone widths (390 AND 320), and the two surviving small controls (the 28px info mark on
  the photo, the 16px View daily targets) got the standard invisible 44px touch floor.
  Gates green, zip rebuilt (0 added / 0 removed / 2 changed vs his HEAD) — ready behind
  the dead publish token as usual; one publish from the PC ships it.
- **First App Store submission is imminent.** Pre-submission hardening still outranks new
  features.
- Score v3 audit debt is PAID (09-15 report). The attack map lives in that report's audit
  section for the next scoring change; it is not live work.

## Ranked

### 1 · honest-states parity · the muted-everyone blank and the vanishing reactions  (impact 2, effort s)
Latent but cheap, from the 09-09 review: (a) a thread where EVERY author is muted paints
blank on the live meal, coach and nutrition-chat renderers — trust.js already says
"Messages from people you muted are hidden."; give the other three the same pre-filter
empty state. (b) meal.js computes its reaction anchor PRE-filter, so meal reactions
silently vanish when the last message's author is muted (trust.js anchors post-filter and
is fine). Two small fixes, same neighborhood — do them together, all four renderers
counted, in-browser proof. NOTE: meal.js was heavily restructured by `be2e3df` tonight —
re-locate the anchor code before assuming the 09-09 line numbers.

### 2 · spec · M4 — the parent "fueling consistency" view, spec FIRST  (impact 4, effort m)
The scout's realest product finding no rival owns: under-fueling is the parent
conversation. Write the spec (surfaces, copy, what is deliberately never shown — weights,
calories), taste-checked so it reads as care, not surveillance. The founder reads the
spec before anyone builds. A good quiet-morning deliverable.

### 3 · polish follow-through · the meal read at 320px  (impact 2, effort s)
Tonight's after-sweep at 320px: the rubric rows under "Why did this meal score N?" clip
their notes mid-word (`span.rn` — "~47–57g (est…" with no ellipsis), and long facepile
name runs clip harder than at 390. Pre-existing (not tonight's diff — the rubric predates
the restyle), but the restyle makes the rubric a first-class surface now. One CSS sitting:
let `.rn` wrap or ellipsize honestly, shoot 320 before/after.

### 4 · a11y follow-through · heading outline + hit-area maintenance gate  (impact 2, effort s)
A cheap verify gate (or qc audit rule) flagging a screen that renders h2s with no h1, or
a new uppercase label class that isn't a heading. Tonight argues for a second rule: three
sub-44px controls shipped in one founder restyle and only the nightly sweep caught them —
a gate that diffs the qc smallTargets list against the accepted ledger would catch that at
verify time. Protects finished work from next month's new screen.

### 5 · perf · eager boot graph — verify what the founder's 09-07 diet left  (impact 2, effort s first)
He shipped "54% less JavaScript to parse before the first frame" (1498502) plus
router-lazy tests. Before anyone resurrects the old "3MB eager boot graph" item, measure
what's actually left eager and close or right-size the item. Measurement first.

### Founder-blocked (recommend in one line, cite the streak, never re-diagnose)
Fresh cloud credentials (the 08-26 `OS?` email; the founder said "fix the publish token"
on 09-15 and the 1 PM session sent him the two-step instructions — token still unchanged
tonight): EXPO_TOKEN dead — **30 sessions through 09-15 7 PM** (prefix still `CxbNAx`, no
API re-check tonight per the standing rule). No Supabase, Stripe, or Cloudflare creds in
the env. The founder publishes from his PC (twice today), so nothing user-facing is
stuck — but sessions can't publish their own proven fixes and every sentry stays blind to
errors/analytics. Also still his: whether migrations 0210/0214/0219–0226/0228 and the new
0237/0238 are applied; the server-side balance-scoring fix (don't award balance points on
a partly-read plate) before the dietitian pilot leans on meal scores; who flips feature
flags now that the audit session is retired (shipping-discipline rule 7 names a session
that no longer exists).

## Market opportunities — 2026-09-04 Friday scout (ranked)

Research pass over MacroFactor, MyFitnessPal (+ Cal AI), Hexis, Teamworks Nutrition,
Eat 2 Win. Sources in `.crew/reports/2026-09-04.md`. M1 (calorie-counting position)
SHIPPED 09-05 — homepage #fuel section, ASO draft block, PRODUCT.md red line.

### M2 · pricing/packaging · the team middle market is empty  (impact 5, effort m)
Teamworks sells enterprise to athletic departments; everyone else sells to individuals,
at rising prices (MFP +60% in two years to $79.99/yr, Lose It doubled, MacroFactor
~$12/mo no free tier). Nobody has a "one club coach, one roster, one card" plan a
high-school coach can buy in two minutes. NOTE 09-08: the founder cut the funded-plans /
sponsor / marketplace rails, which reads as clearing the deck, not closing the
door — a team SKU would now be built plain (one subscription, one roster), which is
simpler than what we deleted. Price points await founder ruling.

### M3 · marketing ammo · photo-first won; the winners' weak spots are our strong spots  (impact 4, effort s)
MFP bought Cal AI (15M downloads, ~$30M ARR) — the giant paid to admit photo logging is
how the next generation logs. Cal AI's complaints: fake precision on mixed dishes,
billing grievances. Our angle: the photo is proof you fueled, the coach and score do the
rest — honest-states as market position. Use in copy; never chase fake precision.

### M5 · product gap · training-aware fueling guidance  (impact 3, effort l)
The one thing reviewers praise Hexis for: "fuel for the work required." We log training
but advice doesn't breathe with it. A modest version (hard-session day → bigger fueling
expected) gets the praised behavior without their periodization machinery. Long-pole;
park until the queue clears.

### M6 · watch, don't build · QR meal check-in is Teamworks' stickiest team feature  (impact 2, effort m)
If M2's team SKU happens, a "fueling check-in" for team meals is the natural sweetener;
alone it's not worth a sitting. Noted so October doesn't rediscover it.

## Parked with evidence
- **The meal-read info mark half-overlaps the score dial** (be2e3df, tonight): the 28px ⓘ
  sits on the ring's arc and nearly on the arc's end dot, in both themes. It now has a
  full 44px hit area (tonight's polish), so it works — but visually it reads as a
  collision, not a badge. Placement is an hour-old founder design decision: recommend,
  don't move it. One line in tonight's report.
- **Coach board: a pre-cut row with server status `arrived` shows the green "Arrived" pill next
  to "No response yet"** (coach-commitments.js athleteRow). Only possible on rows scheduled
  before the 09-09 cut — they expire with their day. Not worth code; noted 09-09 in case a
  support question cites it.
- **"STRONG · 84/100" above "the balance is not judged"** on a partial-read meal: the stored
  server score awarded balance points on a plate it only partly read. Right fix is
  server-side in analyze-meal (don't score balance with <3 macros); blocked on credentials,
  worth a look before the dietitian pilot. (Score v3 is the CLIENT day-score; this is the
  SERVER per-meal score — v3 did not close it.)
- **Food-memory rows read "0g protein · 0 kcal" for saved items without numbers**
  (coach.js foodMemSection). Check the save path first — a numberless row may be impossible
  today.
- **QC seed carries a stale scoring stamp**: meal-detail's rubric shows "No fiber showing"
  beside a visibly-produce-heavy plate (again in tonight's shots — the restyle makes the
  contradiction more prominent, photo hero directly above the verdict). Live code guards
  this (meal-intel produce guard); the fixture's stored stamp predates it. Refresh the seed
  so shots stop showing a state real reads can't produce.
- **Drive screenshot upload path is broken from the cloud** (two attempts, 09-08). Shots are
  committed to `.crew/reports/<date>-shots/` per precedent. Don't re-diagnose.
- **Digest timing + quiet hours (0220 + 0221)**: audited clean 09-06; still needs a
  credentialed eye to confirm the migrations are APPLIED to live.
- **Server prose ignores per-figure overrides** (09-06): analyze-meal/meal-chat write prose
  per plan STYLE, not per surface flags — a calories-hidden-alone athlete can still meet
  "780 calories" in an AI sentence. Server-side; blocked on credentials.
- **Safe-area bleed above the stuck glass header on notched phones**: needs a real device —
  do not fix blind from the cloud.
- **Latent, low**: long-press tapback surviving into an edge-swipe; duplicate DOM ids in the
  gesture under-layer (inert today); dead `wireComposer` in settings.js; feed streak rows
  naming the 80 bar while the push voice bans internal numbers (founder taste call).

## Notes for tomorrow's sessions
- **Credential streak (update in place, don't re-diagnose):** EXPO_TOKEN dead — 30 sessions
  through 09-15 7 PM; tonight's check was prefix-only (still the `CxbNAx…` token the API
  has rejected since 08-26), no API call spent. No Supabase, Stripe, or Cloudflare creds
  (still true 09-15 7 PM). The founder published twice today from his PC, so the dead token
  costs latency, not delivery. `node scripts/verify-ota.mjs` needs NO token — any session
  can prove what's live while blind. (npx eas-cli is broken in the sandbox — curl
  api.expo.dev/graphql with the bearer instead.)
- **The container clone can be SHALLOW and stale**: if `git pull` claims divergence,
  `git fetch --deepen=200 origin master`, confirm the merge base IS your local HEAD, then
  `git merge --ff-only origin/master`. Don't reset --hard until ancestry is proven.
- Fresh sandboxes need `npm install` before `npm run verify` (gates fail on missing deps
  otherwise). Verify prints **16 gates** as of 09-09 (trust its summary). `npm install`
  churns package-lock.json; revert the noise, don't commit it.
- **The qc sweep can throw transient harness flakes**: retry a failure before believing it;
  believe a failure that repeats.
- The paywall's Terms/Privacy links only render on the live-CTA branch (`iapReady !==
  false`). To shoot the CHECKING beat, inject a hanging bridge before load
  (`window.OnStandardNative={iap:{available:()=>new Promise(()=>{})}}`) — script pattern in
  the 09-09 7 PM report.
- The Drive connector cannot edit an existing Doc (schema re-checked 09-15 7 PM:
  `update_file` still takes only title/parent). Reports live in `.crew/reports/` — the
  charter's Reporting section has the full standing path. Nobody else re-tests.
- Known-accepted sweep flags (don't "fix"): composer textareas ~30–42px sit in 40px pills
  whose whole pill is the target (composer-pill.test.mjs); `sweep-parent-link` THIN is a
  real, honest, tiny screen; act-card/res-card "wide" flags are horizontal scrollers; the
  meal-thread facepile `small` CLIP and nutrition-chat `nct-meal` CLIP are honest "…"
  ellipsis by design (09-15); `button.facepile.disc-fp` 42px TAP is one px-band with the
  composer pills. ADDED tonight: the meal hero's oversized backdrop `img` (438px wide in a
  390 viewport) is the decorative blurred plate behind `overflow:hidden` — `overflowX` on
  the page stays 0; not a defect.
- Zip discipline (also in the charter's gotchas): build `assets/proto.zip` LAST, commit
  `src/proto/protoVersion.ts` with it, prove scope entry-by-entry vs HEAD.
- QC harness: intuitive seeds pass `voice: 'signals'` to the sb stub so seeded thread
  prose matches what analyze-meal really writes for that style. If a shot of an
  Intuitive athlete ever shows an AI sentence with figures, that's a real bug.

## Awaits founder ruling — recommend only, never ship
- Locked In floor 75 → 80. (Score v3 changed what the 80 measures — the 09-15 audit's
  numbers are in hand now for the re-ask.)
- Re-enabling pinch zoom app-wide (WCAG 1.4.4).
- Proactive AI spend (ai-followup cron).
- A way for sessions to write into the Daily Ops doc (the Drive connector can't edit an
  existing Doc — reports land in `.crew/reports/` until this is ruled on).
- M2 team-SKU price points (pricing is yours).
- Feed streak copy naming the internal 80 bar vs. the push voice that bans numbers.
- Who turns feature flags on now that the audit session is retired (rule 7 is frozen and
  names a session that no longer exists — flags currently fail safe, dark).

## Out of reach from the cloud — park, never fake
- Build #27 App Store submission, HealthKit device QA, geofencing device QA, key rotation.
