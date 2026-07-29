-- OnStandard — an ENFORCED dollar ceiling on AI spend, plus a kill switch.
--
-- THE GAP. Every existing guard counts CALLS, not dollars: per-athlete daily caps, per-IP caps,
-- and a global 5000/day backstop. `app_config.ai_daily_budget_usd` exists but its own description
-- says "soft daily AI-spend budget (alert threshold)" — nothing consults it. `_shared/ai-tier-budget.ts`
-- is explicit at :14 that it "is a SIGNAL, not a gate — it never denies the call".
--
-- So the only thing standing between the public anon key and an unbounded Anthropic bill is a
-- call count, and a call count is not the unit the bill is denominated in. A model price change
-- or a shift to a costlier path moves the real exposure without moving any counter.
--
-- THE FIX. Two service-role-only functions over the cost data that migration 0105 already
-- computes (public.ai_call_costs), and two new config keys:
--
--   ai_daily_hard_cap_usd   enforced ceiling on TODAY's total AI spend (UTC)
--   ai_kill_switch          true = refuse every paid AI call immediately
--
-- The kill switch is separate from the feature-flag system on purpose. Flags (0109) are for
-- rollout and variants and evaluate per user; this needs one unambiguous, service-role-only
-- boolean that an operator can flip during a live incident without reasoning about allowlists.
--
-- FAIL-CLOSED. ai_spend_gate() is the last line of defence on real money, so a broken counter
-- must not silently disable it. Callers pass failOpen=false, matching the precedent set for the
-- global backstop in analyze-meal (audit 2026-07-11 P2).

-- ── config ───────────────────────────────────────────────────────────────────────────────────
insert into public.app_config (key, value, value_type, description) values
  ('ai_daily_hard_cap_usd', '50'::jsonb,    'number',
   'ENFORCED ceiling on total AI spend per UTC day. Paid calls are refused above it.'),
  ('ai_kill_switch',        'false'::jsonb, 'boolean',
   'Emergency stop: true refuses every paid AI call regardless of spend.')
on conflict (key) do nothing;

-- Make the pre-existing key honest about what it is, now that a real one exists next to it.
update public.app_config
   set description = 'SOFT daily AI-spend budget (alerting only — see ai_daily_hard_cap_usd for the enforced ceiling)'
 where key = 'ai_daily_budget_usd';

-- ── today's spend ────────────────────────────────────────────────────────────────────────────
-- Unpriced models surface as cost_usd = null in ai_call_costs (0105 deliberately avoids a silent
-- zero). coalesce(...,0) here would hide exactly that, so unpriced calls are counted at a
-- conservative non-zero estimate instead: an unknown price must never read as free.
create or replace function public.ai_spend_today_usd()
returns numeric language sql stable security definer set search_path = public as $$
  select coalesce(sum(coalesce(cost_usd, 0.02)), 0)::numeric
  from public.ai_call_costs
  where created_at >= date_trunc('day', now() at time zone 'utc');
$$;

-- ── the gate ─────────────────────────────────────────────────────────────────────────────────
-- Returns a verdict rather than a bare boolean so the caller can log WHY a call was refused and
-- surface an honest message, instead of a generic 429 that looks like a bug to the athlete.
create or replace function public.ai_spend_gate(p_estimated_usd numeric default 0.02)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_kill    boolean;
  v_cap     numeric;
  v_spent   numeric;
begin
  select coalesce((value)::text::boolean, false) into v_kill
    from public.app_config where key = 'ai_kill_switch';
  if coalesce(v_kill, false) then
    return jsonb_build_object('allowed', false, 'reason', 'kill_switch', 'spent_usd', 0, 'cap_usd', 0);
  end if;

  select coalesce((value)::text::numeric, 50) into v_cap
    from public.app_config where key = 'ai_daily_hard_cap_usd';
  v_cap := coalesce(v_cap, 50);

  v_spent := public.ai_spend_today_usd();

  if v_spent + greatest(coalesce(p_estimated_usd, 0), 0) > v_cap then
    return jsonb_build_object('allowed', false, 'reason', 'daily_cap',
                              'spent_usd', round(v_spent, 4), 'cap_usd', v_cap);
  end if;

  return jsonb_build_object('allowed', true, 'reason', 'ok',
                            'spent_usd', round(v_spent, 4), 'cap_usd', v_cap);
end $$;

-- ── privileges ───────────────────────────────────────────────────────────────────────────────
-- Service-role only. `revoke from anon, authenticated` alone is a no-op while PUBLIC still holds
-- EXECUTE (the bug 0147 was written to fix), so revoke from PUBLIC explicitly.
revoke all on function public.ai_spend_today_usd()          from public, anon, authenticated;
revoke all on function public.ai_spend_gate(numeric)         from public, anon, authenticated;
grant execute on function public.ai_spend_today_usd()        to service_role;
grant execute on function public.ai_spend_gate(numeric)      to service_role;

-- ROLLBACK:
--   drop function if exists public.ai_spend_gate(numeric);
--   drop function if exists public.ai_spend_today_usd();
--   delete from public.app_config where key in ('ai_daily_hard_cap_usd','ai_kill_switch');
-- Reverting restores count-only limits; it does not expose data, it only removes a spend brake.
