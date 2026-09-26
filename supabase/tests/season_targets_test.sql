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

-- ================================================================ 0253 target suggestions
select _ok(not has_table_privilege('anon', 'public.target_suggestions', 'SELECT'), 'anon has no access to target_suggestions');
select _ok(not has_table_privilege('authenticated', 'public.target_suggestions', 'UPDATE'), 'no direct UPDATE on target_suggestions');
select _ok(not has_table_privilege('authenticated', 'public.target_suggestions', 'DELETE'), 'no direct DELETE on target_suggestions');

-- athlete A files one
select _as('7fb00000-0000-0000-0000-00000000000a');
select _ok(_try($q$insert into target_suggestions (athlete_id, current_protein, current_kcal, proposed_protein, proposed_kcal, reason)
  values ('7fb00000-0000-0000-0000-00000000000a', 190, 3200, 190, 3400, 'Gaining 0.2 lb a week against a plan of 0.5. Suggest +200 calories.')$q$) = 'ok',
  'an adult on a gain goal files their own suggestion');
select _ok((select team_id = '7fb00000-0000-0000-0000-0000000000d1' and status = 'pending' from target_suggestions
  where athlete_id = '7fb00000-0000-0000-0000-00000000000a'), 'the server stamps the team and the pending status');
select _ok(_try($q$insert into target_suggestions (athlete_id, current_protein, current_kcal, proposed_protein, proposed_kcal, reason)
  values ('7fb00000-0000-0000-0000-00000000000a', 190, 3400, 190, 3600, 'again')$q$) like 'denied(23514)%',
  'a second suggestion inside 14 days is refused');
select _ok(_try($q$insert into target_suggestions (athlete_id, current_protein, current_kcal, proposed_protein, proposed_kcal, reason)
  values ('7fb00000-0000-0000-0000-00000000000b', 190, 3200, 190, 3400, 'for a teammate')$q$) like 'denied(42501)%',
  'nobody files a suggestion for someone else');
select _ok(_try($q$select decide_target_suggestion((select id from target_suggestions where athlete_id = '7fb00000-0000-0000-0000-00000000000a'), 'approved')$q$) like 'denied(42501)%',
  'a team athlete never self-approves');

-- bounds
select _as('7fb00000-0000-0000-0000-00000000000e');
select _ok(_try($q$insert into target_suggestions (athlete_id, current_protein, current_kcal, proposed_protein, proposed_kcal, reason)
  values ('7fb00000-0000-0000-0000-00000000000e', 160, 1600, 160, 1400, 'under the floor')$q$) like 'denied(23514)%',
  'a proposal under the 1500 floor is refused');
select _ok(_try($q$insert into target_suggestions (athlete_id, current_protein, current_kcal, proposed_protein, proposed_kcal, reason)
  values ('7fb00000-0000-0000-0000-00000000000e', 160, 2400, 160, 2000, 'too big a step')$q$) like 'denied(23514)%',
  'a calorie step over 250 is refused');

-- minor and maintain
select _as('7fb00000-0000-0000-0000-00000000000f');
select _ok(_try($q$insert into target_suggestions (athlete_id, current_protein, current_kcal, proposed_protein, proposed_kcal, reason)
  values ('7fb00000-0000-0000-0000-00000000000f', 150, 2800, 150, 3000, 'minor')$q$) like 'denied(42501)%',
  'a provable minor gets no suggestion');
