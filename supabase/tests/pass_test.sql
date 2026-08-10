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

-- ================================================================ grant authorization
-- This is the wall the whole feature rests on. A pass moves an athlete's score without the
-- athlete logging anything, so "who may grant" is a money-grade question.

select _as('7aa00000-0000-0000-0000-00000000000a');
select _ok(_try($q$
  select grant_pass('7aa00000-0000-0000-0000-00000000000a'::uuid, 3)
$q$) <> 'ok', '0196: an athlete cannot grant themselves a pass');

select _as('7aa00000-0000-0000-0000-00000000000c');
select _ok(_try($q$
  select grant_pass('7aa00000-0000-0000-0000-00000000000a'::uuid, 3)
$q$) <> 'ok', '0196: an unrelated athlete cannot grant to somebody else');

-- THE NEW ARM. 0099 authorized is_team_coach_of only; this is the capability that did not exist.
select _as('7aa00000-0000-0000-0000-000000000001');
select _ok(_try($q$
  select grant_pass('7aa00000-0000-0000-0000-00000000000a'::uuid, 3, null, null, null, 'Great week')
$q$) = 'ok', '0196: a TRAINER can grant to their own client');

select _ok((select credits_total from trust_passes
            where athlete_id = '7aa00000-0000-0000-0000-00000000000a' and ended_at is null) = 3,
  '0196: the grant landed with the credits asked for');
select _ok((select practice_id from trust_passes
            where athlete_id = '7aa00000-0000-0000-0000-00000000000a' and ended_at is null)
           = '7aa00000-0000-0000-0000-00000000ff01',
  '0196: the grant is stamped with the granting PRACTICE, not a team');
select _ok((select note from trust_passes
            where athlete_id = '7aa00000-0000-0000-0000-00000000000a' and ended_at is null) = 'Great week',
  '0196: the trainer''s note rides along');

select _ok(_try($q$
  select grant_pass('7aa00000-0000-0000-0000-00000000000c'::uuid, 3)
$q$) <> 'ok', '0196: a trainer cannot grant to ANOTHER practice''s client');

-- The eligibility wall. client_2 has 3 photo-logged days against a default gate of 7.
select _ok(_try($q$
  select grant_pass('7aa00000-0000-0000-0000-00000000000b'::uuid, 3)
$q$) <> 'ok', '0196: an ineligible client is refused');

-- ...and the refusal has to be countable, because the operator UI shows it verbatim.
select _ok(_try($q$
  select grant_pass('7aa00000-0000-0000-0000-00000000000b'::uuid, 3)
$q$) like '%3 of 7%', '0196: the refusal names the shortfall');

-- The coach arm still works, through a team rather than a practice.
select _as('7aa00000-0000-0000-0000-000000000002');
select _ok(_try($q$
  select grant_pass('7aa00000-0000-0000-0000-00000000000d'::uuid, null, current_date, current_date + 1)
$q$) = 'ok', '0196: a TEAM COACH can still grant, as a window');
select _ok((select team_id from trust_passes
            where athlete_id = '7aa00000-0000-0000-0000-00000000000d' and ended_at is null)
           = '7aa00000-0000-0000-0000-00000000dd01',
  '0196: the coach grant is stamped with the team');
select _ok((select credits_total from trust_passes
            where athlete_id = '7aa00000-0000-0000-0000-00000000000d' and ended_at is null) is null,
  '0196: a window grant carries no credit counter');

-- max_credits is per-book and enforced server-side, not just in the form.
select _superuser();
insert into trust_pass_policy (practice_id, max_credits) values
  ('7aa00000-0000-0000-0000-00000000ff01', 4);
select _as('7aa00000-0000-0000-0000-000000000001');
select _ok(_try($q$
  select grant_pass('7aa00000-0000-0000-0000-00000000000a'::uuid, 9)
$q$) <> 'ok', '0196: a grant above the book''s max_credits is refused');

-- Granting again REPLACES the live pass rather than stacking a second one.
select _ok(_try($q$
  select grant_pass('7aa00000-0000-0000-0000-00000000000a'::uuid, 2)
$q$) = 'ok', '0196: re-granting is allowed');
select _ok((select count(*) from trust_passes
            where athlete_id = '7aa00000-0000-0000-0000-00000000000a' and ended_at is null) = 1,
  '0196: re-granting ends the previous pass instead of stacking');

-- ================================================================ end
select _as('7aa00000-0000-0000-0000-00000000000a');
select _ok(_try($q$ select end_pass('7aa00000-0000-0000-0000-00000000000a'::uuid) $q$) <> 'ok',
  '0196: an athlete cannot end their own pass to dodge the record');

select _as('7aa00000-0000-0000-0000-000000000003');
select _ok(_try($q$ select end_pass('7aa00000-0000-0000-0000-00000000000a'::uuid) $q$) <> 'ok',
  '0196: a rival operator cannot end somebody else''s grant');

select _as('7aa00000-0000-0000-0000-000000000001');
select _ok(_try($q$ select end_pass('7aa00000-0000-0000-0000-00000000000a'::uuid) $q$) = 'ok',
  '0196: the granting trainer can end it');
