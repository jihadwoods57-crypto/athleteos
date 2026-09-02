# Wake-Up Roll Call, the lock screen (design, 2026-09-02)

Design canvas: https://claude.ai/code/artifact/645681dd-ba39-493c-9273-9c7096095786
(eight artboards: iOS Initial / Reminder / Late, Dynamic Island, Android Initial / Reminder /
Late, and the plain-push fallback that ships without a native build).

Status: **design, awaiting the founder's approval.** Nothing below is built. The plain-push copy
change is OTA-reachable this week; everything else needs native build #28.

## The moment

The phone lights up. In one second the athlete knows three things: Coach is taking roll, how much
time is left, and the one thing to press. That is the whole surface. It is an alarm with a coach's
face on it, not a notification.

Today the roll call is three plain remote pushes (`commitment-reminders` at OPEN and mid-grace,
`commitment-escalation` after grace) with one action button each. The system draws the card, so
the three beats look identical apart from their words. The founder's review (2026-09-02): it reads
as generic system notifications, and the copy is too long.

## Three states, one composition

The same card on every platform, so an athlete who switches phones never relearns it. Every state
carries exactly: who is speaking, the number that matters, one supporting line, one button.

| | INITIAL 6:00 | REMINDER 6:03 | LATE 6:05 → close |
|---|---|---|---|
| Colour | Signature blue. Calm. | Amber. Counting. | Red frame and number. |
| Head slot | Coach avatar (photo, initials fallback) | Bell tile, amber | Alert tile, red |
| Title | `Coach D'Onofrio` | `Wake-Up Roll Call` | `You're late` (red) |
| Eyebrow | `WAKE-UP ROLL CALL` (blue) | `ONSTANDARD · COACH IS WAITING` (amber) | `WAKE-UP ROLL CALL · ONSTANDARD` (red) |
| Kicker | `UP BY` | `LEFT TO CHECK IN` | `LATE BY` |
| The number | `6:05 AM`, the deadline | `1:58`, live countdown to the deadline | `3 MIN`, live count-up since the deadline |
| Line | The coach's message, quoted, italic, one line (long-press for all of it) | `On Standard until 6:05 AM.` | `Check in now. Your coach can see this.` |
| Button | **I'M UP**, blue | **I'M UP**, amber | **CHECK IN NOW**, blue |
| Sound | Yes, alarm-class on the roll-call channel | Yes | Yes, time-sensitive |

Rules that carry across:

- **The coach is only present on INITIAL.** Their avatar, their name as the title, their words in
  quotes. REMINDER and LATE are OnStandard speaking, and say so in the eyebrow. Product copy is
  never attributed to the coach (the existing rule in `commitment-reminders/logic.ts`).
- **The number is the hero.** Archivo Expanded 900, 46px, tabular, tinted in the state colour.
  It is a deadline on INITIAL and a live timer afterwards. Text the device ticks itself, so no
  push is needed to keep it honest.
- **Colour is status, and follows the app's own rules.** Blue-to-teal is the signature, so the
  calm state is blue, not green (green stays a status colour app-wide). Amber is the app's
  "still savable" hue. Red is reserved for the verdict. **The button on LATE stays blue**: the
  in-app red card already does this ("the button is the way out, not the verdict", screens.css
  `.xnow.red .xcta`). The inspiration's red button was deliberately not copied.
- **No copy that is not load-bearing.** No "Answers count as On Standard by…", no "Get back On
  Standard". The kicker plus the number says it.
- Tokens: `--surface-1` card, state wash `rgba(state,0.16→0.05)` exactly as `.xnow`, border
  `rgba(state,0.32)`, `--r-card` 22–24 radius, `--r-btn` 16 (pill on Android), eyebrow 11/800
  tracked 0.14em, title `--t-md` 15.5/700, line `--t-base` 14/500 `--text-2`, button 44px
  15.5/800. Icons from the app's lucide-style set (bell, alert, check, lock).

## iOS: a Live Activity, not a notification

