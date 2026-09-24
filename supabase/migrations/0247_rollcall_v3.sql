-- 0247: roll call v3, the coach assigns the alarm (2026-09-24)
--
-- Spec: docs/superpowers/specs/2026-09-24-roll-call-v3-alarm-first-design.md
--
-- 1. EACH ATHLETE'S STEP. For every upcoming morning the server now knows three things: the
--    assignment/change push went out (notified_at), the athlete opened the app or the assignment
--    card (seen_at), and the phone armed the alarm (alarm_armed_at, 0239). The coach's screen reads
--    them (rollcall_arming) as Alarm set, Seen but not set, Hasn't opened it, Notifications off,
--    Excused.
-- 2. THE NOTICE CLAIM. commitment-reminders runs claim_rollcall_notices every minute. It compares
--    what each athlete was last TOLD (notified_starts_at, notified_cancelled) with the schedule now
--    and returns one row per morning that needs saying: assigned (never told about this roll call),
--    moved, cancelled, extend (new days coming into range with no alarm yet), or silent (settle
--    without a push). It locks and marks what it returns (FOR UPDATE SKIP LOCKED, then
--    notice_claimed_at, re-checked in the UPDATE) so two ticks cannot both send.
--    settle_rollcall_notices records what was settled, or releases it for the next tick, and only
--    for a claim it still owns (the row's claimed_at must match). SETTLED IS NOT TOLD: the claim's
--    bookkeeping (notice_settled_at, notified_starts_at, notified_cancelled) is written for every
--    settled row, but notified_at, the coach's "told", is stamped only for rows the sender says a
--    push actually went out for ({ sent: true }). A silent row or an athlete with no device token
--    is settled and still reads "Hasn't been told".
-- 3. A MOVED MORNING FORGETS ITS ALARM. The phone armed it for the old time; alarm_armed_at is
--    cleared by trigger, so the start push is not muted for a phone that will ring at the wrong
--    time, and the coach does not see "Alarm set" for it.
-- 4. The server materializes wake-ups 14 days ahead (the arming horizon), the alarm primer is
--    recorded once per account, and rollcall_upcoming counts the alarms set.
-- 5. (Task 4 review) A REMIND NEVER CLOBBERS A PENDING NOTICE: a remind row settles only
--    notified_at, so a move said by nobody yet still goes out. An athlete never actually told about
--    the roll call hears "assigned" for whatever needs saying. The coach's "notify" and "remind" are
--    cooled down per ROLL CALL. "Can push" (the coach's "Notifications off") also honours the
--    athlete's own master switch, profiles.notifications_opt_out.
-- Every change is additive; no existing column changes shape.

-- ================================================================ 1. columns
alter table commitment_responses add column if not exists notified_at timestamptz;
alter table commitment_responses add column if not exists notified_starts_at timestamptz;
alter table commitment_responses add column if not exists notified_cancelled boolean;
alter table commitment_responses add column if not exists notice_claimed_at timestamptz;
alter table commitment_responses add column if not exists seen_at timestamptz;
alter table commitment_responses add column if not exists notice_settled_at timestamptz;
comment on column commitment_responses.notified_at is 'When an assignment or change push for this morning last actually went out (0247). Never stamped for a silent settle or an athlete with no device token.';
comment on column commitment_responses.notified_starts_at is 'The start time this morning was last settled at (0247). A different starts_at means it must be said again.';
comment on column commitment_responses.notified_cancelled is 'Whether this morning was last settled as off (0247).';
comment on column commitment_responses.notice_settled_at is 'When claim_rollcall_notices last settled this morning, pushed or not (0247). The claim''s bookkeeping; notified_at is what the coach reads.';
comment on column commitment_responses.notice_claimed_at is 'In-flight claim by claim_rollcall_notices; cleared by settle (0247).';
comment on column commitment_responses.seen_at is 'When the athlete opened the app or the assignment card for this roll call (0247).';

-- The remind cooldown is per roll call (Task 4 review), not per morning: an earlier draft of this
-- file put it on commitment_instances. Dropped so a re-run converges.
alter table commitment_instances drop column if exists arm_reminded_at;
alter table commitments add column if not exists arm_reminded_at timestamptz;
comment on column commitments.arm_reminded_at is 'Cooldown for the coach''s "Remind the N not set" (0247), per roll call.';
alter table commitments add column if not exists notify_claimed_at timestamptz;
comment on column commitments.notify_claimed_at is 'Cooldown for the coach''s in-app "notify" after Start or Save (0247), per roll call.';

alter table profiles add column if not exists alarm_primer_at timestamptz;
alter table profiles add column if not exists alarm_primer_answer text;
do $$ begin
  alter table profiles add constraint profiles_alarm_primer_answer_chk
    check (alarm_primer_answer is null or alarm_primer_answer in ('continue', 'not_now'));
exception when duplicate_object then null; end $$;

-- ================================================================ 2. a move forgets the alarm
create or replace function _rc_clear_stale_armed() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.starts_at is distinct from old.starts_at then
    update commitment_responses set alarm_armed_at = null
     where instance_id = new.id and alarm_armed_at is not null;
  end if;
  return null;
end $$;
revoke all on function _rc_clear_stale_armed() from public, anon, authenticated;
drop trigger if exists commitment_instances_clear_stale_armed on commitment_instances;
create trigger commitment_instances_clear_stale_armed
  after update of starts_at on commitment_instances
  for each row execute function _rc_clear_stale_armed();

-- ================================================================ 3. 14 days ahead
create or replace function materialize_rollcalls_ahead(p_days int default 14) returns integer
language plpgsql security definer set search_path = public as $$
declare c record; n integer := 0; v_today date; v_days int;
begin
  if exists (select 1 from feature_flags where name = 'verified_commitments' and kill_switch) then return 0; end if;
  if not pg_try_advisory_xact_lock(hashtext('vc:materialize-rollcalls-ahead')) then return 0; end if;
  v_days := least(greatest(coalesce(p_days, 14), 1), 14);
  for c in select id, timezone from commitments where active and type = 'morning_roll_call' loop
    v_today := (now() at time zone c.timezone)::date;
    n := n + materialize_commitment(c.id, v_today, v_today + v_days);
  end loop;
  return n;
end $$;

-- ONE roll call, for the coach's "notify" (Task 4 review): a Start or Save must not walk every
-- active roll call on the platform the way the cron's materialize_rollcalls_ahead does.
create or replace function materialize_rollcall_ahead_svc(p_commitment uuid, p_days int default 14) returns integer
language plpgsql security definer set search_path = public as $$
declare c commitments; v_today date;
begin
  if exists (select 1 from feature_flags where name = 'verified_commitments' and kill_switch) then return 0; end if;
  select * into c from commitments where id = p_commitment and active and type = 'morning_roll_call';
  if not found then return 0; end if;
  v_today := (now() at time zone c.timezone)::date;
  return materialize_commitment(c.id, v_today, v_today + least(greatest(coalesce(p_days, 14), 1), 14));
end $$;

-- ================================================================ 4. the notice claim
-- claimed_at joined the return shape during review; drop first so a re-run can change it.
drop function if exists claim_rollcall_notices(uuid, int);
drop function if exists rollcall_remind_rows_svc(uuid, uuid[]);

create or replace function claim_rollcall_notices(p_commitment uuid default null, p_limit int default 500)
returns table (
  response_id uuid, athlete_id uuid, commitment_id uuid, instance_id uuid, kind text,
  starts_at timestamptz, occurs_on date, was_starts_at timestamptz, off boolean, claimed_at timestamptz
)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
begin
  if exists (select 1 from feature_flags where name = 'verified_commitments' and kill_switch) then return; end if;
  return query
  with base as (
    -- SKIP LOCKED: a row another tick is claiming right now is left to it, never waited on and
    -- then claimed again. The UPDATE below re-checks the claim condition as well.
    select r.id as rid, r.athlete_id as aid, c.id as cid, i.id as iid, i.starts_at as st, i.occurs_on as od,
           (i.status = 'cancelled' or i.skipped) as is_off,
           r.notified_at as nat, r.notice_settled_at as sat,
           r.notified_starts_at as nst, coalesce(r.notified_cancelled, false) as ncan,
           r.alarm_armed_at as arm, i.schedule_set_at as sset
      from commitment_responses r
      join commitment_instances i on i.id = r.instance_id
      join commitments c on c.id = i.commitment_id
     where c.type = 'morning_roll_call'
       and c.active
       and (p_commitment is null or c.id = p_commitment)
       and r.status <> 'excused'
       and r.acknowledged_at is null
       and i.starts_at > now()
       and i.starts_at < now() + interval '14 days'
       and (r.notice_claimed_at is null or r.notice_claimed_at < now() - interval '2 minutes')
       and vc_enabled(r.athlete_id)
       for update of r skip locked
  ), kinded as (
    select b.*,
      case
        when b.is_off then
          case when b.ncan then null
               when b.nat is not null or b.arm is not null then 'cancelled'   -- was really told
               else 'silent' end
        -- Needs saying, and no push about this roll call ever actually reached them (an earlier
        -- one was refused, or they had no phone then): it is still news to them, so "assigned".
        when b.k0 is not null and not exists (
               select 1 from commitment_responses r2
                 join commitment_instances i2 on i2.id = r2.instance_id
                where i2.commitment_id = b.cid and r2.athlete_id = b.aid and r2.notified_at is not null)
          then 'assigned'
        else b.k0
      end as k
    from (
      select b0.*,
        case
          when b0.sat is null and b0.sset is not null then 'moved'   -- a morning the coach set by hand
          when b0.sat is null then 'new'
          when b0.nst is distinct from b0.st then 'moved'
          when b0.ncan then 'moved'                                  -- cancelled, then put back
          else null
        end as k0
      from base b0
    ) b
  ), due as (
    select k.* from kinded k
     where k.k is not null
       and (k.k <> 'new'
            or exists (select 1 from kinded o
                        where o.aid = k.aid and o.cid = k.cid
                          and (o.k in ('assigned', 'moved', 'cancelled')
                               or (o.k = 'new' and o.arm is null and o.st < now() + interval '3 days'))))
     order by k.st
     limit greatest(1, coalesce(p_limit, 500))
  ), claimed as (
    update commitment_responses r set notice_claimed_at = now()
      from due d
     where r.id = d.rid
       and (r.notice_claimed_at is null or r.notice_claimed_at < now() - interval '2 minutes')
    returning r.id, r.notice_claimed_at
  )
  select d.rid, d.aid, d.cid, d.iid, case when d.k = 'new' then 'extend' else d.k end,
         d.st, d.od, d.nst, d.is_off, cl.notice_claimed_at
    from due d join claimed cl on cl.id = d.rid;
end $$;

-- p_rows = [{ response_id, starts_at, off, claimed_at, sent, remind }].
--   p_notified true : settle. The claim's bookkeeping is written for every row; notified_at only
--                     where sent is true (a push really went out). sent defaults to false.
--   p_notified false: release the claim for the next tick.
-- Either way a row is touched only while its claim is still the caller's: claimed_at must match
-- notice_claimed_at to the millisecond (a JS Date round trip keeps milliseconds). A remind row has
-- no claim; its claimed_at is null and matches only a row with no claim in flight.
-- REMIND ROWS (remind: true, Task 4 review) settle ONLY notified_at, and only when sent, whatever
-- the claim is doing: a remind re-says the next morning, it does not say a pending move or
-- cancellation, so it must never write the bookkeeping that would mark those as said.
create or replace function settle_rollcall_notices(p_rows jsonb, p_notified boolean) returns integer
language plpgsql security definer set search_path = public as $$
declare n integer; m integer;
begin
  if p_notified then
    update commitment_responses r
       set notified_at = now()
      from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) x
     where r.id = (x->>'response_id')::uuid
       and coalesce((x->>'remind')::boolean, false)
       and coalesce((x->>'sent')::boolean, false);
    get diagnostics m = row_count;
    update commitment_responses r
       set notice_settled_at = now(),
           notified_at = case when coalesce((x->>'sent')::boolean, false) then now() else r.notified_at end,
           notified_starts_at = (x->>'starts_at')::timestamptz,
           notified_cancelled = coalesce((x->>'off')::boolean, false),
           notice_claimed_at = null
      from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) x
     where r.id = (x->>'response_id')::uuid
       and not coalesce((x->>'remind')::boolean, false)
       and date_trunc('milliseconds', r.notice_claimed_at)
           is not distinct from date_trunc('milliseconds', (x->>'claimed_at')::timestamptz);
    get diagnostics n = row_count;
    return n + m;
  else
    update commitment_responses r set notice_claimed_at = null
      from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) x
     where r.id = (x->>'response_id')::uuid
       and r.notice_claimed_at is not null
       and date_trunc('milliseconds', r.notice_claimed_at) = date_trunc('milliseconds', (x->>'claimed_at')::timestamptz);
  end if;
  get diagnostics n = row_count;
  return n;
