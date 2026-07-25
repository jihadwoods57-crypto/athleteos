-- OnStandard — capacity fixes from docs/scale/CAPACITY-AUDIT.md, "Before 10k" tier.
--
-- Six independent, additive changes. None alters existing behavior for a caller under today's
-- traffic; each removes a specific scaling wall identified in the audit. Every `create index`
-- uses IF NOT EXISTS so this is safe to re-run.
--
--   A. requirement_sets: plain team_id/practice_id indexes (F20) — every athlete app-open
--      resolves standards through this table; its only existing index is an EXPRESSION index
--      that a plain `where team_id = $1` cannot use.
--   B. Eight hot unindexed foreign keys (F26) — RLS-policy-filtered or account-erasure-cascade
--      columns with no supporting index.
--   C. activity_log / copilot_artifacts indexes (F27) — zero indexes beyond PK on two growing,
--      RLS-filtered tables.
--   D. analytics_events(created_at) index + arm nightly retention + batch the purge delete, and
--      extend retention to ai_usage_key_daily / ai_usage_epoch (F12, F13 partial — the remaining
--      tables in F13/F31 are a "Before 50k" follow-up, not required to survive to 10k).
--   E. claim_due_commitment_reminders / claim_missed_commitments gain a bounded p_limit so a
--      cron tick can never silently mark more rows claimed than it can actually deliver (F8).
--   F. ai_call_costs bounded to a rolling 400-day window so the Command Center's AI-cost views
--      stop aggregating unbounded history on every load (F22).
--   G. claim_ai_usage_key_monthly — a NEW function backing the authed-caller AI spend SIGNAL
--      wired into analyze-meal/assist/meal-chat/coach-voice-nudge in this same change (F1/F2).
--      It reuses the existing ai_usage_key_daily table (month-truncated `day`) rather than adding
--      a new table, and — unlike claim_ai_usage_key — NEVER blocks: `allowed` only reports
--      whether the caller is still under the ceiling so the caller can raise a one-time signal.

