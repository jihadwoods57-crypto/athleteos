# Go-live: roll call device test

Nothing in the roll-call rebuild has run on a real phone yet (per the design doc's own risk
list). This is the script for the founder's two phones before it reaches a team: a coach device
and an athlete iPhone on iOS 26.1+, plus an "Older iOS" note for anything before that. Run it
once end to end before the App Store build ships, and again after any change to the native
pieces (AlarmKit, Live Activity, location).

You need: two phones signed into two different accounts on the same team, one set as the coach,
the other on the roster. Clocks in sync (both on automatic time). Location "Always" available as
an option on the athlete phone for steps that call for it.

## Core script

1. **Coach: set up a roll call.** New roll call for 3 minutes from now, alarm on, place = where
   you are right now (radius 150 m), arrive-by 5 minutes from now.
   Expected: the setup saves in four answers plus the place step; the week strip shows today at
   the new time.
   Also check the 100 m floor: try to save a radius of 50 m. Expected: refused with "The smallest
   is 100 m." (not silently clamped, not accepted).
2. **Athlete: lock the phone.** Do nothing else.
   Expected: the lock-screen card appears by itself within 1 minute of the window opening (the
   window opens 10 minutes before start, so if you want to see the open itself, set the roll call
   11 minutes ahead instead of 3 and watch the lock screen at the 10-minute mark).
