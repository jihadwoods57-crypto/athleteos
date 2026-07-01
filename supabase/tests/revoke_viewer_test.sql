-- OnStandard — throwaway-Postgres validation for revoke_viewer (security G1) + a re-check of the
-- 0012 can_view cutover's behaviour. Self-contained: it stubs the Supabase auth env, recreates the
-- exact access functions from migrations 0002/0011/0012/0013 (copied verbatim) + the 0014
-- revoke_viewer, seeds a representative org/team/trainer/guardian, and asserts the before/after.
--
-- Run with:  psql -v ON_ERROR_STOP=1 -f supabase/tests/revoke_viewer_test.sql
-- A FAIL raises an exception (psql exits non-zero); all-pass prints PASS lines and "ALL GREEN".

begin;
create extension if not exists pgcrypto;

-- ---- Supabase auth stub: auth.uid() reads a session GUC we set with set_config('test.uid', ...) ----
create schema if not exists auth;
create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('test.uid', true), '')::uuid
$$;

create or replace function expect(cond boolean, msg text) returns void language plpgsql as $$
begin
  if cond then raise notice 'PASS: %', msg;
  else raise exception 'FAIL: %', msg; end if;
end $$;

-- ---- enums (verbatim from 0001 / 0011) ----
create type link_status            as enum ('active','invited','removed');
create type staff_role             as enum ('head_coach','assistant');
create type org_type               as enum ('school','club','independent');
create type membership_role        as enum ('athlete','client','guardian','admin','head_coach','assistant_coach','trainer','nutritionist');
create type membership_scope_kind  as enum ('organization','program','group','individual');
create type membership_status      as enum ('invited','active','suspended','left','transferred','graduated','removed');

-- ---- minimal subject/link tables (the columns the access model reads) ----
create table profiles  (id uuid primary key);
create table orgs      (id uuid primary key default gen_random_uuid(), name text, type org_type, created_by uuid);
create table teams     (id uuid primary key default gen_random_uuid(), org_id uuid references orgs(id), name text, created_by uuid);
create table team_members   (team_id uuid, athlete_id uuid, status link_status default 'active', primary key (team_id, athlete_id));
create table team_staff     (team_id uuid, staff_id  uuid, role staff_role default 'head_coach', status link_status default 'active', primary key (team_id, staff_id));
create table practices      (id uuid primary key default gen_random_uuid(), owner_id uuid);
create table practice_clients (practice_id uuid, client_id uuid, status link_status default 'active', primary key (practice_id, client_id));
create table guardianships  (athlete_id uuid, guardian_id uuid, status link_status default 'active', primary key (athlete_id, guardian_id));
create table org_memberships (id uuid primary key default gen_random_uuid(), organization_id uuid, member_id uuid,
  role membership_role, scope_kind membership_scope_kind, scope_id uuid, status membership_status default 'active', ended_at timestamptz);

-- ---- access functions (VERBATIM from 0002/0011/0012/0013) ----
create or replace function is_self(athlete uuid) returns boolean
language sql stable security definer set search_path = public as $$ select auth.uid() = athlete; $$;

create or replace function is_team_coach_of(athlete uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from team_members m join team_staff s on s.team_id = m.team_id
    where m.athlete_id = athlete and m.status = 'active' and s.staff_id = auth.uid() and s.status = 'active'); $$;

create or replace function is_trainer_of(athlete uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from practice_clients pc join practices p on p.id = pc.practice_id
    where pc.client_id = athlete and pc.status = 'active' and p.owner_id = auth.uid()); $$;

create or replace function is_guardian_of(athlete uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from guardianships g
    where g.athlete_id = athlete and g.guardian_id = auth.uid() and g.status = 'active'); $$;

create or replace function scope_contains(outer_kind membership_scope_kind, outer_id uuid,
  inner_kind membership_scope_kind, inner_id uuid) returns boolean
language sql immutable as $$
  select case outer_kind
    when 'organization' then true
    when 'program'      then inner_kind in ('program','group') and (outer_id = inner_id)
    when 'group'        then inner_kind = 'group' and outer_id = inner_id
    when 'individual'   then inner_kind = 'individual' and outer_id = inner_id
    else false end; $$;