-- ============================================================================================
-- A. requirement_sets — plain FK indexes (F20)
-- ============================================================================================
-- The only existing index (0136) is on the EXPRESSION coalesce(team_id, practice_id), which a
-- predicate of the form `where team_id = $1` cannot use. Both plain-column variants were
-- explicitly dropped in 0085/0136 as duplicates of what was believed to be a superset index —
-- they were not a superset for this query shape. Partial indexes (each half is null on the
-- other's rows) so both stay small.
create index if not exists req_sets_team
  on requirement_sets (team_id) where team_id is not null;
create index if not exists req_sets_practice
  on requirement_sets (practice_id) where practice_id is not null;

-- ============================================================================================
-- B. Eight hot unindexed foreign keys (F26)
-- ============================================================================================
create index if not exists practices_owner
  on practices (owner_id);
create index if not exists ae_athlete
  on athlete_exceptions (athlete_id);
create index if not exists staff_invites_team
  on staff_invites (team_id);
create index if not exists threads_counterpart
  on threads (counterpart_id);
create index if not exists meal_comments_author
  on meal_comments (author_id);
create index if not exists plan_assignments_assigned_by
  on plan_assignments (assigned_by);
create index if not exists admin_audit_log_actor
  on admin_audit_log (actor_id);
create index if not exists verification_consent_scope_team
  on verification_consent (scope_team) where scope_team is not null;

-- ============================================================================================
-- C. activity_log / copilot_artifacts (F27)
-- ============================================================================================
create index if not exists activity_log_actor_created
  on activity_log (actor_id, created_at desc);
create index if not exists copilot_artifacts_author_created
  on copilot_artifacts (author_id, created_at desc);

-- ============================================================================================
-- D. Retention: arm it, index what it deletes by, batch the delete, widen scope slightly (F12)
-- ============================================================================================
-- purge_stale_data's `delete ... where created_at < cutoff` on analytics_events had no supporting
-- index — the two existing indexes lead with `name` and `session_id`, neither usable for a
-- date-only range scan. This is the same table the retention job's own header warns is the
-- highest-volume store in the schema.
create index if not exists analytics_events_created
  on analytics_events (created_at);

-- Batched purge: the original single unbounded DELETE would hold a long lock and a large WAL
-- spike the first time it runs against real volume. Loop in bounded chunks, committing between
-- chunks so autovacuum and concurrent writers get a look-in — which requires a PROCEDURE, not a
-- FUNCTION: Postgres only allows transaction-control statements (COMMIT) inside a procedure body
-- invoked via top-level CALL, never inside a function invoked via SELECT. This changes how
-- pg_cron must invoke it (CALL, not SELECT) — schedule_data_retention() below is updated to
-- match. Same 180-day default semantics as the function it replaces.
drop function if exists purge_stale_data(integer);
create or replace procedure purge_stale_data(p_days integer default 180)
language plpgsql security definer set search_path = public as $$
declare
  cutoff timestamptz := now() - make_interval(days => greatest(p_days, 1));
  deleted int;
begin
  loop
    delete from analytics_events
     where ctid in (
       select ctid from analytics_events where created_at < cutoff limit 10000
     );
    get diagnostics deleted = row_count;
    exit when deleted = 0;
    commit;
  end loop;

  loop
    delete from food_cache
     where ctid in (
       select ctid from food_cache where synced_at < cutoff limit 10000
     );
    get diagnostics deleted = row_count;
    exit when deleted = 0;
    commit;
  end loop;

  -- Extend to the two AI-usage counter tables the audit flagged as never trimmed (F13). These are
  -- pure counters (no user-facing history), so a short, fixed window is safe regardless of p_days.
  -- Small tables — no batching needed.
  delete from ai_usage_key_daily where day < current_date - 45;
  delete from ai_usage_epoch    where updated_at < now() - interval '45 days';
  commit;
end; $$;

revoke execute on procedure purge_stale_data(integer) from public, anon, authenticated;

-- Re-arm with the CALL invocation the procedure form requires (schedule_data_retention already
-- unschedules any prior 'data-retention' job before rescheduling, so this is idempotent even if a
-- prior run already armed the old SELECT-based version). Per the 0066 header, this migration is
-- the founder's "run it once at go-live" — reaching 10k without a retention job running is what
-- this fixes.
create or replace function schedule_data_retention() returns void
language plpgsql security definer set search_path = public, cron as $$
begin
  perform cron.unschedule(jobid) from cron.job where jobname = 'data-retention';
  perform cron.schedule('data-retention', '17 3 * * *', 'call public.purge_stale_data();');
end; $$;

revoke execute on function schedule_data_retention() from public, anon, authenticated;

select schedule_data_retention();

-- ============================================================================================
-- E. Bounded claim RPCs — claim_due_commitment_reminders / claim_missed_commitments (F8)
-- ============================================================================================
-- Both previously claimed (UPDATE + mark) an UNBOUNDED number of rows per invocation. If a
-- caller ever receives fewer rows back than were actually marked — whether from a PostgREST
-- response cap or simply because the edge function's own response handling drops rows past some
-- size — those responses are marked delivered/missed and can never be retried; the athlete
-- silently never gets that reminder or escalation. Adding an explicit, small p_limit and having
-- the edge function loop until a partial page comes back removes the dependency on any implicit
-- response-size behavior, in either direction.
drop function if exists claim_due_commitment_reminders(int);
create or replace function claim_due_commitment_reminders(p_grace_min int default 10, p_limit int default 500)
returns table (
  athlete_id uuid, instance_id uuid, title text, body text, offset_min smallint,
  action_label text, respond_by_at timestamptz
)
language plpgsql security definer set search_path = public as $$
begin
  return query
  with due as (
    select r.id as response_id, r.athlete_id, i.id as instance_id,
           coalesce(c.title, 'Commitment') as title,
           c.action_label as action_label,
           coalesce(i.respond_by_at, i.starts_at) as deadline_at,
           o.off
      from commitment_responses r
      join commitment_instances i on i.id = r.instance_id
      join commitments c on c.id = i.commitment_id
      cross join lateral unnest(c.reminder_offsets_min) as o(off)
     where r.status = 'pending'
       and i.status = 'scheduled'
       and c.active
       and coalesce(i.respond_by_at, i.starts_at) is not null
       and not (o.off = any(r.reminded_offsets))
       and now() >= coalesce(i.respond_by_at, i.starts_at) - make_interval(mins => o.off::int)
       and now() <  coalesce(i.respond_by_at, i.starts_at) - make_interval(mins => o.off::int)
                    + make_interval(mins => greatest(1, p_grace_min))
       and vc_enabled(r.athlete_id)
     order by deadline_at
     limit greatest(1, p_limit)
  ), claimed as (
    update commitment_responses r
       set reminded_offsets = array_append(r.reminded_offsets, d.off),
           updated_at = now()
      from due d
     where r.id = d.response_id
    returning r.id, d.athlete_id, d.instance_id, d.title, d.action_label, d.off, d.deadline_at
  )
  select cl.athlete_id, cl.instance_id, cl.title,
         case when cl.off <= 0 then 'Last call. Your coach is waiting.'
              else format('%s minutes left to respond.', cl.off) end as body,
         cl.off::smallint,
         cl.action_label,
         cl.deadline_at
    from claimed cl;
end $$;
revoke all on function claim_due_commitment_reminders(int, int) from public, anon, authenticated;

drop function if exists claim_missed_commitments(int, uuid[]);
create or replace function claim_missed_commitments(p_grace_min int default 10, p_only uuid[] default null, p_limit int default 500)
returns table (instance_id uuid, athlete_id uuid, title text, config jsonb)
language plpgsql security definer set search_path = public as $$
begin
  return query
  with crossed as (
    select r.id as response_id, r.athlete_id, i.id as instance_id,
           coalesce(c.title, 'Commitment') as title, c.escalation as config,
           coalesce(i.respond_by_at, i.starts_at) as deadline_at
      from commitment_responses r
      join commitment_instances i on i.id = r.instance_id
      join commitments c on c.id = i.commitment_id
     where r.status = 'pending'
       and i.status = 'scheduled'
       and c.active
       and coalesce(i.respond_by_at, i.starts_at) is not null
       and now() >= coalesce(i.respond_by_at, i.starts_at)
       and now() <  coalesce(i.respond_by_at, i.starts_at) + make_interval(mins => greatest(1, p_grace_min))
       and (p_only is null or r.athlete_id = any(p_only))
     order by deadline_at
     limit greatest(1, p_limit)
  ), claimed as (
    update commitment_responses r
       set status = 'missed', updated_at = now()
      from crossed x
     where r.id = x.response_id and r.status = 'pending'
    returning x.instance_id, x.athlete_id, x.title, x.config
  )
  select cl.instance_id, cl.athlete_id, cl.title, cl.config from claimed cl;
end $$;
revoke all on function claim_missed_commitments(int, uuid[], int) from public, anon, authenticated;

-- ============================================================================================
-- F. Bound ai_call_costs to a rolling window (F22)
-- ============================================================================================
-- ai_cost_daily / ai_cost_per_meal / ai_verify_effectiveness all group-by over this view with NO
-- date filter of their own, and admin_ai_cost/admin_ai_verify filter the ALREADY-GROUPED result —
-- so every Command Center load aggregated the full, unbounded history of ai_calls, with a per-row
-- LATERAL price join on top. Pushing a 400-day bound into the base view (matching the F13
-- retention window planned for ai_calls) shrinks all three dependents without changing a single
-- output column, so nothing downstream needs to change. 400 days rather than the p_days callers
-- actually request (14-30) deliberately leaves headroom for any wider ad-hoc query against these
-- views run directly (`supabase db query --linked`).
create or replace view public.ai_call_costs as
select
  c.*,
  p.input_usd_per_mtok,
  p.output_usd_per_mtok,
  round(
      (c.input_tokens::numeric          / 1000000) * p.input_usd_per_mtok
    + (c.output_tokens::numeric         / 1000000) * p.output_usd_per_mtok
    + (c.cache_creation_tokens::numeric / 1000000) * p.cache_write_usd_per_mtok
    + (c.cache_read_tokens::numeric     / 1000000) * p.cache_read_usd_per_mtok
  , 6) as cost_usd
from public.ai_calls c
left join lateral (
  select *
  from public.ai_model_prices mp
  where mp.model = c.model
    and mp.effective_from <= c.created_at
  order by mp.effective_from desc
  limit 1
) p on true
where c.created_at >= now() - interval '400 days';

-- ============================================================================================
-- G. claim_ai_usage_key_monthly — authed AI-spend SIGNAL, never blocks (F1/F2)
-- ============================================================================================
-- Sibling of claim_ai_usage_key (0030) on the SAME table (ai_usage_key_daily), keyed by a
-- month-truncated `day` instead of the current day. Deliberately does NOT gate on p_limit inside
-- the UPDATE — it always increments and always returns a row, because this is a budget SIGNAL a
-- caller uses to decide whether to raise a one-time alert, not a gate a caller uses to decide
-- whether to deny a request. See supabase/functions/_shared/ai-tier-budget.ts for the caller.
create or replace function public.claim_ai_usage_key_monthly(p_key text, p_limit int)
returns table (allowed boolean, used int)
language plpgsql
security definer
set search_path = public
as $$
declare
  c int;
  v_month date := date_trunc('month', current_date)::date;
begin
  insert into public.ai_usage_key_daily (key, day, count)
  values (p_key, v_month, 0)
  on conflict (key, day) do nothing;

  update public.ai_usage_key_daily
     set count = count + 1, updated_at = now()
   where key = p_key and day = v_month
   returning count into c;

  return query select (c <= p_limit), coalesce(c, 0);
end;
$$;

revoke execute on function public.claim_ai_usage_key_monthly(text, int) from public, anon, authenticated;
grant  execute on function public.claim_ai_usage_key_monthly(text, int) to service_role;