3. **Tap "I'm Up" on the card, app closed.**
   Expected: the card updates to "You're up · 1st" (or the athlete's real place in line) within a
   few seconds, no app launch required. The coach's board lights that athlete's face within 10 s.
4. **Alarm fires at the start time. Press Stop.**
   Expected: Stop is the same check-in as I'm Up (it is the one tap), so if the athlete already
   tapped I'm Up on the card before the alarm rang, Stop must NOT produce a second check-in and
   must NOT change their place in line. Confirm this on a run where I'm Up was tapped first.
   Separately, on a fresh morning where nothing has been tapped yet, confirm Stop alone checks the
   athlete in exactly like I'm Up would (same "You're up · Nth" result, same board update).
5. **Walk out of the location bubble and back in** (or toggle airplane mode off near the place,
   whichever is easier to stage).
   Expected: with "Always" location on, the board shows "here" automatically, no app open. The
   coach never sees coordinates, only Arrived (time) / Not arrived.
6. **Decline "Always"; use "I'm here" instead**, once outside the bubble and once inside it.
   Before the first tap on a fresh install: the board shows a "Check in with your location" card
   explaining the one reading BEFORE the phone's own prompt, and the prompt that follows offers
   While Using (not Always). After While Using, the card offers "Allow Always" with "Not now"
   beside it and says I'm here works the same without it.
   Expected outside: the app says plainly that you are not at the place (distance, not coordinates)
   and does not check the athlete in. Expected inside: "I'm here" checks the athlete in and the
   board shows "here" within a few seconds.
7. **Wait past the close time without checking in on a second athlete (or override one to
   missed).**
   Expected: the coach gets one push naming who was late and who missed. Tapping it opens the
   board scrolled to the misses.
8. **Open History on the coach device.**
   Expected: today's morning is counted in the 30-day on-time rate, and shows up in the
   day-by-day list for any athlete involved.

## Arrival-only run

A roll call does not need a wake-up at all: "At the stadium by 3:30" with no alarm is a real,
separate path (`type: practice` with a place, not a morning roll call), and it is worth the
full 8 points alone. Run this once, on its own, after the core script above.

1. **Coach: set up an arrival-only practice.** Arrival mode, a place (radius 100 m or more) and
   an arrive-by time a few minutes out. No wake-up time, no alarm toggle to set.
   Expected: the setup shows no alarm step at all; the week strip and the athlete's push both
   describe it as a place and a time, not a wake-up.
2. **Athlete: open it from the push or the bell,** app closed to start.
   Expected: it lands on the team board (not the retired detail screen: this is the exact path
   Task 12 found broken in the harness, so confirm it for real), with **"I'm here"** as the one
   primary action. No alarm fires at any point for this roll call.
3. **Outside the bubble, tap "I'm here."**
   Expected: the app says plainly how far away the athlete is (not their coordinates) and does
   not check them in.
4. **Walk into the bubble and tap "I'm here" again** (or let automatic walk-in fire, if
   "Always" is on).
   Expected: checked in, the board shows "here" within a few seconds, and the athlete's day
   shows the roll call counted.
5. **Check the score.** On the athlete's day, this roll call alone should bank the full 8 points
   (on time), not 4, which is the both-parts split from the core script's wake-up run.
6. **Also check the unverified case:** have the athlete go into airplane mode (or deny location
   entirely) right as the window opens, with nobody tapping "I'm here." Expected: the board shows
   that athlete as "Place not confirmed" (unverified), not silently folded into missed.

## Older iOS (17.2 to 26.0, no AlarmKit)

Push-to-start Live Activities and the I'm Up check-in intent work from iOS 17.2 on; only the
ring-through-silent-mode alarm needs iOS 26.1's AlarmKit. On a phone in this range:

- The lock-screen Live Activity card is expected to appear the same way, with its I'm Up button,
  and to check the athlete in the same way; test this on an actual iOS 17 or 18 phone rather
  than assuming it; "may not render" is not a substitute for that test.
- At the start time there is no alarm. Instead, a time-sensitive notification arrives with an
  "I'm Up" action button. Tapping it checks the athlete in without opening the app.

## Also check on the device

Findings that reviewers flagged but could only be settled by hand, on a real phone. Each is a
concrete check with an expected result; run through these once as part of the same session.

1. **Lock-screen card height with the team row.** The card's estimated height (~157 pt) is close
   to Apple's cap (160 pt) for a Live Activity's lock-screen presentation (not the "compact"
   presentation, which is the Dynamic Island's collapsed state).
   Check: with a full team (10+ faces) and a long coach name, nothing in the card is clipped or
   pushed off the bottom edge on the smallest supported phone.
2. **Alarm's second button waits up to 8 s for the check-in post before opening the app.**
   Check: tap "I'm Up" on the alarm. The delay before the app opens is short enough to feel like
   the app is opening, not like the phone froze, and the board it lands on already shows the
   athlete checked in (not a stale board that updates a second later).
3. **The I'm Up intent when the phone has not been unlocked since restart.** The signed check-in
   code lives in a keychain item that unlocks after first unlock, so a cold-booted, still-locked
   phone cannot read it yet.
   Check: restart the phone, do not unlock it, and trigger I'm Up from the lock screen before the
   first unlock. Expected: the check-in cannot reach the server yet, so it falls back to a local
   record, and that record is sent once the app is opened and unlocked normally. No check-in is
   lost; it is only delayed.
4. **Tapping the Live Activity body** (lock screen, the banner while the phone is in use, and the
   Dynamic Island on a phone that has one).
   Check: all three tap targets open the app straight to that morning's team board, not Home,
   not a blank screen.
5. **Lock the phone, walk into the bubble.**
   Check: with the phone locked the whole time and the app not opened, the coach's board shows
   Arrived. Region-entry monitoring works without any location background mode declared, and the
   report reaches the server within about 5 seconds of the phone detecting the fix (a longer gap
   is the thing to flag).
6. **Coach map behavior**, one pass through each:
   - The camera-change-end event fires the first time the map displays (no dead map that never
     reports a region until you touch it).
   - Dragging the circle's edge resizes the radius; panning the map underneath does not also
     resize it.
   - Opening the keyboard (to search a place) shrinks the visible map area, and the map's own
     region updates to match rather than staying centered on a now-hidden point.
   - The map pin's tint is legible on both iOS 17 and iOS 26 (colour handling changed between
     them).
   - On Android, the map renders correctly inside a Modal with the keyboard open (no clipped or
     frozen map).
   - On an Android device/build with no Google Maps API key configured, the map area shows
     "Map unavailable" instead of a blank or crashing view, and the place search still works
     without the map.
7. **The in-app alarm face** (the full-screen face shown when the alarm actually fires).
   Check: it appears at the roll call's start time, not whenever the app happens to be opened
   afterward. Opening the app 10 minutes late should not show the alarm face as if it just fired.
8. **Late-registered athlete.** Install the app, or turn the roll-call feature on, a few minutes
   after the window has already opened.
   Check: the lock-screen card still appears for that athlete on the next minute tick; they are
   not permanently excluded from that morning's card just because they registered late.
9. **Closing summary push opens on the misses.**
   Check: tapping the coach's closing summary notification opens the board already scrolled or
   filtered to the athletes who were late or missed, not the top of a long, on-time-heavy list.

## Walk-in with the app killed (final fix round, item 1)

The binary declares NO `location` background mode (App Review 2.5.4, 2026-09-18). expo-location
57.0.20 is patched (`patches/expo-location+57.0.20.patch`, renamed from the 57.0.19 one with identical hunks on 2026-09-24, applied by the `postinstall`) so that
region monitoring arms without that mode: the upstream guard in `startGeofencingAsync` is gone,
and `allowsBackgroundLocationUpdates` is set only when the mode exists (CoreLocation throws if it
is set without it). Apple documents region monitoring as working without the mode, relaunching a
terminated app for a region event once "Always" is granted. This is the one claim in the build
that no simulator or test can prove. Run it on the athlete iPhone before the build ships.

1. **Always granted, walk-in armed.** On the athlete phone: Profile > Location check-in shows
   "Walk-in check-in is on". Open the roll call's board once inside its window (this arms the
   region), then leave the bubble (at least 200 m out).
   Also check: Settings > Privacy & Security > Location Services > OnStandard reads "Always".
   Also check: the app did NOT crash on arming (a crash here is the CoreLocation exception the
   patch removes; it means the patch did not apply on the builder, see step 5).
