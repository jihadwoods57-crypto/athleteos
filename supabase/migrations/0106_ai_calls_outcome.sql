-- 0106_ai_calls_outcome.sql — records whether a paid AI call changed anything.
-- Used by the meal verifier (mode='verify') to prove the second call earns its keep:
-- 'no_change' | 'macros_moved' | 'allergen_caught'. Nullable; null for every non-verify call.
-- Idempotent — safe to re-run via a later `supabase db push`.
alter table public.ai_calls add column if not exists outcome text;

-- Refresh the cost views so ai_call_costs exposes the new `outcome` column. The 0105 view used
-- `select c.*`, which Postgres expands to the then-current columns AT CREATION — a new base column
-- does not appear until the view is recreated. CREATE OR REPLACE can't reorder columns and c.*
-- would insert `outcome` mid-list, so drop + recreate (cascade rebuilds the two rollups too).
drop view if exists public.ai_call_costs cascade;  -- cascades to ai_cost_daily + ai_cost_per_meal

create view public.ai_call_costs as
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
) p on true;

create view public.ai_cost_daily as
select
  date_trunc('day', created_at)   as day,
  fn,
  model,
  count(*)                        as calls,
  count(*) filter (where not ok)  as failed_calls,
  sum(input_tokens)               as input_tokens,
  sum(output_tokens)              as output_tokens,
  sum(cache_read_tokens)          as cache_read_tokens,
  round(avg(latency_ms))          as avg_latency_ms,
  max(latency_ms)                 as max_latency_ms,
  round(sum(cost_usd), 4)         as cost_usd
from public.ai_call_costs
group by 1, 2, 3
order by 1 desc, cost_usd desc nulls last;

create view public.ai_cost_per_meal as
select
  date_trunc('day', created_at)                                                as day,
  count(*) filter (where mode = 'meal' and phase = 'analyze')                   as meals,
  count(*) filter (where fn = 'analyze-meal' and mode = 'meal')                 as meal_calls,
  round(sum(cost_usd) filter (where fn = 'analyze-meal' and mode = 'meal'), 4)  as meal_cost_usd,
  round(
    sum(cost_usd) filter (where fn = 'analyze-meal' and mode = 'meal')
      / nullif(count(*) filter (where mode = 'meal' and phase = 'analyze'), 0)
  , 4)                                                                          as cost_per_meal_usd,
  round(avg(latency_ms) filter (where fn = 'analyze-meal' and mode = 'meal'))   as avg_meal_latency_ms
from public.ai_call_costs
group by 1
order by 1 desc;
