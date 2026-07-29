-- OnStandard — Connected Standards (slice 4): deadline adjudication + progress-aware reminders.
--
-- 0155 created every table this needs. This migration adds only BEHAVIOR: what happens to a
-- result when its deadline passes and nobody tapped anything, and who gets nudged before it does.
--
-- ⚠ THIS FILE DECIDES WHETHER THE FEATURE IS HONEST.
-- Everywhere else, a status is the consequence of something a person or a device actually did.
-- Here — and only here — the system assigns a verdict on its own, to rows whose owners are
-- asleep. The whole promise of Connected Standards lives in the difference between:
--
--     "your data says you walked 6,200 of 10,000 and the day is over"     → missed
--     "your phone never told us anything"                                  → NOT missed
--
-- The second case has no evidence in either direction, and the honest thing to do with no
-- evidence is to leave the period out of the count entirely. Converting it into a miss would
-- make the number a measure of phone reliability wearing the costume of a measure of discipline,
-- and every athlete with a cracked screen would learn the product lies about them.
--
-- The full transition matrix is enumerated as a test in supabase/tests/rls_authz_test.sql
-- ("the deadline matrix") and was written BEFORE this function body. If you change a branch
-- here, that test is the specification you are changing.
--
-- ⚠ A CRON NEVER OVERTURNS A HUMAN. corrected_by is the mark of a staff decision; rows carrying
-- it are skipped outright, even when they look short.
--
-- GUARDRAIL: authored + statically reviewed; NOT applied to live here. Founder applies via
-- `supabase db push` then `npm run test:rls`.

-- How long a period may sit unresolved before "we're still waiting on the device" becomes
-- "this never resolved". Two days is deliberately generous: a weekend away from a charger must
-- not age out, and nothing downstream treats insufficient_data worse than awaiting_sync — both
-- leave the denominator. It exists so a coach's board stops implying a sync is imminent.
create or replace function cs_stale_after_hours() returns int
language sql immutable as $$ select 48 $$;

-- ---------------------------------------------------------------- the deadline pass
-- Claim-and-mark in a single statement, so two overlapping cron runs cannot both adjudicate the
-- same row (the 0140 pattern). Returns what it changed, so the caller can notify.
create or replace function claim_missed_connected_standards(p_limit int default 500)
returns table (result_id uuid, athlete_id uuid, standard_id uuid, title text, new_status text)
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from feature_flags
                  where name = 'connected_standards' and not kill_switch) then
    return;   -- fails closed, matching cs_enabled (0155)
  end if;

  return query
  with due as (
    select r.id as rid, r.athlete_id, s.id as sid, s.title,
           i.target_snapshot, i.deadline_at,
           r.progress_value, r.last_synced_at, r.device_connected
      from connected_standard_results r
      join connected_standard_instances i on i.id = r.instance_id
      join connected_standards s on s.id = i.standard_id
     where i.status = 'scheduled'
       and now() >= i.deadline_at
       -- Only these two are the system's to move. verified_complete / completed_manually /
       -- awaiting_review / excused / missed / disconnected / insufficient_data are all either a
       -- settled fact or somebody else's call.
       and r.status in ('in_progress', 'awaiting_sync')
       -- a staff member already ruled here; it is not the cron's row to touch
       and r.corrected_by is null
     order by i.deadline_at
     limit greatest(1, p_limit)
     for update of r skip locked
  ), decided as (
    select d.*,
      case
        -- Evidence that the target WAS met outranks everything. A cron must never contradict
        -- data it can see, even if submit_activity_progress should already have caught this.
        when d.progress_value >= d.target_snapshot then 'verified_complete'
        -- The one automatic path to a miss: the device reported AFTER the deadline (so it had
        -- the whole period to tell us) and the total still falls short.
        when d.last_synced_at is not null and d.last_synced_at >= d.deadline_at then 'missed'
        -- No fresh evidence. Everything below leaves the denominator.
        when d.device_connected is false then 'disconnected'
        when now() >= d.deadline_at + make_interval(hours => cs_stale_after_hours())
          then 'insufficient_data'
        else 'awaiting_sync'
      end as verdict
    from due d
  ), claimed as (
    update connected_standard_results r
       set status = x.verdict,
           completed_at = case when x.verdict = 'verified_complete'
                               then coalesce(r.completed_at, now()) else r.completed_at end,
           updated_at = now()
      from decided x
     where r.id = x.rid
       -- Re-check inside the update: another run may have moved it between the scan and here.
       and r.status in ('in_progress', 'awaiting_sync')
       -- and don't rewrite a row to the status it already holds (keeps this a no-op on the
       -- second pass, which matters when it runs every five minutes forever)
       and r.status is distinct from x.verdict
    returning r.id, x.athlete_id, x.sid, x.title, x.verdict
  )
  select c.id, c.athlete_id, c.sid, c.title, c.verdict from claimed c;
end $$;

