# Founder Sessions Backlog

Ranked queue for the daily cloud sessions (see `founder-sessions.md`). The 7 PM session
rewrites the ranking each night. Reranked 2026-09-06 by the Sunday META session (weekly
review: `.crew/reports/2026-09-06.md`).

Where the week ended (2026-09-01 → 09-05, compressed by the meta session):
- **Live** (founder's 09-03 PC publish): meal-advice fix + decimal guard, dietitian queue
  RPC client, coach feed RPC client, parent score colors, a11y heading outline, plus the
  founder's own composer pill / Liquid Glass nav / two-layer push-pop / notification voice.
- **Ready but NOT live** (stacked behind the dead publish token, in commit order):
  composer 44px tap targets (09-03), neutral score-credit chip (09-04), coach inbox RPC
  client half (09-04), the 09-05 audit stack (gesture fixes: second-finger strand,
  double-pop, mid-drag repaint, header flicker, pager alias/short-tab; IME isComposing
  in 5 composers; Intuitive calorie-leak closures per the PRODUCT.md red line).
- **Blocked on credentials/PC**: migrations 0210 + 0214 + 0219 and the digest-cron
  widening (DB creds); edge-function deploys — weekly-digest opt-out guard,
  connected-standards-tick error surfacing, two em-dash fixes (PC); landing-site deploy
  with the #fuel section + overclaim retirements (PC).

## Ranked

### 1 · founder-blocked · one credentialed sitting clears the entire pile  (impact 5, effort s — his)
Fresh `EXPO_TOKEN` + Supabase creds in the cloud env (the 08-26 `OS?` email, still
unanswered), or one PC sitting: publish the stacked OTA, deploy the edge functions,
deploy the site, apply 0210 + 0214 + 0219. Sessions: recommend in one line, cite the
streak, never re-diagnose.

### 2 · product · finish the Intuitive red line — DONE 09-06 (8 AM build + 1 PM audit)
All stored-number readbacks closed, per-figure, pinned by intuitive-surface.test.mjs.
The 1 PM audit attacked the gates and finished the per-figure claim: the 8 AM pass held
only on plan.js — meal.js (macroRow, thread strip, day bars, paceNote, drawer notes),
trust.js past-meal view, memory-edit's fields, and food-search/barcode cells now gate
each figure behind its own flag in BOTH directions, with a real calories-off-alone
render test + QC seeds (styleCaloriesOff / memoryEditCaloriesOff). Still open from this
family, for 7 PM polish or later: the goal panel's strategy line still says "calorie
target below maintenance" to Intuitive athletes; the styleIntuitive QC seed writes its
sample AI thread message in a numbers voice.

### 3 · spec · M4 — the parent "fueling consistency" view, spec FIRST  (impact 4, effort m)
The scout's realest product finding no rival owns: under-fueling is the parent
conversation. Write the spec (surfaces, copy, what is deliberately never shown — weights,
calories), taste-checked so it reads as care, not surveillance. The founder reads the
spec before anyone builds. A good scout-day or quiet-morning deliverable.

### 4 · a11y · settings switches are 30px tap targets  (impact 3, effort s — found 1 PM 09-06)
The bare `.std-switch` divs (50×30, role=switch) on notif-settings (4 switches, incl. the
new "Team standard reminders"), settings' Face ID row, coach notif prefs, and the trainer
signup consent rows carry the tap target themselves. The 09-05 fix gave the coach
standards editor row-level 44px targets (`.std-switch-row[role="switch"]`, coach.css:614)
— copy that pattern: move role/tabindex/click to the row. Don't just inflate the pill.
Sweep evidence: qc audit-0906 smallTargets on notif-settings + sweep-trainer-ob.

### 4b · a11y follow-through · heading outline maintenance gate  (impact 2, effort s)
A cheap verify gate (or qc audit rule) flagging a screen that renders h2s with no h1, or
a new uppercase label class that isn't a heading. Protects finished outline work from
next month's new screen.

### 5 · perf · 3MB eager boot graph in the proto  (impact 3, effort l)
Unblocked — the nav audit debt is paid (09-05) — but it rewires the exact navigation
code that just churned, and dynamic import() must be click-time-safe (no bundler). Only
start it on a morning with nothing hotter, and never the same week as more gesture work.

## Market opportunities — 2026-09-04 Friday scout (ranked)

Research pass over MacroFactor, MyFitnessPal (+ Cal AI), Hexis, Teamworks Nutrition,
Eat 2 Win. Sources in `.crew/reports/2026-09-04.md`. M1 (calorie-counting position)
SHIPPED 09-05 — homepage #fuel section, ASO draft block, PRODUCT.md red line.

### M2 · pricing/packaging · the team middle market is empty  (impact 5, effort m)
Teamworks sells enterprise to athletic departments; everyone else sells to individuals,
at rising prices (MFP +60% in two years to $79.99/yr, Lose It doubled, MacroFactor
~$12/mo no free tier). Nobody has a "one club coach, one roster, one card" plan a
high-school coach can buy in two minutes. We already have funded plans and sponsor
flows; the work is a priced SKU and a story. Price points await founder ruling.

### M3 · marketing ammo · photo-first won; the winners' weak spots are our strong spots  (impact 4, effort s)
MFP bought Cal AI (15M downloads, ~$30M ARR) — the giant paid to admit photo logging is
how the next generation logs. Cal AI's complaints: fake precision on mixed dishes,
billing grievances. Our angle: the photo is proof you fueled, the coach and score do the
rest — honest-states as market position. Use in copy; never chase fake precision.

### M4 — promoted to ranked #3 above.

### M5 · product gap · training-aware fueling guidance  (impact 3, effort l)
The one thing reviewers praise Hexis for: "fuel for the work required." We log training
but advice doesn't breathe with it. A modest version (hard-session day → bigger fueling
expected) gets the praised behavior without their periodization machinery. Long-pole;
park until the queue clears.

