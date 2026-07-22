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

-- become an actor whose password `amr` timestamp is p_age seconds ago — for step-up reauth tests
create or replace function _as_amr(p_uid uuid, p_age int) returns void
language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claim.sub', p_uid::text, false);
  perform set_config('request.jwt.claims', json_build_object(
    'sub', p_uid, 'role', 'authenticated', 'session_id', '11111111-1111-1111-1111-111111111111',
    'amr', json_build_array(json_build_object('method','password','timestamp',(extract(epoch from now())::bigint - p_age)))
  )::text, false);
  execute 'set role authenticated';
end $$;
grant execute on function _as_amr(uuid, int) to authenticated, anon;

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

-- ================================================================ 3b. LINK / PLAN SELF-GRANT DENIED (0053)
-- guardianships (audit 2026-07-12 CRITICAL): before 0053, `g_manage FOR ALL` let any user name
-- themselves guardian of any athlete — reading an adult's data AND opening a messaging channel to a
-- minor. 0053 removes the self-insert (creation is service_role/RPC only).
select _as('bbbbbbbb-0000-0000-0000-000000000002');  -- stranger B
select _ok(_try($q$insert into guardianships (athlete_id, guardian_id, status) values ('aaaaaaaa-0000-0000-0000-000000000001','bbbbbbbb-0000-0000-0000-000000000002','active')$q$) <> 'ok',
           '0053: B cannot self-appoint as guardian of adult A');
select _ok(_try($q$insert into guardianships (athlete_id, guardian_id, status) values ('dddddddd-0000-0000-0000-000000000004','bbbbbbbb-0000-0000-0000-000000000002','active')$q$) <> 'ok',
           '0053: B cannot self-appoint as guardian of minor M (child-safety)');
select _ok((select count(*) from guardianships where guardian_id = 'bbbbbbbb-0000-0000-0000-000000000002') = 0,
           '0053: no guardianship row was created by B (messaging-gate bypass stays shut)');

-- plan_assignments (audit 2026-07-12 HIGH): before 0053, WITH CHECK only proved assigned_by=self, so
-- a user could self-assign another author's plan (then read its plan_json) or dump a plan on a
-- stranger. 0053 requires the caller to OWN the plan AND can_view the athlete. Seed a plan owned by
-- coach_1 (as superuser) first.
select _superuser();
insert into meal_plans (id, author_id, name) values
  ('a1a1a1a1-0000-0000-0000-000000000001','11111111-0000-0000-0000-000000000001','Coach1 Plan');
select _as('bbbbbbbb-0000-0000-0000-000000000002');  -- stranger B
select _ok(_try($q$insert into plan_assignments (plan_id, athlete_id, assigned_by, status) values ('a1a1a1a1-0000-0000-0000-000000000001','bbbbbbbb-0000-0000-0000-000000000002','bbbbbbbb-0000-0000-0000-000000000002','active')$q$) <> 'ok',
           '0053: B cannot self-assign coach_1''s plan');
select _ok((select count(*) from meal_plans where id = 'a1a1a1a1-0000-0000-0000-000000000001') = 0,
           '0053: with no valid assignment, B cannot read coach_1''s plan');
-- the legitimate flow still works: the plan author assigns it to an athlete they coach.
select _as('11111111-0000-0000-0000-000000000001');  -- coach_1 owns the plan AND coaches A
select _ok(_try($q$insert into plan_assignments (plan_id, athlete_id, assigned_by, status) values ('a1a1a1a1-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000001','11111111-0000-0000-0000-000000000001','active')$q$) = 'ok',
           '0053: the plan author CAN assign their own plan to an athlete they coach');

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

-- ================================================================ 5. PARENT / GUARDIAN SCOPE (0081)
-- 0081 (founder security spec 2026-07-18): a guardian now gets NO direct table access —
-- is_guardian_of was removed from can_view(). A guardian reads ONLY score/grade/day through the
-- guardian_* RPCs; meals, meal photos, weight, and check-ins are closed. (Was: guardian == coach.)
select _as('33333333-0000-0000-0000-000000000003');
select _ok((select count(*) from meals where athlete_id = 'dddddddd-0000-0000-0000-000000000004') = 0,
           '0081: parent P CANNOT read their minor''s meals directly (meal photos live here)');
select _ok((select count(*) from days where athlete_id = 'dddddddd-0000-0000-0000-000000000004') = 0,
           '0081: parent P CANNOT read the days row directly (current_weight lives here)');
select _ok((select count(*) from guardian_children() where athlete_id = 'dddddddd-0000-0000-0000-000000000004') = 1,
           '0081: parent P sees their minor ONLY via guardian_children() (scores, not photos/weight)');
select _ok((select count(*) from meals where athlete_id = 'aaaaaaaa-0000-0000-0000-000000000001') = 0,
           'parent P CANNOT read unrelated athlete A''s meals');
select _ok((select count(*) from checkins where athlete_id = 'dddddddd-0000-0000-0000-000000000004') = 0,
           '0081: parent P CANNOT read their minor''s checkin directly (weight/notes live here)');

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
select _ok((select count(*) from storage.objects where name like 'dddddddd%') = 0,
           '0081: parent P CANNOT read their minor''s meal photo (closed — guardians see scores only)');
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

-- ================================================================ COACH OS SLICE C: announcements
-- Placed here (before section 8's revocation): post_announcement's team-scope fan-out reads
-- team_members WHERE status = 'active', and section 8 flips athlete A's T1 membership to
-- 'removed' — an assertion that A gets notified must run before that revocation.
-- Seed positions on T1's roster so the position-scope probe (below) has something to match.
select _superuser();
update team_members set position = 'QB'
  where team_id = '77777777-1111-0000-0000-000000000001' and athlete_id = 'aaaaaaaa-0000-0000-0000-000000000001';
update team_members set position = 'WR'
  where team_id = '77777777-1111-0000-0000-000000000001' and athlete_id = 'dddddddd-0000-0000-0000-000000000004';

insert into announcements (id, team_id, author_id, scope_kind, title, body) values
  ('a0000000-0000-0000-0000-000000000001','77777777-1111-0000-0000-000000000001',
   '11111111-0000-0000-0000-000000000001','team','Practice moved','Practice starts at 6am tomorrow.');

select _as('11111111-0000-0000-0000-000000000001');  -- coach_1, staff of T1
select _ok((select count(*) from announcements) = 1, 'coach_1 (T1 staff) can read T1''s announcement');

select _as('aaaaaaaa-0000-0000-0000-000000000001');  -- athlete A, non-staff member of T1
select _ok((select count(*) from announcements) = 0, 'non-staff athlete A cannot read T1''s announcement');

select _as('22222222-0000-0000-0000-000000000002');  -- coach_2, staff of a DIFFERENT team (T2)
select _ok((select count(*) from announcements) = 0, 'coach_2 (staff of a different team) cannot read T1''s announcement');

-- direct insert is RPC-only: no insert policy exists on announcements at all.
select _as('11111111-0000-0000-0000-000000000001');
select _ok(_try($q$insert into announcements (team_id, author_id, scope_kind, title, body)
                 values ('77777777-1111-0000-0000-000000000001','11111111-0000-0000-0000-000000000001','team','Direct insert','Should fail')$q$) <> 'ok',
           'direct insert into announcements FAILS — writes must go through post_announcement');

-- post_announcement: team scope fans out to every active member and notifies each.
select _superuser();
delete from notifications where user_id in ('aaaaaaaa-0000-0000-0000-000000000001','dddddddd-0000-0000-0000-000000000004');
select _as('11111111-0000-0000-0000-000000000001');
select post_announcement('77777777-1111-0000-0000-000000000001','team',null,'Team meeting','Meet at the field house at 7am.');
-- notifications are owner-read (notif_read: user_id = auth.uid()); coach_1 cannot see the
-- athletes' feed rows under RLS. Verify the fan-out from superuser (same idiom as the
-- profile-name check in section 3).
select _superuser();
select _ok((select count(*) from notifications where user_id = 'aaaaaaaa-0000-0000-0000-000000000001' and kind = 'announcement') = 1,
           'post_announcement (team scope) notifies athlete A');
