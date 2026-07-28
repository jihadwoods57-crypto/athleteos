# OB2 — Adaptive Narrative Onboarding · Build Spec

Six role flows, one engine. Narrative spine for every role:
**Intro problem → why the current way fails → OnStandard's answer → personalized discovery →
aha (their own numbers mirrored back) → interactive product experience → personalized plan →
commitment → social proof → adaptive account/paywall → role dashboard.**

Chapters (progress bar): `0 Discover · 1 See it · 2 Your plan · 3 Commit · 4 Start`.

## Files & engine

- Engine: `js/ob2.js` — `defineFlow({route, steps})` returns a router screen. Read it fully.
- Styles: `css/ob2.css` (namespaced `.ob2-*`, plus shared `.ob`, `.choice/.choice-grid`, `.chp`,
  `.ob-input`, `.btn` from flows.css/app.css). Do NOT add new CSS files; if a flow needs a
  one-off style, inline `style=""` sparingly or reuse what exists.
- Meal demo (athlete + client): `js/ob2-meal.js` — `mealDemoSteps({route, voice, computeScore})`
  returns 5 steps (`demo`, `demo-scan`, `demo-result`, `demo-score`, `demo-chat`) to splice in.
- Role select is already built (`js/screens/ob2-role.js`) and links to `<route>/why`.

### Step object
```js
{ id:'why', ch:0,
  title:(ob)=>`...html...`,      // esc() ANY value read from ob
  sub:(ob)=>`...`,               // optional
  body:(ob)=>`...html...`,
  cta:'Continue', green:false,   // engine CTA (omit via noFoot:true to own the footer)
  skip:true,                     // adds "Skip for now" → next
  when:(ob)=>bool,               // conditional branching (step hidden when false)
  next:(ob)=>'step-id'|null,     // override next (default: next visible step)
  back:'route',                  // override back target (default: prev visible / 'role')
  mount:(root,ctx)=>{},          // ctx = {ob, capture, next(), go(route), nextRoute}
  noFoot:true }
```

### Answer capture (declarative — the engine wires it)
- Single select: container `data-obkey="goal" data-req`, children `.choice`/`.chp`/`.sc` with `data-val`.
- Multi select: `data-obkey-multi="obstacles"`.
- Helpers: `choiceGrid(key, opts)`, `chipRow(key, opts, {multi})`, `scale10(key)`.
- Free inputs: wire in `mount` → `ctx.capture({key: value})` on input. CTA gating for inputs:
  set `data-gate-extra` selector on `#ob2-next` or manage `btn.disabled` yourself in mount.
- Everything lands in `RT.ob`. **Reuse the legacy keys where meaning matches** (persistence
  reads them): `firstName lastName name dob join:{kind,code,school?} sport position level goal
  currentWeight targetWeight allergies standard pressure committedAt email teamName practiceName`.
  New discovery keys ride alongside (see per-role lists).

### Components (js/ob2.js)
`meter(pct,{value,label,uid})` Standard Meter (signature — use at aha + plan; unique `uid` per screen),
`simChip(text)`, `mirrorCard(icon, html)`, `countStat(value, captionHtml, mathLine)`,
`chatSim([{who:'ai'|'coach'|'trainer'|'me', name, init?, sim?, text}])`,
`notifCard({ic,tint,color,title,body,time})`, `phoneCard(label, innerHtml)`,
`testimonial({quote,name,role,initials,stat,statKey})`, `planCard({id,name,price,per,sub,tag,on})`,
`paywallVariant(role)`, `PLANS`, `capture(patch)`, `ob()`.

### Hard rules
- **Icons**: only `icon(name,size)` from `js/icons.js`. Available: bell utensils bowl scale moon
  clipboard check chevron flame eye mail camera home grid bars user heart droplet back plus flash
  flip image search barcode edit message x target clock lock shield sparkle key bolt users gear share.
  **No emoji anywhere.**
- **Pills are read-only** (`.status-pill` never tappable). Interactive = `.choice`/`.chp`/`.btn`.
- **Never fabricate as real**: every simulated person/notification/board gets `simChip(...)` on the
  screen, and simulated chat senders get `sim:true`. Derived content comes from the user's actual
  answers wherever possible.
