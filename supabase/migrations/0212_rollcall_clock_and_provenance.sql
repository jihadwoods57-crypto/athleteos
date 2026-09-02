-- OnStandard — Wake-Up Roll Call, second pass (2026-09-02): the clock, provenance, and review.
--
-- Founder review of 0211, in order of what was wrong:
--   1. THE CLOCK. A wake-up closed two hours after its deadline, so a 6:00 roll call read "On
--      Standard until 9:53 PM". The model is now three instants: OPEN (6:00), GRACE (6:05),
--      CLOSE (6:30 by default, the coach's ends_min when set). Missed is final after close.
--   2. PROVENANCE. A coach's "Mark in" stamped acknowledged_at exactly as an athlete's tap did.
--      An override now needs a reason, is stored as its own source, reads as On Standard by
--      decision, and is counted separately everywhere so "4 / 4" can never hide one.
--   3. OFFLINE TAPS. A lock-screen tap in a dead zone replays later. The server receipt stays the
--      only authoritative time, but a plausible device time that crossed a boundary while in
--      flight is neither trusted nor punished: the row enters REVIEW, counts as nothing until a
--      coach resolves it, and every timestamp and decision is kept.
--   4. LIVE BOARD. commitment_responses joins the realtime publication (0172 pattern).
--
-- Every function below is a recreate of its 0211 shape with the new rules; every read keeps every
-- key it had. Migration numbering: 0211 was the last applied (to prod, 2026-09-02).

-- ================================================================ 1. columns
alter table commitment_responses drop constraint if exists commitment_responses_ack_source_check;
alter table commitment_responses add constraint commitment_responses_ack_source_check
  check (ack_source is null or ack_source in ('app','lockscreen','staff','override','review_accepted'));

alter table commitment_responses add column if not exists correction_note text
  check (correction_note is null or char_length(correction_note) <= 120);
-- The offline policy. device_tapped_at is EVIDENCE the athlete's phone supplied, never the verdict's
-- input; sync_review says the receipt crossed a boundary that evidence did not.
alter table commitment_responses add column if not exists device_tapped_at timestamptz;
alter table commitment_responses add column if not exists sync_review boolean not null default false;
alter table commitment_responses add column if not exists review_resolved_by uuid references profiles(id);
alter table commitment_responses add column if not exists review_resolved_at timestamptz;
alter table commitment_responses add column if not exists review_resolution text
  check (review_resolution is null or review_resolution in ('accepted','late','missed'));
alter table commitment_responses add column if not exists review_note text
  check (review_note is null or char_length(review_note) <= 120);

-- ================================================================ 2. audit trail
-- Append-only. A resolution or an override never overwrites what came before it; it adds a line.
create table if not exists commitment_response_audit (
  id           bigint generated always as identity primary key,
  response_id  uuid not null references commitment_responses(id) on delete cascade,
  actor        uuid references profiles(id),
  action       text not null check (action in ('ack','override','excuse','review_opened','review_resolved','correction')),
  from_state   text,
  to_state     text,
  note         text check (note is null or char_length(note) <= 200),
  at           timestamptz not null default now()
);
create index if not exists cra_response on commitment_response_audit (response_id, at);
alter table commitment_response_audit enable row level security;
drop policy if exists cra_read on commitment_response_audit;
create policy cra_read on commitment_response_audit for select
  using (exists (select 1 from commitment_responses r
                  where r.id = response_id
                    and (r.athlete_id = auth.uid() or instance_owner_is_staff(r.instance_id))));
grant select on commitment_response_audit to authenticated;

create or replace function _rc_audit(p_response uuid, p_actor uuid, p_action text, p_from text, p_to text, p_note text)
returns void language sql security definer set search_path = public as $$
  insert into commitment_response_audit (response_id, actor, action, from_state, to_state, note)
  values (p_response, p_actor, p_action, p_from, p_to, nullif(left(coalesce(p_note,''),200),''));
$$;
revoke all on function _rc_audit(uuid, uuid, text, text, text, text) from public, anon, authenticated;

-- ================================================================ 3. the clock
-- CLOSE: the coach's ends_at, else 30 minutes after the WAKE-UP TIME (not after the deadline).
create or replace function rollcall_closes_at(
  p_type text, p_respond_by_at timestamptz, p_starts_at timestamptz, p_ends_at timestamptz
) returns timestamptz language sql immutable set search_path = public as $$
  select coalesce(p_ends_at,
    case when p_type = 'morning_roll_call' then p_starts_at + interval '30 minutes' else null end);
$$;

-- OPEN: a wake-up with no explicit opens_min opens AT its time (no answering at 5:59). Every other
-- type keeps the pre-0211 rule (an hour before the deadline).
create or replace function commitment_opens_at(
  p_starts_at timestamptz, p_respond_by_at timestamptz, p_starts_min smallint, p_opens_min smallint
) returns timestamptz language sql immutable set search_path = public as $$
  select case
    when p_opens_min is null then coalesce(p_respond_by_at, p_starts_at) - interval '60 minutes'
    else p_starts_at + make_interval(mins => (p_opens_min - p_starts_min)::int)
  end;
$$;
create or replace function rollcall_opens_at(
  p_type text, p_starts_at timestamptz, p_respond_by_at timestamptz, p_starts_min smallint, p_opens_min smallint
) returns timestamptz language sql immutable set search_path = public as $$
  select case
    when p_type = 'morning_roll_call' and p_opens_min is null then p_starts_at
    else commitment_opens_at(p_starts_at, p_respond_by_at, p_starts_min, p_opens_min)
  end;
$$;

-- ================================================================ 4. the verdict
-- excused | review | on_standard | late | pending | missed. Pure. Mirrored in proto js/commitments.js.
--   review      unresolved delayed-sync evidence: counts as NOTHING until a coach resolves it
--   on_standard answered at or before grace, OR a coach override / an accepted review
--   late        answered after grace (or a review kept as late)
--   pending     unanswered, the roll call has not closed (past grace = "still out", a UI sub-state)
--   missed      unanswered at close, or a review kept as missed. Final.
drop function if exists rollcall_verdict(text, timestamptz, timestamptz, timestamptz);
create or replace function rollcall_verdict(
  p_status text, p_acknowledged_at timestamptz, p_deadline_at timestamptz, p_closes_at timestamptz,
  p_now timestamptz default now(), p_source text default null,
  p_review boolean default false, p_resolution text default null
) returns text language sql immutable set search_path = public as $$
  select case
    when p_status = 'excused' then 'excused'
    when p_review and p_resolution is null then 'review'
    when p_resolution = 'accepted' then 'on_standard'
    when p_resolution = 'late' then 'late'
    when p_resolution = 'missed' then 'missed'
    when p_acknowledged_at is not null then
      case when p_source in ('staff','override','review_accepted') then 'on_standard'
           when p_deadline_at is null or p_acknowledged_at <= p_deadline_at then 'on_standard'
           else 'late' end
    -- inclusive at the close, exactly as the ack path is: 6:30:00 still answers, 6:30:01 is missed
    when p_closes_at is not null then case when p_now <= p_closes_at then 'pending' else 'missed' end
    when p_deadline_at is null or p_now < p_deadline_at then 'pending'
    else 'missed'
  end;
$$;
comment on function rollcall_verdict(text, timestamptz, timestamptz, timestamptz, timestamptz, text, boolean, text) is
  'Wake-up verdict: excused | review | on_standard | late | pending | missed. Pure. Mirrored in proto js/commitments.js rollcallVerdict().';

-- ================================================================ 5. the ack paths
-- The plausibility bound for a device timestamp: not before the evidence could exist (the code's
-- mint time, or the open for an in-app tap) and not after the server's own now.
create or replace function _rc_plausible(p_tapped_at timestamptz, p_floor timestamptz, p_now timestamptz)
returns boolean language sql immutable set search_path = public as $$
  select p_tapped_at is not null and p_floor is not null and p_tapped_at >= p_floor and p_tapped_at <= p_now;
$$;
revoke all on function _rc_plausible(timestamptz, timestamptz, timestamptz) from public, anon, authenticated;

-- Shared body for both ack paths. Returns the stamp; raises on refusal. `p_floor` is the earliest
-- instant the device time may claim. `p_source` is what the caller proves about the tap.
create or replace function _rc_record_ack(
  p_instance uuid, p_athlete uuid, p_source text, p_tapped_at timestamptz, p_floor timestamptz
) returns timestamptz language plpgsql security definer set search_path = public as $$
declare
  v_id uuid; v_at timestamptz; v_open timestamptz; v_close timestamptz; v_deadline timestamptz;
  v_istatus text; v_type text; v_now timestamptz := now();
  v_plausible boolean; v_review boolean := false;
begin
  select r.id, r.acknowledged_at into v_id, v_at
    from commitment_responses r where r.instance_id = p_instance and r.athlete_id = p_athlete;
  if v_id is null then raise exception 'no commitment for this athlete on this instance'; end if;
  if v_at is not null then return v_at; end if;

  select rollcall_opens_at(c.type, i.starts_at, i.respond_by_at, c.starts_min, c.opens_min),
         rollcall_closes_at(c.type, i.respond_by_at, i.starts_at, i.ends_at),
         coalesce(i.respond_by_at, i.starts_at), i.status, c.type
    into v_open, v_close, v_deadline, v_istatus, v_type
    from commitment_instances i join commitments c on c.id = i.commitment_id
   where i.id = p_instance;
  if v_istatus <> 'scheduled' then raise exception 'this check-in was cancelled'; end if;
  if v_now < v_open then raise exception 'not open yet'; end if;

  v_plausible := _rc_plausible(p_tapped_at, coalesce(p_floor, v_open), v_now);

  if v_close is not null and v_now > v_close then
    -- Closed. Only a plausible device time from BEFORE the close earns a review; else refused.
    if v_plausible and p_tapped_at <= v_close then v_review := true;
    else raise exception 'closed'; end if;
  elsif v_deadline is not null and v_now > v_deadline and v_plausible and p_tapped_at <= v_deadline then
    -- Receipt after grace, tap before it: neither trusted nor punished.
    v_review := true;
  end if;

  update commitment_responses
     set acknowledged_at = v_now,
         status = case when status in ('pending','missed') then 'acknowledged' else status end,
         ack_source = coalesce(ack_source, p_source),
         device_tapped_at = case when v_plausible then p_tapped_at else null end,
         sync_review = v_review,
         updated_at = v_now
   where id = v_id
   returning acknowledged_at into v_at;

  perform _rc_audit(v_id, p_athlete, 'ack', 'pending', case when v_review then 'review' else 'acknowledged' end,
    case when v_review then 'delayed sync: device ' || to_char(p_tapped_at at time zone 'utc', 'HH24:MI:SS') || 'Z, received ' || to_char(v_now at time zone 'utc', 'HH24:MI:SS') || 'Z' else null end);
  if v_review then perform _rc_audit(v_id, p_athlete, 'review_opened', 'acknowledged', 'review', null); end if;
  return v_at;
end $$;
revoke all on function _rc_record_ack(uuid, uuid, text, timestamptz, timestamptz) from public, anon, authenticated;

-- In-app tap. `p_tapped_at` is what the offline queue replays (the moment of the tap); the floor
-- is the open, since there is no minted code to bound it.
drop function if exists ack_commitment(uuid);
create or replace function ack_commitment(p_instance uuid, p_tapped_at timestamptz default null)
returns timestamptz language plpgsql security definer set search_path = public as $$
begin
  return _rc_record_ack(p_instance, auth.uid(), 'app', p_tapped_at, null);
end $$;

-- Lock-screen tap. The code's mint time is the floor: a phone cannot claim a tap before its own
-- notification existed.
drop function if exists ack_commitment_by_token(uuid, uuid);
create or replace function ack_commitment_by_token(
  p_instance uuid, p_athlete uuid, p_tapped_at timestamptz default null, p_code_iat timestamptz default null
) returns timestamptz language plpgsql security definer set search_path = public as $$
begin
  return _rc_record_ack(p_instance, p_athlete, 'lockscreen', p_tapped_at, p_code_iat);
end $$;
revoke all on function ack_commitment_by_token(uuid, uuid, timestamptz, timestamptz) from public, anon, authenticated;

-- ================================================================ 6. the coach's hands
-- An override needs a reason and is recorded as one. It never looks like the athlete's tap.
create or replace function staff_set_response(p_response uuid, p_status text, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
declare v_ok boolean; v_from text; v_reason text;
begin
  if p_status not in ('pending','acknowledged','arrived','completed','missed','excused','unverified')
  then raise exception 'bad status %', p_status; end if;
  v_reason := nullif(left(coalesce(p_reason,''),120),'');
  if p_status = 'acknowledged' and v_reason is null then
    raise exception 'an override needs a reason';
  end if;

  select commitment_owner_is_staff(c.team_id, c.practice_id), r.status into v_ok, v_from
    from commitment_responses r
    join commitment_instances i on i.id = r.instance_id
    join commitments c on c.id = i.commitment_id
   where r.id = p_response;
  if not coalesce(v_ok, false) then raise exception 'not authorized'; end if;

  update commitment_responses set
    status = p_status,
    excused_by     = case when p_status = 'excused' then auth.uid() else excused_by end,
    excused_reason = case when p_status = 'excused' then v_reason else excused_reason end,
    unverified_reason = case when p_status = 'unverified' then nullif(left(coalesce(p_reason,''),60),'') else unverified_reason end,
    corrected_by = auth.uid(), corrected_at = now(),
    correction_note = case when p_status = 'acknowledged' then v_reason else correction_note end,
    acknowledged_at = case when p_status in ('acknowledged','arrived','completed')
                           then coalesce(acknowledged_at, now()) else acknowledged_at end,
    ack_source      = case when p_status in ('acknowledged','arrived','completed') and acknowledged_at is null
                           then 'override' else ack_source end,
    arrived_at      = case when p_status in ('arrived','completed')
                           then coalesce(arrived_at, now()) else arrived_at end,
    completed_at    = case when p_status = 'completed'
                           then coalesce(completed_at, now()) else completed_at end,
    arrival_source  = case when p_status in ('arrived','completed')
                           then coalesce(arrival_source, 'staff') else arrival_source end,
    updated_at = now()
  where id = p_response;

  perform _rc_audit(p_response, auth.uid(),
    case when p_status = 'acknowledged' then 'override' when p_status = 'excused' then 'excuse' else 'correction' end,
    v_from, p_status, v_reason);
end $$;

-- Resolve a delayed-sync review. Three outcomes, all audited, nothing overwritten.
create or replace function resolve_sync_review(p_response uuid, p_resolution text, p_note text)
returns void language plpgsql security definer set search_path = public as $$
declare v_ok boolean; v_review boolean; v_resolved text;
begin
  if p_resolution not in ('accepted','late','missed') then raise exception 'bad resolution %', p_resolution; end if;
  select commitment_owner_is_staff(c.team_id, c.practice_id), r.sync_review, r.review_resolution
    into v_ok, v_review, v_resolved
    from commitment_responses r
    join commitment_instances i on i.id = r.instance_id
    join commitments c on c.id = i.commitment_id
   where r.id = p_response;
  if not coalesce(v_ok, false) then raise exception 'not authorized'; end if;
  if not coalesce(v_review, false) then raise exception 'nothing to review'; end if;
  if v_resolved is not null then raise exception 'already resolved'; end if;

  update commitment_responses set
    review_resolved_by = auth.uid(), review_resolved_at = now(),
    review_resolution = p_resolution,
    review_note = nullif(left(coalesce(p_note,''),120),''),
    ack_source = case when p_resolution = 'accepted' then 'review_accepted' else ack_source end,
    status = case when p_resolution = 'missed' then 'missed' else 'acknowledged' end,
    updated_at = now()
  where id = p_response;

  perform _rc_audit(p_response, auth.uid(), 'review_resolved', 'review',
    case p_resolution when 'accepted' then 'on_standard' else p_resolution end, p_note);
end $$;

-- ================================================================ 7. the reads
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
      -- 0212
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
          -- 0212
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

-- accountability_raw: a REVIEW row is suspended, it leaves both earned and possible for the wake
-- signal (the same exclusion 'unverified' gets for arrival). Overrides and accepted reviews still
-- earn (on standard by decision) and are counted separately so the split is always visible.
create or replace function accountability_raw(p_athlete uuid, p_from date, p_to date)
returns jsonb language sql stable security definer set search_path = public as $$
  with r as (
    select cr.status, cr.acknowledged_at, cr.arrived_at, cr.completed_at, cr.ack_source,
           ci.arrive_by_at,
           (c.respond_by_min is not null or c.type = 'morning_roll_call') as asks_ack,
           (c.location_id is not null)                                    as asks_arrival,
           (c.type <> 'morning_roll_call')                                as asks_completion,
           (cr.status <> 'unverified')                                    as verified,
           rollcall_verdict(cr.status, cr.acknowledged_at, coalesce(ci.respond_by_at, ci.starts_at),
             rollcall_closes_at(c.type, ci.respond_by_at, ci.starts_at, ci.ends_at), now(),
             cr.ack_source, cr.sync_review, cr.review_resolution) as verdict
      from commitment_responses cr
      join commitment_instances ci on ci.id = cr.instance_id
      join commitments c on c.id = ci.commitment_id
     where cr.athlete_id = p_athlete
       and ci.occurs_on between p_from and p_to
       and ci.status = 'scheduled'
       and cr.status <> 'excused'
  ), s as (
    select *,
      (arrived_at is not null and (arrive_by_at is null or arrived_at <= arrive_by_at)) as on_time,
      (verdict <> 'review') as settled
    from r
  )
  select jsonb_build_object(
    'wake_done',      count(*) filter (where asks_ack and settled and acknowledged_at is not null and verdict <> 'missed'),
    'wake_total',     count(*) filter (where asks_ack and settled),
    'wake_on_standard', count(*) filter (where asks_ack and verdict = 'on_standard'),
    'wake_checked_in',  count(*) filter (where asks_ack and verdict = 'on_standard' and ack_source in ('app','lockscreen')),
    'wake_override',  count(*) filter (where asks_ack and ack_source in ('override','staff')),
    'wake_late',      count(*) filter (where asks_ack and verdict = 'late'),
    'wake_missed',    count(*) filter (where asks_ack and verdict = 'missed'),
    'wake_review',    count(*) filter (where asks_ack and verdict = 'review'),
    'arrival_done',   count(*) filter (where asks_arrival and verified and on_time),
    'arrival_total',  count(*) filter (where asks_arrival and verified),
    'complete_done',  count(*) filter (where asks_completion and verified and completed_at is not null),
    'complete_total', count(*) filter (where asks_completion and verified),
    'earned', coalesce(sum(
        (case when asks_ack and settled and acknowledged_at is not null and verdict <> 'missed' then 10 else 0 end) +
        (case when asks_arrival and verified and on_time then 30 else 0 end) +
        (case when asks_completion and verified and completed_at is not null then 60 else 0 end)), 0),
    'possible', coalesce(sum(
        (case when asks_ack and settled then 10 else 0 end) +
        (case when asks_arrival and verified then 30 else 0 end) +
        (case when asks_completion and verified then 60 else 0 end)), 0)
  ) from s;
$$;
revoke all on function accountability_raw(uuid, date, date) from public, anon, authenticated;

-- ================================================================ 8. realtime
-- The live board. Same defensive shape as 0172 (meal_comments): only when the publication exists
-- and the table is not already in it; the client polls when the socket never connects.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (select 1 from pg_publication_tables
                    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'commitment_responses') then
      alter publication supabase_realtime add table public.commitment_responses;
    end if;
  else
    raise notice 'supabase_realtime publication not present — skipping (client falls back to polling)';
  end if;
end $$;

-- ================================================================ 9. grants
do $$ declare f text; begin
  foreach f in array array[
    'rollcall_closes_at(text,timestamptz,timestamptz,timestamptz)',
    'commitment_opens_at(timestamptz,timestamptz,smallint,smallint)',
    'rollcall_opens_at(text,timestamptz,timestamptz,smallint,smallint)',
    'rollcall_verdict(text,timestamptz,timestamptz,timestamptz,timestamptz,text,boolean,text)',
    'ack_commitment(uuid,timestamptz)',
    'staff_set_response(uuid,text,text)',
    'resolve_sync_review(uuid,text,text)',
    'my_commitments(date,date)',
    'commitment_board(uuid,uuid,date)',
    'rollcall_summary(uuid,int)'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
