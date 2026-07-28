# Verified Commitments — go-live

**Branch:** `feat/founder-command-center` · **Spec:** [`docs/superpowers/specs/2026-07-22-verified-commitments-design.md`](../superpowers/specs/2026-07-22-verified-commitments-design.md)

Coaches verify that athletes **acknowledge**, **arrive for**, and **complete** scheduled
responsibilities — without counting replies in a group chat and without tracking anyone.

---

## What ships when

| Slice | Contents | Needs |
|---|---|---|
| **1 — Morning Roll Call** | migration 0138, athlete card + detail, coach board + roster + composer, reminders, Accountability / Morning Readiness, Verified Discipline aggregate | `supabase db push` + an **OTA update**. No App Store review. |
| **2 — Arrival verification** | migration 0139, `expo-location`, geofence manager, `LOCATION_*` bridge, consent explainer | `supabase db push` + a **new native build**. Cannot ship OTA. |
| **3 — Widget** | `ios-widget/` | Authored, **not enabled**, never compiled. Mac only — see [`ios-widget/README.md`](../../ios-widget/README.md). |

Slice 1 is useful on its own: a coach gets verified wake-ups the day it lands.

## Apply

```bash
supabase db push          # 0138, 0139, 0140, 0141
npm run test:rls          # expect 382/382

# Server-side reminders (0140). Without this, reminders only reach athletes whose
# device has no push token — the client plan is a fallback, not the primary path.
supabase secrets set COMMITMENT_CRON_KEY=<long random string>
supabase functions deploy commitment-reminders --use-api --no-verify-jwt
supabase db query --linked "select schedule_commitment_reminders(
  'https://<project>.supabase.co/functions/v1/commitment-reminders', '<the same key>');"
```

All four migrations are forward-only and idempotent. 0138 creates every table; 0139 adds arrival
behaviour; 0140 is the reliability pass (server reminders, range excuse, roster reconciliation); 0141 is
the production pass (server-side kill switch, herd guard, hot-path indexes).
`0137` was taken by a concurrent change (`0137_practice_rollups`) — that is why these start at
0138.

**The cron runs every 5 minutes.** Reminder offsets are minute-grained, so a coarser tick would
drift a "5 minutes left" warning past the deadline it is warning about. Claiming and marking happen
in one statement, so two overlapping ticks cannot double-send — there is an RLS probe for exactly
that, because a duplicate 4:45 AM alarm is the kind of bug that gets an app deleted.

## App Store review note (slice 2)

Apple will ask why the app requests **Always** location. The honest answer, which matches what the
code actually does:

> OnStandard confirms that athletes arrived at practices and other commitments their coach
> scheduled. The app registers a geofence around a single coach-specified location, only during
> that event's scheduled window, and removes it when the window closes. Between events no region
> is monitored. The app stores only whether the athlete arrived and at what time — no coordinates
> are transmitted or stored, and there is no movement history. Athletes who decline background
> location check in with a button instead, so the feature is fully usable without it.

Every clause is enforced in code, not policy: `my_armable_geofences` (0139) will not return an
instance outside its window, `verify_arrival` takes a boolean rather than a position, and no table
in the feature has a coordinate column for an athlete.

## The kill switch

`feature_flags.verified_commitments` (0141) is checked by the **server**, inside the read,
materialize and reminder paths. It is not a client flag a stale app can ignore and not an env var
needing a rebuild.

```sql
-- stop everything, instantly, for every client version in the field
update feature_flags set kill_switch = true where name = 'verified_commitments';

-- staged rollout: pilot team only
update feature_flags set default_on = false,
       enabled_user_ids = array['<athlete-uuid>'::uuid, ...]
 where name = 'verified_commitments';
```

With it off: athlete cards go quiet, the coach board empties, nothing materializes, no coach can
schedule, and — the one that matters at 4:45 AM — **no reminder is claimed, so no push goes out.**
Flipping it back restores everything on the next load. There are RLS probes for each of those.

Existing records are never deleted by the switch. Turning it off hides the feature; it does not
erase what athletes already earned.

## Founder switches

- **Who can schedule** — head coach, coordinator, S&C, team admin (`CREATE_CAPS` in
  `staff-access.js`, mirrored by the role check inside `upsert_commitment`). Position coaches see
  their room's board but cannot schedule. **Open call:** athletic trainers and nutritionists cannot
  schedule either, though rehab and nutrition appointments are plainly their work. Widening this
  means editing both places in step.
- **Institutional consent** — an athletic director can assert a program already holds parental
  consent, which satisfies the gate team-wide and writes an `admin_audit_log` row naming them.
  There is no UI for this yet; it is `grant_verification_consent(athlete, 'institutional', team,
  note)`.
- **Recruit profile** — off for every athlete until they turn it on themselves, in Settings →
  Verified Discipline profile.

## Behaviour worth knowing before support calls

- **Reminders break quiet hours.** Default quiet hours are 22:00–07:00, so a 4:45 AM roll call
  would otherwise be silently swallowed. Commitment reminders are exempt from quiet hours and from
  the daily notification cap, and go **only** to athletes who have not responded. The phone's own
  Do Not Disturb still wins.
- **"Unverified" is not "missed".** A dead battery, revoked permission, weak GPS indoors or a moved
  session all read *"Couldn't verify"* and are removed from the accountability denominator rather
  than counted as failures. Only a coach can mark someone missed, and every correction is
  attributed.
- **A missed wake-up doesn't cascade.** Sleeping through roll call but arriving on time costs 10 of
  100 points, not the day.
- **iOS monitors at most 20 regions.** The app arms 16. An athlete with more concurrent located
  commitments than that falls back to tap-to-verify, and is told which ones.
- **The daily 0–100 score is untouched.** Accountability is a separate number, and the athlete's
  screen says so.

## Verification at time of writing

```
npm run lint:xss     clean
npm run typecheck    clean
npx jest             2407/2407 (201 suites)
npm run test:proto   green (44 new assertions)
npm run test:rls     382/382 (62 new probes)
```

Plus: the proto module graph resolves, and the proto boots headlessly in Chromium with no console
errors.

**Not verified anywhere:** the geofence itself. Region monitoring cannot be exercised on Windows,
in jest, or in a headless browser — it needs a device that can physically cross a boundary. The
pure selection logic (which events, how many, in what order) has 9 tests; the OS call it wraps has
none. Walk into a facility with a test build before trusting it in front of a team.
