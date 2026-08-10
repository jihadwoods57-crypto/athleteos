-- OnStandard — Per-tester demo accounts, run against whichever DB you point it at (2026-08-09).
-- Ten isolated coach+athlete+trainer+client sets, same shape and same proven method as
-- scripts/seed-demo-accounts.sql, scaled to ten. See
-- docs/superpowers/specs/2026-08-09-tester-demo-accounts-design.md.
--
-- ############################################################################
-- PASSWORDS ARE NOT IN THIS FILE. Ten __PW_NN__ placeholders are substituted at run time by
-- `node scripts/tester-accounts.mjs gen`, which writes the runnable file to the OS temp dir —
-- never into git. This repository is PUBLIC; a committed password is a published authenticated
-- foothold on a database that also holds real users' — including minors' — data (see
-- scripts/seed-demo-accounts.sql for the incident that taught this the hard way).
-- ############################################################################
--
-- FOOTGUN: the founder's four ORIGINAL demo accounts (coach@ / athlete1@ / trainer@ / client1@)
-- are tagged raw_app_meta_data->>'demo'='true' and nothing else. This script's forty accounts are
-- ADDITIONALLY tagged raw_app_meta_data->'tester', so every statement below scopes to
-- `raw_app_meta_data ? 'tester'` and never touches the founder's four. But
-- scripts/seed-demo-accounts.sql's own teardown/rotate one-liners key on `demo = 'true'` alone —
-- once this script has run, THOSE one-liners sweep all forty-four accounts, founder's four
-- included. Read scripts/seed-demo-accounts.sql's header before running either script's teardown.
--
-- IDEMPOTENT. Re-running this resets every set — claimed or not — back to a fresh password and
-- zero history. tester_sets is rebuilt from scratch; every set goes back to unclaimed. Do not
-- re-run this after real testers have claimed sets unless you intend to reset everyone.
--
-- Run: node scripts/tester-accounts.mjs gen   (substitutes passwords, prints the exact command)

begin;

-- ---------------------------------------------------------------- the cast (edit here, nowhere else)
-- pw_placeholder holds a __PW_NN__ token until tester-accounts.mjs gen substitutes the real
-- password IN THE FILE TEXT before this script ever runs — by the time any statement below reads
-- pw_placeholder, it already holds the real value.
create temporary table tester_cast (
  n               int primary key,
  coach_name      text not null,
  athlete_name    text not null,
  athlete_sport   text not null,
  athlete_pos     text not null,
  trainer_name    text not null,
  client_name     text not null,
  team_name       text not null,
  practice_name   text not null,
  practice_handle text not null,
  pw_placeholder  text not null
) on commit drop;

insert into tester_cast (n, coach_name, athlete_name, athlete_sport, athlete_pos, trainer_name, client_name, team_name, practice_name, practice_handle, pw_placeholder) values
  ( 1, 'Priya Nair',        'Owen Castillo',    'Football',   'QB',  'Marcus Diallo',   'Renee Chapman',     'Northgate Varsity', 'Diallo Performance',     'diallofit',     '__PW_01__'),
  ( 2, 'Grant Okafor',      'Bella Marsh',       'Soccer',     'MF',  'Sofia Reyes',     'Tyler Brooks',      'Cedar Ridge Blue',  'Reyes Athletics',        'reyesfit',      '__PW_02__'),
  ( 3, 'Holly Vance',       'DeShawn Price',     'Basketball', 'PG',  'Ian Whitmore',    'Nadia Solis',       'Ironpoint Hawks',   'Whitmore Training',      'whitmorefit',   '__PW_03__'),
  ( 4, 'Felix Amaro',       'Grace Lindqvist',   'Track',      'SP',  'Camille Boucher', 'Derek Yun',         'Summit Prep',       'Boucher Conditioning',   'boucherfit',    '__PW_04__'),
  ( 5, 'Ravi Deshmukh',     'Mason Ellery',      'Football',   'RB',  'Jenna Ostrowski', 'Priscilla Nkemelu', 'Coastline Titans',  'Ostrowski Strength',     'ostrowskifit',  '__PW_05__'),
  ( 6, 'Theo Bracken',      'Ava Fenwick',       'Volleyball', 'OH',  'Luca Moretti',    'Simone Okoro',      'Redwood Athletics', 'Moretti Performance',    'morettifit',    '__PW_06__'),
  ( 7, 'Julissa Vega',      'Caleb Underwood',   'Wrestling',  '157', 'Naomi Trask',     'Aaron Blakely',     'Granite Valley',    'Trask Training Lab',     'traskfit',      '__PW_07__'),
  ( 8, 'Bram Osei',         'Willa Petrenko',    'Softball',   'SS',  'Dominic Farrow',  'Leah Whitfield',    'Lakeshore United',  'Farrow Fitness',         'farrowfit',     '__PW_08__'),
  ( 9, 'Miriam Castellano', 'Elias Boateng',     'Football',   'LB',  'Paige Kowalski',  'Rosalind Achebe',   'Highline Prep',     'Kowalski Performance',   'kowalskifit',   '__PW_09__'),
  (10, 'Nolan Hargrove',    'Freya Solberg',     'Track',      'DI',  'Zane Culpepper',  'Marguerite Osei',   'Ashford Rise',      'Culpepper Training',     'culpepperfit',  '__PW_10__');

