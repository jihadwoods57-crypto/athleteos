# Roll call, rebuilt (design, 2026-09-23)

Visual walkthrough (drawings + today's screenshots): https://claude.ai/artifact/VWQw2LKLnXneumgSxumZqK

Status: **approved by the founder 2026-09-23** ("Love it"). Corrections from the code map are in
"Corrections after mapping the code" at the end; they win over anything above them.

## The vision, in the founder's words and choices

The founder said the current roll call "isn't matching the vision": it is not a team moment, the
coach side is weak, and the overall flow and UI are wrong for both athlete and coach. Choices made
in conversation (2026-09-23):

- **A live team board** is the heart of it: every teammate's face lights up in the order they got
  up, the first one up is called out, late and missing stay visible.
- **Teammates see everything**, by name: on time, late, missed.
- The coach needs **all four**: 20-second setup, change it on the fly, act in the moment, history
  that shows who is reliable.
- After I'm Up the athlete lands on **the board, then one swipe to their day**.
- **One tap on the lock screen** checks you in (Live Activity and the alarm's own button).
- It **counts toward the daily score**.
- Founder change: the day screen shows **when breakfast closes**, not a "Log breakfast" button
  ("most people don't eat breakfast as soon as they wake up").
- Founder change: the native (lock screen / alarm) piece ships **now**, not after 1.0 is approved.
- Founder addition: an **optional location check** ("geofence"): the coach draws an adjustable
  bubble on an Apple-Maps-style map; an athlete who enters it during the window is checked in. The
  coach never has their location outside that window. Arrival **counts toward the score**, and it
  can be set **alone or together with** a wake-up.

## What we keep (already built and proven in code)

- The real alarm (AlarmKit on iOS 26.1+, full-screen on Android), `RollCallAlarm.swift`.
- The Live Activity and its push-to-start token (`RollCallLiveModule.swift`,
  `targets/RollCallWidget`, `RollCallCheckInIntent.swift`), started by `commitment-reminders`.
- The verdict rules: `rollcall_verdict` (on standard / late / missed / excused), windows,
  `rollcall_closes_at`, overrides with a reason and audit (0211, 0212), schedule-ahead (0215).
- `roll-call-ack`, `roll-call-coach`, `commitment-reminders`, `commitment-escalation` functions.
- Saved places with a radius: `commitment_locations` (lat, lng, `radius_m` 50 to 1000), arrival
  verification and presence (0138, 0139, 0208), native region monitoring in
  `src/lib/location/index.ts`, location consent screen.
- Scoring plumbing: `WAKEUP_SHIFT` (8) in `js/plan-style.js` and `src/core/scoringProfiles.ts`.

Nothing above is re-litigated. Everything the athlete and coach see and touch is rebuilt.

## The athlete

1. **5:50 (window opens, 10 min before):** a Live Activity appears on the lock screen by itself
   (push-to-start), even with the app closed: "Roll call · Coach Brooks · On standard until 6:05",
   a live team count and faces, and an **I'm Up** button that checks in without opening the app.
2. **6:00:** the alarm rings through silent mode. **I'm Up** (the coach's words, iOS 26.1+) checks
   in. **Stop** only silences; the Live Activity keeps its button until they check in.
   Older iOS: a time-sensitive notification with an I'm Up action.
3. **After the tap:** the Live Activity updates to "You're up · 4th · 6:01 · +8 to today's score"
   and keeps the team count moving until the window closes.
4. **In the app, the Team Board:** everyone in arrival order with their time and place; first up
   called out; own face highlighted; Late (amber), Not up yet (grey), Missed (red after close).
5. **One swipe: Your day:** the coach's message, "+8 banked", and what's next today. Breakfast
   shows as **a reminder of when it closes** ("Breakfast closes 9:30 AM"), not a log button.

**With a location check:** the board has a second column/state per athlete: Arrived (time) /
Not arrived. The athlete's phone checks in automatically on entering the bubble during the window
(needs "Always" location), or the athlete taps **I'm here**, which takes one location reading
right then (needs only "While using"). Outside the bubble, "I'm here" says so plainly and does
not check in.

## The coach

1. **Setup in four answers:** time, days, who (team / position group / picked athletes), alarm on.
   Grace (5 min), close (30 min) and the morning message sit behind one "Change" link.
   Optional: **"Also check they're at…"** opens the map (below) and an arrive-by time.
   A roll call can also be **arrival only** ("At the stadium by 3:30").
2. **This week strip:** 7 days with their times. Tap a day: move it, give a group its own time,
   cancel it. Athletes' alarms and Live Activities follow immediately, with a heads-up push.
3. **Live board:** the same board the team sees; tap a face to nudge (a ringing push) or override
   with a reason; "Nudge everyone not up" in one tap.
4. **Closing summary:** one push when the window closes: "10 of 12 on time. Tyrek late (6:08).
   Tommy and Ray missed." Tapping opens the board on the misses.
5. **History:** last 30 mornings; team on-time rate and trend; "Needs attention" first (lowest
   on-time, slipping); each athlete's rate, trend, streak, first-up count; tap for day by day.

### The map (location check)

- Apple Maps (native MapKit view on iOS; Google Maps on Android). Search a place or drop a pin,
  drag the circle's edge to resize. **Minimum 100 m** (phones cannot reliably tell a doorway from
  the parking lot, especially indoors); maximum 1000 m (the table's existing cap).
- Saved as a named place ("Weight room", "Stadium"), reusable in one tap.
- The coach **never sees athlete locations**: only Arrived (time) / Not arrived. Monitoring runs
  only during the window, on the phone; there is no location history.

## Scoring

The morning block is **8 points**, whatever it holds. Food stays 82, the night check-in stays 10.

| Day has | Wake-up | Arrival |
|---|---|---|
| wake-up only | 8 | – |
| arrival only | – | 8 |
| both | 4 | 4 |

Each part: on time full, late half, missed zero (the existing wake-up rule). No roll call that day:
the block is not counted (current behaviour). A missed morning never also costs breakfast (kept).
Coach override with a reason still corrects a verdict and the score follows.

This generalises `WAKEUP_SHIFT` into a morning block split across its parts; parity tests
(`scoreParity.test.ts`, `planStyleCaps.test.ts`, `scoreIntegrity.ts` caps) must hold.

## Architecture (what is new)

- **Team visibility:** athletes cannot read teammates' responses today. A new security-definer RPC
  returns, for one roll-call instance the caller belongs to: name, avatar, ack time, arrival time,
  verdict, order. Nothing else. Same-team members only.
- **Live updates:** Supabase Realtime on the board (or short polling as a fallback) so faces light
  up without refresh; Live Activity updates pushed by the server on each check-in (team count,
  place in line) within APNs update budgets.
- **Coach setup + week strip:** new composer replacing `coach-wakeup.js`'s long form; per-day
  overrides reuse `commitment_instances` (0215 schedule-ahead) and `set_instance_message`.
- **Arrival:** a roll call (commitment) can carry `location_id` + arrive-by; arrival verdict uses
  the existing `verify_arrival` / presence functions; "I'm here" = one foreground reading sent
  through the same verification (server checks distance to the place, never trusts a client flag).
- **History:** an aggregate RPC over responses (per athlete: on-time rate 30d, trend, streak,
  first-up count).
- **One entry point per role:** retire the duplicate 2026-09-02 surfaces (old create-menu entries,
  old manage screen) once the new ones cover them.

## Rollout

Founder chose to ship the native piece now.

1. **One App Store build** carrying: push-to-start Live Activity verified end to end, I'm Up
   intent on the Live Activity and alarm, live Live Activity updates, older-iOS notification
   action, MapKit map picker, "I'm here" single reading. Keep location check-in clearly optional
   and coach-enabled, with plain purpose strings, to keep App Review questions easy.
2. **Over-the-air:** board, day screen, coach setup, week strip, live board actions, summary,
   history, arrival UI.
3. **Server:** migration(s) for the team RPC, arrival on roll calls, morning-block scoring, history
   RPC; function updates for Live Activity updates and the closing summary.
4. **Device test on the founder's phones** (coach + athlete) with a 5-minute script before it
   reaches a team: lock screen card appears by itself, one tap checks in with the app closed,
   alarm button checks in, Stop does not, board updates live on both devices, map bubble arrival
   auto and "I'm here", summary push.

## Risks and honest limits

- **Nothing here has run on a real phone yet.** Every native path needs the device script.
- **App Review:** "Always" location and a new native surface during resubmission raise review
  questions; mitigated by optional, coach-enabled, clearly worded location use.
- **Location permission:** many athletes or parents will decline "Always"; "I'm here" is the
  fallback and must be first-class, not hidden.
- **Indoor accuracy:** small bubbles give false "not arrived"; hence the 100 m minimum.
- **Minors:** teammates see late/missed by name (founder's explicit choice). Location is never
  shown to anyone; only arrived / not arrived.
- **Pressing I'm Up from bed** still counts (founder cut proof-of-wake on 2026-09-10). The
  location check is the real proof, where a coach wants it.

## Not in this version

Photo proof, step-count proof, teammates reacting on the board, position-group competition,
Android parity beyond what is already designed.

## Corrections after mapping the code (2026-09-23)

1. **Location was removed on 2026-09-09** (commit 8e7506bb, "take out arrival check-in") to cut the
   biggest App Review risk: the native seam `src/lib/location`, the six LOCATION_* bridge messages,
   the consent screen, "I'm here", the coach's place picker, expo-location, the location purpose
   strings and UIBackgroundModes. **Founder decision 2026-09-23: bring ALL of it back in this build
   ("Everything now"), including automatic walk-in check-in with "Always" location, accepting the
   review risk.** It is restored from `git show 8e7506bb^:<path>`, not rewritten. Server columns and
   RPCs were kept and are reused.
2. **The server trusts the phone on arrival today** (`verify_arrival(p_within boolean)`). The
   rebuild adds a server-side distance check: the phone sends one reading (lat, lng, accuracy), the
   server computes the distance to the place and discards the coordinates.
3. **Stop on the iPhone alarm already checks the athlete in** (`stopIntent: RollCallCheckInIntent`).
   Kept: that IS the one tap. The alarm's second button ("I'm Up", the coach's words) also checks
   in AND opens the app on the team board. The spec text above saying "Stop only silences" is void.
4. **A lock-screen tap does not reach the server until the app opens** (the intent only records to
   the App Group). The intent now posts the check-in itself with an instance-bound signed code,
   and still records locally as the fallback.
5. **The Live Activity carries no team data and ends on check-in.** Content state gains team count,
   place in line and points; a check-in updates the card instead of ending it; the card ends at
   close. Team-count updates fan out on each check-in, throttled.
6. **No closing summary exists** (the coach digest fires at the deadline, opt-in). A summary push at
   close is added.
7. **Wake-ups open at start time today**, not 10 minutes before. Opening moves to 10 min before.
8. **The radius floor in the table is 50 m.** New places are held to 100 m by the saving function;
   existing rows are untouched.
9. **The 8 morning points are already a shared budget** with the sleep standard
   (`weightsForAssigned`, NIGHT_SHIFT). Arrival joins that budget: each assigned part gets
   8 / (number assigned). Wake-up + arrival = 4 + 4, as designed; with sleep too, 8/3 each.
10. **"Different time for a group" is deferred.** The instance model has one time per occurrence;
    per-group times need a separate design. Move and cancel a morning ship now.
11. No map library is installed: `expo-maps` (SDK 57: 57.0.3) is added for the coach's map.
