-- OnStandard: lessons and team challenges (0256) suite.
--
-- PARITY. The fixtures between the PARITY FIXTURES markers are read, verbatim, by
-- proto/redesign-2026-07/js/challenge-parity.test.mjs, which runs the app's own weekly-focus model
-- on them and asserts the same `expect` values this file asserts from the SQL port. Change a
-- fixture here and both sides re-check it. Keep the block valid JSON.
--
-- Lessons: only a team's editors assign (to the team or one of its rooms); every active staffer
-- reads the team's assignments, an athlete reads the ones that reach them (team-wide or their own
-- room), nobody else reads any; nobody updates one; completions are written only through
-- complete_lesson for the caller, read by the athlete and their team's staff, never a guardian.
-- Challenges: only editors start or end one, one open per team, the day rows decide the hits
-- (the same definitions as the weekly focus), staff see names, an athlete sees the team as a count.
-- Push once: claim_teach_push hands out an assignment's or a challenge's audience exactly once.
--
-- Run against a migrated local/staging DB, as superuser — NEVER production:
--   psql -v ON_ERROR_STOP=1 -f supabase/tests/lessons_challenges_test.sql
-- One transaction, rolled back, scoreboard at the end, non-zero exit if any check failed.

begin;

-- ---------------------------------------------------------------- harness
create table _lc_results (n serial, ok boolean, label text);

create or replace function _ok(cond boolean, label text) returns void
language plpgsql security definer as $$
begin
  insert into _lc_results(ok, label) values (coalesce(cond,false), label);
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

create or replace function _n(p_sql text) returns int
language plpgsql as $$
declare c int;
begin
  execute p_sql;
  get diagnostics c = row_count;
  return c;
exception when others then
  return -1;
end $$;
grant execute on function _n(text) to authenticated, anon;

create or replace function _j(p_sql text) returns jsonb
language plpgsql as $$
declare r jsonb;
begin
  execute p_sql into r;
  return r;
exception when others then
  return jsonb_build_object('error', sqlstate);
end $$;
grant execute on function _j(text) to authenticated, anon;

