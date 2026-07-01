# OnStandard — Next-Phase Product Spec (post-onboarding)

**Thesis:** "The best coaches don't stop coaching when the session ends." OnStandard measures
what happens *between* sessions. First habit = nutrition. Athletes upload meals → AI coaches
them → it rolls into an Athlete Score → overseers (coach/trainer/nutritionist/parent) see
compliance and intervene. **This phase adds NO new features.** It sharpens the three surfaces
that already exist into the smallest version that proves people will *use and pay*.

Grounded in the shipped code: scoring in `src/core/scoring.ts` (`computeDerived`/`gradeFor`),
meal results in `src/core/content.ts`, coach surfacing in `src/core/person.ts`/`leaderboard.ts`,
onboarding `startingScore` in `src/core/startingScore.ts`.

## Reconciling the brief with what's already built
- The brief lists **Recovery** and **Consistency** as score contributors but also says "do NOT
  build recovery scores." Resolution: the score model already includes recovery (via the weekly
  check-in) and tasks; we **keep the existing model** and do not add new recovery capture
  (no wearables). **Consistency** is expressed through the **trend layer** (score history),
  not a new sub-score. No re-weighting unless it's free.
- Messaging exists in the app but is **out of scope** for this phase (brief: no team messaging).
  Coach action this phase = the lightweight "nudge", not a chat surface.

---

## 1. AI NUTRITION COACH (Priority #1 — the showcase)

This is the single most important screen. It must feel like **a nutritionist in your pocket**,
never MyFitnessPal / macro-tracking / calorie-counting. Macros are *evidence*, not the point.

### The screen, top to bottom (priority order = value order)
1. **Coaching insight (hero).** One coach-voiced sentence tying *this meal* to *this athlete's
   goal*. Leads with meaning. e.g. "Great post-workout meal. The chicken gives you high-quality
   protein for muscle repair; the rice replenishes glycogen so tomorrow's session has fuel."
2. **Score impact.** "+N to today's score." The number moves *because they did the work* — the
   reward that proves the loop. Animated bump.
3. **Daily context.** Where this meal leaves them today: "You're ~35g behind your protein
   target — one more protein-forward meal closes it." On-pace / behind framing, never raw totals.
4. **Suggested next step.** One concrete, goal-aligned action: "Add Greek yogurt, eggs, or a
   shake tonight." Tappable where it maps to a quick-add.
5. **Education beat.** A short "why this matters" line that teaches, building trust the way a
   real nutritionist does.
6. **Weekly context (when available).** Only after ≥3 logged days: "3rd straight day hitting
   protein — this is the consistency that moves your score."
7. **Evidence strip (demoted).** Detected foods + estimated protein/cal/carb/fat, small and
   secondary. Present for credibility, never the headline.

### The 9 required elements → where they live
food ID (7) · estimated nutrition (7) · goal alignment (1) · personalized coaching (1) ·
education (5) · next step (4) · score impact (2) · daily context (3) · weekly context (6).

### Voice & bans
Coach-room real, precise, motivating, never hype. Honors PRODUCT.md/DESIGN.md. No "calories
remaining" ring-as-hero, no macro grid as the focus, no gamified confetti, no em dashes.

### Data (deterministic for now — no API keys)
Extend `content.ts` so each `MealResult` carries goal-aligned coaching text keyed by the
athlete's `primaryGoal`, plus an education line and a next-step. Daily/weekly context is
**derived** (`computeDerived` protein gap/pace + `scoreHistory`), so it's honest and never
invented. Real LLM swaps in behind this contract later (a human milestone).

### Done = "significantly more valuable than a tracker"
A user finishing this screen should think "I have a nutrition coach," not "I logged food."

---

## 2. ATHLETE SCORE FRAMEWORK (Priority #2 — the shared language)

The score is the common currency across all five roles. It must be meaningful and honest.

### Composition (as implemented — documented, not changed)
`athleteScore = 0.40·nutrition + 0.20·recovery + 0.20·weight + 0.10·tasks + 0.10·checkin`
- **Nutrition (40%)** — protein vs target + meals logged. The dominant, validation-critical lever.
- **Recovery (20%)** — weekly check-in (sleep/energy/etc.); no new capture added.
- **Weight (20%)** — progress toward the season weight goal.
- **Tasks (10%)** — daily accountability items done.
- **Check-in (10%)** — did they complete the weekly check-in.
Nutrition's weight is deliberately highest because nutrition is the habit we're validating.

