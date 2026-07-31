-- OnStandard — close the spend gate's read-then-decide race (audit 2026-07-30, deferred item).
--
-- THE RACE. ai_spend_gate() (0152) reads today's SETTLED spend from ai_call_costs, but a call's
-- cost row only lands after the Anthropic round-trip completes — seconds to a minute later. Every
-- call that is approved-but-not-yet-settled is invisible to the next approval decision, so N
-- concurrent callers each see the same "spent" figure and ALL pass a cap that only has room for
-- one of them. The overshoot bound is (in-flight concurrency × per-call cost): exactly the burst
-- shape an abuser of the public anon key would produce, and the one shape a daily ceiling exists
-- to stop. A gate on real money must count the money it has already promised, not just the money
-- it has been billed for.
--
-- THE FIX, in two parts, both inside SQL so no TypeScript caller changes and the RPC signature
-- stays put (callers in _shared/spend-gate.ts are untouched; no function redeploys needed):
--
--   1. SERIALIZE the decision. pg_advisory_xact_lock makes concurrent gate calls queue for the
--      few microseconds the decision takes, so two callers can never read the same ledger state.
--
--   2. RESERVE the estimate. An approval inserts its estimate into ai_spend_pending; the next
--      decision counts reservations from the last 3 minutes as spend-in-flight.
--
-- HONEST LIMITS of the 3-minute window, chosen deliberately:
--   · A settled call double-counts (reservation + cost row) until its reservation ages out.
--     That is CONSERVATIVE — near the cap the gate briefly over-refuses, never under.
--   · A call slower than 3 minutes escapes its reservation before its cost row lands, re-opening
--     a sliver of the race for pathological latencies only. Anthropic vision calls run seconds.
--   · A reservation whose call crashed pre-telemetry lingers as phantom spend for 3 minutes,
--     then evaporates. Also conservative.
-- Reconciling reservations to cost rows exactly would need a settlement call threaded through
-- every paid function — a 38-function redeploy to shave conservatism off a $50 ceiling. No.

-- ── the reservation ledger ───────────────────────────────────────────────────────────────────
-- Service-role only, like the gate itself. Rows are disposable bookkeeping: the gate sweeps
-- anything older than an hour on each pass, so the table stays a few rows tall forever and
-- carries nothing worth reading — but RLS + revokes anyway, per the 0013 posture.
create table public.ai_spend_pending (
  id         bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  est_usd    numeric not null check (est_usd >= 0)
);
create index ai_spend_pending_created_idx on public.ai_spend_pending (created_at);
alter table public.ai_spend_pending enable row level security;
revoke all on table public.ai_spend_pending from public, anon, authenticated;

-- ── the gate, now volatile ───────────────────────────────────────────────────────────────────
-- Same signature, same verdict shape (0152's callers parse it positionally by key), one new
-- verdict field: pending_usd, so an operator reading a refusal can see how much of "spent" is
-- promise vs. bill.
create or replace function public.ai_spend_gate(p_estimated_usd numeric default 0.02)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  v_kill    boolean;
  v_cap     numeric;
  v_spent   numeric;
  v_pending numeric;
  v_est     numeric := greatest(coalesce(p_estimated_usd, 0), 0);
begin
  -- One decision at a time. hashtext() keys the lock to this gate alone; xact-scoped, so it
  -- releases the moment the RPC's transaction ends — no unlock path to get wrong.
  perform pg_advisory_xact_lock(hashtext('ai_spend_gate'), 0);

  select coalesce((value)::text::boolean, false) into v_kill
    from public.app_config where key = 'ai_kill_switch';
  if coalesce(v_kill, false) then
    return jsonb_build_object('allowed', false, 'reason', 'kill_switch',
                              'spent_usd', 0, 'cap_usd', 0, 'pending_usd', 0);
  end if;

  select coalesce((value)::text::numeric, 50) into v_cap
    from public.app_config where key = 'ai_daily_hard_cap_usd';
  v_cap := coalesce(v_cap, 50);

  -- Opportunistic sweep. Indexed, almost always deletes nothing, keeps the ledger tiny without
  -- needing a cron that could silently die (the lesson of test:rls).
  delete from public.ai_spend_pending where created_at < now() - interval '1 hour';

  v_spent := public.ai_spend_today_usd();
  select coalesce(sum(est_usd), 0) into v_pending
    from public.ai_spend_pending
   where created_at > now() - interval '3 minutes';

  if v_spent + v_pending + v_est > v_cap then
    return jsonb_build_object('allowed', false, 'reason', 'daily_cap',
                              'spent_usd', round(v_spent, 4), 'cap_usd', v_cap,
                              'pending_usd', round(v_pending, 4));
  end if;

  insert into public.ai_spend_pending (est_usd) values (v_est);
  return jsonb_build_object('allowed', true, 'reason', 'ok',
                            'spent_usd', round(v_spent, 4), 'cap_usd', v_cap,
                            'pending_usd', round(v_pending, 4));
end $$;

-- ── privileges ───────────────────────────────────────────────────────────────────────────────
-- create or replace preserves the old ACL, but restate it anyway: this function moving from
-- stable to volatile is exactly the moment a copy-paste elsewhere would re-grant it wide.
revoke all on function public.ai_spend_gate(numeric) from public, anon, authenticated;
grant execute on function public.ai_spend_gate(numeric) to service_role;

-- ROLLBACK:
--   Re-run 0152's create or replace of ai_spend_gate (restores the stable, reservation-free
--   body), then: drop table if exists public.ai_spend_pending;
-- Reverting re-opens the burst race; it does not expose data.
