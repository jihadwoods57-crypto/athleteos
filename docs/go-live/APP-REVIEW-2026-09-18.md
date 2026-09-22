# App Review rejection, 1.0 (33) — 2026-09-18

Submission `d07c2cf9-32fa-4d1f-ae74-a1c5a93b61fb`. Reviewed **2026-09-18** on an **iPad Air
11-inch (M3), iPadOS 27.0**. Five findings across four guidelines.

The review device matters. Four of the five findings are explained by it: build 33 was cut from
commit `bac11235` on **2026-09-08**, and the iPad is a device where HealthKit does not exist.

> **Binary under review:** build 33 = `bac11235`, finished 2026-09-08 21:45.
> **Build 41** = `dd95998b`, 2026-09-18, VALID on TestFlight, carries every code fix below plus the
> RevenueCat key, and was **attached to version 1.0 on 2026-09-22** (the version moved from
> REJECTED to PREPARE_FOR_SUBMISSION; review submission `d07c2cf9` sits in UNRESOLVED_ISSUES
> waiting to be resubmitted). Nothing needs rebuilding.

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

## 2 & 3. Guideline 2.1(b) — In-App Purchase ⛔ BLOCKED ON THE PAID APPS AGREEMENT

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

**Where this stands (re-checked against ASC and RevenueCat on 2026-09-22):**

| # | Needed | State |
| - | ------ | ----- |
| 1 | **Paid Apps Agreement** active (ASC → Business) | ⛔ **PENDING** — founder awaiting an EIN for tax info. RevenueCat still reports `duration: null` on all six products, meaning Apple has not served their metadata yet. No API exposes the agreement; look at <https://appstoreconnect.apple.com/business>. |
| 2 | Six subscription products, priced, with review screenshots | ✅ `6/6 READY_TO_SUBMIT`, USD 9.99 / 84 / 14.99 / 125.99 / 18.99 / 155.99 |
| 3 | Products **submitted for review** | ✅ ready — they go WITH the version; build 41 is attached, so hitting Submit sends them |
| 4 | RevenueCat offering + public key compiled into the binary | ✅ `appl_` key in all three `eas.json` profiles, built into 41; paywall verified on an iPhone (3 plans, prices, live trial CTA) |

Until #1 flips to Active, StoreKit returns no products, RevenueCat reports *"None of the products
could be fetched"*, and a purchase tap fails — which is finding #3 again in a new build. Do not
resubmit before the agreement is Active and a sandbox purchase has gone through.

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

## ✅ Demo account: checked, and it was never the problem

The 2026-09-08 audit recorded the App Review demo account as NOT SET, which made it a candidate
cause for finding #5. Read back from the API on 2026-09-18, it **is** set, and both accounts sign
in against live prod today:

| Account | Role in `profiles.primary_role` | Sign-in |
| ------- | ------------------------------- | ------- |
| `review-athlete@onstandard.app` | `athlete` | ✅ verified |
| `review-coach@onstandard.app` | `coach` | ✅ verified |

So the reviewer had a working athlete account and could reach Profile → Apple Health. The 2.5.1
finding was the iPad rendering bug and nothing else, which is what the code fix addresses.

## The App Review notes were describing a deleted feature

The notes sitting in App Store Connect still contained this, under a heading of its own:

> LOCATION, "ALWAYS" … Used for one thing: confirming an athlete arrived at a practice …
> Background mode "location" exists solely for that geofence.

That feature was removed on 2026-09-09 by `8e7506bb`. The notes told the reviewer to go and find a
persistent-location feature, and Guideline 2.5.4 says, in Apple's words, *"we are unable to locate
any features that require persistent location."* The notes also stated outright that *"the consumer
membership screen shows no prices and no purchase button"*, which is the 2.1(b) rejection written
by us, about us.

**Rewritten and uploaded 2026-09-18.** The new notes name the four findings and what changed, tell
the reviewer to use the ATHLETE account for HealthKit and membership (a coach has neither screen),
give the exact tap path to each, and explicitly retract the location paragraph. Apple caps notes at
**4000 characters** — the API rejects anything longer with `ATTRIBUTE.INVALID.TOO_LONG`, so edits
have to be made to fit rather than appended.

## 🎥 The iPhone screen recording Apple asked for

Apple offered this route for 2.5.1 and it is the cheapest close available. One take, under a
minute, on a **physical iPhone** (HealthKit does not exist on iPad, which is the whole point).
Attach it in **App Review Information → Notes**, or reply to the rejection with it.

1. Open OnStandard, signed in as `review-athlete@onstandard.app`.
2. Tap the **Profile** tab. Pause on the **Tracking** group so "Apple Health" is legible.
3. Tap **Apple Health**. Let the screen settle.
4. Slowly scroll the whole screen so the camera catches, in order:
   - the status card (Not connected / Connected)
   - the heading **"What OnStandard reads"**
   - the **Activity** row — steps, walking and running distance, workouts
   - the **Recovery** row — sleep, HRV, resting heart rate
   - the **"Never written"** row