create or replace function can_view_via_memberships(athlete uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select is_self(athlete) or exists (
    select 1 from org_memberships viewer
    where viewer.member_id = auth.uid() and viewer.status = 'active'
      and viewer.role in ('admin','head_coach','assistant_coach','trainer','nutritionist','guardian')
      and ((viewer.scope_kind = 'individual' and viewer.scope_id = athlete)
        or exists (select 1 from org_memberships a
          where a.member_id = athlete and a.role = 'athlete' and a.status = 'active'
            and a.organization_id = viewer.organization_id
            and scope_contains(viewer.scope_kind, viewer.scope_id, a.scope_kind, a.scope_id)))); $$;

-- can_view: the 0013 final body (memberships OR legacy trainer OR legacy guardian)
create or replace function can_view(athlete uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select can_view_via_memberships(athlete) or is_trainer_of(athlete) or is_guardian_of(athlete); $$;

-- the 0012 teams-only backfill (verbatim)
create or replace function backfill_org_memberships_teams() returns void
language plpgsql security definer set search_path = public as $$
declare t record; v_org uuid;
begin
  for t in select id, name, org_id, created_by from teams loop
    v_org := t.org_id;
    if v_org is null then
      insert into orgs(name, type, created_by) values (t.name, 'club', t.created_by) returning id into v_org;
      update teams set org_id = v_org where id = t.id;
    end if;
    insert into org_memberships(organization_id, member_id, role, scope_kind, scope_id, status)
    select v_org, m.athlete_id, 'athlete', 'group', t.id, 'active' from team_members m
    where m.team_id = t.id and m.status = 'active'
      and not exists (select 1 from org_memberships om where om.organization_id = v_org and om.member_id = m.athlete_id
        and om.role = 'athlete' and om.scope_kind = 'group' and om.scope_id is not distinct from t.id);
    insert into org_memberships(organization_id, member_id, role, scope_kind, scope_id, status)
    select v_org, s.staff_id, case when s.role = 'head_coach' then 'head_coach'::membership_role else 'assistant_coach'::membership_role end,
      'group', t.id, 'active' from team_staff s
    where s.team_id = t.id and s.status = 'active'
      and not exists (select 1 from org_memberships om where om.organization_id = v_org and om.member_id = s.staff_id
        and om.role in ('head_coach','assistant_coach') and om.scope_kind = 'group' and om.scope_id is not distinct from t.id);
  end loop;
end $$;

-- the 0014 RPC under test (verbatim)
create or replace function revoke_viewer(viewer_kind text) returns void
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'must be signed in'; end if;
  if viewer_kind = 'coach' then
    update org_memberships set status = 'removed', ended_at = now() where member_id = uid and role = 'athlete' and status = 'active';
    update team_members set status = 'removed' where athlete_id = uid and status = 'active';
  elsif viewer_kind in ('trainer','nutritionist') then
    update practice_clients set status = 'removed' where client_id = uid and status = 'active';
  elsif viewer_kind in ('parent','guardian') then
    update guardianships set status = 'removed' where athlete_id = uid and status = 'active';
  end if;
end $$;

-- ---- seed: athlete A in team T (org O); coach C staff of T; trainer TR; guardian G ----
\set A '''00000000-0000-0000-0000-0000000000aa'''
\set C '''00000000-0000-0000-0000-0000000000cc'''
\set TR '''00000000-0000-0000-0000-0000000000d2'''
\set G '''00000000-0000-0000-0000-0000000000d6'''
\set O '''00000000-0000-0000-0000-0000000000e0'''
\set T '''00000000-0000-0000-0000-0000000000f0'''
\set P '''00000000-0000-0000-0000-0000000000b0'''

insert into profiles(id) values (:A),(:C),(:TR),(:G);
insert into orgs(id, name, type, created_by) values (:O, 'Test Org', 'club', :C);
insert into teams(id, org_id, name, created_by) values (:T, :O, 'Test Team', :C);
insert into team_members(team_id, athlete_id) values (:T, :A);
insert into team_staff(team_id, staff_id, role) values (:T, :C, 'head_coach');
insert into practices(id, owner_id) values (:P, :TR);
insert into practice_clients(practice_id, client_id) values (:P, :A);
insert into guardianships(athlete_id, guardian_id) values (:A, :G);
select backfill_org_memberships_teams();

-- ---- assertions ----
-- BEFORE: every viewer can see the athlete
select set_config('test.uid', '00000000-0000-0000-0000-0000000000cc', false);
select expect(can_view(:A),       'coach sees athlete BEFORE revoke');
select set_config('test.uid', '00000000-0000-0000-0000-0000000000d2', false);
select expect(can_view(:A),       'trainer sees client BEFORE revoke');
select set_config('test.uid', '00000000-0000-0000-0000-0000000000d6', false);
select expect(can_view(:A),       'guardian sees athlete BEFORE revoke');

-- athlete revokes the COACH
select set_config('test.uid', '00000000-0000-0000-0000-0000000000aa', false);
select revoke_viewer('coach');

-- AFTER coach revoke: coach is OUT, trainer + guardian UNCHANGED (no over-revocation)
select set_config('test.uid', '00000000-0000-0000-0000-0000000000cc', false);
select expect(not can_view(:A),   'coach can NO LONGER see athlete after revoke_viewer(coach)');
select set_config('test.uid', '00000000-0000-0000-0000-0000000000d2', false);
select expect(can_view(:A),       'trainer NOT over-revoked by coach revoke');
select set_config('test.uid', '00000000-0000-0000-0000-0000000000d6', false);
select expect(can_view(:A),       'guardian NOT over-revoked by coach revoke');

-- idempotent: a second coach-revoke is a no-op (no error)
select set_config('test.uid', '00000000-0000-0000-0000-0000000000aa', false);
select revoke_viewer('coach');

-- athlete revokes the PARENT
select revoke_viewer('parent');
select set_config('test.uid', '00000000-0000-0000-0000-0000000000d6', false);
select expect(not can_view(:A),   'guardian can NO LONGER see athlete after revoke_viewer(parent)');
select set_config('test.uid', '00000000-0000-0000-0000-0000000000d2', false);
select expect(can_view(:A),       'trainer STILL sees client (only coach + parent revoked)');

-- the athlete still sees themselves, and their profile is untouched (access half only)
select set_config('test.uid', '00000000-0000-0000-0000-0000000000aa', false);
select expect(can_view(:A),       'athlete still sees their OWN data (is_self preserved)');
select expect((select count(*) from profiles where id = :A) = 1, 'athlete profile row untouched');

select '>>> ALL GREEN: revoke_viewer validated <<<' as result;
rollback;  -- throwaway: leave no trace
