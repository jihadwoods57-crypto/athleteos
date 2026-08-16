# PRD: Nudge System v2, Meal-Logging Notifications v2, Client Standard (Quiet)

Date: 2026-08-15
Author: Claude (Fable 5), from a three-surface code census of the shipped proto
Status: Approved for build in this session. Everything "In scope" ships behind the normal
OTA + edge-function deploy. "Debt" items need a native build, a founder ruling, or both.

---

## 1. Why now

Three surfaces got audited end to end. Each has the same disease in a different organ:
**the UI narrates a system that is not actually doing what the narration says.**

1. **Nudges.** A coach taps Nudge and reads "Sent. It lands on their phone." The server may
   have delivered nothing: deduped, opted out, or no device token, all return HTTP 200 and
   the client treats `!error` as delivered. Coach meal comments ride the same pipe as
   nudges, so the nudge dedupe can silently eat a coach's comment notification.
2. **Meal-logging notifications.** The thread can say "Reading your plate…" forever after
   the outbox drops photo bytes; the "Read it again" chip can be a dead button; coach bell
   rows for meals are unclickable and mislabeled; the unread badge is a one-way latch that
   never rises again after the first bell visit.
3. **Client Standard page.** One flat stack: 10 CTAs above the fold, the score printed
   three times, six accent hues competing in one viewport, and the single most legible
   artifact in the product (the score ring) missing. Two fetch failures render as
   convincing empty states ("Nothing saved yet", "No logs today yet").

## 2. Goals

- Every delivery claim in nudge UI is true, or the copy says what actually happened.
- A coach can nudge from any of the three surfaces and the system behaves identically:
  same presets, same daily guard, same queue-clearing, same honest feedback.
- A meal read that fails, for any reason including dropped bytes, always lands in a
  visible failed state with a working retry.
- Coach bell rows for meal events are labeled, leveled, and tappable to the meal.
- The Client Standard page reads in under 3 seconds: one score artifact, one list of
  what's open, no duplicated numbers, and honest failure states.

**Non-goals:** server-side quiet hours, notification retention policy, native push-token
retry, reminder back-stack fix (all native or infra; listed as debt), any new AI spend
path being switched on without the founder.

## 3. Feature specs

### F1. Nudge system v2

**F1.1 Honest delivery feedback (transport).**
`send-push` nudge responses already distinguish `{pushed}`, `{deduped}`,
`{suppressed:'notifications_off'}`. `roles.nudgePush()` collapses all of that to a
boolean. Change `nudgePush` to return a result object
`{ok, pushed, deduped, suppressed, noDevice}` (derived: `pushed===0` and neither deduped
nor suppressed means no device token). All three send surfaces map it to copy:

| Server truth | Coach sees |
|---|---|
| pushed ≥ 1 | "Sent. It lands on their phone." |
| no device token | "Sent to their in-app inbox. They don't have push set up." |
| suppressed (opt-out) | "Saved to their in-app inbox. They've turned pushes off." |
| deduped | "They were just pinged. Give it a minute." |
| error / offline | "Couldn't send. Check your connection and try again." (message kept) |

The arm-state promise "This exact message lands on their phone" softens to
"This exact message goes to them" on all three composers.

**F1.2 Comments and reactions leave the nudge lane.**
`send-push` athlete path accepts an optional `kind` (validated against an allowlist:
`nudge`, `coach_comment`, `coach_react`) plus optional `route`. Dedupe applies **only**
to `kind='nudge'`. Coach meal comments/reactions send `kind:'coach_comment'|'coach_react'`
with `route:'meal-view/<mealId>'`. `notif-feed.js` maps both kinds: comment =
message-circle icon, level medium; react = heart icon, level low; both route to the meal.
The kind regex relaxes to allow an id suffix (`kind:ref` like `ai_followup` already uses)
so rows can deep-link.

