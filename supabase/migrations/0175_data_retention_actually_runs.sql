-- OnStandard — make the nightly data-retention purge actually run.
--
-- WHAT WAS HAPPENING. 0148 rewrote purge_stale_data as a PROCEDURE with intra-loop COMMITs and
-- rescheduled the cron as `call public.purge_stale_data();` — correct per the Postgres docs,
-- where a top-level CALL may control transactions. But this pg_cron executes every job command
-- inside an explicit transaction block, so the CALL is never top-level and the first COMMIT
-- raises "invalid transaction termination". cron.job_run_details shows the job failing with
-- exactly that, at 03:17 UTC, EVERY night since — the retention promise in 0066 (and the
-- compliance docs that cite it) has not been kept once since 0148 shipped. Nothing surfaced it
-- because a cron failure writes a row nobody reads; found during the 2026-07-31 launch audit.
-- Same lesson as test:rls going silently dead — a safety mechanism that only fails in a log it
-- assumes someone tails is decorative.
--
-- THE FIX. Give up transaction control entirely — under this pg_cron there is no such thing —
-- and bound the work per RUN instead of per COMMIT: up to 20 batches of 10k rows per table per
-- night, one transaction. The commit-per-batch design existed so autovacuum and concurrent
-- writers get a look-in during a huge backlog purge; a 200k-row ceiling per night serves the
-- same end (bounded transaction size and duration) and the nightly cadence catches up on any
-- backlog within a few days. Steady-state nightly deltas are a fraction of one batch.
--
-- Stays a PROCEDURE so the scheduled `call` command keeps working untouched.
create or replace procedure purge_stale_data(p_days integer default 180)
language plpgsql security definer set search_path = public as $$
declare
  cutoff  timestamptz := now() - make_interval(days => greatest(p_days, 1));
  deleted int;
  batches int;
begin
  batches := 0;
  loop
    delete from analytics_events
     where ctid in (
       select ctid from analytics_events where created_at < cutoff limit 10000
     );
    get diagnostics deleted = row_count;
    batches := batches + 1;
    exit when deleted = 0 or batches >= 20;
  end loop;

  batches := 0;
  loop
    delete from food_cache
     where ctid in (
       select ctid from food_cache where synced_at < cutoff limit 10000
     );
    get diagnostics deleted = row_count;
    batches := batches + 1;
    exit when deleted = 0 or batches >= 20;
  end loop;

  -- The two AI-usage counter tables 0148 added (F13). Small, fixed 45-day window, no batching.
  delete from ai_usage_key_daily where day < current_date - 45;
  delete from ai_usage_epoch    where updated_at < now() - interval '45 days';
end; $$;

-- create or replace preserves the ACL, but restate the posture anyway.
revoke execute on procedure purge_stale_data(integer) from public, anon, authenticated;

-- The cron job itself is untouched: same name, same '17 3 * * *', same `call` command — that
-- command was always right; the body it called could not run under it.
--
-- ROLLBACK: re-run 0148's create or replace of purge_stale_data (restores the COMMIT-per-batch
-- body). Doing so restores the nightly failure too — there is no reason to.
