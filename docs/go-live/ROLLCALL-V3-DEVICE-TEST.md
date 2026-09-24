# Roll call v3 device test

Build: ____ (the Task 13 build). Spike verdict (`docs/go-live/ROLLCALL-V3-SPIKE.md`): **FAIL**
(build 48, founder iPhone, iOS 27.0 — AlarmKit authorization is per bundle; the Notification
Service Extension sees `notDetermined` and cannot ask; no alarm rang from the push).

Because of that verdict, `rollcall_push_arming` stays **off** for this run, and every row below
tests the **fallback path**: the app arms the alarm itself, at open, 14 days ahead; a late change
that has not reached a phone yet says "Open OnStandard to set/update your alarm."; the backup
alert covers anyone the app has not reached; both alarm buttons check the athlete in and open the
team board.

Two phones: **COACH** (any iPhone) and **ATHLETE** (iOS 26.1+, for the real alarm). A third
**ATHLETE 3** phone with alarms NOT allowed, for row 5. Record the literal text you see — the
copy below is quoted exactly from `supabase/functions/_shared/rollcall-notice.ts` and
`proto/redesign-2026-07/js/rollcall-hub-model.js`, so a paraphrase in what you see is itself a
finding.

## Before you start

- `select default_on, enabled_user_ids from feature_flags where name = 'rollcall_push_arming';`
  — confirm `default_on = false` and this run's athletes are not in `enabled_user_ids`.
- Athlete and Athlete 3 phones: signed in as team athletes, notifications allowed. Athlete 3:
  Settings > OnStandard > Alarms OFF (or never granted).
- Clocks in sync on all phones (automatic time).

## Core script (fallback path)

| # | Do | Pass |
|---|---|---|
| 1 | Athlete: fresh install or first team join. | The Continue primer "Let your coach set your wake-up alarm" appears once. Continue asks for notifications (if never asked), then alarms; "Not now" is offered and the primer does not reappear except from the roll-call card. |
| 2 | Coach: set up a Mon–Fri wake-up roll call starting tomorrow, alarm on, Start. | Lands on the one roll call screen (`#rollcall/<id>`), showing who was just notified. |
| 3 | Athlete: force-quit OnStandard before opening it. | Within a minute the push "Coach [Name] put you on roll call · Mon–Fri [time]" arrives, body "Open OnStandard to set your alarm." (flag off — it never claims the alarm is already set). |
| 4 | Athlete: open the app from the push. | The app arms the alarm (`syncWakeAlarms`, 14-day horizon) with no extra tap; the assignment screen shows "You're on roll call", the days and time, the coach, the points it counts for, and "Alarm set ✓" with no Set button. Within a minute the coach screen flips that athlete's step to "Alarm set ✓". |
| 5 | Third phone (ATHLETE 3), alarms NOT allowed, app closed. Let the window's start time arrive. | A time-sensitive notification plays the bundled alarm sound (ringer on) for up to ~30 s; silent switch ON is silent (no Critical Alert requested, per the founder's choice). The Live Activity card also appears. |
| 6 | Athlete, armed phone, **locked**: let the alarm ring, **slide Stop, do not unlock**. | Check-in lands (coach board shows the athlete up) even though the phone was never unlocked — the check-in write goes to the App Group first, then posts to `roll-call-ack`, both before any UI needs authentication. **If it waits for unlock instead:** note it here as a one-line fallback — point the alarm's stop intent at the pre-v3 `RollCallCheckInIntent` (check in only, `openAppWhenRun: false`) instead of `RollCallAttackDayIntent`, and let the app open the board itself in the foreground when the athlete does unlock, i.e. `RollCallCheckInIntent` plus a `board: true` hint the app reads on next launch. |
| 7 | Same, next morning: press the alarm's own "I'm Up" button instead of sliding Stop. | Same result as row 6 — both buttons run the identical check-in intent. No snooze option anywhere on the alarm face. |
| 8 | Same, with the Live Activity card instead (unlock the phone, tap "I'm Up" on the card). | Checked in, the app opens on `#rollcall-board/<id>` showing "You're up · Nth". |
| 9 | Coach, the evening before: open the roll call screen. Compare with each athlete phone. | Every "Alarm set ✓" row has a real alarm in that phone's Clock app; every "Seen, alarm not set" phone opened the app but has none; "Hasn't opened it" is an athlete who neither opened the app nor the push; "Hasn't been told" means the push has not gone out yet; "Notifications off" is exact, never guessed. |
| 10 | Coach: tap "Remind the N not set" (`rollcall-hub-model.js`'s `armLabel`). | Only the not-set athletes get the push again ("Coach ... put you on roll call" / "Open OnStandard to set your alarm."); a closed app that opens from it arms and the coach row flips to "Alarm set ✓". Pressing again inside 10 minutes (`NUDGE_COOLDOWN_MIN`) returns the cooldown response and the button reads as already sent — check the copy says something like "Sent a few minutes ago," not a second push. |
| 11 | Coach: move tomorrow's morning 30 minutes later from the week strip. Athlete app force-quit throughout. | Within a minute: push body "[Day]'s roll call moved to [new time]." (title is the coach's name). Athlete opens the app: the alarm is rewritten to the NEW time only — the old time's alarm is gone from Clock — and the coach screen shows "Alarm set ✓" again. Before the athlete opens the app, the coach screen shows that athlete stepped back to not-set for the new time. |
| 12 | Coach: cancel tomorrow from the week strip. Athlete app force-quit. | Push body "[Day]'s roll call is off." (flag off: no "Alarm removed." suffix, since nothing was armed from the push in the first place — only an app that already held an alarm for that morning removes it on next open). No alarm rings. |
| 13 | Athlete: answer early (I'm Up from Home or the board) well before the alarm's start time, then leave the phone alone through the start time. | The alarm does NOT ring afterward — an early answer disarms it. Confirm on the phone's own Clock list that the alarm is gone before the start time passes. |
| 14 | Sign out on the athlete phone, sign in as a different athlete on the same team (same physical phone). | The previous account's alarms are gone from Clock; nothing set for the new athlete until they open the app or get assigned. |
| 15 | Coach: "Remind the N not set" inside the 10-minute cooldown, and again on a roll call the coach has **paused**. | Cooldown: the second press is refused/cooldown-flagged, no second push. Paused: the coach screen and Remind both reflect the pause (no push goes out for a paused roll call); confirm the literal copy shown for a paused state. |
| 16 | Athlete Home, evening: the next roll call card. Turn alarms off in iOS Settings, come back to the app. | "Alarm set ✓" becomes "Alarm not set · Tap to fix"; tapping it opens OnStandard's own Settings page (not a re-ask that iOS will silently ignore since the permission was already decided). |
| 17 | Coach Home. | The card reads "Next roll call · [day/time] · N of M alarms set"; Open lands on the one roll call screen. |

Failures: write the row, the build, the phone and iOS version, the literal text seen, and a
screenshot.

## If push arming is ever turned on (re-run this section only after a PASS verdict)

Re-test rows 3, 11 and 12 with `rollcall_push_arming` on for the test athletes:
- Row 3: push body should read "... Alarm set ✓" and the alarm should already be in the Clock
  app / on the lock screen without opening OnStandard; the coach screen should flip within a
  minute with no app open on the athlete phone.
- Row 11: push body should end "Alarm set ✓" and the new time should already be armed before the
  athlete opens the app.
- Row 12: push body should end "Alarm removed." and the old alarm should already be gone from
  Clock.
Do not turn the flag on for real athletes until `ROLLCALL-V3-SPIKE.md` records a PASS.
