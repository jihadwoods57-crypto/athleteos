-- OnStandard — Phase A keystone: org_memberships (the one access-grant object)
--
-- The enterprise-architecture keystone (docs/architecture/01 + the ratified
-- DECISION-MEMO D1/D2). This generalizes today's four link tables — team_members,
-- team_staff, practice_clients, guardianships — into ONE membership + role + SCOPE
-- grant. It encodes the ratified decisions: everything is an Organization
-- (trainer/parent/family = orgs of one/household), athletes own data while orgs own
-- ACCESS only, unlimited orgs per athlete.
--
-- THIS MIGRATION IS PURELY ADDITIVE AND CHANGES NO EXISTING BEHAVIOR:
--   * it creates the org_memberships table + the scope_contains() helper;
--   * it adds can_view_via_memberships() as a NEW function (the target predicate),
--     NOT a replacement of can_view() — so existing RLS is untouched.
-- The behavioral cutover (swapping can_view()'s body to call this, after backfilling
-- org_memberships from the legacy tables) is a separate GO-LIVE step, documented at
-- the bottom, because it is entangled with the orgs->organizations rename and needs
-- realistic seed data validated on a throwaway DB first. src/core/membership.ts is the
-- canonical mirror of can_view_via_memberships (989 offline tests); this SQL is the
-- enforcement layer that gets PG-validated before any cutover.
--
-- GUARDRAIL: authored + applied only to a throwaway LOCAL postgres to verify the DDL
-- round-trips on top of 0001-0010. NOT applied to the live project (the founder applies
-- migrations per D1). The consent gate (0008/consent.ts) sits ABOVE every grant here.
--
-- VALIDATED 2026-06-29 on a throwaway Postgres (initdb + an auth/storage shim): all of
-- 0001-0011 apply clean, and can_view_via_memberships() matches src/core canView() on the
-- linebacker/QB/trainer scenario (org-scoped coach sees the roster; individual-scoped
-- trainer sees one; athlete sees self; a transferred grant sees nothing).

-- ---------------------------------------------------------------- enums
create type membership_role as enum (
  'athlete', 'client', 'guardian',                 -- subject side (+ guardian: viewer-of-one)
  'admin', 'head_coach', 'assistant_coach',        -- staff side
  'trainer', 'nutritionist'                         -- professional roles
);
create type membership_scope_kind as enum ('organization', 'program', 'group', 'individual');
create type membership_status as enum (
  'invited', 'active', 'suspended', 'left', 'transferred', 'graduated', 'removed'
);

-- ---------------------------------------------------------------- table
-- References orgs(id) today (the orgs->organizations rename is a later [EVOLVE] step
-- that keeps id stable, so this FK survives it).
create table org_memberships (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references orgs(id) on delete cascade,
  member_id       uuid not null references profiles(id) on delete cascade, -- the person
  role            membership_role not null,
  -- SCOPE: what this grant reaches inside the org. Staff get a container scope
  -- (organization/program/group); a trainer/guardian gets an individual scope (one athlete).
  scope_kind      membership_scope_kind not null,
  scope_id        uuid,        -- program | group | target athlete profile id | null (= whole org)
  -- capability bits beyond the role default (jsonb so adding a capability is data, not a
  -- migration). Key space is the typed PERMISSION_KEYS catalog in src/core/membership.ts.
  -- NOTE: there is deliberately no key that edits the scoring formula (DECISION-MEMO D3).
  permissions     jsonb not null default '{}'::jsonb,
  status          membership_status not null default 'active',
  invited_by      uuid references profiles(id) on delete set null,
  joined_at       timestamptz,
  ended_at        timestamptz,
  created_at      timestamptz not null default now(),
  -- one live grant per (org, member, role, scope); re-joining reactivates in place.
  unique (organization_id, member_id, role, scope_kind, scope_id)
);
create index om_member on org_memberships(member_id)       where status = 'active';
create index om_org    on org_memberships(organization_id) where status = 'active';
create index om_scope  on org_memberships(scope_kind, scope_id) where status = 'active';

-- ---------------------------------------------------------------- scope containment
-- Does the OUTER scope contain the INNER scope? organization ⊇ program ⊇ group;
-- individual contains only an exact match. Pure mirror of src/core scopeContains().
-- The flat wedge is one org = one program = one group, so program/group containment
-- treats equal ids as contained; a real program->group tree refines this later.
create or replace function scope_contains(
  outer_kind membership_scope_kind, outer_id uuid,
  inner_kind membership_scope_kind, inner_id uuid
) returns boolean
language sql immutable as $$
  select case outer_kind
    when 'organization' then true
    when 'program'      then inner_kind in ('program','group') and (outer_id = inner_id)
    when 'group'        then inner_kind = 'group' and outer_id = inner_id
    when 'individual'   then inner_kind = 'individual' and outer_id = inner_id
    else false end;
$$;

-- ---------------------------------------------------------------- target predicate (NEW; not yet wired)
-- The membership-based "can auth.uid() view this athlete?" — identical in shape to
-- src/core/membership.ts canView(). Added as a NEW function so it changes nothing until
-- the cutover swaps can_view()'s body to call it.
create or replace function can_view_via_memberships(athlete uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select is_self(athlete) or exists (
    select 1
    from org_memberships viewer
    where viewer.member_id = auth.uid()
      and viewer.status = 'active'
      and viewer.role in ('admin','head_coach','assistant_coach','trainer','nutritionist','guardian')
      and (
        (viewer.scope_kind = 'individual' and viewer.scope_id = athlete)
        or exists (
          select 1 from org_memberships a
          where a.member_id = athlete and a.role = 'athlete' and a.status = 'active'
            and a.organization_id = viewer.organization_id
            and scope_contains(viewer.scope_kind, viewer.scope_id, a.scope_kind, a.scope_id)
        )
      )
  );
$$;

-- ---------------------------------------------------------------- RLS
-- A member reads their OWN grants; an org admin reads the grants in orgs they administer.
-- ALL writes go through SECURITY DEFINER RPCs (create_org/accept_invitation, authored at
-- go-live), never directly — so a member cannot self-grant access or escalate a role.
alter table org_memberships enable row level security;
create policy om_read_own on org_memberships
  for select using (member_id = auth.uid());
create policy om_read_admin on org_memberships
  for select using (exists (
    select 1 from org_memberships mine
    where mine.member_id = auth.uid() and mine.status = 'active'
      and mine.role = 'admin' and mine.organization_id = org_memberships.organization_id
  ));

grant select on org_memberships to authenticated;
grant select, insert, update, delete on org_memberships to service_role;

-- ================================================================ GO-LIVE CUTOVER (do NOT apply here)
-- When the backend goes live, AFTER backfilling org_memberships from the legacy link
-- tables (one row per active team_members/team_staff/practice_clients/guardianships,
-- synthesizing an org-of-one for practices and a family org per guardianship), swap the
-- predicate in one line — no policy or call site changes (the non-destructive trick):
--
--   create or replace function can_view(athlete uuid) returns boolean
--   language sql stable security definer set search_path = public as $$
--     select can_view_via_memberships(athlete);
--   $$;
--
-- Validate on a throwaway DB that, for every seeded athlete, can_view() == the legacy
-- disjunction BEFORE applying. The backfill + the orgs->organizations rename are tracked
-- in docs/architecture/01 (Phase B/C); they are [DON'T BUILD YET] until a real org exists.
