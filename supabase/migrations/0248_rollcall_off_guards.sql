-- 0248 — every roll call path honours the kill switch (founder, 2026-09-24: "Take roll call off the
-- app but don't permanently delete it. It's not working right now but i want to revisit it in the
-- future.")
--
-- The switch is the same one 0217 used: `feature_flags.verified_commitments.kill_switch`, read
-- through vc_enabled(). Prod has exactly one active commitment (the morning roll call), so it takes
-- off exactly the roll call.
--
-- 0217's lesson was "grep every claim/cron path for the guard, not just the reads". v2 (0242) and
-- v3 (0247) added paths since, and most carry the guard already (claim_rollcall_card_opens,
-- claim_rollcall_notices, rollcall_notify_claim, rollcall_arm_remind_claim, rollcall_remind_rows_svc,
-- materialize_rollcalls_ahead / _svc, my_commitments, rollcall_upcoming, rollcall_team_board,
-- rollcall_history, verify_arrival, my_armable_geofences; commitment-escalation exits on the flag
-- before its first claim). The audit found eight that did not. Each is recreated below from its
-- CURRENT body (latest migration that defines it), with one guard added and nothing else changed:
--
--   rollcall_nudge_claim (0211)            coach "Nudge" / "Ping": wrote bell rows and pushed
--   rollcall_schedule_notice_claim (0216)  coach "Tell athletes" after a skip: wrote bell rows
--   rollcall_window_rows_svc (0242)        roll-call-ack `codes`: minted alarm check-in codes
--   rollcall_live_update_targets (0242)    roll-call-ack team fan-out: Live Activity updates
--   claim_live_team_updates (0242)         the same fan-out's claim
--   claim_rollcall_card_starts (0242)      Live Activity start (reached only behind the guarded
--                                          claim_due_commitment_reminders; guarded anyway)
--   rollcall_arming (0247)                 the coach hub's "who will ring" read
--   rollcall_summary (0212)                the coach's per-morning results read
--
-- Deliberately NOT gated (same stance as 0217):
--   ack_commitment / ack_commitment_by_token — a tap on a push sent before the switch is still
--     recorded. Refusing an athlete who genuinely answered is worse than recording it.
--   claim_live_answered_update — the answering athlete's OWN card turning answered is part of that
--     answer. (No card is started while off, so in practice there is none.)
--   set_wake_alarm_armed / _svc — a phone reporting that it REMOVED its alarm must be recorded.
--   claim_closed_rollcalls, claim_rollcall_summary, rollcall_digest — commitment-escalation only,
--     which returns { skipped: 'flag off' } before calling any of them.
--
-- Re-runnable: create or replace keeps every grant, and the grants are restated exactly as the
-- migrations that made them left them. Nothing is dropped; turning the switch back off restores
-- every behaviour byte for byte.
--     off:  update feature_flags set kill_switch = true  where name = 'verified_commitments';
--     back: update feature_flags set kill_switch = false where name = 'verified_commitments';

-- ================================================================ 1. coach nudge (push)
create or replace function rollcall_nudge_claim(
  p_instance uuid, p_coach uuid, p_cooldown_min int default 10, p_athlete uuid default null
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_claimed boolean := false;
  v_title text;
  v_label text;
  v_deadline timestamptz;
  v_targets uuid[];
begin
  if not vc_enabled(p_coach) then                                         -- 0248
    return jsonb_build_object('ok', false, 'reason', 'flag_off');
  end if;

  if not rollcall_coach_authorized(p_instance, p_coach) then
    return jsonb_build_object('ok', false, 'reason', 'not_authorized');
  end if;

  if p_athlete is not null then
    -- Claim THIS athlete's cooldown. The conditional UPDATE is the whole race guard.
    update commitment_responses r
       set last_nudge_at = now(), updated_at = now()
      from commitment_instances i
     where r.instance_id = p_instance and r.athlete_id = p_athlete
       and i.id = r.instance_id and i.status = 'scheduled'
       and r.acknowledged_at is null and r.status in ('pending','missed')
       and (r.last_nudge_at is null
            or r.last_nudge_at < now() - make_interval(mins => greatest(1, p_cooldown_min)))
    returning true into v_claimed;
    if not coalesce(v_claimed, false) then
      if not exists (select 1 from commitment_instances where id = p_instance and status = 'scheduled') then
        return jsonb_build_object('ok', false, 'reason', 'no_instance');
      end if;
      if exists (select 1 from commitment_responses
                  where instance_id = p_instance and athlete_id = p_athlete
                    and acknowledged_at is null and status in ('pending','missed')) then
        return jsonb_build_object('ok', false, 'reason', 'rate_limited');
      end if;
      -- Already answered (or excused): a real success with nobody to reach, same as the
      -- roster path below returning an empty list.
      select coalesce(c.title, 'Roll call'), c.action_label, i.respond_by_at
        into v_title, v_label, v_deadline
        from commitment_instances i join commitments c on c.id = i.commitment_id where i.id = p_instance;
      return jsonb_build_object('ok', true, 'title', v_title, 'action_label', v_label,
        'respond_by_at', v_deadline, 'athlete_ids', '[]'::jsonb);
    end if;
    v_targets := array[p_athlete];
  else
    update commitment_instances i
       set last_nudge_at = now()
     where i.id = p_instance
       and i.status = 'scheduled'
       and (i.last_nudge_at is null
            or i.last_nudge_at < now() - make_interval(mins => greatest(1, p_cooldown_min)))
    returning true into v_claimed;

    if not coalesce(v_claimed, false) then
      if exists (select 1 from commitment_instances where id = p_instance and status = 'scheduled') then
        return jsonb_build_object('ok', false, 'reason', 'rate_limited');
      end if;
      return jsonb_build_object('ok', false, 'reason', 'no_instance');
    end if;

    select coalesce(array_agg(r.athlete_id), array[]::uuid[])
      into v_targets
      from commitment_responses r
     where r.instance_id = p_instance
       and r.acknowledged_at is null
       and r.status in ('pending', 'missed');
  end if;

  select coalesce(c.title, 'Roll call'), c.action_label, i.respond_by_at
    into v_title, v_label, v_deadline
    from commitment_instances i join commitments c on c.id = i.commitment_id
   where i.id = p_instance;

  if array_length(v_targets, 1) is not null then
    insert into notifications (user_id, kind, title, body)
    select t, 'commitment_reminder', v_title, 'Your coach is still waiting on your response.'
      from unnest(v_targets) t;
  end if;

  return jsonb_build_object(
    'ok', true,
    'title', v_title,
    'action_label', v_label,
    'respond_by_at', v_deadline,
    'closes_at', (select rollcall_closes_at(c.type, i.respond_by_at, i.starts_at, i.ends_at)
                    from commitment_instances i join commitments c on c.id = i.commitment_id
                   where i.id = p_instance),
    'athlete_ids', to_jsonb(coalesce(v_targets, array[]::uuid[]))
  );
end $$;
revoke all on function rollcall_nudge_claim(uuid, uuid, int, uuid) from public, anon, authenticated;

-- ================================================================ 2. schedule notice (bell rows)
create or replace function rollcall_schedule_notice_claim(
  p_instance uuid, p_coach uuid, p_cooldown_min int default 10
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  i commitment_instances; c commitments;
  v_claimed boolean := false;
  v_targets uuid[];
  v_coach text; v_today date; v_day text; v_body text;
begin
  if not vc_enabled(p_coach) then                                         -- 0248
    return jsonb_build_object('ok', false, 'reason', 'flag_off');
  end if;
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

-- ================================================================ 3. alarm check-in codes
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
     and vc_enabled(p_athlete)                                             -- 0248
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

-- ================================================================ 4. Live Activity team fan-out
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
  where t.instance_id = p_instance and t.kind = 'update' and t.revoked_at is null
    and vc_enabled(t.athlete_id);                                          -- 0248
$$;

create or replace function claim_live_team_updates(p_instance uuid, p_athletes uuid[], p_gap_sec int default 60)
returns setof uuid
language sql security definer set search_path = public as $$
  update rollcall_live_tokens t set last_update_at = now()
   where t.instance_id = p_instance and t.kind = 'update' and t.revoked_at is null
     and t.athlete_id = any(p_athletes)
     and vc_enabled(t.athlete_id)                                          -- 0248
     and (p_gap_sec <= 0 or t.last_update_at is null
          or t.last_update_at <= now() - make_interval(secs => p_gap_sec))
  returning t.athlete_id;
$$;

-- ================================================================ 5. Live Activity start
create or replace function claim_rollcall_card_starts(p_instance uuid, p_athletes uuid[])
returns setof uuid
language sql security definer set search_path = public as $$
  update commitment_responses r set card_started_at = now()
   from commitment_instances i, commitments c
   where i.id = p_instance and c.id = i.commitment_id
     and r.instance_id = p_instance and r.athlete_id = any(p_athletes)
     and vc_enabled(r.athlete_id)                                          -- 0248
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

-- ================================================================ 6. the coach hub's arming read
-- Same refusal rollcall_team_board and rollcall_history (0242) already give while off.
create or replace function rollcall_arming(p_instance uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare i commitment_instances; c commitments;
begin
  if not vc_enabled() then raise exception 'Verified Commitments is currently switched off'; end if;   -- 0248
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

-- ================================================================ 7. the coach's results read
-- Empty while off, the way rollcall_upcoming (0217) is: a list read answers "nothing", not an error.
create or replace function rollcall_summary(p_commitment uuid, p_days int default 14)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare c commitments;
begin
  if not vc_enabled() then return '[]'::jsonb; end if;                     -- 0248
  select * into c from commitments where id = p_commitment;
  if not found or not commitment_owner_is_staff(c.team_id, c.practice_id) then
    raise exception 'not authorized';
  end if;
  return (
    select coalesce(jsonb_agg(x order by x->>'occurs_on' desc), '[]'::jsonb) from (
      select jsonb_build_object(
        'instance_id', i.id, 'occurs_on', i.occurs_on, 'instance_status', i.status,
        'starts_at', i.starts_at, 'respond_by_at', i.respond_by_at,
        'closes_at', rollcall_closes_at(c.type, i.respond_by_at, i.starts_at, i.ends_at),
        'total', count(r.id) filter (where r.status <> 'excused'),
        'on_standard', count(r.id) filter (where v.verdict = 'on_standard'),
        'checked_in',  count(r.id) filter (where v.verdict = 'on_standard' and r.ack_source in ('app','lockscreen')),
        'overrides',   count(r.id) filter (where r.ack_source in ('override','staff')),
        'accepted',    count(r.id) filter (where r.ack_source = 'review_accepted'),
        'review',      count(r.id) filter (where v.verdict = 'review'),
        'late',        count(r.id) filter (where v.verdict = 'late'),
        'missed',      count(r.id) filter (where v.verdict = 'missed'),
        'pending',     count(r.id) filter (where v.verdict = 'pending'),
        'excused',     count(r.id) filter (where v.verdict = 'excused')
      ) as x
      from commitment_instances i
      left join commitment_responses r on r.instance_id = i.id
      left join lateral (select rollcall_verdict(r.status, r.acknowledged_at,
                                 coalesce(i.respond_by_at, i.starts_at),
                                 rollcall_closes_at(c.type, i.respond_by_at, i.starts_at, i.ends_at), now(),
                                 r.ack_source, r.sync_review, r.review_resolution) as verdict) v on true
      where i.commitment_id = p_commitment
        and i.occurs_on between ((now() at time zone c.timezone)::date - greatest(1, least(p_days, 90)))
                            and (now() at time zone c.timezone)::date
      group by i.id
    ) s
  );
end $$;

-- ================================================================ grants (restated, unchanged)
do $$ declare f text; begin
  foreach f in array array['rollcall_arming(uuid)', 'rollcall_summary(uuid,int)'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
do $$ declare f text; begin
  foreach f in array array['rollcall_window_rows_svc(uuid,int)', 'rollcall_live_update_targets(uuid)',
                           'claim_live_team_updates(uuid,uuid[],int)', 'claim_rollcall_card_starts(uuid,uuid[])'] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;