select _ok((select count(*) from trust_passes
            where athlete_id = '7aa00000-0000-0000-0000-00000000000a' and ended_at is null) = 0,
  '0196: no live pass remains after end_pass');

-- ================================================================ the kill switch
-- It must stop NEW grants and nothing else. Killing it can never strand somebody mid-pass.
select _superuser();
update feature_flags set kill_switch = true where name = 'trust_pass';
select _as('7aa00000-0000-0000-0000-000000000001');
select _ok(_try($q$
  select grant_pass('7aa00000-0000-0000-0000-00000000000a'::uuid, 3)
$q$) <> 'ok', '0196: the kill switch stops a new grant');
select _superuser();
update feature_flags set kill_switch = false where name = 'trust_pass';

-- Restore a live credit pass for the spend tests below.
select _as('7aa00000-0000-0000-0000-000000000001');
select grant_pass('7aa00000-0000-0000-0000-00000000000a'::uuid, 3);

-- ================================================================ spend
-- client_1 now holds a 3-credit pass. spend_pass takes NO athlete argument, so "spending for
-- somebody else" is not a permission that can be got wrong: it is an argument that does not exist.

select _as('7aa00000-0000-0000-0000-00000000000a');
select _ok(_try($q$ select spend_pass(current_date, 'dinner') $q$) = 'ok',
  '0196: the client can spend a credit on an open slot');

select _ok((select count(*) from pass_spends
            where athlete_id = '7aa00000-0000-0000-0000-00000000000a'
              and day_date = current_date and slot = 'dinner') = 1,
  '0196: exactly one spend row landed');

select _ok(_try($q$ select spend_pass(current_date, 'dinner') $q$) <> 'ok',
  '0196: the same slot cannot be spent twice');

select _ok(_try($q$ select spend_pass(current_date, 'lunch') $q$) = 'ok',
  '0196: a different slot on the same day is fine');

select _ok(_try($q$ select spend_pass(current_date + 400, 'breakfast') $q$) <> 'ok',
  '0196: a day past expiry cannot be spent');

-- The seed logged a real dinner on every one of the last 7 days. Covering one of those would
-- burn a credit for nothing, so the server refuses rather than trusting the UI to hide the
-- button. This is the log-first/spend-second direction; the refund trigger handles the reverse.
select _ok(_try($q$ select spend_pass(current_date - 1, 'dinner') $q$) <> 'ok',
  '0196: a slot that already holds a logged meal cannot be covered');

-- Three credits, three spends, then the wall. current_date carries no seeded meal.
select _ok(_try($q$ select spend_pass(current_date, 'breakfast') $q$) = 'ok',
  '0196: the third credit spends');
select _ok(_try($q$ select spend_pass(current_date - 1, 'lunch') $q$) <> 'ok',
  '0196: a fourth spend against a 3-credit pass is refused');

-- An athlete with no pass at all cannot conjure one.
select _as('7aa00000-0000-0000-0000-00000000000c');
select _ok(_try($q$ select spend_pass(current_date, 'dinner') $q$) <> 'ok',
  '0196: an athlete with no pass cannot spend');

-- A WINDOW pass has nothing to spend: it already covers the range.
select _as('7aa00000-0000-0000-0000-00000000000d');
select _ok(_try($q$ select spend_pass(current_date, 'dinner') $q$) <> 'ok',
  '0196: a window pass refuses a spend, because it already covers the day');

-- ================================================================ refund
-- A TRIGGER, not a client call. A refund that only fires while the app is open is not a refund,
-- and the offline outbox can replay a meal insert long after the tap that caused it.
select _superuser();
insert into meals (athlete_id, day_date, type, photo_path, protein, kcal)
  values ('7aa00000-0000-0000-0000-00000000000a', current_date, 'dinner',
          'seed/refund/1.jpg', 45, 700);

select _ok((select count(*) from pass_spends
            where athlete_id = '7aa00000-0000-0000-0000-00000000000a'
              and day_date = current_date and slot = 'dinner') = 0,
  '0196: logging the meal anyway refunded that credit');

select _ok((select count(*) from pass_spends
            where athlete_id = '7aa00000-0000-0000-0000-00000000000a'
              and day_date = current_date and slot = 'lunch') = 1,
  '0196: the refund touched only the slot that was logged');

-- ...and the returned credit is genuinely spendable again.
select _as('7aa00000-0000-0000-0000-00000000000a');
select _ok(_try($q$ select spend_pass(current_date - 1, 'lunch') $q$) = 'ok',
  '0196: the refunded credit can be spent again');

-- A meal logged for a slot nobody covered must not delete an unrelated spend. Live spends at
-- this point: (today, lunch), (today, breakfast), (yesterday, lunch).
select _superuser();
insert into meals (athlete_id, day_date, type, photo_path, protein, kcal)
  values ('7aa00000-0000-0000-0000-00000000000a', current_date - 3, 'breakfast',
          'seed/refund/2.jpg', 30, 400);
select _ok((select count(*) from pass_spends
            where athlete_id = '7aa00000-0000-0000-0000-00000000000a') = 3,
  '0196: an unrelated meal refunds nothing');

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
