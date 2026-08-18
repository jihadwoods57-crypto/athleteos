---
target: team nutritionist
total_score: 25
p0_count: 0
p1_count: 3
timestamp: 2026-08-18T09-45-30Z
slug: proto-redesign-2026-07-js-screens-coach-home-js
---
# Critique: the team nutritionist / dietitian experience

Target: `proto/redesign-2026-07/js/screens/coach-home.js` (nutrition lens: paintNutritionBoard, VOCAB table) plus `ob2-dietitian.js`, `staff-access.js`, `nutrition-chat.js`, `coach.js`, and the three doors into the nutrition book. Register: product. Visual pass RAN: populated 8-athlete board + obd onboarding rendered headlessly via mocked Supabase.

## Design Health Score

| # | Heuristic | Score | Key issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 3 | Skeletons, flag counts, nudge delivery-truth all present; but the 60s cache repaints silently stale (coach-home.js:447) and "114 NEW" on Live activity is an uncapped count that reads as badge inflation (coach-home.js:647,704) |
| 2 | Match System / Real World | 2 | An RD is titled "Coach" in the greeting and nudge sender (state.js:3849); Plan tab offers "Training week" and "Position rooms" to a dietitian (coach.js:539-544) |
| 3 | User Control and Freedom | 3 | Nudge is two-step and editable; no undo on "Handled"; queue rows clear only by opening each meal |
| 4 | Consistency and Standards | 2 | Onboarding demo scans by meal score, shipped board scans by protein (ob2-dietitian.js:84 vs coach-home.js:507); "Fueling priorities" eyebrow heads generic accountability cards; three doors, three noun registers |
| 5 | Error Prevention | 2 | Invited-RD role-picker trap mints duplicate teams; Assign buttons render for a staff role the server refuses |
| 6 | Recognition Rather Than Recall | 3 | Honest inline denominators ("7 of 7 days"); fueling bar scale (per-row relative max) explained nowhere (coach-home.js:541) |
| 7 | Flexibility and Efficiency | 2 | No bulk actions (no "mark all reviewed"); fueling row's only affordance is navigation, no quick message |
| 8 | Aesthetic and Minimalist Design | 3 | The board itself is calm and disciplined; the screen around it is ~2,400px of eight sections and the same plates render twice (queue + activity rail) |
| 9 | Error Recovery | 3 | Keeps last-known data on flaky fetches; board's error line has no retry control (coach-home.js:555) despite errorState being the house primitive |
| 10 | Help and Documentation | 2 | Tour exists; "flagged" is never explained on-surface, nor how the fueling average is computed |
| **Total** | | **25/40** | **Acceptable: significant improvements needed** |

Cognitive load: 4 of 8 checklist items failed (single focus, chunking, one-thing-at-a-time, minimal choices). Per the rubric that is critical. The clearest symptom: one athlete (render: Noa) is judged three ways in one viewport, absent from the queue, "~92g avg" mid-table, and #1 CRITICAL in priorities.

## Anti-Patterns Verdict

**LLM assessment: PASSES the product slop test**, with three subtly-off components. A Linear/Stripe-fluent user would broadly trust it: solid-ink score numeral, no side-stripes, no glassmorphism, no identical card grids, gradient law honored on fueling bars, sweep stays off non-score geometry. The pauses: "Good morning, Coach Reyes" greeting a Registered Dietitian; the uncapped "114 NEW" counter; the obd demo claiming "every row is a real plate photo" over three blank grey tiles.

**Deterministic scan: clean for this surface.** All six target files scanned (JS regex mode verified live with a probe); zero findings originate in the nutritionist screens themselves. The only hits were shared app-shell CSS patterns already adjudicated in `.impeccable/critique/ignore.md`.

## Overall Impression

The board's bones are genuinely right: plate-photo-first rows, protein as the scan number, flags-then-unopened ordering, honest denominators, all four data states. What undercuts it is identity and intelligence. The product signs the dietitian's work "Coach", routes an invited RD into accidentally founding a duplicate team, and the fueling table cannot actually answer the one question it exists for: who is underfueling.

## What's Working

- **The four-states law is honored for real**: shaped skeleton (coach-home.js:451), error that keeps last-known flags instead of clearing them (459-469), teaching empty state (556), and denominators spoken out loud ("~12g avg · 7 of 7 days"). Rare in this category.
- **Triage physics are correct for an RD**: photo leads, protein is the scan number, flags first then unopened (482-521), and the reasoning is documented in-code as deliberate.
- **The obd flow speaks fluent RD**: "quiet underfueling", travel-meal blind spots, the interactive portion-correction step where "your correction is the record" (ob2-dietitian.js:224-254), plus an honest "not actual customers yet" disclaimer.

