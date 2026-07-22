-- OnStandard — Command Center Phase 1B: server-verified step-up reauth. The founder's correction #1:
-- a normal authenticated client must NOT be able to grant itself sensitive access. Grants are minted
-- ONLY after the server verifies RECENT AUTHENTICATION from the SIGNED JWT's `amr` timestamps (a client
-- cannot forge a signed claim, and a silent token refresh does NOT update `amr`). Grants bind to actor +
-- session_id + scope + a short expiry; financial scopes are single-use (consumed on execution).
--
-- Empirically verified on the local stack: the Supabase access token carries amr:[{method,timestamp}],
-- aal, and session_id; auth.jwt()->'amr' is readable here; fresh sign-in → recent ts, refresh → unchanged.

create table if not exists public.admin_sensitive_grants (
  id          uuid primary key default gen_random_uuid(),
  actor_id    uuid not null references auth.users(id) on delete cascade,
  session_id  uuid,
  scope       text not null,
  single_use  boolean not null default false,
  granted_at  timestamptz not null default now(),
  expires_at  timestamptz not null,
  consumed_at timestamptz
);
create index if not exists admin_sensitive_grants_actor on public.admin_sensitive_grants (actor_id, scope, expires_at desc);
alter table public.admin_sensitive_grants enable row level security;
revoke all on table public.admin_sensitive_grants from anon, authenticated;

-- Most recent auth-method timestamp from the SIGNED jwt. Internal (no app role gets EXECUTE).
create or replace function public.admin_recent_auth_epoch() returns bigint
language sql stable security definer set search_path = public as $$
  select max((e->>'timestamp')::bigint)
  from jsonb_array_elements(coalesce(auth.jwt()->'amr', '[]'::jsonb)) e;
$$;
revoke execute on function public.admin_recent_auth_epoch() from anon, authenticated;

-- Mint a grant ONLY if the caller re-authenticated within the last 5 minutes. Client cannot self-grant:
-- the freshness comes from a signed claim, not a client argument. Audited.
create or replace function public.admin_open_sensitive_window(p_scope text, p_single_use boolean default false)
returns uuid language plpgsql volatile security definer set search_path = public as $$
declare v_ts bigint; v_id uuid;
begin
  if not is_platform_admin() then raise exception 'not authorized'; end if;
  v_ts := admin_recent_auth_epoch();
  if v_ts is null or v_ts < extract(epoch from now())::bigint - 300 then
    raise exception 'reauth required';
  end if;
  insert into public.admin_sensitive_grants (actor_id, session_id, scope, single_use, expires_at)
    values (auth.uid(), (auth.jwt()->>'session_id')::uuid, p_scope, p_single_use, now() + interval '5 minutes')
    returning id into v_id;
  insert into public.admin_audit_log (actor_id, action, target, after)
    values (auth.uid(), 'reauth.grant', p_scope, jsonb_build_object('single_use', p_single_use));
  return v_id;
end $$;
grant execute on function public.admin_open_sensitive_window(text, boolean) to authenticated;

-- Does the caller hold a live grant for this scope, on THIS session? (single-use grants must be unconsumed)
create or replace function public.admin_has_sensitive_grant(p_scope text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.admin_sensitive_grants g
    where g.actor_id = auth.uid()
      and g.session_id is not distinct from (auth.jwt()->>'session_id')::uuid
      and g.scope = p_scope
      and g.expires_at > now()
      and (not g.single_use or g.consumed_at is null));
$$;
grant execute on function public.admin_has_sensitive_grant(text) to authenticated;

-- Consume the newest live single-use grant for a scope (financial actions call this after executing).
create or replace function public.admin_consume_grant(p_scope text)
returns void language plpgsql volatile security definer set search_path = public as $$
begin
  update public.admin_sensitive_grants set consumed_at = now()
  where id = (
    select id from public.admin_sensitive_grants
    where actor_id = auth.uid() and scope = p_scope and expires_at > now()
      and single_use and consumed_at is null
    order by granted_at desc limit 1);
end $$;
grant execute on function public.admin_consume_grant(text) to authenticated;
