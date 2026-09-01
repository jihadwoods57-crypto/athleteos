# Go-live — lock-screen roll call

One-tap "I'm Up" from the lock screen: a signed code, a public edge function, and an escalation
ladder that gets louder when an athlete stays silent. No app open required to answer.

## Migrations

- `0144_rollcall_ack.sql` — `ack_commitment_by_token` (service-role only, keyed by the athlete the
  signed code already proved instead of `auth.uid()`), plus the extended
  `claim_due_commitment_reminders` that hands back the action label and deadline the reminder fn
  needs to mint a code.
- `0145_commitment_escalation.sql` — `commitments.escalation` (per-commitment opt-in jsonb,
  default `{}` so nothing escalates until a coach turns it on), `claim_missed_commitments` (marks
  deadline-crossed pending responses `missed` in the same statement it claims them, so two
  overlapping cron ticks can't double-fire a rung), and `rollcall_digest` (the L3 "who's up" push
  builder).

Both are authored and statically reviewed, not applied to live yet.

```bash
supabase db push          # 0144, 0145
npm run test:rls
```

## Secret

```bash
supabase secrets set ROLLCALL_ACK_SECRET=<64+ random chars>
```

`commitment-reminders` mints the signed code with this secret; `roll-call-ack` verifies it. Reuse
the existing `COMMITMENT_CRON_KEY` for `commitment-escalation` — it doesn't need a new secret.

## Deploy

```bash
supabase functions deploy roll-call-ack --use-api --no-verify-jwt
supabase functions deploy commitment-reminders --use-api --no-verify-jwt   # re-deploy for the code mint
supabase functions deploy commitment-escalation --use-api --no-verify-jwt
```

Schedule `commitment-escalation` every 5 minutes, the same cadence `commitment-reminders` already
runs on:

```sql
select schedule_commitment_escalation(
  'https://<project>.supabase.co/functions/v1/commitment-escalation', '<COMMITMENT_CRON_KEY>');
```

> This step used to say `schedule_commitment_reminders` with the escalation URL. Do not do that.
> That function (0140) hardcodes `jobname = 'commitment-reminders'` and unschedules it before
> rescheduling, so the second call replaces the reminder job rather than adding the ladder — and
> the result is inverted and silent: reminders stop, while the ladder that exists only to chase
> people who ignored a reminder keeps running. `cron.job` still shows one healthy row.
> `schedule_commitment_escalation` (0159) owns its own job name. Both should appear in `cron.job`.

`roll-call-ack` takes no JWT by design — the signed code in the request body is the credential, not
a Supabase session. `commitment-escalation` is protected by the `x-commitment-key` header instead,
compared in constant time, matching `commitment-reminders`.

## Flag

Insert the `feature_flags` row by hand. No migration seeds it:

```sql
insert into feature_flags (name, default_on, enabled_user_ids, kill_switch)
values ('rollcall_lockscreen', false, array['<founder-uuid>', '<pilot-athlete-uuid>', ...], false);
```

Until that row exists, both `roll-call-ack` and `commitment-escalation` **fail open** — acks are
recorded and the ladder runs as if the flag were on. This is deliberate (it matches 0141's
convention elsewhere in the commitments system) but it means the feature is live the moment the
code deploys, not the moment the flag row is inserted. Insert the row before deploying if a staged
rollout matters, not after.

Once the row exists, `default_on` / `enabled_user_ids` stage the WHOLE ladder per athlete:

- `roll-call-ack` gates per athlete the normal way — a non-enabled athlete's ack returns `flag_off`
  and records nothing.
- `commitment-escalation` now honors the same staging. With `default_on = false`, only the athletes
  in `enabled_user_ids` are eligible to be marked `missed` (the cron passes them as `p_only` to
  `claim_missed_commitments`), so the missed-marking and both L2/L3 pushes reach only the pilot. Flip
  `default_on = true` and the whole ladder goes global in one switch — that is the single flag flip a
  full rollout needs. A missing flag row means global on deploy (fail open, see above).

`kill_switch = true` stops both paths instantly regardless of the staging:

- `roll-call-ack` returns `flag_off` and records nothing.
- `commitment-escalation` returns `{ skipped: 'flag off' }` and neither marks anything `missed` nor
  sends L2/L3 pushes.

```sql
-- stop everything, instantly, for every client version in the field
update feature_flags set kill_switch = true where name = 'rollcall_lockscreen';
```

## Escalation ladder

Runs on `commitment-escalation`, right behind `commitment-reminders`:

- **Claim** — `claim_missed_commitments` marks deadline-crossed, still-pending responses `missed`.
  This is the only automated writer into `missed`; everything else in the commitments system either
  reads it or writes `unverified`/manual corrections.
