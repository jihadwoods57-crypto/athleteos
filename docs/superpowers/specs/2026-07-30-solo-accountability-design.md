# Solo Accountability — a fitness client with no trainer

**Date:** 2026-07-30
**Status:** design approved, not implemented
**Builds on:** `2026-07-22-verified-commitments-design.md`, `2026-07-23-lockscreen-rollcall-design.md`

## The problem

A fitness client signs up, and OnStandard already asks them the right question. `ob2-client.js`
step `trainer-status` offers **"Never worked with one — the AI holds the line until you do"**, and
the trainer-code step is skippable with honest copy: *"No trainer? Skip — the AI holds the line,
and you can connect one any time from Profile."*

Almost everything downstream works for that person. Their goal drives the scoring profile and
targets instead of a coach's (`state.js` `nutritionConfigForGoal`), `stdFromSolo` lets them set
their own meal standard, `planStyleRoleFor()` resolves to `'solo'` — "an independent adult chooses
freely" — and the daily 0–100 score, AI meal review, training log, Connected Standards, and the
Individual plan all run coach-free.

But the strongest accountability machinery in the product is unreachable for them. Verified
Commitments — the roll call, the lock-screen "I'm Up", geofence arrival, the escalation ladder,
and the whole Morning Readiness screen — hangs off rows owned by a `team_id` or a `practice_id`.
A solo user has neither. `accountability.js` therefore renders its empty state forever, and its own
copy admits the shape of the hole: *"When a roll call, a lift, or a study hall is scheduled **for
you**"* — by someone who does not exist.

## The decision

**The solo user is their own witness.** They schedule their own commitments the way a coach
schedules a team's, and the existing machinery holds them to it. We are not inventing a human
witness (an invited friend or spouse), a peer cohort, or a pretend one. If nobody is watching, the
product says so and still keeps an honest record.

This was chosen over three alternatives:

- **Invite a human witness** — truest to the product's "one witness" spine and the strongest
  accountability available, but it is a new relationship type, a new invite flow, and a new privacy
  surface, and it depends on a second person continuing to care. Worth revisiting later; it layers
  cleanly on top of this work rather than competing with it.
- **Sharpen the AI into the witness** — cheapest, but an AI that cannot be disappointed is weaker
  accountability than a person, and it leaves the roll-call machinery unused.
- **Peer cohort** — highest ceiling, largest build, and carries moderation, matching, and
  abandonment risk that nothing else here does.

## Approach: a third owner column

`commitments` and `commitment_locations` carry the 0136 dual-owner pattern: nullable `team_id` +
`practice_id` with `num_nonnulls(…) = 1`, and every RLS policy funnels through one predicate,
`commitment_owner_is_staff(p_team, p_practice)`. Because that funnel exists, adding a third kind of
owner is a small, contained change.

Two alternatives were rejected:

- **A "practice of one"** — auto-create a `practices` row where the user is their own trainer. Zero
  schema change and everything lights up instantly, but it plants a falsehood in the data model:
  the user would count as a trainer in billing, in the Command Center census, and in the Pro Solo
  tier logic that keys off practices. Free today, expensive in three months.
- **A separate `self_commitments` table** — conceptually clean, but it duplicates the instance,
  response, verification, and geofence machinery, which is the most subtle code in the feature, and
  guarantees the two copies drift.

## Schema — migration 0165

Add to both `commitments` and `commitment_locations`:

```sql
self_user_id uuid references profiles(id) on delete cascade
```

Relax both one-owner checks:

```sql
check (num_nonnulls(team_id, practice_id, self_user_id) = 1)
```

Add partial indexes mirroring the existing `cm_team` / `cm_practice` and `cl_team` / `cl_practice`
pairs:

```sql
create index if not exists cm_self on commitments (self_user_id, active) where self_user_id is not null;
create index if not exists cl_self on commitment_locations (self_user_id) where self_user_id is not null;
```

### The owner predicate

Postgres cannot `create or replace` a function with a different argument list, and adding a
defaulted third argument alongside the existing 2-arg version produces an ambiguous-call error at
every existing call site. So: drop the 2-arg function, create a 3-arg replacement, and update its
call sites.

Rename it in the same pass. A function named `commitment_owner_is_staff` that returns true for
someone who is explicitly *not* staff is a quiet lie in a security-definer predicate — exactly the
kind that costs an afternoon later.

```sql
drop function if exists commitment_owner_is_staff(uuid, uuid);

create or replace function commitment_owner_can_manage(p_team uuid, p_practice uuid, p_self uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select (p_team is not null and is_team_staff(p_team))
      or (p_practice is not null and is_practice_staff(p_practice))
      or (p_self is not null and p_self = auth.uid());
$$;
```

Call sites to update (all pass `self_user_id` as the third argument):

| File | Location |
|---|---|
| `0138_verified_commitments.sql` | `instance_owner_is_staff`, policies `cl_read` / `cm_read`, `upsert_commitment`, `ensure_commitment_instances`, `staff_set_response`, `remind_missing` |
| `0140_commitment_reliability.sql` | lines ~39, ~133 |
| `0141_commitment_production.sql` | lines ~71, ~235 (`commitment_board`) |
| `0153_commitment_locations_insert.sql` | the insert `with check` |