select _as('7fb00000-0000-0000-0000-000000000012');
select _ok(_try($q$insert into target_suggestions (athlete_id, current_protein, current_kcal, proposed_protein, proposed_kcal, reason)
  values ('7fb00000-0000-0000-0000-000000000012', 150, 2800, 150, 3000, 'maintain')$q$) like 'denied(23514)%',
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
select _ok((select count(*) = 0 from target_suggestions), 'a teammate sees no suggestions');
select _as('7fb00000-0000-0000-0000-00000000000d');
select _ok((select count(*) = 0 from target_suggestions), 'a guardian sees no suggestions');
select _as('7fb00000-0000-0000-0000-00000000000c');
select _ok((select count(*) = 0 from target_suggestions), 'an outsider sees no suggestions');

-- the coach approves: only after coach_set_goals applied it
select _as('7fb00000-0000-0000-0000-000000000001');
select _ok(_try($q$select decide_target_suggestion((select id from target_suggestions where athlete_id = '7fb00000-0000-0000-0000-00000000000a'), 'approved')$q$) like 'denied(23514)%',
  'staff cannot mark it approved before the targets are set');
select _ok(_try($q$select coach_set_goals('7fb00000-0000-0000-0000-00000000000a', '{"protein":190,"calories":3400}'::jsonb, null)$q$) = 'ok',
  'the approve path sets the targets through coach_set_goals');
select _ok(_try($q$select decide_target_suggestion((select id from target_suggestions where athlete_id = '7fb00000-0000-0000-0000-00000000000a'), 'approved')$q$) = 'ok',
  'then the coach marks it approved');
select _ok((select status = 'approved' and decided_by = '7fb00000-0000-0000-0000-000000000001' and decided_at is not null
  from target_suggestions where athlete_id = '7fb00000-0000-0000-0000-00000000000a'), 'approved, by whom and when');
select _ok(_try($q$select decide_target_suggestion((select id from target_suggestions where athlete_id = '7fb00000-0000-0000-0000-00000000000a'), 'declined')$q$) like 'denied%',
  'a decided suggestion cannot be decided again');
select _superuser();
select _ok((select (targets ->> 'calories')::int = 3400 and not (targets ? 'source') from athlete_profiles where athlete_id = '7fb00000-0000-0000-0000-00000000000a'),
  'A''s calories are now coach-set');

-- a decline buys 14 quiet days
select _superuser();
insert into target_suggestions (athlete_id, current_protein, current_kcal, proposed_protein, proposed_kcal, reason)
  values ('7fb00000-0000-0000-0000-00000000000b', 190, 3200, 190, 3400, 'B');
update target_suggestions set created_at = now() - interval '13 days' where athlete_id = '7fb00000-0000-0000-0000-00000000000b';
select _as('7fb00000-0000-0000-0000-000000000004');
select _ok(_try($q$select decide_target_suggestion((select id from target_suggestions where athlete_id = '7fb00000-0000-0000-0000-00000000000b'), 'declined')$q$) = 'ok',
  'the nutritionist declines B''s suggestion');
select _superuser();
update target_suggestions set created_at = now() - interval '20 days' where athlete_id = '7fb00000-0000-0000-0000-00000000000b';
select _as('7fb00000-0000-0000-0000-00000000000b');
select _ok(_try($q$insert into target_suggestions (athlete_id, current_protein, current_kcal, proposed_protein, proposed_kcal, reason)
  values ('7fb00000-0000-0000-0000-00000000000b', 190, 3200, 190, 3400, 'B again')$q$) like 'denied(23514)%',
  'no new suggestion for 14 days after a decline');

-- expiry
select _superuser();
update target_suggestions set status = 'pending', decided_by = null, decided_at = null, created_at = now() - interval '15 days'
 where athlete_id = '7fb00000-0000-0000-0000-00000000000b';
select _as('7fb00000-0000-0000-0000-000000000001');
select _ok((select decide_target_suggestion((select id from target_suggestions where athlete_id = '7fb00000-0000-0000-0000-00000000000b'), 'declined')) = 'expired',
  'a suggestion older than 14 days expires instead of being decided');
select _superuser();
select _ok((select status = 'expired' from target_suggestions where athlete_id = '7fb00000-0000-0000-0000-00000000000b'), 'and stays expired');

-- a solo athlete decides their own
select _as('7fb00000-0000-0000-0000-00000000000e');
select _ok(_try($q$insert into target_suggestions (athlete_id, current_protein, current_kcal, proposed_protein, proposed_kcal, reason)
  values ('7fb00000-0000-0000-0000-00000000000e', 160, 2200, 160, 2000, 'Losing 0.3 lb a week against a plan of 1. Suggest -200 calories.')$q$) = 'ok',
  'a solo adult on a lose goal files a suggestion');
select _ok((select team_id is null from target_suggestions where athlete_id = '7fb00000-0000-0000-0000-00000000000e'), 'a solo suggestion has no team');
select _ok(_try($q$select decide_target_suggestion((select id from target_suggestions where athlete_id = '7fb00000-0000-0000-0000-00000000000e'), 'approved')$q$) = 'ok',
  'the solo athlete accepts it');
select _superuser();   -- targets ride athlete_plan_meta (0103), not the direct select
select _ok((select (targets ->> 'calories')::int = 2000 and (targets ->> 'protein')::int = 160 and targets ->> 'source' = 'self'
  from athlete_profiles where athlete_id = '7fb00000-0000-0000-0000-00000000000e'), 'accepting writes their own targets, marked self');
select _as('7fb00000-0000-0000-0000-000000000001');
select _ok((select count(*) = 0 from target_suggestions where athlete_id = '7fb00000-0000-0000-0000-00000000000e'), 'a coach who is not theirs sees nothing');

-- the practice: the trainer reads and decides, the client cannot self-approve
select _as('7fb00000-0000-0000-0000-000000000011');
select _ok(_try($q$insert into target_suggestions (athlete_id, current_protein, current_kcal, proposed_protein, proposed_kcal, reason)
  values ('7fb00000-0000-0000-0000-000000000011', 180, 3000, 180, 3150, 'C')$q$) = 'ok', 'a practice client files a suggestion');
select _ok(_try($q$select decide_target_suggestion((select id from target_suggestions where athlete_id = '7fb00000-0000-0000-0000-000000000011'), 'approved')$q$) like 'denied(42501)%',
  'a practice client never self-approves');
select _as('7fb00000-0000-0000-0000-000000000010');
select _ok((select count(*) = 1 from target_suggestions where athlete_id = '7fb00000-0000-0000-0000-000000000011'), 'the trainer reads their client''s suggestion');
select _ok(_try($q$select decide_target_suggestion((select id from target_suggestions where athlete_id = '7fb00000-0000-0000-0000-000000000011'), 'declined')$q$) = 'ok',
  'the trainer declines it');

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
