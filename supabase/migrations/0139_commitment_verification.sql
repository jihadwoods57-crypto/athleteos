-- OnStandard — Verified Commitments (slice 2): arrival verification + the minor consent gate.
-- Spec: docs/superpowers/specs/2026-07-22-verified-commitments-design.md §7
--
-- 0138 created every table and column this needs. This migration adds only BEHAVIOR, because the
-- client half of it (expo-location, background geofencing) requires a new native App Store build
-- and cannot ship over the air the way slice 1 did.
--
-- ⚠ NO COORDINATE CROSSES THIS BOUNDARY.
-- verify_arrival takes a BOOLEAN — "was the phone inside the circle, yes or no" — computed on the
-- device against a geofence the coach defined. There is no lat/lng parameter and no column to put
-- one in. The server records a verdict and a timestamp. That is the whole privacy design: even a
-- full database compromise yields "arrived 5:43 AM", never a movement history.
--
-- ⚠ 'unverified' IS NOT 'missed'.
-- A dead battery, a revoked permission, weak GPS indoors, or a session moved to another field all
-- land on 'unverified' with a reason. The scoring engine drops unverified signals OUT of the
-- denominator (0138 accountability_raw) rather than counting them as failures. Nothing in this
-- file can write 'missed' — only staff_set_response can, deliberately and attributably.
--
-- GUARDRAIL: authored + statically reviewed; NOT applied to live here.

