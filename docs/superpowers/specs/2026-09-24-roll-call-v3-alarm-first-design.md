# Roll call v3: the coach assigns the alarm (design, 2026-09-24)

Status: **approved by the founder 2026-09-24** in the brainstorming session. The mockups the
founder saw are in `.superpowers/brainstorm/117097-1790243016/content/`
(coach-layout.html, athlete-assigned-v2.html).

## Why v3

The founder, 2026-09-24: "it's still not what i envisioned. i didn't get an alarm. The coach should
be able to assign the alarm, the alarm should be the actual assigned check in. So the flow should be
alarm to the live board. Clean that up. Improve the UI from the coaches side too."

**Root cause of the missing alarm (prod data, 2026-09-24).** The phone never armed the alarm for
this morning's roll call.
- Morning Roll Call, instance 20f13b9d for 4:45 AM ET, was created at 8:05 PM ET the night before,
  when the coach moved Tuesday's morning to Thursday.
- The Live Activity push-to-start fired on time (`card_started_at` = 4:45:00).
- `alarm_armed_at` stayed null. The phone last armed alarms at 6:28 PM, for the morning that was
  then cancelled.
- AlarmKit alarms are armed only by the app while it runs (Home load, `syncWakeAlarms`). A change
  made after the athlete's last open never becomes an alarm.
- The athlete answered from the app at 5:20.

**The platform limit.** Only the app can schedule an AlarmKit alarm, and only after the person
authorized alarms once. No server can put an alarm on a phone. Everything below is built around
that limit.

## Founder decisions

1. **Delivery: layered.**
   - The real alarm whenever the phone can set it.
   - If a late change isn't set yet, a push.
   - At the start time, a loud time-sensitive backup alert for anyone not armed.
   - The coach sees who is armed.
2. **The alarm IS the check-in.** Both alarm buttons check the athlete in. Then the app opens on the
   live team board ("You're up · 2nd"). No snooze.
3. **Coach screen: layout A.** One screen that changes with the clock:
   - the evening before: who will ring;
   - while the window is open: the live board;
   - after the close: results.
4. **The athlete must know they were assigned.** There is a push on assignment and on every change.
5. **No "Set my alarm" button.** The founder: "i want the alarm to already be set when coach assigns
   it".
   - The athlete gives the one Apple-required yes ONCE, when joining a team.
   - After that the alarm is set with no tap: from the push itself (to be proven, see Spike), else
     at the next app open.

## Design

### 1. Alarm permission, once

When an athlete joins a team (the join/onboarding flow), and for existing team athletes at their
next open, one Continue primer asks: "Let your coach set your wake-up alarm".
- It says what happens: a real alarm, it rings through silent mode, and one tap checks you in.
- It uses **Continue** / **Not now** only. No "Allow" wording (5.1.1(iv)).
- Continue calls the AlarmKit authorization request. It asks once per account: a "Not now" is
  remembered and offered again only from the roll-call card.
- It replaces today's primer, which only appears on the roll-call screens.

### 2. Arming without a tap

Ordered by what happens first.
- **(a) From the assignment push (SPIKE FIRST, see below).**
  - The assignment/change push carries the instance schedule for this athlete: instance ids, times,
    title, button label, and signed ack codes.
  - A Notification Service Extension schedules the AlarmKit alarms before the banner shows. The
    banner then reads "You're on roll call. Alarm set ✓".
  - The extension reports each armed instance to the server by posting its window code.
- **(b) At every app open.** The existing `syncWakeAlarms` runs, with the horizon widened from 7 to
  14 days.
- **(c) Push-to-start card buttons.** A Live Activity started early could offer a button that runs
  a LiveActivityIntent, which runs in the app's own process and can schedule AlarmKit. This is the
  CritAlert approach. It is only a fallback if (a) fails. It still needs a tap, so it isn't the
  default.

### 3. The server knows each athlete's step

For each athlete and each upcoming instance, three steps:
- `notified_at`: the assignment or change push was sent;
- `seen_at`: the app opened, or the assignment card was shown;
- `alarm_armed_at`: already exists (`set_wake_alarm_armed`).

`commitment_responses` gains `notified_at` and `seen_at`. A service RPC stamps notified. The
athlete's own RPC stamps seen.

### 4. Pushes

- **Assignment and change.** A push goes out when a roll call is created, when an athlete is added,
  and when a morning is moved or cancelled, within a minute (commitment-reminders or a trigger plus
  send-push).
  - The text: "Coach Brooks put you on roll call · Mon–Fri 4:45 AM" or "Thursday's roll call moved
    to 4:45 AM".
  - A cancellation cancels the alarm (NSE or next open) and says so.