-- ---------------------------------------------------------------- teardown (idempotent)
-- Order matters: teams.created_by is ON DELETE SET NULL, so deleting the users first would orphan
-- their teams beyond any way to identify them (prod already carries several orphans — "Flow High",
-- "Lincoln High", "My Team", "WSU" — from exactly this mistake). practices has no created_by column
-- at all — its owner column is owner_id (FK ON DELETE CASCADE to profiles), confirmed against the
-- live schema; delete by owner_id for the same by-creator scoping, before the users are gone.
delete from teams
 where created_by in (select id from auth.users where raw_app_meta_data ? 'tester');
delete from practices
 where owner_id in (select id from auth.users where raw_app_meta_data ? 'tester');
-- create_team's team_staff insert fires trg_team_staff_membership -> ensure_team_org(), which
-- auto-creates an orgs row (created_by = the coach) and backfills teams.org_id EVEN THOUGH this
-- script calls create_team(..., team_org => null) — that arg only skips the org lookup, it does
-- not stop the trigger. orgs.created_by is ALSO ON DELETE SET NULL (same shape as teams.created_by
-- above), so deleting auth.users first would orphan these orgs one re-run at a time. On a run where
-- no prior orphan of the same name exists this is silent; it only surfaces two runs later, when a
-- second orphan with the same name collides on orgs_directory_seed_unique (lower(name),
-- coalesce(state,'')) WHERE created_by IS NULL — confirmed empirically: this line was missing
-- through Task 2 and Task 6's first `verify` run failed on exactly that collision on its third
-- overall run against a persistent local DB. Must run before the auth.users delete below.
delete from orgs
 where created_by in (select id from auth.users where raw_app_meta_data ? 'tester');
delete from auth.users where raw_app_meta_data ? 'tester';
delete from tester_sets;

-- ---------------------------------------------------------------- accounts
-- email_confirmed_at is set so these can sign in immediately. Four inserts, one per role, because
-- each role reads a different name column off tester_cast.
insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select '00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated', 'authenticated',
       't' || lpad(n::text,2,'0') || '-coach@onstandard.app', crypt(pw_placeholder, gen_salt('bf')), now(),
       jsonb_build_object('provider','email','providers',jsonb_build_array('email'),'demo',true,'tester',lpad(n::text,2,'0')),
       jsonb_build_object('full_name', coach_name, 'role', 'coach'), now(), now()
from tester_cast;

insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select '00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated', 'authenticated',
       't' || lpad(n::text,2,'0') || '-athlete@onstandard.app', crypt(pw_placeholder, gen_salt('bf')), now(),
       jsonb_build_object('provider','email','providers',jsonb_build_array('email'),'demo',true,'tester',lpad(n::text,2,'0')),
       jsonb_build_object('full_name', athlete_name, 'role', 'athlete'), now(), now()
from tester_cast;

insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select '00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated', 'authenticated',
       't' || lpad(n::text,2,'0') || '-trainer@onstandard.app', crypt(pw_placeholder, gen_salt('bf')), now(),
       jsonb_build_object('provider','email','providers',jsonb_build_array('email'),'demo',true,'tester',lpad(n::text,2,'0')),
       jsonb_build_object('full_name', trainer_name, 'role', 'trainer'), now(), now()
from tester_cast;

insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select '00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated', 'authenticated',
       't' || lpad(n::text,2,'0') || '-client@onstandard.app', crypt(pw_placeholder, gen_salt('bf')), now(),
       jsonb_build_object('provider','email','providers',jsonb_build_array('email'),'demo',true,'tester',lpad(n::text,2,'0')),
       jsonb_build_object('full_name', client_name, 'role', 'athlete'), now(), now()
from tester_cast;

-- Supabase needs a matching identity row or password sign-in fails.
insert into auth.identities (id, user_id, identity_data, provider, provider_id, last_sign_in_at, created_at, updated_at)
select gen_random_uuid(), u.id, jsonb_build_object('sub', u.id::text, 'email', u.email, 'email_verified', true),
       'email', u.id::text, now(), now(), now()
from auth.users u where u.raw_app_meta_data ? 'tester';

-- REQUIRED: GoTrue scans these text columns into Go strings and a single NULL fails the entire
-- schema query — every sign-in then returns "Database error querying schema", which names
-- nothing useful. The insert above leaves all eight NULL because they have no defaults.
update auth.users set
  confirmation_token         = coalesce(confirmation_token, ''),
  recovery_token             = coalesce(recovery_token, ''),
  email_change_token_new     = coalesce(email_change_token_new, ''),
  email_change               = coalesce(email_change, ''),
  email_change_token_current = coalesce(email_change_token_current, ''),
  phone_change                = coalesce(phone_change, ''),
  phone_change_token          = coalesce(phone_change_token, ''),
  reauthentication_token      = coalesce(reauthentication_token, '')
