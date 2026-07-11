-- OnStandard — server-side guardian-consent enforcement for minors (audit 2026-07-11, P1).
--
-- THE GAP: consent was enforced ONLY by the client (src/core/consent.ts realDataConsent /
-- the proto's local-only gate). RLS's can_view() grants a linked coach/trainer/guardian read
-- access from the link row alone, and nothing blocked a minor's rows from landing in
-- days/meals/checkins in the first place. A modified/old/buggy client that syncs a minor's
-- real rows makes them immediately coach-readable with zero server-side consent check.
--
-- THE FIX (both directions, fail-safe for the live adult beta):
--   1. WRITE-BLOCK (data minimization): a BEFORE INSERT/UPDATE trigger on days / meals /
--      checkins — and the meal-photos storage write policies — reject a PROVABLE minor's
--      rows until a verified guardian consent exists. The data never lands server-side,
--      which is the promise the product already makes ("stays on this device until
--      verified", 0008).
--   2. READ-BLOCK (defense in depth + legacy rows): can_view() now requires verified
--      consent before any THIRD PARTY (coach/trainer/guardian/org viewer) can read a
--      provable minor's data. Self-access is never affected.
--
-- ⚖️ EXPLICIT AGE RULING (the audit's queued judgment call on self-attested age):
--   "Provable minor" = athlete_profiles shows base_age < 18 OR dob younger than 18 years.
--   UNKNOWN age (no base_age, no dob) is treated as ADULT **here** — deliberately different
--   from is_minor()/is_registered_minor(), which stay fail-closed for messaging. Rationale:
--   base_age is never written by the current app and dob only arrived in 0048, so most live
--   adult rows have neither; keying these gates fail-closed would sever every existing
--   adult's sync and coach visibility overnight. Age is self-attested either way — a lying
--   minor defeats both variants equally — so the fail-closed variant buys no real safety
--   for sync while breaking the live beta. Onboarding collects dob (0048), so every new
--   account IS age-provable going forward. Revisit if a verified-age vendor lands.
--
-- GUARDRAIL: authored only — NEVER applied to live by the crew. Founder applies via the
-- runbook: supabase db reset on a throwaway stack, run supabase/tests/ (incl. the new
-- minor_consent_test.sql), then supabase db push. See docs note at bottom.

-- ---------------------------------------------------------------- helpers
-- Provable minority (see ruling above). SECURITY DEFINER so it can read athlete_profiles
-- regardless of the caller's RLS scope; pinned search_path per house rule.
create or replace function is_provable_minor(p uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from athlete_profiles ap
    where ap.athlete_id = p
      and ( coalesce(ap.base_age, 99) < 18
            or (ap.dob is not null and ap.dob > (current_date - interval '18 years')) ));
$$;

create or replace function has_verified_guardian_consent(p uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from guardian_consent_requests g
    where g.athlete_id = p and g.status = 'verified');
$$;

-- 0035 flipped default privileges so new functions no longer auto-grant EXECUTE, but be
-- explicit: neither is app-callable (no minor-status oracle, no consent-status probe —
-- they run only inside the definer predicates/triggers below).
revoke execute on function is_provable_minor(uuid) from anon, authenticated;
revoke execute on function has_verified_guardian_consent(uuid) from anon, authenticated;

-- ---------------------------------------------------------------- 1. write-block trigger
create or replace function enforce_minor_consent() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if is_provable_minor(new.athlete_id) and not has_verified_guardian_consent(new.athlete_id) then
    raise exception 'guardian consent required before a minor''s data can sync'
      using errcode = 'P0001';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_minor_consent_days on days;
create trigger trg_minor_consent_days
  before insert or update on days
  for each row execute function enforce_minor_consent();

drop trigger if exists trg_minor_consent_meals on meals;
create trigger trg_minor_consent_meals
  before insert or update on meals
  for each row execute function enforce_minor_consent();

drop trigger if exists trg_minor_consent_checkins on checkins;
create trigger trg_minor_consent_checkins
  before insert or update on checkins
  for each row execute function enforce_minor_consent();

-- Meal photos: same write gate at the storage layer (the trigger can't cover storage.objects).
-- Recreates 0003's policies with the consent condition appended; delete stays ungated
-- (removing data is always allowed).
drop policy if exists meal_photos_insert on storage.objects;
create policy meal_photos_insert on storage.objects for insert with check (
  bucket_id = 'meal-photos'
  and (storage.foldername(name))[1] = auth.uid()::text
  and (not is_provable_minor(auth.uid()) or has_verified_guardian_consent(auth.uid()))
);
drop policy if exists meal_photos_update on storage.objects;
create policy meal_photos_update on storage.objects for update using (
  bucket_id = 'meal-photos'
  and (storage.foldername(name))[1] = auth.uid()::text
  and (not is_provable_minor(auth.uid()) or has_verified_guardian_consent(auth.uid()))
);

-- ---------------------------------------------------------------- 2. read-block in can_view
-- Self-access is untouched (is_self lives inside can_view_via_memberships, and is hoisted
-- out here so the consent predicate can never gate an athlete out of their own data).
-- Every third-party path — memberships (coaches/org viewers), trainers, guardians — now
-- additionally requires consent for a provable minor. This also covers any legacy minor
-- rows that landed before the write-block existed.
create or replace function can_view(athlete uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select is_self(athlete)
      or ( ( can_view_via_memberships(athlete)
             or is_trainer_of(athlete)    -- practice_clients not yet backfilled into org_memberships
             or is_guardian_of(athlete) ) -- guardianships not yet backfilled into org_memberships
           and (not is_provable_minor(athlete) or has_verified_guardian_consent(athlete)) );
$$;
