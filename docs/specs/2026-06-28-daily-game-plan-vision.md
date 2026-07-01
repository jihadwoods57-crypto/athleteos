# North-star vision — The Daily Game Plan

**Status:** SAVED VISION, not a build order. Authored 2026-06-28 from a founder-supplied
product brief. The board's standing call is *validate the loop before widening*, so this is
parked as the destination, with one piece (the Projected Development Score) extracted and
built now because it reinforces the core loop rather than widening past it.

## The idea (keep this)
A proactive morning screen — the athlete's daily HQ — that answers "what should I do today
to win?" instead of "what happened yesterday." Reframes the app from reactive tracker
(Eat → Log → Feedback) to a daily operating system (Plan → Execute → Learn → Adjust → Improve).
The emotional target: "I know exactly what I need to do today to become a better athlete."

This is a genuinely good direction and it matches where the app already points. The caution is
**timing and scope**, not the concept.

## Honest inventory — most of this already exists, scattered
Before building anything new, note how much is already shipped (don't pay to rebuild it):

| Brief element | Already in the app |
|---|---|
| Today's Focus (one priority) | `nextBestAction` / the Home next-move card |
| Today's nutrition targets | Coach Plan (`coachPlan.ts`) + Nutrition macro rings |
| Recommended restaurant orders | Restaurant Coach (`restaurantCoach.ts` / FoodCoach) + the off-menu fallback |
| Meal windows, "get back on track", escalation | Accountability Engine (`adherence.ts`) + Plan tab |
| Coach's daily emphasis | `planInstructions` → Plan tab "Coach instructions" |
| In-the-moment AI coaching | `mealCoaching` on the meal result |
| Today's progress / score | Development Score + Home |

So ~60–70% of the brief is **consolidation + a morning framing** of existing surfaces, not
net-new engines. That consolidation is a legitimate UX/IA project — but it is design work, not
a feature explosion, and it should happen *after* the loop is validated.

## Genuinely new pieces
- **Projected Development Score** — current vs reachable, with the checklist to get there.
  **BUILT NOW** (`src/core/projection.ts`, Home "Finish today" card). Pure, reuses
  computeDerived (single authority), honest (recovery not inflated, projected floored at
  current). This is the rare new thing that *strengthens* the loop, so it ships in the
  prove-the-loop beta.
- **Daily challenges as first-class, score-affecting items** — partially present (the
  first-meal challenge); a full daily-challenge system is new.
- **A unified "morning game plan" home screen** — the IA that stitches the above together.

## What the brief asks for that is currently BLOCKED (and by what)
- **All-day proactive AI coaching** ("Excellent start, you're 25% to protein") → needs the
  real AI, which is stubbed (`isAiConfigured = false`) until the backend + a paid endpoint.
- **Real-time plan adaptation / nudges through the day** → needs local notifications, which
  are wired in-app but inert until `expo-notifications` is installed + tested on a device.
- **Coach sees each athlete's Daily Game Plan progress** → needs the live backend (real roster
  sync); today the roster is demo data.
- **Recommend exact home meals every morning** ("4 eggs, oatmeal, Greek yogurt, banana") →
  needs a real meal-planning engine + a fuller food database. D5 ruled: keep the 55-food
  starter for now. **Honesty risk:** the app earns trust by never fabricating authority; a
  screen that confidently prescribes specific meals it can't actually back would be the first
  place that honesty cracks. Hold this until there's an engine behind it.

## Phased path (tie each phase to validation, not the calendar)
1. **NOW (loop-reinforcing, shipped):** Projected Development Score on Home.
2. **After the loop validates + engines flag flips:** consolidate the existing surfaces
   (focus, plan, restaurant, accountability, coach emphasis, projected score) into one
   "Daily Game Plan" morning screen. Pure IA/design over existing engines — little new logic.
3. **After the AI endpoint is live:** the proactive, all-day coaching voice.
4. **After notifications ship on-device:** real-time intra-day adaptation + nudges.
5. **After the backend is live:** coach visibility of each athlete's daily-plan progress;
   feed the plan into the weekly coach report (the team report already exists).
6. **Only behind a real meal-planning engine + food DB:** exact home-meal recommendations.
   Until then, keep recommendations to the Restaurant Coach (which has real menu data) and
   honest macro targets — never invented specific plates.

## The one-line guardrail
Build the Daily Game Plan as a *consolidation of validated, real surfaces* — never as a
beautiful front door over stubs and fabricated meals. The morning screen should make the
honest engine feel like an elite performance staff; it should not pretend to be one.
