-- OnStandard — Admin Command Center v1 RPCs (handoff Section 17). The founder dashboard (web/admin)
-- signs in with their own account (anon key + login JWT; never the service-role key) and reads
-- everything through these platform-admin-gated SECURITY DEFINER RPCs. The underlying cost/verify/
-- audit tables + views are deny-by-default to `authenticated` (0105/0107/0109), so a definer RPC
-- owned by a privileged role is the only bridge — exactly the 0037/0052/0107/0109 precedent.
--
-- Numbered 0111 (after the flag system's 0109/0110) so admin_recent_audit can read admin_audit_log.
-- Read-only: no RPC here mutates state. Every one gates on is_platform_admin() and grants execute
-- to `authenticated` (the gate, not the grant, is the boundary — a non-admin gets 'not authorized').

-- ---------------------------------------------------------------- AI cost: daily cost-per-meal series
-- Drives the AI-cost panel + sparkline + current cost/meal. Reads the ready-made ai_cost_per_meal
-- view (0106). NULL cost_per_meal_usd on a day means the model was unpriced that day (left join).
create or replace function admin_ai_cost(p_days int default 14)
returns table (day date, meal_calls bigint, cost_per_meal_usd numeric, meal_cost_usd numeric, avg_meal_latency_ms numeric)
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_platform_admin() then raise exception 'not authorized'; end if;
  return query
    select v.day::date, v.meal_calls, v.cost_per_meal_usd, v.meal_cost_usd, v.avg_meal_latency_ms
    from ai_cost_per_meal v
    where v.day >= current_date - (greatest(p_days, 1) - 1)
    order by v.day desc;
end $$;
grant execute on function admin_ai_cost(int) to authenticated;

-- ---------------------------------------------------------------- AI cost: by function + model
-- The "where is the money going" table. Sums real dollars from ai_call_costs (0106).
create or replace function admin_ai_cost_by_fn(p_days int default 14)
returns table (fn text, model text, calls bigint, cost_usd numeric, avg_latency_ms numeric)
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_platform_admin() then raise exception 'not authorized'; end if;
  return query
    select c.fn, c.model, count(*)::bigint as calls,
           round(coalesce(sum(c.cost_usd), 0), 4) as cost_usd,
           round(avg(c.latency_ms)::numeric, 0) as avg_latency_ms
    from ai_call_costs c
    where c.created_at >= current_date - (greatest(p_days, 1) - 1)
    group by c.fn, c.model
    order by cost_usd desc nulls last;
end $$;
grant execute on function admin_ai_cost_by_fn(int) to authenticated;

-- ---------------------------------------------------------------- AI verify effectiveness (one row)
-- Feeds the "verify too tight / too loose" attention rule. Aggregates ai_verify_effectiveness (0107).
create or replace function admin_ai_verify(p_days int default 14)
returns table (verify_calls bigint, succeeded bigint, changed bigint, changed_rate numeric, cost_usd numeric)
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_platform_admin() then raise exception 'not authorized'; end if;
  return query
    select coalesce(sum(v.verify_calls), 0)::bigint,
           coalesce(sum(v.succeeded), 0)::bigint,
           coalesce(sum(v.allergen_caught + v.macros_moved), 0)::bigint as changed,
           round(coalesce(sum(v.allergen_caught + v.macros_moved), 0)::numeric
                 / nullif(sum(v.succeeded), 0), 4) as changed_rate,
           round(coalesce(sum(v.cost_usd), 0), 4) as cost_usd
    from ai_verify_effectiveness v
    where v.day >= current_date - (greatest(p_days, 1) - 1);
end $$;
grant execute on function admin_ai_verify(int) to authenticated;

-- ---------------------------------------------------------------- Revenue (one row)
-- Reads subscriptions ONLY — there is no separate consumer_iap table; a consumer sub is a
-- subscriptions row with tier='consumer' (0102). Returns zeros today; lives the moment a webhook
-- writes a paying row. mrr_estimate_usd uses PLACEHOLDER per-tier rates — SYNC WITH _shared/plans.ts
-- before trusting the dollar figure; the counts/seats are exact.
create or replace function admin_revenue()
returns table (active_subs bigint, team_subs bigint, consumer_subs bigint, seats_used bigint, mrr_estimate_usd numeric)
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_platform_admin() then raise exception 'not authorized'; end if;
  return query
    select
      count(*) filter (where s.status = 'active')::bigint as active_subs,
      count(*) filter (where s.status = 'active' and s.tier = 'team')::bigint as team_subs,
      count(*) filter (where s.status = 'active' and s.tier = 'consumer')::bigint as consumer_subs,
      coalesce(sum(s.seats_used) filter (where s.status = 'active' and s.tier = 'team'), 0)::bigint as seats_used,
      -- PLACEHOLDER rates ($/mo): consumer flat, team per active seat. Replace with plans.ts values.
      round(
        count(*) filter (where s.status = 'active' and s.tier = 'consumer') * 12.0
        + coalesce(sum(s.seats_used) filter (where s.status = 'active' and s.tier = 'team'), 0) * 8.0
      , 2) as mrr_estimate_usd
    from subscriptions s;
end $$;
grant execute on function admin_revenue() to authenticated;

-- ---------------------------------------------------------------- System health: AI ok-rate by fn
-- "Is anything on fire" — per-function success rate from ai_calls (0105/0106). Feeds the ai_ok_rate
-- attention rule. Client app_error counts come from admin_event_counts (0052), no new RPC needed.
create or replace function admin_system_health(p_days int default 7)
returns table (fn text, calls bigint, ok_calls bigint, ok_rate numeric)
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_platform_admin() then raise exception 'not authorized'; end if;
  return query
    select c.fn, count(*)::bigint as calls,
           count(*) filter (where c.ok)::bigint as ok_calls,
           round(count(*) filter (where c.ok)::numeric / nullif(count(*), 0), 4) as ok_rate
    from ai_calls c
    where c.created_at >= current_date - (greatest(p_days, 1) - 1)
    group by c.fn
    order by ok_rate asc nulls first, calls desc;
end $$;
grant execute on function admin_system_health(int) to authenticated;

-- ---------------------------------------------------------------- Recent founder-action audit
-- Surfaces admin_audit_log (0109) — the flag edits etc. This is the Command Center's audit view.
create or replace function admin_recent_audit(p_limit int default 50)
returns table (id bigint, created_at timestamptz, action text, target text, actor_id uuid)
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_platform_admin() then raise exception 'not authorized'; end if;
  return query
    select a.id, a.created_at, a.action, a.target, a.actor_id
    from admin_audit_log a
    order by a.created_at desc
    limit greatest(least(p_limit, 500), 1);
end $$;
grant execute on function admin_recent_audit(int) to authenticated;
