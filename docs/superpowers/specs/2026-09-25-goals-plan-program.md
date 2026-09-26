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

## A2 in detail (A1 shipped 2026-09-25: merge d1e7db34, OTA 01a0db2e)

Everything in A2 is DETERMINISTIC: no new model calls and no new AI cost. Text that the app writes is
never signed as Nia, with one exception: the opener "why" (below) is part of the opener, which Nia
already signs and which is composed deterministically today.

### 1. Why these numbers (replaces the goal-panel link on Plan > Today)
- A screen that explains the athlete's REAL targets (the graded `DAY.proteinTarget` / `DAY.calTarget`).
  - Protein per day with its basis: about Xg per pound for this goal, from the same math as `goalDerivedTargets` (state.js 750-784). Include the per-meal split ("about 45g at each of 4 meals", using the Plan/opener split math).
  - Calories per day, and what they mean for this goal.
  - "How to eat it": a 1-2 sentence plain rule for the goal.
- **Coach-set targets.** Say "Your coach set these numbers" and keep the general why. Hide the goal comparison.
- **Goal comparison.** A segmented Maintain / Lean out / Gain / Perform control showing what each goal would mean. Numbers come from `goalDerivedTargets` for the athlete's own inputs. The athlete's current goal is marked "Your goal". Only shown when the targets are goal-derived.
- **Minors.** No bodyweight figures, no "per pound" wording, and no weight-change language. Use "for your body and training".
- **Intuitive.** "Why this plate": no figures at all; explain the plate for the goal.
- Style: the A1 look (calm, one accent, ≥44px targets), with a back button to Plan.

### 2. Nia's "why this matters" (opener)
- **Server** (`_shared/meal-opener.ts`). `composeOpener` also returns `why`: one short deterministic sentence (at most 200 chars), keyed by goal (gain / lose / maintain / perform) and by the topic of the move it made (protein short, protein closed, carbs around the day, a late meal, a snack). Put it in the opener row's `meta.why`, the same way `meta.ask` was added. It is not part of the text, so older clients show nothing new.
  - Write a small library, 3+ variants per goal x topic, picked deterministically by the meal id so it doesn't repeat every time.
  - Intuitive: no numbers.
  - Minors: no weight language.
  - It must pass the plan-style rail, and scrubToolLeak must never be needed.
- **Client** (`thread-polish.js`). When the opener row has `meta.why`, render a collapsible chip under the opener bubbles, "Why this matters for gaining" (the label follows the goal wording). Tapping expands it into a bubble in the goal accent (teal); tapping again collapses it.
  - The athlete's own threads only. The coach view shows it expanded, labelled "Why (for their goal)", or hides it; your call, but document it.

### 3. Weekly focus plus Sunday recap (Home)
- **Picking the focus.** Computed on the device from the last 14 days of the athlete's own meals and days. Candidates:
  - breakfast protein, lunch protein, dinner protein, measured against the per-slot share of the target;
  - missed required meals;
  - logging late (minutes_late);
  - snack consistency when the snack is required.
- Pick the weakest candidate that has enough data (≥5 days of that slot). Keep it stable for the ISO week (persisted per athlete and week; recomputed only if there's no data).
- With fewer than 5 days of data overall: no card, or a gentle "Log a few days and Nia will pick your focus" (not signed Nia).
- **The card** (on Home, one calm card):
  - "This week's focus" (teal), the focus title, and one line on why it matters most for them, with a real number for numbers styles ("Breakfasts average 22g").
  - A Mon-Sun tracker of hits.
  - 3 tips from a library per focus, checkable, stored locally per week.
  - "Ask Nia why this matters", which opens the nutrition chat with that question typed but NOT sent.
- **Intuitive.** The same focus, phrased without numbers ("A palm of protein at breakfast"). The tracker still works from the data, but shows no grams.
- **Sunday recap** (Sunday, and Monday until noon). One quiet line under the card:
  - protein days hit X of 7, and which slot missed most;
  - for adults with weight data, the weight pace from the existing weight trend;
  - the average day score.
  - Deterministic, and not signed Nia.

### 4. What works for you (personal insights)
- Correlate the athlete's own days: meal behaviours (a slot's protein hit, all required meals logged, logged on time) against the check-in fields (energy, recovery/soreness, sleep, confidence, motivation).
- **CHECK-IN POLARITY IS LOAD-BEARING.** Soreness and cravings storage must never be flipped. Read them the way the existing code reads them (see the memory note / state.js), so "better" means better.
- **Thresholds:**
  - ≥10 days with both meals and a check-in;
  - each group ≥3 days;
  - a mean difference ≥1.5 points on the 1-10 scale.
