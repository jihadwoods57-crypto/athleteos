-- OnStandard — data retention / storage limitation (GDPR Art. 5(1)(e): personal data kept "no
-- longer than is necessary"). CCPA/CPRA also requires disclosing + observing retention periods.
--
-- THE GAP (compliance audit 2026-07-15): nothing purged old data. analytics_events (pseudonymous
-- funnel telemetry keyed by session_id) grew UNBOUNDED, and food_cache carried only a commented-
-- out cleanup suggestion (0021). Active-account meal/day/checkin data is intentionally retained
-- while the account lives (deleted on account erasure, 0007) — that is legitimate; this migration
-- bounds the two stores that have no reason to be kept indefinitely.
--
-- WHAT IT DOES: purge_stale_data() deletes analytics_events + food_cache rows older than 180
-- days. schedule_data_retention() registers it as a nightly pg_cron job (idempotent). Both are
-- authored here; the founder RUNS schedule_data_retention() once at go-live to arm it (mirrors
-- the 0044 weekly-digest scheduling seam), and can tune the window/cadence.
--
-- GUARDRAIL: authored only — NOT applied to live by the audit. If schedule_data_retention() is
-- never called, nothing is scheduled and the function is simply available for manual/ad-hoc runs.

create extension if not exists pg_cron;

-- Delete telemetry + cache older than the retention window. SECURITY DEFINER so the scheduled
-- job can delete regardless of RLS; touches only non-identifying telemetry + a public food cache,
-- never a user's own meal/day/checkin history (that lives until account deletion).
create or replace function purge_stale_data(p_days integer default 180) returns void
language plpgsql security definer set search_path = public as $$
declare
  cutoff timestamptz := now() - make_interval(days => greatest(p_days, 1));
begin
  -- Pseudonymous funnel events: no need to retain indefinitely (Art. 5(1)(e)).
  delete from analytics_events where created_at < cutoff;
  -- Non-personal food-facts cache: bound it so it does not grow forever (the 0021 TODO).
  delete from food_cache where synced_at < cutoff;
end; $$;

-- Not app-callable — it runs only inside the scheduled job / a founder session.
revoke execute on function purge_stale_data(integer) from anon, authenticated;

-- Arm the nightly purge. Idempotent: replaces any prior schedule. Founder runs this once at
-- go-live (e.g. `select schedule_data_retention();`); pg_cron then runs it unattended.
create or replace function schedule_data_retention() returns void
language plpgsql security definer set search_path = public, cron as $$
begin
  perform cron.unschedule(jobid) from cron.job where jobname = 'data-retention';
  perform cron.schedule('data-retention', '17 3 * * *', 'select public.purge_stale_data();');
end; $$;

revoke execute on function schedule_data_retention() from anon, authenticated;
