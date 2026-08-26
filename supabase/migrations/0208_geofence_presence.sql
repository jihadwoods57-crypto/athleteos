-- 0208: geofence PRESENCE (2026-08-23).
--
-- THE BUG THIS CLOSES. Geofencing confirmed a boundary CROSSING and called it arrival. The
-- coach's "Stay at least N min" field (commitments.min_dwell_min, live since 0138) round-tripped
-- through the form, shipped to the client in my_commitments, and gated NOTHING:
--
--   * complete_commitment(instance,'dwell') enforces min_dwell_min correctly (0139) and no caller
--     anywhere in the repo has ever passed 'dwell'. The only caller passes 'manual'.
--   * The native task branched on GeofencingEventType.Enter only. Exit was delivered
--     (notifyOnExit:true, 0139) and dropped on the floor.
--   * commitment_responses.departed_at has existed since 0138:166, written by nothing.
--
-- So a phone that clipped the perimeter and drove on was credited identically to one that stayed
-- two hours. Wiring 'dwell' up would NOT have closed it: that function only checks that clock
-- time has passed since arrived_at, never that the athlete stayed.
--
-- THE DESIGN. Presence is a lifecycle, not an event:
--
--   provisional  arrived, the required stay has not elapsed yet
--   confirmed    stayed the coach's minimum without a sustained departure
--   left_early   a sustained departure landed before the minimum was met
--
-- WHERE THE DEBOUNCE LIVES, AND WHY IT LIVES HERE. Indoors (the founder's word was "classroom":
-- concrete, worst-case GPS) iOS will fire spurious Exit events for an athlete sitting still. A
-- naive handler accuses kids of leaving rooms they never left, which is the exact failure
-- 0138:155 exists to prevent. So a departure only counts once it is SUSTAINED. Two halves:
--
--   1. A re-entry ERASES the departure (verify_arrival now clears departed_at). Noise self-heals.
--   2. A surviving departed_at is only believed after PRESENCE_EXIT_GRACE has elapsed with no
--      re-entry to clear it.
--
-- That runs server-side deliberately. A client-side timer that must fire minutes after an exit,
-- in the background, with the app possibly killed, is exactly the thing iOS does not guarantee.
-- The server needs no timer: it evaluates lazily at read time, when every event is already in.
--
-- BLAST RADIUS IS DELIBERATELY SMALL. When min_dwell_min is null (the coach set no stay
-- requirement) the verdict is 'confirmed' the moment the athlete arrives, which is byte-identical
-- to today's behaviour. Only commitments where a coach actually asked for a stay gain the
-- lifecycle. Nothing here can produce 'missed': absence of evidence is still not evidence of
-- absence, and departed_at is only ever written for an athlete who already verifiably arrived.

-- ---------------------------------------------------------------- the grace
-- HOW LONG AN EXIT MUST STAND BEFORE IT IS BELIEVED.
--
-- 5 minutes is a STARTING VALUE, not a measured one, and it cannot be measured from a desk. iOS
-- already applies its own hysteresis (a crossing must persist ~20s, and the device must be
-- meaningfully outside the radius), so this sits on top of that rather than replacing it. It
-- wants calibration against real enter/exit traces from a real phone in a real concrete building
-- before it is trusted to cost anyone a requirement. See docs/superpowers/specs/
-- 2026-08-23-geofence-presence-design.md, section 13.
create or replace function presence_exit_grace() returns interval
language sql immutable set search_path = public as $$ select interval '5 minutes' $$;

-- ---------------------------------------------------------------- the verdict
-- Pure. Every input is an argument, so it is testable without a row and cannot drift between the
-- athlete read and the coach read: both call THIS.
create or replace function commitment_presence(
  p_arrived_at   timestamptz,
  p_departed_at  timestamptz,
  p_min_dwell_min smallint,
  p_now          timestamptz default now()
) returns text
language sql immutable set search_path = public as $$
  select case
    -- Never arrived: presence is not a question yet. 'none' is NOT a failure verdict.
    when p_arrived_at is null then 'none'
    -- No stay requirement: arriving IS the requirement. Identical to pre-0208 behaviour.
    when p_min_dwell_min is null or p_min_dwell_min <= 0 then 'confirmed'
    -- A departure that has not outlived the grace is still refutable by a re-entry, so it is not
    -- yet evidence of anything and the athlete stays provisional rather than being accused.
    when p_departed_at is not null
     and p_now >= p_departed_at + presence_exit_grace()
     and p_departed_at < p_arrived_at + make_interval(mins => p_min_dwell_min::int)
      then 'left_early'
    -- Stayed the minimum. True whether they are still there or left after meeting it.
    when p_now >= p_arrived_at + make_interval(mins => p_min_dwell_min::int)
     and (p_departed_at is null or p_departed_at >= p_arrived_at + make_interval(mins => p_min_dwell_min::int))
      then 'confirmed'
    else 'provisional'
  end;
$$;

comment on function commitment_presence(timestamptz,timestamptz,smallint,timestamptz) is
  'Presence verdict for a commitment response: none | provisional | confirmed | left_early. '
  'Pure; both the athlete read and the coach read call this so they can never disagree.';

