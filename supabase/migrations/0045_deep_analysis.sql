-- OnStandard — Deep Analysis weekly counter (add-on build 2026-07-04).
--
-- The Deep Dive is the premium AI surface: one thorough weekly pattern analysis per athlete.
-- Its cost story only works if "weekly" is enforced SERVER-SIDE — the day-scoped counters
-- (0015/0030) can't express that (a new day resets them), so this adds an EPOCH-keyed
-- sibling: the caller passes the period key (e.g. '2026-W27') and the counter is atomic per
-- (key, epoch). Same security posture as 0030: RLS with no policies, SECURITY DEFINER claim,
-- fail-open handled by the edge function.

create table if not exists public.ai_usage_epoch (
  key        text        not null,
  epoch      text        not null,
  count      int         not null default 0,
  updated_at timestamptz not null default now(),
  primary key (key, epoch)
);

alter table public.ai_usage_epoch enable row level security;
revoke all on table public.ai_usage_epoch from anon, authenticated;

-- Prune old rows periodically if it ever grows:
--   delete from public.ai_usage_epoch where updated_at < now() - interval '90 days';

create or replace function public.claim_ai_usage_epoch(p_key text, p_epoch text, p_limit int)
returns table (allowed boolean, used int)
language plpgsql
security definer
set search_path = public
as $$
declare
  c int;
begin
  insert into public.ai_usage_epoch (key, epoch, count)
  values (p_key, p_epoch, 0)
  on conflict (key, epoch) do nothing;

  update public.ai_usage_epoch u
     set count = u.count + 1, updated_at = now()
   where u.key = p_key and u.epoch = p_epoch and u.count < p_limit
   returning u.count into c;

  if c is null then
    select u.count into c from public.ai_usage_epoch u where u.key = p_key and u.epoch = p_epoch;
    return query select false, coalesce(c, 0);
  else
    return query select true, c;
  end if;
end; $$;

-- 0035 default: new functions grant EXECUTE to no one. The edge function calls this with
-- service_role; no client role ever should.
revoke execute on function public.claim_ai_usage_epoch(text, text, int) from public, anon, authenticated;
grant execute on function public.claim_ai_usage_epoch(text, text, int) to service_role;
