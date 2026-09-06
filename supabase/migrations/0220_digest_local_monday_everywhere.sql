-- 0220: the Monday digest is Monday everywhere, not only west of UTC+7 (2026-09-05 audit, parked).
--
-- 0218 moved the weekly-digest job to `0 * * * 1`: every hour on Monday, UTC. The function then
-- sends each coach in the one hourly run that is 7 AM in their own timezone. That works for any
-- coach whose local Monday 7 AM falls inside UTC Monday, which is everyone from UTC-12 up to
-- UTC+7. It fails for everyone further east. A Singapore coach (UTC+8) has their Monday 7 AM at
-- Sunday 23:00 UTC; the cron never fires on Sunday, so the function never sees that hour, and
-- the first run that IS 7 AM local for them is Tuesday. They got the "Monday read" a day late,
-- every week, since 0218 was applied.
--
-- Local Monday 7 AM across every inhabited offset (UTC-12 through UTC+14) spans Sunday 17:00 UTC
-- to Monday 19:00 UTC. A single cron expression cannot say "Sunday evening plus all of Monday",
-- and two jobs under one jobname is the 0159 trap (one unschedule deletes the other). So the job
-- now fires every hour of every day and the function owns the whole decision: it returns at once
-- outside the Sunday 17:00 to Monday 19:00 UTC window (logic.mjs digestWindowOpen, no reads), and
-- inside it sends only the coaches for whom it is local Monday at DIGEST_LOCAL_HOUR right now.
--
-- IDEMPOTENCY. The function's guard was a 6-day lookback on the coach's own `digest` notification
-- row. That row is deletable by its owner (notif_delete, 0027): a coach who clears the bell at
-- 7:10 AM erases the only proof they were sent, and the next hourly run doubles them. So this
-- migration adds profiles.digest_last_sent_at, a marker only the service role writes, and the
-- function refuses to send while it is younger than 6 days. The notification-row check stays as
-- a second belt. Nothing here depends on the function being deployed first or second: an old
-- function under the hourly cron would still send everyone at their local 7 AM exactly once on
-- Monday, because the 0218 hour gate and 6-day dedupe already hold; it would only keep failing
-- east of UTC+7 the way it does today.
--
-- Same helper contract as 0044/0182/0218 (the founder runs it once with the real URL + key,
-- which never enter a migration), and the same alter_job block as 0218 so an already installed
-- job moves without anyone re-running the helper. Reversible-safe: IF NOT EXISTS on the column,
-- no data touched, no existing migration edited.

alter table profiles add column if not exists digest_last_sent_at timestamptz;

comment on column profiles.digest_last_sent_at is
  'When the weekly-digest function last sent this coach their Monday read. Written by the service '
  'role only; the function will not send again while this is younger than 6 days, so an hourly '
  'cron and a coach who clears their bell cannot combine into two digests in one week. Null = never sent.';

create or replace function public.schedule_weekly_digest(fn_url text, cron_key text)
returns void
language plpgsql security definer set search_path = public as $$
begin
  -- Replace any prior schedule (idempotent re-run with a rotated key or new URL).
  perform cron.unschedule(jobid) from cron.job where jobname = 'weekly-digest';
  perform cron.schedule(
    'weekly-digest',
    '0 * * * *', -- every hour, every day; the function sends each coach at their own local Monday 7 AM
    format(
      $job$ select net.http_post(url := %L, headers := jsonb_build_object('x-digest-key', %L, 'Content-Type', 'application/json'), body := '{}'::jsonb); $job$,
      fn_url, cron_key
    )
  );
end; $$;

-- Founder-only, as before (0035 default + explicit belt).
revoke execute on function public.schedule_weekly_digest(text, text) from public, anon, authenticated;

-- Move the live job without asking anyone to re-run the helper. The command (URL + key) is kept;
-- only the schedule changes. No pg_cron, or no job yet: nothing to do.
do $$
declare j record;
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then return; end if;
  for j in select jobid, jobname from cron.job
            where jobname = 'weekly-digest' and schedule <> '0 * * * *' loop
    begin
      perform cron.alter_job(job_id => j.jobid, schedule => '0 * * * *');
      raise notice 'moved % to an hourly daily cadence (local Monday 7 AM per coach, any timezone)', j.jobname;
    exception when others then
      raise notice 'could not move %: %', j.jobname, sqlerrm;
    end;
  end loop;
end $$;
