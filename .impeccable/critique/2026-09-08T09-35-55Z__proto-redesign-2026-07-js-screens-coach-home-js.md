---
target: coach + dietitian operator screens
total_score: 25
p0_count: 2
p1_count: 4
timestamp: 2026-09-08T09-35-55Z
slug: proto-redesign-2026-07-js-screens-coach-home-js
---
# Critique: coach + dietitian (nutrition-lens operator) screens

Target: `proto/redesign-2026-07/js/screens/coach-home.js` plus coach-roster.js, coach.js (athlete, meal, assign, inbox, copilot), coach-insights.js, coach-create.js, coach-announce.js, coach-rooms.js, coach-commitments.js, coach-connected.js, audience.js, inbox.js, css/coach.css. Register: product. Visual pass RAN: 68 captures (34 screens x dark/light, 390px) through scripts/qc-capture.mjs with a stubbed backend in the PAID state (qc/ux-coach-0908b). Two independent assessments (design-director review; deterministic detector + qc report + grep against DESIGN.md), synthesised here.

## Harness corrections made first (three of the first-run findings were not defects)

- The Supabase stub never answered `book_access`, so every operator capture led with the "Your free preview has ended" paywall and pushed the real board below the fold. Fixed in sb-stub.mjs.
- `commitment_board` rows carried no `starts_at`, so the roll-call board printed "On standard until . Closes ." Fixed in sb-stub.mjs.
- The dietitian lens had no capture coverage at all. Added `dietitianIdentity` (seeds.mjs) and five `diet-*` shots (qc-capture.mjs).
- REAL BUG found on the way: `coach-athlete/<id>` opened while the book is still loading renders "Can't reach their profile". `loadBook` returns early when `rosterLoading` is true (coach-data.js:155), so `loadAthleteProfile` continues with `CD.roster` null and throws at `.book[0]` (coach-data.js:474). Any push-notification deep link into an athlete hits this on a cold start. Try again recovers it.

## Design Health Score

| # | Heuristic | Score | Key issue |
|---|---|---|---|
| 1 | Visibility of system status | 3 | Commitments board says "Complete 0/0" when nobody was enrolled |
| 2 | Match system / real world | 3 | Dietitian greeted "Coach Natarajan" (state.js:4142); inbox "Athletes 12" counts threads on a 6-athlete roster |
| 3 | User control and freedom | 2 | Assign sends to the whole team on one tap; Announce has an armed confirm, Assign does not; no undo on Nudge, Handled, Give a pass |
| 4 | Consistency and standards | 1 | Same 71 is amber "Building" on the roster (score-band tierFor) and red "Below standard" on the athlete page (status.js:14); purple carries recovery AND the pass card AND "Needs review" |
| 5 | Error prevention | 2 | Whole-team is the default audience on Assign and Announce; Give a pass has no preview of what it changes |
| 6 | Recognition over recall | 3 | Inbox alert "2 athletes haven't logged Lunch" drops the names the briefing just showed and has no tap |
| 7 | Flexibility and efficiency | 3 | Roster Select is a real power path; the bulk bar floats mid-list over the row being selected |
| 8 | Aesthetic and minimalist | 2 | Athlete page stacks 4 actions + 6 section chips before content; Rooms stacks 4 components for one task |
| 9 | Error recovery | 3 | Commitments "History didn't load" has no retry (coach-commitments.js:336); everything else honours errorState |
| 10 | Help and documentation | 3 | Insights is 3 taps deep under You with no path from Home |
| **Total** | | **25/40** | **Functional, inconsistent** |

## Anti-patterns verdict

LLM assessment: not slop at the surface. One family, tokens, honest tildes, real states, coach-room voice. Four tells a Linear/Stripe user pauses on: (1) the app defends itself against being AI on four surfaces ("never guesses", "nothing here is generated", "from your real roster", "nothing here is made up"); (2) the Group Score card is the hero-metric template PRODUCT.md names as the anti-reference (52px numeral, green delta, gradient stacked bar, dot legend, footnote); (3) a sparkle-icon "Copilot" whose content is a deterministic filter, and whose sentence ("1 need attention") contradicts its own two-row list; (4) a 2x2 macro grid printing ~0g carbs / ~0g fat / ~780 cal on a rice bowl with "in balance" beside it (coach.js:2978-2979 renders `meal.carbs || 0`, so an absent estimate reads as a zero estimate).

