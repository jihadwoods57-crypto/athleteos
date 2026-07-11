-- OnStandard — adversarial RLS / authorization audit.
--
-- Unlike revoke_viewer_test.sql (which recreates the access functions as copies), this suite runs
-- against a database with the REAL migrations applied (0001→0047) and probes the actual policies
-- by switching to the `authenticated` role with request.jwt.claim.sub set per actor — exactly how
-- live Supabase evaluates auth.uid().
--
-- Run with (against a migrated local/staging DB, as a superuser — NEVER production):
--   psql -v ON_ERROR_STOP=1 -f supabase/tests/rls_authz_test.sql
--
-- Every check is recorded; the suite runs to completion and FAILS AT THE END (non-zero exit) if
-- any check failed, printing the full scoreboard first. The whole run is one transaction,
-- rolled back — it leaves no data behind.
--
-- Cast of actors:
--   ath_a    adult athlete, member of team T1 (org O1); practice client of trainer_t
--   ath_b    adult athlete, member of team T2 (org O2) — a complete stranger to A's circle
--   ath_c    adult athlete, member of team T1B — a SECOND team in the SAME org O1 as A
--   minor_m  15-year-old athlete on team T1
--   coach_1  active staff on T1 (A's and M's coach)
--   coach_2  active staff on T2 (B's coach; total stranger to O1)
--   parent_p guardian of minor_m only
--   trainer_t owns practice P1; ath_a is an active client
--   rando    an authenticated user with no links at all

begin;

-- ---------------------------------------------------------------- harness
create table _rls_results (n serial, ok boolean, label text);

create or replace function _ok(cond boolean, label text) returns void
language plpgsql security definer as $$
begin
  insert into _rls_results(ok, label) values (coalesce(cond,false), label);
  if coalesce(cond,false) then raise notice 'PASS: %', label;
  else raise warning 'FAIL: %', label; end if;
end $$;
grant execute on function _ok(boolean, text) to authenticated, anon;

-- become an actor: RLS-enforced `authenticated` role with auth.uid() = p_uid
create or replace function _as(p_uid uuid) returns void
language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claim.sub', p_uid::text, false);
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, false);
  execute 'set role authenticated';
end $$;

create or replace function _superuser() returns void
language plpgsql as $$ begin execute 'reset role'; end $$;
grant execute on function _superuser() to authenticated, anon;
grant execute on function _as(uuid) to authenticated, anon;

-- attempt a write AS THE CURRENT ACTOR (security invoker); report 'ok' or the denial
create or replace function _try(p_sql text) returns text
language plpgsql as $$
begin
  execute p_sql;
  return 'ok';
exception when others then
  return 'denied(' || sqlstate || '): ' || sqlerrm;
end $$;
grant execute on function _try(text) to authenticated, anon;

-- ---------------------------------------------------------------- seed (as superuser; sync triggers fire)
select set_config('request.jwt.claim.sub', '', false);

insert into auth.users (id, email) values
  ('aaaaaaaa-0000-0000-0000-000000000001','a@x.io'), ('bbbbbbbb-0000-0000-0000-000000000002','b@x.io'),
  ('cccccccc-0000-0000-0000-000000000003','c@x.io'), ('dddddddd-0000-0000-0000-000000000004','m@x.io'),
  ('11111111-0000-0000-0000-000000000001','c1@x.io'),('22222222-0000-0000-0000-000000000002','c2@x.io'),
  ('33333333-0000-0000-0000-000000000003','p@x.io'), ('44444444-0000-0000-0000-000000000004','t@x.io'),
  ('99999999-0000-0000-0000-000000000009','r@x.io');

-- the handle_new_user() trigger (0047) already created a profiles row per auth.users insert;
-- set the fields this suite relies on.
insert into profiles (id, full_name, email, primary_role) values
  ('aaaaaaaa-0000-0000-0000-000000000001','Athlete A','a@x.io','athlete'),
  ('bbbbbbbb-0000-0000-0000-000000000002','Athlete B','b@x.io','athlete'),
  ('cccccccc-0000-0000-0000-000000000003','Athlete C','c@x.io','athlete'),
  ('dddddddd-0000-0000-0000-000000000004','Minor M','m@x.io','athlete'),
  ('11111111-0000-0000-0000-000000000001','Coach One','c1@x.io','coach'),
  ('22222222-0000-0000-0000-000000000002','Coach Two','c2@x.io','coach'),
  ('33333333-0000-0000-0000-000000000003','Parent P','p@x.io','parent'),
  ('44444444-0000-0000-0000-000000000004','Trainer T','t@x.io','trainer'),
  ('99999999-0000-0000-0000-000000000009','Rando R','r@x.io','athlete')
