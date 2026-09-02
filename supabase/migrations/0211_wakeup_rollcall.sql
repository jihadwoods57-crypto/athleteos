-- OnStandard — Wake-Up Roll Call (2026-09-01).
--
-- WHAT THIS IS
-- The coach's morning group text ("Everyone up and ready to go? Scout meet at 7.") turned into a
-- measurable roll call. It is NOT a new primitive: a Wake-Up Roll Call is a `commitments` row of
-- type 'morning_roll_call' (0138), and everything below extends that row and its instances and
-- responses. The lock-screen "I'm Up" (0144), the escalation ladder (0145/0146) and the coach's
-- "Nudge them" (0209) all keep working unchanged; this migration gives them the four things the
-- product was missing:
--
--   1. A VERDICT. Until now a 6:03 tap and a 6:40 tap were both 'acknowledged'. rollcall_verdict()
--      is a pure function of the timestamps (on_standard | late | pending | missed | excused),
--      mirrored byte-for-byte in proto js/commitments.js so the athlete's card and the coach's
--      board cannot disagree. It lives beside commitment_presence (0208) and follows its rules.
--   2. WINDOWS ON THE SERVER. Both ack paths now refuse a tap before the roll call opens and after
--      it closes, so an athlete cannot answer a 6 AM roll call at midnight, and a late answer is
--      recorded as late rather than silently upgraded. A closed roll call is a MISS; a late answer
--      inside the window is a LATE, and both are kept forever as what they are.
--   3. SCHEDULE HONESTY. Editing a roll call's time re-times every not-yet-started occurrence;
--      pausing cancels them; resuming re-creates them. And occurrences are now materialized by the
--      reminder cron itself (service role), not only when someone opens the app, so a team whose
--      phones stayed in their pockets all day still gets tomorrow's 6 AM push.
--   4. ONE-MINUTE CRONS. A five-minute grace period cannot be enforced by a five-minute cron.
--
-- Also: the coach message widens from 200 to 1000 characters (it is the whole group text now),
-- responses record HOW they were answered (app / lock screen / staff), a coach can ping ONE
-- athlete with its own cooldown, edit today's message without touching the standing rule, and
-- read a 14-day summary per roll call.
--
-- ⚠ THE DAILY SCORE IS NOT TOUCHED. accountability_raw gains three COUNTS (wake_on_standard,
-- wake_late, wake_missed) and its earned/possible arithmetic is byte-identical to 0138. Whether a
-- late wake-up should cost points is a founder decision; the counts make it a one-line change in
-- exactly one place when that decision lands. See docs/go-live/WAKEUP-ROLLCALL.md.
--
-- Migration numbering: 0210 was the last authored. GUARDRAIL: authored + statically reviewed;
-- applied to a disposable project for the suite, NOT to live here.

-- ================================================================ 1. columns

-- The morning message IS the group text. 200 chars held one sentence; a real one holds six.
alter table commitments drop constraint if exists commitments_message_check;
alter table commitments add constraint commitments_message_check
  check (message is null or char_length(message) <= 1000);
alter table commitment_instances drop constraint if exists commitment_instances_message_override_check;
alter table commitment_instances add constraint commitment_instances_message_override_check
  check (message_override is null or char_length(message_override) <= 1000);

-- How the answer arrived. Additive and nullable: rows from before today simply do not say.
alter table commitment_responses add column if not exists ack_source text
  check (ack_source is null or ack_source in ('app','lockscreen','staff'));