-- ---------------------------------------------------------------- consent
-- Fail closed. is_minor() (0006) already treats an unknown/NULL base_age as a minor, so an athlete
-- who never entered their age is protected by default rather than exposed by default.
create or replace function has_verification_consent(p_athlete uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select (not is_minor(p_athlete))
      or exists (select 1 from verification_consent vc
                  where vc.athlete_id = p_athlete and vc.revoked_at is null);
$$;

-- A guardian grant rides the existing guardianship link (0008/0050). An institutional grant is an
-- athletic director asserting the paperwork a program already collects at the start of a season —
-- allowed only for team staff, and written to admin_audit_log so the assertion has a name on it.
create or replace function grant_verification_consent(
  p_athlete uuid, p_kind text, p_team uuid, p_note text
) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if p_kind not in ('guardian', 'institutional') then
    raise exception 'consent kind must be guardian or institutional';
  end if;

  if p_kind = 'guardian' then
    if not is_guardian_of(p_athlete) then
      raise exception 'only a verified guardian may grant guardian consent';
    end if;
  else
    if p_team is null or not is_team_staff(p_team) then
      raise exception 'institutional consent requires team staff';
    end if;
    if not exists (select 1 from team_members
                    where team_id = p_team and athlete_id = p_athlete and status = 'active') then
      raise exception 'athlete is not on this team';
    end if;
  end if;

  insert into verification_consent (athlete_id, kind, granted_by, scope_team, note)
  values (p_athlete, p_kind, auth.uid(), p_team, nullif(left(coalesce(p_note, ''), 200), ''))
  returning id into v_id;

  -- The audit row is the point of the institutional path: someone put their name on the claim.
  if p_kind = 'institutional' then
    begin
      insert into public.admin_audit_log (actor_id, action, target, after)
      values (auth.uid(), 'verification_consent.institutional', p_athlete::text,
              jsonb_build_object('team_id', p_team, 'note', p_note, 'consent_id', v_id));
    exception when others then null;  -- never block consent on an audit-shape change
    end;
  end if;

  return v_id;
end $$;

-- The athlete themselves, or the guardian who granted it, can revoke. Revocation drops the athlete
-- back to tap-to-verify and then to nothing — it never deletes their existing history, because
-- erasing a record the coach already acted on would be its own kind of dishonesty.
create or replace function revoke_verification_consent(p_athlete uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_athlete <> auth.uid() and not is_guardian_of(p_athlete) then
    raise exception 'not authorized to revoke this consent';
  end if;
  update verification_consent
     set revoked_at = now()
   where athlete_id = p_athlete and revoked_at is null;
end $$;

-- ---------------------------------------------------------------- verify_arrival
-- p_within is the DEVICE's answer to "is this phone inside the coach's circle right now".
-- p_source: 'geofence' (the OS woke us on a boundary crossing) | 'manual' (the athlete tapped
-- "I'm here" and we took one fix).
create or replace function verify_arrival(
  p_instance uuid, p_source text, p_within boolean, p_reason text
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_resp commitment_responses; v_inst commitment_instances; v_c commitments;
  v_at timestamptz := now(); v_lo timestamptz; v_hi timestamptz;
begin
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

  -- ⚠ CONSENT GATE. Nothing location-derived is recorded for a minor without consent.
  if not has_verification_consent(auth.uid()) then
    raise exception 'location verification requires guardian or institutional consent';
  end if;

  -- Clamp the stamp into a sane window. iOS delivers region crossings on its own schedule, and a
  -- delivery that arrives hours late must not write a timestamp that makes an athlete look early
  -- or absurdly late. Outside the window we still record the arrival, at the window edge.
  v_lo := coalesce(v_inst.arrive_by_at, v_inst.starts_at) - interval '4 hours';
  v_hi := coalesce(v_inst.ends_at, v_inst.starts_at + interval '3 hours') + interval '1 hour';
  if v_at < v_lo then v_at := v_lo; end if;
  if v_at > v_hi then v_at := v_hi; end if;

  if p_within then
    update commitment_responses set
      arrived_at = coalesce(arrived_at, v_at),
      arrival_source = coalesce(arrival_source, p_source),
      acknowledged_at = coalesce(acknowledged_at, v_at),   -- being there implies being up
      status = case when status in ('pending', 'acknowledged', 'missed', 'unverified')
                    then 'arrived' else status end,
      unverified_reason = null,
      updated_at = now()
    where id = v_resp.id;
  else
    -- NEVER 'missed'. A signal we could not verify is an absence of evidence, not evidence of
    -- absence, and the athlete gets a one-tap way to say so.
    update commitment_responses set
      status = case when status in ('pending', 'missed') then 'unverified' else status end,
      unverified_reason = nullif(left(coalesce(p_reason, 'Could not confirm the location'), 60), ''),
      updated_at = now()
    where id = v_resp.id;
  end if;

  select r.* into v_resp from commitment_responses r where r.id = v_resp.id;
  return jsonb_build_object(
    'status', v_resp.status, 'arrived_at', v_resp.arrived_at,
    'arrival_source', v_resp.arrival_source, 'unverified_reason', v_resp.unverified_reason);
end $$;

-- ---------------------------------------------------------------- complete_commitment
-- Completion is a SEPARATE signal from arrival, and this function is where that separation is
-- enforced: 'dwell' completion requires a real arrival plus the coach's minimum time on site.
-- A 'manual' tap is always allowed — an athlete whose phone died mid-session must be able to say
-- they finished, and the source column records which of the two it was so nobody is misled.
create or replace function complete_commitment(p_instance uuid, p_source text) returns timestamptz
language plpgsql security definer set search_path = public as $$
declare v_resp commitment_responses; v_c commitments; v_inst commitment_instances; v_at timestamptz := now();
begin
  if p_source not in ('dwell', 'manual') then
    raise exception 'completion source must be dwell or manual';
  end if;

  select r.* into v_resp from commitment_responses r
   where r.instance_id = p_instance and r.athlete_id = auth.uid();
  if not found then raise exception 'no commitment for you on this instance'; end if;

  select * into v_inst from commitment_instances where id = p_instance;
  select * into v_c from commitments where id = v_inst.commitment_id;

  if v_c.type = 'morning_roll_call' then
    raise exception 'a roll call is complete when you respond — there is nothing else to finish';
  end if;

  if p_source = 'dwell' then
    if v_resp.arrived_at is null then
      raise exception 'cannot auto-complete without a verified arrival';
    end if;
    if v_c.min_dwell_min is not null
       and v_at < v_resp.arrived_at + make_interval(mins => v_c.min_dwell_min::int) then
      raise exception 'minimum time on site not met yet';
    end if;
  end if;

  update commitment_responses set
    completed_at = coalesce(completed_at, v_at),
    status = case when status <> 'excused' then 'completed' else status end,
    updated_at = now()
  where id = v_resp.id
  returning completed_at into v_at;

  return v_at;
end $$;

-- ---------------------------------------------------------------- dispute_response
-- "I was there." Flags the row for the coach; it does NOT rewrite the record, because an athlete
-- silently marking their own attendance would make the whole feature worthless. Only staff can
-- correct, and staff_set_response (0138) attributes every correction.
create or replace function dispute_response(p_instance uuid, p_note text) returns void
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  update commitment_responses set
    disputed_at = now(),
    dispute_note = nullif(left(coalesce(p_note, ''), 200), ''),
    updated_at = now()
  where instance_id = p_instance and athlete_id = auth.uid()
  returning id into v_id;
  if v_id is null then raise exception 'no commitment for you on this instance'; end if;
end $$;

-- ---------------------------------------------------------------- armable instances
-- What the device should watch, and nothing more. Returns ONLY instances that are inside their
-- arming window (starts_at - 2h → end + 30m) — so the app can never register a geofence for an
-- event that is not currently happening, even if a client bug asked it to.
-- The coach's own location IS returned (they chose it and it is on their own schedule); the
-- athlete's position is never sent anywhere.
create or replace function my_armable_geofences(p_limit int default 16) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(x order by x->>'starts_at'), '[]'::jsonb) from (
    select jsonb_build_object(
      'instance_id', i.id,
      'starts_at', i.starts_at,
      'ends_at', coalesce(i.ends_at, i.starts_at + interval '3 hours'),
      'arrive_by_at', i.arrive_by_at,
      'min_dwell_min', c.min_dwell_min,
      'name', cl.name, 'lat', cl.lat, 'lng', cl.lng, 'radius_m', cl.radius_m
    ) as x
    from commitment_responses r
    join commitment_instances i on i.id = r.instance_id
    join commitments c on c.id = i.commitment_id
    join commitment_locations cl on cl.id = c.location_id
    where r.athlete_id = auth.uid()
      and r.arrived_at is null
      and r.status not in ('excused', 'completed')
      and i.status = 'scheduled'
      and now() >= i.starts_at - interval '2 hours'
      and now() <= coalesce(i.ends_at, i.starts_at + interval '3 hours') + interval '30 minutes'
      and has_verification_consent(auth.uid())
    order by i.starts_at
    limit greatest(1, least(coalesce(p_limit, 16), 16))
  ) s;
$$;

-- ---------------------------------------------------------------- grants
do $$ declare f text; begin
  foreach f in array array[
    'has_verification_consent(uuid)',
    'grant_verification_consent(uuid,text,uuid,text)',
    'revoke_verification_consent(uuid)',
    'verify_arrival(uuid,text,boolean,text)',
    'complete_commitment(uuid,text)',
    'dispute_response(uuid,text)',
    'my_armable_geofences(int)'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
