-- 0242: roll call rebuilt, part A: the team board, the coach's history, the 10-minute open, and
-- the assigned arrival inside the night ceiling (2026-09-23).
--
-- Spec: docs/superpowers/specs/2026-09-23-roll-call-rebuilt-design.md (its "Corrections" section
-- wins over the body). Plan: docs/superpowers/plans/2026-09-23-roll-call-rebuilt.md, Task 2.
--
-- 1. THE OPEN MOVES TO 10 MINUTES BEFORE THE START. Correction 7: a wake-up opened AT its time
--    (0212), so the lock-screen card could not appear until the very minute the athlete had to
--    answer. It now opens 10 minutes before. Only the morning default moves; an explicit opens_min
--    still wins, and every other type keeps the hour-before rule. Body copied from the live
--    definition (pg_get_functiondef, 2026-09-23); only the one `then` changed.
--
-- 2. THE TEAM BOARD (`rollcall_team_board`). The athlete's reason to tap: every teammate, in the
--    order they got up. cr_read (0138) limits an athlete to their OWN response row, which is right
--    for the table, so the board is SECURITY DEFINER and returns roster-safe fields ONLY: id, name,
--    picture path, the two instants, the two verdicts, the place. Never a coordinate, a device
--    time, an excuse reason, a dispute or review note. The caller must be a responder on the
--    instance who is STILL an active member of its team (or active client of its practice), or
--    staff of the owner. A response row alone is not enough: section 8 of the RLS suite proves
--    removal from a team cuts access immediately, and a stale row must not reopen it.
--      - `up` and `place` count an ANSWER that counts (on_standard or late). An unresolved review
--        counts as nothing until a coach resolves it (0212), so it has no place in line either.
--      - `total` leaves excused athletes out, exactly as the score does; they still appear.
--      - arrival_verdict is null when the roll call asks for no place; otherwise it is ONE pure
--        function, rollcall_arrival_verdict (below), so the board, the history, the Live Activity
--        and the client read one definition: excused | on_standard | late | unverified | pending
--        | missed. A phone that could not confirm the place is UNVERIFIED, never missed (the
--        verify_arrival rule, 0139/0208: absence of evidence is not evidence of absence). And an
--        arrival is never missed before its OWN deadline + grace, even when the wake-up closes
--        first (wake 6:00 closes 6:30; arrive by 6:45 + 10 grace is still pending at 6:31).
--      - avatar_path: profiles has no avatar column. Pictures live at the deterministic public
--        object avatars/<uid>/avatar.jpg (0206, 0224). The board returns that object path when the
--        object exists and null when it does not, so the client never paints a broken image.
--
-- 3. THE HISTORY (`rollcall_history`). Staff only. A MORNING is an occurrence that has CLOSED and
--    was neither cancelled nor skipped, started within the last p_days (1..90) days. Per athlete:
--    mornings = on_standard + late + missed (excused and unresolved-review mornings leave the
--    denominator, as in the score); streak = consecutive on_standard from the most recent morning
--    backwards; first_up = mornings they answered before anyone else; trend = on-time % of the
--    recent half of the window minus the early half (null when either half has no mornings).
--    The window is by instant (starts_at within now() - p_days), not by calendar date, so it needs
--    no time zone and is deterministic. Athletes are ordered lowest on-time rate first: the one
--    who most needs the coach leads.
--
-- 4. THE NIGHT CEILING COUNTS AN ASSIGNED ARRIVAL. Task 1 made the client score an assigned
--    arrival exactly like the wake-up and persist it as days.checkin.arrival = {assigned, verdict,
--    lateMin}, sharing the ONE night budget (NIGHT_SHIFT = 8) with the wake-up and the Recovery
--    Standard. The server ceiling must agree or it clamps an honest score: arrival is read exactly
--    as the wake-up is (assigned when assigned = true and the verdict is decided; earned in full
--    when on_standard or late). Body copied from the live definition (0234_sleep_standard_ceiling);
--    only the arrival lines are new. Mirrors src/core/scoreIntegrity.ts evidenceScoreCeiling.

-- ================================================================ 1. the open
create or replace function rollcall_opens_at(
  p_type text, p_starts_at timestamptz, p_respond_by_at timestamptz, p_starts_min smallint, p_opens_min smallint
) returns timestamptz language sql immutable set search_path = public as $$
  select case
    when p_type = 'morning_roll_call' and p_opens_min is null then p_starts_at - interval '10 minutes'
    else commitment_opens_at(p_starts_at, p_respond_by_at, p_starts_min, p_opens_min)
  end;
$$;

-- ================================================================ 2a. the arrival verdict, pure
-- p_arrive_by_at: the instance's arrive_by_at, else its starts_at (the caller resolves it).
-- Resolution order:
--   excused      the coach excused the athlete: never judged
--   on_standard  arrived at or before arrive-by + grace
--   late         arrived after it
--   unverified   the phone could not confirm the place (verify_arrival, 0208): never missed
--   missed       no arrival once BOTH the arrival deadline + grace AND the roll call's close
--                have passed (an arrival can never be missed before its own deadline)
--   pending      otherwise
create or replace function rollcall_arrival_verdict(
  p_status text, p_arrived_at timestamptz, p_arrive_by_at timestamptz, p_grace_min int,
  p_closes_at timestamptz, p_now timestamptz default now()
) returns text language sql immutable set search_path = public as $$
  select case
    when p_status = 'excused' then 'excused'
    when p_arrived_at is not null then
      case when p_arrive_by_at is null
             or p_arrived_at <= p_arrive_by_at + make_interval(mins => coalesce(p_grace_min, 10))
           then 'on_standard' else 'late' end
    when p_status = 'unverified' then 'unverified'
    when p_arrive_by_at is null then 'pending'
    when p_now > greatest(coalesce(p_closes_at, p_arrive_by_at + make_interval(mins => coalesce(p_grace_min, 10))),
                          p_arrive_by_at + make_interval(mins => coalesce(p_grace_min, 10)))
      then 'missed'
    else 'pending'
  end;
$$;
comment on function rollcall_arrival_verdict(text, timestamptz, timestamptz, int, timestamptz, timestamptz) is
  'Arrival verdict: excused | on_standard | late | unverified | pending | missed. Pure. Never missed before arrive-by + grace; a phone that could not confirm the place is unverified, never missed. 0242.';

-- 2b. The status the ARRIVAL is judged from (fix round 2, N1). On a morning roll call the row's
-- `status` belongs to the WAKE-UP (pending / acknowledged / missed / excused): an arrival never
-- moves it (section 8), because every nudge pipeline (reminder, card open/start, missed claim)
-- gates on status = 'pending'. A morning's "the phone could not confirm the place" therefore lives
-- only in unverified_reason with no arrived_at, and this reads it back as 'unverified' for the
-- arrival verdict. For every other type it returns the status unchanged (there, 'unverified' IS the
-- status and a confirmed arrival clears the reason). Excused always wins.
create or replace function rollcall_arrival_status(p_status text, p_arrived_at timestamptz, p_unverified_reason text)
returns text language sql immutable set search_path = public as $$
  select case
    when p_status = 'excused' then 'excused'
    when p_arrived_at is null and p_unverified_reason is not null then 'unverified'
    else p_status
  end;
$$;

