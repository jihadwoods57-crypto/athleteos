# Founder Sessions Backlog

Ranked queue for the daily cloud sessions (see `founder-sessions.md`). The 7 PM session
rewrites the ranking each night. Reranked 2026-09-08 by the 7 PM POLISH session
(day's full record: `.crew/reports/2026-09-08.md`).

Where things stand tonight (2026-09-08, 7 PM):
- **Live = HEAD.** Proven tonight (`node scripts/verify-ota.mjs`, both platforms MATCH the
  committed zip, md5 `ef7c13b9…`): the founder published from his PC this evening. The whole
  stacked pile is live — the 09-08 fixes (coach link, null-vs-zero, invite code), the
  app-review pass, and the big scope cut. Nothing is waiting on a publish except tonight's
  7 PM polish commit (paywall legal links + coach-editor switch voices), which is ready
  behind the dead cloud token as usual.
- **The founder cut scope hard today (his PC, after the 1 PM audit):** sponsor screen,
  the whole coach marketplace, trainer Grow/offers/payouts, parent funding, redeem-a-code,
  progress photos (yesterday), and the public /t/ trainer page. Backend tables and RPCs are
  untouched; paid access keeps working. The app that remains is the product: athlete loop,
  coach/dietitian tools, teams, standards, subscriptions.
- **First App Store submission is imminent.** Today's app-review pass (6da3fa8) exists
  because of it. Pre-submission hardening now outranks new features.

## Ranked

### 1 · audit debt · the founder's post-1PM stack went live unaudited — attack it as Apple will  (dated 09-08 7 PM; impact 5, effort m)
Four commits landed after today's audit and are LIVE: the app-review pass (store gating +
Report/Mute), the sponsor cut, the marketplace/funding/redeem cut, the /t/ page removal.
The 7 PM session paid the mechanical part: 16/16 gates green on the final tree, full
--all defect sweep (152 screens, 0 real failed loads — six flags were transient harness
flakes that cleared on retry, noted in the report), removed-screen grep clean (comments and
intact-backend fetchers only). Still owed, the human walk — and walk it like an App
Review reader:
- Render the paywall, plan-upgrade and members sheet **as the iOS build**
  (`window.__PLATFORM='ios'`, the commit's own method) and check every store-gated branch
  states its facts without a link or a dead button.
- Attack **Report and Mute** in all the thread renderers (the gotcha says three renderers;
  the founder's commit message says four — count them, don't trust either number).
- Type stale routes (#sponsor, #get-a-coach, #fund-plan, #redeem-code, #progress-photos)
  and confirm the router lands somewhere honest, not a blank or a throw.
- The audience picker / assign fan-out attack from 09-06 (item 0b) is PAID (09-08 1 PM).

### 2 · pre-submission honesty · the paywall's pre-probe flash  (impact 2, effort s — found 7 PM 09-08)
paywall.js renders the LIVE buy CTA (+ Terms/Privacy links) for the beat between first
paint and the `iapAvailable()` probe resolving false, then swaps to "Opens at launch". A
flash of a purchase promise the build can't keep. Fix shape: render the CTA area empty (or
the honest banner) while `iapReady === null`, not the live branch. Small, but it's the
money screen and it's the class of thing App Review screenshots.

### 3 · scope-cut hygiene · the parent tour still plans a step for the deleted funding feature  (impact 2, effort s)
tour-plan.js PARENT_STEPS keeps the `funding` step ("Fund an athlete's plan from here…")
and tour-plan.test.mjs pins it. Invisible at runtime today only because the anchor died
with the screen and filterSteps drops it — dead copy for a cut feature, one anchor-revival
away from showing. Delete the step, trim the test. Same sitting: store-policy.js's header
comment still says the marketplace is "deliberately NOT gated" — the marketplace is gone;
fix the lie in the comment.

### 4 · spec · M4 — the parent "fueling consistency" view, spec FIRST  (impact 4, effort m)
The scout's realest product finding no rival owns: under-fueling is the parent
conversation. Write the spec (surfaces, copy, what is deliberately never shown — weights,
calories), taste-checked so it reads as care, not surveillance. The founder reads the
spec before anyone builds. A good quiet-morning deliverable — and with the marketplace
gone, the parent surface is thinner than ever, so this is the parent story now.

### 5 · a11y follow-through · heading outline maintenance gate  (impact 2, effort s)
A cheap verify gate (or qc audit rule) flagging a screen that renders h2s with no h1, or
a new uppercase label class that isn't a heading. Protects finished outline work from
next month's new screen.

### 6 · perf · eager boot graph — verify what the founder's 09-07 diet left  (impact 2, effort s first)
He shipped "54% less JavaScript to parse before the first frame" (1498502) plus
router-lazy tests. Before anyone resurrects the old "3MB eager boot graph" item, measure
what's actually left eager and close or right-size the item. Measurement first, an
afternoon of import() rewiring only if the numbers still say so.

### Founder-blocked (recommend in one line, cite the streak, never re-diagnose)
Fresh cloud credentials (the 08-26 `OS?` email, still unanswered): EXPO_TOKEN invalid —
**22 sessions through 09-08 7 PM**. No Supabase, Stripe, or Cloudflare creds in the env.
The founder published tonight from his PC, so nothing user-facing is stuck — but every
sentry stays blind to errors/analytics, sessions can't publish their own proven fixes
(tonight's polish waits on him again), and migration state can't be confirmed from here.
Also still his: whether migrations 0210/0214/0219–0226 are all applied (0227 is, per his
commit); the server-side balance-scoring fix (don't award balance points on a plate the
reader only partly read) before the dietitian pilot leans on meal scores.

## Market opportunities — 2026-09-04 Friday scout (ranked)

Research pass over MacroFactor, MyFitnessPal (+ Cal AI), Hexis, Teamworks Nutrition,
Eat 2 Win. Sources in `.crew/reports/2026-09-04.md`. M1 (calorie-counting position)
SHIPPED 09-05 — homepage #fuel section, ASO draft block, PRODUCT.md red line.

### M2 · pricing/packaging · the team middle market is empty  (impact 5, effort m)
Teamworks sells enterprise to athletic departments; everyone else sells to individuals,
at rising prices (MFP +60% in two years to $79.99/yr, Lose It doubled, MacroFactor
~$12/mo no free tier). Nobody has a "one club coach, one roster, one card" plan a
high-school coach can buy in two minutes. NOTE 09-08: the founder cut the funded-plans /
sponsor / marketplace rails today, which reads as clearing the deck, not closing the
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
- **"STRONG · 84/100" sits directly above "the balance is not judged"** on a partial-read meal
  (diet-meal, 09-08 shots). The 84 is the STORED server score — rendering it is honest per the
  proxy gotcha, but the server awarded balance points on a plate it only partly read. The right
  fix is server-side in analyze-meal's scoring (don't score balance with <3 macros); blocked on
  credentials, and worth a look before the dietitian pilot leans on meal scores.
- **Food-memory rows read "0g protein · 0 kcal" for saved items without numbers**
  (coach.js foodMemSection; found by the 09-08 1 PM adversarial review). Different table
  (food_memory, not meals), same `|| 0` readout pattern. Small fix, but food-memory items are
  validated at save so a numberless row may be impossible today — check the save path before
  "fixing" a state that can't occur.
- **QC seed carries a stale scoring stamp**: meal-detail's rubric shows "No fiber showing" beside
  a visibly-produce-heavy plate. Live code guards this (meal-intel produce guard, both compute
  paths); the fixture's stored stamp predates it. Refresh the seed so shots stop showing a state
  real reads can't produce.
- **Drive screenshot upload path is broken from the cloud**: create_file either converts images
  to a Google Doc (without disableConversionToGoogleType) or rejects/truncates large inline
  base64 payloads (two attempts, 09-08 1 PM). Shots now committed to .crew/reports/<date>-shots/
  per the 09-06/09-07 precedent. Don't re-diagnose; if the founder wants Drive shots, that needs
  a real upload path.
- **Digest timing + quiet hours (0220 + 0221)**: client mirror and edge-function logic audited
  clean 09-06. Still needs a credentialed eye: confirm the migrations are APPLIED to live
  (settings copy promises what only 0221 delivers). The founder was clearly at his PC today —
  he may already have; nobody can see from here.
- **Server prose ignores per-figure overrides** (found 1 PM 09-06): analyze-meal/meal-chat
  write prose per plan STYLE (styleApplied stamp), not per surface flags — a
  calories-hidden-alone athlete can still meet "780 calories" inside an AI sentence.
  Server-side; blocked on credentials.
- **Safe-area bleed above the stuck glass header on notched phones**: needs a real
  device to tune — do not fix blind from the cloud.
- **Latent, low**: long-press tapback surviving into an edge-swipe; duplicate DOM ids in
  the gesture under-layer (inert today); IME Enter on non-composer inputs; dead
  `wireComposer` in settings.js; feed streak rows naming the 80 bar while the push voice
  bans internal numbers (founder taste call — recommend aligning).

## Notes for tomorrow's sessions
- **Credential streak (update in place, don't re-diagnose):** EXPO_TOKEN invalid
  ("bearer token is invalid") — 22 sessions through 09-08 (7 PM). No Supabase creds, no
  Stripe key, no Cloudflare token in the cloud env. One cheap check, cite this
  line, move on. (npx eas-cli is broken in the sandbox — curl api.expo.dev/graphql with
  the bearer instead.) BUT: `node scripts/verify-ota.mjs` needs NO token — update
  manifests are public — so any session can prove what's live even while blind.
- **The container clone can be SHALLOW and stale**: tonight's clone was depth-50 with
  master pointing at 09-05, and `git pull` refused with "divergent branches" (the shallow
  fetch reads as a forced update). It's not a real divergence: `git fetch --deepen=200
  origin master`, confirm `git merge-base --is-ancestor master origin/master`, then
  `git merge --ff-only origin/master`. Don't reset --hard until ancestry is proven.
- Fresh sandboxes need `npm install` before `npm run verify` — gates fail on missing
  deps otherwise and it looks like real breakage. Verify prints **16 gates** as of 09-08
  (trust its summary). `npm install` churns package-lock.json; revert the noise, don't
  commit it.
- **The qc sweep can throw transient harness flakes**: tonight six screens "failed"
  (chrome-error:// dynamic-import fetches, a null click) and all six passed clean on an
  immediate filtered retry. Retry a failure before believing it; believe a failure that
  repeats.
- The paywall's Terms/Privacy links only render on the live-CTA branch (`iapReady !==
  false`) — a filtered qc shot of `paywall` settles into the "Opens at launch" branch and
  won't show them. The switch-rows/focus-hitarea tests are the regression net for them.
- The Drive connector cannot edit an existing Doc (schema re-checked 09-08 7 PM:
  `update_file` still takes only title/parent). Reports live in `.crew/reports/` — the
  charter's Reporting section has the full standing path. Nobody else re-tests.
- The qc audit flags composer textareas at ~30-40px tall. Known and accepted: they sit in
  40px pills and the whole pill is the tap target (pinned in composer-pill.test.mjs).
  Don't "fix" the flag by inflating the pill. Same ledger: `sweep-parent-link` THIN is a
  real, honest, tiny screen; act-card/res-card "wide" flags are horizontal scrollers.
- Zip discipline (also in the charter's gotchas): build `assets/proto.zip` LAST, commit
  `src/proto/protoVersion.ts` with it, prove scope entry-by-entry vs HEAD.
- QC harness: intuitive seeds pass `voice: 'signals'` to the sb stub so seeded thread
  prose matches what analyze-meal really writes for that style. If a shot of an
  Intuitive athlete ever shows an AI sentence with figures again, that's a real bug.

## Awaits founder ruling — recommend only, never ship
- Locked In floor 75 → 80.
- Re-enabling pinch zoom app-wide (WCAG 1.4.4).
- Proactive AI spend (ai-followup cron).
- A way for sessions to write into the Daily Ops doc (the Drive connector can't edit an
  existing Doc — reports land in `.crew/reports/` until this is ruled on).
- M2 team-SKU price points (pricing is yours).
- Feed streak copy naming the internal 80 bar vs. the push voice that bans numbers.

## Out of reach from the cloud — park, never fake
- Build #27 App Store submission, HealthKit device QA, geofencing device QA, key rotation.
