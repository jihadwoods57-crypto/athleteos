-- 0210: age becomes server-authoritative — a minor can no longer edit themselves into an adult.
--
-- THE HOLE (found 2026-07-09, verified open 2026-08-27 against a fully-migrated stack): every
-- minor gate in the system keys off two athlete-writable columns. `athlete_profiles.base_age`
-- feeds is_minor()/is_registered_minor() (messaging supervision, marketplace adults-only,
-- health-share + verification consent) and `dob` feeds is_provable_minor() (guardian-consent
-- enforcement on sync/photos, guardian visibility). Both rode the default table-wide
-- INSERT/UPDATE grant, and RLS only checks WHOSE row it is — so two self-UPDATEs turned a
-- 15-year-old with a dob on file into an adult on every gate at once. COPPA-adjacent.
--
-- THE FIX, in two moves:
--   1. The table-wide INSERT/UPDATE grant becomes a column list that carries every field the
--      shipped app actually writes directly (state.js saveAthleteProfile upsert: level, sport,
--      position, base_goal, season_goal, standard) — and NOT base_age, dob, base_weight,
--      targets, or team_code. base_age now has NO client write path at all (nothing in the app
--      ever wrote it; it was pure attack surface). base_weight/targets/team_code already write
--      through their own doors (0181 set_my_base_weight, coach_set_goals, 0026 set_my_team_code).
--      base_height loses its write path too: nothing in the app writes it today.
--      athlete_id stays in the update list on purpose: PostgREST upserts may include the
--      conflict-target column in DO UPDATE SET, and ap_update's WITH CHECK is_self() already
--      pins its value.
--   2. dob moves behind a self-only SECURITY DEFINER door, set_my_dob(d), with a one-way
--      ratchet: anyone the system can currently prove is a minor (base_age < 18, or dob younger
--      than 18 years — the is_provable_minor predicate) is REFUSED any new dob that would make
--      them an adult. First attestation stays self-service (same trust as onboarding today —
--      0050's explicit ruling), corrections within adulthood stay self-service, and a change
--      that makes someone MORE protected (adult -> minor) is allowed. Under-13 dates are
--      refused server-side (the app's COPPA floor, until now enforced only by the client).
--      Fixing a minor's genuinely-wrong dob upward is a support/service-role action, on purpose.
--
-- Deliberately NOT here: making is_minor()/marketplace read dob (today an adult with only a
-- dob on file is still fail-closed "minor" for messaging/marketplace). That flips gates OPEN
-- for real users and is a product ruling, not a hardening — recommended separately.
--
-- Two known one-way edges, both by design (support/service role is the exit):
--   * a legacy row with a real base_age < 18 stays locked even after the athlete truly turns
--     18 — base_age never increments and now has no client write path;
--   * an adult who saves an under-18 dob becomes a locked minor account. The profile screen
--     warns and takes a second explicit Save before sending that change, so a fat-fingered
--     year can't do it silently.
--
-- CLIENT (same commit): saveAthleteProfile strips dob from the direct upsert and calls
-- set_my_dob, falling back to the legacy upsert only when the RPC does not exist yet
-- (PGRST202), so the OTA is safe to ship before OR after this migration is applied.
-- DEPLOY ORDER on live: publish that OTA FIRST, then apply this. Clients still on the
-- pre-door OTA break twice the moment this applies: the profile-screen dob edit 42501s
-- (reported as "couldn't sync", not a fake "saved"), and onboarding's phase-2 sync sends
-- dob AND standard in ONE upsert — the whole statement dies on the dob column, so the
-- standard knob stops syncing for those clients too until they pick up the new OTA.
--
-- GUARDRAIL: authored + proven against a fully-migrated local stack (new rls_authz section
-- "0210"); NOT applied to live here — no DB credentials in this session.

-- ---------------------------------------------------------------- 1. the column wall
revoke insert, update on table athlete_profiles from authenticated;
grant insert (athlete_id, level, sport, "position", base_goal, season_goal, standard)
  on table athlete_profiles to authenticated;
grant update (athlete_id, level, sport, "position", base_goal, season_goal, standard)
  on table athlete_profiles to authenticated;

comment on column athlete_profiles.base_age is
  'Server-authoritative since 0210: no client write path. Nothing in the app ever wrote it; '
  'it exists for legacy rows and support corrections (service role only).';
comment on column athlete_profiles.dob is
  'Server-authoritative since 0210: written only through set_my_dob(), which refuses any '
  'change that would flip a provable minor to adult.';

-- ---------------------------------------------------------------- 2. the dob door
-- Self-only by construction (the row key is auth.uid(), never a parameter), mirroring 0181's
-- set_my_base_weight. SECURITY DEFINER bypasses the column wall — that is the point; the
-- guards keep the door honest. Raises use short stable tokens the client maps to plain copy.
create or replace function set_my_dob(d date) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_locked boolean;
begin
  if v_uid is null then
    raise exception 'not signed in';
  end if;
  if d is null then
    -- clearing dob would flip a provable minor to "unknown age" = adult on the 0050 gates
    raise exception 'dob required';
  end if;
  if d > current_date or d < current_date - interval '100 years' then
    raise exception 'dob out of range';
  end if;
  if d > current_date - interval '13 years' then
    raise exception 'age floor';  -- under-13: the app does not take these accounts (COPPA)
  end if;

  -- the ratchet: a provable minor (same predicate as is_provable_minor) never self-promotes
  select ( coalesce(ap.base_age, 99) < 18
           or (ap.dob is not null and ap.dob > (current_date - interval '18 years')) )
    into v_locked
    from athlete_profiles ap where ap.athlete_id = v_uid;
  if coalesce(v_locked, false) and d <= (current_date - interval '18 years') then
    raise exception 'age locked';
  end if;

  insert into athlete_profiles (athlete_id, dob, updated_at)
  values (v_uid, d, now())
  on conflict (athlete_id) do update set dob = excluded.dob, updated_at = now();
end $$;

revoke execute on function set_my_dob(date) from public, anon;
grant  execute on function set_my_dob(date) to authenticated;