-- ================================================================ 2. the team board
-- Two functions, ONE body. rollcall_team_board_svc builds the board with no caller check and is
-- granted to service_role ONLY (the grants block at the end revokes it from public, anon and
-- authenticated): roll-call-ack reads it after a lock-screen check-in to move every teammate's
-- Live Activity, and commitment-escalation reads it at the close for the coach's summary. Neither
-- has a user session. rollcall_team_board is the user-facing door: the caller check, then the
-- same body. Being SECURITY DEFINER, it runs the _svc call as the owner, so the revoke on _svc
-- does not reach it. (Task 4, 2026-09-23.)
create or replace function rollcall_team_board_svc(p_instance uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  i commitment_instances; c commitments; v_now timestamptz := now();
  v_close timestamptz; v_out jsonb;
begin
  select * into i from commitment_instances where id = p_instance;
  if not found then return null; end if;
  select * into c from commitments where id = i.commitment_id;

  v_close := rollcall_closes_at(c.type, i.respond_by_at, i.starts_at, i.ends_at);

  with base as (
    select r.athlete_id, p.full_name as name, r.status, r.acknowledged_at, r.arrived_at, r.unverified_reason,
      rollcall_verdict(r.status, r.acknowledged_at, coalesce(i.respond_by_at, i.starts_at), v_close, v_now,
        r.ack_source, r.sync_review, r.review_resolution) as verdict
    from commitment_responses r join profiles p on p.id = r.athlete_id
    where r.instance_id = p_instance
  ), rows as (
    select b.*,
      case when c.location_id is null then null
           else rollcall_arrival_verdict(rollcall_arrival_status(b.status, b.arrived_at, b.unverified_reason), b.arrived_at, coalesce(i.arrive_by_at, i.starts_at),
                  c.arrival_grace_min::int, v_close, v_now) end as arrival_verdict,
      case when exists (select 1 from storage.objects o
                         where o.bucket_id = 'avatars' and o.name = b.athlete_id::text || '/avatar.jpg')
           then b.athlete_id::text || '/avatar.jpg' end as avatar_path,
      b.verdict in ('on_standard', 'late') as counted_up
    from base b
  ), ordered as (
    select r.*,
      case when r.counted_up
           then row_number() over (partition by r.counted_up order by r.acknowledged_at, r.name) end as place
    from rows r
  )
  select jsonb_build_object(
    'instance_id', i.id, 'title', c.title,
    'coach_name', (select p.full_name from profiles p where p.id = c.created_by),
    'starts_at', i.starts_at, 'respond_by_at', i.respond_by_at,
    'closes_at', v_close,
    'arrive_by_at', i.arrive_by_at, 'asks_arrival', c.location_id is not null,
    'location_name', (select cl.name from commitment_locations cl where cl.id = c.location_id),
    'total', (select count(*) from ordered where verdict <> 'excused'),
    'up', (select count(*) from ordered where counted_up),
    'arrived', (select count(*) from ordered where arrived_at is not null and verdict <> 'excused'),
    'rows', coalesce((select jsonb_agg(jsonb_build_object(
        'athlete_id', o.athlete_id, 'name', o.name, 'avatar_path', o.avatar_path,
        'acknowledged_at', o.acknowledged_at, 'arrived_at', o.arrived_at,
        'verdict', o.verdict, 'arrival_verdict', o.arrival_verdict, 'place', o.place)
      order by o.acknowledged_at nulls last, o.name) from ordered o), '[]'::jsonb)
  ) into v_out;
  return v_out;
end $$;
comment on function rollcall_team_board_svc(uuid) is
  'The team board body with NO caller check: service_role only (roll-call-ack Live Activity counts, commitment-escalation closing summary). Null for an unknown instance. 0242.';

create or replace function rollcall_team_board(p_instance uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  i commitment_instances; c commitments;
begin
  if not vc_enabled() then raise exception 'Verified Commitments is currently switched off'; end if;
  select * into i from commitment_instances where id = p_instance;
  if not found then raise exception 'not_authorized'; end if;   -- never confirm an id exists
  select * into c from commitments where id = i.commitment_id;
  if not (
       commitment_owner_is_staff(c.team_id, c.practice_id)
    or (exists (select 1 from commitment_responses r where r.instance_id = p_instance and r.athlete_id = auth.uid())
        and ((c.team_id is not null and exists (select 1 from team_members m
                where m.team_id = c.team_id and m.athlete_id = auth.uid() and m.status = 'active'))
          or (c.practice_id is not null and exists (select 1 from practice_clients pc
                where pc.practice_id = c.practice_id and pc.client_id = auth.uid() and pc.status = 'active'))))
  ) then
    raise exception 'not_authorized';
  end if;
  return rollcall_team_board_svc(p_instance);
end $$;
comment on function rollcall_team_board(uuid) is
  'Roll call team board: every responder in the order they got up. Roster-safe fields only (no coordinates, device times or notes). Responders still on the team, or staff of the owner. 0242.';

-- ================================================================ 3. the history
create or replace function rollcall_history(p_commitment uuid, p_days int default 30) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  c commitments; v_now timestamptz := now();
  v_days int := greatest(1, least(coalesce(p_days, 30), 90));
  v_from timestamptz; v_mid timestamptz; v_out jsonb; v_arr boolean;
begin
  if not vc_enabled() then raise exception 'Verified Commitments is currently switched off'; end if;
  select * into c from commitments where id = p_commitment;
  if not found or not commitment_owner_is_staff(c.team_id, c.practice_id) then
    raise exception 'not_authorized';
  end if;
  v_from := v_now - make_interval(days => v_days);
  v_mid  := v_now - make_interval(hours => v_days * 12);   -- the window's midpoint, for the trend
  -- ARRIVAL ONLY (the board's mode 'arrival': any non-morning type with a place) is scored on the
  -- ARRIVAL verdict (rollcall_arrival_verdict) and its arrival time; a wake-up (with or without a
  -- place) keeps the wake-up verdict. An arrival-only roll call has no acknowledgement to score, so
  -- the wake-up verdict read every athlete as missed. (Task 10 fix round 1.)
  v_arr := c.location_id is not null and c.type <> 'morning_roll_call';

  with occ as (
    -- a MORNING: closed, not cancelled, not skipped, inside the window
    select i.* from commitment_instances i
     where i.commitment_id = p_commitment
       and i.status <> 'cancelled' and not coalesce(i.skipped, false)
       and i.starts_at >= v_from and i.starts_at <= v_now
       and case when v_arr
             -- decided once arrive-by + grace (and any close) has passed: the arrival rule's missed
             then v_now > greatest(
                    coalesce(rollcall_closes_at(c.type, i.respond_by_at, i.starts_at, i.ends_at),
                             coalesce(i.arrive_by_at, i.starts_at) + make_interval(mins => c.arrival_grace_min::int)),
                    coalesce(i.arrive_by_at, i.starts_at) + make_interval(mins => c.arrival_grace_min::int))
             else v_now > coalesce(rollcall_closes_at(c.type, i.respond_by_at, i.starts_at, i.ends_at),
                                   i.respond_by_at, i.starts_at) end
  ), v as (
    select r.athlete_id, o.id as instance_id, o.starts_at,
      -- `acknowledged_at` is the moment that counts: the arrival for arrival only (first HERE)
      case when v_arr then r.arrived_at else r.acknowledged_at end as acknowledged_at,
      case when v_arr
        then rollcall_arrival_verdict(rollcall_arrival_status(r.status, r.arrived_at, r.unverified_reason), r.arrived_at, coalesce(o.arrive_by_at, o.starts_at),
               c.arrival_grace_min::int, rollcall_closes_at(c.type, o.respond_by_at, o.starts_at, o.ends_at), v_now)
        else rollcall_verdict(r.status, r.acknowledged_at, coalesce(o.respond_by_at, o.starts_at),
               rollcall_closes_at(c.type, o.respond_by_at, o.starts_at, o.ends_at), v_now,
               r.ack_source, r.sync_review, r.review_resolution) end as verdict
    from occ o join commitment_responses r on r.instance_id = o.id
  ), m as (
    -- only decided mornings count; first up = the earliest answer that counts on that morning
    select v.*,
      verdict in ('on_standard', 'late')
        and acknowledged_at = min(acknowledged_at) filter (where verdict in ('on_standard', 'late'))
                                over (partition by instance_id) as first_up
    from v where verdict in ('on_standard', 'late', 'missed')
  ), s as (
    -- streak: on_standard mornings before the first non-on_standard one, newest first
    select athlete_id, verdict,
      sum(case when verdict <> 'on_standard' then 1 else 0 end)
        over (partition by athlete_id order by starts_at desc rows unbounded preceding) as breaks
    from m
  ), per as (
    select m.athlete_id,
      count(*) as mornings,
      count(*) filter (where verdict = 'on_standard') as on_time,
      count(*) filter (where verdict = 'late') as late,
      count(*) filter (where verdict = 'missed') as missed,
      count(*) filter (where first_up) as first_up,
      count(*) filter (where verdict = 'on_standard' and starts_at >  v_mid) as on_time_recent,
      count(*) filter (where                             starts_at >  v_mid) as mornings_recent,
      count(*) filter (where verdict = 'on_standard' and starts_at <= v_mid) as on_time_early,
      count(*) filter (where                             starts_at <= v_mid) as mornings_early
    from m group by m.athlete_id
  )
  select jsonb_build_object(
    'team_on_time_pct', (select round(100.0 * sum(on_time) / nullif(sum(mornings), 0)) from per),
    'team_trend', (select round(100.0 * sum(on_time_recent) / nullif(sum(mornings_recent), 0))
                        - round(100.0 * sum(on_time_early) / nullif(sum(mornings_early), 0)) from per),
    'athletes', coalesce((select jsonb_agg(jsonb_build_object(
        'athlete_id', per.athlete_id, 'name', p.full_name,
        'avatar_path', case when exists (select 1 from storage.objects o
                                          where o.bucket_id = 'avatars' and o.name = per.athlete_id::text || '/avatar.jpg')
                            then per.athlete_id::text || '/avatar.jpg' end,
        'mornings', per.mornings, 'on_time', per.on_time, 'late', per.late, 'missed', per.missed,
        'first_up', per.first_up,
        'on_time_pct', round(100.0 * per.on_time / nullif(per.mornings, 0)),
        'trend', round(100.0 * per.on_time_recent / nullif(per.mornings_recent, 0))
               - round(100.0 * per.on_time_early / nullif(per.mornings_early, 0)),
        'streak', (select count(*) from s where s.athlete_id = per.athlete_id and s.breaks = 0))
      order by round(100.0 * per.on_time / nullif(per.mornings, 0)) asc nulls last, p.full_name)
      from per join profiles p on p.id = per.athlete_id), '[]'::jsonb)
  ) into v_out;
  return v_out;
end $$;
comment on function rollcall_history(uuid, int) is
  'Roll call history per athlete over the last p_days (1..90): mornings, on_time, late, missed, on_time_pct, trend, streak, first_up. Staff only. 0242.';

-- ================================================================ 4. the night ceiling
create or replace function clamp_day_score_to_evidence() returns trigger
language plpgsql security definer set search_path = public as $function$
declare
  v_cutover   constant date := date '2026-08-16';  -- == SCORING_V2_CUTOVER in scoreIntegrity.ts
  v_cutover3  constant date := date '2026-09-09';  -- == SCORING_V3_CUTOVER in scoreIntegrity.ts
  v_nutrition boolean;
  v_checkin   boolean;
  v_commit    boolean;
  v_carry     boolean;
  v_verdict   text;
  v_wake_earned   boolean;
  v_wake_assigned boolean;
  v_arrival_verdict  text;
  v_arrival_earned   boolean;
  v_arrival_assigned boolean;
  v_sleep_hours   numeric;
  v_sleep_target  numeric;
  v_sleep_earned   boolean;
  v_sleep_assigned boolean;
  v_night_earned   boolean;
  v_night_assigned boolean;
  v_ceiling   int;
begin
  if new.score is null then
    return new;                                   -- nothing to bound on a fresh/unset day
  end if;

  if coalesce(jsonb_typeof(new.meals), 'null') <> 'object'
     or coalesce(jsonb_typeof(new.checkin), 'null') <> 'object'
     or coalesce(jsonb_typeof(new.quick_added), 'null') <> 'array' then
    raise exception using
      errcode = '22023',
      message = 'days: unreadable evidence shape; refusing to score this row',
      detail  = format('meals=%s checkin=%s quick_added=%s (expected object/object/array)',
                       coalesce(jsonb_typeof(new.meals), 'null'),
                       coalesce(jsonb_typeof(new.checkin), 'null'),
                       coalesce(jsonb_typeof(new.quick_added), 'null')),
      hint    = 'The evidence ceiling cannot bound a score it cannot read. Fix the writer rather than relaxing this check.';
  end if;

  -- (d) is the 0196 shape, NOT 0193's. 0196 replaced trust_passes' fixed granted_date +
  -- length_days window with a covers_from/covers_until window plus spendable credits, and
  -- rewrote this function to match. 0228 reintroduced the 0193 block, which is what broke it.
  v_nutrition := coalesce(
    exists (select 1 from jsonb_each(new.meals) e where e.value = 'true'::jsonb)
    or (jsonb_typeof(new.checkin -> 'slotMacros') = 'object' and (new.checkin -> 'slotMacros') <> '{}'::jsonb)
    or exists (select 1 from jsonb_array_elements(new.quick_added) q where q.value = 'true'::jsonb)
    or exists (
      select 1 from trust_passes tp
      where tp.athlete_id = new.athlete_id
        and tp.ended_at is null
        and new.date <= tp.expires_on
        and tp.covers_from is not null
        and new.date between tp.covers_from and tp.covers_until
    )
    or exists (
      select 1 from pass_spends ps
      where ps.athlete_id = new.athlete_id and ps.day_date = new.date
    ), false);

  if new.date < v_cutover then
    v_carry := coalesce(
      (case when new.checkin ->> 'ciLast' ~ '^\d{4}-\d{2}-\d{2}$'
            then (new.checkin ->> 'ciLast')::date between new.date - 6 and new.date
            else false end)
      or exists (
        select 1 from days d2
        where d2.athlete_id = new.athlete_id
          and d2.date < new.date
          and d2.date >= new.date - 6
          and (d2.checkin ->> 'submitted') = 'true'
      ), false);
  else
    v_carry := false;
  end if;

  v_checkin := coalesce((new.checkin ->> 'submitted') = 'true', false) or v_carry;
  v_commit := coalesce((new.checkin ->> 'commitment') in ('yes', 'partial', 'no'), false);

  -- The morning. Absent on every row written before this shipped, which is the point.
  v_verdict := case
    when jsonb_typeof(new.checkin -> 'wakeup') = 'object'
     and (new.checkin -> 'wakeup' ->> 'assigned') = 'true'
    then coalesce(new.checkin -> 'wakeup' ->> 'verdict', '')
    else ''
  end;
  v_wake_earned   := v_verdict in ('on_standard', 'late');
  v_wake_assigned := v_wake_earned or v_verdict = 'missed';

  -- The coach-assigned arrival (0242). Read exactly as the morning is read, because it is the
  -- morning's twin (proto day.js arrivalParts, src/core/scoreIntegrity.ts evidenceFromDayRow).
  -- Absent on every row written before Task 1 of the roll-call rebuild, so every historical row
  -- reads false here and is bounded precisely as it always has been.
  v_arrival_verdict := case
    when jsonb_typeof(new.checkin -> 'arrival') = 'object'
     and (new.checkin -> 'arrival' ->> 'assigned') = 'true'
    then coalesce(new.checkin -> 'arrival' ->> 'verdict', '')
    else ''
  end;
  v_arrival_earned   := v_arrival_verdict in ('on_standard', 'late');
  v_arrival_assigned := v_arrival_earned or v_arrival_verdict = 'missed';

  -- The Recovery Standard. Absent on every row written before this shipped, exactly as the
  -- morning was: no engine that has already run writes `checkin -> 'sleepStandard'`, so every
  -- historical row reads false here and is bounded precisely as it always has been.
  --
  -- A STANDARD WITH NO READING IS NOT ASSIGNED. A ring on a charger, a watch that did not sync, a
  -- night away from home: none of those are evidence that an athlete slept badly, and none may
  -- shrink a check-in slot or cost a point. It leaves the denominator, exactly as an excused
  -- morning does. This mirrors proto day.js recoveryStandardParts, which is the tested spec.
  v_sleep_target := nullif(new.checkin -> 'sleepStandard' ->> 'targetHours', '')::numeric;
  v_sleep_hours  := nullif(new.checkin ->> 'sleepHours', '')::numeric;
  v_sleep_assigned := coalesce(v_sleep_target > 0 and v_sleep_hours > 0, false);
  -- The ladder's floor is 25, never 0, so any judged night earns part of the slot.
  v_sleep_earned   := v_sleep_assigned;

  -- ONE NIGHT, ONE BUDGET. The morning, the arrival and the Recovery Standard share NIGHT_SHIFT
  -- between them, so any one assigned shrinks the check-in by the same 8 and any one earned grants
  -- the same 8 back. A day carrying several is bounded exactly as a day carrying one, which is
  -- also what both engines compute for it.
  v_night_earned   := v_wake_earned or v_arrival_earned or v_sleep_earned;
  v_night_assigned := v_wake_assigned or v_arrival_assigned or v_sleep_assigned;

  if new.date < v_cutover then
    v_ceiling := least(100,
        (case when v_nutrition then 82 else 0 end)   -- max(v1 55, v2 78, v3 82)
      + (case when v_checkin  then 35 else 0 end)    -- max(v1 25 + 10, v2 24, v3 18)
      + (case when v_commit   then 15 else 0 end)    -- max(v1 15, v2 0, v3 0)
    );
  elsif new.date < v_cutover3 then
    v_ceiling := least(100,
        (case when v_nutrition then 82 else 0 end)   -- max(v2 78, v3 82)
      + (case when v_checkin  then 24 else 0 end)    -- max(v2 24, v3 18)
    );
  else
    v_ceiling := least(100,
        (case when v_nutrition then 82 else 0 end)
      -- 18 on an ordinary day; 10 once a decided morning has taken its share of it.
      + (case when v_checkin then (case when v_night_assigned then 10 else 18 end) else 0 end)
      + (case when v_night_earned then 8 else 0 end)
    );
  end if;

  if new.score > v_ceiling then
    new.score := v_ceiling;
    new.grade := case
      when v_ceiling >= 90 then 'A'
      when v_ceiling >= 80 then 'B'
      when v_ceiling >= 70 then 'C'
      when v_ceiling >= 60 then 'D'
      else 'F'
    end;
  end if;
  return new;
end;
$function$;

-- ================================================================ 5. arrival by distance
-- Task 6 restores the phone's location code; it will call verify_arrival_at with ONE reading.
-- The coach's map (Tasks 7/10) saves places through save_commitment_place. Neither function ever
-- stores, logs or echoes a coordinate: verify_arrival_at returns only {ok/within/distance_m}
-- merged with verify_arrival's own result, and save_commitment_place writes lat/lng into
-- commitment_locations (the COACH's typed place, 0138) exactly as upsert_commitment already does
-- for that table — never an athlete's position.
--
-- _haversine_m is internal (revoked below, including from authenticated): every caller reaches it
-- only through verify_arrival_at.
create or replace function _haversine_m(lat1 double precision, lng1 double precision, lat2 double precision, lng2 double precision)
returns double precision language sql immutable as $$
  select 2 * 6371000 * asin(sqrt(
    power(sin(radians(lat2 - lat1) / 2), 2) +
    cos(radians(lat1)) * cos(radians(lat2)) * power(sin(radians(lng2 - lng1) / 2), 2)))
$$;

-- (Redefined in section 5b at the end of this file: the geofence source may also report the OS
-- region match with no reading. Everything below still holds for every call that sends one.)
-- verify_arrival_at: the ONE new write path for a distance-checked arrival. It computes `within`
-- from the instance's saved place and calls the EXISTING verify_arrival(instance, source, within,
-- reason) — every gate that function already enforces (Verified Commitments switched on,
-- ownership via the caller's own commitment_responses row, minor consent, the arrival-window
-- clamp) stays the one place commitment_responses is written. This function never writes that
-- table itself.
--
-- within = distance_m <= radius_m + least(accuracy_m, 75): a GPS fix is a circle, not a point, so
-- up to 75 m of the phone's own stated error is forgiven (mirrors the on-device geofence radius
-- padding this replaces on the server side of Task 6).
create or replace function verify_arrival_at(p_instance uuid, p_source text, p_lat double precision,
  p_lng double precision, p_accuracy_m double precision) returns jsonb
language plpgsql security definer set search_path = public as $$
declare loc commitment_locations; v_dist double precision; v_within boolean; v_res jsonb; v_acc double precision;
begin
  if p_lat is null or p_lng is null or p_lat not between -90 and 90 or p_lng not between -180 and 180 then
    raise exception 'bad_position';
  end if;
  -- AUTH FIRST. A caller with no response row on this instance gets refused before we so much as
  -- reveal whether the instance has a place configured (fix round 1, item 2).
  if not exists (select 1 from commitment_responses where instance_id = p_instance and athlete_id = auth.uid()) then
    raise exception 'not_authorized';
  end if;
  select l.* into loc from commitment_instances i join commitments c on c.id = i.commitment_id
    join commitment_locations l on l.id = c.location_id where i.id = p_instance;
  if not found then raise exception 'no_place'; end if;
  v_dist := _haversine_m(p_lat, p_lng, loc.lat, loc.lng);
  -- A non-finite accuracy (NaN/Infinity, however it got here) is not evidence of a tight fix: it
  -- is treated as 0, never as the full 75 m pad (fix round 1, item 3). Postgres defines NaN as
  -- equal to itself, so `v_acc = 'NaN'::float8` reliably catches it.
  v_acc := p_accuracy_m;
  if v_acc is null or v_acc = 'NaN'::float8 or v_acc = 'Infinity'::float8 or v_acc = '-Infinity'::float8 then
    v_acc := 0;
  end if;
  v_within := v_dist <= loc.radius_m + least(greatest(v_acc, 0), 75);
  v_res := verify_arrival(p_instance, p_source, v_within,
    -- The stored reason names the PLACE only, never the distance (final fix round, item 7): staff
    -- read unverified_reason (commitment_board, cr_read), and coaches see Arrived / Not arrived
    -- only. The distance goes back to the athlete in THIS reply (distance_m) and is never stored.
    case when v_within then null else format('Not at %s', loc.name) end);
  return coalesce(v_res, '{}'::jsonb) || jsonb_build_object('within', v_within, 'distance_m', round(v_dist));
end $$;
comment on function verify_arrival_at(uuid, text, double precision, double precision, double precision) is
  'Arrival verified by distance to the instance''s saved place. Calls verify_arrival() for the one write path; never stores or echoes a coordinate. Refuses a caller with no response row on the instance before revealing whether it has a place. 0242.';

-- save_commitment_place: insert/update a commitment_locations row for the CALLER's own team or
-- practice. A new place cannot be smaller than 100 m (tighter than the table''s 50 m floor, which
-- exists for the handful of pre-existing small facilities) because a bubble that tight manufactures
-- false negatives for consumer GPS and pushes honest athletes into 'unverified' or 'late'.
--
-- team_members (0001) carries no role column — only athlete_id + status; staff live in team_staff
-- (role staff_role). There is therefore no "the caller's own team" to infer from team_members, and
-- commitment_owner_is_staff already requires an explicit team_id/practice_id. This function REQUIRES
-- the caller to name EXACTLY ONE (fix round 1, item 1: commitment_owner_is_staff(v_team, v_practice)
-- passes if the caller is staff of EITHER owner, so a caller who is staff of their own team but sends
-- a stranger's practice_id alongside it could otherwise pass the staff check and, with the update's
-- old `team_id = v_team or practice_id = v_practice` OR-match, rewrite the stranger's place. Both the
-- guard and the update's match are now single-owner-exact.)
create or replace function save_commitment_place(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_team uuid := nullif(p->>'team_id','')::uuid; v_practice uuid := nullif(p->>'practice_id','')::uuid;
  v_r int := (p->>'radius_m')::int; v_name text := nullif(trim(p->>'name'), ''); v_addr text := nullif(trim(p->>'address'), '');
begin
  if v_r is null or v_r < 100 then raise exception 'radius_min'; end if;
  if v_r > 1000 then raise exception 'radius_max'; end if;
  if v_name is null then raise exception 'name_required'; end if;
  if num_nonnulls(v_team, v_practice) <> 1 then raise exception 'team_or_practice_required'; end if;
  if not commitment_owner_is_staff(v_team, v_practice) then raise exception 'not_authorized'; end if;
  if (p->>'id') is not null then
    -- exact single-owner match: a row's OTHER owner column must also match (it is null, since
    -- commitment_locations enforces num_nonnulls(team_id, practice_id) = 1), never an OR across
    -- both, or a caller who is staff of one owner and merely NAMES a second, unowned one could
    -- reach a row that belongs to that second owner alone.
    update commitment_locations set name = left(v_name, 60), address = left(v_addr, 200),
      lat = (p->>'lat')::float8, lng = (p->>'lng')::float8, radius_m = v_r
      where id = (p->>'id')::uuid and team_id is not distinct from v_team and practice_id is not distinct from v_practice
      returning id into v_id;
    if not found then raise exception 'not_authorized'; end if;
  else
    insert into commitment_locations (team_id, practice_id, name, address, lat, lng, radius_m, created_by)
    values (v_team, v_practice, left(v_name, 60), left(v_addr, 200), (p->>'lat')::float8, (p->>'lng')::float8, v_r, auth.uid())
    returning id into v_id;
  end if;
  return v_id;
end $$;
comment on function save_commitment_place(jsonb) is
  'Insert/update a commitment_locations row for the caller''s named team or practice (exactly one, exact-matched on update). New places floor at 100 m (radius_min), cap at 1000 m (radius_max); blank name is name_required. 0242.';

-- ================================================================ 6. the lock screen, live (Task 4)
-- The server half of the rebuilt Live Activity (spec corrections 4-7). Everything here is service
-- only; the second grants block below revokes it from public, anon and authenticated.
--
--   last_update_at   the throttle: at most one team-count update per athlete card per minute.
--   answered_update_at  when this card got the athlete's OWN answered update. Separate from the
--                    count throttle on purpose: a teammate's count update stamps last_update_at
--                    while still carrying MY old phase, so if the answered transition shared that
--                    stamp, an answer inside the minute after a teammate's was never sent and the
--                    card sat on I'M UP. The answered update is claimed once per card, never
--                    throttled by counts (claim_live_answered_update).
--   card_opened_at   INFORMATIONAL ONLY (fix round, 2026-09-23): the first moment
--                    commitment-reminders' open pass touched this instance. No longer gates
--                    anything — see card_started_at below for why a once-per-INSTANCE gate was
--                    wrong.
--   card_started_at  (on commitment_responses) the real claim: once per ATHLETE, not once per
--                    instance. The open pass used to stamp card_opened_at on the instance the
--                    moment it ran, whether or not a card actually started for anyone (an athlete
--                    with no push-to-start token yet, APNs down for the minute, the card RPC
--                    briefly unreachable) — after that stamp, NOTHING on that instance ever tried
--                    again: an athlete who registered a start token a minute after the open, or
--                    whose first attempt simply never reached Apple, went the rest of the morning
--                    with no lock-screen card, silently. Per-athlete claiming closes this two ways
--                    (review round 1, Important #1):
--                      1. claim_rollcall_card_opens / claim_rollcall_card_starts only claim an
--                         athlete who is currently START-ELIGIBLE — an unrevoked kind='start' token
--                         on rollcall_live_tokens, and no unrevoked kind='update' token on THIS
--                         instance yet (a card already exists for them). An athlete with no start
--                         token yet is simply never claimed, so a token registered a minute later
--                         makes them eligible on the very next tick.
--                      2. release_rollcall_card_start undoes the claim for anyone the push did not
--                         actually reach (not in pushLiveActivity's `live` set: APNs refused it,
--                         the token was gone, or anything after the claim threw), so the SAME
--                         open pass (it already runs every cron tick) or the start-time rung
--                         (claim_rollcall_card_starts) tries them again next tick.
--                    What the once-per-athlete claim still protects, unchanged: once an athlete's
--                    push was genuinely ACCEPTED (they are in `live`), card_started_at stays
--                    stamped and no path may attempt a second start for them on this instance —
--                    the phone may not have reported its update token back yet, and starting a
--                    second activity would stack two cards on one lock screen.
--   summary_sent_at  the once-per-instance guard on the coach's closing summary.
alter table rollcall_live_tokens add column if not exists last_update_at timestamptz;
alter table rollcall_live_tokens add column if not exists answered_update_at timestamptz;
alter table commitment_instances add column if not exists card_opened_at timestamptz;
alter table commitment_instances add column if not exists summary_sent_at timestamptz;
alter table commitment_responses add column if not exists card_started_at timestamptz;
comment on column rollcall_live_tokens.last_update_at is
  'Last team-count Live Activity update sent to this update token (roll-call-ack throttle, 60 s). 0242.';
comment on column rollcall_live_tokens.answered_update_at is
  'When this card was sent the athlete''s own answered update (claim_live_answered_update): once per card, independent of the team-count throttle. 0242.';
comment on column commitment_instances.card_opened_at is
  'Informational: first moment the open pass touched this instance. Does NOT gate a start any more (card_started_at does, per athlete) — fix round, 2026-09-23.';
comment on column commitment_instances.summary_sent_at is
  'When the coach''s closing summary push was claimed for this instance (claim_rollcall_summary): once per instance. 0242.';
comment on column commitment_responses.card_started_at is
  'When a Live Activity start was CLAIMED for this athlete on this instance (claim_rollcall_card_opens at the open, or claim_rollcall_card_starts at the start-time rung, for an athlete the open missed): claimed once, before the attempt, so a start is never attempted twice for one athlete even if the first attempt never actually reached the device. Per athlete, never per instance. Fix round, 2026-09-23.';

-- The card RPC learns the window's OPEN (for the window code) and whether the roll call asks an
-- arrival (the card's points: 8 alone, 4 with arrival). Same body as 0239 plus two columns; the
-- return type changes, so drop + create.
drop function if exists rollcall_live_card(uuid);
create function rollcall_live_card(p_instance uuid)
returns table (
  instance_id uuid, title text, coach_name text, message text,
  starts_at timestamptz, respond_by_at timestamptz, closes_at timestamptz,
  timezone text, action_label text,
  opens_at timestamptz, asks_arrival boolean
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
    c.action_label,
    rollcall_opens_at(c.type, ci.starts_at, ci.respond_by_at, c.starts_min, c.opens_min),
    c.location_id is not null
  from commitment_instances ci
  join commitments c on c.id = ci.commitment_id
  left join profiles p on p.id = c.created_by
  where ci.id = p_instance;
$$;

-- The two predicates below both mean "this athlete is worth claiming a start for right now":
--   * an unrevoked push-to-start token exists (rollcall_live_tokens kind='start') — no token,
--     no possible start, so an athlete with none yet is simply left unclaimed rather than
--     claimed-and-wasted; they become claimable the instant their phone registers one.
--   * no unrevoked update token exists YET for this instance (kind='update') — once one does, a
--     card already exists for them and claiming a start again would risk a second activity.
-- Inlined into both claiming functions below (fix round, review round 1, Important #1) rather than
-- factored into a shared helper: each is a single indexed EXISTS/NOT EXISTS pair, cheap enough to
-- repeat, and inlining keeps each function's own atomic UPDATE ... WHERE self-contained.

-- Start the card at the OPEN, per ATHLETE (fix round, 2026-09-23 — see card_started_at above).
-- Runs every cron tick (index.ts calls it unconditionally, not just "at" the open), so it is not a
-- one-shot: any instance still inside its window, with any pending, START-ELIGIBLE athlete not yet
-- claimed (card_started_at is null), is returned again on the next tick. An athlete claimed here
-- whose push is then genuinely ACCEPTED (index.ts checks pushLiveActivity's `live` set) is never
-- returned again; one whose push the caller could not confirm is released
-- (release_rollcall_card_start) so this same query picks them back up. A later attempt for an
-- athlete this pass never claimed at all (no start token yet) is the start-time rung's job
-- (claim_rollcall_card_starts), not another pass of this one. card_opened_at is stamped once, the
-- first time an instance is touched here, purely as a "when did this first run" record.
create or replace function claim_rollcall_card_opens(p_limit int default 200)
returns table (instance_id uuid, athlete_ids uuid[])
language plpgsql security definer set search_path = public as $$
begin
  if not vc_enabled() then return; end if;
  return query
  with due as (
    select r.instance_id, r.athlete_id
      from commitment_responses r
      join commitment_instances i on i.id = r.instance_id
      join commitments c on c.id = i.commitment_id
     where c.type = 'morning_roll_call'
       and c.active
       and i.status = 'scheduled'
       and i.live_ended_at is null
       and r.status = 'pending' and r.acknowledged_at is null and r.card_started_at is null
       and vc_enabled(r.athlete_id)
       and now() >= rollcall_opens_at(c.type, i.starts_at, i.respond_by_at, c.starts_min, c.opens_min)
       and now() <  coalesce(i.respond_by_at, i.starts_at)
       and exists (select 1 from rollcall_live_tokens st
                    where st.athlete_id = r.athlete_id and st.kind = 'start' and st.revoked_at is null)
       and not exists (select 1 from rollcall_live_tokens ut
                    where ut.athlete_id = r.athlete_id and ut.instance_id = r.instance_id
                      and ut.kind = 'update' and ut.revoked_at is null)
       -- Same active-membership gate as rollcall_window_rows_svc / rollcall_team_board_svc
       -- (review round 1, Minor #1): materialize_active_commitments already deletes a removed
       -- athlete's pending row on every tick before this runs, so this is defense in depth for the
       -- one tick where materialization itself failed, not the primary guard.
       and ((c.team_id is not null and exists (select 1 from team_members m
               where m.team_id = c.team_id and m.athlete_id = r.athlete_id and m.status = 'active'))
         or (c.practice_id is not null and exists (select 1 from practice_clients pc
               where pc.practice_id = c.practice_id and pc.client_id = r.athlete_id and pc.status = 'active')))
     order by i.starts_at
     limit greatest(1, p_limit)
       for update of r skip locked
  ), claimed as (
    update commitment_responses r set card_started_at = now()
      from due where r.instance_id = due.instance_id and r.athlete_id = due.athlete_id
    returning r.instance_id, r.athlete_id
  ), touched as (
    update commitment_instances i set card_opened_at = now()
      where i.id in (select distinct cl2.instance_id from claimed cl2) and i.card_opened_at is null
  )
  select cl.instance_id, array_agg(cl.athlete_id)
    from claimed cl
   group by cl.instance_id;
end $$;

-- The start-time rung's fallback (fix round, 2026-09-23): for the athletes it is about to push a
-- reminder to, claim any that are still missing a start AND are start-eligible right now (see the
-- predicate note above) so it may attempt one for them too — the open pass may never have reached
-- them (a start token registered after the open ran), and no other path retries a specific
-- athlete. Athletes NOT in the returned set either already have a start claimed (accepted, or
-- awaiting release) or have no start token at all yet: the caller must not attempt to start one for
-- them again, only update the card they may already hold.
create or replace function claim_rollcall_card_starts(p_instance uuid, p_athletes uuid[])
returns setof uuid
language sql security definer set search_path = public as $$
  update commitment_responses r set card_started_at = now()
   from commitment_instances i, commitments c
   where i.id = p_instance and c.id = i.commitment_id
     and r.instance_id = p_instance and r.athlete_id = any(p_athletes)
     and r.status = 'pending' and r.acknowledged_at is null and r.card_started_at is null
     and exists (select 1 from rollcall_live_tokens st
                  where st.athlete_id = r.athlete_id and st.kind = 'start' and st.revoked_at is null)
     and not exists (select 1 from rollcall_live_tokens ut
                  where ut.athlete_id = r.athlete_id and ut.instance_id = r.instance_id
                    and ut.kind = 'update' and ut.revoked_at is null)
     -- Same active-membership gate as claim_rollcall_card_opens (review round 1, Minor #1).
     and ((c.team_id is not null and exists (select 1 from team_members m
             where m.team_id = c.team_id and m.athlete_id = r.athlete_id and m.status = 'active'))
       or (c.practice_id is not null and exists (select 1 from practice_clients pc
             where pc.practice_id = c.practice_id and pc.client_id = r.athlete_id and pc.status = 'active')))
  returning r.athlete_id;
$$;

-- Undo a start claim whose push did NOT genuinely reach a device — APNs refused it, the token was
-- gone, or anything after the claim threw before the caller could tell — so the next minute's tick
-- (claim_rollcall_card_opens or claim_rollcall_card_starts, whichever applies) claims and retries
-- them instead of leaving them claimed-but-silent for the rest of the morning. Mirrors
-- release_live_answered_update below. Never throws the caller's push loop off course: nothing here
-- can fail in a way that leaves an athlete worse off than "retry next tick".
create or replace function release_rollcall_card_start(p_instance uuid, p_athletes uuid[])
returns void
language sql security definer set search_path = public as $$
  update commitment_responses set card_started_at = null
   where instance_id = p_instance and athlete_id = any(p_athletes) and card_started_at is not null;
$$;

-- Every live update token on one instance, with the throttle stamp and the phase the card is in
-- now, so a team-count update never flips an amber (reminder) card back to blue. The reminder
-- test mirrors commitment-reminders isInitialPush: a rung that fired more than a minute after the
-- start was a follow-up.
create or replace function rollcall_live_update_targets(p_instance uuid)
returns table (athlete_id uuid, token text, last_update_at timestamptz, phase_hint text)
language sql stable security definer set search_path = public as $$
  select t.athlete_id, t.token, t.last_update_at,
    case
      when r.acknowledged_at is not null then 'answered'
      when now() > coalesce(i.respond_by_at, i.starts_at) then 'late'
      when exists (select 1 from unnest(coalesce(r.reminded_offsets, array[]::smallint[])) o
                    where coalesce(i.respond_by_at, i.starts_at) - make_interval(mins => o::int)
                          > i.starts_at + interval '1 minute') then 'reminder'
      else 'initial'
    end
  from rollcall_live_tokens t
  join commitment_instances i on i.id = t.instance_id
  left join commitment_responses r on r.instance_id = t.instance_id and r.athlete_id = t.athlete_id
  where t.instance_id = p_instance and t.kind = 'update' and t.revoked_at is null;
$$;

-- The throttle, atomically: stamp last_update_at on the named athletes' update tokens that were
-- not updated in the last p_gap_sec seconds, and return exactly those athletes. Two check-ins in
-- the same second cannot both win the same card. p_gap_sec = 0 stamps unconditionally (the
-- athlete's own answered update).
create or replace function claim_live_team_updates(p_instance uuid, p_athletes uuid[], p_gap_sec int default 60)
returns setof uuid
language sql security definer set search_path = public as $$
  update rollcall_live_tokens t set last_update_at = now()
   where t.instance_id = p_instance and t.kind = 'update' and t.revoked_at is null
     and t.athlete_id = any(p_athletes)
     and (p_gap_sec <= 0 or t.last_update_at is null
          or t.last_update_at <= now() - make_interval(secs => p_gap_sec))
  returning t.athlete_id;
$$;

-- The athlete's OWN answered update: claimed ONCE per card, and never throttled by team-count
-- updates (see answered_update_at). Returns
--   'claimed'           this caller stamped at least one live update token and must send the update
--   'already_answered'  every live update token already had its answered update (a code ack, a
--                       re-posted code, the app's drain right behind the intent's own post)
--   'no_token'          the athlete has no live update token on this instance: no card the server
--                       can reach, so the phone should end any card it holds itself
-- Atomic: two refreshes in the same second cannot both claim the same card.
create or replace function claim_live_answered_update(p_instance uuid, p_athlete uuid)
returns text
language plpgsql security definer set search_path = public as $$
declare v_n int;
begin
  update rollcall_live_tokens t set answered_update_at = now(), last_update_at = now()
   where t.instance_id = p_instance and t.athlete_id = p_athlete
     and t.kind = 'update' and t.revoked_at is null and t.answered_update_at is null;
  get diagnostics v_n = row_count;
  if v_n > 0 then return 'claimed'; end if;
  if exists (select 1 from rollcall_live_tokens t
              where t.instance_id = p_instance and t.athlete_id = p_athlete
                and t.kind = 'update' and t.revoked_at is null) then
    return 'already_answered';
  end if;
  return 'no_token';
end $$;

-- Undo a claim whose push reached no device (APNs down, every token gone), so the next refresh
-- can try again instead of reading 'already_answered' for an update nobody received.
create or replace function release_live_answered_update(p_instance uuid, p_athlete uuid)
returns void
language sql security definer set search_path = public as $$
  update rollcall_live_tokens set answered_update_at = null
   where instance_id = p_instance and athlete_id = p_athlete and kind = 'update';
$$;

-- The windows an athlete's phone should hold codes for: their own wake-ups, not yet closed,
-- starting within p_days (1..14). roll-call-ack's authenticated mint route reads this with the
-- caller's VERIFIED user id; the function itself trusts no caller, which is why it is service only.
--
-- Active-membership gate (fix round, 2026-09-23): a response row alone is not enough, exactly as
-- section 8 of the RLS suite already proves for rollcall_team_board — an athlete removed from the
-- team or practice the commitment belongs to gets no window codes for it, even though their old
-- commitment_responses row is still sitting there. Same predicate rollcall_team_board's caller
-- check uses (team_members.status / practice_clients.status = 'active'); commitments always names
-- exactly one owner (commitments_one_owner), so exactly one branch ever applies.
create or replace function rollcall_window_rows_svc(p_athlete uuid, p_days int default 7)
returns table (instance_id uuid, opens_at timestamptz, closes_at timestamptz)
language sql stable security definer set search_path = public as $$
  select i.id,
         rollcall_opens_at(c.type, i.starts_at, i.respond_by_at, c.starts_min, c.opens_min),
         rollcall_closes_at(c.type, i.respond_by_at, i.starts_at, i.ends_at)
    from commitment_responses r
    join commitment_instances i on i.id = r.instance_id
    join commitments c on c.id = i.commitment_id
   where r.athlete_id = p_athlete
     and c.type = 'morning_roll_call'
     and c.active
     and i.status = 'scheduled'
     and r.status <> 'excused'
     and rollcall_closes_at(c.type, i.respond_by_at, i.starts_at, i.ends_at) > now()
     and i.starts_at < now() + make_interval(days => least(greatest(coalesce(p_days, 7), 1), 14))
     and ((c.team_id is not null and exists (select 1 from team_members m
             where m.team_id = c.team_id and m.athlete_id = p_athlete and m.status = 'active'))
       or (c.practice_id is not null and exists (select 1 from practice_clients pc
             where pc.practice_id = c.practice_id and pc.client_id = p_athlete and pc.status = 'active')))
   order by i.starts_at
   limit 50;
$$;

-- The closing summary goes out once per instance: true for exactly one caller.
create or replace function claim_rollcall_summary(p_instance uuid) returns boolean
language sql security definer set search_path = public as $$
  with u as (
    update commitment_instances set summary_sent_at = now()
     where id = p_instance and summary_sent_at is null
    returning id
  )
  select exists (select 1 from u);
$$;

-- ================================================================ grants
do $$ declare f text; begin
  foreach f in array array['rollcall_team_board(uuid)', 'rollcall_history(uuid,int)',
                           'rollcall_arrival_verdict(text,timestamptz,timestamptz,int,timestamptz,timestamptz)',
                           'rollcall_arrival_status(text,timestamptz,text)',
                           'verify_arrival_at(uuid,text,double precision,double precision,double precision)',
                           'save_commitment_place(jsonb)'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
revoke all on function _haversine_m(double precision,double precision,double precision,double precision) from public, anon, authenticated;

-- Task 4: service only. Not even a signed-in user may call these; the edge functions reach them
-- with the service role.
do $$ declare f text; begin
  foreach f in array array['rollcall_team_board_svc(uuid)', 'rollcall_live_card(uuid)',
                           'claim_rollcall_card_opens(int)', 'claim_rollcall_card_starts(uuid,uuid[])',
                           'release_rollcall_card_start(uuid,uuid[])',
                           'rollcall_live_update_targets(uuid)',
                           'claim_live_team_updates(uuid,uuid[],int)', 'rollcall_window_rows_svc(uuid,int)',
                           'claim_rollcall_summary(uuid)', 'claim_live_answered_update(uuid,uuid)',
                           'release_live_answered_update(uuid,uuid)'] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;

-- ================================================================ 5b. arrival: the region-match path (Task 6)
-- Controller ruling 2026-09-23. The binary no longer declares UIBackgroundModes "location" (that
-- key drew App Review 2.5.4 on 2026-09-18, and region monitoring does not need it: the OS watches
-- the region and wakes the app). Without the mode, iOS may refuse a position reading during that
-- background wake. So verify_arrival_at gains ONE extra input shape, and only for the geofence:
--
--   verify_arrival_at(instance, 'geofence', null, null, null)
--     = "the OS matched the region the server armed". within = true, distance_m = null.
--
-- THE TRUST MODEL, stated once:
--   * source 'geofence' WITH a reading: distance-checked exactly like 'manual' (below).
--   * source 'geofence' with NO reading (lat AND lng null): trusts the OS region event. The region
--     itself is the coach's place as handed out by my_armable_geofences (0139), only inside the
--     arming window, only to an athlete holding a response row on the instance. This is the same
--     trust verify_arrival(instance, 'geofence', true, null) has granted the device since 0139,
--     and that function remains athlete-callable (0208 grants) — so this path adds no new way to
--     claim an arrival, it only routes the existing one through the single entry point.
--   * source 'manual' ("I'm here"): ALWAYS distance-verified. No coordinates = bad_position.
--   * A half-given position (one of lat/lng null) is bad_position on either source.
-- Auth stays first, before anything reveals whether the instance has a place.
create or replace function verify_arrival_at(p_instance uuid, p_source text, p_lat double precision,
  p_lng double precision, p_accuracy_m double precision) returns jsonb
language plpgsql security definer set search_path = public as $$
declare loc commitment_locations; v_dist double precision; v_within boolean; v_res jsonb; v_acc double precision;
  v_region_match boolean := (p_source = 'geofence' and p_lat is null and p_lng is null);
begin
  if not v_region_match and (p_lat is null or p_lng is null
      or p_lat not between -90 and 90 or p_lng not between -180 and 180) then
    raise exception 'bad_position';
  end if;
  -- AUTH FIRST. A caller with no response row on this instance gets refused before we so much as
  -- reveal whether the instance has a place configured (fix round 1, item 2).
  if not exists (select 1 from commitment_responses where instance_id = p_instance and athlete_id = auth.uid()) then
    raise exception 'not_authorized';
  end if;
  select l.* into loc from commitment_instances i join commitments c on c.id = i.commitment_id
    join commitment_locations l on l.id = c.location_id where i.id = p_instance;
  if not found then raise exception 'no_place'; end if;
  if v_region_match then
    -- The OS matched the armed region. No distance exists to report, and none is invented.
    v_res := verify_arrival(p_instance, p_source, true, null);
    return coalesce(v_res, '{}'::jsonb) || jsonb_build_object('within', true, 'distance_m', null);
  end if;
  v_dist := _haversine_m(p_lat, p_lng, loc.lat, loc.lng);
  -- A non-finite accuracy (NaN/Infinity) is not evidence of a tight fix: treated as 0, never as
  -- the full 75 m pad (fix round 1, item 3).
  v_acc := p_accuracy_m;
  if v_acc is null or v_acc = 'NaN'::float8 or v_acc = 'Infinity'::float8 or v_acc = '-Infinity'::float8 then
    v_acc := 0;
  end if;
  v_within := v_dist <= loc.radius_m + least(greatest(v_acc, 0), 75);
  v_res := verify_arrival(p_instance, p_source, v_within,
    -- The stored reason names the PLACE only, never the distance (final fix round, item 7): staff
    -- read unverified_reason (commitment_board, cr_read), and coaches see Arrived / Not arrived
    -- only. The distance goes back to the athlete in THIS reply (distance_m) and is never stored.
    case when v_within then null else format('Not at %s', loc.name) end);
  return coalesce(v_res, '{}'::jsonb) || jsonb_build_object('within', v_within, 'distance_m', round(v_dist));
end $$;
comment on function verify_arrival_at(uuid, text, double precision, double precision, double precision) is
  'Arrival by distance to the instance''s saved place; or, for source geofence with null lat/lng only, the OS region match (within true, distance_m null). Manual always needs a position. Calls verify_arrival() for the one write path; never stores or echoes a coordinate. Auth first. 0242.';
-- create or replace keeps the grants set in the grants block above; restated so this section
-- stands on its own if it is ever lifted out.
revoke all on function verify_arrival_at(uuid,text,double precision,double precision,double precision) from public, anon;
grant execute on function verify_arrival_at(uuid,text,double precision,double precision,double precision) to authenticated;

-- ================================================================ 7. arrival-only + the athlete's arrival verdict (Task 8 fix round 1)
-- Controller ruling 2026-09-23. The spec lets arrival stand alone ("At the stadium by 3:30") but the
-- plan gave it no data shape. An arrival-only roll call is an existing NON-morning commitment type
-- (e.g. 'practice') with a location_id and an arrive-by: no alarm, no I'm Up. It is never a
-- morning_roll_call.
--
-- 7a. The board says which kind it is: `mode`
--       'wake'     a morning_roll_call with no place (only the wake-up is judged)
--       'both'     a morning_roll_call with a place (wake-up AND arrival)
--       'arrival'  any other type with a place (the arrival is the answer; the client groups the
--                  faces by arrival_verdict, and the wake-up verdict means nothing)
--     A commitment with no place is 'wake' whatever its type: nothing else can be judged.
--     Same body as section 2 plus the one key. rollcall_team_board calls this, so it gains the key
--     too; create or replace keeps the service-only grants set above.
--
-- Active-membership gate (fix round, 2026-09-23), same family as Task 3/rollcall_window_rows_svc: a
-- response row alone is not enough. A removed athlete's stale pending row must not show to
-- teammates or inflate `total`/`up`. This is the same predicate rollcall_team_board's own caller
-- check already applies to the CALLER; here it applies to every ROW. commitments always names
-- exactly one owner (commitments_one_owner), so exactly one branch ever matches. An athlete who
-- already checked in that morning and was removed later is excluded too, same as any other row —
-- that is fine (spec: Task 4).
create or replace function rollcall_team_board_svc(p_instance uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  i commitment_instances; c commitments; v_now timestamptz := now();
  v_close timestamptz; v_out jsonb;
begin
  select * into i from commitment_instances where id = p_instance;
  if not found then return null; end if;
  select * into c from commitments where id = i.commitment_id;

  v_close := rollcall_closes_at(c.type, i.respond_by_at, i.starts_at, i.ends_at);

  with base as (
    select r.athlete_id, p.full_name as name, r.status, r.acknowledged_at, r.arrived_at, r.unverified_reason,
      rollcall_verdict(r.status, r.acknowledged_at, coalesce(i.respond_by_at, i.starts_at), v_close, v_now,
        r.ack_source, r.sync_review, r.review_resolution) as verdict
    from commitment_responses r join profiles p on p.id = r.athlete_id
    where r.instance_id = p_instance
      and ((c.team_id is not null and exists (select 1 from team_members m
              where m.team_id = c.team_id and m.athlete_id = r.athlete_id and m.status = 'active'))
        or (c.practice_id is not null and exists (select 1 from practice_clients pc
              where pc.practice_id = c.practice_id and pc.client_id = r.athlete_id and pc.status = 'active')))
  ), rows as (
    select b.*,
      case when c.location_id is null then null
           else rollcall_arrival_verdict(rollcall_arrival_status(b.status, b.arrived_at, b.unverified_reason), b.arrived_at, coalesce(i.arrive_by_at, i.starts_at),
                  c.arrival_grace_min::int, v_close, v_now) end as arrival_verdict,
      case when exists (select 1 from storage.objects o
                         where o.bucket_id = 'avatars' and o.name = b.athlete_id::text || '/avatar.jpg')
           then b.athlete_id::text || '/avatar.jpg' end as avatar_path,
      b.verdict in ('on_standard', 'late') as counted_up
    from base b
  ), ordered as (
    select r.*,
      case when r.counted_up
           then row_number() over (partition by r.counted_up order by r.acknowledged_at, r.name) end as place
    from rows r
  )
  select jsonb_build_object(
    'instance_id', i.id, 'title', c.title,
    'mode', case when c.location_id is null then 'wake'
                 when c.type = 'morning_roll_call' then 'both'
                 else 'arrival' end,
    'coach_name', (select p.full_name from profiles p where p.id = c.created_by),
    'starts_at', i.starts_at, 'respond_by_at', i.respond_by_at,
    'closes_at', v_close,
    'arrive_by_at', i.arrive_by_at, 'asks_arrival', c.location_id is not null,
    'location_name', (select cl.name from commitment_locations cl where cl.id = c.location_id),
    'total', (select count(*) from ordered where verdict <> 'excused'),
    'up', (select count(*) from ordered where counted_up),
    'arrived', (select count(*) from ordered where arrived_at is not null and verdict <> 'excused'),
    'rows', coalesce((select jsonb_agg(jsonb_build_object(
        'athlete_id', o.athlete_id, 'name', o.name, 'avatar_path', o.avatar_path,
        'acknowledged_at', o.acknowledged_at, 'arrived_at', o.arrived_at,
        'verdict', o.verdict, 'arrival_verdict', o.arrival_verdict, 'place', o.place)
      order by o.acknowledged_at nulls last, o.name) from ordered o), '[]'::jsonb)
  ) into v_out;
  return v_out;
end $$;
comment on function rollcall_team_board_svc(uuid) is
  'The team board body with NO caller check: service_role only (roll-call-ack Live Activity counts, commitment-escalation closing summary). Carries mode: wake | both | arrival. Null for an unknown instance. 0242.';

-- 7b. my_commitments carries the athlete's own arrival_verdict, from the ONE definition
--     (rollcall_arrival_verdict), so the card and the day score read the server's verdict and never
--     derive their own. Recreated from the LIVE body (pg_get_functiondef, 2026-09-23); only the
--     'arrival_verdict' key is new, in the second (smaller) jsonb_build_object: the first is near
--     the 100-argument limit. Null when the commitment asks no place.
CREATE OR REPLACE FUNCTION public.my_commitments(p_from date, p_to date)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select coalesce(jsonb_agg(x order by x->>'starts_at'), '[]'::jsonb) from (
    select jsonb_build_object(
      'response_id', r.id, 'instance_id', i.id, 'occurs_on', i.occurs_on,
      'type', c.type, 'title', c.title,
      'message', coalesce(i.message_override, c.message),
      'action_label', c.action_label,
      -- NEW (0234): does this wake-up ring as a real alarm? Absent/unset reads as true.
      'alarm', coalesce((c.escalation ->> 'alarm')::boolean, true),
      'starts_at', i.starts_at, 'ends_at', i.ends_at,
      'respond_by_at', i.respond_by_at, 'arrive_by_at', i.arrive_by_at,
      'opens_min', case when c.opens_min is null then null
                        else _rc_min_of(i.starts_at, c.timezone) - (c.starts_min - c.opens_min) end,
      'starts_min', _rc_min_of(i.starts_at, c.timezone),
      'ends_min', _rc_min_of(i.ends_at, c.timezone),
      'respond_by_min', _rc_min_of(i.respond_by_at, c.timezone),
      'arrive_by_min', _rc_min_of(i.arrive_by_at, c.timezone),
      'rule_starts_min', c.starts_min,
      'min_dwell_min', c.min_dwell_min, 'arrival_grace_min', c.arrival_grace_min,
      'reminder_offsets_min', c.reminder_offsets_min,
      'repeat_days', c.repeat_days, 'starts_on', c.starts_on, 'ends_on', c.ends_on,
      'timezone', c.timezone,
      'instance_status', i.status,
      'linked_title', (select l.title from commitments l where l.id = c.linked_commitment_id),
      'linked_starts_min', (select l.starts_min from commitments l where l.id = c.linked_commitment_id),
      'asks_arrival', (c.location_id is not null),
      'location_name', (select cl.name from commitment_locations cl where cl.id = c.location_id),
      'coach_name', (select p.full_name from profiles p where p.id = c.created_by),
      'status', r.status, 'acknowledged_at', r.acknowledged_at,
      'arrived_at', r.arrived_at, 'completed_at', r.completed_at,
      'departed_at', r.departed_at,
      'presence', commitment_presence(r.arrived_at, r.departed_at, c.min_dwell_min),
      'arrival_source', r.arrival_source, 'unverified_reason', r.unverified_reason,
      'disputed_at', r.disputed_at, 'excused_reason', r.excused_reason
    ) || jsonb_build_object(   -- a second object: jsonb_build_object takes at most 100 arguments
      'opens_at', rollcall_opens_at(c.type, i.starts_at, i.respond_by_at, c.starts_min, c.opens_min),
      'closes_at', rollcall_closes_at(c.type, i.respond_by_at, i.starts_at, i.ends_at),
      'grace_min', case when c.respond_by_min is null then null else c.respond_by_min - c.starts_min end,
      'verdict', rollcall_verdict(r.status, r.acknowledged_at, coalesce(i.respond_by_at, i.starts_at),
                   rollcall_closes_at(c.type, i.respond_by_at, i.starts_at, i.ends_at), now(),
                   r.ack_source, r.sync_review, r.review_resolution),
      -- NEW (0242 section 7): the server's arrival verdict, null when no place is asked.
      'arrival_verdict', case when c.location_id is null then null
                         else rollcall_arrival_verdict(rollcall_arrival_status(r.status, r.arrived_at, r.unverified_reason), r.arrived_at, coalesce(i.arrive_by_at, i.starts_at),
                                c.arrival_grace_min::int,
                                rollcall_closes_at(c.type, i.respond_by_at, i.starts_at, i.ends_at), now()) end,
      'late_min', rollcall_late_min(r.acknowledged_at, coalesce(i.respond_by_at, i.starts_at)),
      'ack_source', r.ack_source,
      'last_nudge_at', r.last_nudge_at,
      'correction_note', r.correction_note,
      'corrected_by_name', (select p2.full_name from profiles p2 where p2.id = r.corrected_by),
      'device_tapped_at', r.device_tapped_at, 'sync_review', r.sync_review,
      'review_resolution', r.review_resolution, 'review_note', r.review_note,
      'review_resolved_at', r.review_resolved_at,
      'reviewer_name', (select p3.full_name from profiles p3 where p3.id = r.review_resolved_by)
    ) as x
    from commitment_responses r
    join commitment_instances i on i.id = r.instance_id
    join commitments c on c.id = i.commitment_id
    where r.athlete_id = auth.uid()
      and i.occurs_on between p_from and p_to
      and vc_enabled()
  ) s;
$function$;

-- ================================================================ 8. arrival after the close (final review I1, M2, M6)
-- 8a. verify_arrival REFUSES an arrival after the close, and never writes the wake-up answer.
--
-- It is still the ONE write path (verify_arrival_at calls it; it stays athlete-callable from 0208).
-- Two things were wrong with the 0208 body for a roll call:
--   * it CLAMPED the stamp into [arrive_by - 4h, end + 1h] instead of refusing, so an arrival after
--     the close was written as if it had happened at the clamp, and flipped 'missed' to 'arrived';
--   * it set acknowledged_at ("being there implies being up"), and acknowledged_at IS the wake-up
--     answer: a 6:40 walk-in turned a 6:30-closed "missed" wake-up into "late" on the board, the
--     history, my_commitments and the day score, past the close _rc_record_ack enforces for every
--     other path. One authenticated call (verify_arrival_at(inst,'geofence',null,null,null)) did it.
-- Now:
--   * ARRIVAL CLOSE = greatest(the roll call's close, arrive-by + grace), the same instant
--     rollcall_arrival_verdict turns 'pending' into 'missed'. After it: raise 'arrival_closed'
--     (a named code; the phone says "Check-in for this has closed"). Nothing is written.
--   * A morning_roll_call's acknowledged_at and status are never touched by an arrival, on either
--     branch (fix round 2, N1): status is the wake-up's, and every nudge pipeline gates on
--     status = 'pending'. The arrival lives in arrived_at / unverified_reason, which
--     rollcall_arrival_verdict reads through rollcall_arrival_status (2b). Other commitment types
--     keep 0208's behaviour.
--   * The lower clamp stays (a stamp is never earlier than arrive-by - 4h); the phone arms from
--     start - 2h, so a real arrival never reaches it.
-- Body copied from 0208 (the live definition); only the lines marked NEW changed.
create or replace function verify_arrival(
  p_instance uuid, p_source text, p_within boolean, p_reason text
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_resp commitment_responses; v_inst commitment_instances; v_c commitments;
  v_at timestamptz := now(); v_lo timestamptz; v_hi timestamptz;
  v_deadline timestamptz; v_close timestamptz; v_morning boolean;
begin
  if not vc_enabled() then
    raise exception 'Verified Commitments is currently switched off';
  end if;

  if p_source not in ('geofence', 'manual') then
    raise exception 'arrival source must be geofence or manual';
  end if;

  select r.* into v_resp from commitment_responses r
   where r.instance_id = p_instance and r.athlete_id = auth.uid();
  if not found then raise exception 'no commitment for you on this instance'; end if;

  select * into v_inst from commitment_instances where id = p_instance;
  select * into v_c from commitments where id = v_inst.commitment_id;

  if v_c.location_id is null then
    raise exception 'this commitment has no location to verify against';
  end if;
  if v_inst.status = 'cancelled' then
    raise exception 'this commitment was cancelled';
  end if;

  -- CONSENT GATE. Nothing location-derived is recorded for a minor without consent.
  if not has_verification_consent(auth.uid()) then
    raise exception 'location verification requires guardian or institutional consent';
  end if;

  -- NEW (0242 section 8): refuse after the arrival close; never clamp into it.
  v_deadline := coalesce(v_inst.arrive_by_at, v_inst.starts_at)
                + make_interval(mins => coalesce(v_c.arrival_grace_min, 10)::int);
  v_close := greatest(coalesce(rollcall_closes_at(v_c.type, v_inst.respond_by_at, v_inst.starts_at, v_inst.ends_at), v_deadline),
                      v_deadline);
  if v_at > v_close then
    raise exception 'arrival_closed';
  end if;
  v_morning := v_c.type = 'morning_roll_call';

  -- Clamp the stamp into a sane window (see 0139). Only the lower bound can still bite.
  v_lo := coalesce(v_inst.arrive_by_at, v_inst.starts_at) - interval '4 hours';
  v_hi := coalesce(v_inst.ends_at, v_inst.starts_at + interval '3 hours') + interval '1 hour';
  if v_at < v_lo then v_at := v_lo; end if;
  if v_at > v_hi then v_at := v_hi; end if;

  if p_within then
    update commitment_responses set
      arrived_at = coalesce(arrived_at, v_at),
      arrival_source = coalesce(arrival_source, p_source),
      -- NEW: a wake-up's answer is its own tap. An arrival never writes it.
      acknowledged_at = case when v_morning then acknowledged_at else coalesce(acknowledged_at, v_at) end,
      -- THE 0208 LINE. A re-entry refutes the departure that preceded it.
      departed_at = null,
      -- NEW: on a morning roll call `status` is the WAKE-UP's and an arrival never moves it
      -- (fix round 2, N1: 'pending' -> 'arrived' took the athlete out of the reminder, card and
      -- missed claims, and Home showed a green "Arrived" with no I'm Up while the wake-up went
      -- missed). arrived_at carries the arrival. Other types keep 0208's transition.
      status = case when v_morning then status
                    when status in ('pending', 'acknowledged', 'unverified', 'missed') then 'arrived'
                    else status end,
      unverified_reason = null,
      updated_at = now()
    where id = v_resp.id;
  else
    -- NEVER 'missed'. Absence of evidence is not evidence of absence.
    update commitment_responses set
      -- A morning keeps its wake-up status here too; its "not confirmed" is unverified_reason with
      -- no arrived_at, read back by rollcall_arrival_status (section 2b).
      status = case when v_morning then status
                    when status in ('pending', 'missed') then 'unverified'
                    else status end,
      unverified_reason = nullif(left(coalesce(p_reason, 'Could not confirm the location'), 60), ''),
      updated_at = now()
    where id = v_resp.id;
  end if;

  select r.* into v_resp from commitment_responses r where r.id = v_resp.id;
  return jsonb_build_object(
    'status', v_resp.status, 'arrived_at', v_resp.arrived_at,
    'departed_at', v_resp.departed_at,
    'presence', commitment_presence(v_resp.arrived_at, v_resp.departed_at, v_c.min_dwell_min),
    'arrival_source', v_resp.arrival_source, 'unverified_reason', v_resp.unverified_reason);
end $$;
comment on function verify_arrival(uuid, text, boolean, text) is
  'The one arrival write path. Refuses after the arrival close (arrival_closed: greatest(roll call close, arrive-by + grace)); a morning roll call''s acknowledged_at and missed status are never written by an arrival. 0208 body, 0242 section 8.';

-- 8b. _haversine_m pins its search_path (M6). It is not a definer function, uses builtins only and
--     is revoked from everyone, but the security advisor flags any function without one.
create or replace function _haversine_m(lat1 double precision, lng1 double precision, lat2 double precision, lng2 double precision)
returns double precision language sql immutable set search_path = '' as $$
  select 2 * 6371000 * asin(sqrt(
    power(sin(radians(lat2 - lat1) / 2), 2) +
    cos(radians(lat1)) * cos(radians(lat2)) * power(sin(radians(lng2 - lng1) / 2), 2)))
$$;
revoke all on function _haversine_m(double precision,double precision,double precision,double precision) from public, anon, authenticated;

-- 8c. A commitment may only point at a place of its OWN owner (M2). upsert_commitment (0211) never
--     checked, so a coach who knew another owner's place UUID could attach it, and
--     my_armable_geofences would then hand that place to their athletes. A trigger, not a copy of
--     upsert_commitment's body: it guards every write path at once. Fires only when location_id is
--     set or changed, so no unrelated update of an old row can trip it.
create or replace function commitments_location_owner_check() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.location_id is not null
     and (tg_op = 'INSERT' or new.location_id is distinct from old.location_id)
     and not exists (select 1 from commitment_locations l
                      where l.id = new.location_id
                        and l.team_id is not distinct from new.team_id
                        and l.practice_id is not distinct from new.practice_id) then
    raise exception 'location_not_yours';
  end if;
  return new;
end $$;
revoke all on function commitments_location_owner_check() from public, anon, authenticated;
drop trigger if exists commitments_location_owner on commitments;
create trigger commitments_location_owner before insert or update of location_id on commitments
  for each row execute function commitments_location_owner_check();
