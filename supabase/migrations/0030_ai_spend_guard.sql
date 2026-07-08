-- OnStandard — AI spend guard: global daily ceiling + per-IP anonymous cap (audit Finding #2)
--
-- The per-athlete daily cap (0015) only fires for a SIGNED-IN caller; an anonymous call made
-- with the public anon key (which ships in the app bundle, so anyone can extract it) skipped
-- the cap entirely and was bounded only by the in-memory, per-instance, IP-spoofable per-minute
-- limit. That let an attacker rotating IPs drive unbounded paid Anthropic spend.
--
-- This adds a text-keyed sibling of ai_usage_daily so the Edge Function can enforce, on top of
-- the per-user cap, two additional day-scoped ceilings:
--   * a GLOBAL ceiling ('global') across every caller  — the hard backstop on a day's bill;
--   * a per-IP ceiling ('ip:<addr>') for ANONYMOUS callers — so the public anon key can't be
--     abused without signing in.
-- Same atomic, concurrency-safe claim pattern as claim_ai_usage(). The Edge Function fails OPEN
-- if this RPC is unreachable (mirrors withinDailyCap), so an un-applied migration never breaks
-- logging in production.
--
-- GUARDRAIL: authored here; apply with the others (supabase migration up / db push) and REDEPLOY
-- the analyze-meal + assist functions. Idempotent, forward-only.

-- ---------------------------------------------------------------- text-keyed counter table
create table if not exists public.ai_usage_key_daily (
  key        text        not null,
  day        date        not null default current_date,
  count      int         not null default 0,
  updated_at timestamptz not null default now(),
  primary key (key, day)
);

-- Internal counter: no normal role touches it. RLS on with NO policies denies anon/authenticated;
-- only the SECURITY DEFINER claim function (and service_role) reach it. Explicit revoke is
-- defense-in-depth over the 0005 default-privilege SELECT grant.
alter table public.ai_usage_key_daily enable row level security;
revoke all on table public.ai_usage_key_daily from anon, authenticated;

-- Prune old rows periodically if it ever grows:
--   delete from public.ai_usage_key_daily where day < current_date - 7;

-- ---------------------------------------------------------------- atomic claim (text key)
create or replace function public.claim_ai_usage_key(p_key text, p_limit int)
returns table (allowed boolean, used int)
language plpgsql
security definer
set search_path = public
as $$
declare
  c int;
begin
  insert into public.ai_usage_key_daily (key, day, count)
  values (p_key, current_date, 0)
  on conflict (key, day) do nothing;

  update public.ai_usage_key_daily
     set count = count + 1, updated_at = now()
   where key = p_key and day = current_date and count < p_limit
   returning count into c;

  if c is null then
    select count into c from public.ai_usage_key_daily
     where key = p_key and day = current_date;
    return query select false, coalesce(c, p_limit);
  end if;
  return query select true, c;
end;
$$;

-- Only the Edge Function (service_role) may claim. Revoke the 0005 blanket execute grant.
revoke execute on function public.claim_ai_usage_key(text, int) from public, anon, authenticated;
grant  execute on function public.claim_ai_usage_key(text, int) to service_role;