on conflict (id) do update set full_name = excluded.full_name, email = excluded.email, primary_role = excluded.primary_role;

insert into athlete_profiles (athlete_id, base_age, sport) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 20, 'football'),
  ('bbbbbbbb-0000-0000-0000-000000000002', 22, 'football'),
  ('cccccccc-0000-0000-0000-000000000003', 21, 'football'),
  ('dddddddd-0000-0000-0000-000000000004', 15, 'football');

insert into teams (id, name, join_code, created_by) values
  ('77777777-1111-0000-0000-000000000001','T1','T1CODE','11111111-0000-0000-0000-000000000001'),
  ('77777777-2222-0000-0000-000000000002','T2','T2CODE','22222222-0000-0000-0000-000000000002');
insert into team_staff (team_id, staff_id, role, status) values
  ('77777777-1111-0000-0000-000000000001','11111111-0000-0000-0000-000000000001','head_coach','active'),
  ('77777777-2222-0000-0000-000000000002','22222222-0000-0000-0000-000000000002','head_coach','active');
insert into team_members (team_id, athlete_id, status) values
  ('77777777-1111-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000001','active'),
  ('77777777-1111-0000-0000-000000000001','dddddddd-0000-0000-0000-000000000004','active'),
  ('77777777-2222-0000-0000-000000000002','bbbbbbbb-0000-0000-0000-000000000002','active');

-- second team in the SAME org as T1 (org created for T1 by the 0034 sync); C is its athlete
update teams set org_id = (select org_id from teams where id='77777777-1111-0000-0000-000000000001')
  where id = '77777777-1111-0000-0000-000000000001'; -- no-op guard
insert into teams (id, org_id, name, join_code, created_by)
  select '77777777-3333-0000-0000-000000000003', org_id, 'T1B','T1BCODE','11111111-0000-0000-0000-000000000001'
  from teams where id='77777777-1111-0000-0000-000000000001';
insert into team_members (team_id, athlete_id, status) values
  ('77777777-3333-0000-0000-000000000003','cccccccc-0000-0000-0000-000000000003','active');

insert into practices (id, owner_id, name, join_code) values
  ('88888888-0000-0000-0000-000000000001','44444444-0000-0000-0000-000000000004','P1','P1CODE');
insert into practice_clients (practice_id, client_id, status) values
  ('88888888-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000001','active');

insert into guardianships (athlete_id, guardian_id, relationship, status) values
  ('dddddddd-0000-0000-0000-000000000004','33333333-0000-0000-0000-000000000003','parent','active');

-- 0050: minor M's guardian consent is VERIFIED at seed — required BEFORE M's days/meals/
-- checkins/photos below (the minor write-block trigger fires even for superuser inserts),
-- and it keeps the link-scope probes above testing LINK semantics, not consent. The
-- unconsented paths are probed in section 10 with a second minor (N).
insert into guardian_consent_requests (athlete_id, guardian_email, status, verified_at) values
  ('dddddddd-0000-0000-0000-000000000004','p@x.io','verified', now());

-- an ORGANIZATION-scoped admin of O1 (the org auto-created for T1/T1B). Unlike a team coach
-- (group scope), an org admin is meant to see every athlete across every team in their org.
insert into auth.users (id, email) values ('55555555-0000-0000-0000-000000000005','admin@x.io');
insert into profiles (id, full_name, email, primary_role) values
  ('55555555-0000-0000-0000-000000000005','Org Admin','admin@x.io','coach')
  on conflict (id) do update set full_name = excluded.full_name, email = excluded.email, primary_role = excluded.primary_role;
insert into org_memberships (organization_id, member_id, role, scope_kind, scope_id, status)
  select org_id, '55555555-0000-0000-0000-000000000005','admin','organization', null, 'active'
  from teams where id = '77777777-1111-0000-0000-000000000001';

-- private data
insert into meals (id, athlete_id, day_date, name, protein, kcal) values
  ('e0000000-0000-0000-0000-00000000000a','aaaaaaaa-0000-0000-0000-000000000001', current_date, 'A breakfast', 40, 600),
  ('e0000000-0000-0000-0000-00000000000b','bbbbbbbb-0000-0000-0000-000000000002', current_date, 'B breakfast', 35, 550),
  ('e0000000-0000-0000-0000-00000000000d','dddddddd-0000-0000-0000-000000000004', current_date, 'M breakfast', 30, 500);