where raw_app_meta_data ? 'tester';

-- 0176 added profiles.email_verified defaulting to FALSE, which would show every account the
-- "Verify your email" banner.
update profiles set email_verified = true
where id in (select id from auth.users where raw_app_meta_data ? 'tester');

-- ---------------------------------------------------------------- athlete + client shapes
-- performance goal + a sport = the ATHLETE experience.
insert into athlete_profiles (athlete_id, sport, position, level, base_goal)
select u.id, tc.athlete_sport, tc.athlete_pos, 'College', 'performance'
from auth.users u
join tester_cast tc on u.email = 't' || lpad(tc.n::text,2,'0') || '-athlete@onstandard.app'
on conflict (athlete_id) do update
  set sport = excluded.sport, position = excluded.position, level = excluded.level, base_goal = excluded.base_goal;

-- lose/maintain + NO sport = the general profile the app reads as a CLIENT. "Client" is NOT a
-- user_role value — see scripts/seed-demo-accounts.sql for why that enum must never gain one.
insert into athlete_profiles (athlete_id, base_goal)
select u.id, 'lose'
from auth.users u
join tester_cast tc on u.email = 't' || lpad(tc.n::text,2,'0') || '-client@onstandard.app'
on conflict (athlete_id) do update set base_goal = excluded.base_goal, sport = null, position = null;

-- ---------------------------------------------------------------- links, via the app's own RPCs
create temporary table tester_links (
  n int primary key, team_id uuid, team_code text, practice_id uuid, practice_code text
) on commit drop;

do $$
declare
  r record;
  v_coach uuid; v_athlete uuid; v_trainer uuid; v_client uuid;
  v_team_code text; v_team_id uuid; v_practice_code text; v_practice_id uuid;
  -- set_config('role', ..., true) is SET LOCAL: it survives for the rest of the TRANSACTION, not
  -- just the next statement. Capture the connecting role (superuser, e.g. postgres) once so it can
  -- be restored after each impersonation — otherwise the plain INSERT below (and everything after
  -- this do block, including the tester_sets insert and the final select) would keep running as
  -- 'authenticated', which has no privileges on temp tables owned by the connecting role.
  v_real_role text := current_setting('role');
begin
  for r in select * from tester_cast order by n loop
    select id into v_coach   from auth.users where email = 't' || lpad(r.n::text,2,'0') || '-coach@onstandard.app';
    select id into v_athlete from auth.users where email = 't' || lpad(r.n::text,2,'0') || '-athlete@onstandard.app';
    select id into v_trainer from auth.users where email = 't' || lpad(r.n::text,2,'0') || '-trainer@onstandard.app';
    select id into v_client  from auth.users where email = 't' || lpad(r.n::text,2,'0') || '-client@onstandard.app';

    -- COACH creates the team. create_team has TWO overloads; the 4-arg one is the real signature.
    perform set_config('request.jwt.claim.sub', v_coach::text, true);
    perform set_config('role', 'authenticated', true);
    select create_team(r.team_name, 'Football', null, true) into v_team_code;
    select id into v_team_id from teams where join_code = v_team_code;

    -- ATHLETE joins it.
    perform set_config('request.jwt.claim.sub', v_athlete::text, true);
    perform join_team(v_team_code, r.athlete_pos);

    -- TRAINER creates the practice.
    perform set_config('request.jwt.claim.sub', v_trainer::text, true);
    select create_practice(r.practice_name, r.practice_handle, true) into v_practice_code;
    select id into v_practice_id from practices where join_code = v_practice_code;

    -- CLIENT joins it.
    perform set_config('request.jwt.claim.sub', v_client::text, true);
    perform join_practice(v_practice_code);

    -- Drop the impersonation before touching a plain table directly — see v_real_role above.
    perform set_config('role', v_real_role, true);
    insert into tester_links (n, team_id, team_code, practice_id, practice_code)
    values (r.n, v_team_id, v_team_code, v_practice_id, v_practice_code);
  end loop;

  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('role', v_real_role, true);
end $$;

-- ---------------------------------------------------------------- handout table
insert into tester_sets (set_no, password, email_coach, email_athlete, email_trainer, email_client,
                          team_id, team_join_code, practice_id, practice_join_code)
select tc.n, tc.pw_placeholder,
       't' || lpad(tc.n::text,2,'0') || '-coach@onstandard.app',
       't' || lpad(tc.n::text,2,'0') || '-athlete@onstandard.app',
       't' || lpad(tc.n::text,2,'0') || '-trainer@onstandard.app',
       't' || lpad(tc.n::text,2,'0') || '-client@onstandard.app',
       tl.team_id, tl.team_code, tl.practice_id, tl.practice_code
from tester_cast tc join tester_links tl on tl.n = tc.n
order by tc.n;

select set_no, email_coach, email_athlete, email_trainer, email_client, team_join_code, practice_join_code
from tester_sets order by set_no;

commit;
