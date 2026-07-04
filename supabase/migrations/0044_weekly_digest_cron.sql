-- OnStandard — weekly digest scheduling (churn build 2026-07-04).
--
-- The weekly-digest edge function sends every coach/trainer their roster's week (in-app +
-- push) so the product proves its value even to a coach who hasn't opened the app. This
-- migration provides the SCHEDULING seam: pg_cron + pg_net, and a helper the founder (or
-- the deploy runbook) calls ONCE with the function URL + the shared key — the key is a
-- secret, so it is never hardcoded in a committed migration.
--
--   select public.schedule_weekly_digest(
--     'https://<project>.supabase.co/functions/v1/weekly-digest',
--     '<the DIGEST_CRON_KEY value>'
--   );
--
-- Re-running replaces the existing job (idempotent). Default: Sundays 22:00 UTC
-- (~18:00 US Eastern), when the week is complete and the coach plans the next one.

create extension if not exists pg_cron;
create extension if not exists pg_net;

create or replace function public.schedule_weekly_digest(fn_url text, cron_key text)
returns void
language plpgsql security definer set search_path = public as $$
begin
  -- Replace any prior schedule (idempotent re-run with a rotated key or new URL).
  perform cron.unschedule(jobid) from cron.job where jobname = 'weekly-digest';
  perform cron.schedule(
    'weekly-digest',
    '0 22 * * 0', -- Sundays 22:00 UTC
    format(
      $job$ select net.http_post(url := %L, headers := jsonb_build_object('x-digest-key', %L, 'Content-Type', 'application/json'), body := '{}'::jsonb); $job$,
      fn_url, cron_key
    )
  );
end; $$;

-- Founder-only: this reconfigures a scheduled job hitting a paid-ish surface. No client role
-- ever calls it (0035 makes new functions no-EXECUTE by default; make it explicit anyway).
revoke execute on function public.schedule_weekly_digest(text, text) from public, anon, authenticated;