end $$;

-- The coach's "Remind the N not set": every upcoming, unarmed morning of this roll call for these
-- athletes, shaped like a claim row so the same sender builds the push. Nothing while the roll
-- call is inactive or the kill switch is thrown.
create or replace function rollcall_remind_rows_svc(p_commitment uuid, p_athletes uuid[])
returns table (
  response_id uuid, athlete_id uuid, commitment_id uuid, instance_id uuid, kind text,
  starts_at timestamptz, occurs_on date, was_starts_at timestamptz, off boolean, claimed_at timestamptz
)
language sql stable security definer set search_path = public as $$
  select r.id, r.athlete_id, c.id, i.id, 'remind'::text, i.starts_at, i.occurs_on, r.notified_starts_at, false,
         null::timestamptz
    from commitment_responses r
    join commitment_instances i on i.id = r.instance_id
    join commitments c on c.id = i.commitment_id
   where c.id = p_commitment
     and c.active and c.type = 'morning_roll_call'
     and not exists (select 1 from feature_flags where name = 'verified_commitments' and kill_switch)
     and r.athlete_id = any(p_athletes)
     and r.status <> 'excused' and r.acknowledged_at is null and r.alarm_armed_at is null
     and vc_enabled(r.athlete_id)
     and i.status = 'scheduled' and not i.skipped
     and i.starts_at > now() and i.starts_at < now() + interval '14 days'
   order by i.starts_at;
