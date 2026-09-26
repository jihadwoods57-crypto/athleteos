-- OnStandard — season phase (0252) + target suggestions (0253) authorization suite.
--
-- 0252: only staff who edit the standard set the team's phase (through the RPC or a direct
-- update); view-only staff, a position coach, an athlete and an outsider cannot; the stamp is the
-- server's. A solo athlete sets their own phase, a team athlete and a practice client cannot, and
-- season_phase_for resolves team > practice (none) > self for the athlete, their staff and the
-- service role, and nothing for a stranger or a guardian.
-- 0253: an adult on a gain/lose goal files their own suggestion; a minor, a maintain goal, a
-- second one inside 14 days and one filed for someone else are refused; linked staff with
-- target-edit rights read and decide, view-only staff, teammates and guardians see nothing; staff
-- approve only after coach_set_goals applied the numbers; a team athlete never self-approves, a
-- solo athlete does and it lands in their own targets; an expired row cannot be decided.
--
-- Run against a migrated local/staging DB, as superuser — NEVER production:
--   psql -v ON_ERROR_STOP=1 -f supabase/tests/season_targets_test.sql
-- One transaction, rolled back, scoreboard at the end, non-zero exit if any check failed.

begin;

-- ---------------------------------------------------------------- harness
create table _st_results (n serial, ok boolean, label text);

create or replace function _ok(cond boolean, label text) returns void
language plpgsql security definer as $$
begin
  insert into _st_results(ok, label) values (coalesce(cond,false), label);
  if coalesce(cond,false) then raise notice 'PASS: %', label;
  else raise warning 'FAIL: %', label; end if;
end $$;
grant execute on function _ok(boolean, text) to authenticated, anon;

create or replace function _as(p_uid uuid) returns void
language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claim.sub', p_uid::text, false);
  perform set_config('request.jwt.claims', json_build_object(
    'sub', p_uid, 'role', 'authenticated', 'aal', 'aal2')::text, false);
  execute 'set role authenticated';
end $$;
grant execute on function _as(uuid) to authenticated, anon;

create or replace function _superuser() returns void
language plpgsql as $$ begin
  execute 'reset role';
  perform set_config('request.jwt.claim.sub', '', false);
  perform set_config('request.jwt.claims', '', false);
end $$;
grant execute on function _superuser() to authenticated, anon;

create or replace function _try(p_sql text) returns text
language plpgsql as $$
begin
  execute p_sql;
  return 'ok';
exception when others then
  return 'denied(' || sqlstate || '): ' || sqlerrm;
end $$;
grant execute on function _try(text) to authenticated, anon;

-- ---------------------------------------------------------------- seed
-- 01 head coach · 02 view-only staff · 03 position coach · 04 nutritionist
-- 0a athlete A (adult, gain, on the team) · 0b athlete B (teammate) · 0c outsider
-- 0d guardian of A · 0e solo athlete S (adult, lose) · 0f minor M (on the team, gain)
-- 10 trainer T · 11 client C of T (no team) · 12 maintain-goal solo
select _superuser();
insert into auth.users (id, email) values
  ('7fb00000-0000-0000-0000-000000000001'::uuid, 'st-coach@x.io'),
  ('7fb00000-0000-0000-0000-000000000002'::uuid, 'st-ro@x.io'),
  ('7fb00000-0000-0000-0000-000000000003'::uuid, 'st-pos@x.io'),
  ('7fb00000-0000-0000-0000-000000000004'::uuid, 'st-rd@x.io'),
  ('7fb00000-0000-0000-0000-00000000000a'::uuid, 'st-a@x.io'),
  ('7fb00000-0000-0000-0000-00000000000b'::uuid, 'st-b@x.io'),
  ('7fb00000-0000-0000-0000-00000000000c'::uuid, 'st-out@x.io'),
  ('7fb00000-0000-0000-0000-00000000000d'::uuid, 'st-parent@x.io'),
  ('7fb00000-0000-0000-0000-00000000000e'::uuid, 'st-solo@x.io'),
  ('7fb00000-0000-0000-0000-00000000000f'::uuid, 'st-minor@x.io'),
  ('7fb00000-0000-0000-0000-000000000010'::uuid, 'st-trainer@x.io'),
  ('7fb00000-0000-0000-0000-000000000011'::uuid, 'st-client@x.io'),
  ('7fb00000-0000-0000-0000-000000000012'::uuid, 'st-maint@x.io');