- Show at most 2 insights. Honest, non-causal wording: "On days your breakfast hit 40g, your energy averaged 8. On days it didn't, 5."
- For intuitive athletes, express the behaviour without grams ("a palm of protein at breakfast").
- **Where it shows:** the Progress page ("What works for you") and, when strong, in the Sunday recap.
- Never for guardians' views.

### Done means
- Tests: the target explanation math (parity with goalDerivedTargets), the minor and intuitive gating, the why library selection plus the rails, the focus picking and its stability, the tracker, the insight thresholds and polarity.
- All gates green, the zip rebuilt.
- Screenshots in qc/plan-teach/, dark and light at 390, looked at.

## B in detail (A2 shipped 2026-09-26: merge e08b743b, OTA 01a0dd06)

The founder approved B on 2026-09-26 ("Start it"). They said the app needs to know what part of the season the team is in, and that target changes need coach approval.

### 1. Season phase (team level)
- **Phases:**
  - `off` Off-season (build)
  - `pre` Pre-season (ramp up)
  - `in` In-season (perform and recover)
  - `post` Post-season (recover and reset)
- **Where it's stored:**
  - On the team: `teams.season_phase` (text, check constraint on the four values, default null = not set) plus `teams.season_phase_at` (timestamptz).
  - Solo athletes (no active team) can set their own phase on their profile (`athlete_profiles.season_phase`, same values).
  - Trainer practices have no season. Their clients never see the feature, unless they are also on a team.
  - An athlete on a team always uses the team's phase. The phase belongs to the team, not the athlete.
- **Who sets it:** only staff who may edit the team's standards (reuse the existing staff-role / caps gating; view-only staff can't). An RPC or policy enforces that server-side.
- **Coach UI:** one clear control on coach Home (or team settings, whichever the coach sees most): "Season: In-season", which opens a sheet with the 4 phases, each with a one-line meaning. Changing it confirms with a line saying what changes for athletes. It never renders for view-only staff.
- **What the phase changes (goal-derived targets ONLY; coach-set numbers are never touched):**
  - Protein is unchanged.
  - Calories are adjusted against the goal's base. The adjustments are deliberately small and conservative, as product defaults the coach can override:

    | goal | off | pre | in | post |
    |---|---|---|---|---|
    | gain | 0 | 0 | -150 | -100 |
    | lose | 0 | +100 | +250 | 0 |
    | maintain | 0 | +100 | +150 | -100 |
    | perform | 0 | +100 | +150 | -100 |

  - The existing floors still apply (e.g. 1500).
  - The math lives in the one shared targets function (state.js `goalDerivedTargets` / `nutritionConfigForGoal`), so the athlete device, the coach reconstruction and the Why screen all agree.
  - The server side (anything that recomputes targets) must match, or read the device's pushed targets. Find out which and keep them in parity with a test.
- **Athlete surfaces:**
  - The Plan › Today hero shows the phase with the goal ("Gaining · In-season").
  - Why these numbers explains the phase's effect in one line ("In-season: a smaller surplus, so energy for games comes first").
  - Minors: no weight language (as before).
- **Nia:** the athlete dossier (`_shared/athlete-dossier.mjs`) and the plan-ideas prompt get the phase, with one line of guidance per phase (e.g. in-season: no aggressive cuts, carbs around competition, recovery). The opener why library gets phase-aware variants where natural. These must stay deterministic, with no new model calls beyond the existing ones.
- **Unset phase:** everything behaves exactly as today.

