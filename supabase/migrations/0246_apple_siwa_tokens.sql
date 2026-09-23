-- 0246: Sign in with Apple tokens, so account deletion can revoke them (review pass 2026-09-23,
-- G-R4, Guideline 5.1.1(v) and Apple's account-deletion requirements).
--
-- An app that offers Sign in with Apple must revoke the user's Apple tokens when the account is
-- deleted (https://appleid.apple.com/auth/revoke). Revoking needs a token, and the only token
-- worth keeping is the refresh token, which the one-time authorizationCode from the sign-in sheet
-- buys (apple-token edge function). This table holds it until the account is deleted
-- (delete-account edge function revokes, then deletes the row; the FK cascade covers any other
-- way an account disappears).
--
-- SERVICE ROLE ONLY. No client role can read, write or even see the table: a refresh token is a
-- credential. RLS is on with no policies, and every privilege is revoked from anon/authenticated.

create table if not exists public.apple_siwa_tokens (
  user_id       uuid primary key references auth.users(id) on delete cascade,
  refresh_token text not null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

alter table public.apple_siwa_tokens enable row level security;
revoke all on table public.apple_siwa_tokens from public, anon, authenticated;
grant select, insert, update, delete on public.apple_siwa_tokens to service_role;

comment on table public.apple_siwa_tokens is
  'Sign in with Apple refresh tokens (apple-token writes, delete-account revokes then deletes). Service role only: a credential.';