Deterministic scan: `impeccable detect` over the whole proto returns 12 findings, ZERO in coach scope; all 12 are already on the ignore list. Grep against DESIGN.md: no side-stripes, no gradient text, no backdrop-filter in coach.css; 91 raw font-size px in the coach JS (coach.js 48) at off-scale values 9.5, 11.5, 13, 13.5, 19, 22, 30, 60 (held by the ratchet, not shrinking); 3 inline `color:#fff` on gradient small buttons (coach-home.js:96, :265, :276); `permissionState` used by none of the 14 files; coachAssign, coachPlanSet, coachInbox, coachMeal have no loading/empty/error primitive at all; coach-athlete has no loading or empty primitive. qc report: 0 overflow, 0 clipped, 0 low contrast, 0 JS errors; 2 small targets (the 40px meal comment textarea on all three meal shots; the 14px "The full queue lives in your Inbox" link on diet-home).

## Overall impression

The coach side is a real tool with a strong spine (roster, priority card, assign receipt) wrapped in a Home that puts a reward prompt and a hero number ahead of the queue. The dietitian side is the coach tool with one section swapped: greeting, athlete page, meal page and inbox are byte-identical. The single biggest opportunity is making the nutrition lens subtractive (lead with plates and protein, drop the score ring) instead of additive.

## What's working

- The priority card (coach-home.js:641-700): rank, name, tier, two reason lines, one blue primary, and the "This exact message goes to them" preview. Best microcopy in the operator app.
- The roster: tier bands with counts, sparkline plus number, live filter chips only for states that exist. A 40-athlete coach reads it in 3 seconds.
- The Assign receipt: "Sent to 2. 'Extra shake after lift' is on their lists now, with a push each. Marcus and Andre." Says what happened, to whom, what they saw.

## Priority issues

- **[P0] The dietitian lens is a relabel.** Only coach-home changes on a nutrition book (VOCAB.teamNutrition, the queue slot). The handle is hardcoded `Coach ${last}` (state.js:4142); the athlete page says "coach view" (coach.js:2549); meal and inbox are unchanged. Fix: derive handle and opView from discipline; give the dietitian an athlete Overview built from the fueling table that already exists on Home (coach-home.js:566-618); queue rows lead with the plate photo and one reason word (Low protein / Flagged / First log / Late). Suggested command: `craft`.
- **[P0] One score, two colours, four words.** 71 is amber "Building" (roster band), red "Below standard" (athlete page, priority card), "below the bar" (inbox, copilot), "need attention" (legend). DESIGN.md: a hue doing two jobs is a bug; red means missed. Fix: status.js:14 `below_standard` to amber with the tier label from tierFor; reserve red for overdue / no activity. Suggested command: `polish`.
- **[P1] Assign sends to the whole team on one tap.** coach.js coachAssign: `#as-send` goes straight to planSends; default audience is everyone(). Announce already has the ARM two-tap (coach-announce.js:17). Fix: reuse ARM for team and position scopes; keep single-athlete sends one tap. Suggested command: `harden`.
- **[P1] Impossible macro reads print with confidence.** `~0g` for a missing carbs/fat estimate (coach.js:2978-2979). Fix: render an absent macro as absent; if two of three macros are missing and kcal > 300, show "Partial read" and promote "Correct the read" from a 12px text link to a `.btn.sm`. Suggested command: `harden`.
- **[P1] The reward card leads coach-home.** Order today: scope, plan card, join requests, milestone (Give a pass), nutrition board, group score, setup, priorities (coach-home.js:771-776). A coach between drills gets "who needs me" on the third scroll. Fix: priorities first, milestone below them, border in hairline not purple. Suggested command: `layout`.
- **[P1] Deep link into an athlete during boot fails.** coach-data.js:155 + :474 (above). Fix: make loadBook await the in-flight load (store the promise) instead of returning early. Suggested command: `harden`.
- **[P2] Inbox alerts lose the names and the tap.** inbox.js:104-119 aggregates with no `go` and no names; chip "Athletes" counts threads. Fix: name up to 3, route to the roster filtered on that requirement, relabel the chip "Threads". Suggested command: `clarify`.
- **[P2] Athlete page: 10 controls before content.** 4-button action bar + 6 section chips (coach.js:2568-2580). Fix: keep Nudge + Assign, fold Targets and Reward under the "more" menu coach-meal already uses. Suggested command: `distill`.
- **[P2] Meal hero title in light theme.** `.ph-t` has no colour (screens.css:403), so the overlay title is dark ink over the photo on light; the title also duplicates the header. Fix: pin the overlay ink to the dark value inside `.photo-hero`; drop the overlay title when it equals the header. Suggested command: `polish`.
- **[P3] Commitments board.** Error with no retry (coach-commitments.js:336); "Complete 0/0" with nobody enrolled (:432). Fix: errorState with retryId; "No one was on this roll call" muted. Suggested command: `harden`.