**F1.3 Nudge pushes and bell rows go somewhere.**
Nudge pushes carry `data.route:'home'` (the athlete's next action lives on Home).
`KIND_ROUTE` gains `nudge → home`.

**F1.4 One preset module.**
New `js/nudge-presets.js`: tier-matched preset bodies (below / due_soon / overdue /
default), used by coach-home, athlete detail, and bulk. Five duplicated string literals
die. The athlete-detail preset picks by the athlete's current status instead of a single
hardcoded line.

**F1.5 Nudges clear the queue from every surface.**
Athlete-detail and bulk sends log `reasonKey` + `tier` (derived from the athlete's
status via `priority.reasonKey`) so `buildPriorities` sees them and the athlete leaves
the coach-home queue. Today they log bare `kind:'nudge'` rows that the queue ignores.

**F1.6 One-nudge-per-day guard everywhere, server-informed.**
Athlete detail derives "nudged today" from the already-loaded `P.interventions`
(server rows), not just device-local `RT.coachNudged`; the button renders the same
disabled "Nudged today" state coach-home has. Bulk skips server-known nudged athletes
too. The local mark stays as a fast-path.

**F1.7 Bulk that survives its own rate limit.**
Bulk send throttles to stay under the per-IP limit (300 ms spacing) and treats a 429
distinctly: stop, report "Sent N. The rest hit the safety rate limit, try again in a
minute." No more "check your connection" misdiagnosis.

### F2. Meal-logging notifications v2

**F2.1 A dropped photo is a failed read, not an eternal spinner.**
When `meal-outbox` marks a job `dead` (quota), it also stamps
`analysisFailed:'capacity'` on the slot (and clears `pending`), so the thread renders
the honest failed state instead of "Reading your plate…" forever. The failed state for
a dead-job slot explains: photo couldn't be kept on the device, the log still counts.

**F2.2 "Read it again" always answers.**
`retryAnalysis` gets the same storage fallback `rereadMeal` has (re-fetch bytes from the
uploaded photo when local bytes are gone) and returns `{ok}`; the chip shows "Reading
the plate…" while in flight and an honest "Couldn't start the read, try again" on failure.

**F2.3 Coach bell rows for meals: labeled, leveled, tappable.**
`notif-feed.js` KIND_META gains `meal_logged` (low/quiet), `meal_review` (medium),
`meal_action` (high); KIND_ROUTE routes all three to `coach-meal/<id>` via the kind
suffix. `send-push` to_coach branch writes the kind with the meal id suffix and keeps
the row insert.

**F2.4 The unread badge comes back.**
`RT.notifsRead` becomes date-stamped (`notifsReadDay`): derived rows (overdue, streak)
count as unread again on a new day or when new derived content appears after the last
read stamp. The mount-time blanket `readNotifs()` stays (it acks what's on screen) but
no longer suppresses future days.

**F2.5 The clarifying bubble counts its own questions.**
"Two quick things and your numbers are exact" becomes count-aware, same as the
standalone screen.

**F2.6 Settings stop fabricating.**
The read-only "Urgency per requirement" card derives from the athlete's actual
requirements (`req.reminder`), showing only requirement kinds that exist; if none carry
a reminder level it says reminders follow the plan's timing. The padlock-and-invented-
values card dies. Browser-only sessions get one honest line: reminders fire through the
phone app.

**F2.7 The analyzing screen can't hang on a cold deep link.**
The legacy branch's exact-hash checks (`=== '#analyzing'`) match sub-routed hashes
(`startsWith`), so a cold launch on `#analyzing/<slot>` either runs or exits instead of
sitting on a dead scanline.

### F3. Client Standard page, quiet

Design register: product, Restrained. The athlete's Home solved this exact problem with
suppression (four zones, one attention card, everything else collapsed). The operator
page adopts the same law. Target: a coach reads state in 3 seconds, then chooses depth.

**F3.1 One score artifact.** The Overview leads with the athlete's actual `scoreRing`
(the same primitive Home uses, smaller: 96px) + tier pill + status line, replacing the
"Score today" stat tile, the "Finished day" duplicate, and the status card's separate
surface. Score appears once. The trend sparkline's color follows the score band, not
its own up/down green/red.

**F3.2 One "what's open" surface.** The 3 stat tiles and the "What's open" card merge:
a single compact card listing open items (meals left, recovery), each row one line.
When everything is in: one green row. The meals-logged and recovery duplicates die.

**F3.3 Proof stays, prose goes.** The meal-photo strip stays (it is the proof). The
three orphan hint lines ("Tap a meal photo…", the footnote, the timeline note) reduce to
zero; affordances carry themselves. The breakdown keeps its collapsed `<details>` cards
but each collapsed row slims to name + earned/possible + bar (the "% of score" pill and
note move inside the expanded view).

**F3.4 Calmer chrome.** The action bar keeps all four actions but drops to quiet ghost
buttons with one primary (Nudge when actionable). Accent audit: the Overview viewport
carries green (done) + amber (open) + blue (action) only; purple/cyan/red stay in their
own sections.

**F3.5 Honest failure states.** A failed Food Memory read renders `errorState` with
retry, never "Nothing saved yet". A failed training-log read shows one quiet failure
line in the timeline. (fetchDay's null ambiguity is noted as debt; it feeds many
surfaces and gets its own pass.)

## 4. Debt (explicitly out of this pass)

| Item | Why deferred |
|---|---|
| `ai-followup` cron migration | Turns on a proactive AI spend path; founder ruling. Migration drafted in-tree, unapplied. |
| Server-side quiet hours for pushes | Needs schema (per-athlete quiet window on profiles) + send-push logic; design in F-next. |
| Push-token retry, `_lastPlan` permission race, reminder back-stack | Native code (`src/`), not OTA-shippable. |
| `notifications` retention | Infra; join `data-retention`. |
| `fetchDay` null ambiguity | Cross-cutting fetcher contract change; own audited pass. |
| Legacy `src/` nudge tree removal | Dead code deletion, zero user impact; housekeeping PR. |
| `nutrition-chat` AI wiring | Screen reachability unclear; needs its own census. |

## 5. Acceptance criteria

- All 12 verify gates green; new unit tests: nudge preset selection, nudgePush result
  mapping, notif-feed kind/route mapping for the new kinds, badge date-rollover.
- Nudge from each of the three surfaces against a no-token athlete reports the inbox
  truth, not "lands on their phone".
- Two coach comments 60 s apart both produce bell rows.
- A quota-dead outbox job renders the failed state with working messaging, not a spinner.
- Client Standard Overview: score rendered exactly once, ≤ 2 accent hues besides
  blue in the initial viewport, zero orphan hint lines, honest error states for Food
  Memory and training logs.
- OTA shipped, manifest hash-verified; send-push redeployed.
