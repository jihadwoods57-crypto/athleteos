-- 0107_meal_quality_metrics.sql — AI back-half item 8b: the auto-computable quality metrics.
--
-- Two additions, both read-only aggregations over data ALREADY captured (0052 analytics_events +
-- 0105/0106 ai_calls) plus one new anonymous event (meal_corrected, counts-only, no macros/text —
-- same privacy posture as every other analytics_events row). Nothing in the AI pipeline changes.
--
-- admin_meal_quality_metrics() operationalizes the exact thresholds docs/audit/tier1-deploy-plan.md
-- already promised as a pending manual check ("run ~2026-07-24 and ~2026-07-28"): median |delta| >
-- 25 after 50+ events, one-sided bias <= -15, or text-conflict > 10% are each a founder scoring-
-- bands decision, not a silent retune. This turns that one-off SQL block into a reusable, platform-
-- admin-gated RPC (same is_platform_admin() gate as 0052's admin_event_counts).
create or replace function admin_meal_quality_metrics(p_days int default 7)
returns table (
  window_days           int,
  meals_logged          bigint,   -- MEAL_LOGGED events with source='photo' (the AI-analyzed denominator)
  score_delta_events    bigint,
  median_delta          numeric,  -- app score minus AI score; near 0 is healthy
  median_abs_delta      numeric,  -- tier1 threshold: > 25 (at 50+ events) is a founder decision
  min_delta             int,
  max_delta             int,
  text_conflict_count   bigint,
  text_conflict_rate    numeric,  -- tier1 threshold: > 0.10 is a founder decision
  corrected_count       bigint,
  correction_rate       numeric,  -- share of AI-analyzed meals the athlete had to fix
  analysis_failed_count bigint,
  analysis_failure_rate numeric   -- failed / (logged + failed)
)
language plpgsql stable security definer set search_path = public as $$
declare
  since timestamptz := now() - make_interval(days => greatest(p_days, 1));
  logged bigint;
  failed bigint;
begin
  if not is_platform_admin() then raise exception 'not authorized'; end if;

  select count(*) into logged from analytics_events
    where created_at >= since and name = 'meal_logged' and props->>'source' = 'photo';
  select count(*) into failed from analytics_events
    where created_at >= since and name = 'meal_analysis_failed';

  return query
    select
      greatest(p_days, 1),
      logged,
      (select count(*) from analytics_events where created_at >= since and name = 'meal_score_delta'),
      (select (percentile_cont(0.5) within group (order by (props->>'delta')::int))::numeric
         from analytics_events where created_at >= since and name = 'meal_score_delta'),
      (select (percentile_cont(0.5) within group (order by abs((props->>'delta')::int)))::numeric
         from analytics_events where created_at >= since and name = 'meal_score_delta'),
      (select min((props->>'delta')::int) from analytics_events where created_at >= since and name = 'meal_score_delta'),
      (select max((props->>'delta')::int) from analytics_events where created_at >= since and name = 'meal_score_delta'),
      (select count(*) from analytics_events where created_at >= since and name = 'meal_text_conflict'),
      round((select count(*) from analytics_events where created_at >= since and name = 'meal_text_conflict')::numeric
        / nullif(logged, 0), 4),
      (select count(*) from analytics_events where created_at >= since and name = 'meal_corrected'),
      round((select count(*) from analytics_events where created_at >= since and name = 'meal_corrected')::numeric
        / nullif(logged, 0), 4),
      failed,
      round(failed::numeric / nullif(logged + failed, 0), 4);
end $$;
grant execute on function admin_meal_quality_metrics(int) to authenticated;

-- Verifier effectiveness (item 6 upgrade #1), now queryable directly instead of hand-rolled SQL.
-- service_role-only, matching the ai_cost_* view access pattern from 0105 (founder reads via
-- `supabase db query --linked`, not the app) — ai_calls carries a user_id, unlike analytics_events.
create or replace view public.ai_verify_effectiveness as
select
  date_trunc('day', created_at)                                  as day,
  phase                                                          as trigger,
  count(*)                                                       as verify_calls,
  count(*) filter (where ok)                                     as succeeded,
  count(*) filter (where outcome = 'allergen_caught')             as allergen_caught,
  count(*) filter (where outcome = 'macros_moved')                as macros_moved,
  count(*) filter (where outcome = 'no_change')                   as no_change,
  round(
    count(*) filter (where outcome in ('allergen_caught', 'macros_moved'))::numeric
      / nullif(count(*) filter (where ok), 0)
  , 4)                                                            as changed_rate,
  round(sum(cost_usd) filter (where ok), 4)                       as cost_usd
from public.ai_call_costs
where mode = 'verify'
group by 1, 2
order by 1 desc, 2;
