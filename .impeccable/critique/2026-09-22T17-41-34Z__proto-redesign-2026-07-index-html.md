---
target: the shipped proto UI, athlete and coach surfaces
total_score: 31
p0_count: 1
p1_count: 3
timestamp: 2026-09-22T17-41-34Z
slug: proto-redesign-2026-07-index-html
---
# OnStandard (proto/redesign-2026-07) — Design Critique, 2026-09-22

Register: **product**. Judged within PRODUCT.md and DESIGN.md (dark-first, Athlete Blue the one action accent, one meaning per hue, Plus Jakarta Sans, Archivo for scores only).

Method: two isolated assessments. (A) an independent design-director review as a separate agent, reading 20 rendered screens and their source. (B) deterministic detection: the 27-pattern detector on the shell page, plus the repo's own `scripts/qc-capture.mjs` rendering **218 screens** (109 dark, 109 light, 390w) with its page-side audit. Neither saw the other. Synthesised by a third read of five key screens.

## Design Health Score

| # | Heuristic | Score | Key issue |
|---|-----------|-------|-----------|
| 1 | Visibility of system status | 4 | Exceptional ("In progress", "2h 25m left", "Estimated from photo · Medium confidence"). The ring's arc never encodes the band; status lives only in an 11px chip. |
| 2 | Match system / real world | 4 | Coach-room vocabulary throughout. Lapse: recovery's "Current: 30 · Earn up to +18" is points-speak. |
| 3 | User control and freedom | 3 | Undo where it counts. Coach inbox rows have no action at all. |
| 4 | Consistency and standards | 2 | **Three score ladders on one roster row** (P0). Primary button is green on Home, blue on the camera primer. |
| 5 | Error prevention | 3 | Arm-then-confirm on delete and announce is good; the armed announce button is a bare `.btn`. |
| 6 | Recognition over recall | 3 | Filter chip rows hard-cut mid-word in captures despite `.edge-fade` being applied (verify on device). |
| 7 | Flexibility and efficiency | 3 | Three plan styles, barcode, label, Food Memory. FAB always opens the camera; no two-meals-in-one-pass. |
| 8 | Aesthetic and minimalist | 3 | Restrained and tokenised. `home-open` spends 470px on an empty ring; coach Home ~1,100px before a name. |
| 9 | Error recovery | 3 | `errorState` carries `role="alert"`; delete never claims success on failure. AI failure card leaves its cadence chips live. |
| 10 | Help and documentation | 3 | Tour, score-explained, honest footnotes. The Progress tour card sits on top of the bars it describes. |
| **Total** | | **31/40** | **Good: one systemic defect, not many small ones** |

## Anti-patterns verdict

**LLM assessment: not slop.** No gradient text, no glass cards (glass is confined to the tab capsule and back chip), no icon+heading+text grids, no emoji, no confetti. The copy is the strongest anti-slop signal: "A dash means we do not have that number for this meal. It is not a zero." / "It can't be recalled." / "Compare within a band, not across." Where a Linear/Whoop-fluent user pauses: the paywall's selected card wears a neon-green border and bloom (PRODUCT.md names "neon-on-black" as an anti-reference, and green means done/on-standard, not selected); the primary button is green on Home and blue on the camera primer; the ring's colour is progress-indexed, so an 88px numeral carries zero band information.

**Deterministic scan.** 5 findings on the shell page, all five in the ignore list as documented exceptions (keyboard-resize transition, typing dots, blue CTA lift, canvas wash, gap hatching). The harness across 218 screens: 0 JS errors, 0 horizontal overflow, 0 low-contrast, 0 missing-H1; **40 sub-44px tap targets**, all one family (the participants facepile button and the message textarea on every meal-thread variant, plus the 40px food-search input); 1 clipped label (`.nct-meal` in nutrition-chat). The facepile button is now the Report and Mute door, so its size is a 1.2 discoverability matter, not polish.

**Visual overlays:** browser automation was unavailable this session; no overlay tab.

