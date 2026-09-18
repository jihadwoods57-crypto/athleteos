# The two things only a device can do

Build 41 carries the RevenueCat key, so the paywall can finally transact. These are the last two
steps before submitting, and neither can be scripted from a dev machine.

Do them in this order — the purchase test tells you whether the whole rail works, and there is no
point recording anything if it doesn't.

---

# PART 1 — Prove a purchase end to end (sandbox)

## 1.1 Create a Sandbox Tester (5 minutes, do this first)

App Store Connect → **Users and Access → Sandbox → Test Accounts** → **+**

<https://appstoreconnect.apple.com/access/users/sandbox>

- Use an email you control that has **never been an Apple ID**. A `+` alias works and is the easy
  trick: `jihadwoods57+sandbox1@gmail.com`.
- Set the **region to United States** — our prices are USD, and a different storefront shows
  different numbers and muddies the test.
- Write the password down. You will type it on a phone, more than once.

> Do not sign into your real iPhone's main Apple ID with this. It is only ever entered into the
> purchase sheet or the Sandbox Account slot.

## 1.2 Install build 41 from TestFlight

Wait for the build to finish and reach TestFlight, then install it on a **physical iPhone**.
Check the build number in TestFlight is the one you just made — installing yesterday's build and
concluding the store is broken is the classic hour-waster.

## 1.3 Attempt the purchase

1. Open OnStandard, sign in as **`review-athlete@onstandard.app` / `Plate-Photo-2026`**.
2. **Profile** tab → **Plan & billing** → **See plans**.

**Stop here and read the screen. This is the single most important checkpoint in the whole task.**

| What you see | What it means |
| ------------ | ------------- |
| Three plans, prices, **"Start 14-day free trial"** | ✅ The key made it into the build. Continue. |
| **"Opens at launch"** (greyed out) | ⛔ `isIapAvailable` is false. Stop — see Troubleshooting. |
| **"Not bought in the app"** and no plan cards | ⛔ Same cause. Stop. |

3. Tap **Start 14-day free trial**. Apple's sheet appears.
4. When it asks to sign in, use the **sandbox tester** from 1.1 — not your own Apple ID.
5. Confirm. It should complete without charging anything.

> **The Sandbox Account slot on the device** only appears *after* you have attempted a sandbox
> purchase once. If you need it later:
> - **iOS 18+**: Settings → **Developer** → Sandbox Apple Account
> - **iOS 12–17**: Settings → **App Store** → Sandbox Account

## 1.4 Confirm the server actually learned about it

This is the part that proves the *rail*, not just the sheet. Run this on the dev machine:

```bash
npx supabase db query --linked "select owner_id, tier, status, plan_id, store, store_product_id, rc_app_user_id, current_period_end from subscriptions where tier='consumer' order by updated_at desc limit 5;"
```

What you want:

| Column | Expected |
| ------ | -------- |
| `tier` | `consumer` |
| `status` | `active` |
| `plan_id` | `individual` (or whichever you bought) |
| `store` | `app_store` |
| `store_product_id` | the exact id you bought |
| `rc_app_user_id` | **`cbd18c94-f0ca-416f-8068-aee460090598`** — the review athlete's profile UUID |

> ### ⛔ The one failure that looks like success
> If `rc_app_user_id` is a RevenueCat anonymous id (`$RCAnonymousID:…`) rather than that UUID,
> **the purchase is attached to nobody.** The sheet succeeded, money would have moved, and the
> entitlement will never resolve for that athlete. It means `configureIap` ran before sign-in.
> Do not ship that. Tell me and I will fix the call order.

## 1.5 Confirm the athlete actually gets something

`MONTHLY_REQUIRES_PLAN=1` is live, so the monthly report is the visible proof:

- In the app: **Progress → the monthly report** should now open instead of showing the paywall.
- If the app still thinks you are unpaid, force a re-pull by backgrounding and reopening it.

## Troubleshooting

| Symptom | Cause | Fix |
| ------- | ----- | --- |
| "Opens at launch" on a real device | The `appl_` key is not in that binary | Confirm you installed build 41, not an earlier one. The key is build-time; no OTA delivers it. |
| "Native module (RNPurchases) not found" | Binary predates `react-native-purchases` | Same — wrong build installed. |
| Purchase sheet errors immediately | **Paid Apps Agreement not Active** | <https://appstoreconnect.apple.com/business> |
| Sheet works, no `subscriptions` row | Webhook not reaching Supabase | It was proven on 2026-09-18; check RevenueCat → Integrations → Webhooks for delivery errors. |
| Row appears, anonymous `rc_app_user_id` | `configureIap` ran before sign-in | Code fix — see 1.4. |
| Prices look wrong in the sheet | Normal in sandbox | Sandbox and TestFlight often show prices that do not match App Store Connect. Test the *flow*, not the numbers. |
| Subscription renews absurdly fast | Normal | Sandbox compresses renewals; TestFlight renews once per 24h. |

> Deleting a customer in RevenueCat does **not** clear Apple's purchase history. To test as a
> genuinely new buyer you need a *different* sandbox tester.

---

# PART 2 — The HealthKit screen recording (Guideline 2.5.1)

Apple offered this route in the rejection. It is the cheapest close available, and it only works
on a **physical iPhone** — HealthKit does not exist on iPad, which is the entire reason this
finding was raised.

## What Apple needs to see

That the app *identifies* its HealthKit functionality in the UI. Not that it works — that a user
can find the description of what is read.

## The take (under a minute, one continuous shot)

Start the screen recording **before** opening the app.

1. Open OnStandard, already signed in as the **review athlete**.
2. Tap the **Profile** tab. **Pause ~2 seconds** on the **Tracking** group so "Apple Health" is
   readable on camera.
3. Tap **Apple Health**.
4. Let the screen settle, then **scroll slowly** — slower than feels natural — so the camera
   catches, in order:
   - the status card
   - the heading **"What OnStandard reads"**
   - the **Activity** row — steps, walking and running distance, workouts
   - the **Recovery** row — sleep, HRV, resting heart rate
   - the **"Never written"** row
5. Tap **Connect Apple Health**. Let **Apple's own permission sheet** appear on camera — this is
   the moment that proves the integration is real. Allow it.
6. Return to the screen and show it reading: the rows now show values instead of being blank.

## Rules

- **No narration, no captions, no edits, no speed-up.** A reviewer wants an unedited screen
  recording; anything produced looks like something to distrust.
- **Do not use an iPad.** The screen will say Apple Health is available on iPhone, which is true
  and is not what Apple asked to see.
- Keep it under a minute. Longer does not help.

## Where it goes

App Store Connect → your version → **App Review Information → Notes** (attach there), or reply to
the rejection message with it attached.

The written reply to pair with it is in `docs/go-live/APP-REVIEW-2026-09-18.md` under finding 5.

---

# PART 3 — Then submit

The six products are `READY_TO_SUBMIT` and **travel with the app version** — they are not
submitted separately.

1. Attach build 41 to version 1.0.
2. **Confirm the version page lists all six in-app purchases** before you submit. If it does not,
   stop and say so.
3. Submit once.

Review notes are already rewritten and uploaded. Demo accounts are set and verified working.
