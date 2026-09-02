-- 0215 — Wake-Up Roll Call: manage the NEXT one, and the week ahead (founder, 2026-09-02).
--
-- "As a coach, I need to easily manage the next morning roll call or even have it scheduled out."
--
-- Before this, the roll call was one standing rule (days, time, grace, message) and a board for
-- TODAY. The only per-day control was today's message. A coach who wanted tomorrow's roll call at
-- 6:30 instead of 6:00, or no roll call the morning after a late game, had to edit the rule for
-- every future day and remember to put it back. Tomorrow's occurrence already existed in this
-- table (the cron materializes today and tomorrow); nothing let the coach touch it.
--
-- This adds a per-OCCURRENCE schedule: a different wake-up time for one day, or skipping the day,
-- with who set it and when. The standing rule is untouched, and an edit to the rule (which re-times
-- every future occurrence, 0211) now keeps these overrides instead of clobbering them.
--
-- Three rules:
--  1. The occurrence's own timestamps are the truth. starts_at / respond_by_at / ends_at are re-timed
--     from the override keeping the RULE's deltas (grace, close), so a 6:00 roll call with a 5-minute
--     grace moved to 6:30 is On Standard until 6:35 and closes at 7:00. Every cron, every verdict
--     and every push already reads those timestamps, so a moved day needs no other code path.
--  2. A skipped day is a CANCELLED instance with `skipped = true`. Cancelled already means "the
--     coach called it off" everywhere (athlete card vanishes, crons skip it, verdicts do not count
--     it); the flag only exists so resync never un-cancels it when the rule is edited.
--  3. Reads report the EFFECTIVE minute-of-day (`starts_min` etc. computed from the instance), so a
--     client that prints "At 6:00 AM" from starts_min prints 6:30 on a moved day without changing.
--     The rule's minute rides alongside as `rule_starts_min` for the coach's "moved from" line.

-- ================================================================ 1. the columns
alter table commitment_instances
  add column if not exists starts_override_min smallint
    check (starts_override_min is null or starts_override_min between 0 and 1439),
  add column if not exists skipped boolean not null default false,
  add column if not exists schedule_set_by uuid references profiles(id),
  add column if not exists schedule_set_at timestamptz;

-- ================================================================ 2. minute-of-day of an instant
-- In the commitment's own zone, which is the clock every athlete on the roll call is judged on.
create or replace function _rc_min_of(p_at timestamptz, p_tz text) returns smallint
language sql immutable as $$
  select case when p_at is null then null
              else (extract(hour from (p_at at time zone p_tz))::int * 60
                    + extract(minute from (p_at at time zone p_tz))::int)::smallint end;
$$;

-- ================================================================ 3. re-time one occurrence
-- From a minute-of-day, keeping the rule's deltas. Shared by set_instance_schedule and resync so
-- the two can never compute a different 6:35.
create or replace function _rc_time_instance(p_instance uuid) returns void
language plpgsql security definer set search_path = public as $$
declare c commitments; i commitment_instances; v_min int; v_starts timestamptz;
begin
  select * into i from commitment_instances where id = p_instance;
  if not found then return; end if;
  select * into c from commitments where id = i.commitment_id;
  v_min := coalesce(i.starts_override_min, c.starts_min);
  v_starts := (i.occurs_on + make_interval(mins => v_min)) at time zone c.timezone;
  update commitment_instances set
    starts_at     = v_starts,
    ends_at       = case when c.ends_min is null then null
                         else v_starts + make_interval(mins => (c.ends_min - c.starts_min)::int) end,
    respond_by_at = case when c.respond_by_min is null then null
                         else v_starts + make_interval(mins => (c.respond_by_min - c.starts_min)::int) end,
    arrive_by_at  = case when c.arrive_by_min is null then null
                         else v_starts + make_interval(mins => (c.arrive_by_min - c.starts_min)::int) end
  where id = p_instance;
  -- A re-timed occurrence must remind again at its NEW time. Only untouched pending rows reset;
  -- an answer already given is never un-given (same rule as resync, 0211).
  update commitment_responses set reminded_offsets = '{}', updated_at = now()
   where instance_id = p_instance and status = 'pending' and acknowledged_at is null;
end $$;
revoke all on function _rc_time_instance(uuid) from public, anon, authenticated;

