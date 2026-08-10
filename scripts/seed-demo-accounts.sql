-- OnStandard — linked demo accounts on LIVE prod (2026-08-02).
-- Two working pairs, each linked exactly the way the app links them:
--   coach@onstandard.app    <-> athlete1@onstandard.app   (team "Demo Varsity")
--   trainer@onstandard.app  <-> client1@onstandard.app    (practice "Rivera Performance")
--
-- ############################################################################
-- THE PASSWORD IS NOT IN THIS FILE, AND MUST NOT BE PUT BACK.
-- ############################################################################
-- This repository is PUBLIC, and these accounts are real sign-ins on the LIVE
-- production database that also holds real users' (including minors') data. A
-- committed shared password is a published credential: it hands anyone reading
-- GitHub an authenticated foothold on prod, which is exactly the position from
-- which RLS gets probed (see migration 0147 — a signed-in user was once enough
-- to attempt cross-tenant escalation). The first version of this script did
-- commit one; it was rotated out on 2026-08-02.
--
-- Supply it at run time instead, so it never enters git:
--
--   DEMO_PW='<the password>'
--   sed "s/__DEMO_PASSWORD__/$DEMO_PW/" scripts/seed-demo-accounts.sql > /tmp/seed.sql
--   npx supabase db query --linked --file /tmp/seed.sql
--   rm /tmp/seed.sql
--
-- The live password lives in the founder's password manager / agent memory,
-- never here. Rotate it with:
--   update auth.users set encrypted_password = crypt('<new>', gen_salt('bf'))
--    where raw_app_meta_data->>'demo' = 'true';
--
-- FOOTGUN (added 2026-08-09, scripts/seed-tester-accounts.sql): the ABOVE one-liner and any
-- teardown keyed on `raw_app_meta_data->>'demo' = 'true'` also match the forty per-tester demo
-- accounts once that script has run — 'demo' is true on ALL of them. If you only mean to touch
-- THESE four, scope every such statement to
-- `raw_app_meta_data->>'demo' = 'true' and not (raw_app_meta_data ? 'tester')` instead.
--
-- Method (from the 2026-07-13 seed, which worked): insert auth.users + auth.identities directly,
-- let the handle_new_user trigger build the profile from raw_user_meta_data.role, then make the
-- links by calling the app's OWN RPCs while impersonating each user. Nothing here writes a link
-- table by hand — if the RPC would reject it, the seed rejects it too.
--
-- IDEMPOTENT: deletes its own rows by email + team/practice name before inserting.
--
-- NOTE (client is not a DB role): user_role is only athlete/parent/coach/trainer. A "client" is
-- primary_role='athlete' + a GENERAL profile (athlete_profiles.base_goal in lose/maintain), no
-- sport, linked to a practice. The app derives the client experience from that. Do not invent a
-- 'client' enum value.

begin;

-- ---------------------------------------------------------------- teardown (idempotent)
delete from auth.users where email in (
  'coach@onstandard.app','athlete1@onstandard.app','trainer@onstandard.app','client1@onstandard.app'
);
-- teams/practices do NOT cascade with their creator (created_by is ON DELETE SET NULL), so clear
-- them by name or a re-run would pile up duplicates with fresh join codes.
delete from teams     where name = 'Demo Varsity';
delete from practices where name = 'Rivera Performance';

-- ---------------------------------------------------------------- accounts
-- email_confirmed_at is set so these can sign in immediately.
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
select
  '00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated', 'authenticated',
  d.email, crypt('__DEMO_PASSWORD__', gen_salt('bf')), now(),
  jsonb_build_object('provider','email','providers',jsonb_build_array('email'),'demo',true),
  jsonb_build_object('full_name', d.full_name, 'role', d.role),
  now(), now()
from (values
  ('coach@onstandard.app',    'Dave Reynolds', 'coach'),
  ('athlete1@onstandard.app', 'Marcus Reed',   'athlete'),
  ('trainer@onstandard.app',  'Alex Rivera',   'trainer'),
  ('client1@onstandard.app',  'Sarah Lane',    'athlete')
) as d(email, full_name, role);

