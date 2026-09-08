-- 0222: the scheduler for meal-miss-escalation (2026-09-08).
--
-- The function has been deployed and inert since 2026-09-07: with no MEAL_MISS_CRON_KEY set it
-- 401s every request, which is the correct closed failure but means the absence half of
-- accountability has never actually run. This installs the job.
--
-- Same helper contract as 0044 / 0182 / 0218: the URL and the key never enter a migration file,
-- because a migration is committed to git and a cron key is a credential. The founder (or the
-- deploy that installs this) calls the helper once with the real values.
--
-- CADENCE: every 15 minutes. The function compares `now` against the `dueAt` the CLIENT wrote
-- into days.tasks from the athlete's own local clock — it derives no deadline of its own (see the
-- header comment in the function; a second deadline engine here is the two-authorities bug). A
-- 15-minute tick is therefore the resolution of the miss, not of the deadline: the deadline is
-- already exact, and this is how soon after it we notice. Finer costs a function invocation every
-- few minutes for a window that only moves three times a day; coarser lets an athlete sit an hour
-- past lunch before anything says so, by which point "you can still eat" has stopped being true.
create or replace function public.schedule_meal_miss_escalation(fn_url text, cron_key text)
returns void
language plpgsql security definer set search_path = public as $$
begin
  -- Idempotent: a re-run with a rotated key or a new URL replaces the job rather than stacking.
  perform cron.unschedule(jobid) from cron.job where jobname = 'meal-miss-escalation';
  perform cron.schedule(
    'meal-miss-escalation',
    '*/15 * * * *',
    format(
      $job$ select net.http_post(url := %L, headers := jsonb_build_object('x-miss-key', %L, 'Content-Type', 'application/json'), body := '{}'::jsonb); $job$,
      fn_url, cron_key
    )
  );
end; $$;

-- Founder-only, as with every other scheduler helper (0035 default + explicit belt).
revoke execute on function public.schedule_meal_miss_escalation(text, text) from public, anon, authenticated;
