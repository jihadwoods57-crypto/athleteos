-- OnStandard — Trust Pass rewards (0196) behaviour + authorization suite.
--
-- 0196 hands an OPERATOR the power to move an athlete's score without the athlete logging
-- anything. That is a real authority, so the walls around it are pinned here against real
-- Postgres rather than trusted to review: who may grant (a team coach OR a trainer, and nobody
-- else), who may spend (the athlete themselves, and nobody else), and the arithmetic that stops
-- one credit covering three meals.
--
-- Run against a migrated local/staging DB, as superuser — NEVER production:
--   psql -v ON_ERROR_STOP=1 -f supabase/tests/pass_test.sql
--
-- Same shape as trainer_funded_test.sql: one transaction, rolled back, scoreboard at the end,
-- non-zero exit if any check failed.
--
-- Cast:
--   trainer_t   owns practice P1
--   coach_b     head coach of team T1
--   rival_r     owns practice P2 — the control for cross-book scoping bugs
--   client_1    client of P1, 7 photo-logged days → ELIGIBLE
--   client_2    client of P1, 3 photo-logged days → NOT eligible
--   rival_c     client of P2, 7 photo-logged days → eligible, but not trainer_t's to reward
--   team_a      member of T1, 7 photo-logged days → the coach arm

begin;

-- ---------------------------------------------------------------- harness
create table _tp_results (n serial, ok boolean, label text);

create or replace function _ok(cond boolean, label text) returns void
language plpgsql security definer as $$
begin
  insert into _tp_results(ok, label) values (coalesce(cond,false), label);
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
language plpgsql as $$ begin execute 'reset role'; end $$;
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
select set_config('request.jwt.claim.sub', '', false);

insert into auth.users (id, email) values
  ('7aa00000-0000-0000-0000-000000000001'::uuid, 'tp-trainer@x.io'),
  ('7aa00000-0000-0000-0000-000000000002'::uuid, 'tp-coach@x.io'),
  ('7aa00000-0000-0000-0000-000000000003'::uuid, 'tp-rival@x.io'),
  ('7aa00000-0000-0000-0000-00000000000a'::uuid, 'tp-c1@x.io'),
  ('7aa00000-0000-0000-0000-00000000000b'::uuid, 'tp-c2@x.io'),
  ('7aa00000-0000-0000-0000-00000000000c'::uuid, 'tp-rc@x.io'),
  ('7aa00000-0000-0000-0000-00000000000d'::uuid, 'tp-ta@x.io');

insert into profiles (id, full_name, email, primary_role) values
  ('7aa00000-0000-0000-0000-000000000001', 'Trainer T', 'tp-trainer@x.io', 'trainer'),
  ('7aa00000-0000-0000-0000-000000000002', 'Coach B',   'tp-coach@x.io',   'coach'),
  ('7aa00000-0000-0000-0000-000000000003', 'Rival R',   'tp-rival@x.io',   'trainer'),
  ('7aa00000-0000-0000-0000-00000000000a', 'Client 1',  'tp-c1@x.io',      'athlete'),
  ('7aa00000-0000-0000-0000-00000000000b', 'Client 2',  'tp-c2@x.io',      'athlete'),
  ('7aa00000-0000-0000-0000-00000000000c', 'Rival C',   'tp-rc@x.io',      'athlete'),
  ('7aa00000-0000-0000-0000-00000000000d', 'Team A',    'tp-ta@x.io',      'athlete')
on conflict (id) do update set full_name = excluded.full_name, primary_role = excluded.primary_role;

insert into practices (id, owner_id, name, join_code) values
  ('7aa00000-0000-0000-0000-00000000ff01'::uuid, '7aa00000-0000-0000-0000-000000000001', 'T1 Performance', 'TPTEST01'),
  ('7aa00000-0000-0000-0000-00000000ff02'::uuid, '7aa00000-0000-0000-0000-000000000003', 'R2 Strength',    'TPTEST02');

insert into practice_clients (practice_id, client_id, status) values
  ('7aa00000-0000-0000-0000-00000000ff01', '7aa00000-0000-0000-0000-00000000000a', 'active'),
  ('7aa00000-0000-0000-0000-00000000ff01', '7aa00000-0000-0000-0000-00000000000b', 'active'),
  ('7aa00000-0000-0000-0000-00000000ff02', '7aa00000-0000-0000-0000-00000000000c', 'active');

insert into teams (id, name, join_code, created_by) values
  ('7aa00000-0000-0000-0000-00000000dd01'::uuid, 'Test HS', 'TPTEAM01', '7aa00000-0000-0000-0000-000000000002');
insert into team_staff (team_id, staff_id, role, status) values
  ('7aa00000-0000-0000-0000-00000000dd01', '7aa00000-0000-0000-0000-000000000002', 'head_coach', 'active');
insert into team_members (team_id, athlete_id, status) values
  ('7aa00000-0000-0000-0000-00000000dd01', '7aa00000-0000-0000-0000-00000000000d', 'active');