$$;

create or replace function rollcall_instance_windows_svc(p_instances uuid[])
returns table (instance_id uuid, opens_at timestamptz, closes_at timestamptz, starts_at timestamptz)
language sql stable security definer set search_path = public as $$
  select i.id,
         rollcall_opens_at(c.type, i.starts_at, i.respond_by_at, c.starts_min, c.opens_min),
         rollcall_closes_at(c.type, i.respond_by_at, i.starts_at, i.ends_at),
         i.starts_at
    from commitment_instances i
    join commitments c on c.id = i.commitment_id
   where i.id = any(p_instances) and c.type = 'morning_roll_call';
$$;

create or replace function rollcall_notice_context_svc(p_commitments uuid[])
returns table (
  commitment_id uuid, title text, action_label text, coach_id uuid, coach_name text,
  repeat_days int[], starts_min int, timezone text, alarm boolean
)
language sql stable security definer set search_path = public as $$
  select c.id, c.title, c.action_label, c.created_by, p.full_name,
         c.repeat_days::int[], c.starts_min::int, c.timezone,
         coalesce((c.escalation ->> 'alarm')::boolean, true)
    from commitments c
    left join profiles p on p.id = c.created_by
   where c.id = any(p_commitments);
$$;

-- ================================================================ 5. coach actions
create or replace function rollcall_commitment_coach_authorized(p_commitment uuid, p_coach uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from commitments c
     where c.id = p_commitment
       and ((c.team_id is not null and exists (
               select 1 from team_staff ts
                where ts.team_id = c.team_id and ts.staff_id = p_coach and ts.status = 'active'))
         or (c.practice_id is not null and exists (
               select 1 from practices pr where pr.id = c.practice_id and pr.owner_id = p_coach)))
  );