### 2. Adaptive targets (suggest, then the coach approves)
- **Who:** adults (never minors) with goal gain or lose, goal-derived OR coach-set targets, and weight data:
  - at least 3 weigh-ins spanning at least 10 days in the last 21 days;
  - uses the existing weight pace logic (`S.weight.pace` in weight.js / progress.js).
- **When:** at most once every 14 days per athlete. Deterministic, no model call. Computed on the athlete's device at app open (or the cheapest correct place).
- **What:**
  - If the pace is off the plan, suggest a calorie change of ±150 to ±250 (sized by how far off), never below the floor:
    - gaining slower than planned: +
    - losing slower: -
    - too fast either way: toward the plan
  - Protein stays unless the bodyweight changed enough to move the per-pound target by 10g or more.
  - Reason text is plain and specific: "Gaining 0.2 lb a week against a plan of 0.5. Suggest +200 calories."
- **Storage:** a new `target_suggestions` table:
  - columns: athlete_id, team_id (nullable), created_at, current and proposed protein/kcal, reason, status (pending/approved/declined/expired), decided_by, decided_at;
  - RLS: the athlete inserts and reads their own; linked staff with target-edit rights read, approve and decline for their athletes; guardians see nothing;
  - grants per the repo's patterns.
- **Coach flow:**
  - A pending suggestion shows in the coach's Inbox / Home as a compact card: "Suggested change for Jihad: +200 cal", with the reason, and Approve / Decline.
  - Approve sets the athlete's coach targets through the existing `roles.coachSetGoals` path, so it becomes coach-set, and marks the suggestion approved.
  - Decline marks it declined; no new suggestion for 14 days.
  - Suggestions expire after 14 days if nobody decides.
- **Solo athletes** (no coach) see the suggestion themselves on Plan › Today and can accept or dismiss it.
- **Athletes on a team** see only "Your coach is reviewing a target change", or nothing. They never get a self-accept.
- **Honesty:** the suggestion is deterministic, so it is labelled "Suggested change", never signed Nia.

### Done means
- Tests:
  - the phase adjustment table and parity (device, coach, server);
  - coach-set targets are never altered;
  - phase gating by role;
  - the suggestion math (pace thresholds, sizing, floors, the 14-day cadence, the minor exclusion);
  - RLS for both new structures (SQL tests in supabase/tests, registered in run.sh);
  - the approve path goes through coachSetGoals.
- All gates green, zip rebuilt.
- Screenshots in qc/plan-season/, dark and light at 390, looked at:
  - coach phase control and sheet
  - athlete hero with the phase
  - Why screen with the phase line
  - coach suggestion card
  - solo athlete suggestion

## C in detail (B shipped 2026-09-26: merge 458dd575, 0252-0254, OTA 01a0dd6f)

The founder approved C on 2026-09-26. Their words: "Maybe the nutritionist can upload the dining halls meal schedules to that app so it could know and make it useful."