insert into profiles (id, full_name, email, primary_role) values
  ('7fb00000-0000-0000-0000-000000000001', 'Coach ST', 'st-coach@x.io', 'coach'),
  ('7fb00000-0000-0000-0000-000000000002', 'Viewer ST', 'st-ro@x.io', 'coach'),
  ('7fb00000-0000-0000-0000-000000000003', 'Position ST', 'st-pos@x.io', 'coach'),
  ('7fb00000-0000-0000-0000-000000000004', 'Dietitian ST', 'st-rd@x.io', 'coach'),
  ('7fb00000-0000-0000-0000-00000000000a', 'Athlete A', 'st-a@x.io', 'athlete'),
  ('7fb00000-0000-0000-0000-00000000000b', 'Athlete B', 'st-b@x.io', 'athlete'),
  ('7fb00000-0000-0000-0000-00000000000c', 'Outsider', 'st-out@x.io', 'athlete'),
  ('7fb00000-0000-0000-0000-00000000000d', 'Parent A', 'st-parent@x.io', 'parent'),
  ('7fb00000-0000-0000-0000-00000000000e', 'Solo S', 'st-solo@x.io', 'athlete'),
  ('7fb00000-0000-0000-0000-00000000000f', 'Minor M', 'st-minor@x.io', 'athlete'),
  ('7fb00000-0000-0000-0000-000000000010', 'Trainer T', 'st-trainer@x.io', 'trainer'),
  ('7fb00000-0000-0000-0000-000000000011', 'Client C', 'st-client@x.io', 'athlete'),
  ('7fb00000-0000-0000-0000-000000000012', 'Maintain X', 'st-maint@x.io', 'athlete')
on conflict (id) do nothing;
insert into athlete_profiles (athlete_id, base_goal, dob) values
  ('7fb00000-0000-0000-0000-00000000000a', 'gain', '2000-01-01'),
  ('7fb00000-0000-0000-0000-00000000000b', 'gain', '2000-01-01'),
  ('7fb00000-0000-0000-0000-00000000000e', 'lose', null),
  ('7fb00000-0000-0000-0000-00000000000f', 'gain', (current_date - interval '15 years')::date),
  ('7fb00000-0000-0000-0000-000000000011', 'gain', '1995-05-05'),
  ('7fb00000-0000-0000-0000-000000000012', 'maintain', '1995-05-05')
on conflict (athlete_id) do update set base_goal = excluded.base_goal, dob = excluded.dob;
insert into teams (id, name, join_code, created_by) values
  ('7fb00000-0000-0000-0000-0000000000d1'::uuid, 'ST HS', 'STTEAM01', '7fb00000-0000-0000-0000-000000000001');
insert into team_staff (team_id, staff_id, role, status) values
  ('7fb00000-0000-0000-0000-0000000000d1', '7fb00000-0000-0000-0000-000000000001', 'head_coach', 'active'),
  ('7fb00000-0000-0000-0000-0000000000d1', '7fb00000-0000-0000-0000-000000000002', 'readonly', 'active'),
  ('7fb00000-0000-0000-0000-0000000000d1', '7fb00000-0000-0000-0000-000000000003', 'position_coach', 'active'),
  ('7fb00000-0000-0000-0000-0000000000d1', '7fb00000-0000-0000-0000-000000000004', 'nutritionist', 'active');
insert into team_members (team_id, athlete_id, status) values
  ('7fb00000-0000-0000-0000-0000000000d1', '7fb00000-0000-0000-0000-00000000000a', 'active'),
  ('7fb00000-0000-0000-0000-0000000000d1', '7fb00000-0000-0000-0000-00000000000b', 'active'),
  ('7fb00000-0000-0000-0000-0000000000d1', '7fb00000-0000-0000-0000-00000000000f', 'active');
insert into guardianships (athlete_id, guardian_id, relationship, status) values
  ('7fb00000-0000-0000-0000-00000000000a', '7fb00000-0000-0000-0000-00000000000d', 'parent', 'active');
insert into practices (id, owner_id, name, join_code) values
  ('7fb00000-0000-0000-0000-0000000000e1'::uuid, '7fb00000-0000-0000-0000-000000000010', 'ST Practice', 'STPRAC01');
insert into practice_clients (practice_id, client_id, status) values
  ('7fb00000-0000-0000-0000-0000000000e1', '7fb00000-0000-0000-0000-000000000011', 'active');

-- Review round (2026-09-26): more actors for the 0254 targets door, and real weigh-ins, because
-- the suggestion's pace is now the server's own (a least-squares fit over days.current_weight).
--   05 coordinator (edits standards, NOT a weight-view role) · 06 head coach of ANOTHER team
--   13 a second trainer with their own practice · 14 athletic trainer on the ST team
insert into auth.users (id, email) values
  ('7fb00000-0000-0000-0000-000000000005'::uuid, 'st-coord@x.io'),
  ('7fb00000-0000-0000-0000-000000000006'::uuid, 'st-other@x.io'),
  ('7fb00000-0000-0000-0000-000000000013'::uuid, 'st-trainer2@x.io'),
  ('7fb00000-0000-0000-0000-000000000014'::uuid, 'st-at@x.io');
insert into profiles (id, full_name, email, primary_role) values
  ('7fb00000-0000-0000-0000-000000000005', 'Coordinator ST', 'st-coord@x.io', 'coach'),
  ('7fb00000-0000-0000-0000-000000000006', 'Other Coach', 'st-other@x.io', 'coach'),
  ('7fb00000-0000-0000-0000-000000000013', 'Trainer Two', 'st-trainer2@x.io', 'trainer'),
  ('7fb00000-0000-0000-0000-000000000014', 'AT ST', 'st-at@x.io', 'coach')