-- ================================================================ PARITY (pure functions)
-- PARITY FIXTURES BEGIN
create temp table _fx as select $fx$
{
  "hits": [
    { "name": "breakfast protein over the share", "habit": "protein:breakfast", "meals": { "breakfast": true }, "checkin": { "slotMacros": { "breakfast": { "protein": 58 } } }, "required": ["breakfast", "lunch", "dinner"], "due": { "breakfast": 570, "lunch": 840, "dinner": 1230 }, "target": 180, "expect": true },
    { "name": "exactly 90% of a 60g share", "habit": "protein:breakfast", "meals": { "breakfast": true }, "checkin": { "slotMacros": { "breakfast": { "protein": 54 } } }, "required": ["breakfast", "lunch", "dinner"], "due": {}, "target": 180, "expect": true },
    { "name": "just under 90%", "habit": "protein:breakfast", "meals": { "breakfast": true }, "checkin": { "slotMacros": { "breakfast": { "protein": 53.9 } } }, "required": ["breakfast", "lunch", "dinner"], "due": {}, "target": 180, "expect": false },
    { "name": "protein as a numeric string", "habit": "protein:breakfast", "meals": { "breakfast": true }, "checkin": { "slotMacros": { "breakfast": { "protein": "56" } } }, "required": ["breakfast", "lunch", "dinner"], "due": {}, "target": 180, "expect": true },
    { "name": "protein on an unlogged slot", "habit": "protein:breakfast", "meals": { "breakfast": false }, "checkin": { "slotMacros": { "breakfast": { "protein": 60 } } }, "required": ["breakfast", "lunch", "dinner"], "due": {}, "target": 180, "expect": false },
    { "name": "a read still pending is no evidence", "habit": "protein:breakfast", "meals": { "breakfast": true }, "checkin": { "slotMacros": { "breakfast": { "protein": 60, "pending": true } } }, "required": ["breakfast", "lunch", "dinner"], "due": {}, "target": 180, "expect": null },
    { "name": "a failed read is no evidence", "habit": "protein:breakfast", "meals": { "breakfast": true }, "checkin": { "slotMacros": { "breakfast": { "protein": 60, "analysisFailed": true } } }, "required": ["breakfast", "lunch", "dinner"], "due": {}, "target": 180, "expect": null },
    { "name": "a duplicate photo never scores", "habit": "protein:breakfast", "meals": { "breakfast": true }, "checkin": { "slotMacros": { "breakfast": { "protein": 70, "flagged": "dup" } } }, "required": ["breakfast", "lunch", "dinner"], "due": {}, "target": 180, "expect": false },
    { "name": "logged with no read at all", "habit": "protein:breakfast", "meals": { "breakfast": true }, "checkin": {}, "required": ["breakfast", "lunch", "dinner"], "due": {}, "target": 180, "expect": null },
    { "name": "no day row", "habit": "protein:breakfast", "meals": null, "checkin": null, "required": ["breakfast", "lunch", "dinner"], "due": {}, "target": 180, "expect": false },
    { "name": "lunch on a two-meal standard is not part of it", "habit": "protein:lunch", "meals": { "lunch": true }, "checkin": { "slotMacros": { "lunch": { "protein": 90 } } }, "required": ["breakfast", "dinner"], "due": {}, "target": 180, "expect": null },
    { "name": "four meals, 185g: a 45g share, 40.5 hits", "habit": "protein:dinner", "meals": { "dinner": 1 }, "checkin": { "slotMacros": { "dinner": { "protein": 40.5 } } }, "required": ["breakfast", "lunch", "snack", "dinner"], "due": {}, "target": 185, "expect": true },
    { "name": "four meals, 185g: 40.4 misses", "habit": "protein:dinner", "meals": { "dinner": "yes" }, "checkin": { "slotMacros": { "dinner": { "protein": 40.4 } } }, "required": ["breakfast", "lunch", "snack", "dinner"], "due": {}, "target": 185, "expect": false },
    { "name": "two meals, 175g: 17.5 rounds up to a 90g share", "habit": "protein:breakfast", "meals": { "breakfast": true }, "checkin": { "slotMacros": { "breakfast": { "protein": 81 } } }, "required": ["breakfast", "dinner"], "due": {}, "target": 175, "expect": true },
    { "name": "two meals, 175g: 80.9 misses", "habit": "protein:breakfast", "meals": { "breakfast": true }, "checkin": { "slotMacros": { "breakfast": { "protein": 80.9 } } }, "required": ["breakfast", "dinner"], "due": {}, "target": 175, "expect": false },
    { "name": "a meal ticked with 0 is not logged", "habit": "protein:breakfast", "meals": { "breakfast": 0 }, "checkin": { "slotMacros": { "breakfast": { "protein": 60 } } }, "required": ["breakfast", "lunch", "dinner"], "due": {}, "target": 180, "expect": false },
    { "name": "every required meal in", "habit": "missed", "meals": { "breakfast": true, "lunch": true, "dinner": true }, "checkin": {}, "required": ["breakfast", "lunch", "dinner"], "due": {}, "target": 180, "expect": true },
    { "name": "one required meal missing", "habit": "missed", "meals": { "breakfast": true, "lunch": false, "dinner": true, "snack": true }, "checkin": {}, "required": ["breakfast", "lunch", "dinner"], "due": {}, "target": 180, "expect": false },
    { "name": "a duplicate photo is a missing meal", "habit": "missed", "meals": { "breakfast": true, "lunch": true, "dinner": true }, "checkin": { "slotMacros": { "lunch": { "flagged": "dup" } } }, "required": ["breakfast", "lunch", "dinner"], "due": {}, "target": 180, "expect": false },
    { "name": "a required snack missing", "habit": "missed", "meals": { "breakfast": true, "lunch": true, "dinner": true }, "checkin": {}, "required": ["breakfast", "lunch", "snack", "dinner"], "due": {}, "target": 180, "expect": false },
    { "name": "no meals at all is not every meal in", "habit": "missed", "meals": {}, "checkin": {}, "required": ["breakfast", "lunch", "dinner"], "due": {}, "target": 180, "expect": false },
    { "name": "all on time", "habit": "late", "meals": { "breakfast": true, "lunch": true, "dinner": true }, "checkin": { "mealLoggedAt": { "breakfast": 500, "lunch": 800, "dinner": 1100 } }, "required": ["breakfast", "lunch", "dinner"], "due": { "breakfast": 570, "lunch": 840, "dinner": 1230 }, "target": 180, "expect": true },
    { "name": "dinner ten minutes late", "habit": "late", "meals": { "breakfast": true, "lunch": true, "dinner": true }, "checkin": { "mealLoggedAt": { "breakfast": 500, "lunch": 800, "dinner": 1240 } }, "required": ["breakfast", "lunch", "dinner"], "due": { "breakfast": 570, "lunch": 840, "dinner": 1230 }, "target": 180, "expect": false },
    { "name": "logged at the deadline minute is on time", "habit": "late", "meals": { "breakfast": true }, "checkin": { "mealLoggedAt": { "breakfast": 570 } }, "required": ["breakfast", "lunch", "dinner"], "due": { "breakfast": 570, "lunch": 840, "dinner": 1230 }, "target": 180, "expect": true },
    { "name": "grace carries a late-looking dinner", "habit": "late", "meals": { "dinner": true }, "checkin": { "mealLoggedAt": { "dinner": 1250 } }, "required": ["breakfast", "lunch", "dinner"], "due": { "breakfast": 570, "lunch": 840, "dinner": 1260 }, "target": 180, "expect": true },
    { "name": "no time on record is not late", "habit": "late", "meals": { "lunch": true }, "checkin": {}, "required": ["breakfast", "lunch", "dinner"], "due": { "breakfast": 570, "lunch": 840, "dinner": 1230 }, "target": 180, "expect": true },
    { "name": "a time as a numeric string", "habit": "late", "meals": { "lunch": true }, "checkin": { "mealLoggedAt": { "lunch": "900" } }, "required": ["breakfast", "lunch", "dinner"], "due": { "breakfast": 570, "lunch": 840, "dinner": 1230 }, "target": 180, "expect": false },
    { "name": "nothing logged is not on time", "habit": "late", "meals": {}, "checkin": {}, "required": ["breakfast", "lunch", "dinner"], "due": {}, "target": 180, "expect": false },
    { "name": "a late duplicate does not count against you", "habit": "late", "meals": { "breakfast": true, "dinner": true }, "checkin": { "slotMacros": { "dinner": { "flagged": "dup" } }, "mealLoggedAt": { "breakfast": 500, "dinner": 1400 } }, "required": ["breakfast", "lunch", "dinner"], "due": { "breakfast": 570, "lunch": 840, "dinner": 1230 }, "target": 180, "expect": true },
    { "name": "a required snack logged", "habit": "snack", "meals": { "snack": true }, "checkin": {}, "required": ["breakfast", "lunch", "snack", "dinner"], "due": {}, "target": 180, "expect": true },
    { "name": "a required snack not logged", "habit": "snack", "meals": { "snack": false }, "checkin": {}, "required": ["breakfast", "lunch", "snack", "dinner"], "due": {}, "target": 180, "expect": false },
    { "name": "the snack where it is not required", "habit": "snack", "meals": { "snack": true }, "checkin": {}, "required": ["breakfast", "lunch", "dinner"], "due": {}, "target": 180, "expect": null },
    { "name": "no target makes any logged protein a hit", "habit": "protein:lunch", "meals": { "lunch": true }, "checkin": { "slotMacros": { "lunch": { "protein": 0 } } }, "required": ["breakfast", "lunch", "dinner"], "due": {}, "target": 0, "expect": true }
  ],
  "ctx": [
    { "name": "no standard is the classic day", "items": null, "dayType": "any", "expect": { "required": ["breakfast", "lunch", "dinner"], "due": { "breakfast": 570, "lunch": 840, "dinner": 1230 } } },
    { "name": "three meals with the coach's windows", "items": [
        { "id": "m1", "title": "Breakfast", "kind": "meal", "proof": "photo", "window": { "open": 420, "due": 600 } },
        { "id": "m2", "title": "Lunch", "kind": "meal", "proof": "photo", "window": { "open": 690, "due": 900 } },
        { "id": "m3", "title": "Dinner", "kind": "meal", "proof": "photo", "window": { "due": 1200 } }
      ], "dayType": "any", "expect": { "required": ["breakfast", "lunch", "dinner"], "due": { "breakfast": 600, "lunch": 900, "dinner": 1200 } } },
    { "name": "four meals, one with grace, no windows", "items": [
        { "id": "m1", "title": "Breakfast", "kind": "meal", "proof": "photo", "grace": 15 },
        { "id": "m2", "title": "Lunch", "kind": "meal", "proof": "photo" },
        { "id": "m3", "title": "Snack", "kind": "meal", "proof": "photo", "snack": true },
        { "id": "m4", "title": "Dinner", "kind": "meal", "proof": "photo" }
      ], "dayType": "any", "expect": { "required": ["breakfast", "lunch", "snack", "dinner"], "due": { "breakfast": 585, "lunch": 840, "snack": 1020, "dinner": 1230 } } },
    { "name": "a fifth meal has no classic window", "items": [
        { "id": "m1", "title": "A", "kind": "meal", "proof": "photo" },
        { "id": "m2", "title": "B", "kind": "meal", "proof": "photo" },
        { "id": "m3", "title": "C", "kind": "meal", "proof": "photo" },
        { "id": "m4", "title": "D", "kind": "meal", "proof": "photo" },
        { "id": "m5", "title": "E", "kind": "meal", "proof": "photo", "grace": 12.5 }
      ], "dayType": "any", "expect": { "required": ["breakfast", "lunch", "snack", "dinner", "meal-5"], "due": { "breakfast": 570, "lunch": 840, "snack": 1020, "dinner": 1230, "meal-5": 1453 } } },
    { "name": "two meals among other items", "items": [
        { "id": "l1", "title": "Lift", "kind": "lift", "proof": "check" },
        { "id": "m1", "title": "Breakfast", "kind": "meal", "proof": "photo", "window": { "due": 540 } },
        { "id": "w1", "title": "Weigh", "kind": "weigh", "proof": "scale" },
        { "id": "m2", "title": "Dinner", "kind": "meal", "proof": "photo", "grace": 240 }
      ], "dayType": "any", "expect": { "required": ["breakfast", "dinner"], "due": { "breakfast": 540, "dinner": 1470 } } },
    { "name": "a rest day drops the training-day meal", "items": [
        { "id": "m1", "title": "Breakfast", "kind": "meal", "proof": "photo", "dayType": "any" },
        { "id": "m2", "title": "Pre-practice", "kind": "meal", "proof": "photo", "dayType": "training" },
        { "id": "m3", "title": "Lunch", "kind": "meal", "proof": "photo", "dayType": "rest" },
        { "id": "m4", "title": "Dinner", "kind": "meal", "proof": "photo" }
      ], "dayType": "rest", "expect": { "required": ["breakfast", "lunch", "dinner"], "due": { "breakfast": 570, "lunch": 840, "dinner": 1230 } } },
    { "name": "with no weekly pattern nothing is dropped", "items": [
        { "id": "m1", "title": "Breakfast", "kind": "meal", "proof": "photo", "dayType": "any" },
        { "id": "m2", "title": "Pre-practice", "kind": "meal", "proof": "photo", "dayType": "training" },
        { "id": "m3", "title": "Lunch", "kind": "meal", "proof": "photo", "dayType": "rest" },
        { "id": "m4", "title": "Dinner", "kind": "meal", "proof": "photo" }
      ], "dayType": "any", "expect": { "required": ["breakfast", "lunch", "snack", "dinner"], "due": { "breakfast": 570, "lunch": 840, "snack": 1020, "dinner": 1230 } } },
    { "name": "seven meals stop at six", "items": [
        { "id": "m1", "title": "A", "kind": "meal", "proof": "photo" },
        { "id": "m2", "title": "B", "kind": "meal", "proof": "photo" },
        { "id": "m3", "title": "C", "kind": "meal", "proof": "photo" },
        { "id": "m4", "title": "D", "kind": "meal", "proof": "photo" },
        { "id": "m5", "title": "E", "kind": "meal", "proof": "photo" },
        { "id": "m6", "title": "F", "kind": "meal", "proof": "photo", "window": { "due": 1380 } },
        { "id": "m7", "title": "G", "kind": "meal", "proof": "photo" }
      ], "dayType": "any", "expect": { "required": ["breakfast", "lunch", "snack", "dinner", "meal-5", "meal-6"], "due": { "breakfast": 570, "lunch": 840, "snack": 1020, "dinner": 1230, "meal-5": 1440, "meal-6": 1380 } } },
    { "name": "one meal is dinner", "items": [
        { "id": "m1", "title": "Team dinner", "kind": "meal", "proof": "photo", "window": { "due": 1170 } }
      ], "dayType": "training", "expect": { "required": ["dinner"], "due": { "dinner": 1170 } } }
  ],
  "targets": [
    { "goal": null, "bw": 187, "targets": null, "expect": 180 },
    { "goal": "", "bw": 187, "targets": { "protein": 220 }, "expect": 180 },
    { "goal": "gain", "bw": 187, "targets": null, "expect": 185 },
    { "goal": "build", "bw": 212, "targets": null, "expect": 210 },
    { "goal": "lose", "bw": 187, "targets": null, "expect": 170 },
    { "goal": "lose", "bw": 175, "targets": null, "expect": 160 },
    { "goal": "lose_fat", "bw": 205, "targets": {}, "expect": 185 },
    { "goal": "maintain", "bw": 187, "targets": null, "expect": 150 },
    { "goal": "health", "bw": 90, "targets": null, "expect": 80 },
    { "goal": "perform", "bw": 187, "targets": null, "expect": 180 },
    { "goal": "gain", "bw": null, "targets": null, "expect": 170 },
    { "goal": "gain", "bw": 0, "targets": null, "expect": 170 },
    { "goal": "gain", "bw": 187, "targets": { "protein": 200 }, "expect": 200 },
    { "goal": "gain", "bw": 187, "targets": { "protein": "210" }, "expect": 210 },
    { "goal": "maintain", "bw": 187, "targets": { "protein": 0, "calories": 2800 }, "expect": 150 },
    { "goal": "lose", "bw": 187, "targets": { "protein": 187.6 }, "expect": 188 },
    { "goal": "lose", "bw": 187, "targets": { "protein": "lots" }, "expect": 170 }
  ],
  "people": [
    { "name": "no stored weight, a logged one", "goal": "gain", "base": null, "logged": 205, "targets": null, "expect": 205 },
    { "name": "no stored weight, a logged decimal", "goal": "lose", "base": null, "logged": 187.4, "targets": null, "expect": 170 },
    { "name": "the stored weight wins over a logged one", "goal": "gain", "base": 190, "logged": 205, "targets": null, "expect": 190 },
    { "name": "no weight anywhere is the 171 lb stand-in", "goal": "gain", "base": null, "logged": null, "targets": null, "expect": 170 },
    { "name": "a coach number wins over any weight", "goal": "maintain", "base": null, "logged": 205, "targets": { "protein": 175 }, "expect": 175 },
    { "name": "a zero stored weight falls through to the logged one", "goal": "maintain", "base": 0, "logged": 200, "targets": null, "expect": 160 }
  ]
}
$fx$::jsonb as j;
-- PARITY FIXTURES END

