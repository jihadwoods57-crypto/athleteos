# Go-live — the Wake-Up Roll Call lock screen (2026-09-02)

The founder's review of the second pass: the lock screen "feels like generic system
notifications". It was one. A remote notification is drawn by the operating system from four
strings, so no amount of copy work could have made it read as an alarm-grade accountability
moment.

This pass gives the roll call **two surfaces**, each doing what only it can.

| | What it is | What it does |
|---|---|---|
| **The notification** | The answer | Its action button records the check-in without opening the app, and works while the phone is **locked**. Unchanged since 0144. |
| **The Live Activity** (iOS) | The presence | A card the iPhone draws and keeps on the lock screen from 6:00 until the roll call closes, with a countdown the phone ticks itself. |
| **The Live Update** (Android 16) | The presence | The same idea through Android's own mechanism: the notification is pinned open on the lock screen with its countdown in the status-bar chip. |

**The one thing to understand before reading further:** a button inside a Live Activity is
**inactive while the device is locked**. Apple: "On a locked device, buttons and toggles are
inactive and the system doesn't perform actions unless a person authenticates and unlocks their
device." Face ID clears that with a glance, so the card's button is real and useful for a phone in
the hand. But the button that has to work at 6 AM on a phone lying face-up on a nightstand is the
**notification's**, and that is why the notification was not replaced.

## What ships where

| Piece | Needs | State |
|---|---|---|
| New push copy, per state and per platform | function deploy | **Done**, tested |
| One notification replaced in place instead of three stacking | function deploy | **Done** |
| Android countdown, alarm category, Live Update promotion | native build #28 | **Done**, not yet compiled |
| APNs Live Activity plumbing (server) | function deploy + an APNs key | **Done**, dormant without the key |
| Token bookkeeping (migration 0213) | `db push` | **Done**, not applied |
| iOS Live Activity card | native build #28 **+ three Apple-portal actions** | Authored, **not wired into the build** |

## 🔴 The three Apple-portal actions only the founder can do

**Click-by-click walkthrough, with the values already looked up: `APPLE-PORTAL-CHECKLIST.md`.**
`node scripts/apns-check.mjs` proves an APNs key works against Apple's live servers before it goes
near a build. The summary below is the what; that file is the how.