on conflict (id) do nothing;
insert into teams (id, name, join_code, created_by) values
  ('7fb00000-0000-0000-0000-0000000000d2'::uuid, 'ST Other', 'STTEAM02', '7fb00000-0000-0000-0000-000000000006');
insert into team_staff (team_id, staff_id, role, status) values
  ('7fb00000-0000-0000-0000-0000000000d1', '7fb00000-0000-0000-0000-000000000005', 'coordinator', 'active'),
  ('7fb00000-0000-0000-0000-0000000000d1', '7fb00000-0000-0000-0000-000000000014', 'athletic_trainer', 'active'),
  ('7fb00000-0000-0000-0000-0000000000d2', '7fb00000-0000-0000-0000-000000000006', 'head_coach', 'active');
insert into practices (id, owner_id, name, join_code) values
  ('7fb00000-0000-0000-0000-0000000000e2'::uuid, '7fb00000-0000-0000-0000-000000000013', 'ST Practice 2', 'STPRAC02');
update athlete_profiles set base_weight = 186 where athlete_id in (
  '7fb00000-0000-0000-0000-00000000000a', '7fb00000-0000-0000-0000-00000000000b', '7fb00000-0000-0000-0000-000000000011');
update athlete_profiles set base_weight = 190 where athlete_id = '7fb00000-0000-0000-0000-00000000000e';
-- Gainers A, B and client C: 186.0 -> 186.2 -> 186.4 over 14 days = +0.2 lb a week (plan +0.5).
-- Solo loser S: 190.0 -> 189.7 -> 189.4 = -0.3 lb a week (plan -1.0).
insert into days (athlete_id, date, current_weight)
select a.id, current_date - d.back, a.base + d.step * a.rate
  from (values ('7fb00000-0000-0000-0000-00000000000a'::uuid, 186.0, 0.2),
               ('7fb00000-0000-0000-0000-00000000000b'::uuid, 186.0, 0.2),
               ('7fb00000-0000-0000-0000-000000000011'::uuid, 186.0, 0.2),
               ('7fb00000-0000-0000-0000-000000000012'::uuid, 170.0, 0.2),
               ('7fb00000-0000-0000-0000-00000000000e'::uuid, 190.0, -0.3)) as a(id, base, rate),
       (values (14, 0), (7, 1), (0, 2)) as d(back, step);

-- ================================================================ 0252 season phase
select _ok(has_column_privilege('authenticated', 'public.teams', 'season_phase', 'SELECT'), 'authenticated may SELECT teams.season_phase');
select _ok(has_column_privilege('authenticated', 'public.athlete_profiles', 'season_phase', 'SELECT'), 'authenticated may SELECT athlete_profiles.season_phase (inside the 0103 wall)');
select _ok(not has_column_privilege('authenticated', 'public.athlete_profiles', 'season_phase', 'UPDATE'), 'athlete_profiles.season_phase is outside the write wall (the RPC is the door)');
select _ok((select season_phase is null from teams where id = '7fb00000-0000-0000-0000-0000000000d1'), 'a team starts with no phase');

-- the head coach sets it
select _as('7fb00000-0000-0000-0000-000000000001');
select _ok(_try($q$select set_team_season_phase('7fb00000-0000-0000-0000-0000000000d1', 'in')$q$) = 'ok', 'the head coach sets the phase');
select _ok((select season_phase = 'in' and season_phase_at is not null from teams where id = '7fb00000-0000-0000-0000-0000000000d1'),
  'the phase is stored and stamped');
select _ok(_try($q$select set_team_season_phase('7fb00000-0000-0000-0000-0000000000d1', 'playoffs')$q$) like 'denied%', 'an unknown phase is refused');
select _ok(_try($q$update teams set season_phase_at = '2001-01-01' where id = '7fb00000-0000-0000-0000-0000000000d1'$q$) = 'ok'
  and (select season_phase_at > '2020-01-01' from teams where id = '7fb00000-0000-0000-0000-0000000000d1'),
  'the stamp cannot be back-dated by hand');

-- the nutritionist edits standards, so may set it too
select _as('7fb00000-0000-0000-0000-000000000004');
select _ok(_try($q$select set_team_season_phase('7fb00000-0000-0000-0000-0000000000d1', 'pre')$q$) = 'ok', 'the nutritionist (a standards editor) sets the phase');

