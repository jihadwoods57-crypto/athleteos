# Go-live — Wake-Up Roll Call (2026-09-01)

The coach's morning group text turned into a measurable roll call. Coach sets a time, a grace
period, the days, who, and an optional morning message. Athletes get a lock-screen push in the
coach's name with one button. The server stamps the tap and decides On Standard / Late / Missed.
The coach watches it live and pings whoever is still out.

It is **not a new subsystem**: a Wake-Up Roll Call is a `commitments` row of type
`morning_roll_call` (0138). The lock-screen ack (0144), the escalation ladder (0145/0146) and the
coach's lock-screen actions (0209) are all reused unchanged. Migration `0211_wakeup_rollcall.sql`
adds what was missing. Read `ROLLCALL-LOCKSCREEN.md` first for the mechanism.

## Migration

`supabase/migrations/0211_wakeup_rollcall.sql`. Authored + statically reviewed; **not applied to
live here**. Probe for the objects before trusting `db push --dry-run` (migration history has
drifted before, see `geofence-presence-gap-2026-08-23`).

```bash
supabase db push            # 0211
npm run verify:full         # adds the SQL authorization suite (needs a db with the migrations)
```

What it changes:

| What | Where |
|---|---|
| Verdict, pure | `rollcall_verdict(status, acknowledged_at, deadline_at, now)` → `excused / on_standard / late / pending / missed`. Mirrored in `proto js/commitments.js rollcallVerdict()`. |
| Windows, pure | `commitment_opens_at(...)`, `rollcall_closes_at(...)` (wake-up with no `ends_min` closes 120 min after its deadline), `rollcall_late_min(...)`. |
| Ack windows enforced | `ack_commitment` and `ack_commitment_by_token` refuse before open (`not open yet`) and after close (`closed`); first tap still stands forever. |
| Response source | `commitment_responses.ack_source` = `app` / `lockscreen` / `staff`. |
| Delivery metadata | `commitment_responses.first_notified_at` (never a compliance input). |
| Message length | `commitments.message` and `commitment_instances.message_override` 200 → 1000 chars. |
| Schedule honesty | `resync_commitment_instances()` runs inside `upsert_commitment`: not-yet-started occurrences are re-timed, cancelled (day removed / paused) or re-scheduled; their pending reminders reset. |
| Cron materialization | `materialize_active_commitments()` (service role) creates today + tomorrow per commitment in its own zone. `commitment-reminders` calls it every tick. |
| Per-athlete ping | `rollcall_nudge_claim(..., p_athlete)` with its own cooldown on `commitment_responses.last_nudge_at`. |
| Today's message | `set_instance_message(instance, text)` writes `message_override` (staff only). |
| Coach summary | `rollcall_summary(commitment, days)` → per-occurrence verdict counts. |
| Reads | `my_commitments` + `commitment_board` gain `verdict`, `late_min`, `ack_source`, `closes_at`, `opens_at`, `grace_min`, `last_nudge_at`, `coach_name`, `standing_message`, `message_override`, `occurs_on`. Every pre-0211 key is preserved. |
| Claims | `claim_due_commitment_reminders` returns `type, message, coach_name, starts_at, closes_at, fires_at, timezone`; `claim_missed_commitments` returns `type, action_label, respond_by_at, closes_at`. Both dropped + recreated (return type change). |
| Crons | Both schedulers now install `* * * * *`; a `do` block moves already-installed jobs with `cron.alter_job`. If the notice says it could not, re-run `schedule_commitment_reminders(...)` and `schedule_commitment_escalation(...)`. |
| Scoring | `accountability_raw` gains `wake_on_standard`, `wake_late`, `wake_missed` COUNTS. `earned`/`possible` unchanged. |

## Deploy

```bash
supabase functions deploy commitment-reminders --use-api --no-verify-jwt
supabase functions deploy commitment-escalation --use-api --no-verify-jwt
supabase functions deploy roll-call-coach --use-api --no-verify-jwt
# roll-call-ack is unchanged; the RPC it calls now enforces the window.
```