select _ok(focus_day_hit(f ->> 'habit', f -> 'meals', f -> 'checkin',
                         array(select jsonb_array_elements_text(f -> 'required')), f -> 'due', (f ->> 'target')::numeric)
           is not distinct from (case when f -> 'expect' = 'null'::jsonb then null else (f ->> 'expect')::boolean end),
           'parity hit: ' || (f ->> 'name'))
  from _fx, jsonb_array_elements(_fx.j -> 'hits') f;

select _ok(std_day_ctx(f -> 'items', f ->> 'dayType') = f -> 'expect', 'parity day: ' || (f ->> 'name'))
  from _fx, jsonb_array_elements(_fx.j -> 'ctx') f;

select _ok(protein_target_from(f ->> 'goal', (f ->> 'bw')::numeric, f -> 'targets') = (f ->> 'expect')::int,
           'parity target: ' || coalesce(f ->> 'goal', 'no goal') || ' ' || coalesce(f ->> 'bw', 'no weight') || ' ' || coalesce(f ->> 'targets', ''))
  from _fx, jsonb_array_elements(_fx.j -> 'targets') f;

select _ok((select count(*) from jsonb_array_elements((select j from _fx) -> 'hits')) >= 30, 'parity: the hit fixtures are all there');

select _ok(protein_target_from(f ->> 'goal', goal_bodyweight_from((f ->> 'base')::numeric, (f ->> 'logged')::numeric), f -> 'targets') = (f ->> 'expect')::int,
           'parity person: ' || (f ->> 'name'))
  from _fx, jsonb_array_elements(_fx.j -> 'people') f;

-- ---------------------------------------------------------------- seed
-- 01 head coach T1 · 02 view-only T1 · 03 position coach T1 · 04 nutritionist T1 · 05 head coach T2
-- 0a athlete A (T1, room R1) · 0e athlete E (T1, no room) · 0b athlete B (T2) · 0f athlete F (T2)
-- 0c outsider · 0d guardian of A
select _superuser();
insert into auth.users (id, email) values
  ('7fd00000-0000-0000-0000-000000000001'::uuid, 'lc-coach@x.io'),
  ('7fd00000-0000-0000-0000-000000000002'::uuid, 'lc-ro@x.io'),
  ('7fd00000-0000-0000-0000-000000000003'::uuid, 'lc-pos@x.io'),
  ('7fd00000-0000-0000-0000-000000000004'::uuid, 'lc-rd@x.io'),
  ('7fd00000-0000-0000-0000-000000000005'::uuid, 'lc-coach2@x.io'),
  ('7fd00000-0000-0000-0000-00000000000a'::uuid, 'lc-a@x.io'),
  ('7fd00000-0000-0000-0000-00000000000e'::uuid, 'lc-e@x.io'),
  ('7fd00000-0000-0000-0000-00000000000b'::uuid, 'lc-b@x.io'),
  ('7fd00000-0000-0000-0000-00000000000f'::uuid, 'lc-f@x.io'),
  ('7fd00000-0000-0000-0000-00000000000c'::uuid, 'lc-out@x.io'),
  ('7fd00000-0000-0000-0000-00000000000d'::uuid, 'lc-parent@x.io');
