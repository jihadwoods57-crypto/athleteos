-- OnStandard — Command Center Phase 2 auth: MFA/AAL2 enforcement (the security spine).
--
-- Invariant: no admin data or mutation crosses without platform_admin AND aal2 (MFA-verified).
-- Implemented as a SINGLE CHOKE POINT rather than editing ~30 RPCs: every admin RPC already gates on
-- is_platform_admin(), so we redefine that ONE function to require aal2, and decouple admin_bootstrap
-- (the only RPC that must answer at aal1, so the client can route a password-only session to the enroll
-- / challenge screen). Verified: is_platform_admin() is used ONLY inside admin/analytics RPC bodies —
-- never in an RLS policy and never in a consumer/app path — so requiring aal2 has zero blast radius on
-- athlete/coach/parent flows (they are never on the allowlist). See spec 2026-07-22, Plan 1.

create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------- aal + allowlist primitives
-- aal2 from the SIGNED jwt (a client cannot forge it). null aal (e.g. legacy token) reads as aal1.
create or replace function public.admin_is_aal2() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(auth.jwt()->>'aal', 'aal1') = 'aal2';
$$;
revoke execute on function public.admin_is_aal2() from anon, authenticated;

-- Allowlist membership ONLY (no aal). Internal — used by bootstrap + assert_admin_mfa for message
-- clarity, and (via admin_self_is_allowlisted) by the aal1 recovery flow.
create or replace function public.admin_is_allowlisted() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from platform_admins where user_id = auth.uid());
$$;
revoke execute on function public.admin_is_allowlisted() from anon, authenticated;

-- ---------------------------------------------------------------- the choke point
-- REDEFINED: platform-admin now means allowlisted AND MFA-verified. This one edit gates every existing
-- admin RPC (0037/0052/0107/0109/0111/0113/0116-0128) at aal2 — a stolen password + aal1 session reads
-- and changes nothing.
create or replace function public.is_platform_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from platform_admins where user_id = auth.uid())
     and coalesce(auth.jwt()->>'aal', 'aal1') = 'aal2';
$$;
revoke execute on function public.is_platform_admin() from anon, authenticated;

-- Guard for NEW admin RPCs — distinguishes "not an admin" from "need MFA" for a clean client message.
create or replace function public.assert_admin_mfa() returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if not admin_is_allowlisted() then raise exception 'not authorized'; end if;
  if not admin_is_aal2()        then raise exception 'mfa required';   end if;
end $$;
grant execute on function public.assert_admin_mfa() to authenticated;

-- The recovery edge function runs at aal1 (password only), so it cannot use the aal2-gated
-- is_platform_admin(). This tells a caller ONLY their own allowlist status. Safe to grant.
create or replace function public.admin_self_is_allowlisted() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from platform_admins where user_id = auth.uid());
$$;
grant execute on function public.admin_self_is_allowlisted() to authenticated;

-- ---------------------------------------------------------------- bootstrap v2 (aal1-callable)
-- The ONLY admin RPC callable at aal1: it returns identity + routing flags (mfa_enrolled/aal/
-- access_granted) so the client shows enroll (no factor) or challenge (aal1 + factor). Exposes no
-- platform data. Uses the allowlist directly (NOT the now-aal2-gated is_platform_admin).
create or replace function public.admin_bootstrap()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_admin boolean; v_email text; v_enrolled boolean; v_aal text; v_access boolean;
begin
  v_admin := admin_is_allowlisted();
  if not v_admin then return jsonb_build_object('is_admin', false); end if;
  select email into v_email from profiles where id = auth.uid();
  v_enrolled := exists (select 1 from auth.mfa_factors f where f.user_id = auth.uid() and f.status = 'verified');
  v_aal := coalesce(auth.jwt()->>'aal', 'aal1');
  v_access := v_admin and v_aal = 'aal2' and v_enrolled;
  return jsonb_build_object(
    'is_admin', true,
    'email', v_email,
    'environment', 'production',
    'spec_version', 'phase-2-auth',
    'mfa_enrolled', v_enrolled,
    'aal', v_aal,
    'access_granted', v_access,
    'billing_connected', false,
    'reauth_required', false,
    'server_time', now(),
    'capabilities', jsonb_build_object(
      'read', v_access, 'mutate_users', v_access, 'impersonate', v_access,
      'financial', v_access, 'flags', v_access, 'config', v_access)
  );
end $$;
grant execute on function public.admin_bootstrap() to authenticated;

-- ---------------------------------------------------------------- MFA recovery codes
create table if not exists public.admin_recovery_codes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  code_hash text not null,
  created_at timestamptz not null default now(),
  used_at timestamptz
);
create index if not exists admin_recovery_codes_user on public.admin_recovery_codes (user_id) where used_at is null;
alter table public.admin_recovery_codes enable row level security;
revoke all on table public.admin_recovery_codes from anon, authenticated;

-- 10 fresh codes; store sha256 hashes; return plaintext ONCE. Requires just-enrolled aal2 admin.
create or replace function public.admin_generate_recovery_codes() returns text[]
language plpgsql volatile security definer set search_path = public, extensions as $$
declare v_codes text[] := '{}'; v_code text; i int;
begin
  perform assert_admin_mfa();
  delete from public.admin_recovery_codes where user_id = auth.uid() and used_at is null;
  for i in 1..10 loop
    v_code := encode(extensions.gen_random_bytes(6), 'hex');
    v_codes := array_append(v_codes, v_code);
    insert into public.admin_recovery_codes(user_id, code_hash)
      values (auth.uid(), encode(extensions.digest(v_code, 'sha256'), 'hex'));
  end loop;
  insert into public.admin_audit_log(actor_id, action, target)
    values (auth.uid(), 'recovery.codes_generated', auth.uid()::text);
  return v_codes;
end $$;
grant execute on function public.admin_generate_recovery_codes() to authenticated;

-- Internal: consume a code (single-use). Called by admin-mfa-recover under service role.
create or replace function public.admin_verify_recovery_code(p_user uuid, p_code text) returns boolean
language plpgsql volatile security definer set search_path = public, extensions as $$
declare v_id uuid;
begin
  select id into v_id from public.admin_recovery_codes
    where user_id = p_user and used_at is null
      and code_hash = encode(extensions.digest(p_code, 'sha256'), 'hex')
    limit 1;
  if v_id is null then return false; end if;
  update public.admin_recovery_codes set used_at = now() where id = v_id;
  return true;
end $$;
revoke execute on function public.admin_verify_recovery_code(uuid, text) from anon, authenticated;