$$;

create or replace function rollcall_arm_remind_claim(p_instance uuid, p_coach uuid, p_cooldown_min int default 10)
returns jsonb language plpgsql security definer set search_path = public as $$
declare i commitment_instances; v_claimed boolean := false; v_targets uuid[];
begin
  if not rollcall_coach_authorized(p_instance, p_coach) then
    return jsonb_build_object('ok', false, 'reason', 'not_authorized');
  end if;
  if exists (select 1 from feature_flags where name = 'verified_commitments' and kill_switch) then
    return jsonb_build_object('ok', false, 'reason', 'disabled');
  end if;
  select * into i from commitment_instances where id = p_instance;
  if not found or i.starts_at <= now() or i.status = 'cancelled' or i.skipped
     or not exists (select 1 from commitments c
                     where c.id = i.commitment_id and c.active and c.type = 'morning_roll_call') then
    return jsonb_build_object('ok', false, 'reason', 'no_instance');
  end if;
  -- Who would be reminded, before the cooldown is spent: nobody eligible spends nothing.
  select coalesce(array_agg(r.athlete_id), array[]::uuid[]) into v_targets
    from commitment_responses r
   where r.instance_id = p_instance and r.status <> 'excused'
     and r.acknowledged_at is null and r.alarm_armed_at is null
     and vc_enabled(r.athlete_id);
  if cardinality(v_targets) = 0 then
    return jsonb_build_object('ok', false, 'reason', 'nobody_to_remind');
  end if;
  -- Per ROLL CALL (Task 4 review): one remind covers every unarmed morning of it (the remind rows
  -- are the whole horizon), so a second press on another morning would re-buzz the same phones.
  update commitments set arm_reminded_at = now()
   where id = i.commitment_id
     and (arm_reminded_at is null or arm_reminded_at < now() - make_interval(mins => greatest(1, p_cooldown_min)))
  returning true into v_claimed;
  if not coalesce(v_claimed, false) then
    return jsonb_build_object('ok', false, 'reason', 'rate_limited');
  end if;
  return jsonb_build_object('ok', true, 'commitment_id', i.commitment_id, 'athlete_ids', to_jsonb(v_targets));