-- The per-ATHLETE ping cooldown (0209's last_nudge_at on the instance is the per-ROSTER one).
alter table commitment_responses add column if not exists last_nudge_at timestamptz;
-- When the first push for this response was claimed. Delivery metadata, never a compliance input:
-- the verdict compares the answer to the deadline and nothing else.
alter table commitment_responses add column if not exists first_notified_at timestamptz;

-- ================================================================ 2. pure window + verdict helpers
-- Every input is an argument, so each is testable without a row and cannot drift between the
-- athlete read, the coach read, the ack RPCs and the cron claims. All four call THESE.

-- When the card appears and the RPC starts accepting a tap. Mirrors opensMinFor() in
-- proto js/commitments.js: the coach's explicit opens_min, else an hour before the deadline.
create or replace function commitment_opens_at(
  p_starts_at timestamptz, p_respond_by_at timestamptz, p_starts_min smallint, p_opens_min smallint
) returns timestamptz language sql immutable set search_path = public as $$
  select case
    when p_opens_min is null then coalesce(p_respond_by_at, p_starts_at) - interval '60 minutes'
    else p_starts_at + make_interval(mins => (p_opens_min - p_starts_min)::int)
  end;
$$;

-- When a roll call stops accepting answers. The coach's ends_min wins; a wake-up with none closes
-- two hours after its deadline (a 7:30 answer to a 6:00 roll call is LATE and worth recording; a
-- 2 PM one is not an answer to that morning). Other types keep their pre-0211 behaviour: no
-- ends_at means no close.
create or replace function rollcall_closes_at(
  p_type text, p_respond_by_at timestamptz, p_starts_at timestamptz, p_ends_at timestamptz
) returns timestamptz language sql immutable set search_path = public as $$
  select coalesce(p_ends_at,
    case when p_type = 'morning_roll_call'
         then coalesce(p_respond_by_at, p_starts_at) + interval '120 minutes'
         else null end);
$$;

-- THE verdict. `p_deadline_at` is coalesce(respond_by_at, starts_at) at every call site.
--   excused     → the coach removed them from the count
--   on_standard → answered at or before the deadline
--   late        → answered after it
--   pending     → not answered, deadline still ahead
--   missed      → not answered, deadline behind (still convertible to 'late' until it closes)
-- 'unverified' is an ARRIVAL verdict (0139) and never a wake-up one: a tap is a tap.
create or replace function rollcall_verdict(
  p_status text, p_acknowledged_at timestamptz, p_deadline_at timestamptz, p_now timestamptz default now()
) returns text language sql immutable set search_path = public as $$
  select case
    when p_status = 'excused' then 'excused'
    when p_acknowledged_at is not null then
      case when p_deadline_at is null or p_acknowledged_at <= p_deadline_at then 'on_standard' else 'late' end
    when p_deadline_at is null or p_now < p_deadline_at then 'pending'
    else 'missed'
  end;
$$;

-- Whole minutes late, rounded UP so a 6:05:01 answer to a 6:05 deadline reads "1 min", never "0".
create or replace function rollcall_late_min(p_acknowledged_at timestamptz, p_deadline_at timestamptz)
returns integer language sql immutable set search_path = public as $$
  select case
    when p_acknowledged_at is null or p_deadline_at is null or p_acknowledged_at <= p_deadline_at then null
    else ceil(extract(epoch from (p_acknowledged_at - p_deadline_at)) / 60.0)::int
  end;
$$;

comment on function rollcall_verdict(text, timestamptz, timestamptz, timestamptz) is
  'Wake-up verdict: excused | on_standard | late | pending | missed. Pure. Mirrored in proto js/commitments.js rollcallVerdict().';

-- ================================================================ 3. the two ack paths, windowed
-- Both keep the 0138 rule that the FIRST answer stands forever (a second tap returns the first
-- stamp and writes nothing), and add the window. An already-answered row is returned even when the
-- window has since closed, so a retry after the fact is idempotent rather than an error.

create or replace function ack_commitment(p_instance uuid) returns timestamptz
language plpgsql security definer set search_path = public as $$
declare v_at timestamptz; v_open timestamptz; v_close timestamptz; v_istatus text;
begin
  select acknowledged_at into v_at
    from commitment_responses where instance_id = p_instance and athlete_id = auth.uid();
  if not found then raise exception 'no commitment for you on this instance'; end if;
  if v_at is not null then return v_at; end if;

  select commitment_opens_at(i.starts_at, i.respond_by_at, c.starts_min, c.opens_min),
         rollcall_closes_at(c.type, i.respond_by_at, i.starts_at, i.ends_at), i.status
    into v_open, v_close, v_istatus
    from commitment_instances i join commitments c on c.id = i.commitment_id
   where i.id = p_instance;
  if v_istatus <> 'scheduled' then raise exception 'this check-in was cancelled'; end if;
  if now() < v_open then raise exception 'not open yet'; end if;
  if v_close is not null and now() > v_close then raise exception 'closed'; end if;

  update commitment_responses
     set acknowledged_at = now(),
         status = case when status in ('pending','missed') then 'acknowledged' else status end,
         ack_source = coalesce(ack_source, 'app'),
         updated_at = now()
   where instance_id = p_instance and athlete_id = auth.uid()
   returning acknowledged_at into v_at;
  return v_at;
end $$;

create or replace function ack_commitment_by_token(p_instance uuid, p_athlete uuid)
returns timestamptz
language plpgsql security definer set search_path = public as $$
declare v_at timestamptz; v_open timestamptz; v_close timestamptz; v_istatus text;
begin
  select acknowledged_at into v_at
    from commitment_responses where instance_id = p_instance and athlete_id = p_athlete;
  if not found then raise exception 'no commitment for this athlete on this instance'; end if;
  if v_at is not null then return v_at; end if;

  select commitment_opens_at(i.starts_at, i.respond_by_at, c.starts_min, c.opens_min),
         rollcall_closes_at(c.type, i.respond_by_at, i.starts_at, i.ends_at), i.status
    into v_open, v_close, v_istatus
    from commitment_instances i join commitments c on c.id = i.commitment_id
   where i.id = p_instance;
  if v_istatus <> 'scheduled' then raise exception 'this check-in was cancelled'; end if;
  if now() < v_open then raise exception 'not open yet'; end if;
  if v_close is not null and now() > v_close then raise exception 'closed'; end if;

  update commitment_responses
     set acknowledged_at = now(),
         status = case when status in ('pending','missed') then 'acknowledged' else status end,
         ack_source = coalesce(ack_source, 'lockscreen'),
         updated_at = now()
   where instance_id = p_instance and athlete_id = p_athlete
   returning acknowledged_at into v_at;
  return v_at;
end $$;
revoke all on function ack_commitment_by_token(uuid, uuid) from public, anon, authenticated;

-- staff_set_response (0138), recreated with ONE addition: a staff correction that stamps an
-- acknowledgement records that it came from staff. Everything else is byte-identical.
create or replace function staff_set_response(p_response uuid, p_status text, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
declare v_ok boolean;
begin
  if p_status not in ('pending','acknowledged','arrived','completed','missed','excused','unverified')
  then raise exception 'bad status %', p_status; end if;

  select commitment_owner_is_staff(c.team_id, c.practice_id) into v_ok
    from commitment_responses r
    join commitment_instances i on i.id = r.instance_id
    join commitments c on c.id = i.commitment_id
   where r.id = p_response;
  if not coalesce(v_ok, false) then raise exception 'not authorized'; end if;

  update commitment_responses set
    status = p_status,
    excused_by     = case when p_status = 'excused' then auth.uid() else excused_by end,
    excused_reason = case when p_status = 'excused'
                          then nullif(left(coalesce(p_reason,''),120),'') else excused_reason end,
    unverified_reason = case when p_status = 'unverified'
                          then nullif(left(coalesce(p_reason,''),60),'') else unverified_reason end,
    corrected_by = auth.uid(), corrected_at = now(),
    acknowledged_at = case when p_status in ('acknowledged','arrived','completed')
                           then coalesce(acknowledged_at, now()) else acknowledged_at end,
    ack_source      = case when p_status in ('acknowledged','arrived','completed') and acknowledged_at is null
                           then 'staff' else ack_source end,
    arrived_at      = case when p_status in ('arrived','completed')
                           then coalesce(arrived_at, now()) else arrived_at end,
    completed_at    = case when p_status = 'completed'
                           then coalesce(completed_at, now()) else completed_at end,
    arrival_source  = case when p_status in ('arrived','completed')
                           then coalesce(arrival_source, 'staff') else arrival_source end,
    updated_at = now()
  where id = p_response;
end $$;

-- ================================================================ 4. materialization
-- The 0141 loop body, lifted into a per-commitment function with NO authorization of its own so
-- both the authenticated path (ensure_commitment_instances, unchanged contract) and the new cron
-- path (materialize_active_commitments, service role) run the identical code. Not granted.
create or replace function materialize_commitment(p_commitment uuid, p_from date, p_to date)
returns integer language plpgsql security definer set search_path = public as $$
declare c commitments; d date; n integer := 0; v_inst uuid; v_last date;
begin
  select * into c from commitments where id = p_commitment and active;
  if not found then return 0; end if;
  d := greatest(p_from, c.starts_on);
  v_last := least(p_to, coalesce(c.ends_on, p_to));
  while d <= v_last loop
    if extract(dow from d)::smallint = any(c.repeat_days) then
      v_inst := null;
      insert into commitment_instances (
        commitment_id, occurs_on, starts_at, ends_at, respond_by_at, arrive_by_at
      ) values (
        c.id, d,
        (d + make_interval(mins => c.starts_min::int)) at time zone c.timezone,
        case when c.ends_min is null then null
             else (d + make_interval(mins => c.ends_min::int)) at time zone c.timezone end,
        case when c.respond_by_min is null then null
             else (d + make_interval(mins => c.respond_by_min::int)) at time zone c.timezone end,
        case when c.arrive_by_min is null then null
             else (d + make_interval(mins => c.arrive_by_min::int)) at time zone c.timezone end
      )
      on conflict (commitment_id, occurs_on) do nothing
      returning id into v_inst;

      if v_inst is not null then
        n := n + 1;
      else
        select id into v_inst from commitment_instances
         where commitment_id = c.id and occurs_on = d;
      end if;

      if v_inst is not null then
        -- Roster reconciliation (0140): everyone in the audience holds a row; a PENDING row for
        -- someone who left is removed; an excused stretch marks the row excused.
        insert into commitment_responses (instance_id, athlete_id)
        select v_inst, a from commitment_audience(c.id) a
        on conflict (instance_id, athlete_id) do nothing;

        delete from commitment_responses r
         where r.instance_id = v_inst
           and r.status = 'pending'
           and r.acknowledged_at is null and r.arrived_at is null and r.completed_at is null
           and r.athlete_id not in (select a from commitment_audience(c.id) a);

        update commitment_responses r
           set status = 'excused',
               excused_reason = coalesce(r.excused_reason, ae.reason, 'Excused'),
               updated_at = now()
          from athlete_exceptions ae
         where r.instance_id = v_inst
           and r.status = 'pending'
           and ae.athlete_id = r.athlete_id
           and d between ae.starts_on and ae.ends_on
           and ((c.team_id is not null and ae.team_id = c.team_id)
             or (c.practice_id is not null and ae.practice_id = c.practice_id));
      end if;
    end if;
    d := d + 1;
  end loop;
  return n;
end $$;
revoke all on function materialize_commitment(uuid, date, date) from public, anon, authenticated;

-- ensure_commitment_instances (0141): same contract, same auth, same herd guard, body delegated.
create or replace function ensure_commitment_instances(
  p_team uuid, p_practice uuid, p_from date, p_to date
) returns integer
language plpgsql security definer set search_path = public as $$
declare c record; n integer := 0;
begin
  if not vc_enabled() then return 0; end if;

  if not commitment_owner_is_staff(p_team, p_practice)
     and not exists (select 1 from team_members
                      where athlete_id = auth.uid() and team_id = p_team and status = 'active')
     and not exists (select 1 from practice_clients
                      where client_id = auth.uid() and practice_id = p_practice and status = 'active')
  then
    raise exception 'not authorized';
  end if;

  if p_from is null or p_to is null or p_to < p_from then return 0; end if;
  if p_to - p_from > 62 then raise exception 'window too large'; end if;

  if not pg_try_advisory_xact_lock(hashtext('vc:' || coalesce(p_team, p_practice)::text)) then
    return 0;
  end if;

  for c in select id from commitments
            where active
              and ((p_team is not null and team_id = p_team)
                or (p_practice is not null and practice_id = p_practice))
  loop
    n := n + materialize_commitment(c.id, p_from, p_to);
  end loop;
  return n;
end $$;

-- The cron's path. Materializes today and tomorrow IN EACH COMMITMENT'S OWN ZONE, so a 6 AM
-- roll call exists before 6 AM whether or not anyone on the team opened the app. Idempotent by
-- construction (on conflict do nothing + the reconcile above), and serialized by a try-lock so two
-- overlapping ticks do the work once. SERVICE ROLE ONLY. Honours only the kill switch: an athlete
-- allow-list is enforced downstream by the claims (vc_enabled(athlete)), not by whether a row exists.
create or replace function materialize_active_commitments() returns integer
language plpgsql security definer set search_path = public as $$
declare c record; n integer := 0; v_today date;
begin
  if exists (select 1 from feature_flags where name = 'verified_commitments' and kill_switch) then
    return 0;
  end if;
  if not pg_try_advisory_xact_lock(hashtext('vc:materialize-all')) then return 0; end if;
  for c in select id, timezone from commitments where active loop
    v_today := (now() at time zone c.timezone)::date;
    n := n + materialize_commitment(c.id, v_today, v_today + 1);
  end loop;
  return n;
end $$;
revoke all on function materialize_active_commitments() from public, anon, authenticated;

-- ================================================================ 5. edits re-time the future
-- Before this, upsert_commitment rewrote the STANDING RULE and left every already-materialized
-- occurrence at its old time: a coach moving 6:00 to 6:30 at 9 PM still fired the 6:00 push. Only
-- occurrences that have not started are touched; anything under way or in the past is history.
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
       or not (extract(dow from i.occurs_on)::smallint = any(c.repeat_days))
       or i.occurs_on < c.starts_on
       or (c.ends_on is not null and i.occurs_on > c.ends_on)
    then
      update commitment_instances set status = 'cancelled' where id = i.id and status <> 'cancelled';
    else
      update commitment_instances set
        status = 'scheduled',
        starts_at     = (i.occurs_on + make_interval(mins => c.starts_min::int)) at time zone c.timezone,
        ends_at       = case when c.ends_min is null then null
                             else (i.occurs_on + make_interval(mins => c.ends_min::int)) at time zone c.timezone end,
        respond_by_at = case when c.respond_by_min is null then null
                             else (i.occurs_on + make_interval(mins => c.respond_by_min::int)) at time zone c.timezone end,
        arrive_by_at  = case when c.arrive_by_min is null then null
                             else (i.occurs_on + make_interval(mins => c.arrive_by_min::int)) at time zone c.timezone end
      where id = i.id;
      -- A re-timed occurrence must remind again at its NEW time. Only untouched pending rows
      -- reset; an answer already given is never un-given.
      update commitment_responses set reminded_offsets = '{}', updated_at = now()
       where instance_id = i.id and status = 'pending' and acknowledged_at is null;
    end if;
    n := n + 1;
  end loop;

  -- A day just added to the rule (or a resumed commitment) needs its next occurrences now,
  -- not whenever someone next opens the app.
  if c.active then perform materialize_commitment(c.id, v_today, v_today + 1); end if;
  return n;
end $$;
revoke all on function resync_commitment_instances(uuid) from public, anon, authenticated;

-- upsert_commitment (0207 body), plus the resync for an EDIT. A create has nothing to re-time,
-- but materializing its first two days here means a roll call scheduled at 9 PM for 6 AM exists
-- for the cron without waiting on anyone's Home screen.
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

  perform resync_commitment_instances(v_id);
  return v_id;
end $$;

-- ================================================================ 6. today's message
-- "Change today's message" edits the OCCURRENCE (commitment_instances.message_override, a column
-- 0138 created and nothing ever wrote), never the standing rule. Null clears it back to the
-- standing message. Staff only, same gate as staff_set_response.
create or replace function set_instance_message(p_instance uuid, p_message text) returns void
language plpgsql security definer set search_path = public as $$
declare v_ok boolean;
begin
  select commitment_owner_is_staff(c.team_id, c.practice_id) into v_ok
    from commitment_instances i join commitments c on c.id = i.commitment_id
   where i.id = p_instance;
  if not coalesce(v_ok, false) then raise exception 'not authorized'; end if;
  update commitment_instances
     set message_override = nullif(left(coalesce(p_message, ''), 1000), '')
   where id = p_instance;
end $$;

-- ================================================================ 7. the reads, with the verdict
-- Every pre-0211 key is preserved (the RLS suite's payload-contract probes pin them). New keys are
-- ADDED: closes_at / opens_at / grace_min on the instance, verdict / late_min / ack_source /
-- last_nudge_at on the response. A pre-0211 client ignores what it does not read.

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
      'disputed_at', r.disputed_at, 'excused_reason', r.excused_reason,
      -- 0211
      'opens_at', commitment_opens_at(i.starts_at, i.respond_by_at, c.starts_min, c.opens_min),
      'closes_at', rollcall_closes_at(c.type, i.respond_by_at, i.starts_at, i.ends_at),
      'grace_min', case when c.respond_by_min is null then null else c.respond_by_min - c.starts_min end,
      'verdict', rollcall_verdict(r.status, r.acknowledged_at, coalesce(i.respond_by_at, i.starts_at)),
      'late_min', rollcall_late_min(r.acknowledged_at, coalesce(i.respond_by_at, i.starts_at)),
      'ack_source', r.ack_source,
      'last_nudge_at', r.last_nudge_at
    ) as x
    from commitment_responses r
    join commitment_instances i on i.id = r.instance_id
    join commitments c on c.id = i.commitment_id
    where r.athlete_id = auth.uid()
      and i.occurs_on between p_from and p_to
      and vc_enabled()
  ) s;
$$;

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
      'starts_min', c.starts_min, 'respond_by_min', c.respond_by_min,
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
      -- 0211
      'opens_at', commitment_opens_at(i.starts_at, i.respond_by_at, c.starts_min, c.opens_min),
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
          -- 0211
          'verdict', rollcall_verdict(r.status, r.acknowledged_at, coalesce(i.respond_by_at, i.starts_at)),
          'late_min', rollcall_late_min(r.acknowledged_at, coalesce(i.respond_by_at, i.starts_at)),
          'ack_source', r.ack_source,
          'last_nudge_at', r.last_nudge_at
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

-- The coach's trend read: one row per occurrence over the last N days with the verdict split.
-- Staff of the owning book only. Counts, names never — the per-day board is where names live.
create or replace function rollcall_summary(p_commitment uuid, p_days int default 14)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare c commitments;
begin
  select * into c from commitments where id = p_commitment;
  if not found or not commitment_owner_is_staff(c.team_id, c.practice_id) then
    raise exception 'not authorized';
  end if;
  return (
    select coalesce(jsonb_agg(x order by x->>'occurs_on' desc), '[]'::jsonb) from (
      select jsonb_build_object(
        'instance_id', i.id, 'occurs_on', i.occurs_on, 'instance_status', i.status,
        'starts_at', i.starts_at, 'respond_by_at', i.respond_by_at,
        'total', count(r.id) filter (where r.status <> 'excused'),
        'on_standard', count(r.id) filter (where v.verdict = 'on_standard'),
        'late',        count(r.id) filter (where v.verdict = 'late'),
        'missed',      count(r.id) filter (where v.verdict = 'missed'),
        'pending',     count(r.id) filter (where v.verdict = 'pending'),
        'excused',     count(r.id) filter (where v.verdict = 'excused')
      ) as x
      from commitment_instances i
      left join commitment_responses r on r.instance_id = i.id
      left join lateral (select rollcall_verdict(r.status, r.acknowledged_at,
                                 coalesce(i.respond_by_at, i.starts_at)) as verdict) v on true
      where i.commitment_id = p_commitment
        and i.occurs_on between ((now() at time zone c.timezone)::date - greatest(1, least(p_days, 90)))
                            and (now() at time zone c.timezone)::date
      group by i.id
    ) s
  );
end $$;

-- ================================================================ 8. per-athlete ping
-- rollcall_nudge_claim (0209) gains an optional p_athlete. With it: ONE athlete, its OWN cooldown
-- (commitment_responses.last_nudge_at), and the roster-wide cooldown on the instance is neither
-- consumed nor consulted, so a coach can ping Jordan right after pinging everyone. Without it the
-- function is byte-for-byte 0209.
drop function if exists rollcall_nudge_claim(uuid, uuid, int);
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

-- ================================================================ 9. the claims hand back what the push needs
-- claim_due_commitment_reminders (0148 body) returns more so the reminder function can speak in
-- the coach's voice on the first push and OnStandard's on the rest, and mint a code that lasts the
-- whole late window. The filter logic and the 0141 vc_enabled gate are untouched. Adding columns
-- changes the return type, so drop + recreate (0144 precedent).
drop function if exists claim_due_commitment_reminders(int, int);
create or replace function claim_due_commitment_reminders(p_grace_min int default 10, p_limit int default 500)
returns table (
  athlete_id uuid, instance_id uuid, title text, body text, offset_min smallint,
  action_label text, respond_by_at timestamptz,
  -- 0211
  type text, message text, coach_name text, starts_at timestamptz, closes_at timestamptz,
  fires_at timestamptz, timezone text
)
language plpgsql security definer set search_path = public as $$
begin
  return query
  with due as (
    select r.id as response_id, r.athlete_id, i.id as instance_id,
           coalesce(c.title, 'Commitment') as title,
           c.action_label as action_label,
           coalesce(i.respond_by_at, i.starts_at) as deadline_at,
           o.off,
           c.type as ctype,
           coalesce(i.message_override, c.message) as cmessage,
           (select p.full_name from profiles p where p.id = c.created_by) as ccoach,
           i.starts_at as istarts,
           rollcall_closes_at(c.type, i.respond_by_at, i.starts_at, i.ends_at) as icloses,
           c.timezone as ctz
      from commitment_responses r
      join commitment_instances i on i.id = r.instance_id
      join commitments c on c.id = i.commitment_id
      cross join lateral unnest(c.reminder_offsets_min) as o(off)
     where r.status = 'pending'
       and i.status = 'scheduled'
       and c.active
       and coalesce(i.respond_by_at, i.starts_at) is not null
       and not (o.off = any(r.reminded_offsets))
       and now() >= coalesce(i.respond_by_at, i.starts_at) - make_interval(mins => o.off::int)
       and now() <  coalesce(i.respond_by_at, i.starts_at) - make_interval(mins => o.off::int)
                    + make_interval(mins => greatest(1, p_grace_min))
       and vc_enabled(r.athlete_id)
     order by deadline_at
     limit greatest(1, p_limit)
  ), claimed as (
    update commitment_responses r
       set reminded_offsets = array_append(r.reminded_offsets, d.off),
           first_notified_at = coalesce(r.first_notified_at, now()),
           updated_at = now()
      from due d
     where r.id = d.response_id
    returning r.id, d.athlete_id, d.instance_id, d.title, d.action_label, d.off, d.deadline_at,
              d.ctype, d.cmessage, d.ccoach, d.istarts, d.icloses, d.ctz
  )
  select cl.athlete_id, cl.instance_id, cl.title,
         case when cl.off <= 0 then 'Last call. Your coach is waiting.'
              else format('%s minutes left to respond.', cl.off) end as body,
         cl.off::smallint,
         cl.action_label,
         cl.deadline_at,
         cl.ctype, cl.cmessage, cl.ccoach, cl.istarts, cl.icloses,
         cl.deadline_at - make_interval(mins => cl.off::int) as fires_at,
         cl.ctz
    from claimed cl;
end $$;
revoke all on function claim_due_commitment_reminders(int, int) from public, anon, authenticated;

-- claim_missed_commitments (0148 body) returns the close and the label so the "you're late" push
-- can carry a working button of its own instead of being a dead end.
drop function if exists claim_missed_commitments(int, uuid[], int);
create or replace function claim_missed_commitments(p_grace_min int default 10, p_only uuid[] default null, p_limit int default 500)
returns table (
  instance_id uuid, athlete_id uuid, title text, config jsonb,
  -- 0211
  type text, action_label text, respond_by_at timestamptz, closes_at timestamptz
)
language plpgsql security definer set search_path = public as $$
begin
  return query
  with crossed as (
    select r.id as response_id, r.athlete_id, i.id as instance_id,
           coalesce(c.title, 'Commitment') as title, c.escalation as config,
           coalesce(i.respond_by_at, i.starts_at) as deadline_at,
           c.type as ctype, c.action_label as clabel,
           rollcall_closes_at(c.type, i.respond_by_at, i.starts_at, i.ends_at) as icloses
      from commitment_responses r
      join commitment_instances i on i.id = r.instance_id
      join commitments c on c.id = i.commitment_id
     where r.status = 'pending'
       and i.status = 'scheduled'
       and c.active
       and coalesce(i.respond_by_at, i.starts_at) is not null
       and now() >= coalesce(i.respond_by_at, i.starts_at)
       and now() <  coalesce(i.respond_by_at, i.starts_at) + make_interval(mins => greatest(1, p_grace_min))
       and (p_only is null or r.athlete_id = any(p_only))
     order by deadline_at
     limit greatest(1, p_limit)
  ), claimed as (
    update commitment_responses r
       set status = 'missed', updated_at = now()
      from crossed x
     where r.id = x.response_id and r.status = 'pending'
    returning x.instance_id, x.athlete_id, x.title, x.config, x.ctype, x.clabel, x.deadline_at, x.icloses
  )
  select cl.instance_id, cl.athlete_id, cl.title, cl.config,
         cl.ctype, cl.clabel, cl.deadline_at, cl.icloses
    from claimed cl;
end $$;
revoke all on function claim_missed_commitments(int, uuid[], int) from public, anon, authenticated;

-- ================================================================ 10. accountability counts
-- accountability_raw (0138): the 'earned' / 'possible' arithmetic is UNCHANGED. Three counts are
-- added so the verdict split is available to any scoring decision without one being made here.
create or replace function accountability_raw(p_athlete uuid, p_from date, p_to date)
returns jsonb language sql stable security definer set search_path = public as $$
  with r as (
    select cr.status, cr.acknowledged_at, cr.arrived_at, cr.completed_at,
           ci.arrive_by_at,
           (c.respond_by_min is not null or c.type = 'morning_roll_call') as asks_ack,
           (c.location_id is not null)                                    as asks_arrival,
           (c.type <> 'morning_roll_call')                                as asks_completion,
           (cr.status <> 'unverified')                                    as verified,
           rollcall_verdict(cr.status, cr.acknowledged_at, coalesce(ci.respond_by_at, ci.starts_at)) as verdict
      from commitment_responses cr
      join commitment_instances ci on ci.id = cr.instance_id
      join commitments c on c.id = ci.commitment_id
     where cr.athlete_id = p_athlete
       and ci.occurs_on between p_from and p_to
       and ci.status = 'scheduled'
       and cr.status <> 'excused'
  ), s as (
    select *,
      (arrived_at is not null and (arrive_by_at is null or arrived_at <= arrive_by_at)) as on_time
    from r
  )
  select jsonb_build_object(
    'wake_done',      count(*) filter (where asks_ack and acknowledged_at is not null),
    'wake_total',     count(*) filter (where asks_ack),
    'wake_on_standard', count(*) filter (where asks_ack and verdict = 'on_standard'),
    'wake_late',      count(*) filter (where asks_ack and verdict = 'late'),
    'wake_missed',    count(*) filter (where asks_ack and verdict = 'missed'),
    'arrival_done',   count(*) filter (where asks_arrival and verified and on_time),
    'arrival_total',  count(*) filter (where asks_arrival and verified),
    'complete_done',  count(*) filter (where asks_completion and verified and completed_at is not null),
    'complete_total', count(*) filter (where asks_completion and verified),
    'earned', coalesce(sum(
        (case when asks_ack and acknowledged_at is not null then 10 else 0 end) +
        (case when asks_arrival and verified and on_time then 30 else 0 end) +
        (case when asks_completion and verified and completed_at is not null then 60 else 0 end)), 0),
    'possible', coalesce(sum(
        (case when asks_ack then 10 else 0 end) +
        (case when asks_arrival and verified then 30 else 0 end) +
        (case when asks_completion and verified then 60 else 0 end)), 0)
  ) from s;
$$;
revoke all on function accountability_raw(uuid, date, date) from public, anon, authenticated;

-- ================================================================ 11. one-minute crons
-- Both schedulers now install a one-minute cadence, and the block at the end moves any job that
-- is ALREADY installed without asking the operator to re-run anything. The claims are cheap
-- (an indexed select + update, bounded by p_limit) and the ladder is a no-op most minutes.
create or replace function public.schedule_commitment_reminders(fn_url text, cron_key text)
returns void
language plpgsql security definer set search_path = public as $$
begin
  perform cron.unschedule(jobid) from cron.job where jobname = 'commitment-reminders';
  perform cron.schedule(
    'commitment-reminders',
    '* * * * *',
    format(
      $job$ select net.http_post(url := %L, headers := jsonb_build_object('x-commitment-key', %L, 'Content-Type', 'application/json'), body := '{}'::jsonb); $job$,
      fn_url, cron_key
    )
  );
end $$;
revoke execute on function public.schedule_commitment_reminders(text, text) from public, anon, authenticated;

create or replace function schedule_commitment_escalation(p_fn_url text, p_cron_key text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise notice 'pg_cron not installed — skipping schedule';
    return;
  end if;
  perform cron.unschedule(jobid) from cron.job where jobname = 'commitment-escalation';
  perform cron.schedule('commitment-escalation', '* * * * *', format(
    $cmd$select net.http_post(
      url := %L,
      headers := jsonb_build_object('Content-Type','application/json','x-commitment-key',%L),
      body := '{}'::jsonb
    );$cmd$, p_fn_url, p_cron_key));
end $$;
revoke all on function schedule_commitment_escalation(text, text) from public, anon, authenticated;
grant execute on function schedule_commitment_escalation(text, text) to service_role;

do $$
declare j record;
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then return; end if;
  for j in select jobid, jobname from cron.job
            where jobname in ('commitment-reminders', 'commitment-escalation')
              and schedule <> '* * * * *' loop
    begin
      perform cron.alter_job(job_id => j.jobid, schedule => '* * * * *');
      raise notice 'moved % to a one-minute cadence', j.jobname;
    exception when others then
      raise notice 'could not re-time % (%), re-run its schedule_* function', j.jobname, sqlerrm;
    end;
  end loop;
end $$;

-- ================================================================ 12. grants
do $$ declare f text; begin
  foreach f in array array[
    'commitment_opens_at(timestamptz,timestamptz,smallint,smallint)',
    'rollcall_closes_at(text,timestamptz,timestamptz,timestamptz)',
    'rollcall_verdict(text,timestamptz,timestamptz,timestamptz)',
    'rollcall_late_min(timestamptz,timestamptz)',
    'ack_commitment(uuid)',
    'staff_set_response(uuid,text,text)',
    'ensure_commitment_instances(uuid,uuid,date,date)',
    'upsert_commitment(jsonb)',
    'set_instance_message(uuid,text)',
    'my_commitments(date,date)',
    'commitment_board(uuid,uuid,date)',
    'rollcall_summary(uuid,int)'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