2. **Kill the app.** Swipe it away in the app switcher. Lock the phone.
3. **Walk into the bubble** with the phone locked and the app killed, inside the window.
   Expected: within a minute or so, the coach's board shows the athlete Arrived, with no app
   opened on the athlete phone. (iOS may take a little while to notice a region entry; stand
   inside for 2 minutes before calling it a fail.)
4. **Walk in again after the window has closed** (the next day, or with the roll call's close
   passed), app still killed.
   Expected: nothing is recorded (the region's own window says it is out of time, so the phone
   sends nothing and drops that region), and the morning that closed stays exactly as it closed.
5. **If step 1 crashed or step 3 never arrives:** check the EAS build log for
   `patch-package ... expo-location@57.0.20 ✔`. EAS runs `npm install` on the builder, which runs
   the `postinstall` script (docs.expo.dev/build-reference/ios-builds: "Run npm install in the
   project root"); the log line proves the patch applied.

### Fallback if walk-in does not work without the background mode

Asking for "Always" is JavaScript, so this ships by OTA with no new build:

1. In `src/lib/location/geofence.ts` set `WALK_IN = { ios: false, android: true }`.
2. Ship the OTA (`eas update --environment production`).

Effect on every iPhone that takes it: the app never asks for "Always", never arms a region
(anything already armed is disarmed on the next foreground), and LOCATION_AVAILABLE tells the proto
walk-in is off, so the board and the Location check-in screen offer **I'm here only** (While
Using). The "Always" purpose strings stay in the binary but are never shown. Say so in the App
Review notes for the next build and drop the Always sentences there.

## Also check (final fix round)

1. **Old build + this OTA.** On a phone still on build 43 (no expo-location, no expo-maps), take
   the OTA. Expected: the coach's setup shows "Update OnStandard to add a place." instead of the
   "Also check they're at" door and never opens a map; the athlete's board shows "Update
   OnStandard to check in by location." instead of I'm here. No crash.
2. **Denied.** Deny location entirely, then open the board. Expected: the card says location is
   off and its "Open Settings" button lands on OnStandard's own page in Settings.
3. **Arrival after the close.** Tap I'm here after the arrival close (the roll call's close and the
   be-there time plus grace have both passed). Expected: "Check-in for this has closed", nothing
   changes on the board, and a missed wake-up stays missed.
4. **Stay signed in across a background wake and a lock-screen tap** (server review M7): let a
   region wake and a lock-screen I'm Up both happen while the app is closed, then open the app.
   Expected: still signed in, no "session expired" and no sign-in screen.
5. **Coaches never see a distance.** On the coach device, open the board and the commitments list
   for an athlete whose I'm here was too far away. Expected: "Not arrived · place not confirmed",
   never "N m from <place>". Only the athlete's own phone shows how far away they were.