insert into profiles (id, full_name, email, primary_role) values
  ('7fd00000-0000-0000-0000-000000000001', 'Gary Grinch', 'lc-coach@x.io', 'coach'),
  ('7fd00000-0000-0000-0000-000000000002', 'Viewer LC', 'lc-ro@x.io', 'coach'),
  ('7fd00000-0000-0000-0000-000000000003', 'Position LC', 'lc-pos@x.io', 'coach'),
  ('7fd00000-0000-0000-0000-000000000004', 'Dana Diet', 'lc-rd@x.io', 'coach'),
  ('7fd00000-0000-0000-0000-000000000005', 'Coach Two', 'lc-coach2@x.io', 'coach'),
  ('7fd00000-0000-0000-0000-00000000000a', 'Athlete Alpha', 'lc-a@x.io', 'athlete'),
  ('7fd00000-0000-0000-0000-00000000000e', 'Athlete Echo', 'lc-e@x.io', 'athlete'),
  ('7fd00000-0000-0000-0000-00000000000b', 'Athlete Bravo', 'lc-b@x.io', 'athlete'),
  ('7fd00000-0000-0000-0000-00000000000f', 'Athlete Foxtrot', 'lc-f@x.io', 'athlete'),
  ('7fd00000-0000-0000-0000-00000000000c', 'Outsider', 'lc-out@x.io', 'athlete'),
  ('7fd00000-0000-0000-0000-00000000000d', 'Parent A', 'lc-parent@x.io', 'parent')
on conflict (id) do update set full_name = excluded.full_name, primary_role = excluded.primary_role;
insert into teams (id, name, join_code, created_by) values
  ('7fd00000-0000-0000-0000-0000000000d1'::uuid, 'LC One', 'LCTEAM01', '7fd00000-0000-0000-0000-000000000001'),
  ('7fd00000-0000-0000-0000-0000000000d2'::uuid, 'LC Two', 'LCTEAM02', '7fd00000-0000-0000-0000-000000000005');
insert into team_staff (team_id, staff_id, role, status) values
  ('7fd00000-0000-0000-0000-0000000000d1', '7fd00000-0000-0000-0000-000000000001', 'head_coach', 'active'),
  ('7fd00000-0000-0000-0000-0000000000d1', '7fd00000-0000-0000-0000-000000000002', 'readonly', 'active'),
  ('7fd00000-0000-0000-0000-0000000000d1', '7fd00000-0000-0000-0000-000000000003', 'position_coach', 'active'),
  ('7fd00000-0000-0000-0000-0000000000d1', '7fd00000-0000-0000-0000-000000000004', 'nutritionist', 'active'),
  ('7fd00000-0000-0000-0000-0000000000d2', '7fd00000-0000-0000-0000-000000000005', 'head_coach', 'active');
insert into team_rooms (id, team_id, key, label, created_by) values
  ('7fd00000-0000-0000-0000-0000000000c1'::uuid, '7fd00000-0000-0000-0000-0000000000d1', 'linebackers', 'Linebackers', '7fd00000-0000-0000-0000-000000000001'),
  ('7fd00000-0000-0000-0000-0000000000c2'::uuid, '7fd00000-0000-0000-0000-0000000000d2', 'skill', 'Skill', '7fd00000-0000-0000-0000-000000000005');
insert into team_members (team_id, athlete_id, status, joined_at, room_id) values
  ('7fd00000-0000-0000-0000-0000000000d1', '7fd00000-0000-0000-0000-00000000000a', 'active', now() - interval '30 days', '7fd00000-0000-0000-0000-0000000000c1'),
  ('7fd00000-0000-0000-0000-0000000000d1', '7fd00000-0000-0000-0000-00000000000e', 'active', now() - interval '30 days', null),
  ('7fd00000-0000-0000-0000-0000000000d2', '7fd00000-0000-0000-0000-00000000000b', 'active', now() - interval '30 days', null),
  ('7fd00000-0000-0000-0000-0000000000d2', '7fd00000-0000-0000-0000-00000000000f', 'active', now() - interval '30 days', null);
insert into guardianships (athlete_id, guardian_id, relationship, status) values
  ('7fd00000-0000-0000-0000-00000000000a', '7fd00000-0000-0000-0000-00000000000d', 'parent', 'active');
insert into athlete_profiles (athlete_id, base_goal, base_weight) values
  ('7fd00000-0000-0000-0000-00000000000a', 'gain', 187)
on conflict (athlete_id) do update set base_goal = excluded.base_goal, base_weight = excluded.base_weight;

select _ok(staff_display_label('7fd00000-0000-0000-0000-000000000001', '7fd00000-0000-0000-0000-0000000000d1') = 'Coach Grinch',
  'names: a coach is "Coach <last name>"');
select _ok(staff_display_label('7fd00000-0000-0000-0000-000000000004', '7fd00000-0000-0000-0000-0000000000d1') = 'Dana Diet',
  'names: a nutritionist goes by their own name');
update profiles set coach_display_name = 'Coach G' where id = '7fd00000-0000-0000-0000-000000000001';
select _ok(staff_display_label('7fd00000-0000-0000-0000-000000000001', '7fd00000-0000-0000-0000-0000000000d1') = 'Coach G',
  'names: the coach''s own display name wins');
update profiles set coach_display_name = null where id = '7fd00000-0000-0000-0000-000000000001';

-- ================================================================ lesson assignments
select _as('7fd00000-0000-0000-0000-000000000004');
select _ok(_try($q$insert into lesson_assignments (id, team_id, lesson_id) values ('7fd00000-0000-0000-0000-0000000000a1', '7fd00000-0000-0000-0000-0000000000d1', 'carbs-are-fuel')$q$) = 'ok',
  'assign: the nutritionist assigns a lesson to the whole team');
select _as('7fd00000-0000-0000-0000-000000000001');
select _ok(_try($q$insert into lesson_assignments (id, team_id, lesson_id, room_id, due_on, pushed_at, assigned_by)
  values ('7fd00000-0000-0000-0000-0000000000a2', '7fd00000-0000-0000-0000-0000000000d1', 'hydration-basics', '7fd00000-0000-0000-0000-0000000000c1', current_date + 3, now(), '7fd00000-0000-0000-0000-000000000004')$q$) = 'ok',
  'assign: the head coach assigns a lesson to a room, with a due date');
select _superuser();
select _ok((select pushed_at is null and assigned_by = '7fd00000-0000-0000-0000-000000000001' from lesson_assignments where id = '7fd00000-0000-0000-0000-0000000000a2'),
  'assign: pushed_at cannot be preset and assigned_by is the caller');

select _as('7fd00000-0000-0000-0000-000000000002');
select _ok(_try($q$insert into lesson_assignments (team_id, lesson_id) values ('7fd00000-0000-0000-0000-0000000000d1', 'game-day')$q$) <> 'ok',
  'assign: view-only staff cannot assign');
select _as('7fd00000-0000-0000-0000-000000000003');
select _ok(_try($q$insert into lesson_assignments (team_id, lesson_id) values ('7fd00000-0000-0000-0000-0000000000d1', 'game-day')$q$) <> 'ok',
  'assign: a position coach cannot assign');
select _as('7fd00000-0000-0000-0000-00000000000a');
select _ok(_try($q$insert into lesson_assignments (team_id, lesson_id) values ('7fd00000-0000-0000-0000-0000000000d1', 'game-day')$q$) <> 'ok',
  'assign: an athlete cannot assign');
select _as('7fd00000-0000-0000-0000-000000000005');
select _ok(_try($q$insert into lesson_assignments (team_id, lesson_id) values ('7fd00000-0000-0000-0000-0000000000d1', 'game-day')$q$) <> 'ok',
  'assign: another team''s head coach cannot assign to this team');
select _as('7fd00000-0000-0000-0000-000000000001');
select _ok(_try($q$insert into lesson_assignments (team_id, lesson_id) values ('7fd00000-0000-0000-0000-0000000000d1', 'keto-secrets')$q$) <> 'ok',
  'assign: an unknown lesson id is refused');
select _ok(_try($q$insert into lesson_assignments (team_id, lesson_id, room_id) values ('7fd00000-0000-0000-0000-0000000000d1', 'game-day', '7fd00000-0000-0000-0000-0000000000c2')$q$) <> 'ok',
  'assign: another team''s room is refused');
