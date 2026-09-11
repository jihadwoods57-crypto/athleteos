# Coach wake-up alarm (design, 2026-09-10)

Design canvas: https://claude.ai/code/artifact/26f0f913-63ac-434a-b009-a12586aa4c44
(thirteen artboards across three pages, one page per release. The alarm page draws what the
platforms ACTUALLY render, with dashed outlines marking the few things we control, plus the two
surfaces where our design does go big: StandBy and the Android full screen.)

Status: **DESIGN ONLY. No code written, nothing shipped.**

## What it is

A coach sets a wake-up time for their athletes. At that time a real alarm goes off on the
athlete's phone. It breaks through silent mode. It carries the coach's name, and on Android a
button the coach worded, like "Attack the day". The app owns that alarm, so it knows whether the
athlete got up or hit snooze. The coach sees who did what. The morning counts toward the athlete's
daily score.

This is the Wake-Up Roll Call rebuilt around a real alarm instead of a notification. The roll
call was built, shipped to the lock screen, and switched off on 2026-09-02 because, in the
founder's words, the vision wasn't coming to life. The thing that was missing is the thing an
alarm has and a notification never could: it knows when you hit snooze.

## Decisions already made

These were settled with the founder on 2026-09-10 and are not open.

| Question | Decision |
|---|---|
| Where do the points come from? | Inside the daily score. Food stays 82. The night check-in drops from 18 to 10. Wake-up takes 8. |
| Does the app own the alarm? | Yes. A real alarm on both platforms, not a notification. |
| Android full-screen takeover? | Opt in. Google removes the default grant, but the athlete can grant it, so ask once. Corrected 2026-09-11. |
| What gets scored? | When they answered, not how many times they snoozed. |
| Proof they physically got up? | **Cut by the founder.** See "What we are not building". |
| Double penalty for a missed morning? | No. Missing the wake-up must not also cost them breakfast. |

## What is in v1

1. **The alarm.** Real and coach-set, with snooze and stop both reported. The coach's wording
   lands on the button on Android and on the second button only on iPhone; see "The alarm".
2. **The team sees each other.** The alarm shows how many are already up. The first athlete up
   is named. The count keeps moving while the window is open.
3. **The handoff to breakfast.** Answering the alarm opens the breakfast window and puts it on
   Home as the next thing due.
4. **A coach summary when the window closes**, with a one-tap nudge for whoever missed. The live
   widget stays, but the summary is the surface the feature is built around.
5. **A morning streak**, separate from the daily-score streak.
6. **Athletes can set their own** wake-up when no coach has set one. It scores the same way.

## What we are not building, and what that costs

The founder cut the step check: the idea that after pressing the button, the athlete has ten
minutes to take twenty steps or the morning reverts to a miss.

Recorded plainly because a later reader will ask: **an athlete can press the button without
getting out of bed.** Face down, eyes shut, back to sleep. Nothing in v1 distinguishes that from
a real morning. The feature measures that the phone was answered, not that a person got up.
The step data to close this is already available through Apple Health, which the app reads
today, so this stays cheap to add later if coaches report athletes gaming it.

## The alarm

Everything below was verified on 2026-09-11 against Apple's documentation, the WWDC25 session 230
transcript, Apple's own AlarmKit sample project and Google's developer and Play policy pages. The
first draft of this section was written from a summary and got the most important fact wrong.

### What we actually control on iOS

**Correction to the first draft, and it changes the founder's original idea.** That draft said the
stop button takes our own text. It does not. The initializer that accepted a `stopButton:` is
**deprecated**; the shipping one is `init(title:secondaryButton:secondaryButtonBehavior:)` and
Apple's documentation states the system provides the stop button automatically. So "Attack the
day" **cannot be the main button on iPhone**. It can only be the second button.

What the app supplies, in full:

| Thing | Ours? |
|---|---|
| Title | Yes. One `LocalizedStringResource`. |
| Subtitle or body | **Does not exist.** There is no second string. |
| Icon or artwork | No. The system shows the app's NAME, not an icon. |
| Tint colour | Yes, but it is a `Color`, so **one flat colour, never a gradient**. The blue-to-teal sweep cannot go inside the alert. |
| Stop button | No, including its label. |
| Second button | Yes: text, text colour, SF Symbol. Behaviour is `.countdown` (snooze) or a custom App Intent. |
| Button count and order | No. Stop always exists; at most one other. |
| Sound | Yes. `AlertConfiguration.AlertSound`, `.default` or `.named(_:)`. |
| Layout, background, typography | No. Apple's word for it is "templated". |

**Unresolved, and it needs a device.** Apple says the tint applies to "the templated UI". One
reading is that it fills the second button specifically. If that is what happens, the brand colour
lands on snooze rather than on stop, which is backwards, and the answer is to make the second
button our own affirmative action through a custom App Intent and let Apple's plain stop sit
underneath it. Settle this on the first device build; it is a small change either way.

**It IS a full-screen takeover on a locked phone. Confirmed 2026-09-11, founder was right.** An
earlier draft of this spec told the reader not to claim this, because Apple's own documentation
only ever says "a prominent alert" and carries no screenshots. That hedge was wrong. Evidence:

- a published screenshot of a working third-party AlarmKit build alerting on a lock screen, showing
  the full-bleed Clock-alarm treatment, giant time numerals, app name and a large pill button
  (nilcoalescing.com, 2025-07-03);
- an Apple Developer Forums bug report from a developer running it on an iPhone 14 Pro Max on iOS
  26.0, whose own words are "fullscreen alarm interface", and which confirms an alarm carries both
  **Stop and Snooze** (thread 803735);
- Apple's own launch framing, that third-party apps get the same feature set as the built-in alarm
  "including full-screen snooze and stop display options".

**Locked and unlocked are different presentations, and the system picks.** Locked gets the
full-screen takeover. Unlocked gets a compact Dynamic Island style banner. There is no API to
choose; nothing in `AlarmPresentation.Alert` or `AlarmPresentationState` exposes a size. The two
sizes are observed behaviour, not a documented distinction.

**iOS 26.1 turned Stop into a slide gesture** rather than a tap, reported for the Clock app and
probably applying to the same system-rendered view. Two consequences: never write "tap Stop" in
copy, and note that a slide is meaningfully harder to perform half-asleep than a tap. That
partially covers the hole left by cutting the step check, though it does not close it.

Requirements: iOS 26 minimum, `NSAlarmKitUsageDescription` in the Info.plist, a runtime
authorization prompt, and a widget extension. The extension is not optional: Apple's docs warn
that without one, an app supporting a countdown may have **alarms unexpectedly dismissed and fail
to alert**.

**The entitlement question stays open.** Several sources claim AlarmKit needs a special entitlement
applied for through Apple. An Apple engineer states publicly in the developer forums that
`com.apple.developer.alarmkit` is fabricated, generated by language models, and that no such
capability exists. No Apple document specifies one. Plan for the possibility of an application and
a wait, but do not add the entitlement on faith.

**Below iOS 26 there is no alarm.** Those athletes keep the time-sensitive push the app already
sends. They can still answer and still score. They will not be woken through silent mode. The
coach's setup screen should say so plainly.

### Where our design actually appears on iOS

This is the part worth planning around, because the alert is a form to fill in rather than a
surface to design.

**The Live Activity is the canvas, and it is blank during the alarm.** Apple's own sample widget
returns `EmptyView()` for the `.alert` mode in all four presentations. The countdown and the
snoozed states are what it draws. So the Live Activity is the minutes either side of the alarm,
never the alarm itself. Lock Screen and expanded sizes are 84 to 160pt tall; the Lock Screen
background is ours through `activityBackgroundTint(_:)`.

**StandBy is the best surface we get, and it matches the situation exactly.** A phone charging on
its side on a nightstand at 5:45 IS StandBy. Apple scales the Live Activity's Lock Screen
presentation up 2x to fill the screen there and extends a custom background colour across the
whole thing. Design for StandBy first and let the Lock Screen card be the reduction of it.