-- ---------------------------------------------------------------- reminders
-- Progress-aware by construction: the caller gets the numbers, so the copy can say "3,200 steps
-- to go by 9 PM" instead of the same generic nudge everyone else got.
--
-- ⚠ NOBODY WHO IS ALREADY DONE IS EVER REMINDED. The spec is explicit about it and it is the
-- difference between a useful nudge and the app that everyone mutes.
create or replace function claim_due_connected_standard_reminders(p_limit int default 500)
returns table (
  result_id uuid, athlete_id uuid, standard_id uuid, instance_id uuid, title text,
  metric text, display_unit text, target numeric, progress numeric,
  period text, period_start date, period_end date, deadline_at timestamptz
)
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from feature_flags
                  where name = 'connected_standards' and not kill_switch) then
    return;
  end if;

  return query
  with due as (
    select r.id as rid, r.athlete_id, s.id as sid, i.id as iid, s.title,
           i.metric_snapshot, i.display_unit_snapshot, i.target_snapshot,
           r.progress_value, s.period, i.period_start, i.period_end, i.deadline_at
      from connected_standard_results r
      join connected_standard_instances i on i.id = r.instance_id
      join connected_standards s on s.id = i.standard_id
     where i.status = 'scheduled'
       and s.active
       and r.status = 'in_progress'
       -- already there: no nudge, ever
       and r.progress_value < i.target_snapshot
       and now() < i.deadline_at
       and array_length(s.reminder_offsets_min, 1) is not null
       -- inside one of the coach's offsets, within a five-minute claim window that matches the
       -- cron's own period so a nudge is neither missed nor sent twice
       and exists (
         select 1 from unnest(s.reminder_offsets_min) off
          where now() >= i.deadline_at - make_interval(mins => off)
            and now() <  i.deadline_at - make_interval(mins => off) + interval '5 minutes'
       )
       -- one reminder per hour per row, whatever the offsets say
       and (r.reminder_sent_at is null or r.reminder_sent_at < now() - interval '55 minutes')
     order by i.deadline_at
     limit greatest(1, p_limit)
     for update of r skip locked
  ), claimed as (
    update connected_standard_results r
       set reminder_sent_at = now(), updated_at = now()
      from due d
     where r.id = d.rid
       and (r.reminder_sent_at is null or r.reminder_sent_at < now() - interval '55 minutes')
    returning r.id, d.athlete_id, d.sid, d.iid, d.title, d.metric_snapshot,
              d.display_unit_snapshot, d.target_snapshot, d.progress_value,
              d.period, d.period_start, d.period_end, d.deadline_at
  )
  select * from claimed;
end $$;

-- ---------------------------------------------------------------- daily materialization
-- ensure_* is callable by an athlete opening Home, but a standard nobody opens still needs its
-- instances so the deadline pass has rows to adjudicate.
create or replace function cs_materialize_all(p_days int default 2) returns integer
language plpgsql security definer set search_path = public as $$
declare v_id uuid; n integer := 0;
begin
  if not exists (select 1 from feature_flags
                  where name = 'connected_standards' and not kill_switch) then
    return 0;
  end if;
  for v_id in select id from connected_standards where active loop
    n := n + cs_materialize_standard(v_id,
      (now() at time zone 'utc')::date, (now() at time zone 'utc')::date + greatest(0, p_days));
  end loop;
  return n;
end $$;

-- ---------------------------------------------------------------- schedule
-- Mirrors schedule_commitment_reminders (0140): the founder runs this once, after deploying the
-- edge function, with its URL and the cron key. Kept as a function rather than a bare cron.schedule
-- call so the migration itself never needs to know the project URL.
create or replace function schedule_connected_standards(p_fn_url text, p_cron_key text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise notice 'pg_cron not installed — skipping schedule';
    return;
  end if;

  perform cron.unschedule('connected-standards-tick')
    where exists (select 1 from cron.job where jobname = 'connected-standards-tick');

  -- Every five minutes: materialize, adjudicate deadlines, send the reminders that came due.
  -- The edge function does all three in one request so there is one thing to watch, not three.
  perform cron.schedule('connected-standards-tick', '*/5 * * * *', format(
    $cmd$select net.http_post(
      url := %L,
      headers := jsonb_build_object('Content-Type','application/json','x-cron-key',%L),
      body := '{}'::jsonb
    );$cmd$, p_fn_url, p_cron_key));
end $$;

-- ---------------------------------------------------------------- grants
-- Every claim function is service_role only: these adjudicate other people's records and must be
-- unreachable from a client session, whatever else goes wrong.
do $$ declare f text; begin
  foreach f in array array[
    'claim_missed_connected_standards(int)',
    'claim_due_connected_standard_reminders(int)',
    'cs_materialize_all(int)',
    'schedule_connected_standards(text,text)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;

revoke all on function cs_stale_after_hours() from public, anon;
grant execute on function cs_stale_after_hours() to authenticated, service_role;