-- view-only staff: neither door
select _as('7fb00000-0000-0000-0000-000000000002');
select _ok(_try($q$select set_team_season_phase('7fb00000-0000-0000-0000-0000000000d1', 'off')$q$) like 'denied(42501)%', 'view-only staff cannot set the phase through the RPC');
select _ok(_try($q$update teams set season_phase = 'off' where id = '7fb00000-0000-0000-0000-0000000000d1'$q$) like 'denied(42501)%', 'view-only staff cannot set the phase with a direct update');
select _ok((select season_phase = 'pre' from teams where id = '7fb00000-0000-0000-0000-0000000000d1'), 'view-only staff still read the phase');
select _ok(_try($q$update teams set name = 'ST HS Renamed' where id = '7fb00000-0000-0000-0000-0000000000d1'$q$) = 'ok', 'the guard only watches the phase: other team edits behave as before');

-- position coach, athlete, outsider
select _as('7fb00000-0000-0000-0000-000000000003');
select _ok(_try($q$select set_team_season_phase('7fb00000-0000-0000-0000-0000000000d1', 'off')$q$) like 'denied(42501)%', 'a position coach cannot set the phase');
select _as('7fb00000-0000-0000-0000-00000000000a');
select _ok(_try($q$select set_team_season_phase('7fb00000-0000-0000-0000-0000000000d1', 'off')$q$) like 'denied(42501)%', 'an athlete cannot set the team phase');
select _as('7fb00000-0000-0000-0000-00000000000c');
select _ok(_try($q$select set_team_season_phase('7fb00000-0000-0000-0000-0000000000d1', 'off')$q$) like 'denied(42501)%', 'an outsider cannot set the team phase');
select _superuser();
select _ok((select season_phase = 'pre' from teams where id = '7fb00000-0000-0000-0000-0000000000d1'), 'every refused write left the phase alone');

-- a solo athlete's own phase
select _as('7fb00000-0000-0000-0000-00000000000e');
select _ok(_try($q$select set_my_season_phase('post')$q$) = 'ok', 'a solo athlete sets their own phase');
select _ok((season_phase_for('7fb00000-0000-0000-0000-00000000000e') ->> 'phase') = 'post'
  and (season_phase_for('7fb00000-0000-0000-0000-00000000000e') ->> 'source') = 'self'
  and (season_phase_for('7fb00000-0000-0000-0000-00000000000e') ->> 'can_set_self')::boolean,
  'season_phase_for: a solo athlete reads their own phase');
select _ok(_try($q$update athlete_profiles set season_phase = 'in' where athlete_id = '7fb00000-0000-0000-0000-00000000000e'$q$) like 'denied(42501)%',
  'no direct write to athlete_profiles.season_phase');

select _as('7fb00000-0000-0000-0000-00000000000a');
select _ok(_try($q$select set_my_season_phase('off')$q$) like 'denied(42501)%', 'a team athlete cannot set their own phase');
select _ok((season_phase_for('7fb00000-0000-0000-0000-00000000000a') ->> 'phase') = 'pre'
  and (season_phase_for('7fb00000-0000-0000-0000-00000000000a') ->> 'source') = 'team',
  'season_phase_for: a team athlete reads the team phase');
select _superuser();
update athlete_profiles set season_phase = 'post' where athlete_id = '7fb00000-0000-0000-0000-00000000000a';
select _as('7fb00000-0000-0000-0000-00000000000a');
select _ok((season_phase_for('7fb00000-0000-0000-0000-00000000000a') ->> 'phase') = 'pre',
  'the team phase wins over a stale phase of their own');

select _as('7fb00000-0000-0000-0000-000000000011');
select _ok(_try($q$select set_my_season_phase('in')$q$) like 'denied(42501)%', 'a practice client cannot set a phase');
select _ok((season_phase_for('7fb00000-0000-0000-0000-000000000011') ->> 'phase') is null
  and not (season_phase_for('7fb00000-0000-0000-0000-000000000011') ->> 'can_set_self')::boolean,
  'season_phase_for: a practice client has no season');

select _as('7fb00000-0000-0000-0000-000000000001');
select _ok((season_phase_for('7fb00000-0000-0000-0000-00000000000a') ->> 'phase') = 'pre', 'the coach resolves their athlete''s phase');
select _as('7fb00000-0000-0000-0000-00000000000c');
select _ok(season_phase_for('7fb00000-0000-0000-0000-00000000000a') is null, 'an outsider resolves nothing');
select _as('7fb00000-0000-0000-0000-00000000000d');
select _ok(season_phase_for('7fb00000-0000-0000-0000-00000000000a') is null, 'a guardian resolves nothing (0081)');
select _superuser();
select _ok((season_phase_for('7fb00000-0000-0000-0000-00000000000a') ->> 'phase') = 'pre', 'the service role (auth.uid() null) resolves it for the edge functions');
select _ok(not has_function_privilege('anon', 'season_phase_for(uuid)', 'EXECUTE'), 'anon cannot call season_phase_for');

-- ================================================================ 0252 review round
select _ok(not has_function_privilege('authenticated', 'is_solo_athlete(uuid)', 'EXECUTE')
       and not has_function_privilege('anon', 'is_solo_athlete(uuid)', 'EXECUTE'),
  'is_solo_athlete is not callable by clients (the 0050 is_provable_minor pattern)');
