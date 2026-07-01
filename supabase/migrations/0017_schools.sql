-- OnStandard — schools directory (linking feature, Stage 1)
-- Makes `orgs` a real, searchable school/club directory so an athlete and a coach
-- land on the SAME school entity, and lets a coach opt a team into being discoverable
-- by athletes at that school. Reuses the existing public `orgs_read` policy (select
-- true) and `orgs_write` (insert where created_by = auth.uid()) from 0002_rls.sql —
-- no new policy needed for search / add-your-school.
--
-- GUARDRAIL: authored only; the founder applies this at go-live (like 0004+). It is
-- additive and inert until EXPO_PUBLIC_BACKEND_LIVE is on.

-- ---------------------------------------------------------------- orgs: location
-- City/State disambiguate same-named schools in the picker (both nullable so the
-- "add your school/club" path can create a club/gym without a location).
alter table orgs add column if not exists city  text;
alter table orgs add column if not exists state text;

-- Case-insensitive (name, state) index backs the dedup pre-check on "add your school".
create index if not exists orgs_name_state_lower
  on orgs (lower(name), lower(coalesce(state, '')));

-- ---------------------------------------------------------------- teams: discoverability
-- Opt-in (default false, privacy-safe): only discoverable teams appear in an athlete's
-- school search. Code-only teams (discoverable=false) behave exactly as today.
alter table teams add column if not exists discoverable boolean not null default false;
create index if not exists teams_discoverable_org on teams (org_id) where discoverable;

-- ---------------------------------------------------------------- create_team (extended)
-- Attach the team to a school (org_id) and set discoverability atomically at creation.
-- Backwards-compatible: the two new args default to null/false, so existing callers are
-- unaffected. Same SECURITY DEFINER pattern as 0004 (self-inserting the first staff row).
create or replace function create_team(
  team_name text,
  team_sport text default null,
  team_org uuid default null,
  team_discoverable boolean default false
) returns text
language plpgsql security definer set search_path = public as $$
declare
  new_code text;
  new_team uuid;
begin
  if auth.uid() is null then
    raise exception 'must be signed in to create a team';
  end if;
  new_code := gen_join_code();
  insert into teams (name, sport, join_code, org_id, discoverable, created_by)
  values (coalesce(nullif(team_name, ''), 'My Team'), team_sport, new_code,
          team_org, coalesce(team_discoverable, false), auth.uid())
  returning id into new_team;
  insert into team_staff (team_id, staff_id, role, status)
  values (new_team, auth.uid(), 'head_coach', 'active');
  return new_code;
end; $$;

-- ---------------------------------------------------------------- starter seed
-- A small, real starter set so the picker is demonstrable + the demo showcase schools
-- resolve. The PRODUCTION bulk import (NCES public schools + IPEDS colleges) is a
-- separate data-ops step pending a dataset + licensing decision — the "add your
-- school/club" escape hatch covers everything not seeded until then.
insert into orgs (name, type, city, state)
select v.name, v.type::org_type, v.city, v.state
from (values
  ('Eastside High School', 'school', 'Gainesville', 'FL'),
  ('Westlake High School',  'school', 'Austin',      'TX'),
  ('Central High School',   'school', 'Phoenix',     'AZ'),
  ('Lincoln High School',   'school', 'Portland',    'OR'),
  ('Roosevelt High School', 'school', 'Seattle',     'WA'),
  ('Northside High School', 'school', 'Atlanta',     'GA'),
  ('St. Thomas Aquinas',    'school', 'Fort Lauderdale', 'FL'),
  ('Mater Dei High School', 'school', 'Santa Ana',   'CA'),
  ('IMG Academy',           'school', 'Bradenton',   'FL'),
  ('University of Florida',       'school', 'Gainesville', 'FL'),
  ('University of Texas at Austin','school', 'Austin',     'TX'),
  ('Ohio State University',       'school', 'Columbus',    'OH'),
  ('University of Georgia',       'school', 'Athens',      'GA'),
  ('University of Alabama',       'school', 'Tuscaloosa',  'AL')
) as v(name, type, city, state)
where not exists (
  select 1 from orgs o
  where lower(o.name) = lower(v.name)
    and lower(coalesce(o.state, '')) = lower(coalesce(v.state, ''))
);