**The Dynamic Island is ours in content only.** Apple: "You can't change the background color of
Live Activities in the Dynamic Island." Black background, white text, fixed 44pt corner radius.
`keylineTint(_:)` is the only chrome control.

**Apple Watch.** The system forwards the alert presentation to a paired watch. We control nothing
there beyond what is already in the alert. AlarmKit itself does not ship on watchOS. Whether the
countdown Live Activity reaches the watch is not stated by Apple and should not be designed for.

### Android

`AlarmManager.setAlarmClock`. The app owns the pending intent, so it owns the buttons and knows
snooze from dismiss. It is exempt from Doze and shows the system alarm icon.

Permission: `SCHEDULE_EXACT_ALARM`, granted by the athlete at runtime. We are not using
`USE_EXACT_ALARM`, which is a restricted permission reviewed by Play and can block publishing.

**Correction to the first draft: the full-screen takeover IS available, as an opt-in.** The draft
ruled it out. What Google actually does is revoke the DEFAULT grant of `USE_FULL_SCREEN_INTENT`
for apps that are not calling or alarm apps. The athlete can still grant it themselves, through
`ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT`, and `NotificationManager.canUseFullScreenIntent()`
reports the state. So an athlete who wants to be woken properly can have our own Activity covering
their lock screen, which is 100% our design and the best-looking version of this feature on either
platform. Ask once, honour the answer, and fall back to the notification when it is declined.

Without it, the notification is drawn from Google's template: system icon well, app name,
timestamp and expand chevron, with our title, one line of text, an accent colour and up to three
action buttons. Content budgets are roughly 48dp collapsed, 88dp heads-up and 252dp expanded, and
it is `RemoteViews` only. Fully custom notification layouts have been impossible since Android 12,
and targeting an older API to escape that is not shippable because Play requires API 35+ today and
36+ from 31 August 2026. One more consequence of declining the permission: without it a
full-screen intent's notification is documented to persist for only **60 seconds**.

Android does give us the button words, so "Attack the day" is real there even in the templated
case.

### The sound

**A normal alarm tone. Founder ruling, 2026-09-11.** An earlier draft of this design proposed the
coach's recorded voice, on the grounds that the sound is the one sensory channel we fully own. The
founder rejected it. Ship a standard alarm sound.

## What the athlete sees

Three states, one composition. Who is speaking, the number that matters, one line, the buttons.

**Ringing.** Coach name and avatar. How many of the squad are already up. A countdown to the
window closing. The coach's button, then snooze underneath.

**Snoozed.** Amber. How long until it rings again. How many snoozes are left. The line that says
the coach can see this.

**Answered.** Green. The time they got up. What it earned. Their morning streak. Where they
placed on the squad. Then the handoff line to breakfast.

## What the coach gets

**Setup.** Time, days, window length, who it applies to, and the button label with a few presets.
Reuses the existing audience picker (`js/audience.js`) rather than growing a new one.

**The 6:15 summary.** One card when the window closes: how many up, how many snoozed, who never
answered, with a nudge button for the misses. This is the primary coach surface.

**The live widget.** The roster filling in while the window is open, for the coach who is awake.
Secondary, and must not be the only way to see the morning.

## Scoring

### The weights

On a day a wake-up is assigned:

| Component | Weight |
|---|---|
| Nutrition | 82 |
| Wake-up | 8 |
| Check-in submitted | 5 |
| Check-in answered | 5 |

On a day with no wake-up assigned, the formula is exactly today's v3: nutrition 82, check-in
submitted 9, check-in answered 9.

Two rules behind those numbers:

- **Food does not move.** On 2026-09-09 the founder ruled that a perfect food day reaches 82 and
  clears the on-standard line on its own. Taking points from food reverses that ruling a day later.
- **The weight only exists when the morning does.** Otherwise an athlete with no coach and no
  alarm could never reach 100, and "every point is earnable" was the whole point of score v3.

### What earns the 8

The answer and its time, never the snooze count.