A remote push cannot be styled on iOS. The only lock-screen surface an app draws itself is a
**Live Activity** (ActivityKit), which is also the only one with a live timer and a button that
acts without opening the app. So the roll call becomes one Live Activity per instance:

1. **OPEN (6:00).** The server starts it with a **push-to-start** (iOS 17.2+), `alert` set so it
   sounds and lights the screen, state = `initial`, `deadlineAt`, `closesAt`, coach name, avatar
   URL, the message (first 1,200 bytes, as today). The lock screen shows the INITIAL card. The
   Dynamic Island compact shows the dial mark and `6:05`.
2. **REMINDER (mid-grace).** A push **update** with `alert` (sound again), state = `reminder`.
   The card turns amber; the number becomes `Text(timerInterval: now...deadlineAt,
   countsDown: true)`, ticking on-device.
3. **LATE (deadline crossed).** A push update, `alert` with `interruption-level:
   time-sensitive`, state = `late`. Red frame, `Text(timerInterval: deadlineAt...closesAt,
   countsDown: false)` counts the minutes late. Button relabels **CHECK IN NOW**.
4. **Tap.** The button is a SwiftUI `Button(intent:)` on a `LiveActivityIntent`. It runs in the
   app's process without bringing it to the foreground, posts the signed code to `roll-call-ack`
   exactly as the notification action does today (same `postRollCallAck`, same offline queue),
   and flips the activity to a `checked_in` state locally (`Checked in 6:01 AM · On Standard`, or
   `Late · 6 min`). The server's realtime update confirms it; the activity ends 5 minutes later.
5. **CLOSE.** A final update with `event: end`, state = `missed` if unanswered, dismissal at
   close + 5 min. Nothing lingers past the roll call.

The existing category-button push still goes out alongside, for iPhones below 17.2 and for
anyone who has turned Live Activities off for OnStandard. Its copy is the fallback below.

Constraints that shaped the layout:

- The lock-screen presentation is capped at **160pt** tall. Header row + number + line + a
  full-width button does not fit, so the button sits to the right of the number (an Uber-style
  layout Apple's own examples use). The Android card, which has no such cap, stacks the button
  full width.
- Live Activities cannot play a custom sound; `alert.sound` uses the system sound. The
  companion notification on the `rollcall` channel carries the alarm-class sound.
- No Critical Alert entitlement. Do Not Disturb still wins, as today.
- Custom fonts must ship in the widget extension target (Archivo Expanded 900 and Plus Jakarta
  Sans TTFs; the proto only carries woff2, the `.worktrees/pass-rewards` tree has the TTFs).
- Images in a Live Activity must be local or in the App Group; the coach avatar is fetched by the
  app and written to the App Group container on the first push, initials otherwise.

Build path: `expo-widgets` (Expo's own, alpha, SDK 55+; this app is SDK 57) generates the widget
extension, App Group and push-to-start token plumbing from a config plugin; the activity layout
is written in Expo UI. If its alpha limits bite (it does not render images yet, which affects
the avatar), the fallback is `react-native-widget-extension` with a hand-written SwiftUI
`ActivityConfiguration`. Either way it is **native build #28**, which is already owed for
geofence Exit and HealthKit, so the roll call rides that build rather than forcing its own.

Server side: `commitment-reminders` gains a `live_activities` table row per (athlete, instance)
holding the push-to-start token (registered by the app on launch) and the per-activity update
token (reported back after start); the three edge functions send ActivityKit pushes over APNs
(`apns-push-type: liveactivity`) next to the Expo pushes they send today. Apple's APNs key is
already needed for the existing pushes via Expo, but ActivityKit pushes do not go through Expo's
service, so this is a direct APNs HTTP/2 call from Deno with the `.p8` key.

## Android: a custom heads-up notification, promoted to a Live Update

Android draws notification content from `RemoteViews` when asked, so the same composition ships
inside the system frame:

- `NotificationCompat.DecoratedCustomViewStyle` with our layout: head slot, title + eyebrow,
  kicker, the number, the line, a full-width pill button (a `PendingIntent` to the same
  `expo-task-manager` background task that handles the action today, so a killed app still
  records the tap).
- The number is a `Chronometer` with `setCountDown(true)` to `deadlineAt` (REMINDER) and a
  count-up from `deadlineAt` (LATE), ticked by the OS.
- Channel `rollcall` as today (importance MAX, sound, lock-screen PUBLIC). `setColor` per state
  for the small icon and app name; `setCategory(CATEGORY_ALARM)` so the 6:00 push is treated as an
  alarm-class heads-up and vibrates through most launchers' notification quiet rules.
- **Android 16:** add `setRequestPromotedOngoing(true)` + `setOngoing(true)`. The OS pins it
  expanded on the lock screen and shows the countdown chronometer as a status-bar chip. Live
  Updates refuse `setColorized`, which is why the state colour is carried by the card wash and
  the number, never by a colourized background. Below Android 16 the same notification simply
  behaves as a heads-up with our layout.
- Not proposed: a full-screen intent. Play restricts `USE_FULL_SCREEN_INTENT` to alarm and call
  apps, and a roll call from a coach is close enough to argue but not worth the review risk. If
  the founder wants a true alarm takeover it is a later, opt-in setting per athlete.

expo-notifications does not expose custom layouts, chronometers or promoted-ongoing, so this is
a small native module (Kotlin) wired through a config plugin, shipped in the same native build.

## Fallback: the plain push, tightened (ships now, over the air)

For everything that cannot draw its own card (iOS < 17.2, Live Activities off, build #26/#27
before #28 lands), the three pushes keep their mechanism and get the same three beats with the
copy cut to what a system card can carry. This is a change to `commitment-reminders/logic.ts`
and `commitment-escalation/logic.ts` only, jest-pinned like today's strings:

| | Title | Subtitle (iOS) | Body | Button |
|---|---|---|---|---|
| INITIAL | `Coach D'Onofrio` | `Wake-Up Roll Call · up by 6:05 AM` | the message, verbatim | I'M UP |
| REMINDER | `2 minutes left` | `Wake-Up Roll Call · OnStandard` | `On Standard until 6:05 AM.` | I'M UP |
| LATE | `You're late · 3 min` | `Wake-Up Roll Call · OnStandard` | `Check in now. Your coach can see this.` | CHECK IN NOW |

Android has no subtitle; there the title carries both halves as it does today
(`Coach D'Onofrio · Wake-Up Roll Call`). "N min" on the LATE push is the minutes late at send
time (the escalation cron runs every minute, so it is at most a minute stale). The no-message
INITIAL keeps its neutral form (`Wake-Up Roll Call` / `Up by 6:05 AM.`), never invented words
in the coach's name.

## What it will take

| Piece | Reaches users via | Size |
|---|---|---|
| Plain-push copy (fallback table) | Function deploy, this week | Small. Two logic files + tests. |
| iOS Live Activity (widget extension, App Intent, push-to-start plumbing) | Native build #28 | Medium. Config plugin + layout + token registration + APNs sender in three edge functions + one table. |
| Android custom layout + chronometer + Live Update promotion | Native build #28 | Small-medium. One Kotlin module + config plugin; the tap reuses the existing background task. |
| Coach avatar to the App Group | Native build #28 | Small. |

Device QA is unavoidable for all of it: push-to-start arrival with sound, the App Intent
recording without the app coming forward, the timer ticking while locked, the Android chip.
Nothing here can be exercised from this Windows box.

## Open questions for the founder

1. Approve the colour stance: blue calm state (not the inspiration's green), and the blue button
   on LATE (not red). Both follow rules the app already ships.
2. Ship the fallback copy this week, ahead of build #28? It is the same three beats and costs one
   function deploy.
3. Live Activity library: try `expo-widgets` (Expo's own, alpha) first, or go straight to a
   hand-written SwiftUI target? The avatar is the deciding feature; the alpha cannot render
   images yet.
