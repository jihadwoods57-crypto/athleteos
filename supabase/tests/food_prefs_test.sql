-- OnStandard — food preferences + plan-ideas cache (0250) authorization suite.
--
-- profiles.food_prefs: the athlete reads and writes their own; staff linked to the athlete read
-- it; a teammate, an outsider and a guardian see nothing and change nothing; the shape check
-- refuses a non-object. plan_ideas: the athlete reads their own rows, nobody else reads them, and
-- no client role can write one (meal-chat writes under the service role).
--
-- Run against a migrated local/staging DB, as superuser — NEVER production:
--   psql -v ON_ERROR_STOP=1 -f supabase/tests/food_prefs_test.sql
-- One transaction, rolled back, scoreboard at the end, non-zero exit if any check failed.

begin;

-- ---------------------------------------------------------------- harness
create table _fp_results (n serial, ok boolean, label text);

create or replace function _ok(cond boolean, label text) returns void
language plpgsql security definer as $$
begin
  insert into _fp_results(ok, label) values (coalesce(cond,false), label);
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
select _superuser();
insert into auth.users (id, email) values
  ('7fa00000-0000-0000-0000-000000000001'::uuid, 'fp-coach@x.io'),
  ('7fa00000-0000-0000-0000-00000000000a'::uuid, 'fp-a@x.io'),
  ('7fa00000-0000-0000-0000-00000000000b'::uuid, 'fp-b@x.io'),
  ('7fa00000-0000-0000-0000-00000000000c'::uuid, 'fp-out@x.io'),
  ('7fa00000-0000-0000-0000-00000000000d'::uuid, 'fp-parent@x.io');
insert into profiles (id, full_name, email, primary_role) values
  ('7fa00000-0000-0000-0000-000000000001', 'Coach FP', 'fp-coach@x.io', 'coach'),
  ('7fa00000-0000-0000-0000-00000000000a', 'Athlete A', 'fp-a@x.io', 'athlete'),
  ('7fa00000-0000-0000-0000-00000000000b', 'Athlete B', 'fp-b@x.io', 'athlete'),
  ('7fa00000-0000-0000-0000-00000000000c', 'Outsider', 'fp-out@x.io', 'athlete'),
  ('7fa00000-0000-0000-0000-00000000000d', 'Parent A', 'fp-parent@x.io', 'parent')
on conflict (id) do nothing;
insert into teams (id, name, join_code, created_by) values
  ('7fa00000-0000-0000-0000-0000000000d1'::uuid, 'FP HS', 'FPTEAM01', '7fa00000-0000-0000-0000-000000000001');
insert into team_staff (team_id, staff_id, role, status) values
  ('7fa00000-0000-0000-0000-0000000000d1', '7fa00000-0000-0000-0000-000000000001', 'head_coach', 'active');
insert into team_members (team_id, athlete_id, status) values
  ('7fa00000-0000-0000-0000-0000000000d1', '7fa00000-0000-0000-0000-00000000000a', 'active'),
  ('7fa00000-0000-0000-0000-0000000000d1', '7fa00000-0000-0000-0000-00000000000b', 'active');
insert into guardianships (athlete_id, guardian_id, relationship, status) values
  ('7fa00000-0000-0000-0000-00000000000a', '7fa00000-0000-0000-0000-00000000000d', 'parent', 'active');

-- The column exists, defaults to an empty object, and carries the column grants.
select _ok((select food_prefs = '{}'::jsonb from profiles where id = '7fa00000-0000-0000-0000-00000000000b'),
  'food_prefs defaults to an empty object');
select _ok(has_column_privilege('authenticated', 'public.profiles', 'food_prefs', 'SELECT'), 'authenticated may SELECT food_prefs');
select _ok(has_column_privilege('authenticated', 'public.profiles', 'food_prefs', 'UPDATE'), 'authenticated may UPDATE food_prefs');

-- ---------------------------------------------------------------- owner
select _as('7fa00000-0000-0000-0000-00000000000a');
select _ok(_try($q$update profiles set food_prefs = '{"budget":true,"likes":["rice"],"dislikes":["tuna"]}'::jsonb
  where id = '7fa00000-0000-0000-0000-00000000000a'$q$) = 'ok', 'A writes their own food_prefs');
select _ok((select food_prefs ->> 'budget' = 'true' from profiles where id = '7fa00000-0000-0000-0000-00000000000a'),
  'A reads their own food_prefs back');
select _ok(_try($q$update profiles set food_prefs = '[]'::jsonb where id = '7fa00000-0000-0000-0000-00000000000a'$q$) like 'denied(23514)%',
  'the shape check refuses a non-object');