### M6 · watch, don't build · QR meal check-in is Teamworks' stickiest team feature  (impact 2, effort m)
If M2's team SKU happens, a "fueling check-in" for team meals is the natural sweetener;
alone it's not worth a sitting. Noted so October doesn't rediscover it.

## Parked with evidence (from the 2026-09-05 audit)
- **Digest timing + quiet hours (c831c69, 0220 + 0221): audited 09-06 1 PM** — client
  mirror (serverPrefPatch) and edge-function logic read clean, suites cover them. Still
  needs the PC: confirm the migrations were APPLIED to live, and note the ORDER for the
  credentialed sitting — settings copy now promises what only 0221 delivers, so apply
  migrations BEFORE (or with) the OTA publish.
- **Server prose ignores per-figure overrides** (found 1 PM 09-06): analyze-meal/meal-chat
  write prose per plan STYLE (styleApplied stamp), not per surface flags — a
  calories-hidden-alone athlete can still meet "780 calories" inside an AI sentence, and
  the stamp isn't persisted on meals rows (so past-meal prose is always hidden for
  Intuitive — safe, but a stamped signals-voice analysis could legitimately show if
  `style_applied` were a column). Server-side; blocked on credentials.
- **Safe-area bleed above the stuck glass header on notched phones**: needs a real
  device to tune — do not fix blind from the cloud.
- **Latent, low**: long-press tapback surviving into an edge-swipe; duplicate DOM ids in
  the gesture under-layer (inert today); IME Enter on non-composer inputs; dead
  `wireComposer` in settings.js; feed streak rows naming the 80 bar while the push voice
  bans internal numbers (founder taste call — recommend aligning).

## Notes for tomorrow's sessions
- **Credential streak (update in place, don't re-diagnose):** EXPO_TOKEN invalid
  ("bearer token is invalid") — 14 sessions through 09-06 (1 PM audit). No Supabase creds, no Stripe
  key, no Cloudflare token in the cloud env. One cheap check, cite this line, move on.
  (npx eas-cli is broken in the sandbox — curl api.expo.dev/graphql with the bearer instead.)
- Fresh sandboxes need `npm install` before `npm run verify` — 4 gates fail on missing
  deps otherwise and it looks like real breakage. Verify prints **14 gates** as of 09-06
  (trust its summary). `npm install` churns package-lock.json; revert the noise, don't commit it.
- The Drive connector cannot edit an existing Doc (schema-confirmed; 7 PM session
  re-checks the schema once daily, nobody else re-tests). Reports live in
  `.crew/reports/` — the charter's Reporting section has the full standing path.
- The qc audit flags composer textareas at ~30px tall. Known and accepted: they sit in
  40px pills and the whole pill is the tap target (pinned in composer-pill.test.mjs).
  Don't "fix" the flag by inflating the pill.
- Sweep false-positive ledger: `sweep-parent-link` THIN is a real, honest, tiny screen
  (invite-code entry) — false positive; `cs-coach-board` thin-flag was a seed quirk,
  thread closed 09-05.
- Zip discipline (now also in the charter's gotchas): build `assets/proto.zip` LAST,
  commit `src/proto/protoVersion.ts` with it, prove scope entry-by-entry vs HEAD.

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