select _ok((select count(*) from notifications where user_id = 'dddddddd-0000-0000-0000-000000000004' and kind = 'announcement') = 1,
           'post_announcement (team scope) notifies minor M');

-- as an athlete (non-staff), the RPC raises 'not team staff'.
select _as('aaaaaaaa-0000-0000-0000-000000000001');
select _ok(_try($q$select post_announcement('77777777-1111-0000-0000-000000000001','team',null,'Fake','Not staff')$q$) like '%not team staff%',
           'athlete A cannot post_announcement — RPC raises not team staff');

-- position scope: only the matching position gets notified.
select _superuser();
delete from notifications where user_id in ('aaaaaaaa-0000-0000-0000-000000000001','dddddddd-0000-0000-0000-000000000004') and kind = 'announcement';
select _as('11111111-0000-0000-0000-000000000001');
select post_announcement('77777777-1111-0000-0000-000000000001','position','QB','QB meeting','Film room, 8am.');
select _superuser();  -- owner-read notifications: verify the fan-out from superuser
select _ok((select count(*) from notifications where user_id = 'aaaaaaaa-0000-0000-0000-000000000001' and kind = 'announcement') = 1,
           'post_announcement (position=QB) notifies the QB (athlete A)');
select _ok((select count(*) from notifications where user_id = 'dddddddd-0000-0000-0000-000000000004' and kind = 'announcement') = 0,
           'post_announcement (position=QB) does NOT notify the WR (minor M)');

-- ================================================================ COACH OS SLICE C: requirement_templates
select _as('11111111-0000-0000-0000-000000000001');  -- coach_1, staff of T1
select _ok(_try($q$insert into requirement_templates (id, team_id, name, kind, items) values
  ('b0000000-0000-0000-0000-000000000001','77777777-1111-0000-0000-000000000001','Game Week','game_week',
   '[{"id":"m1","title":"Breakfast","kind":"meal","proof":"photo"},{"id":"l1","title":"Lift","kind":"lift","proof":"check"}]'::jsonb)$q$) = 'ok',
           'coach_1 CAN insert a requirement_template for T1');
select _ok(_try($q$update requirement_templates set name = 'Game Week (Away)' where id = 'b0000000-0000-0000-0000-000000000001'$q$) = 'ok',
           'coach_1 CAN update T1''s requirement_template');
select _ok((select count(*) from requirement_templates where id = 'b0000000-0000-0000-0000-000000000001') = 1,
           'coach_1 sees T1''s requirement_template');

select _as('22222222-0000-0000-0000-000000000002');  -- coach_2, staff of a DIFFERENT team (T2)
select _ok((select count(*) from requirement_templates) = 0, 'cross-team coach_2 cannot see T1''s requirement_templates');
select _ok(_try($q$update requirement_templates set name = 'pwned' where id = 'b0000000-0000-0000-0000-000000000001'$q$) = 'ok',
           'cross-team coach_2''s update statement runs (RLS silently matches 0 rows)');
select _superuser();
select _ok((select name from requirement_templates where id = 'b0000000-0000-0000-0000-000000000001') = 'Game Week (Away)',
           'cross-team coach_2 did not actually change T1''s requirement_template (0 rows updated)');
select _as('22222222-0000-0000-0000-000000000002');  -- back to coach_2: the insert/delete below must be RLS-enforced, not run as the superuser from the verify above
select _ok(_try($q$insert into requirement_templates (team_id, name, kind, items) values
  ('77777777-1111-0000-0000-000000000001','Sneaky','custom','[{"id":"m1","title":"Breakfast","kind":"meal","proof":"photo"}]'::jsonb)$q$) <> 'ok',
           'cross-team coach_2 cannot insert a requirement_template into T1');
select _ok(_try($q$delete from requirement_templates where id = 'b0000000-0000-0000-0000-000000000001'$q$) = 'ok',
           'cross-team coach_2''s delete statement runs (RLS silently matches 0 rows)');
select _superuser();
select _ok((select count(*) from requirement_templates where id = 'b0000000-0000-0000-0000-000000000001') = 1,
           'cross-team coach_2 did not actually delete T1''s requirement_template (0 rows deleted)');

select _as('aaaaaaaa-0000-0000-0000-000000000001');  -- athlete A, non-staff member of T1
select _ok((select count(*) from requirement_templates) = 0, 'non-staff athlete A cannot see T1''s requirement_templates');
select _ok(_try($q$insert into requirement_templates (team_id, name, kind, items) values
  ('77777777-1111-0000-0000-000000000001','Athlete Sneaky','custom','[{"id":"m1","title":"Breakfast","kind":"meal","proof":"photo"}]'::jsonb)$q$) <> 'ok',
           'non-staff athlete A cannot insert a requirement_template');
select _ok(_try($q$delete from requirement_templates where id = 'b0000000-0000-0000-0000-000000000001'$q$) = 'ok',
           'non-staff athlete A''s delete statement runs (RLS silently matches 0 rows)');
select _superuser();
select _ok((select count(*) from requirement_templates where id = 'b0000000-0000-0000-0000-000000000001') = 1,
           'non-staff athlete A did not actually delete T1''s requirement_template (0 rows deleted)');

select _as('11111111-0000-0000-0000-000000000001');  -- coach_1, staff of T1 — the legitimate delete
select _ok(_try($q$delete from requirement_templates where id = 'b0000000-0000-0000-0000-000000000001'$q$) = 'ok',
           'coach_1 CAN delete T1''s own requirement_template');
select _superuser();
select _ok((select count(*) from requirement_templates where id = 'b0000000-0000-0000-0000-000000000001') = 0,
           'coach_1''s delete actually removed the row');

-- item-window rail: an out-of-range window.due (>1439) fails the check constraint.
select _as('11111111-0000-0000-0000-000000000001');
select _ok(_try($q$insert into requirement_templates (team_id, name, kind, items) values
  ('77777777-1111-0000-0000-000000000001','Bad Window','custom',
   '[{"id":"m1","title":"Breakfast","kind":"meal","proof":"photo","window":{"due":2000}}]'::jsonb)$q$) <> 'ok',
           'requirement_template insert with window.due=2000 FAILS the items-valid check');

-- ================================================================ COACH OS SLICE E: team analytics RPCs (0076)
-- Placed here (before section 8's revocation): the rollup/outcomes join team_members WHERE
-- status='active', and section 8 flips athlete A's T1 membership to 'removed' — an "authorized coach
-- gets A's rows" assertion must run before that revocation (the Slice C lesson). All windows are
-- built from current_date IN THE TEST (the function's no-current_date/now() rule constrains the
-- MIGRATION body, not these param values). Seeded rows are cleaned by the suite's final rollback.
select _superuser();
-- A day whose checkin JSON marks it submitted, 10 days back so A's checkins-table row (submitted_at
-- ~ current_date) is OUTSIDE its [day-6,day] window — this isolates the days.checkin source.
insert into days (athlete_id, date, score, checkin) values
  ('aaaaaaaa-0000-0000-0000-000000000001', current_date - 10, 88, '{"submitted":"2026-07-07T12:00:00Z"}'::jsonb);