Order: **migration first**, then functions (the functions read columns the migration adds), then
the OTA (`npm run verify`, `node scripts/build-proto-zip.mjs`, commit `assets/proto.zip` +
`src/proto/protoVersion.ts`, `eas update --branch production`, prove per
`verify-ota-carries-proto`).

No new secret. `ROLLCALL_ACK_SECRET` and `COMMITMENT_CRON_KEY` already exist in prod.
No native build: the "Check in now" category and the Android `rollcall` channel are registered
from JS (`expo-notifications`), so the OTA reaches build #26 and #27 alike.

## How a morning runs

1. **Cron, every minute.** `commitment-reminders` materializes today + tomorrow, then claims
   reminder rungs. A wake-up is created by the composer with `reminder_offsets_min = [grace, ~40%
   of grace]`, so it fires AT the time and once mid-grace.
2. **6:00 push, the coach's voice.** Title = the coach's name, subtitle = `Wake-Up Roll Call ·
   6:00 AM`, body = the morning message, whole, never rewritten. iOS shows a few lines collapsed
   and the rest on long-press; Android expands it. No message → title = the roll call, body =
   `Check in by 6:05 AM.` Never invented words in the coach's name. Button = the coach's action
   label (default "I'm Up"), `opensAppToForeground:false`. The signed code lasts until the roll
   call closes.
3. **6:03 push, OnStandard's voice.** `Roll call is waiting` / `You haven't checked in yet. 2
   minutes remaining.` Same button.
4. **6:05, the deadline.** `commitment-escalation` marks non-responders `missed` and, when
   `escalation.breakthrough` is on (the composer's default), sends the time-sensitive `You're late`
   / `You haven't answered Wake-Up Roll Call. Your coach can see your status.` with a **Check in
   now** button and a code that lasts until close. `notify_coach_on_miss` (also default) sends
   the coach the digest with Got it / Nudge them.
5. **Any tap**, lock screen or in app, goes through the same two RPCs: server time, first tap
   wins, refused outside the window, verdict from the timestamps.
6. **Close** (deadline + 2 h by default, or the coach's setting): no more answers. Unanswered =
   Missed, forever. The board shows the complete summary.

## Coach UX

- Create menu → **Wake-Up Roll Call** → `#coach-wakeup-edit` (`screens/coach-wakeup.js`):
  time, grace (None / 2 / 5 / 10 / 15), days, who (team / room / group), morning message with
  three presets, one "More options" fold (title, button label, late window, escalation switches,
  the zone the times are in). The preview line under the form says exactly what will happen.
- Manage (`#coach-commit-manage`): wake-ups edit in their own composer; everything else in the
  general one. The Wake-Up button leads.
- Board (`#coach-commitments/<instance>`): `47 / 52 checked in`, the three stats, the status line
  (open / grace ended / closed), **Your message today** (change for today only, or back to the
  standing message), **Ping N pending** (roster-wide, 10-min cooldown per instance), groups
  Pending-or-Missed / Late / On Standard / Excused with **Ping** per row (10-min cooldown per
  athlete), the complete summary once closed, and **History**: the last 14 occurrences, tap any
  to open that day's board.
- Coach Home card: `47 of 52 up · 5 pending` / `2 late`.
- Coach lock screen: unchanged (0209).

## Athlete UX

- Home card, open: eyebrow WAKE-UP ROLL CALL, the coach's name and the time, the message, the one
  button. Late-open: a red **YOU'RE LATE** card with **Check in now**. Answered: `Checked in at
  6:01 AM` / `On Standard`, or amber `Late · 6 min`. Closed unanswered: red `Missed`.
- Detail (`#roll-call/<instance>`): the coach's note, signed; the state card (Not open yet / Roll
  call is open + I'M UP / You're late + Check in now / Checked in with the verdict / Missed); a
  named refusal if the server said `not open yet` or `closed`; the **lock-screen check-in is off**
  warning when this phone has no push token; the dispute path on Late and Missed.
