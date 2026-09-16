-- 0239: the roll call CLOSES on the lock screen, and the phone that will ring says so (2026-09-16)
--
-- TWO GAPS IN THE WAKE-UP ALARM, both found by the 2026-09-15 pressure test and the 2026-09-16 audit.
--
-- 1. NOTHING EVER ENDED THE LOCK-SCREEN CARD. commitment-reminders starts the Live Activity at the
--    wake-up, commitment-escalation turns it red at the grace, roll-call-ack ends it on an answer,
--    and an athlete who never answered kept a red "CHECK IN" card counting past a close the server
--    would refuse, until iOS timed the activity out hours later. `claim_closed_rollcalls` is the
--    sweep that hands the escalation cron every wake-up instance whose close just passed, ONCE
--    (`live_ended_at` is the claim), with the athletes still pending on it, so the card can end in
--    its `missed` state the minute the roll call closes. It changes NO record: the verdict is
--    already computed from the clock (rollcall_verdict, 0212) and the durable `missed` claim in
--    claim_missed_commitments (0145) is untouched. This is presentation, not accountability.
--
-- 2. THE SERVER DID NOT KNOW A REAL ALARM WAS ARMED. A phone on iOS 26.1 rings an AlarmKit alarm
--    at the wake-up, and the reminder cron sent the 6:00 push and the Live Activity alert with a
--    sound at the same second: an alarm, a chime and a card alert for one morning. The device now
--    reports which of its mornings it armed (`set_wake_alarm_armed`, the athlete's own row only),
--    and the cron sends that athlete's opening push silently. The push still goes: the card, the
--    button and the words are all still needed; only the second noise is not.
--
-- Both columns are additive and nullable; nothing that exists changes shape.

alter table commitment_responses add column if not exists alarm_armed_at timestamptz;
comment on column commitment_responses.alarm_armed_at is
  'When this athlete''s phone last reported a real (AlarmKit / setAlarmClock) alarm armed for this morning. Null = no alarm, the push carries the sound.';

alter table commitment_instances add column if not exists live_ended_at timestamptz;
comment on column commitment_instances.live_ended_at is
  'When the close sweep claimed this instance to end its lock-screen presence. Presentation only; not the accountability record.';

-- ---------------------------------------------------------------- the device says what it armed
-- The athlete's own response row, and nothing else: auth.uid() is the only athlete it can touch.
-- Idempotent and cheap, because the device reports on every sync and only diffs client-side.
create or replace function set_wake_alarm_armed(p_instance uuid, p_armed boolean)
returns boolean
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return false; end if;
  update commitment_responses r
     set alarm_armed_at = case when p_armed then now() else null end
   where r.instance_id = p_instance
     and r.athlete_id = auth.uid();
  return found;
end $$;

revoke all on function set_wake_alarm_armed(uuid, boolean) from public, anon;
grant execute on function set_wake_alarm_armed(uuid, boolean) to authenticated;

-- ---------------------------------------------------------------- the close sweep
-- Wake-up instances whose close passed inside the window and were not yet swept, claimed in the
-- same statement (live_ended_at), with the athletes still unanswered on them. SERVICE ROLE ONLY,
-- like claim_missed_commitments: it is the cron's read, never a client's. The window bounds a cold
-- start: a cron that was down for a day does not end a hundred stale cards at once, it lets iOS's
-- own stale-date have handled those and sweeps only what is recent enough to still be on a screen.
create or replace function claim_closed_rollcalls(p_window_min int default 180, p_limit int default 200)
returns table (instance_id uuid, athlete_ids uuid[])
language plpgsql security definer set search_path = public as $$
begin
  return query
  with due as (
    select i.id
      from commitment_instances i
      join commitments c on c.id = i.commitment_id
     where c.type = 'morning_roll_call'
       and i.status = 'scheduled'
       and i.live_ended_at is null
       and rollcall_closes_at(c.type, i.respond_by_at, i.starts_at, i.ends_at) < now()
       and rollcall_closes_at(c.type, i.respond_by_at, i.starts_at, i.ends_at)
             > now() - make_interval(mins => greatest(1, p_window_min))
     order by i.starts_at
     limit greatest(1, p_limit)
       for update of i skip locked
  ), claimed as (
    update commitment_instances i
       set live_ended_at = now()
      from due
     where i.id = due.id
    returning i.id
  )
  select cl.id,
         coalesce((
           select array_agg(r.athlete_id)
             from commitment_responses r
            where r.instance_id = cl.id
              and r.acknowledged_at is null
              and r.status <> 'excused'
         ), array[]::uuid[])
    from claimed cl;
end $$;

revoke all on function claim_closed_rollcalls(int, int) from public, anon, authenticated;

-- ---------------------------------------------------------------- the card learns the coach's button
-- ONE VOCABULARY. The alarm, the push and the in-app card all say the coach's own `action_label`;
-- the Live Activity's button was the one surface still hardcoded to "I'M UP", because the card RPC
-- never carried the label. Same body as 0213 plus one column. The return type changes, so the
-- function is dropped first (a `create or replace` cannot change a RETURNS TABLE shape).
drop function if exists rollcall_live_card(uuid);
create function rollcall_live_card(p_instance uuid)
returns table (
  instance_id uuid,
  title text,
  coach_name text,
  message text,
  starts_at timestamptz,
  respond_by_at timestamptz,
  closes_at timestamptz,
  timezone text,
  action_label text
)
language sql security definer set search_path = public as $$
  select
    ci.id,
    coalesce(c.title, 'Wake-Up Roll Call'),
    coalesce(p.full_name, ''),
    coalesce(ci.message_override, c.message, ''),
    ci.starts_at,
    ci.respond_by_at,
    rollcall_closes_at(c.type, ci.respond_by_at, ci.starts_at, ci.ends_at),
    coalesce(c.timezone, 'UTC'),
    c.action_label
  from commitment_instances ci
  join commitments c on c.id = ci.commitment_id
  left join profiles p on p.id = c.created_by
  where ci.id = p_instance;
$$;

revoke all on function rollcall_live_card(uuid) from public, anon, authenticated;