-- An intervention on A (day = current_date - 20) with days bracketing it: one in the before window
-- [day-7,day-1] and one in the after window [day+1,day+7], to exercise the outcome averages.
insert into coach_interventions (id, team_id, athlete_id, coach_id, kind, tier, day) values
  ('c1000000-0000-0000-0000-000000000001','77777777-1111-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-000000000001','11111111-0000-0000-0000-000000000001','nudge','below', current_date - 20);
insert into days (athlete_id, date, score) values
  ('aaaaaaaa-0000-0000-0000-000000000001', current_date - 22, 70),   -- in [day-7, day-1]
  ('aaaaaaaa-0000-0000-0000-000000000001', current_date - 18, 90);   -- in [day+1, day+7]

-- 1. authorized staff gets rows, scoped to T1 members only (A and M — never stranger B).
select _as('11111111-0000-0000-0000-000000000001');  -- coach_1, staff of T1
select _ok((select count(*) from team_day_rollup(
             '77777777-1111-0000-0000-000000000001', current_date - 30, current_date)) >= 1,
           'slice E: coach_1 (T1 staff) gets rollup rows for T1');
select _ok((select count(*) from team_day_rollup(
             '77777777-1111-0000-0000-000000000001', current_date - 30, current_date)
            where athlete_id not in ('aaaaaaaa-0000-0000-0000-000000000001','dddddddd-0000-0000-0000-000000000004')) = 0,
           'slice E: rollup returns only active T1 members, never stranger B');

-- 2. cross-team coach raises 'not authorized'.
select _as('22222222-0000-0000-0000-000000000002');  -- coach_2, staff of T2 only
select _ok(_try($q$select team_day_rollup('77777777-1111-0000-0000-000000000001', current_date - 7, current_date)$q$)
             like '%not authorized%',
           'slice E: cross-team coach_2 cannot pull T1''s rollup (gate raises)');

-- 3. an athlete (not team staff) raises.
select _as('aaaaaaaa-0000-0000-0000-000000000001');  -- athlete A, a T1 member but not staff
select _ok(_try($q$select team_day_rollup('77777777-1111-0000-0000-000000000001', current_date - 7, current_date)$q$)
             like '%not authorized%',
           'slice E: athlete A (not staff) cannot pull the rollup');

-- 4. window guard: a >62-day window raises.
select _as('11111111-0000-0000-0000-000000000001');
select _ok(_try($q$select team_day_rollup('77777777-1111-0000-0000-000000000001', current_date - 90, current_date)$q$)
             like '%0-62 days%',
           'slice E: a >62-day rollup window is rejected');

-- 5. outcomes: authorized staff gets rows with correct before/after averages; cross-team raises.
select _ok((select count(*) from team_intervention_outcomes(
             '77777777-1111-0000-0000-000000000001', current_date - 60)) >= 1,
           'slice E: coach_1 gets intervention outcomes for T1');
-- NOTE: the 0041 evidence-ceiling trigger clamps seeded scores (these bare rows carry no
-- meals/checkin evidence), so assert the RPC's averages against the ACTUALLY-STORED scores
-- rather than the raw seeded literals — this still proves the windowing (exactly one day per
-- side) and the averaging, without assuming what the trigger stored.
select _ok((select o.score_before = (select d.score::numeric from days d
              where d.athlete_id = 'aaaaaaaa-0000-0000-0000-000000000001' and d.date = current_date - 22)
        and o.score_after = (select d.score::numeric from days d
              where d.athlete_id = 'aaaaaaaa-0000-0000-0000-000000000001' and d.date = current_date - 18)
        and o.days_before = 1 and o.days_after = 1
             from team_intervention_outcomes('77777777-1111-0000-0000-000000000001', current_date - 60) o
             where o.intervention_id = 'c1000000-0000-0000-0000-000000000001'),
           'slice E: outcomes compute before/after averages from the bracketing days');
select _as('22222222-0000-0000-0000-000000000002');  -- cross-team coach_2
select _ok(_try($q$select team_intervention_outcomes('77777777-1111-0000-0000-000000000001', current_date - 60)$q$)
             like '%not authorized%',
           'slice E: cross-team coach_2 cannot pull T1''s intervention outcomes');