- **esc() every interpolated user value** (import from `../components.js`).
- One idea per screen. Minimal text. Numbers persuade; adjectives don't. Plain second person.
- Every screen must serve conversion, personalization, trust, education, or setup. No filler.
- Reduced motion is handled globally; don't add JS-driven animation loops.
- Titles may embed `<span class="accent">` styled text ONLY inside `.ob2-hero` h-title blocks.

### Mirror-back rule (personalization)
Discovery answers must be visibly used later. The aha screen quotes their exact numbers.
The plan screen (`ch2`) opens with 2–4 `mirrorCard`s: "You said **X**" → "so OnStandard does Y".

### Account step (every flow, ch4)
Replicate the legacy pattern — read `js/screens/onboarding.js` (steps 1, 7 + blocked) and
`js/screens/roles.js` (coach step 7) before writing yours:
```js
import { accountBody, wireAccount } from './ob-account.js';
// body: accountBody({terms:'ob'})  + your framing title
// mount: wireAccount(root, { role: SERVER_ROLE, onSession: async (live) => { ...persist...; window.__go(DEST); } });
```
Server roles: athlete flow `'athlete'`, client `'athlete'`, coach `'coach'`, trainer `'trainer'`,
parent `'parent'`, nutritionist `'trainer'` (rides the practice rail).
Persist calls: athlete+client `act.persistOnboarding()`; coach `act.persistCoachOnboarding()`
(then its code-reveal screen); trainer+nutritionist `act.persistTrainerOnboarding()`.
Parent: no persist fn — after session, if `ob.guardianToken` try
`sb.rpc('accept_guardian_invite', { token })` best-effort (read `js/screens/guardian.js` first),
then `window.__go('parent')`.

### Commitment step (ch3)
Use the hold-to-commit: `commitButton(committed)` + `wireCommit(root, onDone)` from `../ob-commit.js`
(`noFoot:true`; onDone → `capture({committedAt: new Date().toISOString()})` + `ctx.next()`).
Precede it with the role's commitment QUESTION screen whose answer configures defaults
(capture `commitLevel` etc.).

### Adaptive account/paywall (ch4, after account creation? NO — before dashboard, after account)
Order in ch4: connect/code step(s) → account creation → coverage/paywall screen → destination.
`paywallVariant(role)` resolves: `team_covered` (athlete with team join) → "Covered by your team"
confirmation (`.ob2-covered`, NO plan cards, NO prices); `trainer_covered` (client with practice
join) → "Your trainer's plan covers your access — pricing is set by [trainer]" (no consumer plans);
otherwise plan cards from `PLANS[variant]` via `planCard` in a `data-obkey="plan"` group +
"Start free — no card today" primary CTA + `ob-textlink` "I have a code" → back to the connect step.
Parent variant `free`: "Your connected account is free" screen. Billing is the honest free-preview
seam — the CTA continues; nothing charges. Copy must never promise a charge that can't happen.

### Destinations (final `window.__go`)
athlete → `home` (or `bio-optin` if `window.OnStandardNative?.biometrics` — copy legacy check),
client → `home`, coach → its code-reveal screen then `coach-home`, trainer → `trainer`,
parent → `parent`, nutritionist → `trainer`.

---

## Per-role step lists (ids fixed; copy direction given, final polish yours)

