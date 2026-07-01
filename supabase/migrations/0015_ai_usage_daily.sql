-- OnStandard — per-athlete daily cap for the paid vision calls (analyze-meal Edge Function)
--
-- The analyze-meal function's per-minute per-IP limit (RATE_LIMIT_PER_MIN) blunts a burst,
-- but it does not bound a day's SPEND and mis-buckets a whole team behind one school-wifi IP.
-- This adds a real per-athlete daily ceiling: a tiny counter keyed by (user, day) and an
-- atomic claim function the Edge Function calls once per PHOTO analysis (meal + label — the
-- calls that actually cost money). Over the cap the function returns 429 and the app shows the
-- free deterministic result instead (analyzeMeal/analyzeLabel already fall back on any error),
-- so logging never blocks. Cheap text modes (memory/order rephrasing) do not count.
--
-- The cap activates only for signed-in athletes: the function claims a slot only when it can
-- resolve a real user from the caller's session token. Anonymous/preview traffic (the shared
-- anon key) is untouched and stays governed by the per-minute IP limit alone.
--
-- GUARDRAIL: authored here; NOT yet applied to the live project. Apply it with the others
-- (supabase migration up / db push) alongside 0001-0014. Idempotent, forward-only.

-- ---------------------------------------------------------------- counter table
create table if not exists public.ai_usage_daily (
  user_id    uuid        not null references auth.users(id) on delete cascade,
  day        date        not null default current_date,
  count      int         not null default 0,
  updated_at timestamptz not null default now(),
  primary key (user_id, day)
);

-- Internal counter: no one reads or writes it directly. RLS on with NO policies denies all
-- normal-role access; only the SECURITY DEFINER claim function (and service_role) touch it.
-- The explicit revoke is defense-in-depth over the 0005 default-privilege SELECT grant.
alter table public.ai_usage_daily enable row level security;
revoke all on table public.ai_usage_daily from anon, authenticated;

-- Old (user, day) rows are harmless to leave; prune with a periodic
--   delete from public.ai_usage_daily where day < current_date - 7;
-- if the table ever grows large. Not needed at current scale.

-- ---------------------------------------------------------------- atomic claim
-- Claim one usage slot for today. Returns allowed=false WITHOUT incrementing once the day's
-- count has reached p_limit. Concurrency-safe across parallel Edge Function instances: the
-- UPDATE ... WHERE count < p_limit RETURNING takes a row lock, so two simultaneous claims
-- serialize and cannot overshoot the ceiling.
create or replace function public.claim_ai_usage(p_user uuid, p_limit int)
returns table (allowed boolean, used int)
language plpgsql
security definer
set search_path = public
as $$
declare
  c int;
begin
  insert into public.ai_usage_daily (user_id, day, count)
  values (p_user, current_date, 0)
  on conflict (user_id, day) do nothing;

  update public.ai_usage_daily
     set count = count + 1, updated_at = now()
   where user_id = p_user and day = current_date and count < p_limit
   returning count into c;

  if c is null then
    -- at/over the cap: report the current count, do not increment
    select count into c from public.ai_usage_daily
     where user_id = p_user and day = current_date;
    return query select false, coalesce(c, p_limit);
  end if;
  return query select true, c;
end;
$$;

-- Only the Edge Function (service_role) may claim. Revoke the 0005 blanket execute grant from
-- anon/authenticated so an athlete can't drive or inspect the counter directly.
revoke execute on function public.claim_ai_usage(uuid, int) from public, anon, authenticated;
grant  execute on function public.claim_ai_usage(uuid, int) to service_role;