end $$;

-- The coach's in-app "notify" after Start or Save (Task 4 review): authorized, the kill switch,
-- and a per-roll-call cooldown. A press inside the cooldown is a success with nothing to do
-- ({ ok, cooldown }): the claim it would have run is the cron's next tick, under a minute away.
create or replace function rollcall_notify_claim(p_commitment uuid, p_coach uuid, p_cooldown_sec int default 60)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_claimed boolean := false;
begin
  if not rollcall_commitment_coach_authorized(p_commitment, p_coach) then
    return jsonb_build_object('ok', false, 'reason', 'not_authorized');
  end if;
  if exists (select 1 from feature_flags where name = 'verified_commitments' and kill_switch) then
    return jsonb_build_object('ok', false, 'reason', 'disabled');
  end if;
  if not exists (select 1 from commitments where id = p_commitment and active and type = 'morning_roll_call') then
    return jsonb_build_object('ok', false, 'reason', 'no_instance');
  end if;
  update commitments set notify_claimed_at = now()
   where id = p_commitment
     and (notify_claimed_at is null or notify_claimed_at < now() - make_interval(secs => greatest(1, p_cooldown_sec)))
  returning true into v_claimed;
  if not coalesce(v_claimed, false) then
    return jsonb_build_object('ok', true, 'cooldown', true);
  end if;
  return jsonb_build_object('ok', true, 'cooldown', false);
end $$;

-- The push extension's report (roll-call-ack { action: 'armed' }): the athlete and the instance
-- come from a verified window code, never from the request body.
create or replace function set_wake_alarm_armed_svc(p_instance uuid, p_athlete uuid, p_armed boolean)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  update commitment_responses
     set alarm_armed_at = case when p_armed then now() else null end
   where instance_id = p_instance and athlete_id = p_athlete;
  return found;
end $$;