insert into days (athlete_id, date, current_weight, score) values
  ('aaaaaaaa-0000-0000-0000-000000000001', current_date, 183, 85),
  ('bbbbbbbb-0000-0000-0000-000000000002', current_date, 201, 74),
  ('dddddddd-0000-0000-0000-000000000004', current_date, 140, 90);
insert into checkins (athlete_id, week, weight, notes) values
  ('aaaaaaaa-0000-0000-0000-000000000001','2026-W27',183,'A private note'),
  ('dddddddd-0000-0000-0000-000000000004','2026-W27',140,'M private note');
insert into trust_passes (athlete_id, granted_by) values
  ('aaaaaaaa-0000-0000-0000-000000000001','11111111-0000-0000-0000-000000000001');
insert into meal_comments (meal_id, athlete_id, author_id, role, text) values
  ('e0000000-0000-0000-0000-00000000000a','aaaaaaaa-0000-0000-0000-000000000001','11111111-0000-0000-0000-000000000001','coach','nice plate');
insert into notifications (user_id, kind, title) values
  ('aaaaaaaa-0000-0000-0000-000000000001','coach_comment','Coach commented');
insert into threads (id, athlete_id, counterpart_id) values
  ('f0000000-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000001','11111111-0000-0000-0000-000000000001'),
  ('f0000000-0000-0000-0000-000000000002','dddddddd-0000-0000-0000-000000000004','99999999-0000-0000-0000-000000000009'),
  ('f0000000-0000-0000-0000-000000000003','dddddddd-0000-0000-0000-000000000004','11111111-0000-0000-0000-000000000001');
insert into messages (thread_id, sender_id, text) values
  ('f0000000-0000-0000-0000-000000000001','11111111-0000-0000-0000-000000000001','keep it up');