- **L2 breakthrough** — one time-sensitive push per missed athlete whose commitment opted in
  (`escalation.breakthrough`). iOS `interruptionLevel: 'time-sensitive'` lets it break through a
  Focus mode or notification summary. The athlete's own Do Not Disturb still wins.
- **L3 coach digest** — one "who's up" push per opted-in instance (`escalation.notify_coach_on_miss`),
  built from `rollcall_digest` so the coach never counts replies by hand. Sent once per instance per
  ladder pass, with counts and non-responder names.
- **L4 guardian — deferred.** `escalation.notify_guardian_on_miss` exists in the config shape and
  defaults off, but no guardian rung is built yet. It ships once the founder confirms the default
  and the guardianship link.

`escalation` defaults to `{}` on every commitment, so nothing escalates until a coach explicitly
turns a rung on for that commitment.

## Device QA checklist (cannot be exercised on Windows/jest)

- [ ] iOS backgrounded: tap "I'm Up" on the lock screen, ack recorded within seconds, notification
      updates to the confirmation.
- [ ] Android backgrounded: same.
- [ ] iOS force-quit: tap defers to next open (documented expectation, not a bug).
- [ ] Offline at tap: confirmation shows immediately; ack lands after reconnect (queue drains on
      foreground).
- [ ] L2 time-sensitive push breaks through a Focus mode; the phone's own Do Not Disturb still wins.
- [ ] L3 coach digest arrives once per instance with correct counts and names.
- [ ] Apple Watch (paired, phone nearby): mirrored "I'm Up" records; relays when the phone is in
      another room.

## Verification at time of writing

Doc only, no code in this task. See the migrations and edge functions above for the tests already
covering the claim/ack/digest logic (`logic.test.ts` in each edge function directory, `test:rls`
for the SQL functions).

## The COACH half — "Got it" / "Nudge them" (2026-08-26, migration 0209)

Until this shipped, a roll call cost the athlete one tap and the coach a phone unlock plus three
screens. The L3 digest could be *read* from the lock screen but not *acted on*, which put the most
work on the busiest person in the loop. Two actions now ride on the digest notification itself, and
neither opens the app:

- **"Got it"** → `coach_digest_seen`. Marks that coach's escalation rows for that instance read, so
  the app is not still badging a roll call they have already handled. Idempotent — pressing twice
  clears nothing the second time and is not an error.
- **"Nudge them"** → `rollcall_nudge_claim` + a push to each athlete still out. **The nudge is
  itself one-tap-answerable**: each push carries a freshly minted *athlete* code and the same
  notification category the original reminder used, so the athlete answers it from their own lock
  screen. A nudge that only said "open the app" would push the cost back onto the person asleep.

### Who may act, and how it is proved

`commitment-escalation` mints one **coach code** per recipient at digest time (`signCoachCode`,
`_shared/rollcall-code.ts`) and puts it on the push as `data.coach_code`. The device posts it to the
public `roll-call-coach` function, which verifies it and spends it.

Coach codes and athlete codes share `ROLLCALL_ACK_SECRET` but are **different kinds**, and every
verify names the kind it expects. This matters more than it looks: an athlete legitimately holds a
valid code for the very instance their coach is running, so without the kind claim that athlete's
own "I'm Up" code would be a working credential for "Nudge them" — the power to buzz every
teammate's phone, handed to exactly the population the feature points at. A code with the wrong kind
is `bad_kind` (401), never a silent pass.

The code proves **who**, never **what they may do**. `rollcall_nudge_claim` re-derives staff
membership from its `p_coach` argument at spend time, so a coach removed from the team between the
5:02 digest and the 5:04 tap is refused.

### The nudge rate limit

One nudge per **instance** per 10 minutes, claimed atomically (`commitment_instances.last_nudge_at`).
Per instance and not per coach on purpose: two assistant coaches nudging the same roll call is the
same spam to the athlete, and the athlete is who the limit protects. It matters because the lock
screen gives the coach **no feedback at all** — an `opensAppToForeground:false` action just dismisses
the notification — so a coach who presses and sees nothing happen will press again.

### Deploy order (this one bites)

`commitment-escalation` starts stamping `categoryId` + `coach_code` on the digest the moment it is
deployed. If `roll-call-coach` is not up yet, the buttons are drawn and do nothing when pressed —
the device gets a 404, treats it as terminal, and drops it. So:

1. `supabase db push` (or apply `0209_rollcall_coach_actions.sql`) — the RPCs must exist first.
2. `supabase functions deploy roll-call-coach --use-api --no-verify-jwt`
3. `supabase functions deploy commitment-escalation --use-api --no-verify-jwt` — **last**.