None of these can be done from this machine, and the iOS card cannot appear until all three exist.
They are all in [developer.apple.com](https://developer.apple.com/account) under **Certificates,
Identifiers & Profiles**. Team ID is `C44B6N2KC6`; push is already enabled on the App ID.

### 1. An APNs Auth Key

**Keys → + → tick "Apple Push Notifications service" → Continue → Register → Download.**

This is **not** the key already in `ios-certs/AuthKey_TNS4WL4GLR.p8`. That one is an App Store
Connect API key, used for submitting builds. Both are ES256 `.p8` files, which is exactly why they
get confused, and Apple states an App Store Connect key "can't be used for other Apple services".

You can only download it once. Then set three secrets:

```bash
supabase secrets set APNS_KEY_P8="$(cat AuthKey_XXXXXXXXXX.p8)"
supabase secrets set APNS_KEY_ID=XXXXXXXXXX     # the 10-character Key ID
supabase secrets set APNS_TEAM_ID=XXXXXXXXXX    # the 10-character Team ID
# APNS_BUNDLE_ID defaults to com.onstandard.app; APNS_SANDBOX=1 only for a debug build
```

Until these exist, every Live Activity call site is a quiet no-op and the roll call behaves exactly
as it does today. That is deliberate and tested.

### 2. An App Group

**Identifiers → App Groups → + →** `group.com.onstandard.app`

Then enable it on the `com.onstandard.app` App ID **and** on the widget extension's App ID (below),
and regenerate the provisioning profiles so they carry it. The group name must match
`RollCallPendingStore.suiteName` in `modules/rollcall-live/ios/RollCallCheckInIntent.swift`.

### 3. The widget extension's App ID and profile

**Identifiers → + → App IDs →** `com.onstandard.app.RollCallWidget`, with the App Group capability
enabled. Then a matching distribution provisioning profile.

`eas.json` uses `"credentialsSource": "local"` for the production profile, so EAS will not generate
this for you: the new profile has to be added to `credentials.json` alongside the existing one, or
that profile switched to `"remote"` so EAS manages both.

## Turning iOS on, once those exist

Two edits, in this order:

1. `app.json` → the `./plugins/withRollCallLiveActivity` entry → add the App Group:

   ```jsonc
   ["./plugins/withRollCallLiveActivity", { "appGroup": "group.com.onstandard.app" }]
   ```

2. Add the widget extension target. `modules/rollcall-live/ios/RollCallWidget.swift` is the whole
   card and is ready to compile; what does not exist is the Xcode target that holds it. Two routes:

   - **`@bacons/apple-targets`** (`npx expo install @bacons/apple-targets`) — a config plugin that
     generates Apple targets during prebuild from an `expo-target.config.js`. Lowest-effort, and it
     survives `expo prebuild --clean`.
   - **By hand in Xcode** after `npx expo prebuild -p ios`, adding a Widget Extension target that
     compiles `RollCallWidget.swift` and `RollCallAttributes.swift`. Lower risk for a first pass,
     but it does not survive a clean prebuild.

   Either way, **two files need target membership in BOTH** the app and the extension:

   - `RollCallAttributes.swift` — the app starts and updates activities, the extension draws them,
     and ActivityKit matches a push to a running activity by that type's name.
   - `RollCallCheckInIntent.swift` — the extension constructs it for `Button(intent:)` and so needs
     the type at compile time; the app must hold it because that is the process the system runs
     `perform()` in. Compiling it into both does not change where it runs.

   `RollCallWidget.swift` goes in the **extension only**.

**Do not skip the first compile.** Nothing in `modules/rollcall-live/ios/` has been through a Swift
compiler. Build once to `preview` before anything goes near `npm run ship`: an app-extension target
that fails to compile fails the whole production build.

## Deploy order

```bash
# 1. migration first: the functions read what it adds
supabase db push                       # 0213_rollcall_live_activity.sql
# probe for the objects rather than trusting --dry-run (migration history has drifted before)

# 2. functions
supabase functions deploy commitment-reminders  --use-api --no-verify-jwt
supabase functions deploy commitment-escalation --use-api --no-verify-jwt
supabase functions deploy roll-call-ack         --use-api --no-verify-jwt

# 3. the binary
npm run verify
eas build --platform android --profile production
eas build --platform ios --profile production
```

The copy change and the collapse behaviour land with step 2 and need no new binary. Everything
native waits for step 3.

## How a morning runs now

1. **6:00.** `commitment-reminders` sends the notification (`Coach D'Onofrio` / `Wake-Up Roll Call ·
   up by 6:05 AM` / the message) with the I'M UP button, and starts the Live Activity with a
   push-to-start. Android gets the same notification with a countdown chronometer to 6:05, the
   alarm category, and a Live Update promotion on Android 16.
2. **6:03.** The same notification is **replaced in place** (`tag` / `collapseId`) with
   `2 minutes left` / `On Standard until 6:05 AM.` The Live Activity turns amber and its number
   becomes a live countdown.
3. **6:05.** `commitment-escalation` replaces it again with `You're late · 3 min`, and the card
   turns red and starts counting up.
4. **Any tap** goes through the same two RPCs it always did. `roll-call-ack` then ends the Live
   Activity so the card confirms the answer instead of counting toward a deadline already met.
5. **Close.** The roll call is Missed, finally.

## Device QA (nothing below can be exercised from Windows)

**Android**

- [ ] The 6:00 push shows a **countdown** that ticks down without any further push.
- [ ] After 6:05 the same number counts **up** and the card is red.
- [ ] The 6:03 and 6:05 pushes **replace** the 6:00 card rather than stacking under it.
- [ ] On Android 16: the roll call is pinned open on the lock screen, with a status-bar chip.
- [ ] `isPresentationOverrideActive()` returns **true**. If it returns false the override lost the
      receiver race and everything above will look ordinary with nothing in the log to say why.
- [ ] With "alarms only" Do Not Disturb on, the roll call is allowed through.

**iOS** (only after the three portal actions)

- [ ] A card appears at 6:00 with the coach's name and `6:05 AM`, and the phone plays a sound.
- [ ] The card is still there, correct, an hour later with the app never opened.
- [ ] At 6:03 it turns amber and counts down; at 6:05 it turns red and counts up.
- [ ] The notification's I'M UP button records the check-in **from the locked screen**, without
      the app opening.
- [ ] The card's own button records it once the phone is unlocked (Face ID glance is enough).
- [ ] After answering, the card shows the check-in time and clears itself a few minutes later.
- [ ] Dynamic Island: compact shows the state and the number; long-press expands to the card.
- [ ] On an iPhone below 17.2, no card appears and the notification path is unaffected.

## Things that will bite

- **A category-id or attributes-type drift does not throw.** A push with the wrong
  `attributes-type` is dropped by iOS with no card and no error, exactly like the feature not being
  installed. The three spellings that must agree are `RollCallAttributes` in Swift,
  `LIVE_ATTRIBUTES_TYPE` in `_shared/rollcall-live.ts`, and the `rc_*` keys in
  `RollCallPresentationDelegate.kt`.
- **The provider token is cached on purpose.** Apple rejects a JWT older than an hour and objects
  to minting one more than every 20 minutes on a connection. `ApnsClient` holds one for 45 minutes.
  Constructing a fresh client per push would mint a fresh token per push, which is itself the bug.
- **The activity's update token rotates.** Apple warns it changes mid-activity;
  `register_live_activity_token` upserts rather than inserts for exactly that reason.
- **Custom fonts in a widget extension are a trap.** Bundling a TTF is a documented cause of
  `archiveTooLarge`, where the activity silently never starts and `Activity.request` still returns
  success. The card uses the system font with monospaced digits. Do not "fix" it to use Archivo.
- **Android 16 Live Updates refuse custom views.** If anyone later adds `setCustomContentView` to
  get a bespoke layout, the promotion silently stops. Android 12 flattens custom views into the
  system template anyway; there is nothing to win and a lock-screen pin to lose.
