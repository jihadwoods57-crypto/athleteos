# Founder Sessions Backlog

> **ALL AUTOMATED SESSIONS ARE STOPPED** (founder instruction, 2026-09-17: "Please stop
> these automatic sessions"). Nothing in this file is owed to anyone or scheduled to be
> picked up. It is a parked queue, kept intact for whenever the founder builds from it
> himself. See the STOP notice at the top of `founder-sessions.md` before acting on
> anything here.

Ranked queue for the daily cloud sessions (see `founder-sessions.md`). The 7 PM session
rewrites the ranking each night. Reranked 2026-09-16 by the 7 PM POLISH session
(day's full record: `.crew/reports/2026-09-16.md`).

> **THE 1 PM AUDIT SESSION IS RETIRED** (founder instruction, 2026-09-15). Nothing in this
> file is owed to an audit session; its absence is intended, never a missed slot. But its
> schedule STILL FIRED on 09-16 — the entry in the web app's scheduled-tasks list needs
> deleting or a session stands down pointlessly every day. Practical consequence for the
> 8 AM session: nobody checks your ship a few hours later, so prove it yourself or park it.

Where things stand tonight (2026-09-16, 7 PM):
- **The founder published from his PC today: the queue is CLEARED.** `verify-ota.mjs`
  proved live = HEAD's zip byte-for-byte on both platforms (md5 `bc2808fd…`) at the start
  of the 7 PM session. The rollcall P0s, the take-back fix, the 09-15 polish and this
  morning's mute parity are all in real users' hands.
- **8 AM shipped mute parity** (`cb9f8bc`): every anchor around the bubbles follows the
  post-mute-filter list in all four renderers; a fully muted thread says so honestly.
- **Tonight's 7 PM polish** (`707876a`): the meal-score rubric's notes read in full at
  every width — each row is now key + tag with the note wrapping beneath, instead of a
  nowrap 42% column that ellipsized "~47–57g (e…" at 320px. Last row's phantom hairline
  fixed too. The sweep now audits the rubric OPEN (new permanent `meal-rubric` shot);
  span.rn clip flags went 5 → 0. Gates 16/16 green, zip scope proven (1 file). Ready but
  NOT shipped — publish token still dead; one publish from the PC ships it alone.
- **First App Store submission is imminent.** Pre-submission hardening still outranks new
  features.

## Ranked

### 1 · spec · M4 — the parent "fueling consistency" view, spec FIRST  (impact 4, effort m)
**DONE 2026-09-17 8 AM** — `docs/specs/2026-09-17-parent-fueling-consistency.md`, awaiting
the founder's read. Key finding baked in: v1 needs ZERO new data exposure
(`guardian_child_days` from 0081 already returns 30-120 days inside the consent boundary
and no screen has ever called it), and the invite screen's "streak, and completion"
promise is currently rendered by nothing — the feature makes an existing promise true.
Build is one focused session once the founder says go; open questions are listed at the
bottom of the spec with recommendations attached.

### 2 · a11y/QC · maintenance gate for headings + hit areas + clip flags  (impact 2, effort s)
A cheap verify gate (or qc audit rule) that diffs the sweep's smallTargets AND clipped
lists against the accepted ledger, and flags a screen rendering h2s with no h1. The case
strengthened again tonight: the rubric's clipped notes survived TWO polish passes because
the sweep only ever audited the closed `<details>` — states behind a reveal need shots
that open them (the new `meal-rubric` shot is the pattern: an `act` that opens, an error
if the element is missing). Protects finished work from next month's new screen.

### 3 · QC honesty · refresh the seed's stale scoring stamp  (impact 2, effort s)
Every meal shot — including tonight's — shows "Produce & fiber · ~0g fiber (estimated)"
with a red dot directly beside a visibly produce-heavy bowl. Live code guards this
(meal-intel's produce guard); the fixture's stored stamp predates it, so our own
screenshots keep showing a state real reads can't produce, now full-width and impossible
to miss since the rubric renders open and un-clipped. Refresh the seed so proof images
stop lying about the product.

### 4 · polish · the food-row "label read" / "known product" tag is unstyled  (impact 1, effort s)
Tonight's adversarial review: `.rx-tag` on Detected-foods rows (meal.js:1152) has no CSS
rule anywhere — the only rule ever written is scoped `.rub-row .rx-tag` — so provenance
tags render as bare lowercase text beside styled rows. One rule (or a shared class) makes
them the same quiet pill the rubric uses. Shoot before/after.

### 5 · perf · eager boot graph — verify what the founder's 09-07 diet left  (impact 2, effort s first)
He shipped "54% less JavaScript to parse before the first frame" (1498502) plus
router-lazy tests. Before anyone resurrects the old "3MB eager boot graph" item, measure
what's actually left eager and close or right-size the item. Measurement first.

### Founder-blocked (recommend in one line, cite the streak, never re-diagnose)
Fresh cloud credentials (the 08-26 `OS?` email; the founder said "fix the publish token"
on 09-15 and was sent the two-step instructions — token still unchanged): EXPO_TOKEN
dead — **35 sessions through 09-17 8 AM** (prefix still `CxbNAx`,
prefix-only check, no API call spent). No Supabase, Stripe, or Cloudflare creds in the env. He cleared the
whole publish queue from his PC today, so nothing user-facing is stuck — but sessions
still can't publish their own proven fixes (tonight's `707876a` waits) and every sentry
stays blind to errors/analytics. Also still his: whether migrations 0210/0214/0219–0226/
0228 and the new 0235–0239 are applied; the server-side balance-scoring fix (don't award
balance points on a partly-read plate) before the dietitian pilot leans on meal scores;
who flips feature flags now that the audit session is retired (shipping-discipline rule 7
names a session that no longer exists); deleting the retired 1 PM schedule entry.

## Market opportunities — 2026-09-04 Friday scout (ranked)

Research pass over MacroFactor, MyFitnessPal (+ Cal AI), Hexis, Teamworks Nutrition,
Eat 2 Win. Sources in `.crew/reports/2026-09-04.md`. M1 (calorie-counting position)
SHIPPED 09-05 — homepage #fuel section, ASO draft block, PRODUCT.md red line. M4 (parent
view) is Ranked #1 above.

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
- **The meal-read info mark half-overlaps the score dial** (be2e3df): the 28px ⓘ sits on
  the ring's arc in both themes. It has a full 44px hit area (09-15 polish), so it
  works — but visually it reads as a collision, not a badge. Placement is a founder
  design decision: recommend, don't move it.
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
- **Credential streak (update in place, don't re-diagnose):** EXPO_TOKEN dead — 35 sessions
  through the 09-17 8 AM build; checks are prefix-only (still the token the
  API has rejected since 08-26), no API call spent. The second 09-17 error-response firing
  could not re-check (sandbox denied the prefix read); the 8 AM build's compare-only
  check succeeded — count 35. No Supabase,
  Stripe, or Cloudflare creds (still true 09-17). **The founder published from his PC on 09-16 and cleared the
  four-commit queue** — live = the 09-16 morning tree, proven byte-for-byte. Only tonight's
  polish (`707876a`) waits on a publish now. `node scripts/verify-ota.mjs` needs NO token —
  any session can prove what's live while blind. (npx eas-cli is broken in the sandbox —
  curl api.expo.dev/graphql with the bearer instead.)
- **The container clone can be SHALLOW and stale**: if `git pull` claims divergence,
  `git fetch --deepen=200 origin master`, confirm the merge base IS your local HEAD, then
  `git merge --ff-only origin/master`. Don't reset --hard until ancestry is proven.
- Fresh sandboxes need `npm install` before `npm run verify` (gates fail on missing deps
  otherwise). Verify prints **16 gates** as of 09-09 (trust its summary). `npm install`
  churns package-lock.json; revert the noise, don't commit it.
- **The qc sweep can throw transient harness flakes**: retry a failure before believing it;
  believe a failure that repeats.
- **Sweep states behind a reveal**: the new `meal-rubric` shot opens the score rubric's
  `<details>` via `act` before auditing (that's how the 320px clipping finally surfaced
  after two passes shot it closed). `--scroll-to` is run-global, not per-shot — pass
  `--scroll-to 'details.rub'` only on a filtered run, or the PNG frames the page top (the
  audit still measures the open rows either way).
- The paywall's Terms/Privacy links only render on the live-CTA branch (`iapReady !==
  false`). To shoot the CHECKING beat, inject a hanging bridge before load
  (`window.OnStandardNative={iap:{available:()=>new Promise(()=>{})}}`) — script pattern in
  the 09-09 7 PM report.
- The Drive connector cannot edit an existing Doc (schema re-checked 09-16 7 PM:
  `update_file` still takes only title/parent). Reports live in `.crew/reports/` — the
  charter's Reporting section has the full standing path. Nobody else re-tests.
- Known-accepted sweep flags (don't "fix"): composer textareas ~30–42px sit in 40px pills
  whose whole pill is the target (composer-pill.test.mjs); `sweep-parent-link` THIN is a
  real, honest, tiny screen; act-card/res-card "wide" flags are horizontal scrollers; the
  meal-thread facepile `small` CLIP and nutrition-chat `nct-meal` CLIP are honest "…"
  ellipsis by design (09-15); `button.facepile.disc-fp` 42px TAP is one px-band with the
  composer pills; the meal hero's oversized backdrop `img` (438px wide in a 390 viewport)
  is the decorative blurred plate behind `overflow:hidden` — not a defect.
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
