-- 0182: the weekly digest moves to Monday morning (2026-08-05 digest rebuild).
-- (numbered 0182 because a concurrent session shipped 0181_day_push_grants mid-build)
--
-- 0044 scheduled Sunday 22:00 UTC — a Sunday-night receipt for a week already over. The digest's
-- rebuilt content (who held standard, who's slipping, whose run broke) is a PLAN, and a plan
-- lands Monday morning where it can still change the week: 12:00 UTC is 7/8 AM Eastern, before
-- practice, after the athletes' Sunday rows have all landed.
--
-- Same helper contract as 0044 (founder runs it once with the real URL + key, which never enter
-- a migration); replacing the function does NOT reschedule the live job — the founder (or the
-- ship checklist) re-runs schedule_weekly_digest to pick up the new expression. Its own
-- unschedule-by-name makes the re-run idempotent, and the job name is unique to this feature
-- (the 0159 lesson: a shared jobname deletes the other job).
create or replace function public.schedule_weekly_digest(fn_url text, cron_key text)
returns void
language plpgsql security definer set search_path = public as $$
begin
  -- Replace any prior schedule (idempotent re-run with a rotated key or new URL).
  perform cron.unschedule(jobid) from cron.job where jobname = 'weekly-digest';
  perform cron.schedule(
    'weekly-digest',
    '0 12 * * 1', -- Mondays 12:00 UTC (7/8 AM Eastern)
    format(
      $job$ select net.http_post(url := %L, headers := jsonb_build_object('x-digest-key', %L, 'Content-Type', 'application/json'), body := '{}'::jsonb); $job$,
      fn_url, cron_key
    )
  );
end; $$;

-- Founder-only, as before (0035 default + explicit belt).
revoke execute on function public.schedule_weekly_digest(text, text) from public, anon, authenticated;