-- 6. checkin_done true from BOTH sources: the days.checkin JSON (isolated on the day-10 row) and
--    the checkins table (A's current_date day, matched by the [day-6,day] submitted_at window).
select _as('11111111-0000-0000-0000-000000000001');
select _ok((select checkin_done from team_day_rollup(
             '77777777-1111-0000-0000-000000000001', current_date - 30, current_date)
            where athlete_id = 'aaaaaaaa-0000-0000-0000-000000000001' and day = current_date - 10),
           'slice E: checkin_done is true from the day''s checkin JSON (submitted set)');
select _ok((select checkin_done from team_day_rollup(
             '77777777-1111-0000-0000-000000000001', current_date - 30, current_date)
            where athlete_id = 'aaaaaaaa-0000-0000-0000-000000000001' and day = current_date),
           'slice E: checkin_done is true from the checkins table (submitted within the week window)');

-- ================================================================ COACH OS SLICE F: scoped staff roles (0077/0078)
-- Placed before section 8 for the same reason as Slice E: these probes need athlete A's T1
-- membership still ACTIVE. New actors: coach_3 (position_coach scoped to the LB room) and
-- coach_r (readonly, whole team). A plays LB, minor M plays WR (M's guardian consent is
-- verified at seed, so any M-block below is proven to come from SCOPE, not consent).
select _superuser();
update team_members set position = 'LB'
  where team_id = '77777777-1111-0000-0000-000000000001' and athlete_id = 'aaaaaaaa-0000-0000-0000-000000000001';
update team_members set position = 'WR'
  where team_id = '77777777-1111-0000-0000-000000000001' and athlete_id = 'dddddddd-0000-0000-0000-000000000004';
insert into days (athlete_id, date, score) values
  ('dddddddd-0000-0000-0000-000000000004', current_date - 33, 60);
insert into auth.users (id, email) values
  ('66666666-0000-0000-0000-000000000006','c3@x.io'),
  ('10000000-0000-0000-0000-000000000010','cr@x.io');
insert into profiles (id, full_name, email, primary_role) values
  ('66666666-0000-0000-0000-000000000006','Coach Three','c3@x.io','coach'),
  ('10000000-0000-0000-0000-000000000010','Coach Readonly','cr@x.io','coach')
  on conflict (id) do update set full_name = excluded.full_name, email = excluded.email, primary_role = excluded.primary_role;
insert into team_staff (team_id, staff_id, role, status, scope_kind, scope_value) values
  ('77777777-1111-0000-0000-000000000001','66666666-0000-0000-0000-000000000006','position_coach','active','position','LB'),
  ('77777777-1111-0000-0000-000000000001','10000000-0000-0000-0000-000000000010','readonly','active',null,null);

-- 1. A position coach's world ends at their room: can_view + raw table reads + roster + rollup.
select _as('66666666-0000-0000-0000-000000000006');  -- coach_3, LB room only
select _ok(can_view('aaaaaaaa-0000-0000-0000-000000000001'),
           'slice F: LB coach can_view his LB athlete A');
select _ok(not can_view('dddddddd-0000-0000-0000-000000000004'),
           'slice F: LB coach can_view = FALSE for WR athlete M (consented — block is scope)');
select _ok((select count(*) from days where athlete_id = 'aaaaaaaa-0000-0000-0000-000000000001') >= 1,
           'slice F: LB coach reads his LB athlete''s days');
select _ok((select count(*) from days where athlete_id = 'dddddddd-0000-0000-0000-000000000004') = 0,
           'slice F: LB coach reads NONE of the WR athlete''s days');
select _ok((select count(*) from team_roster('77777777-1111-0000-0000-000000000001')
            where athlete_id = 'dddddddd-0000-0000-0000-000000000004') = 0,
           'slice F: team_roster hides out-of-room athletes from a scoped coach');
select _ok((select count(*) from team_roster('77777777-1111-0000-0000-000000000001')
            where athlete_id = 'aaaaaaaa-0000-0000-0000-000000000001') = 1,
           'slice F: team_roster still lists the in-room athlete');
select _ok((select count(*) from team_day_rollup('77777777-1111-0000-0000-000000000001',
             current_date - 40, current_date)
            where athlete_id = 'dddddddd-0000-0000-0000-000000000004') = 0,
           'slice F: team_day_rollup returns no out-of-room rows to a scoped coach');

-- 2. The comma-list position scope (a coordinator's side of the ball) widens coverage.
select _superuser();
update team_staff set scope_value = 'LB, WR'
  where team_id = '77777777-1111-0000-0000-000000000001' and staff_id = '66666666-0000-0000-0000-000000000006';
select _as('66666666-0000-0000-0000-000000000006');
select _ok(can_view('dddddddd-0000-0000-0000-000000000004'),
           'slice F: a comma-list position scope (LB, WR) covers the WR athlete');
select _superuser();
update team_staff set scope_value = 'LB'
  where team_id = '77777777-1111-0000-0000-000000000001' and staff_id = '66666666-0000-0000-0000-000000000006';

-- 3. Group scope: head coach re-scopes coach_3 to a group containing only M.
select _superuser();
insert into coach_groups (id, team_id, name, athlete_ids, created_by) values
  ('d1000000-0000-0000-0000-000000000001','77777777-1111-0000-0000-000000000001','Slot Room',
   array['dddddddd-0000-0000-0000-000000000004']::uuid[],'11111111-0000-0000-0000-000000000001');
select _as('11111111-0000-0000-0000-000000000001');  -- head coach manages scope
select _ok(_try($q$select set_staff_scope('77777777-1111-0000-0000-000000000001',
             '66666666-0000-0000-0000-000000000006','group','d1000000-0000-0000-0000-000000000001')$q$) = 'ok',
           'slice F: head coach sets a staff member''s group scope');
select _as('66666666-0000-0000-0000-000000000006');
select _ok(can_view('dddddddd-0000-0000-0000-000000000004')
       and not can_view('aaaaaaaa-0000-0000-0000-000000000001'),
           'slice F: group scope flips coverage (in-group M visible, out-of-group A not)');
select _as('11111111-0000-0000-0000-000000000001');
select _ok(_try($q$select set_staff_scope('77777777-1111-0000-0000-000000000001',
             '66666666-0000-0000-0000-000000000006','position','LB')$q$) = 'ok',
           'slice F: head coach restores the position scope');

-- 4. The head coach and whole-team staff are never narrowed.
select _ok(can_view('aaaaaaaa-0000-0000-0000-000000000001')
       and can_view('dddddddd-0000-0000-0000-000000000004'),
           'slice F: head coach still sees the whole team');
select _ok(_try($q$select set_staff_scope('77777777-1111-0000-0000-000000000001',
             '11111111-0000-0000-0000-000000000001','position','LB')$q$) like '%whole team%',
           'slice F: narrowing the head coach is refused');

-- 5. Scope self-service: initial narrowing only — never a self-widen.
select _as('66666666-0000-0000-0000-000000000006');  -- already narrowed
select _ok(_try($q$select set_staff_scope('77777777-1111-0000-0000-000000000001',
             '66666666-0000-0000-0000-000000000006',null,null)$q$) like '%head coach%',
           'slice F: a scoped coach cannot clear their own scope');
select _ok(_try($q$select set_staff_scope('77777777-1111-0000-0000-000000000001',
             '66666666-0000-0000-0000-000000000006','position','LB, WR, QB')$q$) like '%head coach%',
           'slice F: a scoped coach cannot re-write their own scope');
select _as('99999999-0000-0000-0000-000000000009');  -- rando
select _ok(_try($q$select set_staff_scope('77777777-1111-0000-0000-000000000001',
             '66666666-0000-0000-0000-000000000006',null,null)$q$) <> 'ok',
           'slice F: a stranger cannot touch anyone''s scope');

-- 6. Readonly: reads work, every write path is walled (policies AND definer RPCs).
select _as('10000000-0000-0000-0000-000000000010');  -- coach_r, readonly, whole team
select _ok((select count(*) from days where athlete_id = 'aaaaaaaa-0000-0000-0000-000000000001') >= 1,
           'slice F: readonly staff still READS athlete data in scope');
select _ok((select count(*) from coach_interventions
            where team_id = '77777777-1111-0000-0000-000000000001') >= 1,
           'slice F: readonly staff reads the team''s intervention log');
select _ok(_try($q$insert into coach_interventions (team_id, athlete_id, kind)
             values ('77777777-1111-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000001','nudge')$q$) <> 'ok',
           'slice F: readonly staff CANNOT log an intervention');
select _ok(_try($q$insert into coach_groups (team_id, name)
             values ('77777777-1111-0000-0000-000000000001','RO Group')$q$) <> 'ok',
           'slice F: readonly staff CANNOT create a group');
select _ok(_try($q$insert into requirement_templates (team_id, name, kind, items) values
             ('77777777-1111-0000-0000-000000000001','RO Tpl','custom',
              '[{"id":"m1","title":"Breakfast","kind":"meal","proof":"photo"}]'::jsonb)$q$) <> 'ok',
           'slice F: readonly staff CANNOT save a template');
select _ok(_try($q$select set_team_requirements('77777777-1111-0000-0000-000000000001','team',null,
             '[{"id":"m1","title":"Breakfast","kind":"meal","proof":"photo"}]'::jsonb)$q$) <> 'ok',
           'slice F: readonly staff CANNOT set the standard (definer RPC guard)');
select _ok(_try($q$select assign_requirement('77777777-1111-0000-0000-000000000001','team',null,'Run a mile')$q$) <> 'ok',
           'slice F: readonly staff CANNOT assign (definer RPC guard)');
select _ok(_try($q$select post_announcement('77777777-1111-0000-0000-000000000001','team',null,'Hi','Body')$q$) <> 'ok',
           'slice F: readonly staff CANNOT post an announcement (definer RPC guard)');
select _ok(_try($q$insert into athlete_exceptions (team_id, athlete_id)
             values ('77777777-1111-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000001')$q$) <> 'ok',
           'slice F: readonly staff CANNOT mark an excused window');

-- 7. Readonly self-declares an INITIAL narrowing (the onboarding responsibility step).
select _ok(_try($q$select set_staff_scope('77777777-1111-0000-0000-000000000001',
             '10000000-0000-0000-0000-000000000010','position','LB')$q$) = 'ok',
           'slice F: unscoped staff may self-declare their initial responsibility');
select _ok(not can_view('dddddddd-0000-0000-0000-000000000004'),
           'slice F: the self-declared scope narrows immediately');

-- 8. Invites + role management honor the new vocabulary.
select _as('11111111-0000-0000-0000-000000000001');  -- head coach
select _ok(length(create_staff_invite('77777777-1111-0000-0000-000000000001','position_coach')) = 8,
           'slice F: head coach mints a position_coach invite');
select _ok(length(create_staff_invite('77777777-1111-0000-0000-000000000001','readonly')) = 8,
           'slice F: head coach mints a readonly invite');
select _ok(_try($q$select create_staff_invite('77777777-1111-0000-0000-000000000001','head_coach')$q$) <> 'ok',
           'slice F: a head_coach invite is refused');
select _ok(set_staff_role('77777777-1111-0000-0000-000000000001','66666666-0000-0000-0000-000000000006','coordinator'),
           'slice F: head coach re-roles a staff member to coordinator');
select _ok(not set_staff_role('77777777-1111-0000-0000-000000000001','11111111-0000-0000-0000-000000000001','readonly'),
           'slice F: the head-coach row can never be re-roled');
select _ok((select s.scope_kind = 'position' and s.scope_value = 'LB'
            from team_staff_list('77777777-1111-0000-0000-000000000001') s
            where s.staff_id = '66666666-0000-0000-0000-000000000006'),
           'slice F: team_staff_list surfaces scope columns');
select _as('66666666-0000-0000-0000-000000000006');  -- not head coach
select _ok(_try($q$select create_staff_invite('77777777-1111-0000-0000-000000000001','readonly')$q$) <> 'ok',
           'slice F: a non-head-coach cannot mint staff invites');
select _ok(_try($q$select set_staff_role('77777777-1111-0000-0000-000000000001','10000000-0000-0000-0000-000000000010','coordinator')$q$) <> 'ok',
           'slice F: a non-head-coach cannot change roles');

-- 8b. Roles v2 (0082/0083): a head coach mints + assigns S&C / Athletic Trainer / Team Admin;
--     head_coach stays un-mintable and unknown roles are still refused.
select _as('11111111-0000-0000-0000-000000000001');  -- head coach
select _ok(length(create_staff_invite('77777777-1111-0000-0000-000000000001','s_and_c')) = 8,
           'roles v2: head coach mints a Strength & Conditioning invite');
select _ok(length(create_staff_invite('77777777-1111-0000-0000-000000000001','athletic_trainer')) = 8,
           'roles v2: head coach mints an Athletic Trainer invite');
select _ok(length(create_staff_invite('77777777-1111-0000-0000-000000000001','team_admin')) = 8,
           'roles v2: head coach mints a Team Admin invite');
select _ok(_try($q$select create_staff_invite('77777777-1111-0000-0000-000000000001','bogus_role')$q$) <> 'ok',
           'roles v2: an unknown invite role is still refused');
select _ok(set_staff_role('77777777-1111-0000-0000-000000000001','66666666-0000-0000-0000-000000000006','athletic_trainer'),
           'roles v2: head coach re-roles a staff member to Athletic Trainer');
select _ok((select role::text = 'athletic_trainer' from team_staff
            where team_id = '77777777-1111-0000-0000-000000000001' and staff_id = '66666666-0000-0000-0000-000000000006'),
           'roles v2: the Athletic Trainer role is stored');

-- 8c. Standard versioning (0085): a future-dated edit ADDS a version and never overwrites the
--     base, so today's scoring is never rescoped; re-saving the same date replaces that version.
select _as('11111111-0000-0000-0000-000000000001');  -- head coach
select set_team_requirements('77777777-1111-0000-0000-000000000001','position','VER',
  '[{"id":"m1","title":"Breakfast","kind":"meal","proof":"photo"}]'::jsonb, null);           -- base (in effect now)
select set_team_requirements('77777777-1111-0000-0000-000000000001','position','VER',
  '[{"id":"m1","title":"B","kind":"meal","proof":"photo"},{"id":"m2","title":"D","kind":"meal","proof":"photo"}]'::jsonb, current_date + 1);  -- prospective
select _ok((select count(*) from requirement_sets
            where team_id='77777777-1111-0000-0000-000000000001' and scope_kind='position' and scope_value='VER') = 2,
           'versioning: a future-dated edit adds a version alongside the base');
select set_team_requirements('77777777-1111-0000-0000-000000000001','position','VER',
  '[{"id":"m1","title":"B","kind":"meal","proof":"photo"},{"id":"m2","title":"L","kind":"meal","proof":"photo"},{"id":"m3","title":"D","kind":"meal","proof":"photo"}]'::jsonb, current_date + 1);  -- re-edit same date
select _ok((select count(*) from requirement_sets
            where team_id='77777777-1111-0000-0000-000000000001' and scope_kind='position' and scope_value='VER') = 2,
           'versioning: re-saving the same effective date replaces it — no duplicate row');
select _ok((select jsonb_array_length(items) from requirement_sets
            where team_id='77777777-1111-0000-0000-000000000001' and scope_kind='position' and scope_value='VER' and effective_date = current_date + 1) = 3,
           'versioning: the tomorrow version holds the re-saved 3 meals');
select _ok((select jsonb_array_length(items) from requirement_sets
            where team_id='77777777-1111-0000-0000-000000000001' and scope_kind='position' and scope_value='VER' and effective_date is null) = 1,
           'versioning: the base version is untouched — today is unchanged');

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
select _ok((select count(*) from guardian_children()) = 0,
           'REVOKED: ended guardianship cuts the parent''s score access (guardian_children empty)');

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

-- ================================================================ ACCOUNT ERASURE (0079)
-- A STAFF member who created team artifacts must be able to delete their account. Before 0079
-- the actor FKs (created_by/author_id/coach_id) were NO ACTION and BLOCKED the profiles cascade
-- with a foreign-key violation. coach_del is a coordinator on T1 (owned by coach_1, so erasing
-- coach_del never touches the team); their artifacts must SURVIVE with attribution nulled.
-- Runs last: it adds + deletes its own isolated actor, disturbing no earlier section.
select _superuser();
insert into auth.users (id, email) values ('12000000-0000-0000-0000-000000000012','cdel@x.io');
insert into profiles (id, full_name, email, primary_role) values
  ('12000000-0000-0000-0000-000000000012','Coach Del','cdel@x.io','coach')
  on conflict (id) do update set full_name = excluded.full_name, email = excluded.email, primary_role = excluded.primary_role;
insert into team_staff (team_id, staff_id, role, status) values
  ('77777777-1111-0000-0000-000000000001','12000000-0000-0000-0000-000000000012','coordinator','active');
insert into requirement_sets (id, team_id, scope_kind, scope_value, items, created_by) values
  ('a5000000-0000-0000-0000-000000000001','77777777-1111-0000-0000-000000000001','position','ZZ',
   '[{"id":"m1","title":"Breakfast","kind":"meal","proof":"photo"}]'::jsonb,'12000000-0000-0000-0000-000000000012');
insert into coach_groups (id, team_id, name, created_by) values
  ('a5000000-0000-0000-0000-000000000002','77777777-1111-0000-0000-000000000001','Del Group','12000000-0000-0000-0000-000000000012');
insert into coach_interventions (id, team_id, athlete_id, coach_id, kind) values
  ('a5000000-0000-0000-0000-000000000003','77777777-1111-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000001','12000000-0000-0000-0000-000000000012','nudge');
insert into coach_notes (id, team_id, athlete_id, author_id, body) values
  ('a5000000-0000-0000-0000-000000000004','77777777-1111-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000001','12000000-0000-0000-0000-000000000012','a note');
insert into requirement_templates (id, team_id, name, kind, items, created_by) values
  ('a5000000-0000-0000-0000-000000000005','77777777-1111-0000-0000-000000000001','Del Tpl','custom',
   '[{"id":"m1","title":"Breakfast","kind":"meal","proof":"photo"}]'::jsonb,'12000000-0000-0000-0000-000000000012');
insert into announcements (id, team_id, author_id, scope_kind, scope_value, title, body) values
  ('a5000000-0000-0000-0000-000000000006','77777777-1111-0000-0000-000000000001','12000000-0000-0000-0000-000000000012','team',null,'Hi','Body');
insert into staff_invites (id, team_id, role, code, created_by) values
  ('a5000000-0000-0000-0000-000000000007','77777777-1111-0000-0000-000000000001','coordinator','DELCODE1','12000000-0000-0000-0000-000000000012');

select _as('12000000-0000-0000-0000-000000000012');
select _ok(_try($q$select delete_account()$q$) = 'ok',
           '0079: a staff member with created artifacts CAN delete_account (no FK block)');

select _superuser();
select _ok((select count(*) from requirement_sets where id='a5000000-0000-0000-0000-000000000001' and created_by is null) = 1,
           '0079: requirement_set survives erasure with created_by nulled');
select _ok((select count(*) from coach_groups where id='a5000000-0000-0000-0000-000000000002' and created_by is null) = 1,
           '0079: coach_group survives erasure with created_by nulled');
select _ok((select count(*) from coach_interventions where id='a5000000-0000-0000-0000-000000000003' and coach_id is null) = 1,
           '0079: intervention survives erasure with coach_id nulled');
select _ok((select count(*) from coach_notes where id='a5000000-0000-0000-0000-000000000004' and author_id is null) = 1,
           '0079: coach_note survives erasure with author_id nulled');
select _ok((select count(*) from requirement_templates where id='a5000000-0000-0000-0000-000000000005' and created_by is null) = 1,
           '0079: template survives erasure with created_by nulled');
select _ok((select count(*) from announcements where id='a5000000-0000-0000-0000-000000000006' and author_id is null) = 1,
           '0079: announcement survives erasure with author_id nulled');
select _ok((select count(*) from staff_invites where id='a5000000-0000-0000-0000-000000000007' and created_by is null) = 1,
           '0079: staff_invite survives erasure with created_by nulled');
select _ok((select count(*) from profiles where id='12000000-0000-0000-0000-000000000012') = 0,
           '0079: the erased coach''s profile is actually gone');

-- ================================================================ 0103: per-field weight visibility
-- Deny-by-default weight (founder decision 2026-07-21): only head_coach / athletic_trainer /
-- s_and_c team staff (+ trainers + self) may read body weight. The wall is the COLUMN-SPLIT
-- SELECT grant (nobody reads the raw columns directly — not even allowed roles; the RPCs are
-- the only doors) + can_view_weight inside weight_series / athlete_plan_meta / coach_set_goals.
-- Self-contained cast on a fresh team TW so earlier sections' membership flips can't interfere.
select _superuser();
insert into auth.users (id, email) values
  ('a1030000-0000-0000-0000-0000000000a1','w@x.io'),  -- athlete W
  ('a1030000-0000-0000-0000-0000000000c1','whc@x.io'),-- head coach (allowed)
  ('a1030000-0000-0000-0000-0000000000c2','wat@x.io'),-- athletic trainer (allowed)
  ('a1030000-0000-0000-0000-0000000000c3','wpc@x.io'),-- position coach (RESTRICTED)
  ('a1030000-0000-0000-0000-0000000000c4','wnu@x.io');-- nutritionist (RESTRICTED, keeps protein/cal lane)
insert into profiles (id, full_name, email, primary_role) values
  ('a1030000-0000-0000-0000-0000000000a1','Athlete W','w@x.io','athlete'),
  ('a1030000-0000-0000-0000-0000000000c1','HC W','whc@x.io','coach'),
  ('a1030000-0000-0000-0000-0000000000c2','AT W','wat@x.io','coach'),
  ('a1030000-0000-0000-0000-0000000000c3','PC W','wpc@x.io','coach'),
  ('a1030000-0000-0000-0000-0000000000c4','NU W','wnu@x.io','coach')
  on conflict (id) do update set full_name = excluded.full_name, primary_role = excluded.primary_role;
insert into teams (id, name, join_code, created_by) values
  ('a1030000-1111-0000-0000-000000000001','TW','TWCODE','a1030000-0000-0000-0000-0000000000c1');
insert into team_members (team_id, athlete_id, status, position) values
  ('a1030000-1111-0000-0000-000000000001','a1030000-0000-0000-0000-0000000000a1','active','WR');
insert into team_staff (team_id, staff_id, role, status) values
  ('a1030000-1111-0000-0000-000000000001','a1030000-0000-0000-0000-0000000000c1','head_coach','active'),
  ('a1030000-1111-0000-0000-000000000001','a1030000-0000-0000-0000-0000000000c2','athletic_trainer','active'),
  ('a1030000-1111-0000-0000-000000000001','a1030000-0000-0000-0000-0000000000c3','position_coach','active'),
  ('a1030000-1111-0000-0000-000000000001','a1030000-0000-0000-0000-0000000000c4','nutritionist','active');
insert into days (athlete_id, date, meals, score, grade, current_weight) values
  ('a1030000-0000-0000-0000-0000000000a1', current_date, '{"breakfast":true}'::jsonb, 80, 'B', 201);
insert into checkins (athlete_id, week, weight, energy) values
  ('a1030000-0000-0000-0000-0000000000a1', '0103-w', 200, 8);
insert into athlete_profiles (athlete_id, base_weight, base_goal, targets) values
  ('a1030000-0000-0000-0000-0000000000a1', 199, 'perform', '{"protein":180,"calories":3200,"weight":190}'::jsonb)
  on conflict (athlete_id) do update set base_weight = excluded.base_weight, targets = excluded.targets;

-- The column wall: DIRECT weight-column selects are denied for everyone (the RPC is the door)…
select _as('a1030000-0000-0000-0000-0000000000c3'); -- position coach
select _ok(_try($q$select current_weight from days where athlete_id='a1030000-0000-0000-0000-0000000000a1'$q$) like 'denied(42501)%',
           '0103: position coach direct days.current_weight select is column-denied');
select _ok(_try($q$select weight from checkins where athlete_id='a1030000-0000-0000-0000-0000000000a1'$q$) like 'denied(42501)%',
           '0103: position coach direct checkins.weight select is column-denied');
select _ok(_try($q$select base_weight from athlete_profiles where athlete_id='a1030000-0000-0000-0000-0000000000a1'$q$) like 'denied(42501)%',
           '0103: position coach direct athlete_profiles.base_weight select is column-denied');
select _ok(_try($q$select targets from athlete_profiles where athlete_id='a1030000-0000-0000-0000-0000000000a1'$q$) like 'denied(42501)%',
           '0103: position coach direct athlete_profiles.targets select is column-denied');
-- …while the NON-weight columns and row visibility are untouched (the whole suite's count(*)
-- idiom keeps working under column grants — this is the regression sentinel for that).
select _ok(_try($q$select date, score, meals from days where athlete_id='a1030000-0000-0000-0000-0000000000a1'$q$) = 'ok',
           '0103: position coach still reads the day row''s non-weight columns');
select _ok((select count(*) from days where athlete_id='a1030000-0000-0000-0000-0000000000a1') = 1,
           '0103: count(*) over days still works for staff under column grants');
select _ok(_try($q$select energy from checkins where athlete_id='a1030000-0000-0000-0000-0000000000a1'$q$) = 'ok',
           '0103: position coach still reads non-weight checkin columns');
select _ok(_try($q$select base_goal, "position", sport from athlete_profiles where athlete_id='a1030000-0000-0000-0000-0000000000a1'$q$) = 'ok',
           '0103: position coach still reads non-weight profile columns');
-- The RPC doors return LESS for the restricted: zero series rows, nulled/stripped plan meta.
select _ok((select count(*) from weight_series('a1030000-0000-0000-0000-0000000000a1', 60)) = 0,
           '0103: weight_series returns ZERO rows to a position coach');
select _ok((select base_weight is null and not (targets ? 'weight') and (targets ? 'protein') and (targets ? 'calories')
            from athlete_plan_meta('a1030000-0000-0000-0000-0000000000a1')),
           '0103: plan meta for a position coach has no base_weight, no target weight, but keeps protein/calories');

select _as('a1030000-0000-0000-0000-0000000000c4'); -- nutritionist (deliberately restricted)
select _ok((select count(*) from weight_series('a1030000-0000-0000-0000-0000000000a1', 60)) = 0,
           '0103: weight_series returns ZERO rows to the nutritionist');
select _ok((select not (targets ? 'weight') and (targets->>'protein')::int = 180
            from athlete_plan_meta('a1030000-0000-0000-0000-0000000000a1')),
           '0103: nutritionist keeps the protein target but never the weight target');
-- Write guard: the nutritionist's save goes through, but the stored target weight DOESN'T move.
select _ok(_try($q$select coach_set_goals('a1030000-0000-0000-0000-0000000000a1','{"protein":200,"calories":3300,"weight":150}'::jsonb, null)$q$) = 'ok',
           '0103: nutritionist coach_set_goals succeeds (their protein/cal lane is intact)');
select _superuser();
select _ok((select (targets->>'weight')::int = 190 and (targets->>'protein')::int = 200
            from athlete_profiles where athlete_id='a1030000-0000-0000-0000-0000000000a1'),
           '0103: nutritionist save moved protein to 200 but the weight target stayed 190');

select _as('a1030000-0000-0000-0000-0000000000c2'); -- athletic trainer (allowed)
select _ok((select count(*) from weight_series('a1030000-0000-0000-0000-0000000000a1', 60)) = 1
           and (select weight from weight_series('a1030000-0000-0000-0000-0000000000a1', 60)) = 201,
           '0103: athletic trainer reads the real weight series through the RPC');
select _ok((select base_weight = 199 and (targets->>'weight')::int = 190
            from athlete_plan_meta('a1030000-0000-0000-0000-0000000000a1')),
           '0103: athletic trainer reads base_weight and the weight target');
select _ok(_try($q$select coach_set_goals('a1030000-0000-0000-0000-0000000000a1','{"protein":200,"calories":3300,"weight":185}'::jsonb, null)$q$) = 'ok',
           '0103: athletic trainer coach_set_goals succeeds');
select _superuser();
select _ok((select (targets->>'weight')::int = 185 from athlete_profiles where athlete_id='a1030000-0000-0000-0000-0000000000a1'),
           '0103: the athletic trainer''s weight target write actually lands');

select _as('a1030000-0000-0000-0000-0000000000c1'); -- head coach (allowed)
select _ok((select count(*) from weight_series('a1030000-0000-0000-0000-0000000000a1', 60)) = 1,
           '0103: head coach reads the weight series');

select _as('a1030000-0000-0000-0000-0000000000a1'); -- the athlete themself
select _ok((select count(*) from weight_series('a1030000-0000-0000-0000-0000000000a1', 60)) = 1
           and (select base_weight = 199 and (targets ? 'weight') from athlete_plan_meta('a1030000-0000-0000-0000-0000000000a1')),
           '0103: the athlete always reads their own weight in full (is_self)');

select _as('99999999-0000-0000-0000-000000000009'); -- rando, no links
select _ok((select count(*) from weight_series('a1030000-0000-0000-0000-0000000000a1', 60)) = 0
           and (select count(*) from athlete_plan_meta('a1030000-0000-0000-0000-0000000000a1')) = 0,
           '0103: an unlinked stranger gets zero rows from both weight doors');

-- ================================================================ feature flags (0109)
-- Two tables (feature_flags, admin_audit_log) are RPC/service-role ONLY. A normal authenticated
-- user must not be able to read/write them directly, and the admin RPCs must reject non-admins.
select _superuser();
insert into platform_admins (user_id) values ('55555555-0000-0000-0000-000000000005') on conflict do nothing;

-- rando (no links, not a platform admin): no direct table access, no admin RPCs.
select _as('99999999-0000-0000-0000-000000000009');
select _ok(_try($f$ select count(*) from feature_flags $f$) <> 'ok', 'ff: rando cannot select feature_flags');
select _ok(_try($f$ insert into feature_flags(name) values ('x') $f$) <> 'ok', 'ff: rando cannot insert feature_flags');
select _ok(_try($f$ select count(*) from admin_audit_log $f$) <> 'ok', 'ff: rando cannot select admin_audit_log');
select _ok(_try($f$ select admin_list_flags() $f$) <> 'ok', 'ff: rando denied admin_list_flags');
select _ok(_try($f$ select admin_set_flag('x','',true,false,'{}','{}','{}') $f$) <> 'ok', 'ff: rando denied admin_set_flag');

-- platform admin (55555555…005, registered above): can list, can set, and the write is audited.
select _as('55555555-0000-0000-0000-000000000005');
select _ok(_try($f$ select admin_list_flags() $f$) = 'ok', 'ff: admin can list flags');
select _ok(_try($f$ select admin_set_flag('probe','p',true,false,'{}','{}','{}') $f$) = 'ok', 'ff: admin can set flag');
select _superuser();
select _ok((select count(*) from admin_audit_log where target = 'probe' and action = 'feature_flag.set') = 1,
           'ff: admin_set_flag wrote exactly one audit row (before/after)');
select _ok((select default_on from feature_flags where name = 'probe') = true,
           'ff: admin_set_flag persisted the row');

-- ================================================================ command center phase 1A (0115)
-- admin_bootstrap is the ONLY admin RPC that RETURNS for a non-admin (is_admin=false) so the client can
-- render "access denied"; the search RPCs keep the raise-gate. Reuses the 55555…005 admin seeded above.
select _as('99999999-0000-0000-0000-000000000009');
select _ok((admin_bootstrap() ->> 'is_admin') = 'false', 'cc: bootstrap reports non-admin is_admin=false');
select _ok(_try($f$ select admin_global_search('a', 5) $f$) <> 'ok', 'cc: rando denied admin_global_search');
select _ok(_try($f$ select admin_audit_search(null, null, 5) $f$) <> 'ok', 'cc: rando denied admin_audit_search');

select _as('55555555-0000-0000-0000-000000000005');
select _ok((admin_bootstrap() ->> 'is_admin') = 'true', 'cc: bootstrap reports admin is_admin=true');
select _ok((admin_bootstrap() -> 'capabilities' ->> 'financial') = 'false', 'cc: bootstrap financial capability still gated (pre-payments)');
select _ok(_try($f$ select admin_global_search('a', 5) $f$) = 'ok', 'cc: admin can global_search');
select _ok(_try($f$ select admin_audit_search(null, null, 5) $f$) = 'ok', 'cc: admin can audit_search');

-- Phase 1A section RPCs (0116 users, 0117 orgs, 0118 revenue) — gate + basic shape.
select _as('99999999-0000-0000-0000-000000000009');
select _ok(_try($f$ select admin_list_users(null,null,null,0,10) $f$) <> 'ok', 'cc: rando denied admin_list_users');
select _ok(_try($f$ select admin_athlete_profile('55555555-0000-0000-0000-000000000005') $f$) <> 'ok', 'cc: rando denied admin_athlete_profile');
select _ok(_try($f$ select admin_list_orgs(null,0,10) $f$) <> 'ok', 'cc: rando denied admin_list_orgs');
select _ok(_try($f$ select admin_org_health('00000000-0000-0000-0000-000000000000') $f$) <> 'ok', 'cc: rando denied admin_org_health');
select _ok(_try($f$ select admin_revenue() $f$) <> 'ok', 'cc: rando denied admin_revenue');
select _ok(_try($f$ select admin_failed_payments(10) $f$) <> 'ok', 'cc: rando denied admin_failed_payments');

select _as('55555555-0000-0000-0000-000000000005');
select _ok(_try($f$ select admin_list_users(null,null,null,0,10) $f$) = 'ok', 'cc: admin can list users');
select _ok(_try($f$ select admin_list_orgs(null,0,10) $f$) = 'ok', 'cc: admin can list orgs');
select _ok((select count(*) from admin_revenue()) = 1, 'cc: admin_revenue returns exactly one row');
select _ok(_try($f$ select admin_failed_payments(10) $f$) = 'ok', 'cc: admin can list failed payments');

-- Phase 1B reauth (0119) — grants are server-verified from the JWT amr timestamp, never self-granted.
select _as_amr('55555555-0000-0000-0000-000000000005', 30);    -- authenticated 30s ago → fresh
select _ok(_try($f$ select admin_open_sensitive_window('flags', false) $f$) = 'ok', 'cc: fresh reauth mints a grant');
select _ok(admin_has_sensitive_grant('flags'), 'cc: grant is live for its scope + session');
select _ok(not admin_has_sensitive_grant('financial'), 'cc: grant does not leak across scopes');
select _as_amr('55555555-0000-0000-0000-000000000005', 1200);  -- authenticated 20m ago → stale
select _ok(_try($f$ select admin_open_sensitive_window('financial', true) $f$) <> 'ok', 'cc: stale reauth is refused');
select _as('99999999-0000-0000-0000-000000000009');
select _ok(_try($f$ select admin_open_sensitive_window('flags', false) $f$) <> 'ok', 'cc: rando denied open_sensitive_window');

-- Phase 1B user mutations (0122) — is_platform_admin AND a live 'user_mutation' grant, both required.
select _ok(_try($f$ select admin_correct_primary_role('55555555-0000-0000-0000-000000000005','coach') $f$) <> 'ok', 'cc: rando denied correct_role');
select _as_amr('55555555-0000-0000-0000-000000000005', 30);
select _ok(_try($f$ select admin_pause_account('99999999-0000-0000-0000-000000000009') $f$) <> 'ok', 'cc: mutation without a grant is refused');
select admin_open_sensitive_window('user_mutation', false);
select _ok(_try($f$ select admin_correct_primary_role('99999999-0000-0000-0000-000000000009','coach') $f$) = 'ok', 'cc: mutation with a live grant succeeds');
select _superuser();
select _ok((select count(*) from admin_audit_log where action='user.correct_role' and target='99999999-0000-0000-0000-000000000009') = 1, 'cc: role change audited exactly once');

-- Phase 1B view-as (0123) — grant required + non-empty reason required + audited as impersonation.
select _as_amr('55555555-0000-0000-0000-000000000005', 30);
select _ok(_try($f$ select admin_view_as('99999999-0000-0000-0000-000000000009','support case #12') $f$) <> 'ok', 'cc: view-as without a grant is refused');
select admin_open_sensitive_window('view_as', false);
select _ok(_try($f$ select admin_view_as('99999999-0000-0000-0000-000000000009','') $f$) <> 'ok', 'cc: view-as requires a reason');
select _ok(_try($f$ select admin_view_as('99999999-0000-0000-0000-000000000009','support case #12') $f$) = 'ok', 'cc: view-as with grant + reason works');
select _superuser();
select _ok((select count(*) from admin_audit_log where action='user.view_as' and (after->>'impersonation')='true') >= 1, 'cc: view-as is audited as impersonation');

-- Phase 1B append-only audit (0124) — UPDATE/DELETE blocked even for a superuser (append-only ledger).
select _superuser();
select _ok(_try($f$ update admin_audit_log set action='tampered' where id = (select id from admin_audit_log order by id limit 1) $f$) <> 'ok', 'cc: admin_audit_log UPDATE is blocked (append-only)');
select _ok(_try($f$ delete from admin_audit_log where id = (select id from admin_audit_log order by id limit 1) $f$) <> 'ok', 'cc: admin_audit_log DELETE is blocked (append-only)');

-- Phase 1B support (0125) — validated + rate-limited intake, safety=urgent, gated founder queue.
select _as('55555555-0000-0000-0000-000000000005');
select _ok(_try($f$ select create_support_ticket('nonsense','hi','x') $f$) <> 'ok', 'cc: support intake rejects invalid category');
select _ok(_try($f$ select create_support_ticket('safety','Concern about a DM','the body') $f$) = 'ok', 'cc: user can file a support ticket');
select _as('99999999-0000-0000-0000-000000000009');
select _ok(_try($f$ select admin_support_queue(null,null) $f$) <> 'ok', 'cc: non-admin denied admin_support_queue');
select _as('55555555-0000-0000-0000-000000000005');
select _ok(_try($f$ select admin_support_queue('open',null) $f$) = 'ok', 'cc: admin can read support queue');
select _superuser();
select _ok((select priority from support_tickets where category='safety' order by created_at desc limit 1) = 'urgent', 'cc: safety ticket is auto-urgent');

-- Phase 1B typed config (0126) — validated + versioned; set requires a 'config' grant.
select _as('99999999-0000-0000-0000-000000000009');
select _ok(_try($f$ select admin_get_config() $f$) <> 'ok', 'cc: rando denied admin_get_config');
select _as_amr('55555555-0000-0000-0000-000000000005', 30);
select _ok(_try($f$ select admin_set_config('ai_daily_budget_usd','50'::jsonb) $f$) <> 'ok', 'cc: config set without a grant is refused');
select admin_open_sensitive_window('config', false);
select _ok(_try($f$ select admin_set_config('ai_daily_budget_usd','"nan"'::jsonb) $f$) <> 'ok', 'cc: config set validates value type');
select _ok(_try($f$ select admin_set_config('ai_daily_budget_usd','50'::jsonb) $f$) = 'ok', 'cc: config set with grant + valid type works');
select _superuser();
select _ok((select version from app_config where key='ai_daily_budget_usd') >= 2, 'cc: config version bumps on set');

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