The reason is fairness, and it is not negotiable: only iOS 26 can report a snooze. If snoozing
cost points, two athletes who behaved identically would score differently because of their phone,
and a 94 would stop meaning one thing on every roster. Snoozing still costs them, because
snoozing makes them answer later, and the answer time is what scores.

The exact curve from answer time to points is the first thing to settle in implementation. The
shape: full credit for answering promptly, fading to zero at the window's close, in the same
spirit as the meal lateness curve in `day.js lateCredit`.

The snooze count is still recorded, still shown to the athlete, and still shown to the coach. It
is the honest detail. It is just not the thing the arithmetic depends on.

### The cost of changing the formula

This is the expensive part of the feature and it is not code.

- The weights live in about eight places, pinned by `weight-sources`, `planStyleCaps` and
  `scoreParity` tests.
- The server clamps written scores against a ceiling (`0228_score_v3_ceiling.sql`). A client that
  computes a new number against an old ceiling silently writes the old one, so the migration and
  the client must ship together, with a dated cutover, exactly as v3 did.
- **The formula is a published promise.** It appears in the App Store listing, two articles, the
  landing page, and `.agents/product-marketing.md`. All of them have to change or the product
  will be printing a formula it no longer uses.

## The handoff to breakfast

Answering the alarm opens the breakfast window immediately and makes it the NOW card on Home.
Getting up is not the goal. Eating is. This also means the morning has a second beat, so an
athlete who gets up and then goes back to sleep still gets caught by the meal they miss.

Per the founder's ruling, a missed wake-up must not also cost them the meal. The miss is scored
once.

## Morning streak

Separate from the daily-score streak. Counts consecutive mornings answered inside the window.
Shown on the answered screen and on the athlete's profile. Cheap, and it is the number athletes
will actually chase.

Grace: follow the existing streak grace rule (`day.js`, one graced miss per rolling seven days)
rather than inventing a second grace model.

## Athletes without a coach

An athlete can set their own wake-up. It scores identically. This matters because most people
using the app do not have a coach assigning them anything, and a feature that only works for
pilot teams is a feature most users never see.

When a coach later assigns one, the coach's wins. The athlete cannot delete a coach-set wake-up,
only mute the sound on a specific morning, which is recorded.

## What already exists

More than expected. From the roll call, switched off but not deleted:

- the coach assignment flow, the scheduling, and the escalation pushes;
- `modules/rollcall-live` — a working Live Activity on iOS with an App Intent and an App Group,
  and an Android presentation delegate that posts a ticking countdown and an Android 16 live
  update;
- `plugins/withRollCallLiveActivity.js`, a working config plugin;
- a notification action that records an answer from the lock screen without opening the app,
  with an offline retry queue and a background task so a killed app still records the tap;
- the Verified Commitments scoring pipe.

Turning the old feature back on is one SQL flag plus one constant in `commitments.js`.

**Genuinely new native work:** the iOS alarm and its two buttons, and Android alarm scheduling.
A repo-wide search confirms there is no AlarmKit, AlarmManager, setAlarmClock, full-screen intent
or exact-alarm code anywhere today. Every mention in the repo is prose recording a decision not
to.

**Caveat on what exists:** the Live Activity and the Android live update are written but have
never been compiled into a device build. TestFlight is still on build 26. This feature depends on
a native build landing.

## Risks

1. **The formula change is the biggest risk, not the alarm.** It touches a shipped promise and a
   server ceiling. It should ship as its own release, before or after the alarm, never tangled
   with native build problems.
2. **iOS 26 splits the fleet.** Two experiences from one feature. The coach needs to know which
   athletes can actually be woken.
3. **The entitlement question is unresolved** and can only be closed on a device.
4. **Native build debt.** Nothing here reaches an athlete until a new native build ships.
5. **A button can be pressed asleep.** Named again because it is the one the founder cut.

## Suggested first release

One team. Weekdays only. The alarm, the squad count, the coach summary, and the breakfast
handoff. Score it, but watch whether athletes actually get up before repainting the formula for
everyone.