select _ok(_try($q$update profiles set food_prefs = jsonb_build_object('likes', (select jsonb_agg(md5(i::text)) from generate_series(1, 200) i))
  where id = '7fa00000-0000-0000-0000-00000000000a'$q$) like 'denied(23514)%',
  'the size check refuses an oversized value');

-- ---------------------------------------------------------------- staff
select _as('7fa00000-0000-0000-0000-000000000001');
select _ok((select food_prefs -> 'dislikes' ->> 0 = 'tuna' from profiles where id = '7fa00000-0000-0000-0000-00000000000a'),
  'the linked coach reads A''s food_prefs');
select _try($q$update profiles set food_prefs = '{"budget":false}'::jsonb where id = '7fa00000-0000-0000-0000-00000000000a'$q$);

-- ---------------------------------------------------------------- teammate, outsider, guardian
select _as('7fa00000-0000-0000-0000-00000000000b');
select _ok((select count(*) = 0 from profiles where id = '7fa00000-0000-0000-0000-00000000000a'),
  'a teammate cannot read A''s profile row (so not their food_prefs)');
select _try($q$update profiles set food_prefs = '{"grabGo":true}'::jsonb where id = '7fa00000-0000-0000-0000-00000000000a'$q$);
select _as('7fa00000-0000-0000-0000-00000000000c');
select _ok((select count(*) = 0 from profiles where id = '7fa00000-0000-0000-0000-00000000000a'),
  'an outsider cannot read A''s food_prefs');
select _as('7fa00000-0000-0000-0000-00000000000d');
select _ok((select count(*) = 0 from profiles where id = '7fa00000-0000-0000-0000-00000000000a'),
  'a guardian cannot read A''s food_prefs (0081: scores and grades only)');

select _superuser();
select _ok((select food_prefs = '{"budget":true,"likes":["rice"],"dislikes":["tuna"]}'::jsonb
  from profiles where id = '7fa00000-0000-0000-0000-00000000000a'),
  'nobody but A changed A''s food_prefs (coach, teammate and guardian writes all bounced)');

-- ---------------------------------------------------------------- plan_ideas
insert into plan_ideas (athlete_id, day_date, slot, prefs_key, ideas) values
  ('7fa00000-0000-0000-0000-00000000000a', current_date, 'dinner', 'k1',
   '[{"name":"Turkey rice bowl","protein":42,"kcal":650,"tags":["budget"]}]'::jsonb);

select _as('7fa00000-0000-0000-0000-00000000000a');
select _ok((select count(*) = 1 from plan_ideas where athlete_id = '7fa00000-0000-0000-0000-00000000000a'),
  'A reads their own cached ideas');
select _ok(_try($q$insert into plan_ideas (athlete_id, day_date, slot, ideas)
  values ('7fa00000-0000-0000-0000-00000000000a', current_date, 'lunch', '[]'::jsonb)$q$) like 'denied(42501)%',
  'A cannot write a cache row (the function writes them)');
select _ok(_try($q$update plan_ideas set ideas = '[]'::jsonb where athlete_id = '7fa00000-0000-0000-0000-00000000000a'$q$) like 'denied(42501)%',
  'A cannot rewrite a cache row');
select _ok(_try($q$delete from plan_ideas where athlete_id = '7fa00000-0000-0000-0000-00000000000a'$q$) like 'denied(42501)%',
  'A cannot delete a cache row');

select _as('7fa00000-0000-0000-0000-000000000001');
select _ok((select count(*) = 0 from plan_ideas), 'the coach cannot read A''s cached ideas');
select _as('7fa00000-0000-0000-0000-00000000000b');
select _ok((select count(*) = 0 from plan_ideas), 'a teammate cannot read A''s cached ideas');
select _superuser();
select _ok(not has_table_privilege('anon', 'public.plan_ideas', 'SELECT'), 'anon has no access to plan_ideas');

-- ================================================================ scoreboard
do $$
declare fails int; total int; bad text;
begin
  select count(*) filter (where not ok), count(*) into fails, total from _fp_results;
  raise notice '================================================';
  raise notice 'FOOD PREFS SUITE: % / % checks passed', total - fails, total;
  if fails > 0 then
    raise notice 'FAILED CHECKS:';
    for bad in select label from _fp_results where not ok order by n loop
      raise notice '  - %', bad;
    end loop;
    raise exception 'FOOD PREFS SUITE FAILED: % check(s), see the FAIL lines above', fails;
  end if;
  raise notice 'ALL GREEN.';
end $$;

rollback;
