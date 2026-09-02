# The Apple setup for the roll-call lock screen — exactly what to click

> **Already done for you, 2026-09-02** (`node scripts/apple-provision.mjs --apply`):
> the widget's identifier `com.onstandard.app.RollCallWidget` is registered, the App Groups
> capability is enabled on both identifiers, and fresh distribution profiles for both are in
> `ios-certs/` (the old one is backed up beside it). That covers all of step 3 and most of step 2.
>
> **Two things are left, and both are portal-only:**
> 1. Create the APNs Auth Key (step 1 below).
> 2. Create the App Group and bind it (step 2 below) — Apple has no API for this. Enabling the
>    *capability* is not the same as choosing *which group*; right now the profiles carry the
>    entitlement with an empty list.
>
> `node scripts/rollcall-ios-setup.mjs` always tells you where you are.

Everything here is for the **iOS card only**. If you do none of it, build #28 still ships the
Android countdown, the alarm category, the Android 16 lock-screen pin, the new copy, and the
one-notification-replaced-in-place behaviour on both platforms. Only the iPhone card waits.

There is no partial win on iOS: the card needs all of it. What is left is about 15 minutes.

## Your values, already looked up

Read out of `ios-certs/appstore.mobileprovision`, so these are facts, not guesses.

| | |
|---|---|
| Team ID | `C44B6N2KC6` |
| Team name | JIhad Woods |
| Bundle identifier | `com.onstandard.app` |
| Push on the App ID | **already enabled** (`aps-environment: production`) |
| App Groups capability | **enabled** on both identifiers |
| App Group bound to them | **not yet** — this is what step 2 fixes |
| Widget identifier | `com.onstandard.app.RollCallWidget`, registered |
| Profiles expire | 2027-07-03 |

Push being enabled already is good news: step 1 is only about creating a *key*, not about changing
the App ID.

---

## Step 1 — an APNs Auth Key (10 minutes)

The server needs this to talk to Apple. Without it every Live Activity call is a silent no-op.

1. Go to **[developer.apple.com/account/resources/authkeys/list](https://developer.apple.com/account/resources/authkeys/list)**.
2. Click **+** (Create a key).
3. **Key Name:** `OnStandard Push` (any name; it is only a label).
4. Tick **Apple Push Notifications service (APNs)**.
5. Next to it, choose **Team Scoped (All Topics)**. Environment: **Sandbox & Production** if
   offered. Team-scoped is the simpler option and works for every app on the team.
6. **Continue → Register → Download.**

**You can only download it once.** Put it somewhere you will not lose, and do not commit it: the
repo's `ios-certs/` is already gitignored, so that is a fine home.

The file arrives as `AuthKey_XXXXXXXXXX.p8`. The ten characters in the filename are the **Key ID**.

> ⚠️ This is **not** the key already sitting in `ios-certs/AuthKey_TNS4WL4GLR.p8`. That one is an
> **App Store Connect API key**, used for uploading builds. Both are ES256 `.p8` files from Apple,
> which is exactly why they get mixed up, and Apple will not accept one for the other. I ran the
> checker below against it to be sure: Apple answers `403 InvalidProviderToken`.

### Prove it works before going further

```bash
node scripts/apns-check.mjs \
  --p8 ios-certs/AuthKey_XXXXXXXXXX.p8 \
  --key-id XXXXXXXXXX \
  --team-id C44B6N2KC6
```

It sends one push to a deliberately fake device token. Apple checks the authorization before it
looks up the device, so a reply of `BadDeviceToken` means **the key, Key ID, Team ID and topic are
all correct** — and nothing was delivered to anybody. Any other answer, and the script tells you
which of the three values is wrong and why.

Then set the three secrets (the script prints these for you with the values filled in):

```bash
supabase secrets set APNS_KEY_P8="$(cat ios-certs/AuthKey_XXXXXXXXXX.p8)"
supabase secrets set APNS_KEY_ID=XXXXXXXXXX
supabase secrets set APNS_TEAM_ID=C44B6N2KC6
```

`APNS_BUNDLE_ID` defaults to `com.onstandard.app`, so you do not need to set it.

---

## Step 2 — the App Group (5 minutes; the capability is already on)

The card lives in a separate process from the app. The App Group is the only place they can both
read and write, and it is how a tap on the card's button reaches the app.

1. **[Identifiers](https://developer.apple.com/account/resources/identifiers/list)** → the dropdown
   on the right → **App Groups** → **+**.
2. **Description:** `OnStandard Shared`. **Identifier:** `group.com.onstandard.app`.

   This string must be exact. It is hard-coded as `RollCallPendingStore.suiteName` in
   `modules/rollcall-live/ios/RollCallCheckInIntent.swift`.
3. **Continue → Register.**
4. Bind it to both identifiers. **Identifiers → App IDs**, and for EACH of
   `com.onstandard.app` and `com.onstandard.app.RollCallWidget`: the **App Groups** row is already
   ticked, so click **Edit** next to it, tick `group.com.onstandard.app`, and **Save**.
5. Then run this — it regenerates both profiles with the group in them and writes them to
   `ios-certs/` for you, so there is nothing to download by hand:

   ```bash
   node scripts/apple-provision.mjs --apply
   ```

   It prints `carries group.com.onstandard.app` for each profile when it has worked, and says
   plainly what is still missing when it has not.

---

## Step 3 — the widget extension's identity — ✅ DONE

Done on 2026-09-02 by `node scripts/apple-provision.mjs --apply`, using the App Store Connect key
already in `eas.json`. Nothing to do here.

| | |
|---|---|
| Identifier | `com.onstandard.app.RollCallWidget` ( `A749TN84WA` ) |
| App Groups capability | enabled |
| Profile | `ios-certs/widget.mobileprovision` |

The main app's profile was regenerated at the same time, because enabling a capability on an App ID
marks profiles already issued from it invalid. The one it replaced is backed up beside it as
`appstore.mobileprovision.bak-*`.

Once you have done step 2, re-run `node scripts/apple-provision.mjs --apply` to reissue both
profiles with the group actually bound.

---

## When steps 1 and 2 are done

Tell me, and I will:

1. Add the App Group to the config plugin (`app.json`, one line).
2. Add the widget extension target so the card actually gets compiled and drawn.
3. Run a `preview` build to prove the Swift compiles, before anything touches `npm run ship`.

Do not skip that last one. Nothing in `modules/rollcall-live/ios/` has been through a Swift
compiler yet, and an app-extension target that fails to build fails the whole production build.

## If something goes wrong

| Symptom | Cause |
|---|---|
| `apns-check` says `InvalidProviderToken` | Wrong key file, wrong Key ID, or it is an App Store Connect key. |
| `apns-check` says `TopicDisallowed` | The key belongs to a different team, or it is topic-specific and was not configured for this app. Make a team-scoped key. |
| `apns-check` says `ExpiredProviderToken` | This machine's clock is off by more than an hour. |
| Build fails code-signing on `application-groups` | The profile was not regenerated after step 2.4, or the old file is still in `ios-certs/`. |
| Build fails with a missing profile for `...RollCallWidget` | Step 3 is not done, or `credentials.json` was not updated. |
| Everything builds, no card appears | Expected until step 3 and the widget target exist. Check `isLiveActivitySupported()` and that the phone is on iOS 17.2+ for push-to-start. |
