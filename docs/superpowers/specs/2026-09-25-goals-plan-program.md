# Goals and eating plan: program spec (2026-09-25)

Founder request: make the goals / plan side as strong as the meals, and teach athletes how to eat for
their goal. The founder approved the mockup at https://claude.ai/artifact/YLyjBXiFfJWVdC8TckXo3h
(Today, Why these numbers, Nia's why, weekly focus) and ideas 2 to 9. Idea 1 is ruled out: the app
does NOT know practice or lift times and must not start collecting them.

## Standing rules (every phase)
- **No logging without a photo.** Ideas, usuals, dining-hall picks and plans can only PLAN a meal. The camera is the only way to log. Never add tap-to-log, quick-add or text-only logging for athletes.
- **Intuitive plan style.** No macro or calorie figure reaches an intuitive athlete. They get the plate model: a palm of protein, a fist of carbs (two after hard training), half vegetables.
- **Minors.** No weight talk or weight figures. Guardians see only the daily score and grade (0081).
- **Nia honesty.** Scripted or deterministic text is never signed as Nia. Model output passes the tool-leak scrubber (`_shared/tool-leak.ts`).
- **AI cost.** Prefer deterministic code. Every paid call goes through the existing telemetry and daily caps. Cache per athlete, per day and slot.
- **Engineering.** No bundler (lint:undef). lint:boot has about 0.6 KB of headroom, so new client code must be lazy. CSS is one flat namespace, so prefix classes. No em dashes in copy. Coach-set targets always override goal-derived ones.

## Phases
- **A1. Today plan.** Pick, plan, snap. Meal ideas come from usuals and Nia. Food preferences. The planned meal is passed as a hint to the photo read.
- **A2. Teaching.** "Why these numbers", Nia's "why this matters" line, weekly focus plus a Sunday recap, and "what works for you" insights (meals × check-ins).
- **B. Season phases.** Set by the team. Targets adjust: Nia suggests every 2 weeks, the coach approves.
- **C. Dining hall menus.** The nutritionist uploads them. Nia picks the best options per athlete and goal, and they feed A1's ideas.
- **D. Coach-assigned 60-second lessons, and team focus challenges.**
- **E. Parent grocery list** from the week's plan.

Each phase gets its own branch, review and ship (server first, then the OTA).

## A1 in detail

### 1. Plan › Today becomes forward-looking (`screens/plan.js`, Today sub-tab)
- **Hero.**
  - Numbers styles: a protein ring showing "Ng to go", a calorie line, the goal label ("Gaining", plus "200 to 210 lb" only for adults with a goal weight), and a "Why these numbers" link. The link target lands in A2; for now it can open the existing goal panel.
  - Intuitive: the plate graphic with the three plate rules instead of numbers.
  - The plan style decides which one shows. There is no toggle.
- **Up next.** The next unlogged required meal slot, taken from the athlete's coach standard or the default 4-meal slots (the existing slot model; snack last).
  - Target: the remaining protein and calories split over the remaining slots. Use the SAME math as meal-opener's "Land around Xg at each of your last N meals" so the thread and the plan never disagree. Share or port it; don't reinvent it.
  - Intuitive: "Build it like the plate."
- **Ideas: up to 3, as a selectable list.**
  - First, the athlete's Food Memory usuals, ranked for what's left (the existing ranking in plan.js ~382-403).
  - Then Nia ideas to fill up to 3, from the existing meal-chat suggest path (`suggest_meal`, meal-chat/suggest.mjs). Cached per athlete, day and slot, so opening Plan never re-bills.
  - Each idea shows its name and either "Ng protein · N cal" or, for intuitive athletes, "One of your usuals" / "A new idea", plus a tag.
- **Plan it.** Selecting an idea then tapping "Plan <short name>" stores the plan for that slot:
  - where: in the day's `checkin` JSON as `plans: { <slot>: { name, protein, kcal, source, at } }`;
  - it syncs like the rest of `checkin`, and the server score must IGNORE it (verify every scoring path);
  - the ring shows a faint ghost arc of the planned protein.
- **Planned state.** "Tonight's plan" (or "Lunch plan"…), with Change and one primary button, "Snap it when you eat". The button opens the camera for that slot. That is the ONLY log path.
- **Logged.** When the slot's photo meal lands, the card shows the real read: name, protein and score. The ring fills from the real numbers, never from the plan.
- **Remaining slots** after "up next" (e.g. the snack) collapse to one row with their ideas as plain suggestions. **Logged slots** collapse to one quiet row.
- **Ask Nia for other ideas** opens the nutrition chat pre-filled, or the existing suggest flow.

### 2. The planned meal as a hint to the photo read
When a photo is taken for a slot that has a plan, send it to analyze-meal as `plannedMeal: { name }`. In the prompt:
- "The athlete planned to eat <name>. Use it ONLY to help name foods you can clearly see. Never add items that are not visible. The photo is the truth; if the plate doesn't match the plan, read the photo."
- Sanitize the name (length cap, scrubToolLeak, plain characters).
- Test that a plan never adds macros for unseen food.

### 3. Food preferences (idea 7)
- **Fields.** Budget-friendly (about $5 or less), no-cook / dorm, grab-and-go, plus free-text likes and dislikes (short lists).
- **Storage.** Stored on the athlete, via a migration if no suitable column exists (e.g. `profiles.food_prefs jsonb`) with RLS: owner read/write, staff read for their athletes.
- **UI.** A small "Food preferences" section with chips, in Plan › Nutrition (or wherever settings of this kind live), and optionally one onboarding step if cheap.
- **Use.**
  - Usuals are filtered by dislikes.
  - Nia ideas get the prefs in their prompt.
  - Ideas are tagged "Under $5" / "No cooking" / "Grab and go" when the model says so.
- **Allergies.** The existing coach allergies and food rules still apply and outrank preferences.

### Done means
- Tests for the slot and target math (parity with meal-opener), the plan storage ignored by scoring, the idea ranking and caching, the plannedMeal sanitizing, the prefs RLS and filters, and the intuitive/minor gating.
- All gates green, zip rebuilt.
- Screenshots of Today at every state (choose, planned, logged, intuitive, no usuals, all logged) in dark and light at 390, looked at.
