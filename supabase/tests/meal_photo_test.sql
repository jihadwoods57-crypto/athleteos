-- OnStandard — no photo, no meal (0251) suite.
--
-- An athlete's insert with no photo_path, an empty one, one outside their own meal-photos folder,
-- or a bare folder is refused with 23514 'photo_required'. A photo hash or source alone is not a
-- photo. The legacy insert shape (path only, no hash or source) still logs. An update can never
-- clear or swap a photo, but moves and corrections that patch other columns still land. Past
-- no-photo rows stay readable, editable and deletable. The service role is held to the rule; a
-- direct database session is not. The Trust Pass still spends without creating a meal, a real
-- photo meal still refunds the credit, and the coach's pro_correct_meal still corrects a plate.
--
-- Run against a migrated local/staging DB, as superuser — NEVER production:
--   psql -v ON_ERROR_STOP=1 -f supabase/tests/meal_photo_test.sql
-- One transaction, rolled back, scoreboard at the end, non-zero exit if any check failed.

begin;

-- ---------------------------------------------------------------- harness
create table _mp_results (n serial, ok boolean, label text);

create or replace function _ok(cond boolean, label text) returns void
language plpgsql security definer as $$
begin
  insert into _mp_results(ok, label) values (coalesce(cond,false), label);
  if coalesce(cond,false) then raise notice 'PASS: %', label;
  else raise warning 'FAIL: %', label; end if;
end $$;
grant execute on function _ok(boolean, text) to authenticated, anon, service_role;

create or replace function _as(p_uid uuid) returns void
language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claim.sub', p_uid::text, false);
  perform set_config('request.jwt.claims', json_build_object(
    'sub', p_uid, 'role', 'authenticated', 'aal', 'aal2')::text, false);
  execute 'set role authenticated';
end $$;
grant execute on function _as(uuid) to authenticated, anon, service_role;

-- The edge functions' client: the service role key, no user.
create or replace function _as_service() returns void
language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claim.sub', '', false);
  perform set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, false);
  execute 'set role service_role';
end $$;
grant execute on function _as_service() to authenticated, anon, service_role;

create or replace function _superuser() returns void
language plpgsql as $$ begin
  execute 'reset role';
  perform set_config('request.jwt.claim.sub', '', false);
  perform set_config('request.jwt.claims', '', false);
end $$;
grant execute on function _superuser() to authenticated, anon, service_role;

create or replace function _try(p_sql text) returns text
language plpgsql as $$
begin
  execute p_sql;
  return 'ok';
exception when others then
  return 'denied(' || sqlstate || '): ' || sqlerrm;
end $$;
grant execute on function _try(text) to authenticated, anon, service_role;

-- ---------------------------------------------------------------- seed
select _superuser();
insert into auth.users (id, email) values
  ('7b100000-0000-0000-0000-000000000001'::uuid, 'mp-coach@x.io'),
  ('7b100000-0000-0000-0000-00000000000a'::uuid, 'mp-a@x.io'),
  ('7b100000-0000-0000-0000-00000000000b'::uuid, 'mp-b@x.io');
insert into profiles (id, full_name, email, primary_role) values
  ('7b100000-0000-0000-0000-000000000001', 'Coach MP', 'mp-coach@x.io', 'coach'),
  ('7b100000-0000-0000-0000-00000000000a', 'Athlete A', 'mp-a@x.io', 'athlete'),
  ('7b100000-0000-0000-0000-00000000000b', 'Athlete B', 'mp-b@x.io', 'athlete')
on conflict (id) do nothing;
insert into teams (id, name, join_code, created_by) values
  ('7b100000-0000-0000-0000-0000000000d1'::uuid, 'MP HS', 'MPTEAM01', '7b100000-0000-0000-0000-000000000001');
insert into team_staff (team_id, staff_id, role, status) values
  ('7b100000-0000-0000-0000-0000000000d1', '7b100000-0000-0000-0000-000000000001', 'head_coach', 'active');
insert into team_members (team_id, athlete_id, status) values
  ('7b100000-0000-0000-0000-0000000000d1', '7b100000-0000-0000-0000-00000000000a', 'active');

-- A legacy no-photo meal from before the rule (a direct session, which the rule does not hold:
-- this is also the "operator repair" door).
select _ok(_try($q$insert into meals (id, athlete_id, day_date, type, name, protein, kcal, source)
  values ('7b100000-0000-0000-0000-0000000000e1', '7b100000-0000-0000-0000-00000000000a', current_date - 3,
          'lunch', 'Plate from search', 40, 600, 'manual')$q$) = 'ok',
  'a direct database session (postgres) may still write a no-photo row');

select _ok(exists (select 1 from pg_trigger where tgname = 'meals_photo_required'
                   and tgrelid = 'public.meals'::regclass and not tgisinternal),
  'the meals_photo_required trigger is installed');
