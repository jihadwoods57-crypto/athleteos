# App Review rejection, 1.0 (33) — 2026-09-18

Submission `d07c2cf9-32fa-4d1f-ae74-a1c5a93b61fb`. Reviewed **2026-09-18** on an **iPad Air
11-inch (M3), iPadOS 27.0**. Five findings across four guidelines.

The review device matters. Four of the five findings are explained by it: build 33 was cut from
commit `bac11235` on **2026-09-08**, and the iPad is a device where HealthKit does not exist.

> **Binary under review:** build 33 = `bac11235`, finished 2026-09-08 21:45.
> **Latest build:** 40 = `6e888145`, 2026-09-16. Everything below lands in the NEXT build.

---

## 1. Guideline 5.1.1(iv) — camera permission priming ✅ FIXED IN CODE

**What Apple said.** The pre-permission screen's button read **"Allow camera"**; Apple asks for
"Continue" or "Next" so the custom screen does not pressure the answer to the system prompt.

**What was true.** `proto/redesign-2026-07/js/screens/camera.js` rendered exactly that label. One
button, one screen, no other permission primer in the app had the same problem (checked: the
Apple Health primer says "Connect Apple Health", which is a feature verb, not an alert verb).

**Fix.** The button now reads **"Continue"**. The explanatory copy above it is unchanged — Apple
did not object to explaining first, only to the verb on the button. A comment in the file records
why, so it does not get reworded back.

**Reply to Apple (sendable now):**

> The camera priming screen's button now reads "Continue" rather than "Allow camera", as
> suggested. The screen still explains why the camera is used before the system prompt appears,
> and offers "Log without a camera" as an alternative path for anyone who declines.

---

## 2 & 3. Guideline 2.1(b) — In-App Purchase ⛔ BLOCKED ON FOUNDER CONSOLE WORK

**What Apple said.** Two separate findings: the IAP products were never **submitted for review**,
and the purchase wall **did not display purchase options**.

**What was true.** Both describe one root cause. `src/lib/iap/index.ts` was a stub —
`isIapAvailable = false`, `react-native-purchases` had never been installed, and every call
returned `{ ok:false, reason:'unavailable' }`. The paywall degraded honestly to "Opens at launch",
which is correct engineering and is still an **incomplete app** to Apple: a Membership screen that
names plans nothing can buy.

**What I changed.**
- Installed `react-native-purchases` (`^10.10.0`).
- Implemented `configureIap` / `purchaseConsumer` / `restoreConsumer` against it, covered by
  `src/lib/iap/index.test.ts` (15 tests).
- `isIapAvailable` is **derived**, not hardcoded — see `docs/go-live/CONSUMER-IAP.md` step 3 for
  why a literal `true` would ship a dead CTA over the air to older binaries.

**⛔ This alone does NOT fix the rejection.** Four things remain, and none are code:

| # | Do this in a console | Without it |
| - | -------------------- | ---------- |
| 1 | Accept the **Paid Apps Agreement** (App Store Connect → Business) | No IAP can transact at all |
| 2 | Create the **6 subscription products** (ids in `CONSUMER-IAP.md` §1) | Nothing to buy |
| 3 | **Submit each product for review** with an **App Review screenshot** | Finding #2 repeats verbatim |
| 4 | RevenueCat offering + **paste the public SDK keys into `eas.json`** | `isIapAvailable` stays false → "Opens at launch" → finding #3 repeats |

The keys sit in `eas.json` as **empty strings in all three build profiles**. Empty is the safe
state (the paywall stays honest rather than showing a CTA that throws), and it is also the state
that keeps the app rejected.

**Do not send a reply on these two findings until a sandbox purchase succeeds** (CONSUMER-IAP §5).

---

## 4. Guideline 2.5.4 — background location ✅ ALREADY FIXED, PLUS A LEFTOVER CLEANED UP

**What Apple said.** The app declares `location` in `UIBackgroundModes` with no feature requiring
persistent location.

**What was true, and why it is already gone.** Correct for build 33 — and fixed the next day.
Commit `8e7506bb` (**2026-09-09**, "take out arrival check-in and injury mode") cut the geofenced
arrival feature and with it `expo-location`, both location purpose strings, and
`UIBackgroundModes: ["location"]`. Build 33 (`bac11235`, 2026-09-08) is one day older than that
commit. **Any new build already lacks the key.**

Verified, not assumed — `npx expo config --type introspect` on the current tree:

```
UIBackgroundModes = ['fetch']
```

`fetch` is legitimate and stays: it comes from `expo-task-manager`, which `src/lib/notify/rollcall.ts`
genuinely uses for Wake-Up Roll Call.

