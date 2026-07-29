-- OnStandard 0160 — winback: the flag and the schedule for the one message that reaches someone
-- who has already stopped.
--
-- Every reminder before this was anchored to a requirement that exists today, so an athlete who
-- logged nothing got a 'soon', a 'due', and then permanent silence. The selection contract lives
-- in supabase/functions/_shared/winback.ts (two messages in a lifetime, day 3 and day 10, never to
-- a new account, never to someone who never logged, never twice at the same stage).
--
-- The flag FAILS CLOSED, deliberately unlike rollcall_lockscreen (which fails open because a
-- missing roll call is a broken promise to a coach). Here the failure modes are asymmetric: not
-- sending costs us a lapsed athlete we had probably already lost, while sending by accident nags
-- someone who is unhappy with us and confirms their decision to leave. Silence is the safe default,
-- so the row is seeded off and the function no-ops until a human turns it on.
insert into public.feature_flags (name, description, default_on, kill_switch, enabled_user_ids)
values ('winback',
        'Lapsed-athlete re-engagement: at most two pushes in a lifetime (day 3, day 10). Fails CLOSED — off unless explicitly enabled.',
        false, false, '{}'::uuid[])
on conflict (name) do nothing;

-- ---------------------------------------------------------------- schedule
-- Mirrors schedule_connected_standards (0156) and schedule_commitment_escalation (0159): the
-- operator runs this once, after deploying the function, so the migration never needs to know the
-- project URL. Its own job name — see 0159 for what happens when two schedules share one.
create or replace function schedule_winback(p_fn_url text, p_cron_key text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise notice 'pg_cron not installed — skipping schedule';
    return;
  end if;

  perform cron.unschedule(jobid) from cron.job where jobname = 'winback-daily';

  -- Once a day at 17:10 UTC, not hourly. The function's own dedupe is durable, so a second run
  -- would find nothing to do — but a daily message deserves a daily job, and a mid-afternoon
  -- send lands in waking hours across the US timezones this is launching into.
  perform cron.schedule('winback-daily', '10 17 * * *', format(
    $cmd$select net.http_post(
      url := %L,
      headers := jsonb_build_object('Content-Type','application/json','x-winback-key',%L),
      body := '{}'::jsonb
    );$cmd$, p_fn_url, p_cron_key));
end $$;

-- Reaches other people's athletes — service_role only, never callable from a client session.
revoke all on function schedule_winback(text, text) from public, anon, authenticated;
grant execute on function schedule_winback(text, text) to service_role;