select _as('7fb00000-0000-0000-0000-000000000001');
select _ok(_try($q$select set_my_season_phase('in')$q$) like 'denied(42501)%', 'a coach cannot set a season of their own');
select _as('7fb00000-0000-0000-0000-000000000010');
select _ok(_try($q$select set_my_season_phase('in')$q$) like 'denied(42501)%', 'a trainer cannot set a season of their own');
select _superuser();
select _ok((select count(*) = 0 from athlete_profiles where athlete_id in ('7fb00000-0000-0000-0000-000000000001', '7fb00000-0000-0000-0000-000000000010')),
  'and no athlete profile row was created for either');

-- ================================================================ 0253 target suggestions
select _ok(not has_table_privilege('anon', 'public.target_suggestions', 'SELECT'), 'anon has no access to target_suggestions');
select _ok(not has_table_privilege('authenticated', 'public.target_suggestions', 'UPDATE'), 'no direct UPDATE on target_suggestions');
select _ok(not has_table_privilege('authenticated', 'public.target_suggestions', 'DELETE'), 'no direct DELETE on target_suggestions');
select _ok((select count(*) = 0 from information_schema.columns where table_name = 'target_suggestions' and column_name = 'reason'),
  'no free-text reason: the row carries numbers, the client composes the sentence');
select _ok((select prosrc like '%pg_advisory_xact_lock%' from pg_proc where proname = 'target_suggestions_before_insert'),
  'the insert rails take a per-athlete advisory lock (the cadence race)');

-- A (gain, goal-derived: nothing stored) files one. The pace it claims is ignored: the server fits its own.
select _as('7fb00000-0000-0000-0000-00000000000a');
select _ok(_try($q$insert into target_suggestions (athlete_id, current_protein, current_kcal, proposed_protein, proposed_kcal, pace_lb_wk)
  values ('7fb00000-0000-0000-0000-00000000000a', 185, 3200, 185, 3400, 2.0)$q$) = 'ok',
  'an adult on a gain goal files their own suggestion');
select _ok((select team_id = '7fb00000-0000-0000-0000-0000000000d1' and status = 'pending'
    and pace_lb_wk = 0.2 and plan_lb_wk = 0.5 and weigh_ins = 3 and span_days = 14 and basis_lb = 186.4
  from target_suggestions where athlete_id = '7fb00000-0000-0000-0000-00000000000a'),
  'the server stamps the team, the status, and its OWN pace (0.2 against 0.5, 3 weigh-ins over 14 days)');
select _ok(_try($q$insert into target_suggestions (athlete_id, current_protein, current_kcal, proposed_protein, proposed_kcal)
  values ('7fb00000-0000-0000-0000-00000000000a', 185, 3400, 185, 3600)$q$) like 'denied(23514)%',
  'a second suggestion inside 14 days is refused');
select _ok(_try($q$insert into target_suggestions (athlete_id, current_protein, current_kcal, proposed_protein, proposed_kcal)
  values ('7fb00000-0000-0000-0000-00000000000b', 190, 3100, 190, 3300)$q$) like 'denied(42501)%',
  'nobody files a suggestion for someone else');
select _ok(_try($q$select decide_target_suggestion((select id from target_suggestions where athlete_id = '7fb00000-0000-0000-0000-00000000000a'), 'approved')$q$) like 'denied(42501)%',
  'a team athlete never self-approves');

-- B (gain) has STORED targets: the row is anchored to them, and bounded.
select _superuser();
update athlete_profiles set targets = '{"protein":190,"calories":3100,"style":"guided","weight":200}'::jsonb
 where athlete_id = '7fb00000-0000-0000-0000-00000000000b';
select _as('7fb00000-0000-0000-0000-00000000000b');
select _ok(_try($q$insert into target_suggestions (athlete_id, current_protein, current_kcal, proposed_protein, proposed_kcal)
  values ('7fb00000-0000-0000-0000-00000000000b', 190, 3200, 190, 3400)$q$) like 'denied(23514)%',
  'a current value that is not the stored target is refused (stale)');
select _ok(_try($q$insert into target_suggestions (athlete_id, current_protein, current_kcal, proposed_protein, proposed_kcal)
  values ('7fb00000-0000-0000-0000-00000000000b', 190, 3100, 190, 2900)$q$) like 'denied(23514)%',
  'gaining slower than planned can only suggest MORE food');
select _ok(_try($q$insert into target_suggestions (athlete_id, current_protein, current_kcal, proposed_protein, proposed_kcal)
  values ('7fb00000-0000-0000-0000-00000000000b', 190, 3100, 190, 3400)$q$) like 'denied(23514)%',
  'a calorie step over 250 is refused');
select _ok(_try($q$insert into target_suggestions (athlete_id, current_protein, current_kcal, proposed_protein, proposed_kcal)
  values ('7fb00000-0000-0000-0000-00000000000b', 190, 3100, 70, 3300)$q$) like 'denied(23514)%',
  'protein under the 80g floor is refused');
