-- OnStandard — the COACH half of the lock-screen roll call (2026-08-26).
--
-- WHY THIS EXISTS
-- The athlete has been able to answer roll call from the lock screen since 0144: one press, no app
-- launch. The coach never could. When the L3 digest fired at 5:02 AM ("3 of 12 aren't up"), the only
-- thing the coach could do with it was read it — every action lived behind unlocking the phone,
-- opening the app, finding the board. That asymmetry defeated the point of the feature: the whole
-- design premise is that a roll call costs one tap on BOTH ends.
--
-- Two coach actions now ride on the digest notification itself:
--   "Got it"     -> coach_digest_seen        — clears the escalation from their feed. Nothing else.
--   "Nudge them" -> rollcall_nudge_claim     — re-pings ONLY the athletes still not up.
--
-- Neither opens the app. Both are authorized by an HMAC coach code (a distinct code kind, see
-- _shared/rollcall-code.ts) that the escalation function mints at digest time, so there is no
-- session — exactly like the athlete's ack. Because the edge function calls these with the service
-- role, auth.uid() is null inside them and the actor is passed EXPLICITLY as p_coach. That is why
-- every function below re-derives authorization from p_coach rather than trusting the caller.
--
-- Migration numbering: 0208 was the last applied (geofence presence). GUARDRAIL: authored only.

-- ---------------------------------------------------------------- nudge rate limit
-- One column, because a coach holding a phone at 5 AM will press "Nudge them" more than once when
-- nothing visibly happens (the action does not open the app, so there is NO feedback on the device
-- — see the note in roll-call-coach/index.ts). Without a server-side floor, three impatient presses
-- are three pushes to a 16-year-old who is already awake and driving. The limit lives on the
-- INSTANCE, not per coach: two assistant coaches nudging the same roll call is the same spam to the
-- athlete, and the athlete is who the limit protects.
alter table commitment_instances add column if not exists last_nudge_at timestamptz;

-- ---------------------------------------------------------------- rollcall_coach_authorized
-- Is this user a coach on this instance? DELIBERATELY the same union rollcall_digest (0145) uses to
-- decide who receives the digest, because this authorizes actions on the credential that digest
-- minted: if the two ever disagreed, we would either be minting codes that cannot be spent, or
-- honoring codes for someone no longer on staff.
--   TEAM     -> team_staff.staff_id where status = 'active'
--   PRACTICE -> practices.owner_id  (the single operator is_practice_staff resolves to today)
-- Note this re-reads staff membership at SPEND time, not mint time. A coach removed from the team
-- between the 5:02 digest and the 5:04 tap is correctly refused.
create or replace function rollcall_coach_authorized(p_instance uuid, p_coach uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1
      from commitment_instances i
      join commitments c on c.id = i.commitment_id
     where i.id = p_instance
       and (
         (c.team_id is not null and exists (
            select 1 from team_staff ts
             where ts.team_id = c.team_id and ts.staff_id = p_coach and ts.status = 'active'))
         or
         (c.practice_id is not null and exists (
            select 1 from practices pr where pr.id = c.practice_id and pr.owner_id = p_coach))
       )
  );