select _ok(not has_function_privilege('authenticated', 'public.enforce_meal_photo()', 'EXECUTE')
       and not has_function_privilege('anon', 'public.enforce_meal_photo()', 'EXECUTE'),
  'the trigger function is not callable as an RPC');

-- ---------------------------------------------------------------- inserts, as athlete A
select _as('7b100000-0000-0000-0000-00000000000a');

select _ok(_try($q$insert into meals (id, athlete_id, day_date, type, name, photo_path, photo_hash, source, protein, kcal)
  values ('7b100000-0000-0000-0000-0000000000a1', '7b100000-0000-0000-0000-00000000000a', current_date, 'breakfast', 'Eggs',
          '7b100000-0000-0000-0000-00000000000a/2026-09-26/breakfast.jpg', repeat('a', 64), 'live', 30, 420)$q$) = 'ok',
  'a photo meal logs (the current client''s full row)');

select _ok(_try($q$insert into meals (athlete_id, day_date, type, name, photo_path, protein, kcal)
  values ('7b100000-0000-0000-0000-00000000000a', current_date, 'lunch', 'Bowl',
          '7b100000-0000-0000-0000-00000000000a/2026-09-26/lunch.jpg', 40, 700)$q$) = 'ok',
  'the pre-0062 fallback shape (path only, no hash or source) still logs');

select _ok(_try($q$insert into meals (athlete_id, day_date, type, name, protein, kcal)
  values ('7b100000-0000-0000-0000-00000000000a', current_date, 'dinner', 'Typed dinner', 40, 600)$q$)
  = 'denied(23514): photo_required',
  'no photo_path: refused with exactly 23514 photo_required');

select _ok(_try($q$insert into meals (athlete_id, day_date, type, name, photo_path, source)
  values ('7b100000-0000-0000-0000-00000000000a', current_date, 'dinner', 'x', '', 'manual')$q$)
  = 'denied(23514): photo_required',
  'an empty photo_path is refused');

select _ok(_try($q$insert into meals (athlete_id, day_date, type, name, photo_path)
  values ('7b100000-0000-0000-0000-00000000000a', current_date, 'dinner', 'x', '7b100000-0000-0000-0000-00000000000a/')$q$)
  = 'denied(23514): photo_required',
  'a bare folder is refused');

select _ok(_try($q$insert into meals (athlete_id, day_date, type, name, photo_path)
  values ('7b100000-0000-0000-0000-00000000000a', current_date, 'dinner', 'x', '7b100000-0000-0000-0000-00000000000b/2026-09-26/dinner.jpg')$q$)
  = 'denied(23514): photo_required',
  'a path in ANOTHER athlete''s folder is refused');

select _ok(_try($q$insert into meals (athlete_id, day_date, type, name, photo_path)
  values ('7b100000-0000-0000-0000-00000000000a', current_date, 'dinner', 'x', 'anything.jpg')$q$)
  = 'denied(23514): photo_required',
  'a path outside the athlete''s folder is refused');

select _ok(_try($q$insert into meals (athlete_id, day_date, type, name, photo_hash, source)
  values ('7b100000-0000-0000-0000-00000000000a', current_date, 'dinner', 'x', repeat('b', 64), 'live')$q$)
  = 'denied(23514): photo_required',
  'a hash and a live source with no path are not a photo');

select _ok(_try($q$insert into meals (athlete_id, day_date, type, name, source)
  values ('7b100000-0000-0000-0000-00000000000a', current_date, 'snack', 'Protein bar', 'label')$q$)
  = 'denied(23514): photo_required',
  'an old build''s label log is refused');

-- The RLS boundary still answers first for a stranger's valid-looking row.
select _as('7b100000-0000-0000-0000-00000000000b');
select _ok(_try($q$insert into meals (athlete_id, day_date, type, name, photo_path)
  values ('7b100000-0000-0000-0000-00000000000a', current_date, 'dinner', 'planted', '7b100000-0000-0000-0000-00000000000a/2026-09-26/dinner.jpg')$q$)
  like 'denied(42501)%',
  'B still cannot plant a (photo) meal on A: RLS, 42501');

-- ---------------------------------------------------------------- updates, as athlete A
select _as('7b100000-0000-0000-0000-00000000000a');

select _ok(_try($q$update meals set type = 'lunch', name = 'Lunch' where id = '7b100000-0000-0000-0000-0000000000a1'$q$) = 'ok',
  'moving a photo meal to another slot still lands (state.js moveMeal)');
select _ok(_try($q$update meals set protein = 34, kcal = 450, quality = 80, note = 'x · [Athlete correction] more eggs',
  detected = '["Eggs"]'::jsonb, name = 'Eggs and toast' where id = '7b100000-0000-0000-0000-0000000000a1'$q$) = 'ok',
  'a correction mirror still lands');
select _ok(_try($q$update meals set photo_path = null where id = '7b100000-0000-0000-0000-0000000000a1'$q$)
  = 'denied(23514): photo_required',
  'a photo cannot be stripped from a logged meal');
