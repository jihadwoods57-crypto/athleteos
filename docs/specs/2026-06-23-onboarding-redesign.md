# OnStandard — Onboarding Redesign (activation-first)

**Goal of onboarding is NOT account creation — it is reaching the first moment of value
(Starting Point Score → first meal → AI coaching) in under 5 minutes.** It should feel like
building a personalized development plan, not configuring a fitness app. Premium, mobile-first,
mostly taps, conversational. Cohesive with the committed light Athlete-Blue system (DESIGN.md) —
we borrow the *pacing and motion* of Oura/Whoop/Headspace, not their dark aesthetic.

## Decisions (locked with founder 2026-06-23)
- **In-system visual**: light canvas, Athlete Blue, Plus Jakarta Sans, big tight numerals.
- **Build everything in one pass** (all 7 roles + activation), shipped in green slices.
- **7 roles personalize onto the existing 4 dashboards** (no net-new dashboards):
  - athlete → `app`; parent → `parent`; personal_trainer & **nutritionist** → `trainer`;
    sports_perf_coach, hs_coach, college_coach → `coach`.
  - **Nutritionist** shares the trainer foundation but gets nutrition-specific widgets/insights
    (compliance, protein adherence, meal-consistency) and nutrition-flavored copy.
- Role drives **language, dashboard labels, notifications, messaging, goals**.

## Roles (7)
`Role = athlete | parent | personal_trainer | sports_perf_coach | nutritionist | hs_coach | college_coach`
First screen: **"Who are you?"** — 7 cards. Selection personalizes everything downstream.

## Athlete flow (the hero / activation path)
One question per screen, slim top progress bar + back, tap-first, docked Continue.
1. **Goal** (immediately after role) — 3 groups × 4 (Performance / Body Composition / Athletic
   Development), single-select. Drives all future AI coaching copy.
2. **Sport** (Football, Basketball, Baseball, Soccer, Track, Wrestling, Volleyball, Other).
3. **Position** — sport-aware chips; auto-skips when N/A. Recommendations become position-aware.
4. **Physical profile** — age, height, weight, target weight (tap steppers, no keyboard).
5. **Training frequency** — once / twice / three+ per day.
6. **Support team** — Coach / Trainer / Nutritionist / Parent / None; if any, optional invite code
   (builds the OnStandard network).
7. **Baseline assessment** (conversational, 6 questions):
   nutrition confidence 1–10 · meals/day · water/day · sleep hours · protein-target frequency ·
   **consistency** (week-to-week, new). Feels like a conversation, one at a time.
8. **Starting Point Score** (renamed from "Baseline Score") — animated reveal, e.g. **72 · C+**,
   copy: *"This is your starting point. It rises as OnStandard learns your real habits."*
9. **First Challenge** — "Today's goal: Upload your first meal" → large **Start Now** CTA.

Identity (name, optional email) is captured lightly and woven in for personalization
("{name}, here's your starting point") — never framed as account setup.

## Starting Point Score (honest, pure core)
New pure module `src/core/startingScore.ts`: `startingScore(answers) → { score, grade }`.
- Maps the 6 baseline answers to 0–100. Each answer contributes a weighted, transparent share
  (nutrition confidence, protein frequency, consistency carry the most; meals/water/sleep round it).
- Grade shows **+/−** (band thirds) for the reveal: `gradeWithSuffix(score)` (e.g. C+). Reveal-only;
  dashboards keep whole-letter grades (no churn).
- **Honest**: the score is explicitly an *estimate from self-report* ("updates as we see real
  data"). The answers also **seed real engine state** (sleep→`ciSleep`, etc.) and the score is
  written as day-0 in `scoreHistory`, so the in-app Athlete Score continues *from* it, never
  contradicts it (PRODUCT.md: honest accountability).

## Activation (every path ends here)
- **First-meal challenge** → camera capture → analyzing animation → result.
- Logging the first meal **immediately increases the score** (e.g. 72 → 75) with an animated
  bump + haptic — the reward that proves the loop works.
- **AI Nutrition Coach screen = the showcase / most premium surface in the app.** Leads with
  **education + coaching + the next action + score impact**, not macros:
  - A coach-voiced insight (why this meal serves *your goal*), a plain-English education beat,
    a concrete **next action**, and a **"+N to your score today"** impact line.
  - Meal quality score present but supporting; macros demoted to a secondary strip.
  - Should feel like *"I have a nutrition coach in my pocket,"* not *"I logged food."*

## Other 6 roles (short, tailored, end in activation = invite)
Each 3–4 taps, personalized copy, ending on **"Invite your first [athlete/client/roster]"**
with a share/code:
- **Personal Trainer**: client type · active clients · biggest challenge · invite first client.
- **Sports Performance Coach**: sport · position groups · # athletes · biggest dev challenge · invite first athlete.
- **Nutritionist**: specialty · # clients · primary client type · biggest nutrition challenge · invite first client.
- **High School Coach**: school · sport · # athletes · position groups · invite roster.
- **College Coach**: school · sport · position group · roster size · invite athletes.
- **Parent**: athlete name · age · sport · position · current weight · goals · invite athlete.

## Step engine
Flows are **data** (arrays of typed step descriptors); one `<OnboardingStep>` shell + one renderer
drives all 7 roles. Slide transitions, progress bar, back. Replaces the hand-rolled `obStep`
switch in `Onboarding.tsx`.

## Motion & a11y
Step slide transitions · progress fill · cinematic score-ring reveal (`aos-ring` draw + number
count-up + grade fade) · score-bump animation on first meal · `expo-haptics` on select/advance/
reveal/meal-add · all reduce-motion aware · ≥44px targets · labels on icon-only controls.

## Targets
Onboarding < 3 min · activation (first AI coaching) < 5 min. Feeling: *"This app understands me."*

## Build slices (each ends green: tsc + jest + expo export)
1. Core: 7-role type + role→flow/personalization map; new onboarding state; `startingScore()` +
   `gradeWithSuffix()` (pure, unit-tested); baseline→engine-state seeding.
2. Data-driven step engine + shared step shell.
3. Athlete flow screens (goal→…→baseline).
4. Starting Point Score reveal component.
5. Activation: score-bump on first meal + premium AI Nutrition Coach screen.
6. Other 6 role flows.
7. Role personalization (labels/copy) + nutritionist nutrition widgets on the trainer dash.

## Out of scope (unchanged)
Phase-2 Supabase wiring (scaffold stays inert); net-new dashboards; real camera/LLM (capture +
coaching remain deterministic simulations).