### 1. Staff upload a dining hall's menu and hours
- **Who.** Team staff with standards-edit rights (the same role set as 0252's `can_set_team_phase`). Teams only; no practices or solo athletes.
- **Halls.** A team has 1 or more halls: a name, plus serving hours per period (breakfast, lunch, dinner, and an optional late or grab-and-go period) for each weekday.
- **Menu upload.** A photo, several photos, a PDF, or pasted text, covering one day up to about 2 weeks. Store the uploads in a team-scoped private storage bucket. The existing buckets show the patterns for folder-scoped policies.
- **Parsing.** One model call per upload (vision for images and PDF, text for pasted input), in a new or existing edge function. It turns the upload into structured entries: `{ hall, date, period, station?, items: [{ name, per_serving: { protein, kcal, carbs, fat }?, tags?: ['vegetarian', 'contains dairy', …] }] }`.
  - Macros are estimates per standard serving. Mark them as estimates.
  - Scrub every string: tool-leak scrubber, plain characters, length caps.
  - Cost telemetry, a per-team daily cap, and the spend gate. Add the function to the ai-cost-watchdog checklist.
- **Review before publish.** The parsed menu is saved as a DRAFT. Staff see it grouped by day and period, can edit an item's name and macros, delete items, and add items. Nothing reaches athletes until they press Publish. They can unpublish or replace a day later.
- **Tables.** Tables for halls and menus (draft or published, per hall, date and period), with RLS:
  - staff of the team read and write, gated by role;
  - the team's athletes read PUBLISHED menus only;
  - guardians and other teams see nothing.
  - Grants per the repo's patterns. Use the next free migration number after 0254.

### 2. Athletes get dining-hall plates on Plan › Today
- **When.** A PUBLISHED menu exists for today at one of the team's halls, for the period that matches the athlete's up-next slot.
- **What.** Ideas include up to 2 plates from that menu, built DETERMINISTICALLY (no per-athlete model call):
  - pick a protein item, then a carb, then a vegetable or fruit, so the plate hits the slot's protein share;
  - filter out allergies and dislikes first, using the A1 avoid words, rule terms matched inside words;
  - respect the plan style: Intuitive shows no figures;
  - tag the plate "Dining hall: <hall name>", with the station if known.
- **Planning.** It works like any idea (plan, then snap). The photo rule holds, and the planned name feeds the photo read hint.
- **If the hall is closed for that period, or it's not today's menu:** no dining-hall ideas.

### 3. Nia knows today's menu
- **Chat context.** When a published menu exists for today, meal-chat's context (the dossier or day context) gets a compact list of today's remaining periods at the athlete's team halls, capped in length.
- **Prompt.** "What should I eat" style answers prefer real menu items, and never invent items that aren't on it.
- **Cost.** No new model calls; only a few more input tokens.

### Done means
- **Tests:** the parser output sanitising and bounds, RLS (SQL tests), the deterministic plate builder (allergies, the plan-style rail, protein share), the publish gating, and the cost caps.
- **Gates:** all green; zip rebuilt.
- **Screenshots** in qc/dining-hall/, dark and light at 390, looked at:
  - staff: halls list, upload, draft review, published;
  - athlete: Today with a dining-hall plate (numbers and Intuitive);
  - chat: an answer referencing the menu (a stub is fine).

## D in detail (C shipped 2026-09-26: merge fc96e80a, 0255, OTA 01a0de02. E is PARKED by the founder.)

The founder approved D on 2026-09-26 ("Do D park E"). Everything in D is deterministic, with NO model calls.

### 1. Sixty-second lessons
- **Library.** 12 lessons as static content in a lazy proto module. Each lesson has an id, title, one-line summary, 3 to 5 short cards (at most 60 words each, one idea per card), and one quick check (a multiple-choice question with 3 options, and a one-line explanation shown after answering).
- **Topics:**
  1. protein at every meal
  2. a breakfast that holds up
  3. carbs are fuel
  4. eating before training (general timing; the app does NOT know practice times)
  5. the recovery meal after training
  6. hydration basics
  7. eating on the road (travel, fast food)
  8. building a plate at the dining hall
  9. game-day eating
  10. snacks that count
  11. reading a nutrition label
  12. food first: supplements (conservative)
- **Supplements lesson.**
  - No product endorsements.
  - Say plainly: "Talk to your team dietitian first. Some supplements contain substances banned by the NCAA and other governing bodies, and labels are not always accurate."
  - Never recommend a specific supplement.
- **Content rules:**
  - Accurate, conservative, mainstream sports-nutrition guidance.
  - No medical claims.
  - No weight-loss framing for minors: for minors, weight words are replaced or the card is skipped.
  - Intuitive variants replace figures with the plate model.
  - Plain, second-person voice.
  - No em dashes.
  - Not signed by Nia. It's OnStandard content.
  - Each lesson maps to the weekly-focus candidate it teaches, where one fits (breakfast protein → lesson 2, and so on). The weekly focus card links to its lesson.
- **Athlete surfaces:**
  - A "Learn" list, reachable from Plan (a sub-tab or a row: your call, keep it calm) with every lesson and a done check.
  - A lesson view: swipe or tap through the cards, then the quick check, then "Done".
  - An assigned lesson shows on Home as one compact card: "From Coach Grinch: Carbs are fuel · 1 min", with the due date if one is set. The card disappears when the lesson is done.
- **Coach surfaces:**
  - "Assign a lesson" from coach Home or the create menu.
  - Pick a lesson, an audience (the whole team, or a room/position group if rooms exist), and an optional due date.
  - A progress view per assignment: "14 of 22 done", with who has and hasn't finished (names are visible to staff only).
  - Only staff with standards-edit rights can assign (0252's can_set_team_phase set). All staff can read progress.
- **Push.** One push per assignment to the assigned athletes: "Coach Grinch assigned a 1-minute lesson: Carbs are fuel". Use the existing push path and notification preferences. Never push again for the same assignment.
- **Storage** (next migration after 0255):
  - `lesson_assignments`: team_id, lesson_id (text, checked against a known list or a pattern), room_id nullable, due_on nullable, assigned_by, created_at.
  - `lesson_completions`: athlete_id, lesson_id, completed_at, quiz_correct boolean; unique (athlete_id, lesson_id).
  - RLS:
    - Staff of the team read assignments. Editors insert and delete.
    - Assigned athletes read their team's assignments.
    - An athlete writes only their own completions.
    - Staff read completions of their athletes. Guardians and other teams see nothing.
  - Grants per repo patterns. SQL tests go in supabase/tests.

### 2. Team focus challenges
- **Setup.** A coach picks one habit from the weekly-focus candidates:
  - breakfast protein, lunch protein, dinner protein
  - no missed required meals
  - logging on time
  - snack consistency, when the snack is required

  They also pick a date range (default: this Mon-Sun, at most 14 days) and a goal (default 5 of 7 days). One active challenge per team at a time. Editors create and end it.
- **Progress: computed on the SERVER from stored rows, so a phone can't fake it.** A SQL function computes each athlete's hits from `days` rows (checkin.slotMacros protein per slot vs the per-slot share of the stored target, mealLoggedAt/minutes-late, meals ticks), using the SAME definitions as `weekly-focus-model.js`. A parity test compares the SQL and JS results on shared fixtures. If full parity is impractical for one candidate, drop that candidate from challenges and document it.
- **Athlete view (Home):**
  - While a team challenge is active, it REPLACES the personal weekly-focus card, so there are never two focus cards.
  - It shows the challenge title, the athlete's own tracker, and team progress as a count only ("14 of 22 on track"), never other athletes' names.
  - Intuitive athletes see no grams.
- **Coach view:** team progress, with each athlete's hits (staff only), and an End challenge action.
- **Push.** One push when a challenge starts. No streak nagging.
- **Storage:** `team_challenges` (team_id, habit, starts_on, ends_on, goal_days, created_by, ended_at), with the same RLS pattern and SQL tests.

### Done means
- **Tests:**
  - lesson content lint: word caps, no em dashes, the minor/intuitive variants exist wherever figures appear, the supplements lesson carries its caution line, and each quick check has exactly one correct answer;
  - completion recording;
  - assignment RLS;
  - challenge SQL parity with weekly-focus-model;
  - challenge RLS;
  - the Home card priority (a challenge replaces the focus card; an assigned lesson card sits above it);
  - push-once.
- **Gates:** all green, zip rebuilt.
- **Screenshots** in qc/lessons/, dark and light at 390, and look at them:
  - Learn list
  - a lesson's cards and quick check
  - Home with an assigned lesson
  - coach assign sheet
  - coach progress
  - challenge on Home (athlete, numbers and Intuitive)
  - coach challenge view