select _ok(_try($q$insert into lesson_assignments (team_id, lesson_id, due_on) values ('7fd00000-0000-0000-0000-0000000000d1', 'game-day', current_date + 400)$q$) <> 'ok',
  'assign: a due date a year out is refused');
select _ok(_try($q$insert into lesson_assignments (team_id, lesson_id) values ('7fd00000-0000-0000-0000-0000000000d1', 'carbs-are-fuel')$q$) <> 'ok',
  'assign: the same lesson to the same audience twice is refused');
select _ok(_n($q$update lesson_assignments set due_on = current_date + 5 where id = '7fd00000-0000-0000-0000-0000000000a1'$q$) <= 0,
  'assign: nobody updates an assignment (not even the head coach)');

-- reads
select _as('7fd00000-0000-0000-0000-00000000000a');
select _ok((select count(*) from lesson_assignments) = 2, 'assign read: the room''s athlete reads the team one and their room''s');
select _as('7fd00000-0000-0000-0000-00000000000e');
select _ok((select count(*) from lesson_assignments) = 1, 'assign read: an athlete outside the room reads only the team one');
select _as('7fd00000-0000-0000-0000-000000000002');
select _ok((select count(*) from lesson_assignments) = 2, 'assign read: view-only staff read both');
select _as('7fd00000-0000-0000-0000-00000000000b');
select _ok((select count(*) from lesson_assignments) = 0, 'assign read: another team''s athlete reads none');
select _as('7fd00000-0000-0000-0000-00000000000d');
select _ok((select count(*) from lesson_assignments) = 0, 'assign read: a guardian reads none');
select _as('7fd00000-0000-0000-0000-00000000000c');
select _ok((select count(*) from lesson_assignments) = 0, 'assign read: an outsider reads none');
select _as('7fd00000-0000-0000-0000-000000000005');
select _ok((select count(*) from lesson_assignments) = 0, 'assign read: another team''s coach reads none');

-- ================================================================ completions
select _as('7fd00000-0000-0000-0000-00000000000a');
select _ok(_try($q$select complete_lesson('carbs-are-fuel', false)$q$) = 'ok', 'complete: the athlete records a finished lesson');
select _ok((select quiz_correct = false from lesson_completions where lesson_id = 'carbs-are-fuel'), 'complete: a wrong answer is recorded as wrong');
select _ok(_try($q$select complete_lesson('carbs-are-fuel', true)$q$) = 'ok', 'complete: finishing it again is allowed');
select _ok((select quiz_correct from lesson_completions where lesson_id = 'carbs-are-fuel'), 'complete: a later right answer upgrades it');
select _ok(_try($q$select complete_lesson('carbs-are-fuel', false)$q$) = 'ok'
  and (select quiz_correct from lesson_completions where lesson_id = 'carbs-are-fuel'), 'complete: a right answer never goes back to wrong');
select _ok((select count(*) from lesson_completions where lesson_id = 'carbs-are-fuel') = 1, 'complete: still one row per athlete and lesson');
select _ok(_try($q$select complete_lesson('not-a-lesson', true)$q$) <> 'ok', 'complete: an unknown lesson is refused');
select _ok(_try($q$insert into lesson_completions (athlete_id, lesson_id) values ('7fd00000-0000-0000-0000-00000000000a', 'game-day')$q$) <> 'ok',
  'complete: no direct insert, even for yourself');
select _ok(_try($q$insert into lesson_completions (athlete_id, lesson_id) values ('7fd00000-0000-0000-0000-00000000000e', 'game-day')$q$) <> 'ok',
  'complete: no writing someone else''s completion');
select _ok(_n($q$update lesson_completions set quiz_correct = true$q$) <= 0 and _n($q$delete from lesson_completions$q$) <= 0,
  'complete: no update or delete from the app');

select _as('7fd00000-0000-0000-0000-00000000000a');
select _ok((select count(*) from lesson_completions) = 1, 'completion read: the athlete reads their own');
select _as('7fd00000-0000-0000-0000-00000000000e');
select _ok((select count(*) from lesson_completions) = 0, 'completion read: a teammate reads none of it');
select _as('7fd00000-0000-0000-0000-000000000001');
select _ok((select count(*) from lesson_completions) = 1, 'completion read: the head coach reads their athlete''s');
select _as('7fd00000-0000-0000-0000-000000000002');
select _ok((select count(*) from lesson_completions) = 1, 'completion read: view-only staff read it too');
select _as('7fd00000-0000-0000-0000-000000000005');
select _ok((select count(*) from lesson_completions) = 0, 'completion read: another team''s coach reads none');
select _as('7fd00000-0000-0000-0000-00000000000d');
select _ok((select count(*) from lesson_completions) = 0, 'completion read: a guardian reads none');
select _as('7fd00000-0000-0000-0000-00000000000c');
select _ok((select count(*) from lesson_completions) = 0, 'completion read: an outsider reads none');

-- boards
select _as('7fd00000-0000-0000-0000-000000000002');
select _ok((select (x ->> 'done')::int = 1 and (x ->> 'total')::int = 2 from jsonb_array_elements(team_lessons('7fd00000-0000-0000-0000-0000000000d1')) x where x ->> 'lesson_id' = 'carbs-are-fuel'),
  'board: 1 of 2 done on the team lesson (view-only staff may read progress)');
select _ok((select (x ->> 'total')::int = 1 and x ->> 'room_label' = 'Linebackers' from jsonb_array_elements(team_lessons('7fd00000-0000-0000-0000-0000000000d1')) x where x ->> 'lesson_id' = 'hydration-basics'),
  'board: the room lesson counts only the room');
select _ok((select jsonb_array_length(lesson_assignment_progress('7fd00000-0000-0000-0000-0000000000a1') -> 'athletes') = 2),
  'board: the per-athlete progress lists the whole audience');
select _ok((select (x ->> 'done')::boolean from jsonb_array_elements(lesson_assignment_progress('7fd00000-0000-0000-0000-0000000000a1') -> 'athletes') x where x ->> 'name' = 'Athlete Alpha'),
  'board: and marks who has finished, by name, for staff');
select _as('7fd00000-0000-0000-0000-00000000000a');
select _ok(_j($q$select team_lessons('7fd00000-0000-0000-0000-0000000000d1')$q$) ? 'error', 'board: an athlete cannot read the staff board');
select _ok(_j($q$select lesson_assignment_progress('7fd00000-0000-0000-0000-0000000000a1')$q$) ? 'error', 'board: nor the per-athlete progress');
select _as('7fd00000-0000-0000-0000-00000000000d');
select _ok(_j($q$select lesson_assignment_progress('7fd00000-0000-0000-0000-0000000000a1')$q$) ? 'error', 'board: a guardian cannot either');
select _as('7fd00000-0000-0000-0000-000000000005');
select _ok(_j($q$select team_lessons('7fd00000-0000-0000-0000-0000000000d1')$q$) ? 'error', 'board: another team''s coach cannot either');

-- my_learning
select _as('7fd00000-0000-0000-0000-00000000000a');
select _ok((select jsonb_array_length(my_learning(current_date) -> 'assignments') = 2
   and jsonb_array_length(my_learning(current_date) -> 'completions') = 1), 'my_learning: the athlete gets both lessons and their completion');
select _ok((select x ->> 'from' = 'Coach Grinch' from jsonb_array_elements(my_learning(current_date) -> 'assignments') x where x ->> 'lesson_id' = 'hydration-basics'),
  'my_learning: the room lesson says who it is from');
