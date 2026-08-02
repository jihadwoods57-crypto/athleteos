-- OnStandard — custom email verification (2026-08-02).
--
-- CONTEXT: prod was flipped to mailer_autoconfirm=true (Management API, surgical single-field
-- PATCH — see memory signup-autoconfirm-fix-2026-08-02) so signUp always returns a live session
-- and a coach/athlete/trainer is never left signed out after creating an account. The trade-off:
-- GoTrue now stamps email_confirmed_at immediately and sends NOTHING — there is no "unconfirmed"
-- state left anywhere in auth.users to hang a verify banner off of. This migration builds our OWN
-- verification mechanism, end to end independent of GoTrue's confirmation system, so an address
-- can still be proven real without blocking anyone from using the app in the meantime.
--
-- Modeled directly on the guardian-consent flow (0008 + 0149 + 0147's column-grant fix), which is
-- the one proven "email a token, click a link, service-role verifies" pattern in this codebase:
--   guardian_consent_requests -> email_verifications
--   request_guardian_consent() -> request_email_verification()
--   guardian-request (send email) -> send-verify-email
--   guardian-verify (GET shows page / POST writes) -> verify-email
--
-- GUARDRAIL: authored + verified on a throwaway LOCAL postgres, then applied to prod by hand
-- (same discipline as every other migration in this tree — see 0008's own guardrail comment).

-- ============================================================================
-- 1. profiles.email_verified
-- ============================================================================
-- Nullable add, backfill every EXISTING row true (they predate this feature — either they went
-- through GoTrue's real confirmation before autoconfirm was flipped, or they're founder test
-- accounts — nobody already using the app should suddenly see a "verify your email" nag), THEN
-- set the column default to false so every NEW signup starts unverified. Same two-step shape as
-- 0149's expires_at backfill, for the same reason: never let a column go NOT NULL before every
-- existing row has a real value.
alter table profiles add column if not exists email_verified boolean;
update profiles set email_verified = true where email_verified is null;
alter table profiles
  alter column email_verified set default false,
  alter column email_verified set not null;

-- ============================================================================
-- 2. email_verifications
-- ============================================================================
create table email_verifications (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references profiles(id) on delete cascade,
  -- the address being verified, captured at REQUEST time — if the owner changes their profile
  -- email before clicking the link, the old pending token still only proves the old address, and
  -- verify-email checks it against the CURRENT profiles.email before flipping email_verified.
  email         text not null,
  status        text not null default 'pending' check (status in ('pending', 'verified')),
  -- opaque token the emailed link carries; rotated on every (re)send, exactly like guardian
  -- consent's token — possession of it (delivered only to that mailbox) is the proof.
  token         text not null default encode(extensions.gen_random_bytes(16), 'hex'),
  requested_at  timestamptz not null default now(),
  verified_at   timestamptz,
  expires_at    timestamptz not null default (now() + interval '24 hours'),
  -- one live record per user; a resend rotates it in place rather than piling up rows.
  constraint ev_user_uq unique (user_id)
);
create index ev_user on email_verifications(user_id);
create index ev_token on email_verifications(token);

alter table email_verifications enable row level security;
create policy ev_read on email_verifications
  for select using (user_id = auth.uid());

-- Column-level grant from the start (0147 taught this codebase that a blanket table grant plus
-- RLS still leaks every COLUMN of the caller's own row — including one meant to be a secret).
-- The owner may see their own request's status/timing; `token` is never selectable by anyone but
-- the service role, exactly as guardian_consent_requests was fixed to work.
revoke select, insert, update, delete on email_verifications from authenticated;
grant  select (id, user_id, email, status, requested_at, verified_at, expires_at)
  on email_verifications to authenticated;
grant  select, insert, update, delete on email_verifications to service_role;

-- ============================================================================
-- 3. request_email_verification() — the only way a client can create/rotate a token
-- ============================================================================
create or replace function request_email_verification()
returns void
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  v_email text;
  v_verified boolean;
  last_req timestamptz;
  wait_secs int;
begin
  if uid is null then
    raise exception 'must be signed in to request email verification';
  end if;

  select email, email_verified into v_email, v_verified from profiles where id = uid;
  if v_email is null then
    raise exception 'no email on file for this account';
  end if;
  if v_verified then
    return; -- already verified — a stray call is a harmless no-op, never sends a second email
  end if;

  -- Resend throttle (mirrors prod's own smtp_max_frequency=60s): reject a request inside the
  -- window with a message the CLIENT CAN SHOW VERBATIM — this is OUR OWN raise, not GoTrue's, so
  -- unlike the SMTP-frequency string friendlyAuth had to pattern-match after the fact, it is
  -- written human-readable the first time.
  select requested_at into last_req from email_verifications where user_id = uid;
  if last_req is not null and last_req > now() - interval '45 seconds' then
    wait_secs := ceil(extract(epoch from (last_req + interval '45 seconds' - now())))::int;
    raise exception 'Wait % seconds before requesting another verification email.', greatest(wait_secs, 1);
  end if;

  insert into email_verifications (user_id, email)
  values (uid, v_email)
  on conflict on constraint ev_user_uq do update
    set email        = v_email,
        status       = 'pending',
        token        = encode(extensions.gen_random_bytes(16), 'hex'),
        requested_at = now(),
        expires_at   = now() + interval '24 hours',
        verified_at  = null;
end; $$;

-- New functions get EXECUTE granted to anon/authenticated/service_role by 0005's default
-- privileges — revoke from anon explicitly (0147's root-cause finding: a bare
-- "revoke from anon, authenticated" is a no-op unless `public` is named too, since PUBLIC is
-- where the default grant actually lands). authenticated keeps it; the function itself refuses
-- an anonymous caller either way, but there is no reason to let a signed-out client reach it.
revoke execute on function request_email_verification() from public, anon;
grant  execute on function request_email_verification() to authenticated, service_role;

-- ============================================================================
-- 4. verify_email_token(token) — the only way any token gets marked verified
-- ============================================================================
-- SERVICE ROLE ONLY. Callable exclusively from the verify-email Edge Function, which holds the
-- token because it arrived in an email delivered to a mailbox the caller controls — never
-- callable by an authenticated user directly, or a signed-in attacker could brute-force/guess a
-- token against their OWN account and this function would happily flip anyone's profile.
-- Atomic: both writes (the request row AND profiles.email_verified) happen in one statement-level
-- transaction, so a crash between them can never leave the two out of sync.
create or replace function verify_email_token(p_token text)
returns text  -- 'ok' | 'already' | 'expired' | 'notfound'
language plpgsql security definer set search_path = public as $$
declare
  row_uid uuid;
  row_status text;
  row_expires timestamptz;
  row_email text;
  current_email text;
begin
  select user_id, status, expires_at, email into row_uid, row_status, row_expires, row_email
  from email_verifications where token = p_token;

  if row_uid is null then
    return 'notfound';
  end if;
  if row_status = 'verified' then
    return 'already';
  end if;
  if row_expires <= now() then
    return 'expired';
  end if;

  -- The address may have changed since the link was sent (profile edit mid-flight); only
  -- verify the CURRENT email, never a stale one this token no longer represents.
  select email into current_email from profiles where id = row_uid;
  if current_email is distinct from row_email then
    return 'expired'; -- honest: this token no longer proves anything current
  end if;

  update email_verifications set status = 'verified', verified_at = now() where token = p_token;
  update profiles set email_verified = true where id = row_uid;
  return 'ok';
end; $$;

revoke execute on function verify_email_token(text) from public, anon, authenticated;
grant  execute on function verify_email_token(text) to service_role;
