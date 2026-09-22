# Chance of Apple approval — graded 2026-09-22

`npm run check:review` is the live version of this page: it reads App Store Connect, RevenueCat,
Supabase and the public site and prints a GO / NO-GO. Run it the morning you submit. This page
explains the grade behind it and what moves it.

## The grade

| | Grade | Chance | Why |
| --- | --- | --- | --- |
| **If you submit today** | **F** | ~0% | The Paid Applications agreement is Pending. Apple serves no product metadata, so the reviewer taps "Start 14-day free trial" and it fails. That is finding #3 of the last rejection, verbatim, and 2.1(b) is applied before anything else is looked at. |
| **After the agreement is Active and one sandbox purchase has gone through** | **B+** | ~75% | Every one of the five findings has a code fix in build 43 and reply text below; the reviewer-style pass closed twelve more; 26 of the 28 live checks pass; Beta App Review approved builds 41, 42 and 43; the iPad layout passes 22/22. What is left is the residue no script can drive out (below). |
| **…and the iPhone recording is attached to the 2.5.1 reply** | **A-** | ~80% | Apple invited the recording. Sending it closes 2.5.1 on their terms rather than ours. |

A first resubmission after a five-finding rejection usually gets one more round. An A- here
means "more likely than not to pass this round; if it bounces, it bounces on one item, not five".

## What is proven (26/28, read from the servers)

- Version 1.0 is PREPARE_FOR_SUBMISSION with **build 43** attached (the newest upload; Beta App
  Review APPROVED). Submission `d07c2cf9` is open in UNRESOLVED_ISSUES to resubmit into.
- Review notes: demo account set, 3,996 / 4,000 chars, no location claim, two plans named.
- Description carries Terms of Use and Privacy Policy links and the auto-renew terms (3.1.2).
- Four subscriptions READY_TO_SUBMIT, each with a COMPLETE two-plan review screenshot.
- Both demo accounts sign in. The athlete has three meals in the last 7 days and is an adult to
  the server (no guardian wall). The coach sees the athlete on a team whose pilot runs to
  2027-09-08, so no plan wall on any coach write.
- Sign in with Apple and Google are enabled on the auth server (4.8).
- Privacy policy names Apple Health and no longer describes the deleted location feature;
  terms carry the objectionable-content clause.
- Info.plist: no location strings or background mode; no microphone string; camera primer says
  Continue.

## The residue (what the ~20–25% is made of)

| Risk | Est. | What would close it | Owner |
| --- | --- | --- | --- |
| Sandbox purchase misbehaves during review (StoreKit sandbox quirks, RevenueCat attribution) | 5% | One real sandbox purchase on build 43, then `npm run check:review` shows it | founder |
| Native Sign in with Apple / Google does not complete on the reviewer's iPad. Verified from the inside on 2026-09-22 via the Supabase management API: the Apple provider is registered to `com.onstandard.app`, Google carries both the web and iOS client ids the app compiles in, both enabled. What remains is the device round-trip itself. | 4% | Tap both on a real device once. Both must land on Home. | founder |
| App Privacy labels in App Store Connect disagree with the binary's privacy manifest (5.1.2) | 5% | Open App Privacy and confirm it lists exactly: **Contact Info** (name, email), **Health & Fitness** (health, fitness), **Photos or Videos**, **User Content** (other), **Identifiers** (user ID, device ID), **Usage Data** (product interaction). All "linked to you", none "used to track you". | founder |
| Reviewer deletes the demo account while testing 5.1.1(v) | 3% | Nothing to do; the deletion must work. If it happens, re-seed with `scripts/seed-demo-accounts.sql`. | — |
| 4.2 "repackaged website" on a WebView shell | 3% | Not raised in the first review; the native surface (HealthKit, camera, alarms, Live Activities, push, IAP) is the answer if asked. | — |
| Something only a device shows (a first-launch crash on iPadOS 27, a permission sheet in the wrong place) | 3% | Ten minutes on an iPad with build 43: sign in, log a meal, open Apple Health, open the paywall, rotate. | founder |

## Reply text for the two 2.1(b) findings (send only after the sandbox purchase works)

> **Products not submitted for review.** The membership products (Individual and Family, monthly
> and annual) are created, priced in every territory, carry App Review screenshots, and are
> included with this version submission.
>
> **Purchase options not displayed.** The purchase wall now presents both plans with prices, the
> 14-day free trial terms, auto-renewal wording, Terms of Use and Privacy Policy links, and
> Restore Purchases, and completes a purchase through StoreKit. The previous build predated the
> store integration. Path: sign in as the athlete demo account, Profile → Plan & billing →
> "See membership plans".

Reply text for 5.1.1(iv), 2.5.4 and 2.5.1 is in `APP-REVIEW-2026-09-18.md`.

## The runbook, in order

The same six steps, with direct links, the sandbox tester and paste-ready replies, as a page:
<https://claude.ai/artifact/2vq9sJpaNuWGagBJaZgtBn>. `npm run seed:review` logs the demo athlete's meals for the day.


1. App Store Connect → Business: Paid Applications **Active**.
2. TestFlight build 43 on a physical iPhone → `SANDBOX-AND-RECORDING.md` part 1 (sandbox buy).
3. `npm run check:review` → must print **GO** (or "GO, with notes").
4. Record the Apple Health walkthrough (part 2). Tap Sign in with Apple and Google once each.
5. Log two or three meals on the athlete demo account that day.
6. App Store Connect → the rejected submission → reply to each of the five findings with the text
   above and in `APP-REVIEW-2026-09-18.md`, attach the recording to 2.5.1, confirm the four
   subscriptions are listed on the version page, **Submit**.