select _as('7fd00000-0000-0000-0000-00000000000e');
select _ok((select jsonb_array_length(my_learning(current_date) -> 'assignments') = 1), 'my_learning: outside the room, only the team lesson');
select _as('7fd00000-0000-0000-0000-00000000000d');
select _ok((select jsonb_array_length(my_learning(current_date) -> 'assignments') = 0 and my_learning(current_date) -> 'challenge' = 'null'::jsonb),
  'my_learning: a guardian gets nothing');

-- ================================================================ push once (lessons)
select _as('7fd00000-0000-0000-0000-000000000002');
select _ok(_j($q$select claim_teach_push('lesson', '7fd00000-0000-0000-0000-0000000000a2')$q$) ? 'error', 'push: view-only staff cannot claim a push');
select _as('7fd00000-0000-0000-0000-000000000001');
select _ok((select (r ->> 'claimed')::boolean and jsonb_array_length(r -> 'athlete_ids') = 1
              and r -> 'athlete_ids' ? '7fd00000-0000-0000-0000-00000000000a'
              and r ->> 'body' = 'Coach Grinch assigned a 1-minute lesson: Hydration basics'
              and r ->> 'route' = 'lesson/hydration-basics'
            from (select claim_teach_push('lesson', '7fd00000-0000-0000-0000-0000000000a2') r) s),
  'push: the first claim returns the room''s athletes and the words');
select _ok((select not (claim_teach_push('lesson', '7fd00000-0000-0000-0000-0000000000a2') ->> 'claimed')::boolean),
  'push: the second claim for the same assignment is refused (push once)');
select _as('7fd00000-0000-0000-0000-000000000004');
select _ok((select (r ->> 'claimed')::boolean and jsonb_array_length(r -> 'athlete_ids') = 2 and not (r -> 'athlete_ids' ? '7fd00000-0000-0000-0000-00000000000b')
            from (select claim_teach_push('lesson', '7fd00000-0000-0000-0000-0000000000a1') r) s),
  'push: a team lesson reaches the whole team and nobody else');
select _ok((select not (claim_teach_push('lesson', '7fd00000-0000-0000-0000-0000000000a1') ->> 'claimed')::boolean),
  'push: and only once');

-- delete
select _as('7fd00000-0000-0000-0000-000000000002');
select _ok(_n($q$delete from lesson_assignments where id = '7fd00000-0000-0000-0000-0000000000a1'$q$) <= 0, 'assign: view-only staff cannot remove one');
select _as('7fd00000-0000-0000-0000-000000000004');
select _ok(_n($q$delete from lesson_assignments where id = '7fd00000-0000-0000-0000-0000000000a1'$q$) = 1, 'assign: an editor removes one');

-- ================================================================ challenges
select _as('7fd00000-0000-0000-0000-000000000002');
select _ok(_try($q$select start_team_challenge('7fd00000-0000-0000-0000-0000000000d1', 'protein:breakfast', current_date - 2, current_date + 4, 5)$q$) like 'denied(42501)%',
  'challenge: view-only staff cannot start one');
select _as('7fd00000-0000-0000-0000-000000000003');
select _ok(_try($q$select start_team_challenge('7fd00000-0000-0000-0000-0000000000d1', 'protein:breakfast', current_date - 2, current_date + 4, 5)$q$) like 'denied(42501)%',
  'challenge: a position coach cannot start one');
select _as('7fd00000-0000-0000-0000-00000000000a');
select _ok(_try($q$select start_team_challenge('7fd00000-0000-0000-0000-0000000000d1', 'protein:breakfast', current_date - 2, current_date + 4, 5)$q$) like 'denied(42501)%',
  'challenge: an athlete cannot start one');
select _ok(_try($q$insert into team_challenges (team_id, habit, starts_on, ends_on) values ('7fd00000-0000-0000-0000-0000000000d1', 'missed', current_date, current_date + 6)$q$) <> 'ok',
  'challenge: nobody inserts one directly');
select _as('7fd00000-0000-0000-0000-000000000001');
select _ok(_try($q$select start_team_challenge('7fd00000-0000-0000-0000-0000000000d1', 'breakfast', current_date, current_date + 6, 5)$q$) like 'denied(22023)%',
  'challenge: an unknown habit is refused');
select _ok(_try($q$select start_team_challenge('7fd00000-0000-0000-0000-0000000000d1', 'missed', current_date, current_date + 14, 5)$q$) like 'denied(22023)%',
  'challenge: fifteen days is refused');
select _ok(_try($q$select start_team_challenge('7fd00000-0000-0000-0000-0000000000d1', 'missed', current_date, current_date + 2, 5)$q$) like 'denied(22023)%',
  'challenge: a goal longer than the range is refused');
select _ok(_try($q$select start_team_challenge('7fd00000-0000-0000-0000-0000000000d1', 'missed', current_date - 30, current_date - 24, 5)$q$) like 'denied(22023)%',
  'challenge: a range already over is refused');

create temp table _ch (id uuid);
grant all on _ch to authenticated;
insert into _ch select start_team_challenge('7fd00000-0000-0000-0000-0000000000d1', 'protein:breakfast', current_date - 2, current_date + 4, 5);
select _ok((select count(*) from _ch where id is not null) = 1, 'challenge: the head coach starts one');
select _ok(_try($q$select start_team_challenge('7fd00000-0000-0000-0000-0000000000d1', 'missed', current_date, current_date + 3, 3)$q$) like 'denied(23505)%',
  'challenge: one running per team');
select _ok(_try($q$select start_team_challenge('7fd00000-0000-0000-0000-0000000000d1', 'missed', current_date + 7, current_date + 13, 5)$q$) like 'denied(23505)%',
  'fix: scheduling next week while one runs is refused (one active or upcoming per team)');
select _ok((select ended_at is null from team_challenges where id = (select id from _ch)),
  'fix: and the running challenge is untouched');
select _as('7fd00000-0000-0000-0000-00000000000a');
select _ok((select count(*) from team_challenges) = 1, 'challenge read: the team''s athlete reads it');
select _as('7fd00000-0000-0000-0000-00000000000b');
select _ok((select count(*) from team_challenges) = 0, 'challenge read: another team''s athlete does not');
select _as('7fd00000-0000-0000-0000-00000000000d');
select _ok((select count(*) from team_challenges) = 0, 'challenge read: a guardian does not');
select _as('7fd00000-0000-0000-0000-00000000000c');
select _ok((select count(*) from team_challenges) = 0, 'challenge read: an outsider does not');

-- The day rows decide it. A (gain, 187 lb -> 185 g, a 60 g share of three meals, 54 g counts):
-- two days ago 60 g, yesterday 50 g, today 58 g. E (no goal -> 180 g, the same 54 g): nothing.
select _superuser();
insert into days (athlete_id, date, meals, checkin) values
  ('7fd00000-0000-0000-0000-00000000000a', current_date - 2, '{"breakfast":true}', '{"slotMacros":{"breakfast":{"protein":60}}}'),
  ('7fd00000-0000-0000-0000-00000000000a', current_date - 1, '{"breakfast":true}', '{"slotMacros":{"breakfast":{"protein":50}}}'),
  ('7fd00000-0000-0000-0000-00000000000a', current_date, '{"breakfast":true}', '{"slotMacros":{"breakfast":{"protein":58}}}'),
  ('7fd00000-0000-0000-0000-00000000000b', current_date - 1, '{"breakfast":true}', '{"slotMacros":{"breakfast":{"protein":90}}}');
select _ok(athlete_protein_target('7fd00000-0000-0000-0000-00000000000a') = 185 and athlete_protein_target('7fd00000-0000-0000-0000-00000000000e') = 180,
  'targets: the stored goal and weight give 185 g; none gives the 180 g default');

