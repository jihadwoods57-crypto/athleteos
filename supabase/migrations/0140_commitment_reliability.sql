-- OnStandard — Verified Commitments, reliability pass.
-- Closes three gaps found reviewing the shipped slices:
--
--   #2 Reminders depended on the athlete having opened the app. The plan was built client-side
--      from RT.vcRows, which Home fills on mount — so an athlete who hadn't opened OnStandard
--      since yesterday afternoon had NOTHING scheduled for a 4:45 AM roll call. That is exactly
--      the athlete this feature exists for. Reminders now originate on the server.
--
--   #3 Excuse was per-instance. A coach excusing a week of family travel had to do it every
--      morning, and an athlete already excused through athlete_exceptions (0071) still read as
--      "awaiting response" because the two systems didn't know about each other.
--
--   #5 Response rows were seeded only when an instance was first materialized. An athlete who
--      joined the team, or moved to another position room, afterwards never got a row — and the
--      coach's "9 of 11" silently omitted them. Wrong counts are the one bug that destroys trust
--      in an accountability tool.
--
-- GUARDRAIL: authored + statically reviewed; NOT applied to live here.

-- ---------------------------------------------------------------- reminder bookkeeping
-- Which reminder offsets have already gone out for this response. Without it a cron running every
-- five minutes would re-send the 15-minute reminder three times.
alter table commitment_responses add column if not exists
  reminded_offsets smallint[] not null default '{}';

-- ---------------------------------------------------------------- #5 reconciliation
-- Rewritten in full (replaces 0138's body). Two changes, both about the roster moving under a
-- schedule that was already materialized:
--   · responses are seeded for EVERY instance in the window, not only newly created ones
--   · a PENDING row for someone no longer in the audience is removed. Pending means nothing
--     happened, so nothing is lost — and a row carrying a real timestamp is never touched,
--     because that is history and deleting it would be a lie.
create or replace function ensure_commitment_instances(
  p_team uuid, p_practice uuid, p_from date, p_to date
) returns integer
language plpgsql security definer set search_path = public as $$
declare c commitments; d date; n integer := 0; v_inst uuid; v_last date;
begin
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
          -- Seed anyone in the audience who has no row yet — including athletes who joined or
          -- changed rooms after this instance was created.
          insert into commitment_responses (instance_id, athlete_id)
          select v_inst, a from commitment_audience(c.id) a
          on conflict (instance_id, athlete_id) do nothing;

          -- Drop untouched rows for anyone no longer in the audience.
          delete from commitment_responses r
           where r.instance_id = v_inst
             and r.status = 'pending'
             and r.acknowledged_at is null and r.arrived_at is null and r.completed_at is null
             and r.athlete_id not in (select a from commitment_audience(c.id) a);

          -- Anyone already excused for this date (athlete_exceptions, 0071) is marked excused
          -- rather than left "awaiting response" for a coach to chase.
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

-- ---------------------------------------------------------------- #3 excuse a stretch of days
-- One call excuses an athlete across a date range: it writes the EXISTING athlete_exceptions
-- primitive (so every other coach surface that already understands "excused" agrees) and marks
-- every commitment response in that range in one go.
create or replace function staff_excuse_athlete(
  p_athlete uuid, p_from date, p_to date, p_reason text,
  p_team uuid default null, p_practice uuid default null
) returns integer
language plpgsql security definer set search_path = public as $$
declare v_n integer := 0;
begin
  if p_from is null or p_to is null or p_to < p_from then
    raise exception 'invalid date range';
  end if;
  if p_to - p_from > 366 then raise exception 'range too large'; end if;
  if not commitment_owner_is_staff(p_team, p_practice) then
    raise exception 'not authorized for this team or practice';
  end if;

  insert into athlete_exceptions (team_id, practice_id, athlete_id, starts_on, ends_on, reason)
  values (p_team, p_practice, p_athlete, p_from, p_to,
          nullif(left(coalesce(p_reason, ''), 120), ''));

  update commitment_responses r
     set status = 'excused',
         excused_by = auth.uid(),
         excused_reason = nullif(left(coalesce(p_reason, ''), 120), ''),
         corrected_by = auth.uid(), corrected_at = now(),
         updated_at = now()
    from commitment_instances i
    join commitments c on c.id = i.commitment_id
   where r.instance_id = i.id
     and r.athlete_id = p_athlete
     and i.occurs_on between p_from and p_to
     and ((p_team is not null and c.team_id = p_team)
       or (p_practice is not null and c.practice_id = p_practice));
  get diagnostics v_n = row_count;
  return coalesce(v_n, 0);
end $$;

-- ---------------------------------------------------------------- #2 server-side reminders
-- Claim the reminders that are due right now and mark them in the SAME statement, so two
-- overlapping cron runs cannot double-send. Returns everything the edge function needs to push;
-- it holds no scheduling logic of its own.
--
-- A reminder is due when now() has passed (deadline - offset) and is still within p_grace_min of
-- it — a cron tick that is late by an hour must not fire a 5-minute warning after the deadline.
-- Only PENDING responses are ever selected: an athlete who already answered is never pinged.
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

-- Recipients' in-app notification rows, written by the same service-role call that pushes.
create or replace function record_commitment_reminder(
  p_athlete uuid, p_title text, p_body text
) returns void
language sql security definer set search_path = public as $$
  insert into notifications (user_id, kind, title, body)
  values (p_athlete, 'commitment_reminder', p_title, p_body);
$$;

-- ---------------------------------------------------------------- cron (mirrors 0044 / 0113)
-- Founder calls this ONCE with the function URL + shared key. Every 5 minutes, because reminder
-- offsets are minute-grained and a coarser tick would drift a "5 minutes left" warning past the
-- deadline it is warning about.
create extension if not exists pg_cron;
create extension if not exists pg_net;

create or replace function public.schedule_commitment_reminders(fn_url text, cron_key text)
returns void
language plpgsql security definer set search_path = public as $$
begin
  perform cron.unschedule(jobid) from cron.job where jobname = 'commitment-reminders';
  perform cron.schedule(
    'commitment-reminders',
    '*/5 * * * *',
    format(
      $job$ select net.http_post(url := %L, headers := jsonb_build_object('x-commitment-key', %L, 'Content-Type', 'application/json'), body := '{}'::jsonb); $job$,
      fn_url, cron_key
    )
  );
end; $$;
revoke execute on function public.schedule_commitment_reminders(text, text) from public, anon, authenticated;

-- ---------------------------------------------------------------- grants
-- claim_due_commitment_reminders and record_commitment_reminder are SERVICE-ROLE ONLY: they are
-- reached by the edge function with the service key, never by a signed-in user. Leaving them
-- ungranted IS the boundary (same shape as admin_audit_log in 0109).
revoke all on function claim_due_commitment_reminders(int) from public, anon, authenticated;
revoke all on function record_commitment_reminder(uuid, text, text) from public, anon, authenticated;

do $$ declare f text; begin
  foreach f in array array[
    'ensure_commitment_instances(uuid,uuid,date,date)',
    'staff_excuse_athlete(uuid,date,date,text,uuid,uuid)'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