- Progress → Morning Readiness: **Wake-Up Standard** list (`Today · 6:01 AM · On Standard`,
  `Yesterday · 6:09 AM · 9 min late · Late`), newest first.
- Lock screen: I'm Up on the 6:00 and 6:03 pushes, Check in now on the 6:05 push. Tapping the
  body opens the roll call, not Home.

## Security

- Athletes: `ack_commitment` keys on `auth.uid()`; the lock-screen path keys on the athlete
  inside the signed code. No update grant exists on `commitment_responses`. Timestamps are
  server-stamped and the first stands (both RPCs return the existing one and write nothing).
- Coaches: `rollcall_summary`, `set_instance_message` gate on `commitment_owner_is_staff`;
  `rollcall_nudge_claim` re-derives `rollcall_coach_authorized(p_instance, p_coach)` at spend
  time; the per-athlete path refuses an athlete who already answered.
- Service-role-only (revoked from authenticated): `materialize_commitment`,
  `materialize_active_commitments`, `resync_commitment_instances`, both claims, both nudge
  functions, `ack_commitment_by_token`.
- Probes: `supabase/tests/rls_authz_test.sql`, section "wake-up roll call (0211)".

## Scoring: the decision that is still the founder's

`accountability_raw` counts a late answer as a full wake response (10 points), exactly as before
0211. The new `wake_late` / `wake_missed` counts are exposed so the day a late wake-up should cost
something, the change is one `case` inside `accountability_raw` (and its mirror `accountability()`
in `proto js/commitments.js`), nowhere else. The daily 0–100 is untouched and unaffected.

## Platform limits (unchanged, stated)

- No Critical Alert entitlement. Nothing here overrides Silent Mode or a Focus that blocks
  OnStandard. `time-sensitive` is requested on the late push; the phone decides.
- iOS draws action buttons only for categories registered on a PRIOR launch. Both athlete
  categories (`RC::im-up`, `RC::check-in-now`) register every launch.
- iOS force-quit: the button still records (the action runs without the app); a tap on the body
  opens the app to the roll call.
- Android: pushes name the `rollcall` channel (importance MAX, sound). A user who silences that
  channel silences roll calls; the in-app warning only knows about a missing token.
- The proto (WebView) cannot show a real lock-screen notification; the in-app state is the
  fallback and counts identically.

## Device QA (cannot be exercised on Windows/jest)

- [ ] 6:00 push arrives in the coach's name with the message; long-press shows the whole message.
- [ ] "I'm Up" from the lock screen records On Standard without opening the app; the board
      updates within a second.
- [ ] 6:03 push arrives as "Roll call is waiting"; its button also records.
- [ ] After the grace: "You're late" arrives with **Check in now**; tapping records Late · N min.
- [ ] Coach digest arrives with Got it / Nudge them (0209 QA).
- [ ] Ping on one row reaches only that athlete, with a working button; a second Ping within 10
      minutes says "Just pinged".
- [ ] After close, Check in now on an old push is refused and the app shows Missed.
- [ ] Android: the push rides the "Roll call" channel with sound.
- [ ] Notifications off: the athlete detail screen shows the warning before the time.

## Second pass, 2026-09-02 (migration 0212): the clock, provenance, review, live board

Founder review of the first pass. What changed and why, in the order that mattered.

### The lock-screen action is the product

- **Registration.** Every action this app registers (`I'M UP`, `CHECK IN NOW`, and the coach's
  `Got it` / `Nudge them`) carries `opensAppToForeground: false` (`ACTION_OPTIONS` in
  `src/core/rollcall.ts`, asserted by jest). Acknowledging never launches OnStandard visually.
  Button titles are upper-cased at registration; category ids stay slug-derived, so nothing on
  the server changed.
- **One router.** `routeNotificationResponse()` (`src/core/rollcall.ts`, jest-tested) turns any
  notification response into `ack` / `coach` / `route` / nothing. The live listener, the cold-start
  replay and the Android background task all call it. An action returns before any deep link.