-- ================================================================ 6. the athlete's reads/writes
create or replace function mark_rollcall_seen(p_commitment uuid default null) returns integer
language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  if auth.uid() is null then return 0; end if;
  update commitment_responses r set seen_at = now()
    from commitment_instances i
    join commitments c on c.id = i.commitment_id
   where r.instance_id = i.id
     and r.athlete_id = auth.uid()
     and r.seen_at is null
     and c.type = 'morning_roll_call'
     and (p_commitment is null or c.id = p_commitment)
     and i.starts_at > now() - interval '1 hour'
     and i.starts_at < now() + interval '14 days';
  get diagnostics n = row_count;
  return n;
end $$;

create or replace function set_alarm_primer(p_answer text) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or p_answer is null or p_answer not in ('continue', 'not_now') then return false; end if;
  update profiles set alarm_primer_at = now(), alarm_primer_answer = p_answer where id = auth.uid();
  return found;
end $$;

create or replace function alarm_primer_state() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('at', p.alarm_primer_at, 'answer', p.alarm_primer_answer)
    from profiles p where p.id = auth.uid();
$$;

-- ================================================================ 7. the coach's arming board
-- "Can push" = a device AND the athlete's own master switch on (Task 4 review). The 0216 body read
-- only device_tokens, so an athlete who switched notifications off read as reachable and the coach
-- saw "Hasn't opened it" instead of "Notifications off". The senders skip them the same way.
create or replace function _rc_can_push(p_user uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from device_tokens where user_id = p_user)
     and not coalesce((select p.notifications_opt_out from profiles p where p.id = p_user), false);
$$;
revoke all on function _rc_can_push(uuid) from public, anon, authenticated;