## Overall impression

A well-made product with one systemic defect. The athlete side is disciplined: one NOW card, honest provenance, undo where it matters, an exemplary deletion flow. The coach side exposes everything at once and contradicts itself about the one thing a coach needs from colour. The single biggest opportunity is deleting two of the three score ladders.

## What's working

1. **Honest provenance as a system.** Dashes with "It is not a zero", confidence labels, "exact, never estimated" on the label path, and `status.js` degrading an unknown window to the safest honest answer. PRODUCT.md's central promise, shipped in pixels.
2. **The roster's standing bands.** Sorted, cut into named tiers with counts, sparklines for trend, animated re-sorts. The one screen that would sit comfortably in Linear once its colour contradiction is fixed.
3. **Copy that makes decisions.** "Scoring comes from answering every question, never from how high the answers are" removes the incentive to lie. "Camera, for proof" reframes surveillance as evidence in three words.

## Priority issues

### [P0] One athlete's score wears three colours on one row, and two names across screens
**What.** `js/status.js:14` maps `below_standard` → `var(--red)`. `js/score-band.js:24` (`BAND_COLOR`/`scoreColor`) paints 60–79 amber. `TIERS` (`score-band.js:56`) names 60–79 "Building", cls `a`. All three drive the same roster row (`coach-roster.js:95` numeral via `scoreColor`, the avatar dot via `STATUS_META`, the band header via `tierFor`). Jaylen Brooks, 71: amber BUILDING header, amber 71, **red** dot. Tap in: "Below standard" in red. Inbox: "2 below the bar today" in amber.
**Why.** DESIGN.md: a hue doing two jobs is a bug. Red means missed. An athlete who logged every meal and scored 79 is painted like one who logged nothing. The coach cannot triage on colour, which is the roster's entire point.
**Fix.** Make `scoreColor(score)` return `BAND_COLOR_BY_CLS[tierFor(score).cls]` (one ladder; 80–89 becomes blue under its blue header). Rebase `STATUS_META.below_standard` to `--amber-bright` and label it "Building", the name the athlete sees on their own Home. Reserve red for `overdue` and `no_activity`. Deletes a ladder, adds nothing.
**Command.** `polish` (consistency), then `clarify` for the label.

### [P1] Light theme: the navigation capsule turns lavender
**What.** `css/glass.css:35` sets `--glass-sat: 1.6`; the light block at `glass.css:48–54` redefines every glass token except it. Over `rgba(255,255,255,0.60)`, the purple Recovery card bleeds through: in `light-390/home-late.png` the whole tab bar is lavender.
**Why.** Purple means recovery, one meaning, and the permanent chrome wears it depending on what scrolled underneath.
**Fix.** `--glass-sat: 1.15` in the light block. One line.
**Command.** `polish`.

### [P1] The Recovery check-in's progress bar covers the question it is counting
**What.** `recovery.js:185–189` renders the submit in a sticky, opaque `.action-bar` (`app.css:538–547`); nothing reserves room. "0 of 4 answered" sits on top of question 4 (Confidence) and slices the honesty sentence.
**Why.** The screen promises 20 seconds, then hides the last question behind the counter, and hides the one line that removes the incentive to inflate answers.
**Fix.** Bottom padding on every scroller that carries `.action-bar`, from a token minted beside `--tab-clear` (the documented precedent).
**Command.** `layout`.

### [P1] Every meal thread's participants button and message box sit under the 44px floor
**What.** Harness: `button.facepile.disc-fp` and the composer `textarea` on meal-detail, meal-thread, meal-view (three variants), coach-meal, trainer-meal, diet-meal; the 40px food-search input. 40 hits, one family.
**Why.** The facepile is the Report and Mute door (Guideline 1.2). A door under the tap floor is a door a reviewer and a harassed athlete both miss. The app's own DESIGN.md sets the floor.
**Fix.** `min-height: 44px` on `.disc-fp` and the composer field; the focus.css `::after` hit-area pattern already exists for exactly this.
**Command.** `adapt`.

