-- OnStandard — Verified Commitments: production hardening.
--
-- Two things a feature that wakes 90 teenagers at 4:45 AM must have and didn't:
--
--   A KILL SWITCH THAT IS ACTUALLY IN THE PATH. Not a client flag a stale app can ignore, and not
--     an env var needing a rebuild — a row in feature_flags (0109) checked by the SERVER inside
--     the read, materialize and reminder paths. One UPDATE and every athlete's card goes quiet
--     and every push stops, instantly, for every client version in the field.
--
--   A GUARD AGAINST THE MORNING THUNDERING HERD. ensure_commitment_instances runs on every
--     athlete's Home load. At 4:30 AM ninety athletes open the app inside the same minute and all
--     run the identical materialization over the same rows. `on conflict do nothing` keeps it
--     CORRECT but not cheap, and the concurrent inserts contend on the same unique index.
--
-- GUARDRAIL: authored + statically reviewed; NOT applied to live here.

-- ---------------------------------------------------------------- the flag
insert into public.feature_flags (name, description, default_on, kill_switch)
values ('verified_commitments',
        'Verified Commitments: morning roll call, location-verified arrival, accountability.',
        true, false)
on conflict (name) do nothing;

-- Fails OPEN on a missing row so a fresh database, a restored backup or a test harness that never
-- seeded flags behaves normally. Turning the feature OFF is therefore always an explicit act:
-- `update feature_flags set kill_switch = true where name = 'verified_commitments';`
--
-- default_on = false with enabled_user_ids populated is the staged-rollout shape (pilot team
-- first). kill_switch beats everything, which is the point of a kill switch.
create or replace function vc_enabled(p_user uuid default auth.uid()) returns boolean
language sql stable security definer set search_path = public as $$
  select case
    when f.name is null    then true    -- no flag row → on
    when f.kill_switch     then false   -- beats every allowlist
    when f.default_on      then true
    when p_user = any(f.enabled_user_ids) then true
    else false
  end
  from (select 1) one
  left join public.feature_flags f on f.name = 'verified_commitments';
$$;
revoke all on function vc_enabled(uuid) from public, anon;
grant execute on function vc_enabled(uuid) to authenticated;

-- A coach must not be able to author into a feature that is switched off — they'd sit there
-- scheduling a roll call that will never appear. A trigger keeps this to six lines instead of
-- restating the whole 60-line upsert, and covers every future write path for free.
create or replace function commitments_flag_guard() returns trigger
language plpgsql set search_path = public as $$
begin
  if not vc_enabled() then
    raise exception 'Verified Commitments is currently switched off';
  end if;
  return new;
end $$;
drop trigger if exists commitments_flag_guard_t on commitments;
create trigger commitments_flag_guard_t before insert or update on commitments
  for each row execute function commitments_flag_guard();

-- ---------------------------------------------------------------- materialization
-- Recreated in full (replaces 0140's body). Adds the flag check and the herd guard; everything
-- else is byte-identical to 0140.
create or replace function ensure_commitment_instances(
  p_team uuid, p_practice uuid, p_from date, p_to date
) returns integer
language plpgsql security definer set search_path = public as $$
declare c commitments; d date; n integer := 0; v_inst uuid; v_last date;
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

  -- ⚠ HERD GUARD. TRY, never wait: if another session is already materializing this book, this
  -- caller returns immediately and reads whatever that session commits. Blocking instead would
  -- queue ninety athletes behind one transaction at 4:30 AM — the exact moment the app must feel
  -- instant. Missing a materialization is harmless: the winner does the identical work, and the
  -- next load reconciles.
  if not pg_try_advisory_xact_lock(hashtext('vc:' || coalesce(p_team, p_practice)::text)) then
    return 0;
  end if;

  for c in select * from commitments
            where active
              and ((p_team is not null and team_id = p_team)
                or (p_practice is not null and practice_id = p_practice))
  loop
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
  end loop;
  return n;
end $$;

-- ---------------------------------------------------------------- gated reads
-- Recreated with `and vc_enabled()` in the WHERE. Everything else is byte-identical to 0138.
-- With the switch off these return '[]' — the athlete's Home slot renders nothing and the coach's
-- board card disappears, without either client knowing or caring why.
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

create or replace function commitment_board(p_team uuid, p_practice uuid, p_on date)
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(x order by x->>'starts_at'), '[]'::jsonb) from (
    select jsonb_build_object(
      'instance_id', i.id, 'commitment_id', c.id, 'type', c.type,
      'title', c.title, 'message', coalesce(i.message_override, c.message),
      'action_label', c.action_label,
      'starts_at', i.starts_at, 'ends_at', i.ends_at,
      'respond_by_at', i.respond_by_at, 'arrive_by_at', i.arrive_by_at,
      'starts_min', c.starts_min, 'respond_by_min', c.respond_by_min,
      'timezone', c.timezone,
      'instance_status', i.status,
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
      'rows', (
        select coalesce(jsonb_agg(jsonb_build_object(
          'response_id', r.id, 'athlete_id', r.athlete_id, 'name', p.full_name,
          'status', r.status,
          'acknowledged_at', r.acknowledged_at, 'arrived_at', r.arrived_at,
          'completed_at', r.completed_at, 'arrival_source', r.arrival_source,
          'unverified_reason', r.unverified_reason, 'excused_reason', r.excused_reason,
          'corrected_by_name', (select p2.full_name from profiles p2 where p2.id = r.corrected_by),
          'disputed_at', r.disputed_at, 'dispute_note', r.dispute_note
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

-- ---------------------------------------------------------------- gated reminders
-- The single most important place the switch is checked: with it off, nothing is claimed, so no
-- notification row is written and no push is sent. Evaluated per ATHLETE so a staged rollout
-- (default_on = false + enabled_user_ids) wakes only the pilot team.
create or replace function claim_due_commitment_reminders(p_grace_min int default 10)
returns table (
  athlete_id uuid, instance_id uuid, title text, body text, offset_min smallint
)
language plpgsql security definer set search_path = public as $$
begin
  return query
  with due as (
    select r.id as response_id, r.athlete_id, i.id as instance_id,
           coalesce(c.title, 'Commitment') as title,
           coalesce(i.respond_by_at, i.starts_at) as deadline_at,
           o.off
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
  ), claimed as (
    update commitment_responses r
       set reminded_offsets = array_append(r.reminded_offsets, d.off),
           updated_at = now()
      from due d
     where r.id = d.response_id
    returning r.id, d.athlete_id, d.instance_id, d.title, d.off, d.deadline_at
  )
  select cl.athlete_id, cl.instance_id, cl.title,
         case when cl.off <= 0 then 'Last call — your coach is waiting.'
              else format('%s minutes left to respond.', cl.off) end as body,
         cl.off::smallint
    from claimed cl;
end $$;
revoke all on function claim_due_commitment_reminders(int) from public, anon, authenticated;

-- ---------------------------------------------------------------- indexes for the hot paths
-- my_commitments filters by athlete then date; the board filters instances by date. Both run on
-- every app open, and the existing indexes lead with the wrong column for these.
create index if not exists cr_athlete_instance on commitment_responses (athlete_id, instance_id);
create index if not exists ci_occurs_on on commitment_instances (occurs_on, commitment_id);
-- The reminder claim scans pending responses; keep that scan off the full table.
create index if not exists cr_pending on commitment_responses (instance_id)
  where status = 'pending';