select _ok(_try($q$update meals set photo_path = '7b100000-0000-0000-0000-00000000000a/2026-09-20/other.jpg'
  where id = '7b100000-0000-0000-0000-0000000000a1'$q$) = 'denied(23514): photo_required',
  'a photo cannot be swapped for another path');
select _ok((select photo_path = '7b100000-0000-0000-0000-00000000000a/2026-09-26/breakfast.jpg'
            from meals where id = '7b100000-0000-0000-0000-0000000000a1'),
  'the photo meal still carries its original photo');

-- Past no-photo rows: readable, editable, and a path can only be added if it is a real one.
select _ok((select count(*) = 1 from meals where id = '7b100000-0000-0000-0000-0000000000e1' and photo_path is null),
  'a legacy no-photo meal still reads back');
select _ok(_try($q$update meals set protein = 45 where id = '7b100000-0000-0000-0000-0000000000e1'$q$) = 'ok',
  'a legacy no-photo meal can still be corrected');
select _ok(_try($q$update meals set photo_path = 'x.jpg' where id = '7b100000-0000-0000-0000-0000000000e1'$q$)
  = 'denied(23514): photo_required',
  'a legacy row cannot gain a bogus path');

-- ---------------------------------------------------------------- the coach's correction (0199)
select _as('7b100000-0000-0000-0000-000000000001');
select _ok(_try($q$select pro_correct_meal('7b100000-0000-0000-0000-0000000000a1'::uuid,
  '{"protein": 38, "kcal": 480}'::jsonb, 'two more eggs')$q$) = 'ok',
  'pro_correct_meal still corrects a photo meal');
select _superuser();
select _ok((select protein = 38 and photo_path is not null from meals where id = '7b100000-0000-0000-0000-0000000000a1'),
  'the pro correction landed and the photo stayed');

-- ---------------------------------------------------------------- the service role
select _as_service();
select _ok(_try($q$insert into meals (athlete_id, day_date, type, name)
  values ('7b100000-0000-0000-0000-00000000000b', current_date, 'dinner', 'server-made')$q$)
  = 'denied(23514): photo_required',
  'the service role is held too: no server path around the rule');
select _ok(_try($q$insert into meals (athlete_id, day_date, type, name, photo_path)
  values ('7b100000-0000-0000-0000-00000000000b', current_date, 'dinner', 'server-made',
          '7b100000-0000-0000-0000-00000000000b/2026-09-26/dinner.jpg')$q$) = 'ok',
  'the service role may write a photo meal');

-- ---------------------------------------------------------------- the Trust Pass (0196)
select _superuser();
insert into trust_passes (id, athlete_id, granted_by, team_id, credits_total, expires_on) values
  ('7b100000-0000-0000-0000-0000000000f1', '7b100000-0000-0000-0000-00000000000a',
   '7b100000-0000-0000-0000-000000000001', '7b100000-0000-0000-0000-0000000000d1', 3, current_date + 14);

select _as('7b100000-0000-0000-0000-00000000000a');
select _ok(_try($q$select spend_pass(current_date, 'dinner')$q$) = 'ok',
  'a Trust Pass credit still spends on an open slot');
select _ok((select count(*) = 0 from meals where athlete_id = '7b100000-0000-0000-0000-00000000000a'
            and day_date = current_date and type = 'dinner'),
  'spending the pass created no meal (it scores from the median, not a row)');
select _ok(_try($q$insert into meals (athlete_id, day_date, type, name, photo_path)
  values ('7b100000-0000-0000-0000-00000000000a', current_date, 'dinner', 'Salmon',
          '7b100000-0000-0000-0000-00000000000a/2026-09-26/dinner.jpg')$q$) = 'ok',
  'a real photo dinner logs over the covered slot');
select _superuser();
select _ok((select count(*) = 0 from pass_spends where pass_id = '7b100000-0000-0000-0000-0000000000f1'),
  'the photo meal refunded the credit (meals_refund_pass_spend still fires)');

-- ---------------------------------------------------------------- deletes
select _as('7b100000-0000-0000-0000-00000000000a');
select _ok(_try($q$delete from meals where id = '7b100000-0000-0000-0000-0000000000e1'$q$) = 'ok',
  'an athlete can still delete a meal (unlogMeal)');

-- ================================================================ scoreboard
select _superuser();
do $$
declare fails int; total int; bad text;
begin
  select count(*) filter (where not ok), count(*) into fails, total from _mp_results;
  raise notice '================================================';
  raise notice 'MEAL PHOTO SUITE: % / % checks passed', total - fails, total;
  if fails > 0 then
    raise notice 'FAILED CHECKS:';
    for bad in select label from _mp_results where not ok order by n loop
      raise notice '  - %', bad;
    end loop;
    raise exception 'MEAL PHOTO SUITE FAILED: % check(s), see the FAIL lines above', fails;
  end if;
  raise notice 'ALL GREEN.';
end $$;

rollback;
