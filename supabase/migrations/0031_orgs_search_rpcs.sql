-- OnStandard — school-directory search via SECURITY DEFINER RPCs (audit: orgs_read 0013<->0022)
--
-- 0013 correctly scoped `orgs_read` from `using(true)` down to orgs the caller is connected to,
-- closing the enumeration leak (any authenticated user could list every org incl. created_by).
-- But the schools-directory feature (0022) and its client (queries.ts searchOrgs / createOrg
-- dedup) read `orgs` DIRECTLY, so under the scoped policy an athlete searching a school they are
-- not yet linked to gets NOTHING — the search silently breaks, and the "add your school" dedup
-- can't see an existing school, spawning duplicates. The wrong "fix" is to reopen orgs_read to
-- using(true) and reintroduce the leak.
--
-- The right fix: keep orgs_read locked and expose the directory through DEFINER RPCs that return
-- ONLY safe display columns (id, name, type, city, state) — never created_by. The directory is
-- intentionally public (school/club names + city/state are public facts); the creator identity
-- is not, and stays hidden.
--
-- GUARDRAIL: authored here; apply with the others (supabase migration up / db push). Additive,
-- idempotent, forward-only.

-- ---------------------------------------------------------------- type-ahead search
-- Case-insensitive substring match on name. Returns safe display columns only. Requires a
-- signed-in caller (the app is auth-gated) and a >= 2 char query (the client already guards this;
-- enforced here too so a 1-char scan can't be forced via the RPC).
create or replace function public.search_orgs(q text, lim int default 20)
returns table (id uuid, name text, type org_type, city text, state text)
language sql
stable
security definer
set search_path = public
as $$
  select o.id, o.name, o.type, o.city, o.state
  from public.orgs o
  where auth.uid() is not null
    and length(btrim(q)) >= 2
    and o.name ilike '%' || btrim(q) || '%'
  order by o.name
  limit greatest(1, least(coalesce(lim, 20), 50));
$$;

-- ---------------------------------------------------------------- dedup lookup for "add your school"
-- Exact (case-insensitive) name (+ optional state) match, so two people adding the same school
-- converge on one entity instead of duplicating. Safe columns only.
create or replace function public.find_org(p_name text, p_state text default null)
returns table (id uuid, name text, type org_type, city text, state text)
language sql
stable
security definer
set search_path = public
as $$
  select o.id, o.name, o.type, o.city, o.state
  from public.orgs o
  where auth.uid() is not null
    and lower(o.name) = lower(btrim(p_name))
    and lower(coalesce(o.state, '')) = lower(coalesce(btrim(p_state), ''))
  limit 1;
$$;

-- These are safe for authenticated callers to run (they return only public directory columns and
-- require auth.uid()). The 0005 blanket execute grant already covers them; make intent explicit.
grant execute on function public.search_orgs(text, int)  to authenticated;
grant execute on function public.find_org(text, text)    to authenticated;
