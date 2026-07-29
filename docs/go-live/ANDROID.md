# Android go-live

The app has been iOS-only in practice. It is an Expo app, so Android was never a port — it was a
missing `android.package`. Without it EAS cannot produce an Android build at all, which is why
there has never been one.

That is now fixed (`app.json` → `android.package = com.onstandard.app`, matching the iOS bundle id),
and all three EAS profiles have Android blocks. **A build can be produced today.** What remains is
Play Console work only the founder can do.

## What already works

- `android.package` set, matching `ios.bundleIdentifier`.
- Adaptive icon complete: foreground, background, monochrome, `#2563EB`.
- Permissions declared: `RECORD_AUDIO`, `CAMERA`, coarse / fine / background location.
- `predictiveBackGestureEnabled: false` (the WebView shell owns the back gesture).
- EAS profiles:
  - `development` / `preview` → `buildType: apk`, internal distribution.
  - `production` → `buildType: app-bundle` (`.aab`, required by Play).
  - All three use `credentialsSource: remote` for Android so EAS generates and stores the upload
    keystore. iOS stays `local` — it has real certs in `ios-certs/`; Android has no keystore, and a
    `local` source would fail the build looking for one.

Build it with:

```bash
eas build --platform android --profile production
```

## Founder-gated

1. **Create the Play Console app** (`com.onstandard.app`). Listing copy is ready in
   `docs/marketing/aso-listing.md` — it already includes the Play title and the 76/80-char short
   description.
2. **Create a Google service account** and download its JSON key, then add the submit block to
   `eas.json`:

   ```json
   "submit": {
     "production": {
       "ios": { "...unchanged..." },
       "android": {
         "serviceAccountKeyPath": "./android-certs/play-service-account.json",
         "track": "internal"
       }
     }
   }
   ```

   Deliberately not committed with a placeholder path: a path to a file that does not exist turns a
   working config into a build that fails at the last step. Add it when the key exists.
   Gitignore `android-certs/` the way `ios-certs/` is.
3. **Google Sign-In needs an Android client id.** `eas.json` carries
   `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID` and `EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID` but no Android one.
   Create an OAuth client of type Android in the same Google Cloud project (it needs the SHA-1 of
   the EAS upload keystore, from `eas credentials`), then add
   `EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID` to all three profiles. Until then Google sign-in will not
   work on Android — email/password will. Not invented here, because a wrong client id fails at
   runtime in a way that looks like a code bug.
4. **Health Connect**, if Connected Standards should verify on Android too. The iOS path is
   HealthKit; Android's equivalent is Health Connect, needing its own permissions
   (`android.permission.health.READ_STEPS`, `READ_DISTANCE`, `READ_EXERCISE`) and a privacy-policy
   URL in the Play listing. `src/lib/health/index.ts` is one seam for both platforms, so this is
   additive — see `docs/go-live/WEARABLES.md`.

## Worth knowing before the first Android build

- **`runtimeVersion.policy = appVersion`** means an OTA published for 1.0.0 targets *every* 1.0.0
  build on *both* platforms. The updates already published were built from an iOS-only world; the
  first Android build will immediately be in range of the current production update. Since the proto
  is a WebView and the shell is shared, that is expected to be fine — but the first Android build
  should be smoke-tested against the live channel before any wide distribution.
- The proto UI has only ever been QA'd on iOS. Expect Android-specific work on safe-area insets,
  the keyboard avoiding view, and the back gesture.
- `qc/` render harness scripts drive a desktop browser, so they will not catch Android WebView
  differences.
