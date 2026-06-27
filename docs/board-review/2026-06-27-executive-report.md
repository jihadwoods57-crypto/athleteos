# AthleteOS Advisory Board — Executive Report

**Night 2 of 4 · 2026-06-27 (UTC)** · Branch reviewed: `crew/4day-sprint` @ `bb03cba` (tag `day2-end`)
Convened by the board convener; founder away. 15 independent members reviewed real flows in clean
contexts (real fan-out) and quoted live code. Review-only; no app code/tests/config touched.

> **Note on cadence:** Night 1 produced **no board verdict** (only the charter was written; see the
> 2026-06-26 founder digest). **This is the board's first scored verdict.** The baseline it measures
> against is the 7-persona review (`docs/PERSONA-REVIEW-2026-06-24.md`) and the Day-1 state
> (`checkpoint/day1-end`). The "Delta since last night" section (§8) covers the Day-2 sprint work.

---

## 1. TL;DR + overall beta verdict

**Verdict: NOT YET.** Board-wide beta-readiness **3.07 / 10** (range **2–5**, n=15).

> **The single most important sentence:** Day 2 shipped four new feature areas (better meal logging,
> reminders, weekly report + messaging, wearable recovery) and **not one of them is wired to a surface
> a real user can reach** — while the one loop the whole product rests on, *log a meal → see/edit
> macros → move the score*, still **discards every edit on "Save Changes"** and grades a hardcoded
> constant, and the sprint **added an unsupervised minor↔adult messaging channel with zero governance.**

The board's harshest, most repeated charge this night was a **discipline failure dressed as progress**:
the pure logic is clean and well-tested (679+ cases, green), but `weeklyReport` has **zero references in
`src/screens`**, `blendRecovery` has **no caller in scoring**, reminders **cannot fire**
(`isNotifyAvailable=false`), and messaging **reaches no one and isn't even persisted**. Breadth was
built on top of a loop that still can't save one meal. The lowest seats — **Sharon (parent, 2)**,
**GTM (2)**, and **Head of Retention (2)** — all reject for the same root cause: the load-bearing
mechanism in their lane (a real linked child; a working invite/funnel; a re-engagement trigger) is a
no-op behind the OFF flag. The single highest seat — **Coach Reyes (5)** — credits the Performance
track as "the most honest thing in this app," then docks it because performance still feeds nothing.

---

## 2. Top 10 highest-impact improvements before beta

Ranked by board impact. Effort S/M/L. "Sprint status" = whether the 4-day sprint is addressing it.