## Priority Issues

1. **[P1] The invited staff RD is routed into minting a duplicate team.** The coach's invite copy says "They pick 'Coach' at sign-up" (roles.js:1218), but the role picker now shows a card literally named "Team Dietitian / RD" (ob2-role.js:27), and obd has no join mode and no staff-code step: it unconditionally creates a new team (ob2-dietitian.js:336-346). The natural path ends with the dietitian owning an empty duplicate team while the coach's invite never redeems. Fix: add a create-vs-join fork to obd that accepts the staff code (door 3's board already renders for role `nutritionist`), and update the invite copy.
2. **[P1] The product un-names the profession it just sold.** obd collects the RD/RDN/CSSD credential promising it "rides your name where staff see your reviews" (ob2-dietitian.js:135-138); nothing consumes it, no handle is captured, and `coachIdentity` falls back to "Coach Reyes" in the greeting and in athlete-facing nudges (state.js:3849, coach-home.js:869). For a credentialed profession this is mis-titling in the product's own trust currency. Fix: write the handle through the existing coachName rail ("Dana Reyes, RD") and surface the credential on reviews, or delete the question.
3. **[P1] The fueling table cannot answer "who is underfueling."** Absolute grams with no target or body-weight context (coach-home.js:531-547): 90g is failure for a lineman, surplus for a setter. Averaging over logged days only hides the riskiest pattern: 2-of-7-days Noa looks fine mid-table while priorities calls the same athlete CRITICAL one scroll later. kcal is fetched (roles.js:276) and never shown. Fix: rank by risk (coverage x avg vs the per-athlete protein target that already exists via coach_set_goals), badge low coverage, show target or kcal beside the avg.
4. **[P2] The dietitian's home is a coach screen with a slot in it.** The queue, the dietitian's actual day, is the third artifact down a ~2,400px screen led by the coach's group score; the same plates appear twice (queue + Live activity rail, coach-home.js:704-717); 24 buttons across the priority stack. This is what drives the critical cognitive-load count. Fix: under isNutritionBook(), reorder (queue first, pulse demoted) and dedupe meals out of the activity rail.
5. **[P2] Onboarding teaches a different board than ships.** Demo rows scan by amber meal-score pills (ob2-dietitian.js:83-84); the shipped board deliberately removed the score for protein. Demo claims every row is a photo while three of five tiles are blank. Sub-copy "Lowest plates first, unopened next" matches neither sort. Fix: rebuild DEMO_QUEUE to mirror shipped row anatomy and correct the copy to "Flags first, unopened next."

## Persona Red Flags

**Alex (Power User, the RD working a 20-athlete roster daily)**: no bulk actions anywhere: cannot mark-all-reviewed, cannot clear flags without opening each meal one at a time. The fueling row's only affordance is navigation; messaging an athlete from the board takes a detour through athlete detail. The 60s silent cache means the second glance of the morning can be stale with no cue.

**Jordan (First-Timer, an invited dietitian holding a staff code)**: reads the invite ("pick Coach at sign-up"), sees a card named after their own profession, taps it, and ends up owning an empty duplicate team with no roster and no error. Nothing confirms the staff code was never redeemed. This is the abandonment cliff, and it fails silently.

**Dana (project persona: credentialed RD, letters are livelihood)**: introduces herself with RD/RDN/CSSD in onboarding, then watches the product greet her as "Coach Reyes" and sign her nudges to teenage athletes the same way. Meanwhile she is denied the weight trend (staff-access.js:86), the one signal her RED-S/underfueling work runs on, while the S&C trainer can see it.

## Minor Observations

- Em dashes in user-facing strings despite the DESIGN.md ban (coach-home.js:211, 305).
- Off-scale inline font sizes on the flagship operator screen: 11.5px and 9.5px against the 12-step token scale (coach-home.js:223, 392, 426, 715).
- Board error line lacks the house retry affordance (coach-home.js:555).
- Practice HQ wears purple, the hue reserved for recovery; a nutrition practice arguably belongs to green under the single-meaning rule (roles.js:1530-1628).
- Header subtitle and scope chip both say "Entire team" two lines apart (coach-home.js:620, 677).
- First-name-only labels in queue and fueling table collide on duplicate first names (coach-home.js:518, 545).
- Staff nutritionist sees Assign buttons the server will refuse (coach-home.js:593 gates on book caps, not staff role; contradicts staff-access.js:5-6 contract). Founder-call adjacent: `canViewWeight` excludes `nutritionist`, and commitments scheduling is deferred.
- nutrition-chat.js is in good shape: failed-vs-empty distinguished, IME-safe Enter, composer refuses to post into the void.
