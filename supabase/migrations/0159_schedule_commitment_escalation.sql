-- OnStandard 0159 — give commitment-escalation its own scheduler.
--
-- docs/go-live/ROLLCALL-LOCKSCREEN.md told the operator to schedule the escalation ladder by
-- calling schedule_commitment_reminders() a second time with the escalation URL. That function
-- (0140) hardcodes the job name:
--
--   perform cron.unschedule(jobid) from cron.job where jobname = 'commitment-reminders';
--   perform cron.schedule('commitment-reminders', ...)
--
-- so the second call does not add the ladder — it DELETES the reminder job and puts escalation in
-- its place. The failure is silent and inverted: reminders stop going out, while the ladder that
-- only exists to chase people who ignored a reminder runs in their stead. Nothing errors, and
-- cron.job still shows one healthy row.
--
-- Escalation gets its own function and its own job name. Same cadence, same shared secret
-- (COMMITMENT_CRON_KEY — the ladder deliberately does not mint a second one), same shape as
-- schedule_connected_standards (0156).
create or replace function schedule_commitment_escalation(p_fn_url text, p_cron_key text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise notice 'pg_cron not installed — skipping schedule';
    return;
  end if;

  perform cron.unschedule(jobid) from cron.job where jobname = 'commitment-escalation';

  -- Every five minutes, right behind commitment-reminders. With the rollcall_lockscreen flag off
  -- this is a no-op that returns { skipped: 'flag off' }, so scheduling it early is safe.
  perform cron.schedule('commitment-escalation', '*/5 * * * *', format(
    $cmd$select net.http_post(
      url := %L,
      headers := jsonb_build_object('Content-Type','application/json','x-commitment-key',%L),
      body := '{}'::jsonb
    );$cmd$, p_fn_url, p_cron_key));
end $$;

-- Adjudicates other people's commitments — service_role only, never reachable from a client.
revoke all on function schedule_commitment_escalation(text, text) from public, anon, authenticated;
grant execute on function schedule_commitment_escalation(text, text) to service_role;