-- ================================================================ 4. the coach's per-day control
-- p_starts_min: a new wake-up time for this day only; null = leave the time alone.
-- p_reset_time: true = drop the day's time override and go back to the rule.
-- p_skipped:    true = skip this day; false = put it back; null = leave it alone.
-- p_note:       why (shown to staff on the board), 200 chars, null = leave it alone.
-- Refused once the occurrence has started: that morning is history, and the coach has excuse
-- and override per athlete for it.
create or replace function set_instance_schedule(
  p_instance uuid, p_starts_min smallint default null, p_reset_time boolean default false,
  p_skipped boolean default null, p_note text default null
) returns void
language plpgsql security definer set search_path = public as $$
declare v_ok boolean; i commitment_instances;
begin
  select * into i from commitment_instances where id = p_instance;
  if not found then raise exception 'no such occurrence'; end if;
  select commitment_owner_is_staff(c.team_id, c.practice_id) into v_ok
    from commitments c where c.id = i.commitment_id;
  if not coalesce(v_ok, false) then raise exception 'not authorized'; end if;
  if i.starts_at <= now() then raise exception 'already started'; end if;
  if p_starts_min is not null and (p_starts_min < 0 or p_starts_min > 1439) then
    raise exception 'bad time';
  end if;

  update commitment_instances set
    starts_override_min = case when p_reset_time then null
                               when p_starts_min is not null then p_starts_min
                               else starts_override_min end,
    skipped = coalesce(p_skipped, skipped),
    status  = case when coalesce(p_skipped, skipped) then 'cancelled' else 'scheduled' end,
    note    = case when p_note is null then note else nullif(left(p_note, 200), '') end,
    schedule_set_by = auth.uid(), schedule_set_at = now()
  where id = p_instance;

  perform _rc_time_instance(p_instance);
  -- A skipped morning must not leave a Live Activity card waiting to start on anyone's phone.
  if coalesce(p_skipped, false) then perform clear_live_activity_tokens(p_instance); end if;
end $$;
grant execute on function set_instance_schedule(uuid, smallint, boolean, boolean, text) to authenticated;

-- ================================================================ 5. resync keeps the overrides
-- 0211's body, with two changes: a skipped day stays cancelled, and a day with its own time is
-- re-timed from THAT minute (through _rc_time_instance) rather than the rule's.
create or replace function resync_commitment_instances(p_commitment uuid) returns integer
language plpgsql security definer set search_path = public as $$
declare c commitments; i record; n integer := 0; v_today date;
begin
  select * into c from commitments where id = p_commitment;
  if not found then return 0; end if;
  v_today := (now() at time zone c.timezone)::date;

  for i in select * from commitment_instances
            where commitment_id = c.id and starts_at > now()
  loop
    if not c.active
       or i.skipped
       or not (extract(dow from i.occurs_on)::smallint = any(c.repeat_days))
       or i.occurs_on < c.starts_on
       or (c.ends_on is not null and i.occurs_on > c.ends_on)
    then
      update commitment_instances set status = 'cancelled' where id = i.id and status <> 'cancelled';
    else
      update commitment_instances set status = 'scheduled' where id = i.id;
      perform _rc_time_instance(i.id);
    end if;
    n := n + 1;
  end loop;

  if c.active then perform materialize_commitment(c.id, v_today, v_today + 1); end if;
  return n;
end $$;
revoke all on function resync_commitment_instances(uuid) from public, anon, authenticated;

-- ================================================================ 6. the week ahead, for the coach
-- The next p_days occurrences of one roll call, materialized on the way in so tomorrow exists the
-- moment the coach looks (the cron only guarantees today + 1). Staff of the owning book only.
create or replace function rollcall_upcoming(p_commitment uuid, p_days int default 7)
returns jsonb language plpgsql security definer set search_path = public as $$
declare c commitments; v_today date; v_days int;
begin
  select * into c from commitments where id = p_commitment;
  if not found or not commitment_owner_is_staff(c.team_id, c.practice_id) then
    raise exception 'not authorized';
  end if;
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
        'total', (select count(*) from commitment_responses r where r.instance_id = i.id and r.status <> 'excused'),
        'answered', (select count(*) from commitment_responses r where r.instance_id = i.id and r.acknowledged_at is not null)
      ) as x
      from commitment_instances i
      where i.commitment_id = c.id
        and i.occurs_on between v_today and v_today + v_days
    ) s
  );
end $$;
grant execute on function rollcall_upcoming(uuid, int) to authenticated;

