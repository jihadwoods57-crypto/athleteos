# Roll call v3 spike: can a push arm the alarm?

**Status: NOT RUN YET.** Fill in every blank below on the phone, then set the verdict line. Until the
verdict says PASS, `rollcall_push_arming` stays OFF (plan 2026-09-24, Task 1 step 13).

The one question: can the Notification Service Extension (`targets/NotificationService`) schedule
AlarmKit alarms on iOS 26.1+ while OnStandard is not running, including after a force-quit, once
alarms are authorized?

| Field | Value |
|---|---|
| Date | |
| Build number | |
| iOS version | |
| Phone model | |
| Signed-in athlete | |
| Expo push token used | |

## Before you start

1. The spike build is installed from TestFlight.
2. Signed in as an athlete. Notifications are allowed.
3. Alarms are allowed for OnStandard (the roll-call Continue on `#roll-call/<id>`, or
   Settings > OnStandard > Alarms).
4. Find the phone's push token (read-only query):
   `supabase db query --linked "select t.token, t.platform, t.updated_at from device_tokens t join auth.users u on u.id = t.user_id where u.email = '<athlete email>' order by t.updated_at desc"`
5. Check the push without sending it:
   `node scripts/rollcall-nse-spike.mjs --token "<token>" --dry-run`

Every real send prints a ticket, then a receipt about 20 seconds later. Both must say `ok`, or the
row below tells you nothing about the extension.

## The six rows

| # | Do | Pass looks like | Banner text seen (literal) | Pass/Fail |
|---|---|---|---|---|
| 1 | Force-quit OnStandard (swipe it away). Run `node scripts/rollcall-nse-spike.mjs --token "<token>" --in 3`. | Banner body reads `SPIKE 1/1 armed · cancelled 0 · auth authorized`. | | |
| 2 | Lock the phone and wait 3 minutes. | The full-screen alarm rings with title "Spike roll call" and the "I’m Up" button. | | |
| 3 | Press "I’m Up". | OnStandard opens ON the team board for the spike instance (`#rollcall-board/<spike id>`). Opening anywhere else is a FAIL: it means the tap was not recorded in the app. | | |
| 3b | Run the spike again (`--in 3`), let it ring, and press the system Stop instead. Then open OnStandard. | The app drains a check-in for that spike id on open (the board or a check-in toast for it). Nothing recorded is a FAIL. | | |
| 4 | Run again with `--in 10`, then within a minute run `--cancel <printed id>` with the app still force-quit. | Second banner reads `SPIKE 0/0 armed · cancelled 1 · auth authorized`; no alarm rings at +10. | | |
| 5 | Reboot the phone, force-quit OnStandard, repeat rows 1 and 2. | Same as rows 1 and 2. | | |
| 6 | Settings > OnStandard > Alarms OFF, repeat row 1. | Banner reads `SPIKE 0/1 armed · … · auth denied`, no alarm. | | |

## If a row does not look like the table

- Body unchanged ("Open OnStandard to set your alarm."): the extension did not run. Check that the
  IPA has `PlugIns/NotificationService.appex`, and that the ticket AND the receipt both say ok.
- `SPIKE ran, no rc found · keys …`: the extension ran, but Expo nested `data` under a key
  `RollCallArmPlan.find` does not read. Add that key, rebuild.
- `auth notDetermined` while the app says alarms are allowed: AlarmKit permission is not shared with
  extensions. That is a FAIL.
- A suffix after `auth …` (an error message): AlarmKit refused to schedule from the extension. That
  is a FAIL; copy the message here word for word.

## Verdict

- **PASS** = rows 1 to 4 pass (5 and 6 recorded either way). Task 13 step 9 turns
  `rollcall_push_arming` on.
- **FAIL** = any of rows 1 to 4 fails. The flag stays OFF and the extension stays in the binary as a
  pass-through.

Verdict: _pending_


## Result (2026-09-24, build 48, founder iPhone, iOS 27.0)

Row 1 banner, literal: `SPIKE 0/1 armed · cancelled 0 · auth notDetermined`. The extension ran with the app force-quit and rewrote the banner, but AlarmKit authorization is per bundle: the app was authorized (it armed the Oct 1 roll call that morning) while the extension saw notDetermined and cannot ask (no UI). No alarm rang.

**Verdict: FAIL** for arming from the push. `rollcall_push_arming` stays OFF; v3 ships on the fallback path.