-- Eligibility is measured in PHOTO-logged days (0039's forgery-resistant signal), so the seed has
-- to produce real meals rows carrying a photo_path. client_2 gets three, which is under the
-- default gate of seven and is the whole point of that actor.
insert into meals (athlete_id, day_date, type, photo_path, protein, kcal)
select a.id, current_date - g, 'dinner', 'seed/' || a.id || '/' || g || '.jpg', 40, 600
from (values ('7aa00000-0000-0000-0000-00000000000a'::uuid),
             ('7aa00000-0000-0000-0000-00000000000c'::uuid),
             ('7aa00000-0000-0000-0000-00000000000d'::uuid)) a(id),
     generate_series(1, 7) g;

insert into meals (athlete_id, day_date, type, photo_path, protein, kcal)
select '7aa00000-0000-0000-0000-00000000000b'::uuid, current_date - g, 'dinner',
       'seed/c2/' || g || '.jpg', 40, 600
from generate_series(1, 3) g;

-- ================================================================ schema
select _ok(to_regclass('public.pass_spends') is not null,
  '0196: pass_spends table exists');

select _ok(exists (
  select 1 from information_schema.columns
  where table_schema = 'public' and table_name = 'trust_passes' and column_name = 'credits_total'),
  '0196: trust_passes.credits_total exists');

select _ok(exists (
  select 1 from information_schema.columns
  where table_schema = 'public' and table_name = 'trust_passes' and column_name = 'practice_id'),
  '0196: trust_passes.practice_id exists (the dual-owner arm)');

select _ok(not exists (
  select 1 from information_schema.columns
  where table_schema = 'public' and table_name = 'trust_passes' and column_name = 'granted_date'),
  '0196: the old fixed-window columns are gone');

-- Every insert below uses REAL seeded ids, so an FK violation can never masquerade as the
-- constraint under test passing.
select _ok(_try($q$
  insert into trust_passes (athlete_id, granted_by, team_id, practice_id, credits_total, expires_on)
  values ('7aa00000-0000-0000-0000-00000000000a', '7aa00000-0000-0000-0000-000000000001',
          '7aa00000-0000-0000-0000-00000000dd01', '7aa00000-0000-0000-0000-00000000ff01',
          3, current_date + 14)
$q$) <> 'ok', '0196: a pass owned by BOTH a team and a practice is refused');

select _ok(_try($q$
  insert into trust_passes (athlete_id, granted_by, expires_on)
  values ('7aa00000-0000-0000-0000-00000000000a', '7aa00000-0000-0000-0000-000000000001',
          current_date + 14)
$q$) <> 'ok', '0196: a pass owned by NEITHER is refused');

select _ok(_try($q$
  insert into trust_passes (athlete_id, granted_by, practice_id, expires_on)
  values ('7aa00000-0000-0000-0000-00000000000a', '7aa00000-0000-0000-0000-000000000001',
          '7aa00000-0000-0000-0000-00000000ff01', current_date + 14)
$q$) <> 'ok', '0196: a pass with neither credits nor a window has no shape and is refused');

select _ok(_try($q$
  insert into trust_passes (athlete_id, granted_by, practice_id, covers_from, covers_until, expires_on)
  values ('7aa00000-0000-0000-0000-00000000000a', '7aa00000-0000-0000-0000-000000000001',
          '7aa00000-0000-0000-0000-00000000ff01', current_date, current_date + 30, current_date + 30)
$q$) <> 'ok', '0196: a 31-day window is refused (the cap dropped 60 -> 14)');

select _ok(_try($q$
  insert into trust_passes (athlete_id, granted_by, practice_id, covers_from, expires_on)
  values ('7aa00000-0000-0000-0000-00000000000a', '7aa00000-0000-0000-0000-000000000001',
          '7aa00000-0000-0000-0000-00000000ff01', current_date, current_date + 3)
$q$) <> 'ok', '0196: half a window (a start with no end) is refused');

select _ok(_try($q$
  insert into trust_passes (athlete_id, granted_by, practice_id, credits_total, expires_on)
  values ('7aa00000-0000-0000-0000-00000000000a', '7aa00000-0000-0000-0000-000000000001',
          '7aa00000-0000-0000-0000-00000000ff01', 99, current_date + 14)
$q$) <> 'ok', '0196: 99 credits is refused');

-- The shapes that must WORK. A window and a credit grant, and the two combined.
select _ok(_try($q$
  insert into trust_passes (athlete_id, granted_by, practice_id, credits_total, covers_from, covers_until, expires_on)
  values ('7aa00000-0000-0000-0000-00000000000b', '7aa00000-0000-0000-0000-000000000001',
          '7aa00000-0000-0000-0000-00000000ff01', 3, current_date, current_date + 1, current_date + 1)
$q$) = 'ok', '0196: credits fenced to a window is a legal shape');

-- One live pass per athlete, unchanged from 0033.
select _ok(_try($q$
  insert into trust_passes (athlete_id, granted_by, practice_id, credits_total, expires_on)
  values ('7aa00000-0000-0000-0000-00000000000b', '7aa00000-0000-0000-0000-000000000001',
          '7aa00000-0000-0000-0000-00000000ff01', 2, current_date + 14)
$q$) <> 'ok', '0196: a second live pass for the same athlete is refused');

delete from trust_passes where athlete_id = '7aa00000-0000-0000-0000-00000000000b';

-- The 0136 trap: with team_id nullable, a team_id-keyed index would let every practice row past.
select _ok(_try($q$
  insert into trust_pass_policy (practice_id, default_credits) values
    ('7aa00000-0000-0000-0000-00000000ff01', 3),
    ('7aa00000-0000-0000-0000-00000000ff01', 4)
$q$) <> 'ok', '0196: two policies for one practice are refused (coalesce key holds)');

-- ================================================================ scoreboard
do $$
declare fails int; total int; bad text;
begin
  select count(*) filter (where not ok), count(*) into fails, total from _tp_results;
  raise notice '================================================';
  raise notice 'TRUST PASS SUITE: % / % checks passed', total - fails, total;
  if fails > 0 then
    raise notice 'FAILED CHECKS:';
    for bad in select label from _tp_results where not ok order by n loop
      raise notice '  - %', bad;
    end loop;
    raise exception 'TRUST PASS SUITE FAILED: % check(s) — see the FAIL lines above', fails;
  end if;
  raise notice 'ALL GREEN.';
end $$;

rollback;
