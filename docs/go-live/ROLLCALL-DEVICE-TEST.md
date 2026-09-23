# Go-live — roll call device test

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

## Older iOS (no AlarmKit)

Devices below iOS 26.1 do not get the native alarm or its Stop/I'm Up buttons. Confirm instead:

- A time-sensitive notification arrives at the start time with an "I'm Up" action button.
- Tapping that action checks the athlete in the same way the card does, without opening the app.
- The lock-screen Live Activity card itself may not render (Live Activities need a supported OS);
  the notification is the fallback path and must work on its own.

## Also check on the device

Findings that reviewers flagged but could only be settled by hand, on a real phone. Each is a
concrete check with an expected result; run through these once as part of the same session.

1. **Lock-screen card height with the team row.** The card's estimated height (~157 pt) is close
   to Apple's cap (160 pt) for a Live Activity's compact presentation.
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
