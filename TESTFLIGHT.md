# OnStandard → TestFlight / App Store pipeline

First build shipped to TestFlight 2026-07-05 (build #5, v1.0.0, ASC app id 6787705639).
This is the working, repeatable pipeline. Future builds are essentially two commands.

---

## The release — one command (use this)

```bash
cd C:/Users/Administrator/Downloads/athleteos
export EXPO_TOKEN=<expo access token>          # or `eas login` once

npm run ship
```

`ship` runs a **preflight guard** first, then `eas build`, then `eas submit`. The guard
is the fix for the "10 updates but TestFlight still had old code" bug:

> **EAS builds your last GIT COMMIT, not the files in your folder.** If you build with
> uncommitted changes, you silently ship the OLD commit. The guard HARD-STOPS on a dirty
> tree and prints the exact commit that will be built, so a stale build can't leave the ground.

**Confirm it worked on your phone:** open the app → **Account** → the footer shows the
commit the binary was built from (e.g. `7c22df6 · 2026-07-07 · production`). If that commit
matches the one preflight printed, you're on the newest code. If it doesn't, you're looking
at an old build — reinstall from TestFlight.

Raw two-command form (skips the guard — prefer `npm run ship`):
```bash
eas build  --platform ios --profile production --non-interactive
eas submit --platform ios --profile production --latest --non-interactive
```

`autoIncrement` bumps the build number automatically each time, so testers get a new build
with no manual version juggling.

## Why it "just works" now (one-time setup already done)
- **Backend env vars** live on EAS (`EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY`).
  Check with `eas env:list --environment production`.
- **Signing is local + non-interactive.** `eas.json` production uses `credentialsSource: local`,
  pointing at `ios-certs/`:
  - `dist.p12` — Apple Distribution cert (password `onstandard-dev`), valid to 2027-07-03
  - `appstore.mobileprovision` — App Store provisioning profile "OnStandard App Store"
    (created via the App Store Connect API against the dist cert)
  - `AuthKey_TNS4WL4GLR.p8` — App Store Connect API key (Key ID `TNS4WL4GLR`,
    Issuer `3dcac87d-ec88-493a-8f31-e298ae76af64`) — drives submit + credential ops with no 2FA
  - **All of `ios-certs/` is gitignored — these are secrets, never commit them.**
- **Submit target** is wired in `eas.json` → `submit.production.ios.ascAppId = 6787705639`.

## If credentials ever expire / need regenerating
- The App Store profile was created programmatically. To remake it, use the App Store Connect
  API key: find the distribution cert id (`GET /v1/certificates`), then
  `POST /v1/profiles` with `profileType: IOS_APP_STORE`, the bundle id resource
  (`com.onstandard.app` = `MSS3RU24U6`), and that cert. Save `profileContent` (base64) to
  `ios-certs/appstore.mobileprovision`. (Scripts used on 2026-07-05 were one-offs in scratchpad.)
- The dist cert (`dist.p12`) expires 2027-07-03. Renewing means a new cert + new profile.

## Version vs build number (know the difference)
- **Build number** (auto-increments): distinguishes uploads. TestFlight only cares about this.
  Keep shipping to TestFlight all day — build 5, 6, 7… — same version is fine.
- **Version** (`app.json` → `expo.version`, e.g. `1.0.0`): the *public* marketing version.
  Bump this (1.0.1, 1.1.0) only when you push a new PUBLIC App Store release.

## Two kinds of release
1. **TestFlight build** (what we do above): internal testers get it in minutes, **no Apple review**.
   External testers get it after a one-time ~quick Apple review.
2. **Public App Store release**: in App Store Connect, attach a build to the App Store tab,
   fill listing/screenshots (draft copy in `docs/go-live/APP-STORE-SETUP.md`), submit for
   **App Review** (~1–3 days). This is separate from TestFlight.

## Over-the-air (OTA) updates — EAS Update (SET UP 2026-07-05)
`expo-updates` is installed and configured. Builds from #7 onward can receive OTA updates.

**Ship a JS/UI-only fix instantly (no rebuild, ~seconds):**
```bash
export EXPO_TOKEN=<token>
eas update --branch production --message "what changed"
```
Testers get it next time they open the app. The `production` build profile is on
channel `production` (see eas.json), which maps to the `production` branch.

**When you STILL need a full rebuild + resubmit (OTA can't do these):**
- app icon / splash, new native package, new permission, SDK upgrade, anything in
  `app.json` native config, or a `version` bump.

**Runtime version = `appVersion` policy** (currently `1.0.0`). OTA updates only reach
builds with a matching runtime version. Rule of thumb: if you add/upgrade a native
module, rebuild — don't just `eas update`, or the JS could reference native code that
isn't in the installed build.

## Splash screen (SET UP 2026-07-05)
`expo-splash-screen` plugin configured in app.json: mark = `assets/splash-icon.png`
(white check-ring on solid `#1E50D6`), backgroundColor matches. Change = native, needs rebuild.
