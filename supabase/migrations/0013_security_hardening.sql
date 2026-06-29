-- AthleteOS — security hardening (forward migration from the full security audit)
--
-- Four authorization fixes surfaced by the audit. All are written as forward,
-- idempotent statements (create-or-replace / drop-then-create / revoke), so this applies
-- cleanly on top of 0001-0012 regardless of which earlier migrations a project has
-- already run, and supersedes the relevant earlier definitions without rewriting history.
--
-- GUARDRAIL: authored only; NOT applied to the live project by the crew. The founder
-- applies it at go-live, AFTER 0011/0012, alongside the other migrations (D1). Validated
-- on a throwaway local Postgres (initdb + auth/storage shim) — see the audit log.
--
--   1. Revoke the blanket DML the 0005 grants handed `authenticated` on the two
--      service-role-write-only tables (subscriptions, org_memberships), and stop FUTURE
--      tables from auto-inheriting authenticated DML. Today those writes are blocked only
--      by the ABSENCE of an RLS write policy — one forgotten policy from a breach. Defense
--      in depth: a user must never be able to self-grant a paid plan or forge an access
--      membership, even if a future RLS policy slips.
--   2. Close the minor-messaging gate's one-directional hole: govern BOTH thread parties,
--      so a minor on EITHER side of a thread requires an authorized adult on the other.
--   3. Preserve trainer/guardian view access after the 0012 can_view cutover (the backfill
--      is teams-only, so a memberships-only can_view would silently drop those grants).
--   4. Scope orgs_read off `using (true)` so the full org list no longer leaks to every
--      authenticated user.

-- ---------------------------------------------------------------- 1. lock down writes on service-role tables
-- subscriptions + org_memberships are written ONLY by service_role (Stripe webhook /
-- membership RPCs). authenticated keeps SELECT (its read policies), never direct DML.
revoke insert, update, delete on subscriptions   from authenticated;
revoke insert, update, delete on org_memberships from authenticated;

-- Stop the 0005 `alter default privileges ... grant ... to authenticated` from handing
-- DML on every FUTURE public table to authenticated. New tables must grant DML EXPLICITLY
-- (the athlete-owned tables already hold their explicit grants and self-write RLS, so this
-- does not affect days/meals/checkins/athlete_profiles/profiles/links/orgs/teams).
alter default privileges in schema public
  revoke insert, update, delete on tables from authenticated;

-- ---------------------------------------------------------------- 2. symmetric minor-messaging gate
-- The 0006 gate only checked is_minor(t_athlete), so an adult opening a thread with
-- themselves as athlete_id and a registered MINOR as counterpart_id bypassed all
-- supervision (messaging_authorized returned `not is_minor(adult)` = true). Govern BOTH
-- parties — but asymmetrically, because is_minor() is fail-closed (treats ANY id with no
-- athlete_profile as a minor, age 0). That fail-closed default is RIGHT for the athlete_id
-- side (the data subject is meant to be an athlete) but WRONG for the counterpart side,
-- where a coach/guardian legitimately has no athlete_profile and must not be mistaken for
-- a minor. So the new counterpart clause keys on is_registered_minor() — true only for a
-- party that actually has a minor athlete_profile — which closes the bypass (a real minor
-- in the counterpart slot is protected) without breaking legitimate minor↔overseer threads.
-- is_minor (athlete side) is UNCHANGED, so no existing protection is weakened; this only
-- ANDs an additional guard.
create or replace function is_registered_minor(p uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from athlete_profiles ap
    where ap.athlete_id = p and coalesce(ap.base_age, 0) < 18);
$$;

create or replace function messaging_authorized(t_athlete uuid, t_counterpart uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select
    -- the athlete-side party, if a minor (fail-closed), needs an authorized adult counterpart
    (not is_minor(t_athlete)
       or is_coach_link(t_counterpart, t_athlete)
       or is_trainer_link(t_counterpart, t_athlete)
       or is_guardian_link(t_counterpart, t_athlete))
    and
    -- and symmetrically: a REGISTERED minor sitting in the counterpart slot needs the
    -- athlete-side party to be their authorized adult (closes the adult-as-athlete_id /
    -- minor-as-counterpart bypass; does not fire for non-athlete overseers)
    (not is_registered_minor(t_counterpart)
       or is_coach_link(t_athlete, t_counterpart)
       or is_trainer_link(t_athlete, t_counterpart)
       or is_guardian_link(t_athlete, t_counterpart));
$$;

-- ---------------------------------------------------------------- 3. keep trainer/guardian view access post-cutover
-- 0012 swapped can_view() to the memberships predicate, but its backfill is TEAMS ONLY —
-- practice_clients (trainers) and guardianships (parents) are not yet migrated. A
-- memberships-only can_view would drop their access. Until their backfill ships
-- (Phase B-trainer / Phase C), can_view is the UNION of the membership predicate and the
-- legacy trainer/guardian link checks, so no relationship loses access and none widens
-- (is_self is already inside can_view_via_memberships; is_team_coach_of is now covered by
-- the membership backfill, validated equivalent in 0012).
create or replace function can_view(athlete uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select can_view_via_memberships(athlete)
      or is_trainer_of(athlete)    -- practice_clients not yet backfilled into org_memberships
      or is_guardian_of(athlete);  -- guardianships not yet backfilled into org_memberships
$$;

-- ---------------------------------------------------------------- 4a. fix org_memberships RLS recursion
-- 0011's om_read_admin policy self-references org_memberships in a PLAIN policy subquery,
-- so reading org_memberships re-evaluates the policy on org_memberships → Postgres aborts
-- with "infinite recursion detected in policy". Route the admin check through a
-- SECURITY DEFINER helper (the same pattern the 0002 helpers use: the function bypasses
-- RLS on the table it reads, breaking the cycle). in_org() is the membership-of helper
-- orgs_read uses below for the same reason.
create or replace function is_org_admin(org uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from org_memberships m
    where m.member_id = auth.uid() and m.status = 'active'
      and m.role = 'admin' and m.organization_id = org);
$$;

create or replace function in_org(org uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from org_memberships m
    where m.member_id = auth.uid() and m.status = 'active' and m.organization_id = org);
$$;

drop policy if exists om_read_admin on org_memberships;
create policy om_read_admin on org_memberships
  for select using (is_org_admin(organization_id));

-- ---------------------------------------------------------------- 4b. scope orgs_read
-- `orgs_read using (true)` (0002) let any authenticated user enumerate every org (name,
-- type, creator). Scope it to orgs the caller is connected to. Joining a team is by code
-- through the create_team/join_team SECURITY DEFINER RPCs, which do NOT read orgs via this
-- policy, so tightening it does not affect onboarding. The membership clause goes through
-- in_org() (SECURITY DEFINER) to avoid re-triggering org_memberships RLS from here.
drop policy if exists orgs_read on orgs;
create policy orgs_read on orgs for select using (
  created_by = auth.uid()
  or exists (
    select 1 from teams t
    join team_members m on m.team_id = t.id
    where t.org_id = orgs.id and m.athlete_id = auth.uid() and m.status = 'active'
  )
  or exists (
    select 1 from teams t
    join team_staff s on s.team_id = t.id
    where t.org_id = orgs.id and s.staff_id = auth.uid() and s.status = 'active'
  )
  or in_org(orgs.id)
);
