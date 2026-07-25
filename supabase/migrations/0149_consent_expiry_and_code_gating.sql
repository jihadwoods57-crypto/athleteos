-- OnStandard — two audit follow-ups (2026-07-24):
--   1. Guardian consent tokens never expired, so the "Link expired" copy in guardian-verify
--      was untrue and a forwarded/breached-mailbox link stayed valid forever.
--   2. resolve_team_code / resolve_practice_code / find_practice_by_handle / discover_teams
--      were unauthenticated SECURITY DEFINER reads — a scriptable enumeration of the code
--      space that leaks head-coach / trainer full names and school affiliations for a guessed
--      code. search_orgs / find_org (0031) already gate the SAME connect flow on
--      `auth.uid() is not null`; these siblings never got the gate. The only client callers
--      are the in-app Connect overlay (post-auth), so gating is safe.

-- ============================================================================
-- 1. GUARDIAN CONSENT TOKEN EXPIRY
-- ============================================================================
-- Add expiry, backfill EVERY existing row with a fresh 14-day window from now (so no
-- currently-pending parent link breaks the moment this ships), default future inserts, then
-- enforce NOT NULL so no row is ever expiry-less (which would reopen the "valid forever" hole).
alter table guardian_consent_requests
  add column if not exists expires_at timestamptz;

update guardian_consent_requests
  set expires_at = now() + interval '14 days'
  where expires_at is null;

alter table guardian_consent_requests
  alter column expires_at set default (now() + interval '14 days'),
  alter column expires_at set not null;

-- Column-level: the athlete already lost `token` in 0147; expires_at is harmless to read and
-- lets the app show an honest countdown. Match the 0147 grant so a select of the visible
-- columns keeps working.
grant select (expires_at) on guardian_consent_requests to authenticated;

-- Refresh the window on every (re)send. The insert path picks up the column default; the
-- on-conflict resend path must set it explicitly or a resend would keep the stale expiry.
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
        expires_at   = now() + interval '14 days',
        verified_at  = null;
end; $$;

-- ============================================================================
-- 2. GATE THE JOIN-CODE / DIRECTORY RPCS ON A SIGNED-IN CALLER
-- ============================================================================
-- Bodies are unchanged except for the added `auth.uid() is not null` predicate — anon gets
-- zero rows instead of a name+school for a guessed code. team_head_coach_name() is a helper
-- reached only THROUGH these (and through can_view paths as owner), so it needs no own gate.

create or replace function resolve_team_code(code text)
returns table (id uuid, name text, sport text, coach_name text, school text)
language sql stable security definer set search_path = public as $$
  select t.id, t.name, t.sport, team_head_coach_name(t.id),
         (select o.name from orgs o where o.id = t.org_id)
  from teams t
  where t.join_code = code
    and auth.uid() is not null;
$$;

create or replace function discover_teams(org uuid)
returns table (id uuid, name text, sport text, coach_name text)
language sql stable security definer set search_path = public as $$
  select t.id, t.name, t.sport, team_head_coach_name(t.id)
  from teams t
  where t.org_id = org and t.discoverable
    and auth.uid() is not null
  order by t.name;
$$;

create or replace function find_practice_by_handle(h text)
returns table (id uuid, name text, trainer_name text)
language sql stable security definer set search_path = public as $$
  select p.id, p.name, (select pr.full_name from profiles pr where pr.id = p.owner_id)
  from practices p
  where lower(p.handle) = lower(h) and p.discoverable
    and auth.uid() is not null;
$$;

create or replace function resolve_practice_code(code text)
returns table (id uuid, name text, trainer_name text)
language sql stable security definer set search_path = public as $$
  select p.id, p.name, (select pr.full_name from profiles pr where pr.id = p.owner_id)
  from practices p
  where p.join_code = code
    and auth.uid() is not null;
$$;