select _ok(_try($q$insert into target_suggestions (athlete_id, current_protein, current_kcal, proposed_protein, proposed_kcal)
  values ('7fb00000-0000-0000-0000-00000000000b', 190, 3100, 200, 3300)$q$) like 'denied(23514)%',
  'a protein change the per-pound rule does not justify is refused (the bodyweight barely moved)');
select _ok(_try($q$insert into target_suggestions (athlete_id, current_protein, current_kcal, proposed_protein, proposed_kcal)
  values ('7fb00000-0000-0000-0000-00000000000b', 190, 3100, 190, 3300)$q$) = 'ok',
  'the anchored, bounded suggestion files');

-- minor and maintain
select _as('7fb00000-0000-0000-0000-00000000000f');
select _ok(_try($q$insert into target_suggestions (athlete_id, current_protein, current_kcal, proposed_protein, proposed_kcal)
  values ('7fb00000-0000-0000-0000-00000000000f', 150, 2800, 150, 3000)$q$) like 'denied(42501)%',
  'a provable minor gets no suggestion');
select _as('7fb00000-0000-0000-0000-000000000012');
select _ok(_try($q$insert into target_suggestions (athlete_id, current_protein, current_kcal, proposed_protein, proposed_kcal)
  values ('7fb00000-0000-0000-0000-000000000012', 150, 2800, 150, 3000)$q$) like 'denied(23514)%',
  'a maintain goal gets no suggestion');

-- who reads A's
select _as('7fb00000-0000-0000-0000-000000000001');
select _ok((select count(*) = 1 from target_suggestions where athlete_id = '7fb00000-0000-0000-0000-00000000000a'), 'the head coach reads A''s suggestion');
select _as('7fb00000-0000-0000-0000-000000000004');
select _ok((select count(*) = 1 from target_suggestions where athlete_id = '7fb00000-0000-0000-0000-00000000000a'), 'the nutritionist reads A''s suggestion');
select _as('7fb00000-0000-0000-0000-000000000002');
select _ok((select count(*) = 0 from target_suggestions), 'view-only staff see no suggestions');
select _ok(_try($q$select decide_target_suggestion((select id from target_suggestions limit 1), 'declined')$q$) like 'denied%', 'view-only staff cannot decide');
select _as('7fb00000-0000-0000-0000-000000000003');
select _ok((select count(*) = 0 from target_suggestions), 'a position coach sees no suggestions');
select _as('7fb00000-0000-0000-0000-00000000000b');
select _ok((select count(*) = 0 from target_suggestions where athlete_id <> '7fb00000-0000-0000-0000-00000000000b'), 'a teammate sees no one else''s suggestions');
select _as('7fb00000-0000-0000-0000-00000000000d');
select _ok((select count(*) = 0 from target_suggestions), 'a guardian sees no suggestions');
select _as('7fb00000-0000-0000-0000-00000000000c');
select _ok((select count(*) = 0 from target_suggestions), 'an outsider sees no suggestions');
select _as('7fb00000-0000-0000-0000-000000000006');
select _ok((select count(*) = 0 from target_suggestions), 'another team''s head coach sees no suggestions');

-- STAFF APPROVE IS ONE STEP: the decision applies the targets itself, through coach_set_goals.
select _as('7fb00000-0000-0000-0000-000000000001');
select _ok((select decide_target_suggestion((select id from target_suggestions where athlete_id = '7fb00000-0000-0000-0000-00000000000b'), 'approved')) = 'approved',
  'the head coach approves B''s suggestion in one call');
select _superuser();
select _ok((select targets = '{"protein":190,"calories":3300,"style":"guided","weight":200}'::jsonb from athlete_profiles where athlete_id = '7fb00000-0000-0000-0000-00000000000b'),
  'approving wrote the new calories and kept the plan style and weight exactly');
select _ok((select status = 'approved' and decided_by = '7fb00000-0000-0000-0000-000000000001' and decided_at is not null
  from target_suggestions where athlete_id = '7fb00000-0000-0000-0000-00000000000b'), 'approved, by whom and when');
select _as('7fb00000-0000-0000-0000-000000000001');
select _ok(_try($q$select decide_target_suggestion((select id from target_suggestions where athlete_id = '7fb00000-0000-0000-0000-00000000000b'), 'declined')$q$) like 'denied%',
  'a decided suggestion cannot be decided again');

-- STALE: the stored targets moved after the row was filed. The approval re-checks, applies nothing.
select _superuser();
update athlete_profiles set targets = '{"calories":3000}'::jsonb where athlete_id = '7fb00000-0000-0000-0000-00000000000a';
select _as('7fb00000-0000-0000-0000-000000000004');
select _ok((select decide_target_suggestion((select id from target_suggestions where athlete_id = '7fb00000-0000-0000-0000-00000000000a'), 'approved')) = 'stale',
  'approving a suggestion whose current targets changed answers stale');