`ROLLCALL_ACK_SECRET` is already set (the athlete ack uses it); no new secret is required. If it is
somehow absent, the digest still sends — just without buttons, never without the digest.

Ship the OTA (`assets/proto.zip`) too: the in-app "Remind N missing" button on the coach board now
routes through `roll-call-coach`, and the escalation bell row's deep link changed (below).

### Two bugs fixed on the way in

- **The coach's digest deep-linked into a screen coaches cannot open.** Both the push and the bell
  row pointed at `roll-call/<instance>`, which is the *athlete* detail screen. `router.js`'s mirror
  guard bounces a known coach off any athlete-nav screen back to their dashboard, dropping the
  instance id — so the one deep link this whole escalation existed to deliver landed a coach
  nowhere. Both now point at `coach-commitments/<instance>`.
- **"Remind N missing" never reached a sleeping athlete, and after the deadline reached nobody at
  all.** `remind_missing` (0138) only ever INSERTed bell rows — it cannot push, and a bell read at
  noon is not a reminder for a 5 AM roll call. It also filtered `status = 'pending'`, but the
  escalation ladder marks everyone `missed` at the deadline, which is the same moment the coach
  looks at the board — so from the deadline onward it matched zero rows, returned 0, and the UI
  said "Couldn't send. Try again". The button now goes through `roll-call-coach` (which writes the
  rows AND pushes), keeps the RPC as a deploy-order fallback, and the RPC's filter is repaired in
  0209. The button also stops reporting a rate limit or a refusal as a failure.

### Device QA checklist (cannot be exercised on Windows/jest)

- [ ] Coach, phone locked: the digest arrives with **Got it** and **Nudge them** visible.
- [ ] Press **Got it** — app is NOT opened; the escalation shows read in the bell next time the
      coach opens the app.
- [ ] Press **Nudge them** — app is NOT opened; only the athletes still out receive a push, and
      anyone who already answered receives nothing.
- [ ] The nudge push, on the athlete's lock screen, **itself carries the "I'm Up" button** and
      acking from it records the response.
- [ ] Press **Nudge them** twice inside 10 minutes — the second press sends nothing (verify from
      the athlete's device, since the coach's phone shows nothing either way).
- [ ] Press **Nudge them** with the coach offline — it lands after reconnect, or is dropped if the
      code has expired. Never a duplicate push.
- [ ] TAP the digest body (not a button) — lands on the coach's own board for that roll call, not
      on the athlete screen and not bounced to the dashboard.
- [ ] In-app: "Remind N missing" on the coach board sends a real push, and says "Just reminded.
      Give it a few minutes" rather than "Couldn't send" when the cooldown is live.

### Deployed 2026-08-26 — and what actually verified it

**Everything below is DONE in production**, in the order above: 0209 applied (via
`supabase db query --linked --file`, then `supabase migration repair --status applied 0209`),
then `roll-call-coach`, `commitment-reminders`, `commitment-escalation` last. OTA published to the
`production` branch (update group `eefeea2e-49c2-46cb-b2b6-2e0d3ad638e1`, runtime 1.0.0) and
**proven**: the live manifest's zip asset matches the md5 AND sha256 of the exact `assets/proto.zip`
bytes that were content-checked, on iOS and Android both.

`ROLLCALL_ACK_SECRET` and `COMMITMENT_CRON_KEY` were already set in prod — no new secret.

**No native build is required.** The category registration and the action handler live in the JS
bundle (`src/proto/ProtoApp.tsx`, `src/lib/notify/rollcall.ts`), and
`setNotificationCategoryAsync` is part of `expo-notifications`, already in the shipped binary. The
OTA reaches build #26 and #27 alike.

Prod was at **0 commitments and 0 commitment_instances** when this landed, so replacing
`remind_missing` and adding `last_nudge_at` could not disturb anything in flight.

#### How it was verified without Docker

This machine has neither Docker nor psql, so a **disposable Supabase project** stood in for a local
stack — the [[athleteos-test-project]] pattern. Recipe, because it is worth repeating:

1. `supabase projects create` (nano, same region) → `supabase link` → `supabase db push --include-all`.
   All 209 migrations applied clean, **0209 included** — that alone proves the SQL parses and every
   object creates.
2. Run SQL suites over a **session-mode** connection (`pg`, port **5432**, NOT the 6543 transaction
   pooler, which serves a stale catalog for freshly-created functions). TLS verifies properly
   against Supabase's published CA (`prod-ca-2021.crt`) — there is no need to disable certificate
   checking, and you should not.
