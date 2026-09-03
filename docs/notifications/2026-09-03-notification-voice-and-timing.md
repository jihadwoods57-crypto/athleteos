# Notification voice and timing — 2026-09-03

Founder ask: "improve the notification system: timing, verbiage and messaging, across the board."
This pass revises the 2026-07-16 design (which stays the reference for the stage model, quiet
hours and the daily cap) in three places: how every push reads, when the busiest ones land, and
a handful of server sends that had drifted from the rules.

## 1. One voice for every push

Every notification the product sends, local or server, athlete or coach, follows one shape:

| Line | What it carries | Example |
|---|---|---|
| **title** | the thing, at most ~40 characters, no period | `Lunch` · `Devin missed Lunch` · `6-day streak on the line` |
| **subtitle** | the ONE time fact | `Closes at 2:00 PM` · `Closed at 11:40 AM` · `Both by 9:30 AM` |
| **body** | the ask, one sentence, at most ~120 characters | `Still open. Log it and it counts toward today.` |

Rules, all enforced by tests where a test can reach them:

- **Never the app name.** iOS and Android draw it in the notification header; a title that says
  "OnStandard" spends the line saying what the OS already said. (`Your OnStandard week` is now
  `Your weekly read`.)
- **Never an exclamation mark, never guilt, never a scoring formula.** "Keeps the 50%" stays gone.
  Weight is trend-only. Nothing tells an athlete they are behind; it tells them what is still
  open and by when.
- **No em dashes** (DESIGN.md). Two server strings had them; both are gone.
- **iOS gets three lines; Android gets two.** Android has no subtitle line, so the native seam
  folds it into the title as `Title · Subtitle`. This is the same platform split the roll call
  push adopted on 2026-09-02, now applied to every locally scheduled reminder.
- **Names, not counts, wherever a name exists.** A coach's briefing says who is still open. A
  single-athlete alert says what happened and what the coach can do, not the athlete's name on
  its own under a title that already named them.
- **The subtitle is always the time fact and nothing else**, so an athlete learns to read it as
  "when" without thinking.

The variants still rotate on a per-day seed so no sentence repeats within a day.

## 2. Timing

### Athlete (local, `js/notify-plan.js`)

- **One morning brief on weigh-in days.** The coalescing window moves from 25 to 30 minutes.
  The default catalog put the weigh-in last call at 8:15 and the breakfast heads-up at 8:45,
  thirty minutes apart, so a Monday/Wednesday/Friday morning was two pushes about the same
  half hour. It is now one notification, `Weigh-in and breakfast · Both by 9:30 AM`, whose body
  names each deadline in order (`Your weigh-in by 9:00 AM, then breakfast by 9:30 AM.`). The
  old merged body ("Both land by 9:30") erased the only fact that differed between the two.
- **A merged last call reads as a last call.** At max pressure the heads-up and the deadline for
  the same pair are two different sentences, not one sent twice.
- **The streak warning names what is still open.** "Today is not closed yet" made the athlete
  open the app to find out what. It now reads `6-day streak on the line · Still open tonight ·
  Dinner and your check-in still open. Keep the 6 days alive: finish them tonight.`
- Stages, leads, quiet hours, the daily cap and the tomorrow pre-schedule are unchanged.

A default accountable day now lands five pushes on a weigh-in day: the morning brief, lunch,
dinner, the streak line (when a run is alive) and the recovery last call. Gentle lands four.

### Coach (local, `js/coach-notify-plan.js`)

- Missed-window alerts carry `Closed at <time>` and end with the move (`Tap to nudge them` /
  `Tap to nudge or excuse`).
- The morning read leads with who is carrying something over from yesterday, by name, and puts
  the day's due count in the subtitle. Nobody carrying anything over reads as good news.
- The evening recap puts the counts in the subtitle and names who is still open in the body.
- The hourly overdue digest names the athletes it counts.

### Server

- **The weekly digest lands at 7 AM in each coach's own timezone.** It fired once, Mondays
  12:00 UTC: 8 AM in New York, 5 AM in Los Angeles, an hour off at every DST change. Migration
  0218 moves the job to every hour on Monday and the function sends each recipient only in the
  hour that is 7 AM where they live (`profiles.timezone`, 0088; `DEFAULT_TIMEZONE` fallback).
  The existing 6-day dedupe keeps the other runs from doubling anyone. `?all=1` skips the hour
  gate for a manual run.
- **Connected-standard reminders print the athlete's own clock time.** One global
  `DEFAULT_TIMEZONE` printed Eastern deadlines to athletes in California.
- The roll call ladder (coach's words first, OnStandard's after) is untouched: the founder
  specified those states on 2026-09-02.

## 3. Bell feed and settings

- Four server kinds no longer fall to the default bell row: `winback:*` (a heart, "welcome
  back"), `verified_profile` (a plan deadline, urgent, links to the profile), and the
  connected-standard reminder and miss, which now carry the result id as a kind suffix so the
  bell row opens the standard. The tick function computed that route for the push and dropped
  it before the row insert. A miss is its own kind (`cs_missed`) and reads as a record, not a
  reminder.
- The athlete settings screen stops claiming the tone chips "change the wording, never the
  schedule". They set the pressure knob, which decides how many reminders fire. The screen now
  says so, and gains the "Back on at" resume hour the coach screen already had.
- The quiet-hours note stops promising that nothing pings; a coach's own message still comes
  through, and the note says so.
- The coach "Balanced" preset now matches the defaults, so a fresh coach sees a lit chip.

## 4. Deliberately not done

- **Server-side quiet hours for automated pushes** (winback, digest, AI follow-up). Still the
  deferred debt from the 2026-08-15 PRD. The digest change above removes the worst case.
- **The AI follow-up** is still never scheduled and its flag is unseeded; that needs a spend
  ruling, not a copy change.
- **A pre-permission screen** before the OS notification prompt. Worth its own pass.
- **Per-kind opt-outs.** One global `notifications_opt_out` remains the whole preference
  surface on the server.
