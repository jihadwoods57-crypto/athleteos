-- 0216 — Wake-Up Roll Call: reach, delivery, and telling athletes when a day changes.
--
-- Three gaps a real morning exposed after 0215 (2026-09-02):
--  1. The coach could not see who would never get the push. A roll call is only as good as its
--     delivery, and an athlete with no device token (notifications off, never granted, a fresh
--     phone) is silently outside it. The board now reports `can_push` per athlete and `reachable`
--     per occurrence, and each pending row carries `first_notified_at` so "no answer yet" can say
--     whether the 6:00 push actually went to them.
--  2. Moving or skipping a day (0215) told nobody. An athlete who set an alarm for 6:00 deserves
--     to hear tonight that it is 6:30, in the coach's name. `rollcall_schedule_notice_claim` is
--     the server half: authorization re-derived from the coach, a per-occurrence cooldown so a
--     coach adjusting the picker three times does not buzz the roster three times, the bell rows,
--     and the roster to push to. The edge function (roll-call-coach, action 'schedule') sends.
--  3. `schedule_notified_at` lets the board be honest about it: "Athletes told 8:14 PM", and a
--     "Tell athletes again" path when the schedule changed after the last notice.

alter table commitment_instances add column if not exists schedule_notified_at timestamptz;

-- Whether this user has any device that can receive a push. Security definer because
-- device_tokens is self-only by RLS and the coach board legitimately needs the fact (never the
-- token) for the athletes in their own roll call.
create or replace function _rc_can_push(p_user uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from device_tokens where user_id = p_user);
$$;
revoke all on function _rc_can_push(uuid) from public, anon, authenticated;

-- ================================================================ 1. the schedule notice claim
-- SERVICE ROLE ONLY (the edge function calls it after resolving the coach's session). Returns the
-- roster to push to and the facts the copy needs; writes the bell rows. Refused for an occurrence
-- that has already started (nothing to announce), rate-limited per occurrence.
create or replace function rollcall_schedule_notice_claim(
  p_instance uuid, p_coach uuid, p_cooldown_min int default 10
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  i commitment_instances; c commitments;
  v_claimed boolean := false;
  v_targets uuid[];
  v_coach text; v_today date; v_day text; v_body text;
begin
  if not rollcall_coach_authorized(p_instance, p_coach) then
    return jsonb_build_object('ok', false, 'reason', 'not_authorized');
  end if;
  select * into i from commitment_instances where id = p_instance;
  if not found then return jsonb_build_object('ok', false, 'reason', 'no_instance'); end if;
  if i.starts_at <= now() then return jsonb_build_object('ok', false, 'reason', 'no_instance'); end if;
  select * into c from commitments where id = i.commitment_id;

  update commitment_instances
     set schedule_notified_at = now()
   where id = p_instance
     and (schedule_notified_at is null
          or schedule_notified_at < now() - make_interval(mins => greatest(1, p_cooldown_min)))
  returning true into v_claimed;
  if not coalesce(v_claimed, false) then
    return jsonb_build_object('ok', false, 'reason', 'rate_limited');
  end if;

  select coalesce(array_agg(r.athlete_id), array[]::uuid[]) into v_targets
    from commitment_responses r
   where r.instance_id = p_instance and r.status <> 'excused';

  select coalesce(p.full_name, 'Your coach') into v_coach from profiles p where p.id = p_coach;
  v_today := (now() at time zone c.timezone)::date;
  v_day := case when i.occurs_on = v_today then 'today'
                when i.occurs_on = v_today + 1 then 'tomorrow'
                else 'on ' || to_char(i.occurs_on, 'FMDay') end;
  v_body := case when i.skipped or i.status = 'cancelled'
                 then 'No ' || coalesce(c.title, 'roll call') || ' ' || v_day || '.'
                 else coalesce(c.title, 'Roll call') || ' is at '
                      || to_char(i.starts_at at time zone c.timezone, 'FMHH12:MI AM') || ' ' || v_day || '.' end;

  if array_length(v_targets, 1) is not null then
    insert into notifications (user_id, kind, title, body)
    select t, 'commitment_reminder', v_coach, v_body from unnest(v_targets) t;
  end if;

  return jsonb_build_object(
    'ok', true,
    'title', coalesce(c.title, 'Roll call'),
    'coach_name', v_coach,
    'occurs_on', i.occurs_on,
    'today', v_today,
    'skipped', (i.skipped or i.status = 'cancelled'),
    'starts_min', _rc_min_of(i.starts_at, c.timezone),
    'timezone', c.timezone,
    'athlete_ids', to_jsonb(v_targets)
  );
end $$;
revoke all on function rollcall_schedule_notice_claim(uuid, uuid, int) from public, anon, authenticated;

-- ================================================================ 2. the reads
-- rollcall_upcoming (0215 body) + reachable + schedule_notified_at.
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
        'schedule_notified_at', i.schedule_notified_at,
        'total', (select count(*) from commitment_responses r where r.instance_id = i.id and r.status <> 'excused'),
        'reachable', (select count(*) from commitment_responses r where r.instance_id = i.id and r.status <> 'excused' and _rc_can_push(r.athlete_id)),
        'answered', (select count(*) from commitment_responses r where r.instance_id = i.id and r.acknowledged_at is not null)
      ) as x
      from commitment_instances i
      where i.commitment_id = c.id
        and i.occurs_on between v_today and v_today + v_days
    ) s
  );
end $$;
grant execute on function rollcall_upcoming(uuid, int) to authenticated;

-- commitment_board (0215 body) + can_push / first_notified_at per row, reachable +
-- schedule_notified_at per occurrence.
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
      'schedule_notified_at', i.schedule_notified_at,
      'reachable', (select count(*) from commitment_responses r where r.instance_id = i.id and r.status <> 'excused' and _rc_can_push(r.athlete_id)),
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
          'reviewer_name', (select p3.full_name from profiles p3 where p3.id = r.review_resolved_by),
          -- 0216
          'can_push', _rc_can_push(r.athlete_id),
          'first_notified_at', r.first_notified_at
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