-- Supabase needs a matching identity row or password sign-in fails.
insert into auth.identities (id, user_id, identity_data, provider, provider_id, last_sign_in_at, created_at, updated_at)
select gen_random_uuid(), u.id,
       jsonb_build_object('sub', u.id::text, 'email', u.email, 'email_verified', true),
       'email', u.id::text, now(), now(), now()
from auth.users u
where u.raw_app_meta_data->>'demo' = 'true';

-- REQUIRED, and the reason a hand-inserted user "exists but cannot sign in": GoTrue scans these
-- text columns into Go strings, and a NULL blows up the whole schema query — every sign-in then
-- fails with "Database error querying schema", which names nothing useful. The INSERT above
-- leaves confirmation_token / recovery_token / email_change / email_change_token_new NULL because
-- they have no defaults, so blank them explicitly. Cheap to do all eight.
update auth.users set
  confirmation_token         = coalesce(confirmation_token, ''),
  recovery_token             = coalesce(recovery_token, ''),
  email_change_token_new     = coalesce(email_change_token_new, ''),
  email_change               = coalesce(email_change, ''),
  email_change_token_current = coalesce(email_change_token_current, ''),
  phone_change               = coalesce(phone_change, ''),
  phone_change_token         = coalesce(phone_change_token, ''),
  reauthentication_token     = coalesce(reauthentication_token, '')
where raw_app_meta_data->>'demo' = 'true';

-- 0176 added profiles.email_verified defaulting to FALSE, which would show every demo account the
-- "Verify your email" banner. These addresses are ours, so mark them verified.
update profiles set email_verified = true
where id in (select id from auth.users where raw_app_meta_data->>'demo' = 'true');

-- ---------------------------------------------------------------- athlete + client shapes
-- performance goal + a sport = the ATHLETE experience.
insert into athlete_profiles (athlete_id, sport, position, level, base_goal)
select u.id, 'Football', 'WR', 'College', 'performance'
from auth.users u where u.email = 'athlete1@onstandard.app'
on conflict (athlete_id) do update
  set sport = excluded.sport, position = excluded.position,
      level = excluded.level, base_goal = excluded.base_goal;

-- lose/maintain + NO sport = the general profile the app reads as a CLIENT.
insert into athlete_profiles (athlete_id, base_goal)
select u.id, 'lose'
from auth.users u where u.email = 'client1@onstandard.app'
on conflict (athlete_id) do update set base_goal = excluded.base_goal, sport = null, position = null;

-- ---------------------------------------------------------------- links, via the app's own RPCs
do $$
declare
  v_coach uuid; v_athlete uuid; v_trainer uuid; v_client uuid;
  v_team_code text; v_practice_code text;
begin
  select id into v_coach   from auth.users where email = 'coach@onstandard.app';
  select id into v_athlete from auth.users where email = 'athlete1@onstandard.app';
  select id into v_trainer from auth.users where email = 'trainer@onstandard.app';
  select id into v_client  from auth.users where email = 'client1@onstandard.app';

  -- COACH creates the team. NOTE: create_team has TWO overloads; the 4-arg one is the real signature.
  perform set_config('request.jwt.claim.sub', v_coach::text, true);
  perform set_config('role', 'authenticated', true);
  select create_team('Demo Varsity', 'Football', null, true) into v_team_code;

  -- ATHLETE joins it.
  perform set_config('request.jwt.claim.sub', v_athlete::text, true);
  perform join_team(v_team_code, 'WR');

  -- TRAINER creates the practice.
  perform set_config('request.jwt.claim.sub', v_trainer::text, true);
  select create_practice('Rivera Performance', 'riveraperf', true) into v_practice_code;

  -- CLIENT joins it.
  perform set_config('request.jwt.claim.sub', v_client::text, true);
  perform join_practice(v_practice_code);

  perform set_config('request.jwt.claim.sub', '', true);
  raise notice 'team code: %  practice code: %', v_team_code, v_practice_code;
end $$;

commit;