### ATHLETE — `js/screens/ob2-athlete.js` · `export const obAthlete` · route `oba` (~22 steps)
ch0: `why` hero "You train like it matters." / sub: the 20 invisible hours between practices decide
  the depth chart; `gap` hero: coaches see effort at practice, nobody sees the other 20 hours —
  "what gets seen gets done"; `answer` hero: OnStandard = one Daily Score built from what you
  actually do, seen by the people who hold you to it. First 3 screens must land problem →
  insufficiency → solution.
  `name` (first/last inputs → firstName/lastName/name — copy legacy step 1 input wiring, NOT dob here),
  `sport` (chips sport + level; capture sport/level; position chips if sport has positions — reuse
  legacy step 3 options), `goal` (choiceGrid: gain/lose/maintain/performance — legacy step 4 values),
  `goal-rate` scale10 → `goalImportance` ("How much does this goal matter?"),
  `acct-rate` scale10 → `accountabilityRating` ("How strong is your current accountability system —
  the thing that catches you when motivation dips?"),
  `obstacle` chips multi → `obstacles` (late-night eating / skipping meals / no plan / nobody checks /
  travel days / cafeteria food),
  `support` chips → `supporters` multi (coach / trainer / parents / teammates / nobody yet).
ch1: `aha` — the gap, their numbers: two meters (goalImportance×10 vs accountabilityRating×10),
  verdict card: "You rated your goal **N/10** but your accountability system **M/10**. That gap is
  exactly what OnStandard closes." (handle M≥N gracefully: praise + "let's make it visible").
  Then splice `mealDemoSteps({route:'oba', voice: ob.supporters?.includes('trainer') &&
  !ob.supporters?.includes('coach') ? 'trainer' : 'coach', computeScore})`.
ch2: `plan` — mirrorCards (goal, obstacle, supporters) + meter preview + "the system we're building
  for you" list (daily standard, AI analysis, your circle sees the score);
  `habit` — `.ob2-habit`: "**Before your first bite, take one photo.**" one easy habit anchor.
ch3: `commit-q` — "What standard are you ready to hold yourself to?" choiceGrid → `standard-level`
  capture `pressure`: `all-in` (every meal every day) / `steady` (main meals, honest weeks) /
  `building` (start with one meal a day) — explicitly configures reminder intensity, say so;
  `commit` — restate their standard + hold-to-commit (noFoot).
ch4: `proof` — 2 athlete testimonials + one stat line (label: "From early OnStandard athletes");
  `connect` — "Got a team code?" `.ob-input` code entry (A-Z0-9 4-12, uppercase) capture
  `join:{kind:'team', code}` + skip; `dob` — birth date (copy the legacy dobFromParts wiring +
  COPPA gate → next:'blocked' when age<13); `blocked` — replicate legacy blocked screen;
  `account` — accountBody/wireAccount → persistOnboarding → paywall step or destination;
  `covered`/`plans` — per paywall matrix (when-guards on variant); destination `home`
  framed as "Today's standard is live. One photo starts it."

### FITNESS CLIENT — `js/screens/ob2-client.js` · `export const obClient` · route `obf` (~20)
Same skeleton, client language (no team/depth-chart framing).
ch0: `why` "Your trainer sees 3 hours a week." / `gap` "Your results are shaped by the other 165."
  (make 3/165 the visual: countStat) / `answer`. `name`, `goal` (lose/build/maintain/health —
  legacy client-ob values), `trainer-status` choice → `trainerStatus` (have a trainer / had one /
  never — configures voice + connect), `sessions` chips → `sessionsPerWeek` (1-2/3-4/5+/none),
  `between` chips multi → `betweenSessions` (what actually happens between sessions: wing it /
  try to remember the plan / weekends undo the week / eat fine, can't prove it),
  `acct-rate` scale10 `accountabilityRating`.
ch1: `aha` — countStat 165 with "your trainer can coach 3 hours; OnStandard covers the other 165"
  + their accountabilityRating mirrored; meal demo spliced, `voice:'trainer'`.
ch2: `plan` mirrorCards + habit "Before your first bite, take one photo."
ch3: `commit-q` "How accountable do you want to be held?" (gentle/steady/strict → `pressure`) ;
  `commit` hold.
ch4: `proof` client testimonials; `connect` "Have a trainer code?" → `join:{kind:'practice',code}`
  + skip; `account` (role 'athlete', persistOnboarding); paywall: `trainer_covered` when practice
  join (name the trainer's plan honestly — price is set by their trainer) else `individual` plans;
  destination `home` ("Today's plan is ready — your trainer connection is one code away" if skipped).

### COACH — `js/screens/ob2-coach.js` · `export const obCoach` · route `obk` (~18)
ch0: `why` "You set the standard. Can you see who meets it?" / `gap` — the monitoring math teaser /
  `answer` — every athlete carries one score you can read in five seconds.
  `name` (+ "what the room calls you" — copy legacy coach step 1 handle derivation),
  `sport` chips, `team-size` chips → `teamSize` (10-/25/40/60+ → numeric), `expectations` chips →
  `dailyExpectations` (2/3/4/5 daily non-negotiables), `tracking` choice → `currentTracking`
  (group chat + memory / spreadsheets / an app they ignore / nothing formal), `staff` chips →
  `staffSize` (just me/2-3/4+), `blindspot` chips multi → `blindspots` (nutrition at home /
  weekends / injured guys / travel / freshmen).
ch1: `aha` — countStat: teamSize × dailyExpectations × 7 = **N individual actions a week** "your
  staff is currently trying to track by memory" + math line; demo: `req-build` — create a sample
  requirement (chips: template picks — protein target / lift log / weigh-in / meal photos);
  `req-assign` — assign to whole team or a position room (chips QB/OL/Skill/Bigs or Whole team);
  `board` — simulated completion board (`.ob2-board`, ~8 first-name rows, mixed done/miss,
  simChip) framed "this is Tuesday, 8:40pm, without a single text"; `breakdown` — tap-open score
  breakdown of one athlete (comp-read rows w/ real WEIGHTS 50/25/15/10); `alert` — missed-
  expectation notifCard preview ("Jaylen missed dinner log — 2nd day") + "you choose what's worth
  a ping"; `thread` — chatSim athlete+AI+coach on a meal (sim chips); `automation` — countStat of
  follow-ups automated/week (derive: teamSize × dailyExpectations × 7 × 0.7, label "checks your
  staff never has to make by hand — estimate").
ch2: `plan` mirrorCards (team size, expectations, blind spots) + "your program's system" list.
ch3: `commit-q` "What level of visibility does your staff need?" (scores only / scores + alerts /
  full detail → `visibilityLevel`, configures alert defaults — say so); `commit` hold ("Set the
  standard").
ch4: `proof` coach testimonials (retention/compliance-flavored); `staff-or-create` choice →
  create team vs join staff w/ code (capture `coachMode`, staff code → `staffCode`);
  `account` (role 'coach', persistCoachOnboarding — read legacy step 7 EXACTLY, incl. join-staff
  branch); `code` — team-code reveal screen (copy legacy coach-ob/8 incl. customize + copy
  actions) OR staff-welcome variant; `plans` — org tiers (PLANS.org) unless joined staff (staff
  seat is covered by the program — covered screen); destination `coach-home` framed "Your rooms
  are next."

### TRAINER — `js/screens/ob2-trainer.js` · `export const obTrainer` · route `obt` (~20)
ch0: `why` "Your value shouldn't stop when the session ends." / `gap` — hours/week chasing clients
  by text + the silent churn between sessions / `answer` — OnStandard keeps your standard in
  their pocket and your name on the results.
  `name` + practice name (`practiceName`), `clients` chips → `clientCount` (5-/10/20/30+),
  `service` choice → `serviceType` (in-person / online / hybrid), `followup-hours` chips →
  `followupHours` (1-2/3-5/6-10/more per week), `pain` chips multi → `pains` (clients ghost
  between sessions / can't see meals / results stall / retention), `price` chips → `pricePoint`
  (what they charge per month-ish band — used by revenue preview).
ch1: `aha` — countStat followupHours × 52 = hours/year chasing basics, "that's unpaid work your
  expertise is subsidizing"; `req-build` create a sample client requirement (chips);
  `meal-review` — review an analyzed client meal (use SAMPLE_MEAL from ../ob2-meal.js + foods +
  macros in phoneCards, simChip); `summary` — AI-assisted weekly summary preview (phoneCard
  bullets, simChip) + the 4 draft-reply stances (supportive/direct/context/followup — these ARE
  the real product's stances); `client-view` — what the client sees (their plan, your name on
  feedback); `price-set` — `.ob2-price` slider $19–$199 → `clientPrice` (default 49) + `.ob2-rev`
  live revenue math (clientPrice × clientCount midpoint, "projection — you set the real price
  later"); `retention` — hero: clients who log daily with a trainer attached stay — framed
  qualitatively, no invented stat.
ch2: `plan` mirrorCards + system list (client codes, daily queue, AI drafts you approve).
ch3: `commit-q` "How involved should OnStandard be in your client accountability?" (full autopilot
  with your approval / drafts only / observe first → `aiInvolvement`); `commit` hold.
ch4: `proof` trainer testimonials (revenue/retention-flavored); `account` (role 'trainer',
  persistTrainerOnboarding — read legacy trainer-ob); `code` — client-code reveal (copy legacy);
  `plans` PLANS.pro; destination `trainer` framed "Invite your first client."

### PARENT — `js/screens/ob2-parent.js` · `export const obParent` · route `obp` (~15)
Tone: peace of mind, never surveillance. Shorter, warmer.
ch0: `why` "You want to support them — not hover." / `gap` — asking "did you eat?" makes you the
  nag; silence makes you anxious; both lose / `answer` — see the effort, not the details:
  scores and streaks, never photos, weight, or meals.
  `name`, `athlete` (athlete first name input → `athleteName` + age band chips → `athleteAge`),
  `visibility-today` choice → `seesToday` (nothing / whatever they mention / I ask and it's
  awkward), `worry` chips multi → `worries` (eating enough / eating right / burnout / away at
  school).
ch1: `aha` — mirror: "Support works better when progress is visible without surveillance." +
  the two-line contrast (what you'll see vs what stays theirs); `summary` — parent-safe weekly
  summary preview (phoneCard: score trend sparkline-ish rows, streak, grade — simChip using
  `athleteName`); `milestone` — positive notifCard previews ("[Name] hit a 14-day streak");
  `missed` — missed-requirement notifCard preview + copy that BOTH of you choose whether these
  are on; `privacy` — `.ob2-bound` rows: you see score/streak/grade (green check icons) — you
  never see photos, weight, meals, messages (red lock icons; "their coach and trainer see detail;
  you see effort"); `boundaries` — visibility config chips → `parentDigest` (weekly digest /
  milestones only / milestones + missed alerts).
ch2: `plan` mirrorCards (worries → what the summary answers) + "the deal": they own the work,
  you get the trendline.
ch3: `commit-q` "How do you want to show up?" (quiet supporter / celebrate the wins / steady
  check-ins → `parentStyle`); `commit` hold ("Support the standard").
ch4: `connect` — guardian invite code/token entry (`.ob-input` → `guardianToken`; copy: the invite
  comes from your athlete — ask them to send it from their profile; skip allowed w/ honest "you
  can connect any time"); `account` (role 'parent'; after session best-effort
  accept_guardian_invite); `free` — "Your connected account is free" (`.ob2-covered` variant);
  destination `parent` ("[Name]'s summary lands here as soon as you're connected.")

### NUTRITION PRO — `js/screens/ob2-nutrition.js` · `export const obNutrition` · route `obn` (~18)
ch0: `why` "30 clients. 90 meal logs a day." / `gap` — deep-reading every entry doesn't scale;
  skimming isn't service / `answer` — AI does the first read on every meal; you spend your
  expertise where it moves outcomes.
  `name` + practice name, `clients` chips → `clientCount`, `practice-type` choice →
  `practiceType` (private practice / team or org staff / gym-affiliated), `workflow` choice →
  `currentWorkflow` (DMs + screenshots / an app's food diary / spreadsheets / paper),
  `review-hours` chips → `reviewHours`/week, `slips` chips multi → `slips` (weekend meals /
  portion drift / clients who go quiet / late logs).
ch1: `aha` — countStat clientCount × 3 × 7 = entries/week + "at 90 seconds each that's N hours of
  reading" math line; `queue` — review-queue preview (list rows: client, meal, AI quality score,
  flag state — simChip); `meal-open` — pre-analyzed meal open (SAMPLE_MEAL foods/macros);
  `correct` — correct a food + adjust a portion (interactive remove like demo-result + portion
  chips "looks right / bigger / smaller" → visible note that your correction trains their record);
  `feedback` — add professional feedback (prefilled editable composer-style input, simChip);
  `trends` — weekly trend preview (protein consistency bars per client, simChip);
  `flag` — flag-for-follow-up interaction + "your Monday starts with the flags, not the firehose";
  `collab` — chatSim athlete+coach+you (sim) collaboration preview.
ch2: `plan` mirrorCards (clientCount, slips → triage design).
ch3: `commit-q` "How should your review day run?" (AI triage, I review flags / I skim everything,
  AI drafts / observe first → `reviewMode`); `commit` hold.
ch4: `proof` professional testimonials; `account` (role 'trainer', persistTrainerOnboarding —
  practiceName carries over); `plans` PLANS.seat; destination `trainer` framed as
  "Your review queue is ready for its first client."

---

## Copy voice
Second person, plain, short declaratives, zero hype adjectives, numbers do the persuading.
Never "unlock your potential" / "crush your goals" / "game-changer". Sentence case everywhere.
Testimonials: realistic, specific, modest numbers; first name + role only; these are launch
placeholders the founder swaps for real customers — mark each testimonial block with a code
comment saying exactly that.

## Definition of done per flow
- File exports the flow named above; no other repo file touched.
- Every step renders without console errors with an EMPTY RT.ob (guards on every read).
- Back from first step returns to `role`; every dead end has an exit; skip paths honest.
- All interpolated ob values esc()'d; all simulated content chipped; no emoji; pills read-only.
- CTA disabled until required selections are made (data-req or manual gating).
- Screen count within the role's target band.
