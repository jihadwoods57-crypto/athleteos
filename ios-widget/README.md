# Verified Commitments — iOS widget (slice 3)

**Status: authored, NOT enabled, NEVER compiled.**

This target is deliberately not referenced by `app.json`. Turning it on is a two-line change,
described below — but do it **on a Mac**, because nothing here has been through a Swift compiler.
It was written on Windows, where `xcodebuild` does not exist. Wiring an unverified app-extension
target into `app.json` would put it in the path of `npm run ship`, and a target that fails to
compile fails the whole production build.

## What it does

- **Coach**: `9/11 UP · 2 awaiting response`, tap to open the roster breakdown.
- **Athlete**: the coach's own title and button label, pressed straight from the Home or Lock
  Screen. Once checked in it shows `Checked in 4:48 AM`.

Both read a small JSON snapshot from a shared App Group container. The widget never makes a
network request and never holds a session token.

## The one piece still missing

The widget reads `verifiedCommitments.snapshot` from the App Group. **Nothing writes it yet.**
Writing to App Group `UserDefaults` from JavaScript needs a small native module, which is the same
Mac-only work as the target itself. Two options, in order of preference:

1. **A tiny native module** (`setSnapshot(json: String)` → `UserDefaults(suiteName:)`), called from
   `commitment-data.js` after each `loadMine` / `loadBoard`. Cleanest, ~30 lines of Swift.
2. **`expo-shared-preferences`-style community module**, if you'd rather not maintain one.

The same module should drain `verifiedCommitments.pendingAck` on foreground and call
`ack_commitment` for it — the widget's `CheckInIntent` deliberately only records intent, because a
widget extension has no Supabase session and minting one there would put a refresh token in a
second process.

## Enabling it

1. Create the App Group `group.app.onstandard.shared` in the Apple Developer portal, and add it to
   both the app and the widget target.
2. Declare the extension so EAS generates credentials for it before the build starts:

```jsonc
// app.json → expo.extra
"eas": {
  "build": {
    "experimental": {
      "ios": {
        "appExtensions": [
          {
            "targetName": "OnStandardWidget",
            "bundleIdentifier": "app.onstandard.OnStandardWidget",
            "entitlements": {
              "com.apple.security.application-groups": ["group.app.onstandard.shared"]
            }
          }
        ]
      }
    }
  }
}
```

3. Add the target itself. Either `npx expo prebuild -p ios` and add the WidgetKit target in Xcode
   (pointing it at `ios-widget/OnStandardWidget.swift`), or add a config plugin that does it via
   `withXcodeProject`. Expo classes app-extension support as **experimental** for CNG projects, so
   the Xcode route is the lower-risk one for a first pass.
4. Build on a Mac, install on a device, and check both families render before shipping.

## Deep link

The widget opens `onstandard://roll-call/<instanceId>`. `ProtoApp.tsx` already routes reminder
deep links into the WebView by hash; the `roll-call/<id>` route exists and takes a `sub` param, so
this needs no new screen — only that the scheme is registered.