select _superuser();
select _ok((select targets = '{"calories":3000}'::jsonb from athlete_profiles where athlete_id = '7fb00000-0000-0000-0000-00000000000a'),
  'and the targets were not touched');
select _ok((select status = 'expired' from target_suggestions where athlete_id = '7fb00000-0000-0000-0000-00000000000a'), 'and the row is closed as expired');

-- the practice: the trainer reads and decides, the client cannot self-approve; a decline buys 14 days
select _as('7fb00000-0000-0000-0000-000000000011');
select _ok(_try($q$insert into target_suggestions (athlete_id, current_protein, current_kcal, proposed_protein, proposed_kcal)
  values ('7fb00000-0000-0000-0000-000000000011', 185, 3000, 185, 3200)$q$) = 'ok', 'a practice client files a suggestion');
select _ok((select team_id is null from target_suggestions where athlete_id = '7fb00000-0000-0000-0000-000000000011'), 'a practice suggestion has no team');
select _ok(_try($q$select decide_target_suggestion((select id from target_suggestions where athlete_id = '7fb00000-0000-0000-0000-000000000011'), 'approved')$q$) like 'denied(42501)%',
  'a practice client never self-approves');
select _as('7fb00000-0000-0000-0000-000000000013');
select _ok((select count(*) = 0 from target_suggestions), 'another trainer sees nothing');
select _as('7fb00000-0000-0000-0000-000000000010');
select _ok((select count(*) = 1 from target_suggestions where athlete_id = '7fb00000-0000-0000-0000-000000000011'), 'the trainer reads their client''s suggestion');
select _ok(_try($q$select decide_target_suggestion((select id from target_suggestions where athlete_id = '7fb00000-0000-0000-0000-000000000011'), 'declined')$q$) = 'ok',
  'the trainer declines it');
select _superuser();
update target_suggestions set created_at = now() - interval '20 days' where athlete_id = '7fb00000-0000-0000-0000-000000000011';
select _as('7fb00000-0000-0000-0000-000000000011');
select _ok(_try($q$insert into target_suggestions (athlete_id, current_protein, current_kcal, proposed_protein, proposed_kcal)
  values ('7fb00000-0000-0000-0000-000000000011', 185, 3000, 185, 3200)$q$) like 'denied(23514)%',
  'no new suggestion for 14 days after a decline, however old the row itself is');

-- expiry, and closing a row by hand
select _superuser();
update target_suggestions set status = 'pending', decided_by = null, decided_at = null, created_at = now() - interval '15 days'
 where athlete_id = '7fb00000-0000-0000-0000-000000000011';
select _as('7fb00000-0000-0000-0000-000000000010');
select _ok((select decide_target_suggestion((select id from target_suggestions where athlete_id = '7fb00000-0000-0000-0000-000000000011'), 'declined')) = 'expired',
  'a suggestion older than 14 days expires instead of being decided');
select _superuser();
delete from target_suggestions where athlete_id = '7fb00000-0000-0000-0000-000000000011';
select _as('7fb00000-0000-0000-0000-000000000011');
insert into target_suggestions (athlete_id, current_protein, current_kcal, proposed_protein, proposed_kcal)
  values ('7fb00000-0000-0000-0000-000000000011', 185, 3000, 185, 3200);
select _as('7fb00000-0000-0000-0000-000000000010');
select _ok((select decide_target_suggestion((select id from target_suggestions where athlete_id = '7fb00000-0000-0000-0000-000000000011'), 'expire')) = 'expired',
  'a decider can close a stale suggestion as expired');

-- a solo athlete decides their own, and it touches only the two numbers
select _superuser();
update athlete_profiles set targets = '{"protein":170,"calories":2200,"weight":185}'::jsonb
 where athlete_id = '7fb00000-0000-0000-0000-00000000000e';
select _as('7fb00000-0000-0000-0000-00000000000e');
select _ok(_try($q$insert into target_suggestions (athlete_id, current_protein, current_kcal, proposed_protein, proposed_kcal)
  values ('7fb00000-0000-0000-0000-00000000000e', 170, 2200, 170, 2000)$q$) = 'ok',
  'a solo adult on a lose goal files a suggestion');
select _ok((select pace_lb_wk = -0.3 and plan_lb_wk = -1.0 from target_suggestions where athlete_id = '7fb00000-0000-0000-0000-00000000000e'),
  'the server''s pace for a loser: -0.3 against -1');
select _ok((select decide_target_suggestion((select id from target_suggestions where athlete_id = '7fb00000-0000-0000-0000-00000000000e'), 'approved')) = 'approved',
  'the solo athlete accepts it');
select _superuser();
select _ok((select targets = '{"protein":170,"calories":2000,"weight":185,"source":"self"}'::jsonb
  from athlete_profiles where athlete_id = '7fb00000-0000-0000-0000-00000000000e'), 'accepting wrote only the calories and the self marker');