- **iOS.** An action on a category registered on a prior launch is delivered by the system with
  the app background-launched if needed; expo-notifications replays it to the listener on delegate
  attach (`NotificationCenterManager.swift`), and `getLastNotificationResponseAsync` covers a cold
  start. Works with the app backgrounded or killed. Not proven on a device from this machine.
- **Android.** A custom action pressed outside the foreground runs the `expo-task-manager` task
  registered with `Notifications.registerTaskAsync` (`ExpoHandlingDelegate.handleNotificationResponse`
  → `runTaskManagerTasks`). This app now registers `onstandard-rollcall-action`
  (`src/lib/notify/rollcall.ts`), so a killed app records the tap. Before 0212 the tap waited for
  the next launch. `expo-task-manager` was already linked (the geofence task), so this reaches
  builds #26/#27 over the air. Not proven on a device from this machine.
- **Both platforms:** no Critical Alert entitlement; the phone's Do Not Disturb still wins. A
  notification the user swipes away is gone; the app shows the same state at the same time.

### The three lock-screen states (copy verbatim from `logic.ts`, jest-pinned)

| When | Title | Body | Button |
|---|---|---|---|
| 6:00 INITIAL | `Coach D'Onofrio · Wake-Up Roll Call` | the morning message | I'M UP |
| 6:03 REMINDER | `Wake-Up Roll Call` | `You haven't checked in yet. 2 minutes remaining.` | I'M UP |
| 6:05 LATE | `You're Late` | `Wake-Up Roll Call is still waiting on you.` | CHECK IN NOW |

The title carries both names on one line so Android (no subtitle) reads the same as iOS. The push
BODY is capped at 1,200 UTF-8 bytes on a word boundary (`pushBody`, jest-tested with 1,000 emoji);
the bell row and the app keep the whole 1,000-character message. Long-message rendering (iOS
collapsed vs long-press, Android BigText) is device QA.

### The clock

| Instant | Column | Default |
|---|---|---|
| OPEN | `starts_at` (composer writes `opens_min = starts_min`) | 6:00. Refused before ("not open yet"); card shows "Opens at 6:00" for the last 15 minutes. |
| GRACE | `respond_by_at` | 6:05. At or before = On Standard. After = Late, minutes rounded up. |
| CLOSE | `ends_at` | 6:30 (`starts + 30`, More options: 15/30/45/60). Inclusive. After it: refused, Missed, final. |

`rollcall_verdict(status, ack_at, deadline, closes_at, now, source, review, resolution)` →
`excused | review | on_standard | late | pending | missed`, mirrored in `commitments.js`. Unanswered
between grace and close is `pending` with the UI sub-state "Still out" (coach) / "You're late,
check in now" (athlete). Boundary probes (SQL + node): 5:59:59 refused · 6:00 on standard · 6:05:00
on standard · 6:05:01 late 1 min · 6:11 late 6 min · 6:30:00 accepted (late 25) · 6:30:01 refused,
missed.

### Provenance and the audit trail

`commitment_responses.ack_source`: `lockscreen` · `app` · `override` (coach, needs a reason, stored
in `correction_note` with `corrected_by/at`) · `review_accepted`. An override reads On Standard by
decision and is labelled COACH OVERRIDE everywhere; the header counts athlete taps separately
("4 / 7 accounted for · 2 checked in · 1 coach override · 1 excused"); `rollcall_summary` reports
`checked_in`, `overrides`, `accepted`, `review`. `commitment_response_audit` is append-only
(ack, override, excuse, review_opened, review_resolved, correction) and readable by the athlete and
the owning staff.

### Offline taps: review, not trust and not punishment

