-- OnStandard — 0174 spend-gate atomicity suite.
-- Runs against a MIGRATED local db, rolls back, fails non-zero if any check fails.
--   docker exec -i supabase_db_onstandard psql -U postgres -v ON_ERROR_STOP=1 < supabase/tests/spend_gate_test.sql
--
-- The one regression that matters: two back-to-back approvals with NO settled cost rows between
-- them must still see each other. Pre-0174, the gate read only ai_call_costs, so both passed a
-- cap with room for one; post-0174 the first approval's reservation refuses the second.
begin;

create table _sg (n serial, ok boolean, label text);
create or replace function _ok(cond boolean, label text) returns void language plpgsql security definer as $$
begin insert into _sg(ok,label) values (coalesce(cond,false),label);
  if coalesce(cond,false) then raise notice 'PASS: %',label; else raise warning 'FAIL: %',label; end if; end $$;

do $$
declare v jsonb;
begin
  -- A cap with room for exactly one estimated call.
  update public.app_config set value = '0.05'::jsonb where key = 'ai_daily_hard_cap_usd';
  update public.app_config set value = 'false'::jsonb where key = 'ai_kill_switch';

  -- 1. First call fits.
  v := public.ai_spend_gate(0.03);
  perform _ok((v->>'allowed')::boolean, '0174: first call under the cap is allowed');

  -- 2. Second concurrent-shaped call is refused BY THE RESERVATION — no cost row has landed.
  v := public.ai_spend_gate(0.03);
  perform _ok((v->>'allowed')::boolean = false and v->>'reason' = 'daily_cap',
              '0174: second call is refused by the first call''s reservation (the race)');
  perform _ok((v->>'pending_usd')::numeric >= 0.03,
              '0174: refusal verdict reports the in-flight reservation');

  -- 3. Kill switch wins, and reserves nothing.
  update public.app_config set value = 'true'::jsonb where key = 'ai_kill_switch';
  v := public.ai_spend_gate(0.001);
  perform _ok((v->>'allowed')::boolean = false and v->>'reason' = 'kill_switch',
              '0174: kill switch still refuses everything');
  perform _ok((select count(*) from public.ai_spend_pending) = 1,
              '0174: a kill-switch refusal writes no reservation');
  update public.app_config set value = 'false'::jsonb where key = 'ai_kill_switch';

  -- 4. Reservations age out of the 3-minute window (the settled cost takes over by then).
  update public.ai_spend_pending set created_at = now() - interval '10 minutes';
  v := public.ai_spend_gate(0.03);
  perform _ok((v->>'allowed')::boolean, '0174: an aged-out reservation no longer counts as pending');

  -- 5. The hourly sweep actually sweeps.
  update public.ai_spend_pending set created_at = now() - interval '2 hours'
   where created_at < now() - interval '5 minutes';
  perform public.ai_spend_gate(0.001);
  perform _ok(not exists (select 1 from public.ai_spend_pending
                           where created_at < now() - interval '1 hour'),
              '0174: reservations older than an hour are swept');
end $$;

-- 6. Locked down: neither the gate nor the ledger is reachable from client roles.
do $$
begin
  perform _ok(not has_function_privilege('anon', 'public.ai_spend_gate(numeric)', 'execute')
          and not has_function_privilege('authenticated', 'public.ai_spend_gate(numeric)', 'execute'),
              '0174: ai_spend_gate is service-role only');
  perform _ok(not has_table_privilege('anon', 'public.ai_spend_pending', 'select')
          and not has_table_privilege('authenticated', 'public.ai_spend_pending', 'select'),
              '0174: ai_spend_pending is unreadable to client roles');
end $$;

do $$
declare v_fail int; v_total int;
begin
  select count(*) filter (where not ok), count(*) into v_fail, v_total from _sg;
  raise notice '=== spend-gate suite: % checks, % failed ===', v_total, v_fail;
  if v_fail > 0 then raise exception 'spend-gate suite: % failed checks', v_fail; end if;
end $$;

rollback;