**Leftover found and removed.** `expo-location` was still in `package.json` even though **no file
imports it**. Expo auto-applies its config plugin, so it was still injecting four purpose strings
into every build — including `NSLocationAlwaysUsageDescription` — all carrying Expo's placeholder
copy *"Allow $(PRODUCT_NAME) to access your location"*. Asking for **Always** location, in
boilerplate text, in an app with no location feature, is its own 5.1.1 risk. The dependency is
removed and the lockfile synced. Re-introspected:

```
UIBackgroundModes = ['fetch']
location/motion keys: NONE
```

**Reply to Apple (sendable once the new build is uploaded):**

> The "location" background mode has been removed, along with the location feature it supported.
> The app no longer requests location access of any kind and declares no location purpose strings.
> The remaining "fetch" background mode supports scheduled morning check-in reminders.

---

## 5. Guideline 2.5.1 — HealthKit not identified in the UI ✅ FIXED IN CODE + REPLY OWED

**What Apple said.** The app uses HealthKit but does not clearly identify that functionality in
its user interface.

**What was true — this was a real bug, on the review device specifically.** HealthKit does not
exist on iPad (`src/lib/health/index.ts` says so in its own comment: *"the device itself supports
HealthKit (iPad does not)"*), so `HK.available === false` on an iPad Air. The Apple Health screen
was written as:

```js
${ios ? readsCard() : ''}      // the entire "What OnStandard reads" section
```

So on the review device the whole description of the integration — Activity, Recovery, "Never
written" — **was not rendered at all**. What was left was one card reading "Not on this phone",
and a closing line that read:

> "Nothing to set up here on Android."

…on an iPad. The reviewer was shown, accurately from their point of view, an app with no HealthKit
functionality in its UI.

**Fix.**
- `readsCard()` now renders **unconditionally**. The value pills ("Reading" / "No data yet")
  already stay blank when nothing is connected, so an unavailable device reads what the
  integration *is* without being promised a reading it cannot take.
- The closing line now tells Android and "iPhone-only feature, not this device" apart.
- Two regression tests lock both (`apple-health.test.mjs`, now 10 tests).

**Still owed by you, and Apple explicitly asked for it:** a **screen recording on a physical
iPhone** showing Profile → Apple Health (and Settings → Health), attached in the **Notes field of
App Review Information**. Apple offered this route in the rejection; take it.

**Reply to Apple (send with the recording):**

> OnStandard identifies its HealthKit functionality on a dedicated "Apple Health" screen, reachable
> from Profile → Tracking → Apple Health and from App Settings → Health. It lists exactly what is
> read (Activity: steps, distance, workouts; Recovery: sleep, HRV, resting heart rate) and states
> that the app never writes to Health.
>
> This screen was reviewed on an iPad Air, where HealthKit is unavailable, and a bug meant the
> description was hidden on devices that report HealthKit as unavailable. That is fixed — the
> description now renders on every device. The attached recording, made on an iPhone, shows the
> screen and the read categories.

---

## ⚠ Open question: which account did App Review use?

Nothing in `docs/go-live/` records demo credentials for App Review, and the Apple Health surfaces
render **only for an athlete** — both the Profile row and the Settings → Health section are gated
on `RT.authRole === 'athlete'`. A reviewer signed in as a coach or trainer would see no Apple
Health row anywhere in the app, which would independently produce finding #5.

**Check App Store Connect → App Review Information.** If the demo account is not an athlete, or
there is none:

1. Provide a **seeded athlete demo account** (username + password fields).
2. Put the path in **Notes**, in one line each:
   - Apple Health: *Profile tab → Tracking → Apple Health*
   - Membership: *Profile tab → Plan & billing → See plans*
   - Camera: *Home → log a meal → Continue*

Review notes are free and remove the reviewer's need to guess. They are the cheapest fix on this
page.

---

## Pre-resubmit checklist

- [x] 5.1.1(iv) — camera button reads "Continue"
- [x] 2.5.4 — no `location` background mode; `expo-location` removed; introspect verified
- [x] 2.5.1 — HealthKit description renders on every device; Android/iPad copy separated
- [ ] 2.5.1 — iPhone screen recording attached in App Review Notes
- [ ] 2.1(b) — Paid Apps Agreement accepted
- [ ] 2.1(b) — 6 subscription products created **and submitted** with App Review screenshots
- [ ] 2.1(b) — RevenueCat offering live; public keys pasted into `eas.json` (all 3 profiles)
- [ ] 2.1(b) — migration `0102` applied; `revenuecat-webhook` deployed with its secret
- [ ] 2.1(b) — **sandbox purchase completes end to end** and unlocks premium
- [ ] Athlete demo account + review notes in App Review Information
- [ ] `npm run verify` green, `assets/proto.zip` rebuilt and committed
- [ ] New production build uploaded (build 41+)