3. Deploy the functions to that project and exercise them over real HTTP.
4. Delete the project via the Management API (`DELETE /v1/projects/{ref}`; the CLI's own delete
   wants a TTY) and **re-link prod**.

#### What the verification actually covered

- **`npm run verify`** — 12/12 gates. `deno check` clean on all four touched functions.
- **`rls_authz_test.sql`** — **25/25** new `rc-coach:` checks green against a real Postgres: the
  grants (an athlete cannot execute any of the three functions, which matters because
  `rollcall_nudge_claim` takes the coach id as an *argument*), the staff check, per-instance and
  per-coach isolation of "seen", nudge targeting, the cooldown, and the cancelled-instance case.
- **End-to-end over HTTP against a deployed `roll-call-coach`** — 16/16, codes minted from the real
  shared module rather than a hand-reimplementation. Proven live: an **athlete's own valid code is
  refused with `bad_kind`**; a correctly-signed coach code for a non-staff user gets
  `not_authorized`; a tampered signature and an expired code are refused; "Got it" clears exactly
  one row and is idempotent; a nudge targets only the athlete still out and writes **nothing** for
  the one who answered; the second nudge inside the cooldown is refused and writes no second row;
  and acting on the digest marks it seen.
- **Cron smoke** — 7/7. `commitment-escalation` still runs, claims the deadline-crossed response,
  takes the L3 digest branch (the one that mints the coach code) and writes the coach's durable row;
  `commitment-reminders` still runs after the shared-category refactor; both refuse a caller
  without the cron key.
- **Prod endpoint probes** after deploy, using only invalid credentials (rejected before any write):
  405 / `bad_action` / `malformed` / `bad_sig` all correct, both cron functions 401 without the key,
  and `roll-call-ack` — the athlete's pre-existing path — still alive and unregressed.

One check went red on the first real run and it was the most important one: *"the athlete who
already answered is NOT pinged again."* The product was right; the **test** was wrong. It inherited
an ack performed 1,400 lines earlier that an intervening section resets. Fixed in `ae549b4` by
having the section declare its own preconditions.

#### ⚠ Still owed: device QA

**The checklist above has NOT been run.** It cannot be automated from here — it needs a person
holding an iPhone, receiving a real push, and pressing a button on the lock screen. Everything the
server does is proven; what is unproven is purely the on-device presentation: that iOS draws the two
buttons, that `opensAppToForeground:false` really keeps the app closed, and that the nudge's own
"I'm Up" button renders on the athlete's lock screen.

#### ⚠ Unrelated pre-existing failure found while running the suite

`rls_authz_test.sql` is **red on master** with 4 failures in the 0103 weight/nutritionist section
(`weight_series returns ZERO rows to the nutritionist`, the two nutritionist weight-target checks,
and `athletic trainer reads base_weight and the weight target`). Confirmed pre-existing: the same
four fail on `HEAD~1` with the roll-call section absent. Not investigated — different feature area.
Per this runner's own history, a suite that is normally red is how coverage silently rots, so this
is worth someone's attention.

---

## OTA ship log · 2026-09-01 (evening)

Update group `7466798c-a801-41cf-8b24-42b4ca01f05e`, branch `production`, runtime 1.0.0,
android + ios. Commit `e5a92112` (master).

Proven the same way as the 2026-08-26 group: the local `assets/proto.zip` hashes match the
live manifest's single `application/zip` asset on BOTH platforms.

| | |
|---|---|
| local md5 / manifest `key` | `bca23f980923b675e0624f56b9621aa2` |
| local sha256 (base64url) / manifest `hash` | `xJ02xQs68TVErRi2wbh6V8cL8t9fUrdXsXL0iqTwxWc` |
| iOS update id | `01a05f66-6ab1-7785-b042-fd5e01d6481f` |
| Android update id | `01a05f66-6ab1-77a1-9db3-a0f9d5dea031` |

The zip was also content-checked (13 assertions over the strings each change introduces or
removes) before and after the merge rebuild, so the matching bytes are demonstrably the
bytes carrying the edits.

**Publishing works from the founder's Windows checkout.** The `EXPO_TOKEN` that reads as
"bearer token is invalid" is the one in the CLOUD sandbox; `npx eas update` locally
authenticates as `jihadwoods` and publishes. A cloud session finding the token dead should
hand the publish to a PC session, not park the release.

**Merge note for any proto change:** `assets/proto.zip` and `src/proto/protoVersion.ts` are
generated, so they conflict on every merge that touches the proto. Resolve by re-running
`node scripts/build-proto-zip.mjs` on the merged tree — never by taking one side.