The device sends `tapped_at` (the queue's `queuedAt`) with the code. The server stores it as
`device_tapped_at` only if `code.iat <= tapped_at <= now()` and keeps `acknowledged_at` (receipt)
as the verdict's input. If the receipt crossed grace or close but the plausible device time did
not, the row is `sync_review = true`, verdict `review`: it counts as nothing (dropped from earned
AND possible) until a coach resolves it with `resolve_sync_review`: **Accept tap time** (→ On
Standard, `review_accepted`), **Keep late**, **Keep missed**. Reviewer, time, note, both stamps and
the audit rows are kept; a resolution is never overwritten. After-close replays with no plausible
evidence stay refused.

### Live board

`commitment_responses` joined the `supabase_realtime` publication (0172 pattern). The board
subscribes per instance (`subscribeBoard`), the athlete detail per athlete (`subscribeMine`), with
a poll floor (8 s open, 30 s with the socket up, 60 s closed) and a `visibilitychange` refetch.
Proven on a disposable project: coach subscribed, service-role lock-screen ack, UPDATE event in
752 ms. Escalation for an athlete stops by construction (claims key on `acknowledged_at`; probed).

### Deploy (0212)

```bash
supabase db push                                         # 0212
supabase functions deploy commitment-reminders --use-api --no-verify-jwt
supabase functions deploy commitment-escalation --use-api --no-verify-jwt
supabase functions deploy roll-call-ack --use-api --no-verify-jwt   # tapped_at + code iat
supabase functions deploy roll-call-coach --use-api --no-verify-jwt
# then the OTA, and prove the manifest on both platforms
```

## Third pass, 2026-09-02 (migration 0215): manage the next one, schedule the week

(Authored as 0214; renumbered to 0215 because a concurrent commit had already taken 0214 for
team_activity_batch. Prod history carries it as 0215.)

Founder: "as a coach I need to easily manage the next morning roll call, or even have it
scheduled out." Before this the roll call was one standing rule and a board for today; the only
per-day control was today's message.

### What a coach can now do
- **Home** shows the **next roll call** once today's has closed (or when there is none today):
  day, time, who gets it, the message, with **Change** (opens that day's board) and **Skip**
  (two taps: the first arms it, the second sends it).
- **The board has a day strip**: Today, Tomorrow, then the week. A struck-through chip is a
  skipped day; a dot marks a day the coach moved.
- **A day ahead is a setup screen, not a roster**: "Scheduled", the schedule card (a time picker
  for that day only, Skip this day / Put it back, "Moved by Coach X · reason"), the message for
  that day, and a collapsed "Who gets it".
- The standing rule is never touched by any of this, and editing the rule keeps the per-day
  changes (a skipped day stays skipped; a moved day keeps its time).

### The server (0215)
- `commitment_instances` gains `starts_override_min`, `skipped`, `schedule_set_by`,
  `schedule_set_at`.
- `set_instance_schedule(p_instance, p_starts_min, p_reset_time, p_skipped, p_note)` (staff of the
  owning book; refused once the occurrence has started). Re-times the DAY keeping the rule's
  grace and close deltas through `_rc_time_instance`, resets pending reminder offsets, and clears
  Live Activity tokens on a skip. A skipped day is `status = 'cancelled'` + `skipped = true`, so
  every cron, verdict and athlete card already treats it as called off.
- `rollcall_upcoming(p_commitment, p_days)` materializes the next N days on the way in and returns
  them with the day's effective minute, the rule's minute, the message, the note and who set it.
- `commitment_board` and `my_commitments` now report `starts_min` / `respond_by_min` as the DAY's
  effective minutes (plus `rule_starts_min`), so "At 6:30 AM" on the athlete card and the local
  reminder anchor follow a moved day without a client change.
- `resync_commitment_instances` keeps `skipped` days cancelled and re-times a moved day from its
  own minute.

### Deploy (0215)
1. `supabase db push --linked` (probe: `select to_regprocedure('set_instance_schedule(uuid,smallint,boolean,boolean,text)')`).
2. No edge function changes. OTA the proto (`assets/proto.zip`), prove md5 + sha256 on the live
   manifest for both platforms.
3. RLS: 27 new `0215:` probes in `rls_authz_test.sql` (702/702 on a disposable project).

### Device QA still owed
- Move tomorrow to 6:30 from the board, confirm the athlete's card says 6:30 and the 6:30 push
  arrives with the 6:35 grace.
- Skip tomorrow, confirm no push and no card; put it back, confirm it returns.