## Persona red flags

**Head coach, 40 athletes, 90 seconds between periods.** Three scrolls to the first name that needs him. "N more need attention" goes to the full roster, not the overdue filter. Inbox alert has no names and no tap. Bulk bar covers the row he is selecting. Assign audience picker grows to 10-12 room chips.

**First-week dietitian.** Called Coach on every screen. Six identical bowl icons with identical numbers, no way to pick the first plate. First plate reads 0g carbs, 0g fat, "in balance". The fix is a 12px text link. Athlete page is a football score ring. Create menu offers tasks and schedules, nothing about targets or plans. The AI row is labelled "AI Nutritionist" on the human nutritionist's own screen.

**Trainer, 12 adult clients.** "Group Score" averaging 4 adults with a green delta reads as gamification. "Reward it with camera-free meals" is high-school voice for paying adults. Clients tab icon is a heart (reads as favourites). "No activity in the last day / No activity on record" says one thing twice. Proof chips Photo/Check/Scale/Form are team-shaped.

## Minor observations

1. Group Score: "15 of 15 requirements in today" beside "2 overdue" on one card.
2. Athlete page: "0 of 3 meals in" under two scored plates (coach.js:2227 vs :2258 read different sources).
3. Copilot: "1 need attention" over a 2-row list (attention uses flag 'r', the list uses belowBar).
4. Insights: "about 1 points/day"; the full name as both title and sentence subject (coach-insights.js:200).
5. Insights: "Lunch was missed 40 times this week" needs a ceiling (athletes x 7).
6. Roster band eyebrow "ONSTANDARD" loses the brand capital; read as a typo.
7. FAB is green; green means done/nutrition, action is blue. App-wide question.
8. Meal hero timestamp is green-bright (screens.css:404); a time is not a success.
9. Plan Readiness card wears amber for "1 of 2 steps done": a warning colour on a setup step (open hub-hero ruling).
10. Plan lists six identical "Inherits team standard" rows; collapse to one line with a disclosure.
11. Rooms: "No rooms yet" while roster rows already carry LB/OL/QB/RB/S/WR.
12. Comment textarea 40px tall on every meal screen (44px floor); diet-home footer link 14px tall and a dead pointer to Inbox.
13. Dietitian queue thumbnails: the code signs plate photos (coach-home.js:527-533) but the capture renders the bowl fallback on all six rows while signing itself works in the same harness. Unconfirmed on a device; worth a real-account check.

## Questions to consider

- Why does a dietitian's product show a score ring at all? If the nutrition book led with protein-per-day and plate photos and never showed the Athlete Score, would a dietitian miss it?
- Why is the Group Score on Home when the ranked priority queue already is the group's state? What does Home look like with the number gone and the queue first?
- Why does the app keep saying "real"? If the four tells above were fixed, would any of those lines survive?