Every row in that table is a **mechanical** 3-argument update — passing `self_user_id` through
changes no behaviour on its own. Where a call site also needs a behavioural change, it is called
out explicitly in the RPC and Integrity sections below (`upsert_commitment`, `staff_set_response`).
`commitment_board` and `remind_missing` appear here for the argument change only.

The rename means the old name must not survive anywhere; the migration greps clean before it lands.

## RPC changes

**`upsert_commitment(p jsonb)`** — accept `self_user_id`. When it is set, the server *forces*
`audience_kind = 'athlete'` and `audience_value = auth.uid()` rather than trusting the client, and
rejects `team` / `room` / `group` audiences outright. A book of one has exactly one audience. The
`team_staff` role check is skipped on this branch — there is no roster to hold a role in.

**`ensure_my_commitment_instances(p_from, p_to)`** — **currently broken for solo and must be
fixed.** It loops `team_members`, then `practice_clients`. A solo user appears in neither, so their
card would never materialize and the feature would silently do nothing. Add a third branch that
materializes self-owned commitments directly.

**`commitment_audience`** — no change. Given the forced `audience_kind = 'athlete'` above, the
existing branch returns the owner and nothing else.

**`my_commitments`**, **`ack_commitment`** — no change. Both are already scoped to `auth.uid()`.

**`commitment_board`**, **`remind_missing`** — no change. These are coach surfaces; a solo user has
no board and nobody to remind.

## Escalation

The `escalation` jsonb (0145) already carries per-commitment opt-ins. For self-owned rows:

- `breakthrough` (the L2 time-sensitive "window is closing" push to the athlete) **is** the whole
  ladder, and it already works — L2 targets the athlete directly, not a coach.
- `notify_coach_on_miss` is meaningless and is ignored. L3 no-ops naturally because
  `rollcall_digest` finds no owning coaches.
- `notify_guardian_on_miss` (L4) remains deferred, unchanged.

Self-created commitments default to `{"breakthrough": true}`. Someone who schedules their own 5 AM
roll call has already told you they want to be woken up.

## Integrity

Owning the book you are judged by opens two escape hatches that a coached athlete does not have.
Both are closed.

**No delete.** `commitments → commitment_instances → commitment_responses` cascades on delete, so
deleting a commitment erases every miss ever recorded against it. Self-owners may set
`active = false` or an `ends_on` date; the delete path is blocked for self-owned rows in
`upsert_commitment` and there is no self-owned delete RPC. Past instances and responses survive.
This matches what a coached athlete lives with.

**No self-excuse.** `staff_set_response` stays closed to self-owners — the predicate change must
not accidentally open it, so this function keeps an explicit `self_user_id is null` guard rather
than relying on `commitment_owner_can_manage`. If an owner could excuse their own miss, "excused"
becomes a self-serve undo button and the Accountability number means nothing.

Genuine failures are already handled without a self-excuse: `unverified` covers a dead phone, a
revoked permission, weak GPS indoors, or a session moved elsewhere, and unverified rows leave the
denominator rather than counting as failures. A real sick day counts as a miss, because it was one.

Unchanged and still true for solo:

- The server stamps every timestamp. A client-supplied "I woke at 4:48" is not a verification.
- Editing a schedule never rewrites history — instances are dated snapshots.
- No coordinate is ever persisted for the athlete. Geofence comparison stays on-device and reports
  a boolean.
- **Nothing here touches the daily 0–100 score.** Verified Commitments keeps producing its own
  Accountability number, exactly as it does for a coached athlete.

## Client

**New solo composer screen.** A trimmed version of the coach composer: title, type, repeat days,
start time, respond-by, optional location + geofence, breakthrough toggle. No audience picker —
the audience is the author.

**`accountability.js`** — the `S.coach.hasCoach` branches gain a third case. The empty state flips
from *"When a roll call, a lift, or a study hall is scheduled for you"* to *"you scheduled"*, and
gains a create button where a coach's composer would be. The headline copy at line 54
(*"across every commitment your coach scheduled"*) needs the same treatment.

**`commitment-data.js`** — add the self-owner write path alongside the existing team/practice
branches, keyed on `self_user_id` rather than the `kind === 'practice' ? 'practice_id' : 'team_id'`
column switch used throughout.

**Entry points** — the Accountability screen's empty state, and Progress.

## Upgrade path

When a solo user later connects a trainer, their self-owned commitments keep working and sit
alongside the trainer's rather than fighting them. The trainer cannot edit or excuse a self-owned
commitment (`commitment_owner_can_manage` returns false for them on those rows), and the user
cannot excuse a trainer-owned one. Both books feed one Accountability number. No migration of
existing rows, and no moment where the user loses their record.

## Testing

- Extend `supabase/tests/verified_commitments_test.sql`: a solo user can create, read, and pause
  their own commitment; cannot delete it; cannot call `staff_set_response` on their own response;
  cannot see or touch another solo user's rows; a trainer cannot manage a client's self-owned
  commitment and vice versa.
- Confirm `ensure_my_commitment_instances` materializes for a user with no team and no practice.
- Confirm the daily 0–100 score is byte-identical before and after — `scripts/score-parity`.
- Per the table-grants gotcha: test a real write, not just an RLS predicate.

## Out of scope

Inviting a human witness, peer cohorts, and any change to the AI's voice or nudge cadence. Each is
a separate spec that layers on top of this one.