-- ================================================================ 0254 the targets door
select _superuser();
update athlete_profiles set targets = '{"protein":190,"calories":3000,"weight":200,"style":"guided"}'::jsonb
 where athlete_id = '7fb00000-0000-0000-0000-00000000000a';
select _as('7fb00000-0000-0000-0000-000000000002');
select _ok(_try($q$select coach_set_goals('7fb00000-0000-0000-0000-00000000000a', '{"protein":150,"calories":2000}'::jsonb, null)$q$) like 'denied%',
  'coach_set_goals: view-only staff are refused');
select _as('7fb00000-0000-0000-0000-000000000003');
select _ok(_try($q$select coach_set_goals('7fb00000-0000-0000-0000-00000000000a', '{"protein":150,"calories":2000}'::jsonb, null)$q$) like 'denied%',
  'coach_set_goals: a position coach (no standards rights) is refused');
select _as('7fb00000-0000-0000-0000-000000000014');
select _ok(_try($q$select coach_set_goals('7fb00000-0000-0000-0000-00000000000a', '{"protein":150,"calories":2000}'::jsonb, null)$q$) like 'denied%',
  'coach_set_goals: an athletic trainer (no standards rights) is refused');
select _as('7fb00000-0000-0000-0000-000000000006');
select _ok(_try($q$select coach_set_goals('7fb00000-0000-0000-0000-00000000000a', '{"protein":150,"calories":2000}'::jsonb, null)$q$) like 'denied%',
  'coach_set_goals: another team''s head coach is refused');
select _as('7fb00000-0000-0000-0000-00000000000d');
select _ok(_try($q$select coach_set_goals('7fb00000-0000-0000-0000-00000000000a', '{"protein":150,"calories":2000}'::jsonb, null)$q$) like 'denied%',
  'coach_set_goals: a guardian is refused');
select _as('7fb00000-0000-0000-0000-000000000013');
select _ok(_try($q$select coach_set_goals('7fb00000-0000-0000-0000-000000000011', '{"protein":150,"calories":2000}'::jsonb, null)$q$) like 'denied%',
  'coach_set_goals: another practice''s trainer is refused');
select _superuser();
select _ok((select targets = '{"protein":190,"calories":3000,"weight":200,"style":"guided"}'::jsonb from athlete_profiles where athlete_id = '7fb00000-0000-0000-0000-00000000000a'),
  'every refused write left A''s targets alone');

select _as('7fb00000-0000-0000-0000-000000000001');
select _ok(_try($q$select coach_set_goals('7fb00000-0000-0000-0000-00000000000a', '{"protein":195,"calories":3050,"weight":205,"style":"guided"}'::jsonb, null)$q$) = 'ok',
  'coach_set_goals: the head coach succeeds');
select _ok(_try($q$select coach_set_goals('7fb00000-0000-0000-0000-00000000000a', '{"protein":195,"style":"bogus"}'::jsonb, null)$q$) like 'denied%',
  'coach_set_goals: an unknown plan style is still refused (0142)');
select _as('7fb00000-0000-0000-0000-000000000004');
select _ok(_try($q$select coach_set_goals('7fb00000-0000-0000-0000-00000000000a', '{"protein":196,"calories":3050,"weight":205,"style":"guided"}'::jsonb, null)$q$) = 'ok',
  'coach_set_goals: the nutritionist succeeds');
select _as('7fb00000-0000-0000-0000-000000000005');
select _ok(_try($q$select coach_set_goals('7fb00000-0000-0000-0000-00000000000a', '{"protein":197,"calories":3050,"weight":999}'::jsonb, null)$q$) = 'ok',
  'coach_set_goals: a coordinator succeeds');
select _superuser();
select _ok((select (targets ->> 'protein')::int = 197 and (targets ->> 'weight')::int = 205 from athlete_profiles where athlete_id = '7fb00000-0000-0000-0000-00000000000a'),
  'the 0103 weight guard still holds: a coordinator''s weight is replaced by the stored one');
select _as('7fb00000-0000-0000-0000-000000000010');
select _ok(_try($q$select coach_set_goals('7fb00000-0000-0000-0000-000000000011', '{"protein":180,"calories":2900}'::jsonb, null)$q$) = 'ok',
  'coach_set_goals: the trainer succeeds for their own client');

-- ================================================================ scoreboard
select _superuser();
do $$
declare fails int; total int; bad text;
begin
  select count(*) filter (where not ok), count(*) into fails, total from _st_results;
  raise notice '================================================';
  raise notice 'SEASON + TARGETS SUITE: % / % checks passed', total - fails, total;
  if fails > 0 then
    raise notice 'FAILED CHECKS:';
    for bad in select label from _st_results where not ok order by n loop
      raise notice '  - %', bad;
    end loop;
    raise exception 'SEASON + TARGETS SUITE FAILED: % check(s), see the FAIL lines above', fails;
  end if;
  raise notice 'ALL GREEN.';
end $$;

rollback;
