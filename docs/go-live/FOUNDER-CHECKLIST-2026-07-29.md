# Founder checklist — after the 2026-07-29 campaign

Everything an agent could do is done and verified. What is left needs either your credentials, your
decision, or a physical device. Ordered by how long the outside world takes to respond.

Good news first: three things this list used to contain are already done — `platform_admins` has
your row, the Stripe and RevenueCat secrets are set, and prod is at migration 0161 with all 38 edge
functions deployed.

---

## 1. Longest lead time — start these today

**App Store submission.** `eas.json` submit config is ready (`ascAppId 6787705639`), the listing copy
is written (`docs/marketing/aso-listing.md`), and build 24 is on TestFlight. Two blockers:

- **Host the legal pages.** `docs/legal/public/{privacy,terms}.html` are authored but need your
  entity name, address and date filled in, then hosting at `onstandard.app/privacy` and `/terms`.
  Apple will not review without them.
- **Answer the App Store privacy questions.** Draft answers are in `APP-STORE-SETUP.md`. Note
  `app.json` currently declares `NSPrivacyCollectedDataTypes: []` while the app collects photos,
  location and health-adjacent data — worth a careful look before you submit, because an inaccurate
  declaration is a rejection you wait a week to discover.

**Play Console.** Android can now be built (`eas build --platform android --profile production`) —
the missing `android.package` was the only thing preventing it. Still needed from you: the Play app
itself, a service-account JSON for `eas submit`, and a Google OAuth **Android** client id. Details
and the exact `eas.json` block are in `docs/go-live/ANDROID.md`.

**Consumer IAP products.** Six auto-renewable products in App Store Connect / Play Console whose ids
match `CONSUMER_PRODUCTS`, then a RevenueCat offering. The webhook function is already deployed and
its secret is already set — this is the only remaining half.

---

## 2. Decisions only you can make

**Pick pilot athletes for the three staged features.** All three are live in the database and
deliberately doing nothing until you name someone:

```sql
update feature_flags set enabled_user_ids = array['<uuid>','<uuid>']::uuid[]
 where name = 'verified_commitments';   -- also: rollcall_lockscreen, connected_standards
-- flip default_on = true when you want it global
```

Worth knowing: `verified_commitments` was found **globally on** and was staged down to pilots-only.
That was safe rather than a regression because `commitments` had 0 rows — the feature was live and
had never been used by anyone.

**Turn winback on when you have real users.** `winback` is deployed, scheduled daily, and fails
closed, so today it does nothing. Verified against real production data in dry-run mode: it would
have selected 4 lapsed athletes, correctly staged. It sends at most two messages in a lifetime.
Turn it on with `update feature_flags set default_on = true where name = 'winback';` — but not
before there are real people to win back, because the current 4 are test accounts.

**Grant Founding 50 slots.** The promise is now enforceable (see `FOUNDING-50.md`). Granting is
service_role-only and deliberately manual, matching the mailto CTA on the site:

```sql
select * from claim_founding_slot('<uuid>', '', 1000, 'Requested via support@ on <date>');
select founding_slots_taken();
```

**Switch Stripe from test to live keys** when you are ready to charge. The code needs no change:
prices resolve by `lookup_key`, and all eight billing functions now fail closed with an honest 503
instead of crashing when a secret is missing.

---

## 3. Needs a physical device

None of this can be exercised on Windows, in jest, or in the Simulator.

- **Lock-screen roll call**: ack while backgrounded (iOS and Android), ack after force-quit, the
  offline queue draining, the L2 time-sensitive push breaking through Focus, the L3 coach digest
  arriving once with correct names, and the Apple Watch mirrored ack. Checklist in
  `ROLLCALL-LOCKSCREEN.md`.
- **Geofenced arrival** for Verified Commitments.
- **HealthKit / Health Connect**: still the single remaining piece of Connected Standards.
  Everything else in that feature works with manual logging and no native code.
- **A sandbox purchase**, once the store products exist.

### Why IAP and HealthKit were not implemented in this pass

Both need a native module added to `package.json`. Doing that puts JavaScript referencing native
code into OTA range of **build 24, which does not contain it** — the same class of failure as the
ITMS-90863 launch crash this project already shipped once, where an ABI mismatch killed the app at
launch with no server-side kill switch.

The seams are deliberately correct as they stand: neither `react-native-purchases` nor
`react-native-health` is in the import graph, `isIapAvailable` and `isHealthAvailable` are false, and
every call returns an honest `unavailable` rather than a dead button. `src/lib/iap/index.ts` and
`src/lib/health/index.ts` each carry the exact calls to write, and both are one file plus a config
plugin. They should land together, on a branch, with **one** new native build (25) — never over OTA.

---

## 4. Two small things

- `select schedule_weekly_digest(...)` had never been run, so the weekly digest was deployed but
  never fired. It is scheduled now (Sundays 22:00 UTC) — that means real digest pushes will begin
  going out. If you do not want that yet: `select cron.unschedule('weekly-digest');`
- `DIGEST_CRON_KEY` was rotated to schedule it. Nothing else used the old value.

---

## Rollback handles

| Layer | How |
|---|---|
| OTA | `eas update:republish` group `a19f655b-9310-4adb-833c-99a550ab558a` (the pre-ship update) |
| Code | tags `ship-2026-07-29-pre` (old master) and `ship-2026-07-29` |
| Any flagged feature | `update feature_flags set kill_switch = true where name = '<flag>'` — beats every allowlist, takes effect in seconds |
| Meal thread caps | the pre-0157 trigger definition was captured before applying; ask the agent for `rollback-0157-restore-0059-caps.sql` |
