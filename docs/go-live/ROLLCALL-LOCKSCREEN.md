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
select schedule_commitment_reminders(
  'https://<project>.supabase.co/functions/v1/commitment-escalation', '<COMMITMENT_CRON_KEY>');
```

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