-- meal photos live in the private `meal-photos` bucket at <athlete_uid>/<date>/<file>.
-- (Harness note: real Supabase ships storage.objects with RLS enabled + grants to authenticated;
-- this suite's runner ensures the same so the policies are actually enforced here.)
insert into storage.objects (bucket_id, name, owner) values
  ('meal-photos','aaaaaaaa-0000-0000-0000-000000000001/2026-07-09/a.jpg','aaaaaaaa-0000-0000-0000-000000000001'),
  ('meal-photos','dddddddd-0000-0000-0000-000000000004/2026-07-09/m.jpg','dddddddd-0000-0000-0000-000000000004');

-- ================================================================ 1. OWNER ACCESS
select _as('aaaaaaaa-0000-0000-0000-000000000001');
select _ok((select count(*) from meals) = 1 and (select min(name) from meals) = 'A breakfast',
           'athlete A sees exactly their own meal');
select _ok((select count(*) from days) = 1, 'athlete A sees exactly their own day');
select _ok((select count(*) from checkins) = 1, 'athlete A sees exactly their own checkin');
select _ok((select count(*) from trust_passes) = 1, 'athlete A sees their own trust pass');
select _ok((select count(*) from meal_comments) = 1, 'athlete A sees the coach comment on their meal');
select _ok((select count(*) from notifications) = 1, 'athlete A sees their own notification');
select _ok(_try($q$insert into meals (athlete_id, day_date, name) values ('aaaaaaaa-0000-0000-0000-000000000001', current_date, 'A lunch')$q$) = 'ok',
           'athlete A can log their own meal');

-- ================================================================ 2. STRANGER DENIED (athlete B probes A)
select _as('bbbbbbbb-0000-0000-0000-000000000002');
select _ok((select count(*) from meals where athlete_id = 'aaaaaaaa-0000-0000-0000-000000000001') = 0,
           'stranger athlete B sees none of A''s meals');
select _ok((select count(*) from days where athlete_id = 'aaaaaaaa-0000-0000-0000-000000000001') = 0,
           'stranger athlete B sees none of A''s days');
select _ok((select count(*) from checkins where athlete_id = 'aaaaaaaa-0000-0000-0000-000000000001') = 0,
           'stranger athlete B sees none of A''s checkins');
select _ok((select count(*) from trust_passes) = 0, 'stranger athlete B sees no trust passes');
select _ok((select count(*) from meal_comments) = 0, 'stranger athlete B sees no meal comments');
select _ok((select count(*) from notifications) = 0, 'stranger athlete B sees no foreign notifications');
select _ok((select count(*) from athlete_profiles where athlete_id = 'aaaaaaaa-0000-0000-0000-000000000001') = 0,
           'stranger athlete B cannot read A''s athlete profile (weight/age)');
select _ok((select count(*) from messages) = 0, 'stranger athlete B reads no foreign messages');
select _ok((select count(*) from guardianships) = 0, 'stranger athlete B sees no guardianship links');

-- ================================================================ 3. STRANGER WRITE / ESCALATION DENIED
select _ok(_try($q$insert into meals (athlete_id, day_date, name) values ('aaaaaaaa-0000-0000-0000-000000000001', current_date, 'planted')$q$) <> 'ok',
           'B cannot insert a meal AS athlete A');
-- an RLS-filtered UPDATE silently matches 0 rows; verify from superuser that nothing changed
select _try($q$update profiles set full_name = 'pwned' where id = 'aaaaaaaa-0000-0000-0000-000000000001'$q$);
select _superuser();
select _ok((select full_name from profiles where id = 'aaaaaaaa-0000-0000-0000-000000000001') = 'Athlete A',
           'B cannot change A''s profile name (0 rows updated)');
select _as('bbbbbbbb-0000-0000-0000-000000000002');
select _ok(_try($q$insert into team_staff (team_id, staff_id, role, status) values ('77777777-1111-0000-0000-000000000001','bbbbbbbb-0000-0000-0000-000000000002','head_coach','active')$q$) <> 'ok',
           'B cannot appoint himself staff of A''s team');
select _ok(_try($q$insert into meal_comments (meal_id, athlete_id, author_id, role, text) values ('e0000000-0000-0000-0000-00000000000a','aaaaaaaa-0000-0000-0000-000000000001','bbbbbbbb-0000-0000-0000-000000000002','coach','fake coach')$q$) <> 'ok',
           'B cannot comment on A''s meal as a fake coach');
select _ok(_try($q$insert into meal_comments (meal_id, athlete_id, author_id, role, text) values ('e0000000-0000-0000-0000-00000000000b','bbbbbbbb-0000-0000-0000-000000000002','bbbbbbbb-0000-0000-0000-000000000002','ai','fake ai')$q$) <> 'ok',
           'client cannot insert an AI-role comment');
select _ok(_try($q$insert into trust_passes (athlete_id, granted_by) values ('bbbbbbbb-0000-0000-0000-000000000002','bbbbbbbb-0000-0000-0000-000000000002')$q$) <> 'ok',
           'B cannot self-grant a trust pass by direct insert');
select _ok(_try($q$select grant_trust_pass('bbbbbbbb-0000-0000-0000-000000000002'::uuid)$q$) <> 'ok',
           'B cannot self-grant a trust pass via the RPC');
select _ok(_try($q$insert into org_memberships (organization_id, member_id, role, scope_kind, scope_id) select organization_id, 'bbbbbbbb-0000-0000-0000-000000000002', 'admin', scope_kind, scope_id from org_memberships limit 1$q$) <> 'ok',
           'B cannot insert himself as an org admin');
select _try($q$delete from meal_comments where author_id <> 'bbbbbbbb-0000-0000-0000-000000000002'$q$);
select _superuser();
select _ok((select count(*) from meal_comments) = 1,
           'B cannot delete someone else''s comment (0 rows)');

-- ================================================================ 4. COACH SCOPE
select _as('11111111-0000-0000-0000-000000000001');  -- coach_1 (A's coach)
select _ok((select count(*) from meals where athlete_id = 'aaaaaaaa-0000-0000-0000-000000000001') >= 1,
           'coach_1 CAN read his athlete A''s meals');
select _ok((select count(*) from trust_passes where athlete_id = 'aaaaaaaa-0000-0000-0000-000000000001') = 1,
           'coach_1 CAN read A''s trust pass');
select _ok((select count(*) from meals where athlete_id = 'bbbbbbbb-0000-0000-0000-000000000002') = 0,
           'coach_1 CANNOT read stranger athlete B''s meals');
select _ok(_try($q$insert into meal_comments (meal_id, athlete_id, author_id, role, text) values ('e0000000-0000-0000-0000-00000000000a','aaaaaaaa-0000-0000-0000-000000000001','11111111-0000-0000-0000-000000000001','coach','locked in')$q$) = 'ok',
           'coach_1 CAN comment on his athlete''s meal');
select _ok(_try($q$insert into meal_comments (meal_id, athlete_id, author_id, role, text) values ('e0000000-0000-0000-0000-00000000000b','bbbbbbbb-0000-0000-0000-000000000002','11111111-0000-0000-0000-000000000001','coach','drive-by')$q$) <> 'ok',
           'coach_1 CANNOT comment on stranger B''s meal');

select _as('22222222-0000-0000-0000-000000000002');  -- coach_2 (stranger coach)
select _ok((select count(*) from meals where athlete_id in ('aaaaaaaa-0000-0000-0000-000000000001','dddddddd-0000-0000-0000-000000000004')) = 0,
           'stranger coach_2 sees none of A''s or minor M''s meals');
select _ok((select count(*) from trust_passes) = 0, 'stranger coach_2 sees no foreign trust passes');
select _ok((select count(*) from checkins) = 0, 'stranger coach_2 sees no foreign checkins');
select _ok(_try($q$select grant_trust_pass('aaaaaaaa-0000-0000-0000-000000000001'::uuid)$q$) <> 'ok',
           'stranger coach_2 cannot grant a trust pass to A');
select _ok(_try($q$select coach_set_goals('aaaaaaaa-0000-0000-0000-000000000001'::uuid, '{}'::jsonb)$q$) <> 'ok',
           'stranger coach_2 cannot set A''s goals (RPC guard)');
select _ok(_try($q$select team_roster('77777777-1111-0000-0000-000000000001'::uuid)$q$) <> 'ok',
           'stranger coach_2 cannot pull T1''s roster');

-- scope model (INTENDED, per 0034: team staff get GROUP scope; org admins get ORG scope):
-- a team coach is confined to their team; an org-scoped admin sees the whole org, but not other orgs.
select _as('11111111-0000-0000-0000-000000000001');
select _ok((select count(*) from meals where athlete_id = 'cccccccc-0000-0000-0000-000000000003') = 0,
           'coach_1 (group-scoped, team T1) cannot read athlete C on sibling team T1B of the same org');
select _as('55555555-0000-0000-0000-000000000005');  -- org-scoped admin of O1
select _ok((select count(*) from meals where athlete_id = 'aaaaaaaa-0000-0000-0000-000000000001') >= 1,
           'org admin CAN read athlete A on team T1 (org-scoped visibility)');
select _ok(can_view('cccccccc-0000-0000-0000-000000000003'),
           'org admin CAN see athlete C on sibling team T1B (org scope spans all teams)');
select _ok((select count(*) from meals where athlete_id = 'bbbbbbbb-0000-0000-0000-000000000002') = 0,
           'org admin of O1 CANNOT read athlete B in a DIFFERENT org (O2)');

-- ================================================================ 5. PARENT / GUARDIAN SCOPE
select _as('33333333-0000-0000-0000-000000000003');
select _ok((select count(*) from meals where athlete_id = 'dddddddd-0000-0000-0000-000000000004') = 1,
           'parent P CAN read their minor''s meals');
select _ok((select count(*) from meals where athlete_id = 'aaaaaaaa-0000-0000-0000-000000000001') = 0,
           'parent P CANNOT read unrelated athlete A''s meals');
select _ok((select count(*) from checkins where athlete_id = 'dddddddd-0000-0000-0000-000000000004') = 1,
           'parent P CAN read their minor''s checkin');

-- ================================================================ 6. TRAINER SCOPE
select _as('44444444-0000-0000-0000-000000000004');
select _ok((select count(*) from meals where athlete_id = 'aaaaaaaa-0000-0000-0000-000000000001') >= 1,
           'trainer T CAN read client A''s meals');
select _ok((select count(*) from meals where athlete_id = 'dddddddd-0000-0000-0000-000000000004') = 0,
           'trainer T CANNOT read non-client minor M''s meals');
select _ok(_try($q$select practice_roster('88888888-0000-0000-0000-000000000001'::uuid)$q$) = 'ok',
           'trainer T can pull their own practice roster');

-- ================================================================ 7. MINOR MESSAGING GATE
select _as('99999999-0000-0000-0000-000000000009');  -- rando adult with a seeded thread to the minor
select _ok(_try($q$insert into messages (thread_id, sender_id, text) values ('f0000000-0000-0000-0000-000000000002','99999999-0000-0000-0000-000000000009','hey kid')$q$) <> 'ok',
           'unlinked adult CANNOT message a minor even with a thread row');
select _as('11111111-0000-0000-0000-000000000001');
select _ok(_try($q$insert into messages (thread_id, sender_id, text) values ('f0000000-0000-0000-0000-000000000003','11111111-0000-0000-0000-000000000001','great week')$q$) = 'ok',
           'the minor''s own coach CAN message them');

-- ================================================================ 7b. STORAGE: MEAL PHOTOS
-- read: owner + can_view links; write/update/delete: owner-only (their own <uid>/ folder).
select _as('aaaaaaaa-0000-0000-0000-000000000001');
select _ok((select count(*) from storage.objects where bucket_id='meal-photos' and name like 'aaaaaaaa%') = 1,
           'athlete A can read their own meal photo');
select _ok(_try($q$insert into storage.objects (bucket_id, name) values ('meal-photos','aaaaaaaa-0000-0000-0000-000000000001/2026-07-09/new.jpg')$q$) = 'ok',
           'athlete A can upload into their own folder');
select _ok(_try($q$insert into storage.objects (bucket_id, name) values ('meal-photos','bbbbbbbb-0000-0000-0000-000000000002/2026-07-09/planted.jpg')$q$) <> 'ok',
           'athlete A CANNOT upload into athlete B''s folder');

select _as('bbbbbbbb-0000-0000-0000-000000000002');
select _ok((select count(*) from storage.objects where name like 'aaaaaaaa%') = 0,
           'stranger athlete B CANNOT read A''s meal photos');
select _ok(_try($q$insert into storage.objects (bucket_id, name) values ('meal-photos','aaaaaaaa-0000-0000-0000-000000000001/2026-07-09/planted.jpg')$q$) <> 'ok',
           'stranger athlete B CANNOT upload into A''s folder');

select _as('11111111-0000-0000-0000-000000000001');  -- A's coach
select _ok((select count(*) from storage.objects where name like 'aaaaaaaa%') >= 1,
           'coach_1 CAN read his athlete A''s meal photo');
select _ok(_try($q$insert into storage.objects (bucket_id, name) values ('meal-photos','aaaaaaaa-0000-0000-0000-000000000001/2026-07-09/coach.jpg')$q$) <> 'ok',
           'coach_1 CANNOT upload into A''s folder (read-only on athlete photos)');
select _try($q$delete from storage.objects where name like 'aaaaaaaa%'$q$);
select _superuser();
select _ok((select count(*) from storage.objects where name like 'aaaaaaaa%') >= 1,
           'coach_1 CANNOT delete A''s meal photo (owner-only delete)');

select _as('22222222-0000-0000-0000-000000000002');  -- stranger coach
select _ok((select count(*) from storage.objects where name like 'aaaaaaaa%') = 0,
           'stranger coach_2 CANNOT read A''s meal photos');

select _as('33333333-0000-0000-0000-000000000003');  -- parent of minor M
select _ok((select count(*) from storage.objects where name like 'dddddddd%') = 1,
           'parent P CAN read their minor''s meal photo');
select _ok((select count(*) from storage.objects where name like 'aaaaaaaa%') = 0,
           'parent P CANNOT read unrelated athlete A''s meal photo');

select _as('44444444-0000-0000-0000-000000000004');  -- trainer of A
select _ok((select count(*) from storage.objects where name like 'aaaaaaaa%') >= 1,
           'trainer T CAN read client A''s meal photo');
select _ok((select count(*) from storage.objects where name like 'dddddddd%') = 0,
           'trainer T CANNOT read non-client minor M''s meal photo');

-- ================================================================ 0049: meal comment kinds
-- Placed here (before section 8's revocation) rather than after the 0048 section below: section 8
-- flips coach_1's link to athlete A to 'removed' (team_members, mirrored into org_memberships by
-- the 0034 sync trigger), so a "linked coach" assertion run after that point would fail for a
-- reason unrelated to what's under test here. Reuses the meal already seeded for A above
-- (e0000000-0000-0000-0000-00000000000a) instead of inserting a new one.
select _as('11111111-0000-0000-0000-000000000001');  -- coach_1 (A's coach, still linked at this point)
select _ok(_try($q$insert into meal_comments (meal_id, athlete_id, author_id, role, text, kind)
                 values ('e0000000-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-000000000001',
                         '11111111-0000-0000-0000-000000000001', 'coach', '🔥', 'reaction')$q$) = 'ok',
           '0049: linked coach posts an emoji reaction');
select _as('aaaaaaaa-0000-0000-0000-000000000001');
select _ok(_try($q$insert into meal_comments (meal_id, athlete_id, author_id, role, text)
                 values ('e0000000-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-000000000001',
                         'aaaaaaaa-0000-0000-0000-000000000001', 'ai', 'fake ai message')$q$) <> 'ok',
           '0049: athlete still cannot forge an ai row (0046 boundary holds)');
select _ok(_try($q$insert into meal_comments (meal_id, athlete_id, author_id, role, text, kind)
                 values ('e0000000-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-000000000001',
                         'aaaaaaaa-0000-0000-0000-000000000001', 'athlete', 'hi', 'invalid-kind')$q$) <> 'ok',
           '0049: kind is constrained to message|reaction');

-- ================================================================ 8. REVOCATION CUTS ACCESS *NOW*
select _superuser();
update team_members set status = 'removed'
  where team_id = '77777777-1111-0000-0000-000000000001' and athlete_id = 'aaaaaaaa-0000-0000-0000-000000000001';
select _as('11111111-0000-0000-0000-000000000001');
select _ok((select count(*) from meals where athlete_id = 'aaaaaaaa-0000-0000-0000-000000000001') = 0,
           'REVOKED: after A leaves the team, coach_1 loses A''s meals immediately');
select _ok((select count(*) from trust_passes where athlete_id = 'aaaaaaaa-0000-0000-0000-000000000001') = 0,
           'REVOKED: after A leaves the team, coach_1 loses A''s trust passes');
select _ok((select count(*) from storage.objects where name like 'aaaaaaaa%') = 0,
           'REVOKED: after A leaves the team, coach_1 loses A''s meal photos');

select _superuser();
update practice_clients set status = 'removed' where client_id = 'aaaaaaaa-0000-0000-0000-000000000001';
select _as('44444444-0000-0000-0000-000000000004');
select _ok((select count(*) from meals where athlete_id = 'aaaaaaaa-0000-0000-0000-000000000001') = 0,
           'REVOKED: after client leaves the practice, trainer loses their meals');

select _superuser();
update guardianships set status = 'removed' where guardian_id = '33333333-0000-0000-0000-000000000003';
select _as('33333333-0000-0000-0000-000000000003');
select _ok((select count(*) from meals where athlete_id = 'dddddddd-0000-0000-0000-000000000004') = 0,
           'REVOKED: ended guardianship cuts the parent''s access to the minor');

-- ================================================================ 9. NO / BROKEN TOKEN
select _as(null);  -- authenticated role but auth.uid() is NULL (broken/expired token)
select _ok((select count(*) from meals) = 0, 'authenticated with no uid sees nothing');

-- ================================================================ 0048: onboarding columns
select _as('aaaaaaaa-0000-0000-0000-000000000001');
select _ok(_try($$update profiles set tos_accepted_at = now(), tos_version = '2026-07-09', committed_at = now()
                 where id = 'aaaaaaaa-0000-0000-0000-000000000001'$$) = 'ok',
           '0048: athlete records own ToS acceptance + commitment');
-- (adult dob on purpose: a minor dob here would make A a provable minor and trip the 0050
-- consent gates in any later probe that touches A's data — this probe only tests self-write)
select _ok(_try($$update athlete_profiles set dob = '1990-01-15', standard = '{"mealsPerDay":3}'::jsonb
                 where athlete_id = 'aaaaaaaa-0000-0000-0000-000000000001'$$) = 'ok',
           '0048: athlete writes own dob + standard knobs');
-- cross-writes: RLS silently matches zero rows — assert the value did not change
select _try($$update profiles set tos_version = 'evil' where id = 'bbbbbbbb-0000-0000-0000-000000000002'$$);
select _try($$update athlete_profiles set dob = '1990-01-01' where athlete_id = 'bbbbbbbb-0000-0000-0000-000000000002'$$);
select _superuser();
select _ok((select tos_version is distinct from 'evil' from profiles
            where id = 'bbbbbbbb-0000-0000-0000-000000000002'),
           '0048: stranger cannot stamp another profile''s ToS fields');
select _ok((select dob is distinct from '1990-01-01'::date from athlete_profiles
            where athlete_id = 'bbbbbbbb-0000-0000-0000-000000000002'),
           '0048: stranger cannot set another athlete''s dob');

-- ================================================================ 10. MINOR CONSENT ENFORCEMENT (0050)
-- Minor N: 16 years old via dob only (no base_age — exercises the dob branch of
-- is_provable_minor), ACTIVE member of coach_1's team T1, NO verified consent yet.
select _superuser();
insert into auth.users (id, email) values ('eeeeeeee-0000-0000-0000-000000000006','n@x.io');
insert into profiles (id, full_name, email, primary_role) values
  ('eeeeeeee-0000-0000-0000-000000000006','Minor N','n@x.io','athlete')
  on conflict (id) do update set full_name = excluded.full_name, email = excluded.email, primary_role = excluded.primary_role;
insert into athlete_profiles (athlete_id, sport, dob) values
  ('eeeeeeee-0000-0000-0000-000000000006','football',(current_date - interval '16 years')::date);
insert into team_members (team_id, athlete_id, status) values
  ('77777777-1111-0000-0000-000000000001','eeeeeeee-0000-0000-0000-000000000006','active');

-- WRITE-BLOCK: the unconsented minor's sync writes are rejected server-side.
select _as('eeeeeeee-0000-0000-0000-000000000006');
select _ok(_try($q$insert into days (athlete_id, date, score) values ('eeeeeeee-0000-0000-0000-000000000006', current_date, 80)$q$) <> 'ok',
           '0050: unconsented minor CANNOT sync a day row');
select _ok(_try($q$insert into meals (athlete_id, day_date, name) values ('eeeeeeee-0000-0000-0000-000000000006', current_date, 'N lunch')$q$) <> 'ok',
           '0050: unconsented minor CANNOT sync a meal row');
select _ok(_try($q$insert into storage.objects (bucket_id, name) values ('meal-photos','eeeeeeee-0000-0000-0000-000000000006/2026-07-11/n.jpg')$q$) <> 'ok',
           '0050: unconsented minor CANNOT upload a meal photo');

-- READ-BLOCK covers LEGACY rows (simulate pre-0050 data: superuser insert with the trigger
-- disabled): the ACTIVE linked coach sees nothing; the minor still sees their own data.
select _superuser();
alter table days disable trigger trg_minor_consent_days;
insert into days (athlete_id, date, score) values ('eeeeeeee-0000-0000-0000-000000000006', current_date - 1, 70);
alter table days enable trigger trg_minor_consent_days;
select _as('11111111-0000-0000-0000-000000000001');  -- coach_1: N's active team coach
select _ok(not can_view('eeeeeeee-0000-0000-0000-000000000006'),
           '0050: linked coach can_view = false for an unconsented minor');
select _ok((select count(*) from days where athlete_id = 'eeeeeeee-0000-0000-0000-000000000006') = 0,
           '0050: linked coach reads NONE of an unconsented minor''s legacy days');
select _as('eeeeeeee-0000-0000-0000-000000000006');
select _ok((select count(*) from days where athlete_id = 'eeeeeeee-0000-0000-0000-000000000006') = 1,
           '0050: the minor still reads their OWN data (self-access is never gated)');

-- VERIFIED CONSENT flips both gates open.
select _superuser();
insert into guardian_consent_requests (athlete_id, guardian_email, status, verified_at) values
  ('eeeeeeee-0000-0000-0000-000000000006','guardian-n@x.io','verified', now());
select _as('eeeeeeee-0000-0000-0000-000000000006');
select _ok(_try($q$insert into meals (athlete_id, day_date, name) values ('eeeeeeee-0000-0000-0000-000000000006', current_date, 'N lunch')$q$) = 'ok',
           '0050: verified consent unlocks the minor''s meal sync');
select _ok(_try($q$insert into storage.objects (bucket_id, name) values ('meal-photos','eeeeeeee-0000-0000-0000-000000000006/2026-07-11/n.jpg')$q$) = 'ok',
           '0050: verified consent unlocks the minor''s photo upload');
select _as('11111111-0000-0000-0000-000000000001');
select _ok(can_view('eeeeeeee-0000-0000-0000-000000000006'),
           '0050: verified consent restores the linked coach''s visibility');
select _ok((select count(*) from days where athlete_id = 'eeeeeeee-0000-0000-0000-000000000006') >= 1,
           '0050: linked coach reads the consented minor''s days');

-- THE AGE RULING HOLDS: unknown age (no base_age, no dob — every pre-0048 adult) is treated
-- as ADULT for sync. This is the probe that guarantees 0050 can't sever the live beta.
select _superuser();
insert into athlete_profiles (athlete_id, sport) values ('99999999-0000-0000-0000-000000000009','football');
select _as('99999999-0000-0000-0000-000000000009');
select _ok(_try($q$insert into days (athlete_id, date, score) values ('99999999-0000-0000-0000-000000000009', current_date, 75)$q$) = 'ok',
           '0050: unknown-age profile (pre-dob-era adult) is NOT blocked from syncing');

-- ================================================================ scoreboard
select _superuser();
do $$
declare fails int; total int;
begin
  select count(*) filter (where not ok), count(*) into fails, total from _rls_results;
  raise notice '================================================';
  raise notice 'RLS AUTHZ AUDIT: % / % checks passed', total - fails, total;
  if fails > 0 then
    raise notice 'FAILED CHECKS:';
    for total in select n from _rls_results where not ok loop
      raise notice '  - %', (select label from _rls_results where n = total);
    end loop;
    raise exception 'RLS AUTHZ AUDIT FAILED: % hole(s) — see the FAIL lines above', fails;
  end if;
  raise notice 'ALL GREEN — every boundary held.';
end $$;

rollback;