| # | Fix | Why it matters | Flagged by | Effort | Sprint status |
|---|-----|----------------|-----------|--------|---------------|
| 1 | **Make the meal-log loop real end-to-end.** `MealDetail` edits/added foods live in local React state; **"Save Changes" → `s.closeMealDetail` (MealDetail.tsx:223)** discards them. The score's nutrition input is still the `MEAL_MACROS` constant keyed on a boolean (`constants.ts:23`, `content.ts:175`), so an edited plate never moves the number. | The marquee P2 feature is cosmetic; a logging app that can't save a log isn't v0.9. | Dana, Product Lead, UX, Jayden | M | **Not addressed** — P2 stopped at the widget |
| 2 | **Wire or cut every dead Day-2 feature.** `weeklyReport`/`weeklyReportText` = **0 refs in `src/screens`**; `blendRecovery` = **no scoring caller**; `refreshReminderSchedule` never called live; messaging delivery gated OFF. | "Built the pure logic" ≠ shipped. Four invisible features = surface area, not value. | Tucker, Marcus, VC, Product Lead, Retention, Habit, Reyes | M | **Regressed** — added 4 unreachable features |
| 3 | **Real verifiable parental consent + AI medical disclaimer, before the flag flips.** The only minor "consent" is a **self-tappable checkbox the child taps** (`Onboarding.tsx:544–550`), gated behind OFF. No VPC, no guardian identity, no "not medical advice" line on any AI coaching surface, no privacy policy/support URL. | Legal gate for a minors' body-weight + nutrition app; what gets it pulled or sued. | Compliance, Vance, Sharon, VC | L | **Not addressed** — and Day-2 widened the liability |
| 4 | **Stop shipping minor↔adult messaging with no governance.** `messages` RLS gates only on thread membership (`0002_rls.sql:143–148`) — no age check, no guardian visibility, no moderation, no audit; `msgThread` isn't even in the persist whitelist (`useStore.ts:612–639`), so the "record" evaporates on reload. | A new unsupervised adult-to-minor channel is a liability with no retained record. | Compliance, Vance, Tucker | M | **Regressed** — new this sprint, ungoverned |
| 5 | **Kill the demo strings leaking into live screens.** `Home.tsx:179` "38 days left", `:193` "by Playoffs · Nov 14", `:244` "by Nov 7"; `CheckIn.tsx:78` "Week 14"; the **static weight-trend SVG** (`CheckIn.tsx:151–153`); the permanent **fake red notification dot** (`Home.tsx:112`); `Messages.tsx:42` "Active now". | The baseline "nothing on screen is real" reads as a lie in the 5-second glance. | Jayden, UX, Product Lead, Habit, Tucker | S | **Not addressed** |
| 6 | **Make the invite/join loop work + reset the seeded roster.** Invite CTA and "Skip" both call `finishOb()` (`useStore.ts:246–249`) → only flips a flag; the shared **`EAGLES24`** code is hardcoded (`Onboarding.tsx:687`, `Profile.tsx:37`); coach lands on the seeded Coach Davis/Eastside roster they never recruited. | A two-sided beta where no second user can join has no funnel to measure. | GTM, VC, Retention, Tucker | M | **Not addressed** (real RPCs exist behind OFF flag) |
| 7 | **Decide performance↔score, then honor it in the name.** `perfEntries` is referenced **nowhere in `scoring.ts`/`content.ts`**; a PR'd 40-yard dash moves the headline by zero. Either fold a real athletic signal in, or rename the "Accountability Score" so it stops implying athletic development. | The "performance jersey on a nutrition tracker" bait-and-switch persists. | Jayden, Reyes, Vance | M | **Not addressed** (D3 deferred to founder) |
| 8 | **De-fake the streak and the check-in "AI summary."** `currentStreak()` pads with `SEEDED_LEAD` (`history.ts:226,304`) so a 1-day user sees a multi-day flame; `CheckIn.tsx:63–65` hardcodes "Energy and confidence are up" regardless of the sliders just set. | The two moments a habit app must be earnest (streak reward, reflection) are both faked — instant trust-kill for teens. | Habit, Retention, Jayden | S | **Not addressed** |
| 9 | **Server-side score recompute + sync conflict handling.** `days.score` is written client-side and stored verbatim (recompute deferred, `0002_rls.sql:190–194`) → **forgeable** the instant a leaderboard is live; `upsertDay` is blind last-write-wins (`queries.ts:27–32`) → two devices silently clobber. | The central competitive number is only as trustworthy as the client binary; sync loses data. | Engineer, Reyes | L | **Not addressed** (backend OFF) |
| 10 | **Give coaches/trainers a real action + surface the weekly report.** The only roster action is still a **no-op Nudge** (`useStore.ts:493–504`, local array only); no bulk/group action from a filtered roster; the weekly digest isn't rendered anywhere. | The coach value is delivery, not the generator; segmenting 40 athletes must lead to acting on them. | Tucker, Marcus, Vance | M | **Partially** (digest built, not wired) |

---

## 3. Biggest risks