select _as('7fd00000-0000-0000-0000-000000000002');
create temp table _board as select team_challenge_board('7fd00000-0000-0000-0000-0000000000d1', null, current_date) b;
select _ok((select (b ->> 'total')::int = 2 and (b ->> 'on_track')::int = 1 from _board),
  'challenge board: 1 of 2 on track (view-only staff may read it)');
select _ok((select (x ->> 'hits')::int = 2 and (x ->> 'on_track')::boolean from _board, jsonb_array_elements(b -> 'athletes') x where x ->> 'name' = 'Athlete Alpha'),
  'challenge board: A hit two of three days and keeps pace');
select _ok((select (x ->> 'hits')::int = 0 and not (x ->> 'on_track')::boolean from _board, jsonb_array_elements(b -> 'athletes') x where x ->> 'name' = 'Athlete Echo'),
  'challenge board: E has no hits and is behind pace');
select _ok((select jsonb_array_length(x -> 'days') = 7 and (x -> 'days' -> 3 -> 'hit') = 'null'::jsonb
            from _board, jsonb_array_elements(b -> 'athletes') x where x ->> 'name' = 'Athlete Alpha'),
  'challenge board: seven days, the future ones unjudged');
select _ok((select not (b::text like '%Athlete Bravo%') from _board), 'challenge board: another team''s athlete is not on it');

select _as('7fd00000-0000-0000-0000-00000000000a');
create temp table _mine as select my_learning(current_date) m;
select _ok((select (m -> 'challenge' ->> 'team_on_track')::int = 1 and (m -> 'challenge' ->> 'team_total')::int = 2
              and (m -> 'challenge' -> 'mine' ->> 'hits')::int = 2 from _mine),
  'my_learning: the athlete gets their own hits and the team as a count');
select _ok((select not (m::text like '%7fd00000-0000-0000-0000-00000000000e%') and not (m::text like '%Echo%') from _mine),
  'my_learning: never a teammate''s id or name');
select _ok(_j($q$select team_challenge_board('7fd00000-0000-0000-0000-0000000000d1', null, current_date)$q$) ? 'error',
  'challenge board: an athlete cannot read the staff board');
select _as('7fd00000-0000-0000-0000-00000000000d');
select _ok(_j($q$select team_challenge_board('7fd00000-0000-0000-0000-0000000000d1', null, current_date)$q$) ? 'error',
  'challenge board: a guardian cannot either');

-- push once (challenges)
select _as('7fd00000-0000-0000-0000-000000000004');
select _ok((select (r ->> 'claimed')::boolean and jsonb_array_length(r -> 'athlete_ids') = 2
              and r ->> 'body' = 'Coach Grinch started a team challenge: Protein at breakfast. Goal: 5 of 7 days.'
            from (select claim_teach_push('challenge', (select id from _ch)) r) s),
  'push: a new challenge is announced to the team, from the coach who started it');
select _ok((select not (claim_teach_push('challenge', (select id from _ch)) ->> 'claimed')::boolean), 'push: once');

-- end
select _as('7fd00000-0000-0000-0000-000000000002');
select _ok(_try($q$select end_team_challenge((select id from _ch))$q$) like 'denied(42501)%', 'challenge: view-only staff cannot end it');
select _as('7fd00000-0000-0000-0000-000000000004');
select _ok((select end_team_challenge((select id from _ch))), 'challenge: an editor ends it');
select _as('7fd00000-0000-0000-0000-00000000000a');
select _ok((select my_learning(current_date) -> 'challenge' = 'null'::jsonb), 'challenge: once ended it leaves the athlete''s Home');
select _as('7fd00000-0000-0000-0000-000000000001');
select _ok(_try($q$select start_team_challenge('7fd00000-0000-0000-0000-0000000000d1', 'missed', current_date, current_date + 6, 5)$q$) = 'ok',
  'challenge: and the next one can start');

-- ================================================================ the stored standard, resolved
-- T2: a team standard of four meals, a position standard for LB of two, B plays LB. F has no position.
select _superuser();
update athlete_profiles set position = 'LB' where athlete_id = '7fd00000-0000-0000-0000-00000000000b';
insert into athlete_profiles (athlete_id, position) values ('7fd00000-0000-0000-0000-00000000000b', 'LB') on conflict (athlete_id) do nothing;
insert into requirement_sets (team_id, scope_kind, scope_value, items, created_by) values
  ('7fd00000-0000-0000-0000-0000000000d2', 'team', null,
   '[{"id":"b","title":"Breakfast","kind":"meal","proof":"photo","window":{"due":600}},{"id":"l","title":"Lunch","kind":"meal","proof":"photo"},{"id":"s","title":"Pre-practice","kind":"meal","proof":"photo","dayType":"training"},{"id":"d","title":"Dinner","kind":"meal","proof":"photo","grace":20}]',
   '7fd00000-0000-0000-0000-000000000005'),
  ('7fd00000-0000-0000-0000-0000000000d2', 'position', 'lb',
   '[{"id":"b","title":"Breakfast","kind":"meal","proof":"photo"},{"id":"d","title":"Dinner","kind":"meal","proof":"photo"}]',
   '7fd00000-0000-0000-0000-000000000005');
select _ok(athlete_day_ctx('7fd00000-0000-0000-0000-00000000000f', '7fd00000-0000-0000-0000-0000000000d2', current_date) -> 'required'
           = '["breakfast","lunch","snack","dinner"]'::jsonb,
  'standard: an athlete with no position gets the team''s four meals');
select _ok(athlete_day_ctx('7fd00000-0000-0000-0000-00000000000f', '7fd00000-0000-0000-0000-0000000000d2', current_date) -> 'due'
           = '{"breakfast":600,"lunch":840,"snack":1020,"dinner":1250}'::jsonb,
  'standard: with the coach''s window and grace');
select _ok(athlete_day_ctx('7fd00000-0000-0000-0000-00000000000b', '7fd00000-0000-0000-0000-0000000000d2', current_date) -> 'required'
           = '["breakfast","dinner"]'::jsonb,
  'standard: the position standard outranks the team''s');
insert into requirement_sets (team_id, scope_kind, scope_value, items, created_by) values
  ('7fd00000-0000-0000-0000-0000000000d2', 'position', 'SKILL',
   '[{"id":"b","title":"Breakfast","kind":"meal","proof":"photo"},{"id":"l","title":"Lunch","kind":"meal","proof":"photo"},{"id":"d","title":"Dinner","kind":"meal","proof":"photo"},{"id":"x","title":"Late","kind":"meal","proof":"photo"},{"id":"y","title":"Night","kind":"meal","proof":"photo"}]',
   '7fd00000-0000-0000-0000-000000000005');
update team_members set room_id = '7fd00000-0000-0000-0000-0000000000c2' where athlete_id = '7fd00000-0000-0000-0000-00000000000b';
select _ok(jsonb_array_length(athlete_day_ctx('7fd00000-0000-0000-0000-00000000000b', '7fd00000-0000-0000-0000-0000000000d2', current_date) -> 'required') = 5,
  'standard: an assigned room''s label outranks the raw position');
insert into requirement_sets (team_id, scope_kind, scope_value, items, created_by, effective_date) values
  ('7fd00000-0000-0000-0000-0000000000d2', 'athlete', '7fd00000-0000-0000-0000-00000000000b',
   '[{"id":"d","title":"Dinner","kind":"meal","proof":"photo"}]', '7fd00000-0000-0000-0000-000000000005', current_date + 3);
select _ok(jsonb_array_length(athlete_day_ctx('7fd00000-0000-0000-0000-00000000000b', '7fd00000-0000-0000-0000-0000000000d2', current_date) -> 'required') = 5,
  'standard: a future athlete standard does not govern today');
select _ok(athlete_day_ctx('7fd00000-0000-0000-0000-00000000000b', '7fd00000-0000-0000-0000-0000000000d2', current_date + 3) -> 'required' = '["dinner"]'::jsonb,
  'standard: it governs from its own date, over the room');
