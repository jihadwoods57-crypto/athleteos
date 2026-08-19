-- 0207: geofence + roll-call hardening (2026-08-19 audit).
--
-- Two gaps the 0141 kill switch left, and one flag nobody ever seeded:
--
--   THE SWITCH DID NOT COVER THE GEOFENCE PATH. vc_enabled() gates the read, materialize and
--   reminder paths -- but not my_armable_geofences (so already-armed phones kept arming fresh
--   regions) and not verify_arrival (so crossings kept writing). With the switch thrown, the
--   card went quiet while location verification kept running: the exact opposite of what a
--   kill switch promises. Both functions now check the flag. my_armable_geofences returns []
--   (phones disarm on their next refresh); verify_arrival refuses loudly.
--
--   feature_flags.rollcall_lockscreen HAD NO SEED. roll-call-ack and commitment-escalation
--   both fail OPEN when the row is absent (deliberate), which meant the row only ever existed
--   if someone remembered a manual INSERT -- so the documented staged rollout was impossible.
--   Seeded here exactly like 0141 seeded verified_commitments: present, on, controllable.

-- ---------------------------------------------------------------- the missing seed
insert into public.feature_flags (name, description, default_on, kill_switch)
values ('rollcall_lockscreen',
        'Roll call lock-screen ack + escalation ladder (signed-code ack, breakthrough, coach digest).',
        true, false)
on conflict (name) do nothing;

-- ---------------------------------------------------------------- my_armable_geofences
-- Identical to 0139 plus the vc_enabled() term. Off means []: the next refreshGeofences()
-- disarms everything and registers nothing, on every client version in the field.
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
    where vc_enabled()
      and r.athlete_id = auth.uid()
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

-- ---------------------------------------------------------------- verify_arrival
-- Identical to 0139 plus the vc_enabled() gate at the top. A crossing delivered after the
-- switch is thrown must not write.
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
    'arrival_source', v_resp.arrival_source, 'unverified_reason', v_resp.unverified_reason);
end $$;

-- ---------------------------------------------------------------- upsert_commitment + escalation
-- 0145 added commitments.escalation and the edge-fn ladder that reads it -- and upsert_commitment
-- was never taught the column, so no client could ever switch a rung on: the punitive half of the
-- ladder (claim_missed) ran while the notifying half (breakthrough, coach digest) was dead for
-- every commitment in existence. Identical to 0138's function plus the one column.
create or replace function upsert_commitment(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_team uuid; v_practice uuid; v_role text;
begin
  v_id       := nullif(p->>'id','')::uuid;
  v_team     := nullif(p->>'team_id','')::uuid;
  v_practice := nullif(p->>'practice_id','')::uuid;

  if not commitment_owner_is_staff(v_team, v_practice) then
    raise exception 'not authorized for this team or practice';
  end if;

  if v_team is not null then
    select role::text into v_role from team_staff
     where team_id = v_team and staff_id = auth.uid() and status = 'active';
    if coalesce(v_role, 'head_coach') not in
       ('head_coach','coordinator','assistant','s_and_c','team_admin') then
      raise exception 'role % may not schedule commitments', v_role;
    end if;
  end if;

  if v_id is not null
     and exists (select 1 from commitments where id = v_id)
     and not exists (
       select 1 from commitments c where c.id = v_id
         and c.team_id is not distinct from v_team
         and c.practice_id is not distinct from v_practice
     ) then
    raise exception 'commitment does not belong to this team or practice';
  end if;

  insert into commitments (
    id, team_id, practice_id, type, title, message, action_label,
    audience_kind, audience_value, repeat_days, starts_on, ends_on, timezone,
    starts_min, ends_min, respond_by_min, opens_min,
    location_id, arrive_by_min, arrival_grace_min, min_dwell_min,
    linked_commitment_id, reminder_offsets_min, escalation, active, created_by
  ) values (
    coalesce(v_id, gen_random_uuid()), v_team, v_practice,
    p->>'type', p->>'title', nullif(p->>'message',''), nullif(p->>'action_label',''),
    p->>'audience_kind', nullif(p->>'audience_value','')::uuid,
    coalesce((select array_agg(x::smallint) from jsonb_array_elements_text(p->'repeat_days') x), '{}'::smallint[]),
    coalesce((p->>'starts_on')::date, (now() at time zone 'utc')::date),
    nullif(p->>'ends_on','')::date,
    coalesce(nullif(p->>'timezone',''), 'America/New_York'),
    (p->>'starts_min')::smallint, nullif(p->>'ends_min','')::smallint,
    nullif(p->>'respond_by_min','')::smallint, nullif(p->>'opens_min','')::smallint,
    nullif(p->>'location_id','')::uuid, nullif(p->>'arrive_by_min','')::smallint,
    coalesce(nullif(p->>'arrival_grace_min','')::smallint, 10::smallint),
    nullif(p->>'min_dwell_min','')::smallint,
    nullif(p->>'linked_commitment_id','')::uuid,
    coalesce((select array_agg(x::smallint) from jsonb_array_elements_text(p->'reminder_offsets_min') x), '{15,5}'::smallint[]),
    case when jsonb_typeof(p->'escalation') = 'object' then p->'escalation' else '{}'::jsonb end,
    coalesce((p->>'active')::boolean, true), auth.uid()
  )
  on conflict (id) do update set
    type = excluded.type, title = excluded.title, message = excluded.message,
    action_label = excluded.action_label, audience_kind = excluded.audience_kind,
    audience_value = excluded.audience_value, repeat_days = excluded.repeat_days,
    starts_on = excluded.starts_on, ends_on = excluded.ends_on, timezone = excluded.timezone,
    starts_min = excluded.starts_min, ends_min = excluded.ends_min,
    respond_by_min = excluded.respond_by_min, opens_min = excluded.opens_min,
    location_id = excluded.location_id, arrive_by_min = excluded.arrive_by_min,
    arrival_grace_min = excluded.arrival_grace_min, min_dwell_min = excluded.min_dwell_min,
    linked_commitment_id = excluded.linked_commitment_id,
    reminder_offsets_min = excluded.reminder_offsets_min,
    escalation = excluded.escalation,
    active = excluded.active, updated_at = now()
  returning id into v_id;

  return v_id;
end $$;
