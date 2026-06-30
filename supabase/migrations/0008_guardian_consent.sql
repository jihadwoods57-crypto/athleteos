-- AthleteOS — Phase 1 go-live: request_guardian_consent RPC (COPPA VPC)
-- Additive migration. The app (queries.ts:requestGuardianConsent) already calls
-- rpc('request_guardian_consent', { guardian_email }) and database.types.ts declares it,
-- but no migration created it. This records a PENDING guardian-consent request for the
-- signed-in minor athlete. It does NOT itself send email or grant consent — verifiable
-- parental consent (a link emailed to the guardian, confirmed against a real identity /
-- payment check) is a vendor + Edge Function step the founder wires at go-live. This SQL
-- is the durable record the verification flow reads and later marks 'verified'.
--
-- The client gate (src/core/consent.ts realDataConsent) keeps a minor's real data
-- on-device until guardianStatus is 'verified', so until the verify step flips a row here
-- to 'verified', nothing about the minor is shared. Fail-closed by construction.
--
-- GUARDRAIL: authored + verified on a throwaway LOCAL postgres. NOT applied to the live
-- project by the crew — the founder applies it per-migration at go-live (D1), and must
-- wire the email sender + a service_role verify endpoint before relying on it.

-- ---------------------------------------------------------------- table
create table guardian_consent_requests (
  id              uuid primary key default gen_random_uuid(),
  athlete_id      uuid not null references profiles(id) on delete cascade,
  guardian_email  text not null,
  -- 'pending' until a guardian verifies; 'verified' is set ONLY by the service_role
  -- verify endpoint (never by the athlete); 'revoked' if consent is withdrawn.
  status          text not null default 'pending'
                    check (status in ('pending', 'verified', 'revoked')),
  -- opaque token the emailed verification link carries; rotated on every (re)send.
  token           text not null default encode(extensions.gen_random_bytes(16), 'hex'),
  requested_at    timestamptz not null default now(),
  verified_at     timestamptz,
  -- one live request per (athlete, guardian email); a resend updates it in place.
  -- Named so the RPC can target it with ON CONFLICT ON CONSTRAINT (the function's
  -- guardian_email parameter would otherwise shadow the column in a column-list target).
  constraint gcr_athlete_guardian_uq unique (athlete_id, guardian_email)
);
create index gcr_athlete on guardian_consent_requests(athlete_id);
create index gcr_token on guardian_consent_requests(token);

-- ---------------------------------------------------------------- RLS
-- The athlete may READ their own request (so the app can show pending/verified), but
-- NEVER write it directly — all writes go through the SECURITY DEFINER RPC below or the
-- service_role verify endpoint. That stops a minor from self-verifying their own guardian.
alter table guardian_consent_requests enable row level security;
create policy gcr_read on guardian_consent_requests
  for select using (athlete_id = auth.uid());

-- ---------------------------------------------------------------- RPC
create or replace function request_guardian_consent(guardian_email text) returns void
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  email text := lower(trim(guardian_email));
begin
  if uid is null then
    raise exception 'must be signed in to request guardian consent';
  end if;
  -- minimal server-side email sanity check (the client validates more thoroughly).
  if email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'invalid guardian email';
  end if;

  insert into guardian_consent_requests (athlete_id, guardian_email)
  values (uid, email)
  on conflict on constraint gcr_athlete_guardian_uq do update
    set status       = 'pending',
        token        = encode(extensions.gen_random_bytes(16), 'hex'),
        requested_at = now(),
        verified_at  = null;
end; $$;

-- Explicit grants (defense in depth; 0005 default privileges also cover these).
grant select, insert, update, delete on guardian_consent_requests
  to authenticated, service_role;
grant execute on function request_guardian_consent(text) to authenticated, service_role;
