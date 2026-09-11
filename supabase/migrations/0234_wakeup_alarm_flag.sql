-- 0234: the coach decides whether a wake-up RINGS (2026-09-11)
--
-- A wake-up can now arm a real alarm on the athlete's phone (AlarmKit on iOS 26.1, setAlarmClock
-- on Android), which overrides Do Not Disturb, a Sleep Focus and silent mode. That is a large
-- thing to do to somebody at 5:45, so it is the coach's decision per wake-up, not a global switch.
--
-- The flag lives in commitments.escalation (jsonb, 0145) as `alarm`. No new column: escalation
-- is already the free-form bag of "how hard does this push", and a whole column plus grant plus
-- backfill for one boolean buys nothing.
--
-- WHAT THIS FIXES: `escalation` is NOT in the athlete's my_commitments payload, so the client
-- that has to ARM the alarm could not see the flag at all. This adds `alarm`, already resolved to
-- a boolean, next to action_label (which the payload does carry, and which is the alarm's own
-- button text).
--
-- DEFAULT TRUE. Every wake-up that exists today predates the flag and has no value. Defaulting to
-- false would mean the feature silently did nothing for every existing roll call until each coach
-- found a switch nobody told them about. A coach who does not want it turns it off; the phone
-- still shows the notification either way.
--
-- THE BODY BELOW IS THE LIVE FUNCTION, READ BACK FROM PRODUCTION WITH pg_get_functiondef AND
-- EDITED IN ONE PLACE. It is not retyped from the migration that last defined it. Retyping is
-- exactly how 0228 reintroduced a dropped column and stopped the whole app syncing for two days
-- (see 0233). The live body turned out to be NOTHING like the one I first typed from memory: it
-- splits across TWO jsonb_build_object calls (the 100-argument limit), uses _rc_min_of and
-- vc_enabled, and carries ~50 fields. Hand-writing it would have silently broken every athlete's
-- board. Always read the function back before editing it.

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
$function$