insert into team_week_pattern (team_id, pattern) values ('7fd00000-0000-0000-0000-0000000000d2', '["rest","rest","rest","rest","rest","rest","rest"]');
select _ok(athlete_day_ctx('7fd00000-0000-0000-0000-00000000000f', '7fd00000-0000-0000-0000-0000000000d2', current_date) -> 'required'
           = '["breakfast","lunch","dinner"]'::jsonb,
  'standard: a rest day drops the training-day meal');

-- ================================================================ review fix round
-- 6. A lesson from a coach the athlete blocked: flagged, and no name.
select _superuser();
insert into user_blocks (blocker_id, blocked_id) values ('7fd00000-0000-0000-0000-00000000000a', '7fd00000-0000-0000-0000-000000000001');
select _as('7fd00000-0000-0000-0000-00000000000a');
select _ok((select (x ->> 'blocked')::boolean and x -> 'from' = 'null'::jsonb
              from jsonb_array_elements(my_learning(current_date) -> 'assignments') x where x ->> 'lesson_id' = 'hydration-basics'),
  'fix: a lesson from a coach I blocked is flagged and carries no name');
select _superuser();
delete from user_blocks where blocker_id = '7fd00000-0000-0000-0000-00000000000a';
select _as('7fd00000-0000-0000-0000-00000000000a');
select _ok((select not (x ->> 'blocked')::boolean and x ->> 'from' = 'Coach Grinch'
              from jsonb_array_elements(my_learning(current_date) -> 'assignments') x where x ->> 'lesson_id' = 'hydration-basics'),
  'fix: unblocked, it is from the coach again');

-- 2. Push dedupe: the same team and lesson is announced at most once a day, even after a remove
--    and a re-assign (or the same lesson to one of the team's rooms).
select _as('7fd00000-0000-0000-0000-000000000004');
select _ok(_try($q$insert into lesson_assignments (id, team_id, lesson_id) values ('7fd00000-0000-0000-0000-0000000000a5', '7fd00000-0000-0000-0000-0000000000d1', 'snacks-that-count')$q$) = 'ok',
  'dedupe: an editor assigns a lesson');
select _ok((claim_teach_push('lesson', '7fd00000-0000-0000-0000-0000000000a5') ->> 'claimed')::boolean, 'dedupe: its first push is claimed');
select _ok(_n($q$delete from lesson_assignments where id = '7fd00000-0000-0000-0000-0000000000a5'$q$) = 1, 'dedupe: the editor removes it');
select _ok(_try($q$insert into lesson_assignments (id, team_id, lesson_id) values ('7fd00000-0000-0000-0000-0000000000a6', '7fd00000-0000-0000-0000-0000000000d1', 'snacks-that-count')$q$) = 'ok',
  'dedupe: and assigns it again');
select _ok((select not (r ->> 'claimed')::boolean and (r ->> 'reason') = 'recent'
            from (select claim_teach_push('lesson', '7fd00000-0000-0000-0000-0000000000a6') r) s),
  'fix: the re-assigned lesson is not pushed again within a day');
select _ok((select pushed_at is not null from lesson_assignments where id = '7fd00000-0000-0000-0000-0000000000a6'),
  'dedupe: and it is marked, so it never pushes later either');
select _ok(_try($q$insert into lesson_assignments (id, team_id, lesson_id, room_id) values ('7fd00000-0000-0000-0000-0000000000a7', '7fd00000-0000-0000-0000-0000000000d1', 'snacks-that-count', '7fd00000-0000-0000-0000-0000000000c1')$q$) = 'ok'
  and not (claim_teach_push('lesson', '7fd00000-0000-0000-0000-0000000000a7') ->> 'claimed')::boolean,
  'fix: the same lesson to a room of the same team inside the day is not pushed again');
select _superuser();
select _ok((select count(*) from teach_pushes where team_id = '7fd00000-0000-0000-0000-0000000000d1' and ref = 'snacks-that-count') = 1,
  'dedupe: the log keeps one entry per push');
select _as('7fd00000-0000-0000-0000-000000000001');
select _ok(_try($q$select count(*) from teach_pushes$q$) <> 'ok', 'dedupe: the push log is not readable from the app');

-- 5 + 2. A challenge that starts later says when; the same habit restarted inside a day is not pushed.
select _as('7fd00000-0000-0000-0000-000000000001');
select _ok((select end_team_challenge(id) from team_challenges where team_id = '7fd00000-0000-0000-0000-0000000000d1' and ended_at is null),
  'challenge: the running one is ended');
create temp table _ch2 (id uuid);
insert into _ch2 select start_team_challenge('7fd00000-0000-0000-0000-0000000000d1', 'late', current_date + 3, current_date + 9, 5);
select _ok((select r ->> 'body' = 'Coach Grinch set a team challenge: Meals logged on time. It starts '
              || trim(to_char(current_date + 3, 'Day')) || '. Goal: 5 of 7 days.'
            from (select claim_teach_push('challenge', (select id from _ch2)) r) s),
  'fix: a challenge that starts later says when it starts');
select _ok((select end_team_challenge(id) from _ch2), 'challenge: the scheduled one is ended');
create temp table _ch3 (id uuid);
insert into _ch3 select start_team_challenge('7fd00000-0000-0000-0000-0000000000d1', 'late', current_date, current_date + 6, 5);
select _ok((select not (r ->> 'claimed')::boolean and r ->> 'reason' = 'recent' from (select claim_teach_push('challenge', (select id from _ch3)) r) s),
  'fix: the same habit restarted inside a day is not pushed again');

-- 3. Weight: the stored base weight, else the latest logged weight in the last 90 days, else 171.
select _superuser();
insert into athlete_profiles (athlete_id, base_goal, base_weight) values ('7fd00000-0000-0000-0000-00000000000f', 'gain', null)
on conflict (athlete_id) do update set base_goal = 'gain', base_weight = null;
insert into days (athlete_id, date, current_weight) values
  ('7fd00000-0000-0000-0000-00000000000f', current_date - 100, 190),
  ('7fd00000-0000-0000-0000-00000000000f', current_date - 40, 199),
  ('7fd00000-0000-0000-0000-00000000000f', current_date - 10, 205)
on conflict (athlete_id, date) do update set current_weight = excluded.current_weight;
select _ok(athlete_protein_target('7fd00000-0000-0000-0000-00000000000f') = 205,
  'fix: no stored weight: the latest logged weight sets the target (205 lb, gain: 205 g)');
update days set current_weight = null where athlete_id = '7fd00000-0000-0000-0000-00000000000f' and date >= current_date - 90;
select _ok(athlete_protein_target('7fd00000-0000-0000-0000-00000000000f') = 170,
  'fix: a weight older than 90 days is not used: the 171 lb stand-in');
update athlete_profiles set base_weight = 212 where athlete_id = '7fd00000-0000-0000-0000-00000000000f';
select _ok(athlete_protein_target('7fd00000-0000-0000-0000-00000000000f') = 210, 'fix: the stored weight wins');

-- ================================================================ scoreboard
select _superuser();
do $$
declare fails int; total int; bad text;
begin
  select count(*) filter (where not ok), count(*) into fails, total from _lc_results;
  raise notice '================================================';
  raise notice 'LESSONS + CHALLENGES SUITE: % / % checks passed', total - fails, total;
  if fails > 0 then
    raise notice 'FAILED CHECKS:';
    for bad in select label from _lc_results where not ok order by n loop
      raise notice '  - %', bad;
    end loop;
    raise exception 'LESSONS + CHALLENGES SUITE FAILED: % check(s), see the FAIL lines above', fails;
  end if;
  raise notice 'ALL GREEN.';
end $$;

rollback;