$$;
revoke all on function rollcall_coach_authorized(uuid, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------- coach_digest_seen
-- "Got it": mark this coach's escalation rows for this instance read. Scoped to user_id = p_coach,
-- so even a forged p_coach could only ever mark that user's OWN feed read — there is no reachable
-- state where this touches another person's data. Returns how many rows it cleared, which is 0 on
-- a second press (the action is idempotent, and the retry queue on the device WILL press twice).
--
-- The kind carries the instance id as a suffix (0145 writes `commitment_escalation:<uuid>`), which
-- is what makes a per-instance "seen" possible at all; matching is exact, never a LIKE, so one
-- roll call's dismissal can never clear another's.
create or replace function coach_digest_seen(p_instance uuid, p_coach uuid)
returns integer language plpgsql security definer set search_path = public as $$
declare v_n integer;
begin
  update notifications
     set read_at = now()
   where user_id = p_coach
     and kind = 'commitment_escalation:' || p_instance::text
     and read_at is null;
  get diagnostics v_n = row_count;
  return coalesce(v_n, 0);
end $$;
revoke all on function coach_digest_seen(uuid, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------- rollcall_nudge_claim
-- "Nudge them": authorize, rate-limit, and return the still-missing athletes in ONE statement.
--
-- The rate limit is a conditional UPDATE ... RETURNING, not a SELECT-then-UPDATE, so two coaches
-- pressing simultaneously cannot both pass the check — exactly the claim pattern
-- claim_due_commitment_reminders uses to keep two cron ticks from double-sending. The loser is told
-- 'rate_limited' and sends nothing.
--
-- WHO GETS NUDGED: responses where acknowledged_at is null and status is 'pending' OR 'missed'.
-- 'missed' MUST be included — the escalation function marks rows missed at the deadline BEFORE it
-- sends the coach the digest, so by the time the coach can press "Nudge them" every athlete they
-- are trying to reach is already 'missed'. A pending-only filter returns zero rows every time and
-- the button does nothing, silently; that was remind_missing's bug since 0138, repaired at the
-- bottom of this file. The acknowledged_at guard is what actually keeps anyone who answered from
-- being pinged.
--
-- Returns jsonb rather than a rowset so a refusal carries its REASON. An edge function that got
-- back an empty set could not tell "not your team" from "everyone is already up", and those two
-- must not look alike to the coach.
create or replace function rollcall_nudge_claim(
  p_instance uuid, p_coach uuid, p_cooldown_min int default 10
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_claimed boolean := false;
  v_title text;
  v_label text;
  v_deadline timestamptz;
  v_targets uuid[];
begin
  if not rollcall_coach_authorized(p_instance, p_coach) then
    return jsonb_build_object('ok', false, 'reason', 'not_authorized');
  end if;

  -- Atomic cooldown claim. `greatest(1, ...)` keeps a misconfigured 0 from disabling the floor.
  update commitment_instances i
     set last_nudge_at = now()
   where i.id = p_instance
     and i.status = 'scheduled'
     and (i.last_nudge_at is null
          or i.last_nudge_at < now() - make_interval(mins => greatest(1, p_cooldown_min)))
  returning true into v_claimed;

  if not coalesce(v_claimed, false) then
    -- Distinguish "too soon" from "this instance is cancelled/gone": the first is a wait, the
    -- second is a dead notification, and a coach deserves different words for each.
    if exists (select 1 from commitment_instances where id = p_instance and status = 'scheduled') then
      return jsonb_build_object('ok', false, 'reason', 'rate_limited');
    end if;
    return jsonb_build_object('ok', false, 'reason', 'no_instance');
  end if;

  select coalesce(c.title, 'Roll call'), c.action_label, i.respond_by_at
    into v_title, v_label, v_deadline
    from commitment_instances i join commitments c on c.id = i.commitment_id
   where i.id = p_instance;

  select coalesce(array_agg(r.athlete_id), array[]::uuid[])
    into v_targets
    from commitment_responses r
   where r.instance_id = p_instance
     and r.acknowledged_at is null
     and r.status in ('pending', 'missed');

  -- The durable record first, same rule the reminder path follows: a push that never lands must
  -- not mean the athlete has no idea their coach chased them. Written even when the push later
  -- fails, and skipped entirely when there is nobody to write it for.
  if array_length(v_targets, 1) is not null then
    insert into notifications (user_id, kind, title, body)
    select t, 'commitment_reminder', v_title, 'Your coach is still waiting on your response.'
      from unnest(v_targets) t;
  end if;

  return jsonb_build_object(
    'ok', true,
    'title', v_title,
    'action_label', v_label,
    'respond_by_at', v_deadline,
    'athlete_ids', to_jsonb(coalesce(v_targets, array[]::uuid[]))
  );
end $$;
revoke all on function rollcall_nudge_claim(uuid, uuid, int) from public, anon, authenticated;

-- ---------------------------------------------------------------- remind_missing (0138) repair
-- The in-app "Remind N missing" button now goes through roll-call-coach (which actually PUSHES —
-- this RPC only ever wrote bell rows, and a bell the athlete reads at noon is not a reminder for a
-- 5 AM roll call). It survives as the client's fallback for the window where the proto ships ahead
-- of the function's deploy, so the bug below still has to go.
--
-- THE BUG: it matched `status = 'pending'` only. commitment-escalation marks every non-responder
-- 'missed' the moment the deadline passes — which is the same moment the coach looks at the board
-- and presses the button. So from the deadline onward this matched zero rows, returned 0, and the
-- UI said "Couldn't send. Try again". It has been telling coaches their reminder failed when it had
-- simply been aimed at a status nobody was in any more.
--
-- acknowledged_at is null is what actually protects the athletes who answered; status is only ever
-- a description of how they got there.
create or replace function remind_missing(p_instance uuid) returns integer
language plpgsql security definer set search_path = public as $$
declare v_ok boolean; v_title text; v_n integer;
begin
  select commitment_owner_is_staff(c.team_id, c.practice_id), c.title into v_ok, v_title
    from commitment_instances i join commitments c on c.id = i.commitment_id
   where i.id = p_instance;
  if not coalesce(v_ok, false) then raise exception 'not authorized'; end if;

  insert into notifications (user_id, kind, title, body)
  select r.athlete_id, 'commitment_reminder', coalesce(v_title, 'Roll call'),
         'Your coach is still waiting on your response.'
    from commitment_responses r
   where r.instance_id = p_instance
     and r.acknowledged_at is null
     and r.status in ('pending', 'missed');
  get diagnostics v_n = row_count;
  return coalesce(v_n, 0);
end $$;