- **Backup alert.** At the start time, for anyone whose instance has `alarm_armed_at` null and who
  hasn't answered: a time-sensitive notification with a bundled alarm sound (up to 30 s, a .caf in
  the app bundle, so it needs the build), plus the Live Activity.
  - It is silenced only by the silent switch.
  - Where the alarm is armed, the start push stays silent, as today.

### 5. The alarm is the check-in

- Both AlarmKit buttons run the check-in intent, which posts `{code, tapped_at}`, as Stop does
  today.
- Both open the app (`openAppWhenRun`) on `#rollcall-board/<id>`, which shows "You're up · Nth".
- No snooze.
- The Live Activity's I'm Up does the same.

### 6. Athlete screens

- **Home roll-call card:** the next roll call's day and time, with "Alarm set ✓" or "Alarm not set ·
  Tap to fix". The tap re-runs arming, and asks for the one permission if it was never given. It
  also carries the coach's message.
- **Assignment screen:** opened by the push. It shows "You're on roll call", the days and time, the
  coach, the points it counts for, and the alarm status. There is no Set button when armed. It
  stamps `seen_at`.
- **The team board and Your day** stay as rebuilt in v2.

### 7. Coach screen: one roll call screen (layout A)

- **Route:** `#rollcall/<commitment>`, replacing today's split between rollcall-week, the board and
  history as separate first stops.
- **Header:** the title, the schedule, and the week strip (move or cancel a day, as today).
- **Body, which changes with the clock:**
  - **Before the window (the evening before, or any time before it opens):**
    - "N of M alarms set" with each athlete's step: Alarm set ✓, Seen but not set, Hasn't opened it,
      Notifications off, Excused.
    - One action: "Remind the N not set". It re-sends the push, which is also the NSE arming path.
  - **During the window:** the live board from v2, embedded, with "Nudge the N not up".
  - **After the close:** today's results (on time, late, missed, with overrides) and a link to the
    30-day history.
- **Quick actions:** Move this morning, Cancel this morning, Message the group, Edit the roll call.
- **Setup:** keep the v2 composer with its four answers. After Start, land on this screen, which
  immediately shows who was notified.
- **Coach Home card:** "Next roll call · Thu 4:45 AM · 5 of 6 alarms set" opens this screen.

## Spike first: arming from the push (must pass on a device before the rest depends on it)

**Question:** can a Notification Service Extension schedule AlarmKit alarms on iOS 26.1+ while the
app is not running, including after a force-quit, once alarms are authorized?

**Method:**
- Add an NSE target through @bacons/apple-targets, beside RollCallWidget. It needs its own
  bundle id (`com.onstandard.app.NotificationService`), the app group and a provisioning profile.
  Credentials are local (credentials.json), so the profile may have to be created in the developer
  portal by the founder.
- The extension reads the schedule from the push payload and calls `AlarmManager.shared.schedule`.
- Ship it in a test build. Send a real push to the founder's phone with the app force-quit. Check
  the alarm appears and rings.

**If it fails:** fall back to 2(b) plus the backup alert, and consider 2(c). The rest of the design
is unchanged. The push text then says "Open OnStandard to set your alarm" rather than claiming it
is set.

## Scoring, verdicts and the board

These are unchanged from v2 (0242): the window, grace, the verdict, the 8-point morning budget, the
live board and arrival.

## Risks

- The NSE may not be allowed to use AlarmKit (hence the spike).
- The new target needs a provisioning profile, which may need the founder.
- The backup alert needs a bundled sound, so it needs a native build.
- Critical Alerts are not requested, per the founder's choice. On silent the backup alert does not
  sound. Only the real alarm does.
- AlarmKit may cap how many alarms an app can hold; 14 days × 1 roll call is small.
- App Review: the review notes must say the alarm is coach-assigned, authorized once by the athlete,
  and set only for assigned roll calls.

## Testing

- **Unit:** payload building and signing, the seen/notified RPCs (SQL suite), arming horizon and
  diffing (jest), the coach screen's per-athlete step and time-of-day states (proto tests), and the
  Home card states.
- **Harness shots:** the coach screen in its evening, live and after states; the Home card set and
  not set; the assignment screen; the permission primer.
- **Device script:** a new `docs/go-live/ROLLCALL-V3-DEVICE-TEST.md`:
  - assign with the app force-quit, check the alarm appears;
  - move a morning late in the evening;
  - check the backup alert on a phone with alarms not allowed;
  - check that both alarm buttons check in and open the board;
  - check the coach's evening screen matches the phones.