create or replace function rollcall_arming(p_instance uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare i commitment_instances; c commitments;
begin
  select * into i from commitment_instances where id = p_instance;
  if not found then raise exception 'not_authorized'; end if;   -- never confirm an id exists
  select * into c from commitments where id = i.commitment_id;
  if not commitment_owner_is_staff(c.team_id, c.practice_id) then raise exception 'not_authorized'; end if;
  return jsonb_build_object(
    'instance_id', i.id, 'commitment_id', c.id, 'starts_at', i.starts_at,
    'opens_at', rollcall_opens_at(c.type, i.starts_at, i.respond_by_at, c.starts_min, c.opens_min),
    'closes_at', rollcall_closes_at(c.type, i.respond_by_at, i.starts_at, i.ends_at),
    'alarm', coalesce((c.escalation ->> 'alarm')::boolean, true),
    'rows', coalesce((
      select jsonb_agg(jsonb_build_object(
        'athlete_id', r.athlete_id,
        'name', coalesce(p.full_name, 'Athlete'),
        'status', r.status,
        -- The roll call as a whole: told once about it counts, not only about this morning.
        'notified_at', (select max(r2.notified_at) from commitment_responses r2
                          join commitment_instances i2 on i2.id = r2.instance_id
                         where i2.commitment_id = c.id and r2.athlete_id = r.athlete_id),
        'seen_at', (select max(r2.seen_at) from commitment_responses r2
                      join commitment_instances i2 on i2.id = r2.instance_id
                     where i2.commitment_id = c.id and r2.athlete_id = r.athlete_id),
        'alarm_armed_at', r.alarm_armed_at,
        'can_push', _rc_can_push(r.athlete_id)
      ) order by coalesce(p.full_name, ''))
      from commitment_responses r
      left join profiles p on p.id = r.athlete_id
     where r.instance_id = i.id), '[]'::jsonb)
  );
end $$;

-- ================================================================ 8. rollcall_upcoming counts alarms
-- The 0217 body, byte for byte, plus ONE line ('armed'). Diffed against prod before writing.
create or replace function rollcall_upcoming(p_commitment uuid, p_days int default 7)
returns jsonb language plpgsql security definer set search_path = public as $$
declare c commitments; v_today date; v_days int;
begin
  select * into c from commitments where id = p_commitment;
  if not found or not commitment_owner_is_staff(c.team_id, c.practice_id) then
    raise exception 'not authorized';
  end if;
  if not vc_enabled() then return '[]'::jsonb; end if;   -- 0217
  v_days := greatest(1, least(coalesce(p_days, 7), 31));
  v_today := (now() at time zone c.timezone)::date;
  perform materialize_commitment(c.id, v_today, v_today + v_days);
  return (
    select coalesce(jsonb_agg(x order by x->>'occurs_on'), '[]'::jsonb) from (
      select jsonb_build_object(
        'instance_id', i.id, 'commitment_id', c.id, 'occurs_on', i.occurs_on,
        'instance_status', i.status, 'skipped', i.skipped,
        'starts_at', i.starts_at, 'respond_by_at', i.respond_by_at,
        'opens_at', rollcall_opens_at(c.type, i.starts_at, i.respond_by_at, c.starts_min, c.opens_min),
        'closes_at', rollcall_closes_at(c.type, i.respond_by_at, i.starts_at, i.ends_at),
        'starts_min', _rc_min_of(i.starts_at, c.timezone),
        'rule_starts_min', c.starts_min,
        'starts_override_min', i.starts_override_min,
        'grace_min', case when c.respond_by_min is null then null else c.respond_by_min - c.starts_min end,
        'timezone', c.timezone,
        'message', coalesce(i.message_override, c.message),
        'message_override', i.message_override,
        'note', i.note,
        'schedule_set_at', i.schedule_set_at,
        'schedule_set_by_name', (select p.full_name from profiles p where p.id = i.schedule_set_by),
        'schedule_notified_at', i.schedule_notified_at,
        'total', (select count(*) from commitment_responses r where r.instance_id = i.id and r.status <> 'excused'),
        'reachable', (select count(*) from commitment_responses r where r.instance_id = i.id and r.status <> 'excused' and _rc_can_push(r.athlete_id)),
        'answered', (select count(*) from commitment_responses r where r.instance_id = i.id and r.acknowledged_at is not null),
        'armed', (select count(*) from commitment_responses r where r.instance_id = i.id and r.status <> 'excused' and r.alarm_armed_at is not null)
      ) as x
      from commitment_instances i
      where i.commitment_id = c.id
        and i.occurs_on between v_today and v_today + v_days
    ) s
  );
end $$;
grant execute on function rollcall_upcoming(uuid, int) to authenticated;

-- ================================================================ 9. the push-arming flag
-- OFF, and v3 is built to work with it off. The device spike (plan Task 1) FAILED: AlarmKit
-- authorization is per bundle and the Notification Service Extension sees notDetermined, so it
-- cannot arm. Off: no schedule in the push, no mutable-content, the banner says "Open OnStandard to
-- set your alarm" and the app arms. The flag gates only whether pushes carry a schedule; nothing
-- may depend on it being on.
insert into public.feature_flags (name, description, default_on) values
  ('rollcall_push_arming', 'Roll call v3: gates only whether the assignment push carries the schedule (and mutable-content). Keep OFF: the 2026-09-24 device spike failed (AlarmKit authorization is per bundle; the Notification Service Extension cannot arm), so the app arms the alarm and nothing depends on this flag.', false)
on conflict (name) do update set description = excluded.description;   -- never touches default_on

-- ================================================================ grants
do $$ declare f text; begin
  foreach f in array array['mark_rollcall_seen(uuid)', 'rollcall_arming(uuid)', 'set_alarm_primer(text)', 'alarm_primer_state()'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
do $$ declare f text; begin
  foreach f in array array['materialize_rollcalls_ahead(int)', 'materialize_rollcall_ahead_svc(uuid,int)',
                           'rollcall_notify_claim(uuid,uuid,int)', 'claim_rollcall_notices(uuid,int)',
                           'settle_rollcall_notices(jsonb,boolean)', 'rollcall_remind_rows_svc(uuid,uuid[])',
                           'rollcall_instance_windows_svc(uuid[])', 'rollcall_notice_context_svc(uuid[])',
                           'rollcall_commitment_coach_authorized(uuid,uuid)', 'rollcall_arm_remind_claim(uuid,uuid,int)',
                           'set_wake_alarm_armed_svc(uuid,uuid,boolean)'] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;