- **Existential (retention can't be measured / loop never ran).** After two sprint days the backend
  flag is still OFF, so **not one real coach/athlete/parent has touched the loop**; there is no
  activation/retention instrumentation and the "habit engine" (reminders) physically can't fire.
  *— VC, Head of Retention, GTM.* **Mitigation:** flip the flag for one closed cohort, create one real
  coach→athlete→parent edge, instrument D1/D7 return and meals-per-active-day before adding any feature.

- **Legal / regulatory (minors' health data).** No verifiable parental consent (self-tap checkbox),
  no AI "not medical advice" disclaimer, no privacy policy/support URL, FERPA unaddressed — **and Day-2
  added an ungoverned minor↔adult messaging channel and a HealthKit ingestion seam on top.**
  *— Compliance/Legal, Coach Vance.* **Mitigation:** real VPC flow recorded in `guardianships`,
  user-facing medical disclaimer on every AI surface, age/guardian gate on messaging RLS, publish a
  privacy policy — all **before** the flag flips. An un-investable posture for a paid "Parent Plan."

- **Retention / habit.** The whole thesis is "teens log daily," yet there's **no re-engagement trigger
  wired** and **silent churn is invisible** to every dashboard (rollover only runs on app-open;
  PersonDetail defaults to "Today"). The streak — the one real hook — is faked on day 0.
  *— Head of Retention, Habit critic.* **Mitigation:** wire one real notification end-to-end; surface
  "days inactive" on the roster; show real streak days only.

- **Technical (score defensibility + sync).** Client-computed, server-trusted score (forgeable); a
  hardcoded **57-point floor** on the 50%-weighted nutrition component (`scoring.ts:162`) so a
  zero-effort day still scores 57/100; blind last-write-wins sync; `blendRecovery` is unvalidated dead
  code that will silently rewrite every recovery sub-score when wired. *— Skeptical Staff Engineer.*
  **Mitigation:** server recompute from raw inputs before any leaderboard; conflict precondition on
  upsert; justify or remove the floor; gate `blendRecovery` behind a reversible, calibrated flag.

- **Product focus.** Day-2 is "textbook scope-sprawl" — five half-apps (nutrition, reminders, reporting,
  messaging, wearables) stapled to a demo, while the core loop can't save a meal. *— Brutal Product Lead, VC.*
  **Mitigation:** resource only `meal → macros → score → accountability` for beta; defer the rest.

---

## 4. Most-challenged assumptions (the board's strongest pushback)

1. **"Building the pure logic IS shipping the feature."** *(The night's loudest, near-unanimous
   pushback — Tucker, Marcus, Retention, Product Lead, Reyes.)* A weekly digest no screen renders and a
   message that reaches no athlete are worth **zero**. The leverage is delivery, not the generator.
2. **"Honest labeling makes an inert feature shippable."** *(UX.)* A perfectly worded "saved on this
   device" note does not redeem a green **Save Changes** button that throws away the user's work.
3. **"The Accountability Score is the right organizing metric for an athlete."** *(Jayden.)* For the
   17-year-old it's a *compliance* score for adults to watch; he came for playing time and a scholarship
   case, and the one feature that measures that (Performance) was deliberately firewalled from the number.
4. **"Visibility-to-authority is the engine of behavior change."** *(Habit critic.)* For teens that's the
   engine of short-term compliance and long-term resentment; durable habits need autonomy/competence, and
   every motivational signal here is routed to a watcher (coach/parent/grade/nudge).
5. **"Fail-closed code guardrails make us legally safe."** *(Compliance.)* They make the *OFF* build safe
   by doing nothing — a deferral, not a compliance achievement. The legal obligations are unbuilt.
6. **"The hard part is the product; distribution follows."** *(GTM.)* For a two-sided teen tool the hard
   part is cold-start, and the sprint spent the night on single-player features while the invite loop is a no-op.
7. **"If the minimal loop retains and converts, the roadmap is earned."** *(VC.)* Right in spirit, but the
   team never shipped the loop to a real user — it widened scope instead.

---

## 5. Strongest and weakest parts (consensus)

**Strongest (earned):**
- **The Performance track (P1)** — "the first genuinely real, athlete-entered development data in this
  app" (Reyes, Jayden): `logPr` writes real PRs; `summarizeMetric`/`perfSparkGeometry` compute honest
  best/trend with improvement always reading "up." No fakery.
- **Engineering discipline & honesty as code** — 679+ green tests, seams *honestly labeled inert*
  (`isNotifyAvailable=false`, `messageDeliveryNote`), the consent gate that **fails closed** and treats
  unknown age as a minor, the **well-scoped RLS spine** (`0002_rls.sql`), and a clean `FOUNDER-DECISIONS`
  risk ledger. (VC, Compliance, Engineer.)
- **The behaviorally-literate reminder model** — conditional, anti-nag, guilt-free copy (`reminders.ts`).
  Genuinely good design — that fires nothing. (Retention, Habit, UX, Jayden.)
- **Score-honesty surfaces** — the "What's in this score?" panel naming self-reported inputs, the killed
  hardcoded `weightScore=95`, and `mealScoreImpact` recomputing the real engine instead of a fake "+N."
- **Roster triage at scale** — `rosterGroups`/`filterRoster`/`notLoggedCount` + derived `needsAttention`
  consistent with the KPI; "the first part of this app that earns a coach's time." (Tucker.)

**Weakest (consensus):**
- **The core meal-log loop** — edits don't persist; the score grades a constant.
- **Everything Day-2 shipped as a user feature** — invisible/inert; reachable by no one.
- **The minors consent/governance posture** — and it got *wider* this sprint, not safer.
- **"Nothing is real" demo theater** — still bolted to live Home/CheckIn/Messages/streak.

---

## 6. Kill / Keep / Double-down

**KILL (or hide before beta):**
- The four unreachable Day-2 features as *shipped features* — `weeklyReport`, `blendRecovery`/recovery,
  the reminder notify-specs, and messaging delivery — until one surface is wired. Dead code behind the
  user's back reads as theater.
- Every hardcoded demo string on a live screen: "38 days left"/"Nov 14"/"Nov 7", "Week 14", the static
  weight-trend SVG, the permanent red notification dot, the "Active now" presence lie, the `SEEDED_LEAD`
  streak pad, the static check-in "AI summary," and the `EAGLES24` literal.
- The "QUALITY" label on a single-axis protein-density proxy (`mealEdit.ts:88–93`) — call it
  "Protein density" or build a defensible score.

**KEEP (protect):**
- The pure scoring core, the fail-closed consent gate, and the RLS spine — left untouched this sprint (good).
- The honest-labeling instinct and the FOUNDER-DECISIONS discipline.
- The Performance track and the roster-triage layer — the two things real users credited.

**DOUBLE-DOWN:**
- **One loop, made real:** `meal → editable macros that persist → score moves → accountability`. This is
  the product. Resource only this for beta.
- **The intervention dashboard** (worst-first triage + reason + one action) — but give the action teeth
  (a delivered message/note with a retained record), not a local no-op Nudge.

---

## 7. Recommended beta

- **Scope:** the single nutrition-compliance/accountability loop **with edits that persist and a score
  that consumes them**, plus the coach triage dashboard with **one delivered action**. Cut reminders,
  messaging, weekly-report, and wearable recovery from the beta surface until each is wired and governed.
- **First ICP / audience:** a small, hand-held cohort of **HS / sports-performance coaches (roster
  ~15–40)**, sold honestly as nutrition-compliance — **athletes whose parents are not yet in the loop**,
  so the missing minor-consent layer isn't load-bearing. Defer parents, college/P5, RD, and
  non-athlete-trainer audiences until consent/governance, a defensible score, persisted real macros, and
  a real intervention action exist. (Matches the build-plan's own ICP.)
- **Pricing hypothesis:** one price, one buyer — a **per-coach seat** (the multiplayer wedge: "one coach
  brings a roster"); get a verbal/LOI willingness-to-pay **before** adding any further feature. The repo's
  only monetization reference today is a parenthetical "Parent Plan $24.99" — untested and, for minors,
  un-investable without consent.
- **The ONE metric to watch:** **activated coach→athlete edges that log ≥3 of the first 7 days** —
  i.e., does a real second user join *and* the loop retain. Everything else (TAM, virality, pricing
  depth) is noise until that number is non-zero. This requires flipping `EXPO_PUBLIC_BACKEND_LIVE` for
  the closed cohort and standing up basic activation instrumentation — neither exists today.

---

## 8. Delta since last night

*Night 1 produced no board verdict, so this delta measures the **Day-2 sprint work** (P2–P5,
`origin/checkpoint/day1-end` → `bb03cba`) against the Day-1 state and the 7-persona baseline. The diff is
**33 files / +2,186 lines**, almost entirely `src/core` pure logic and `src/lib` inert seams, plus three
UI touch-points (`Reminders.tsx`, `MealDetail.tsx`, `Messages.tsx`).*

**What the sprint genuinely closed or improved:**
- **Dead meal steppers → live** (persona finding #7, partial). `MealDetail` steppers now recompute
  macros/quality/composition from editable portions; a curated 55-food DB (`foodDb.ts`) lets a user add a
  food with **real** per-serving macros; the estimate is honestly relabeled "adjustable estimate, not a
  weighed value." *(Caveat: edits don't persist — see below.)*
- **Fake "+N" meal impact → real.** `mealScoreImpact` (`coaching.ts:33–39`) now recomputes the real
  engine before/after instead of a fabricated bump.
- **Fake 92% retention KPI → sample-labeled** (`TrainerView.tsx:72`) — partial close of "fake KPIs."
- **College roster band widened to 85–110** (`flows.ts`) — closes Coach Vance's "51+ cap" complaint.
- **Score-honesty groundwork held** (carried from Day-1): "What's in this score?" panel, `weightScore=95`
  killed, `SCORE_WEIGHTS` naming self-reported inputs.

**What regressed or newly opened (Day-2 added liability/surface without governance):**
- **Minor↔adult messaging shipped with zero governance** — no age/guardian gate, no moderation, no audit;
  `msgThread` not persisted; a hardcoded "Active now" presence lie contradicting the not-delivered footer.
- **A HealthKit/Health-Connect recovery seam + `blendRecovery`** added as dead code that will silently
  rewrite every recovery sub-score (0.6/0.4, uncalibrated) when wired — new technical + consent surface.
- **Four new feature areas, none reachable** — `weeklyReport` (0 screen refs), recovery, reminder
  firing, messaging delivery are all inert; "scope-sprawl, not focus."

**What remains open and untouched by the sprint (the load-bearing baseline findings):**
- "Nothing on screen is real" — **largely unchanged.** Seeded roster/leaderboard/threads, hardcoded Home
  season-goal dates, static weight-trend chart, `SEEDED_LEAD` streak, `EAGLES24` code, and the static
  check-in "AI summary" all still ship on live screens.
- **Real invite→roster→sync pipeline** — exists only behind the OFF flag; not exercised.
- **Minor consent/governance live** — `consent.ts` fails closed but is inert behind OFF; the self-tap
  checkbox is not verifiable parental consent; no medical disclaimer, no privacy policy.
- **Score measures zero athletic performance** — `perfEntries` feeds nothing; the 57-point nutrition
  floor and client-trusted score are intact.
- **Meal macros don't persist and the score still grades a `MEAL_MACROS` constant** — the food DB is, for
  the score, decorative.
- **Coach action is still a no-op Nudge** — no delivery, no bulk action.

**Net:** the engineering stayed disciplined and added some genuine honesty fixes, but the sprint **spent
its day on breadth behind flags instead of making the one loop real**, and it **widened the legal surface
(minor messaging) without a single governance control to match.** Board readiness did not move off the
floor: **3.07 / 10, NOT YET.**

---

*Prepared by the AthleteOS Advisory Board convener · 15 independent reviews on `crew/4day-sprint` @ `day2-end`.
Brutally honest by charter. The goal is to expose every weakness before real coaches, parents, and
investors do.*