### Grade logic (`gradeFor`)
A ≥90 · B ≥80 · C ≥70 · D ≥60 · F <60. Onboarding reveal additionally shows +/- (`gradeWithSuffix`).

### What the numbers mean (the language)
- **95 (A)** — dialed in. Hitting protein, logging meals, on weight track, check-in done. "On standard."
- **75 (C)** — real but inconsistent. Doing some of the work, missing protein or days. "On the bubble."
- **60 (D/F line)** — not accountable yet. Meals/protein/check-in mostly missed. "Needs intervention."

### Daily vs weekly
- **Daily** = `computeDerived` on today's state. Resets on calendar rollover (history preserved).
- **Weekly** = the 7-day trend from `scoreHistory` + the "this week" delta already on Home.
- **Consistency** lives here: it's the *shape of the trend*, not a separate number.

### Trend logic
Up/flat/down vs prior, from real history (no magic numbers). This is what coaches scan.

---

## 3. COACH DASHBOARD FRAMEWORK (Priority #3 — intervention, not analytics)

The dashboard answers exactly one question on open: **"Who needs my attention today?"**

### Structure (intervention-first)
1. **Needs Attention (top, the point).** Ranked list of at-risk athletes with the *reason* and
   *one action*. e.g. "Marcus — protein missed 4 of 7 days → Nudge". "Sarah — hydration
   trending down". "Jordan — weight gain stalled". Already seeded by `person.ts`/roster comp;
   make the reason a real derived sentence and attach the nudge.
2. **Three glance KPIs** (team avg / compliance / alerts) — context, not the focus.
3. **Roster** — sorted so the people who need work surface first, each with score + grade + trend.

### What it is NOT
No analytics suite, no reports, no charts-for-charts. Every element should drive an action in
under 3 seconds. The only action this phase is the **nudge** (no chat).

### Personalization across the coach-family roles
Sports-performance / HS / college coaches share this dashboard with role-tuned labels;
**nutritionist** rides the trainer/client foundation but its Needs-Attention is nutrition-first
(protein adherence, meal consistency) — same engine, nutrition lens.

---

## 4. USER FLOWS

- **Athlete (the loop):** open → Home (score + today) → log meal → **AI Nutrition Coach** →
  score bumps → next step → return tomorrow. Onboarding now feeds this with a Starting Point
  Score and a first-meal challenge.
- **Coach/Trainer/Nutritionist (the loop):** open → Needs Attention → tap an at-risk athlete →
  see why + the meal/score detail → **nudge** → done. Glance the roster, leave.
- **Parent:** open → their athlete's compliance + trend + coach note → reassurance or concern.
- **Network:** every overseer onboarding ends in **invite**; the athlete accepts → both sides
  light up. This is the wedge that makes the product multiplayer.

## 5. SCREEN HIERARCHY (minimal set)
- **Athlete:** Home (score) · Nutrition (+ AI Coach result) · Plan (tasks) · Check-In · Profile.
- **Overseer (coach/trainer/nutritionist):** Dashboard (Needs Attention + roster) · Athlete
  detail (score + meals + nudge).
- **Parent:** single athlete view.
Everything else (squad leaderboard, messages, advanced settings) is **secondary** this phase.

## 6. MVP FEATURE SET (smallest valuable version)
**IN (validation-critical):** AI Nutrition Coach (showcase) · meal upload → score loop ·
Athlete Score (daily + weekly trend) · Coach/overseer Needs-Attention dashboard + nudge ·
invite/network · the 7-role onboarding (done).
**DEFERRED (explicitly not now):** wearables, Apple Health, Garmin, Whoop, recruiting, NIL,
social feeds, communities, *new* recovery scoring, team messaging/chat, advanced reporting,
real-LLM/real-camera (swap behind the deterministic contract later), Supabase backend wiring.

## 7. PRODUCT RATIONALE (optimize for validation)
Each piece exists to answer "will they use it, will they pay?":
- **AI Coach** tests athlete pull — do they come back for the coaching? (retention signal #1)
- **Score** tests shared language — do overseers and athletes start talking in score? (stickiness)
- **Needs-Attention dashboard** tests overseer pull — does it save a coach time and surface a
  save they'd have missed? (the willingness-to-pay moment for coaches/trainers/nutritionists)
- **Invite/network** tests virality + multiplayer value (one coach brings a roster).
Keep the surface tiny so the signal is clean: if this minimal loop retains and converts, the
roadmap is earned. If it doesn't, no amount of features would have saved it.

**The line we're chasing:** every overseer should open OnStandard and think
*"I finally know what my athletes are doing when I'm not with them."*