### [P2] Coach Home buries the coach's only job under 1,100px
**What.** Greeting, scope picker, a purple praise card ("Give a pass"), a ~500px aggregate ring, then the standing bar and "2 overdue" as legend text at ~1,450px, names below that.
**Why.** PRODUCT.md: who needs attention, in under 3 seconds. An 81 average is the one number a coach can do nothing with; the praise card outranks the alert; "reward with camera-free meals" as the first card reads as the gamification PRODUCT.md rejects.
**Fix.** Standing bar and legend directly under the scope picker; ring demoted to a `.stat.lg` tile beside it; "2 overdue" a tap target into the pre-filtered roster; praise card below the fold. Reordering within existing components.
**Command.** `layout`, then `distill`.

### [P2] The meal score chip sets type outside the scale, and crowds its own label
**What.** `screens.css:433` `.scorechip .k { font-size: 8.5px }` (below `--t-micro`); the hero dial sizes numeral and label with `calc(var(--lm-dial) * …)`, which bypasses the type ratchet. "Strong meal" at ~10px under a 31px numeral, descenders touching the sweep, the (i) overlapping the arc.
**Why.** This is the moment the AI hands back its read; it needs to look certain.
**Fix.** Move the band word onto the status line above the photo ("… on time · Strong meal" in the band's accent); the dial holds the numeral alone at a real token.
**Command.** `typeset`.

## Persona red flags

**Tired athlete logging dinner at 10:40pm.** `home-late` reads 61 · BUILDING · ↓ −30 · Due soon · 1h 25m left: six pressure signals, and the reassurance that exists on the overdue-meal state ("Log it and it still counts") is absent from this one. The Log button turns amber at the moment of compliance. The camera primer is an extra screen between him and a plate he is standing over. Question 4 of the check-in is under the sticky bar. The FAB only opens the camera, so two missed meals are two round trips.

**First-time coach opening the roster.** Nine controls before the first name. The active filter chip ("All 6") is the dimmest chip in the row (selection affordance inverted; the announce WHO chips get it right). Jaylen Brooks reads amber, amber, red, then "Below standard" in red, then "below the bar" in amber. Athlete detail stacks eight actions in two scrolling rows before any content.

**Parent reading a child's week.** They cannot. `coach.js:3937` renders one card: latest day, score, and a **letter grade** ("A"), a fourth score vocabulary nobody else in the app uses, with no staleness cue on "Latest day: Jul 23". The seven-bar week on `progress.js`, with its caption written for exactly this reader, is not offered.

## Minor observations

1. The notification bell badge is red for two blue-tier reminders; use `--blue` for a count, red for the roll-call alarm.
2. The FAB dot paints urgency on a fourth rule (amber on some screens, red on others).
3. A no-data sparkline draws in red (Tommy Vargas): reads as crashing, not absent. `--text-3` or omit.
4. The announce send button, including its armed irreversible state, is `class="btn"` (`coach-announce.js:110`), the quietest object on its screen.
5. `coach-announce.js:117` inlines `font-size:12.5px` where `--t-sm` is exactly that.
6. Food-search gives no running tally of the plate; `.action-bar` already exists for a sticky "2 items · Log Snack".
7. The coach inbox leaves ~700px empty below two rows with no caught-up state; `emptyState({compact:true})` is shipped.
8. `.nct-meal` in nutrition-chat clips by 4px at 390w (harness).
9. The web-preview paywall branch still says "Memberships open at launch" (the iOS branch was fixed today).

## Questions to consider

- Is the ring worth 40% of Home when it has nothing to say? What if the morning screen opened on the NOW card and the ring appeared once a score exists?
- Green is the button, "on standard", "nutrition", the recommended pricing tier, the FAB and a 19-point ring. Is Athlete Blue actually the spine, or the accent that lost?
- "Protein 98 / 180g · 82g left" is a budget with a number to close. Which side of the calorie-math red line is a 17-year-old on when they read it at 10pm?