5. Tap **Connect Apple Health**, and let Apple's own permission sheet appear on camera. Allow it.
6. Return to the screen and show it now reading — the rows change to "Reading" with real values.

Do not narrate, do not edit, do not speed it up. Apple wants to see the identification exists in
the shipped UI.

## Pre-resubmit checklist

**All six products finished at 2026-09-18: `6/6 READY_TO_SUBMIT`, verified by reading ASC back.**

| Product | USD | Territories priced | Trial | Screenshot | State |
| ------- | --- | ------------------ | ----- | ---------- | ----- |
| `onstandard_individual_monthly` | 9.99 | 175/175 | 175/175 | COMPLETE | READY_TO_SUBMIT |
| `onstandard_individual_annual` | 84.00 | 175/175 | 175/175 | COMPLETE | READY_TO_SUBMIT |
| `onstandard_individual_plus_monthly` | 14.99 | 175/175 | 175/175 | COMPLETE | READY_TO_SUBMIT |
| `onstandard_individual_plus_annual` | 125.99 | 175/175 | 175/175 | COMPLETE | READY_TO_SUBMIT |
| `onstandard_family_monthly` | 18.99 | 175/175 | 175/175 | COMPLETE | READY_TO_SUBMIT |
| `onstandard_family_annual` | 155.99 | 175/175 | 175/175 | COMPLETE | READY_TO_SUBMIT |

Done in App Store Connect on 2026-09-18, via the ASC API with the key in `ios-certs/`:

- [x] Subscription group **"OnStandard Membership"** (`22394757`) created and localized
- [x] All **six** subscription products created, named and localized (description cap is **55 chars**)
- [x] Priced in **all 175 territories** — the state only flips to READY_TO_SUBMIT on the last one
- [x] **14-day free trial** in all 175 territories, on all six (1,050 offers)
- [x] **App Review screenshot** on all six, asset state `COMPLETE` (`npm run shots:iap`)
- [x] Review notes rewritten and uploaded — the deleted-geofence paragraph is gone
- [x] Demo accounts verified against live prod; the athlete account really is an athlete

Done since, read back from the consoles on 2026-09-22:

- [x] RevenueCat project, offering, entitlement and webhook — see `REVENUECAT-SETUP.md`
- [x] `EXPO_PUBLIC_REVENUECAT_IOS` in all three `eas.json` profiles; build 41 confirmed loading it
- [x] `REVENUECAT_WEBHOOK_SECRET` rotated and proven; `revenuecat-webhook` deployed; migration `0102` applied
- [x] Build 41 uploaded, VALID, and **attached to version 1.0** (was still build 33 until 2026-09-22)
- [x] Leftover Android location permissions removed from `app.json` (nothing used them; the iOS side was already clean)
- [x] Review notes: the paywall path now names the athlete button, "See membership plans"

Still open — in this order, and each needs a human:

- [ ] **Paid Apps Agreement → Active** (ASC → Business). The single blocker. Signal that it worked:
      RevenueCat products show a non-null `duration`/`trial_duration`.
- [ ] **Sandbox purchase, end to end** on build 41 (`SANDBOX-AND-RECORDING.md` part 1) — confirm
      `subscriptions.rc_app_user_id` is the athlete UUID, not `$RCAnonymousID`.
- [ ] **Record the iPhone video** for 2.5.1 (shot list above) and attach it in the reply.
- [ ] **Resubmit**: in ASC open submission `d07c2cf9` (Unresolved Issues), reply to each finding with
      the text in this doc, confirm all six subscriptions are listed on the version page, submit.
      No new build is needed.

### The gotchas this pass paid for

- **Availability must be set BEFORE pricing.** Pricing a subscription that is available nowhere
  returns a useless `ENTITY_ERROR.RELATIONSHIP.INVALID`.
- **A price in one territory is not enough.** Submission fails with
  `IAP_SUBMISSION_NOT_ALLOWED_MISSING_PRICING_DATA` and names all 174 unpriced territories. Use
  `/v1/subscriptionPricePoints/{usaPointId}/equalizations` — that is Apple's own auto-fill.
- **$126 and $156 are not App Store price points.** The ladder runs …124.99, 125.99, 126.99… Round
  DOWN, never up, and move the code catalog to match.
- **Review screenshots are validated asynchronously.** The upload returns 200 and the subscription
  silently stays `MISSING_METADATA`; the real verdict is in `assetDeliveryState`. 804×1744 was
  rejected as `IMAGE_INCORRECT_DIMENSIONS`; 1242×2208 was accepted.
- **Review notes cap at 4000 characters**, product descriptions at **55**.
- The ASC API rate-limits hard on bulk writes. Back off and retry; every script here is idempotent.
