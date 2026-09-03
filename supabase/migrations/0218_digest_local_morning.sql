-- 0218: the weekly digest lands at 7 AM in each coach's OWN timezone (2026-09-03 notification pass).
--
-- 0182 fired the job once, Mondays 12:00 UTC: 8 AM in New York, 5 AM in Los Angeles, and an hour
-- off either way at every DST change. The weekly-digest function now decides per recipient
-- (profiles.timezone, 0088; DEFAULT_TIMEZONE for a profile that never reported one) and only
-- sends when it is DIGEST_LOCAL_HOUR (7) where that coach lives. So the job fires every hour on
-- Monday and each coach's 7 AM comes around exactly once; the function's 6-day dedupe on the
-- `digest` notification row is what keeps the other 23 runs from doubling anyone.
--
-- Same helper contract as 0044/0182 (the founder runs it once with the real URL + key, which never
-- enter a migration). Unlike 0182, this file ALSO moves an already-installed job to the new cadence
-- (the 0211 alter_job pattern), so nothing has to be re-run by hand for the change to take effect.
create or replace function public.schedule_weekly_digest(fn_url text, cron_key text)
returns void
language plpgsql security definer set search_path = public as $$
begin
  -- Replace any prior schedule (idempotent re-run with a rotated key or new URL).
  perform cron.unschedule(jobid) from cron.job where jobname = 'weekly-digest';
  perform cron.schedule(
    'weekly-digest',
    '0 * * * 1', -- every hour on Monday; the function sends each coach at their own local 7 AM
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
            where jobname = 'weekly-digest' and schedule <> '0 * * * 1' loop
    begin
      perform cron.alter_job(job_id => j.jobid, schedule => '0 * * * 1');
      raise notice 'moved % to an hourly Monday cadence (local 7 AM per coach)', j.jobname;
    exception when others then
      raise notice 'could not move %: %', j.jobname, sqlerrm;
    end;
  end loop;
end $$;