-- ================================================================ 7. the reads report the day's own clock
-- commitment_board (0212 body) + effective minutes, the rule's minute, and the schedule provenance.
create or replace function commitment_board(p_team uuid, p_practice uuid, p_on date)
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(x order by x->>'starts_at'), '[]'::jsonb) from (
    select jsonb_build_object(
      'instance_id', i.id, 'commitment_id', c.id, 'type', c.type,
      'title', c.title, 'message', coalesce(i.message_override, c.message),
      'standing_message', c.message, 'message_override', i.message_override,
      'action_label', c.action_label,
      'starts_at', i.starts_at, 'ends_at', i.ends_at,
      'respond_by_at', i.respond_by_at, 'arrive_by_at', i.arrive_by_at,
      'starts_min', _rc_min_of(i.starts_at, c.timezone),
      'respond_by_min', _rc_min_of(i.respond_by_at, c.timezone),
      'rule_starts_min', c.starts_min,
      'starts_override_min', i.starts_override_min,
      'skipped', i.skipped, 'note', i.note,
      'schedule_set_at', i.schedule_set_at,
      'schedule_set_by_name', (select p.full_name from profiles p where p.id = i.schedule_set_by),
      'timezone', c.timezone,
      'instance_status', i.status,
      'occurs_on', i.occurs_on,
      'audience_kind', c.audience_kind,
      'audience_label', case
        when c.audience_kind = 'room'  then (select r.label from team_rooms r where r.id = c.audience_value)
        when c.audience_kind = 'group' then (select g.name from coach_groups g where g.id = c.audience_value)
        when c.audience_kind = 'athlete' then (select p.full_name from profiles p where p.id = c.audience_value)
        else null end,
      'linked_title', (select l.title from commitments l where l.id = c.linked_commitment_id),
      'linked_starts_min', (select l.starts_min from commitments l where l.id = c.linked_commitment_id),
      'asks_arrival', (c.location_id is not null),
      'location_name', (select cl.name from commitment_locations cl where cl.id = c.location_id),
      'coach_name', (select p.full_name from profiles p where p.id = c.created_by),
      'opens_at', rollcall_opens_at(c.type, i.starts_at, i.respond_by_at, c.starts_min, c.opens_min),
      'closes_at', rollcall_closes_at(c.type, i.respond_by_at, i.starts_at, i.ends_at),
      'grace_min', case when c.respond_by_min is null then null else c.respond_by_min - c.starts_min end,
      'last_nudge_at', i.last_nudge_at,
      'rows', (
        select coalesce(jsonb_agg(jsonb_build_object(
          'response_id', r.id, 'athlete_id', r.athlete_id, 'name', p.full_name,
          'status', r.status,
          'acknowledged_at', r.acknowledged_at, 'arrived_at', r.arrived_at,
          'completed_at', r.completed_at, 'arrival_source', r.arrival_source,
          'unverified_reason', r.unverified_reason, 'excused_reason', r.excused_reason,
          'corrected_by_name', (select p2.full_name from profiles p2 where p2.id = r.corrected_by),
          'disputed_at', r.disputed_at, 'dispute_note', r.dispute_note,
          'verdict', rollcall_verdict(r.status, r.acknowledged_at, coalesce(i.respond_by_at, i.starts_at),
                       rollcall_closes_at(c.type, i.respond_by_at, i.starts_at, i.ends_at), now(),
                       r.ack_source, r.sync_review, r.review_resolution),
          'late_min', rollcall_late_min(r.acknowledged_at, coalesce(i.respond_by_at, i.starts_at)),
          'ack_source', r.ack_source,
          'last_nudge_at', r.last_nudge_at,
          'correction_note', r.correction_note, 'corrected_at', r.corrected_at,
          'device_tapped_at', r.device_tapped_at, 'sync_review', r.sync_review,
          'review_resolution', r.review_resolution, 'review_note', r.review_note,
          'review_resolved_at', r.review_resolved_at,
          'reviewer_name', (select p3.full_name from profiles p3 where p3.id = r.review_resolved_by)
        ) order by p.full_name), '[]'::jsonb)
        from commitment_responses r join profiles p on p.id = r.athlete_id
        where r.instance_id = i.id
      )
    ) as x
    from commitment_instances i
    join commitments c on c.id = i.commitment_id
    where i.occurs_on = p_on
      and ((p_team is not null and c.team_id = p_team)
        or (p_practice is not null and c.practice_id = p_practice))
      and commitment_owner_is_staff(c.team_id, c.practice_id)
      and vc_enabled()
  ) s;
$$;

-- my_commitments (0212 body) + effective minutes. Every pre-0215 key is preserved; the athlete's
-- "At 6:30 AM" line and their local reminder anchor read starts_min / respond_by_min, so those now
-- carry the DAY's clock. Cancelled occurrences already vanish on the client (deriveCommitment).
create or replace function my_commitments(p_from date, p_to date)
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(x order by x->>'starts_at'), '[]'::jsonb) from (
    select jsonb_build_object(
      'response_id', r.id, 'instance_id', i.id, 'occurs_on', i.occurs_on,
      'type', c.type, 'title', c.title,
      'message', coalesce(i.message_override, c.message),
      'action_label', c.action_label,
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
$$;
