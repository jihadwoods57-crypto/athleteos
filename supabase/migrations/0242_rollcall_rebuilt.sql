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

-- ================================================================ 2. the team board
create or replace function rollcall_team_board(p_instance uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  i commitment_instances; c commitments; v_now timestamptz := now();
  v_close timestamptz; v_out jsonb;
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

  v_close := rollcall_closes_at(c.type, i.respond_by_at, i.starts_at, i.ends_at);

  with base as (
    select r.athlete_id, p.full_name as name, r.status, r.acknowledged_at, r.arrived_at,
      rollcall_verdict(r.status, r.acknowledged_at, coalesce(i.respond_by_at, i.starts_at), v_close, v_now,
        r.ack_source, r.sync_review, r.review_resolution) as verdict
    from commitment_responses r join profiles p on p.id = r.athlete_id
    where r.instance_id = p_instance
  ), rows as (
    select b.*,
      case when c.location_id is null then null
           else rollcall_arrival_verdict(b.status, b.arrived_at, coalesce(i.arrive_by_at, i.starts_at),
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
comment on function rollcall_team_board(uuid) is
  'Roll call team board: every responder in the order they got up. Roster-safe fields only (no coordinates, device times or notes). Responders still on the team, or staff of the owner. 0242.';

-- ================================================================ 3. the history
create or replace function rollcall_history(p_commitment uuid, p_days int default 30) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  c commitments; v_now timestamptz := now();
  v_days int := greatest(1, least(coalesce(p_days, 30), 90));
  v_from timestamptz; v_mid timestamptz; v_out jsonb;
begin
  if not vc_enabled() then raise exception 'Verified Commitments is currently switched off'; end if;
  select * into c from commitments where id = p_commitment;
  if not found or not commitment_owner_is_staff(c.team_id, c.practice_id) then
    raise exception 'not_authorized';
  end if;
  v_from := v_now - make_interval(days => v_days);
  v_mid  := v_now - make_interval(hours => v_days * 12);   -- the window's midpoint, for the trend

  with occ as (
    -- a MORNING: closed, not cancelled, not skipped, inside the window
    select i.* from commitment_instances i
     where i.commitment_id = p_commitment
       and i.status <> 'cancelled' and not coalesce(i.skipped, false)
       and i.starts_at >= v_from and i.starts_at <= v_now
       and v_now > coalesce(rollcall_closes_at(c.type, i.respond_by_at, i.starts_at, i.ends_at),
                            i.respond_by_at, i.starts_at)
  ), v as (
    select r.athlete_id, o.id as instance_id, o.starts_at, r.acknowledged_at,
      rollcall_verdict(r.status, r.acknowledged_at, coalesce(o.respond_by_at, o.starts_at),
        rollcall_closes_at(c.type, o.respond_by_at, o.starts_at, o.ends_at), v_now,
        r.ack_source, r.sync_review, r.review_resolution) as verdict
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

-- ================================================================ grants
do $$ declare f text; begin
  foreach f in array array['rollcall_team_board(uuid)', 'rollcall_history(uuid,int)',
                           'rollcall_arrival_verdict(text,timestamptz,timestamptz,int,timestamptz,timestamptz)'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