-- ---------------------------------------------------------------- record_departure
-- The writer commitment_responses.departed_at never had. Mirrors verify_arrival''s gates exactly:
-- kill switch, ownership, cancellation, consent. Deliberately NARROWER in two ways:
--
--   * It refuses unless the athlete verifiably arrived. An exit with no arrival is meaningless
--     noise (a phone that drifted across a boundary it was never inside), and writing it would
--     let a stray event manufacture a departure out of nothing.
--   * It NEVER touches `status`. A departure is an input to the presence verdict, not a verdict
--     itself, and status is where 'missed' lives. Keeping this function unable to write status is
--     what makes it structurally impossible for a GPS wobble to mark an athlete missed.
--
-- Idempotent on repeat: the FIRST departure of the current stay is the one that counts, so a
-- duplicate Exit delivery cannot walk the timestamp forward and rescue a real early departure.
create or replace function record_departure(p_instance uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_resp commitment_responses; v_inst commitment_instances; v_c commitments;
  v_at timestamptz := now(); v_hi timestamptz;
begin
  if not vc_enabled() then
    raise exception 'Verified Commitments is currently switched off';
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
  if not has_verification_consent(auth.uid()) then
    raise exception 'location verification requires guardian or institutional consent';
  end if;

  -- An exit for a commitment that was never arrived at tells us nothing. Silent no-op rather than
  -- an exception: the background task is fire-and-forget and has no one to report an error to.
  if v_resp.arrived_at is null then
    return jsonb_build_object('recorded', false, 'reason', 'no arrival to depart from');
  end if;

  -- Clamp forward only (see 0139). A departure can legitimately land after the session ends; it
  -- can never legitimately precede the arrival it belongs to.
  v_hi := coalesce(v_inst.ends_at, v_inst.starts_at + interval '3 hours') + interval '1 hour';
  if v_at > v_hi then v_at := v_hi; end if;
  if v_at < v_resp.arrived_at then v_at := v_resp.arrived_at; end if;

  update commitment_responses set
    departed_at = coalesce(departed_at, v_at),
    updated_at  = now()
  where id = v_resp.id;

  select r.* into v_resp from commitment_responses r where r.id = v_resp.id;
  return jsonb_build_object(
    'recorded', true,
    'departed_at', v_resp.departed_at,
    'presence', commitment_presence(v_resp.arrived_at, v_resp.departed_at, v_c.min_dwell_min));
end $$;

-- ---------------------------------------------------------------- verify_arrival
-- Identical to 0207 plus ONE line: `departed_at = null` on a confirmed arrival.
--
-- That line is half the debounce. A re-entry erases the departure that preceded it, so an athlete
-- whose phone wobbled out of a classroom and back in is left exactly as they were: arrived, no
-- departure, no accusation, and no record that anything happened at all. It also makes the
-- genuine leave-and-return case correct, since the stay is measured from the ORIGINAL arrival
-- (arrived_at is coalesced and never moves).
create or replace function verify_arrival(
  p_instance uuid, p_source text, p_within boolean, p_reason text
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_resp commitment_responses; v_inst commitment_instances; v_c commitments;
  v_at timestamptz := now(); v_lo timestamptz; v_hi timestamptz;
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

  -- Clamp the stamp into a sane window (see 0139).
  v_lo := coalesce(v_inst.arrive_by_at, v_inst.starts_at) - interval '4 hours';
  v_hi := coalesce(v_inst.ends_at, v_inst.starts_at + interval '3 hours') + interval '1 hour';
  if v_at < v_lo then v_at := v_lo; end if;
  if v_at > v_hi then v_at := v_hi; end if;

  if p_within then
    update commitment_responses set
      arrived_at = coalesce(arrived_at, v_at),
      arrival_source = coalesce(arrival_source, p_source),
      acknowledged_at = coalesce(acknowledged_at, v_at),
      -- THE 0208 LINE. A re-entry refutes the departure that preceded it.
      departed_at = null,
      status = case when status in ('pending', 'acknowledged', 'missed', 'unverified')
                    then 'arrived' else status end,
      unverified_reason = null,
      updated_at = now()
    where id = v_resp.id;
  else
    -- NEVER 'missed'. Absence of evidence is not evidence of absence.
    update commitment_responses set
      status = case when status in ('pending', 'missed') then 'unverified' else status end,
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

-- ---------------------------------------------------------------- my_commitments
-- Identical to 0141 plus `departed_at` and `presence`. The client had `min_dwell_min` and
-- `arrived_at` already and could have computed nothing useful from them, because the missing
-- fact was always the departure.
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
      'opens_min', c.opens_min, 'starts_min', c.starts_min, 'ends_min', c.ends_min,
      'respond_by_min', c.respond_by_min, 'arrive_by_min', c.arrive_by_min,
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
    ) as x
    from commitment_responses r
    join commitment_instances i on i.id = r.instance_id
    join commitments c on c.id = i.commitment_id
    where r.athlete_id = auth.uid()
      and i.occurs_on between p_from and p_to
      and vc_enabled()
  ) s;
$$;

-- ---------------------------------------------------------------- grants
-- record_departure is athlete-callable for the same reason verify_arrival is: the background task
-- runs as the athlete's own session and there is no service-role context at 5:43 AM.
do $$ declare f text; begin
  foreach f in array array[
    'presence_exit_grace()',
    'commitment_presence(timestamptz,timestamptz,smallint,timestamptz)',
    'record_departure(uuid)',
    'verify_arrival(uuid,text,boolean,text)',
    'my_commitments(date,date)'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
