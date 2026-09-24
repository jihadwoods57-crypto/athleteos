-- OnStandard — the roll call kill switch (0217 + 0248) behaviour suite.
--
-- Founder, 2026-09-24: "Take roll call off the app but don't permanently delete it." The switch is
-- feature_flags.verified_commitments.kill_switch. This suite throws it and proves that EVERY server
-- path that can push, start or update a Live Activity, mint an alarm code, send a notice, remind,
-- fan out, materialize, arm a geofence or show roll call data answers nothing — while an athlete's
-- tap on a push sent BEFORE the switch is still recorded. Then it releases the switch and proves
-- the eight paths 0248 guarded work again, so the guard (not a broken fixture) is what silenced them.
--
-- Run against a migrated local/staging DB, as superuser — NEVER production:
--   psql -v ON_ERROR_STOP=1 -f supabase/tests/rollcall_off_test.sql
-- One transaction, rolled back, scoreboard at the end, non-zero exit if any check failed.

begin;

-- ---------------------------------------------------------------- harness
create table _ro_results (n serial, ok boolean, label text);

create or replace function _ok(cond boolean, label text) returns void
language plpgsql security definer as $$
begin
  insert into _ro_results(ok, label) values (coalesce(cond,false), label);
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

-- ---------------------------------------------------------------- seed (switch ON)
select _superuser();
insert into feature_flags (name, description, default_on, kill_switch)
values ('verified_commitments', 'test', true, false)
on conflict (name) do update set kill_switch = false;

insert into auth.users (id, email) values
  ('7bb00000-0000-0000-0000-000000000001'::uuid, 'ro-coach@x.io'),
  ('7bb00000-0000-0000-0000-00000000000a'::uuid, 'ro-a@x.io'),
  ('7bb00000-0000-0000-0000-00000000000b'::uuid, 'ro-b@x.io');
insert into profiles (id, full_name, email, primary_role) values
  ('7bb00000-0000-0000-0000-000000000001', 'Coach RO', 'ro-coach@x.io', 'coach'),
  ('7bb00000-0000-0000-0000-00000000000a', 'Athlete A', 'ro-a@x.io', 'athlete'),
  ('7bb00000-0000-0000-0000-00000000000b', 'Athlete B', 'ro-b@x.io', 'athlete')
on conflict (id) do nothing;
insert into teams (id, name, join_code, created_by) values
  ('7bb00000-0000-0000-0000-0000000000d1'::uuid, 'RO HS', 'ROTEAM01', '7bb00000-0000-0000-0000-000000000001');
insert into team_staff (team_id, staff_id, role, status) values
  ('7bb00000-0000-0000-0000-0000000000d1', '7bb00000-0000-0000-0000-000000000001', 'head_coach', 'active');
insert into team_members (team_id, athlete_id, status) values
  ('7bb00000-0000-0000-0000-0000000000d1', '7bb00000-0000-0000-0000-00000000000a', 'active'),
  ('7bb00000-0000-0000-0000-0000000000d1', '7bb00000-0000-0000-0000-00000000000b', 'active');

insert into commitments (id, team_id, type, title, audience_kind, starts_min, respond_by_min, repeat_days, timezone, active, created_by)
values ('7bb00000-0000-0000-0000-0000000000c1', '7bb00000-0000-0000-0000-0000000000d1', 'morning_roll_call',
        'Morning Roll Call', 'team', 360, 370, '{}', 'America/New_York', true, '7bb00000-0000-0000-0000-000000000001');

-- I1: tomorrow, an hour ahead (a morning a coach could still move). I2: open right now.
insert into commitment_instances (id, commitment_id, occurs_on, starts_at, respond_by_at, status) values
  ('7bb00000-0000-0000-0000-0000000000e1', '7bb00000-0000-0000-0000-0000000000c1',
   (now() at time zone 'America/New_York')::date + 1, now() + interval '1 hour', now() + interval '70 minutes', 'scheduled'),
  ('7bb00000-0000-0000-0000-0000000000e2', '7bb00000-0000-0000-0000-0000000000c1',
   (now() at time zone 'America/New_York')::date, now() - interval '2 minutes', now() + interval '8 minutes', 'scheduled');
insert into commitment_responses (instance_id, athlete_id, status)
select i, a, 'pending'
  from unnest(array['7bb00000-0000-0000-0000-0000000000e1', '7bb00000-0000-0000-0000-0000000000e2']::uuid[]) i,
       unnest(array['7bb00000-0000-0000-0000-00000000000a', '7bb00000-0000-0000-0000-00000000000b']::uuid[]) a;

-- A has a live card on I2 (an update token); B could have one started (a push-to-start token).
insert into rollcall_live_tokens (athlete_id, instance_id, kind, token) values
  ('7bb00000-0000-0000-0000-00000000000a', '7bb00000-0000-0000-0000-0000000000e2', 'update', 'ro-upd-a'),
  ('7bb00000-0000-0000-0000-00000000000b', null, 'start', 'ro-start-b');

create temp table _ro_ids as select
  '7bb00000-0000-0000-0000-000000000001'::uuid as coach,
  '7bb00000-0000-0000-0000-00000000000a'::uuid as a,
  '7bb00000-0000-0000-0000-00000000000b'::uuid as b,
  '7bb00000-0000-0000-0000-0000000000d1'::uuid as team,
  '7bb00000-0000-0000-0000-0000000000c1'::uuid as rc,
  '7bb00000-0000-0000-0000-0000000000e1'::uuid as i1,
  '7bb00000-0000-0000-0000-0000000000e2'::uuid as i2;
grant select on _ro_ids to authenticated;

-- ================================================================ switch OFF
update feature_flags set kill_switch = true where name = 'verified_commitments';
create temp table _ro_bell as select count(*) as n from notifications
  where user_id in ('7bb00000-0000-0000-0000-00000000000a', '7bb00000-0000-0000-0000-00000000000b');

-- ---- the eight paths 0248 guarded
select _ok((select (rollcall_nudge_claim(i2, coach) ->> 'reason') = 'flag_off' from _ro_ids),
  'OFF: coach Nudge claims nothing (rollcall_nudge_claim → flag_off)');
select _ok((select (rollcall_nudge_claim(i2, coach, 10, a) ->> 'reason') = 'flag_off' from _ro_ids),
  'OFF: coach Ping one athlete claims nothing');
select _ok((select (rollcall_schedule_notice_claim(i1, coach) ->> 'reason') = 'flag_off' from _ro_ids),
  'OFF: "Tell athletes" writes no notice (rollcall_schedule_notice_claim → flag_off)');
select _ok((select count(*) = 0 from _ro_ids, rollcall_window_rows_svc(a, 14)),
  'OFF: no alarm check-in codes can be minted (rollcall_window_rows_svc empty)');
select _ok((select count(*) = 0 from _ro_ids, rollcall_live_update_targets(i2)),
  'OFF: no Live Activity fan-out targets (rollcall_live_update_targets empty)');
select _ok((select count(*) = 0 from _ro_ids, claim_live_team_updates(i2, array[a], 0)),
  'OFF: no Live Activity team update claimed');
select _ok((select count(*) = 0 from _ro_ids, claim_rollcall_card_starts(i2, array[b])),
  'OFF: no Live Activity start claimed (claim_rollcall_card_starts empty)');
select _ok((select count(*) from notifications
             where user_id in ('7bb00000-0000-0000-0000-00000000000a', '7bb00000-0000-0000-0000-00000000000b'))
           = (select n from _ro_bell),
  'OFF: the refused nudge and notice wrote no bell rows');
select _ok((select last_nudge_at is null from commitment_instances where id = '7bb00000-0000-0000-0000-0000000000e2')
           and (select schedule_notified_at is null from commitment_instances where id = '7bb00000-0000-0000-0000-0000000000e1')
           and (select last_nudge_at is null from commitment_responses
                 where instance_id = '7bb00000-0000-0000-0000-0000000000e2' and athlete_id = '7bb00000-0000-0000-0000-00000000000a'),
  'OFF: a refused claim spends no cooldown');

select _as('7bb00000-0000-0000-0000-000000000001');
select _ok(_try($q$ select rollcall_arming('7bb00000-0000-0000-0000-0000000000e1') $q$) like 'denied%switched off%',
  'OFF: the coach hub''s arming read refuses (rollcall_arming)');
select _ok(rollcall_summary('7bb00000-0000-0000-0000-0000000000c1') = '[]'::jsonb,
  'OFF: the coach''s results read is empty (rollcall_summary)');
-- ---- already guarded before 0248 (0141/0207/0211/0216/0217/0242/0247), pinned here so none regresses
select _ok(rollcall_upcoming('7bb00000-0000-0000-0000-0000000000c1') = '[]'::jsonb,
  'OFF: the coach''s next-roll-call read is empty (rollcall_upcoming, 0217)');
select _ok(coalesce(jsonb_array_length(commitment_board('7bb00000-0000-0000-0000-0000000000d1', null,
             (now() at time zone 'America/New_York')::date)), 0) = 0,
  'OFF: the coach Home board is empty (commitment_board)');
select _ok(_try($q$ select rollcall_team_board('7bb00000-0000-0000-0000-0000000000e2') $q$) like 'denied%switched off%',
  'OFF: the live team board refuses (rollcall_team_board)');
select _ok(_try($q$ select rollcall_history('7bb00000-0000-0000-0000-0000000000c1') $q$) like 'denied%switched off%',
  'OFF: the history refuses (rollcall_history)');

select _as('7bb00000-0000-0000-0000-00000000000a');
select _ok(coalesce(jsonb_array_length(my_commitments((now() at time zone 'America/New_York')::date - 1,
             (now() at time zone 'America/New_York')::date + 14)), 0) = 0,
  'OFF: the athlete sees no roll call (my_commitments empty: no Home card, no alarm armed)');
select _ok(coalesce(jsonb_array_length(my_armable_geofences()), 0) = 0,
  'OFF: no geofence to arm (my_armable_geofences empty)');
select _ok(ensure_my_commitment_instances(current_date, current_date + 7) = 0,
  'OFF: opening the app materializes nothing');

select _superuser();
-- Every write path (upsert_commitment, the setup screen, a re-save) ends in this trigger.
select _ok(_try($q$ update commitments set title = 'Changed' where id = '7bb00000-0000-0000-0000-0000000000c1' $q$) like 'denied%switched off%',
  'OFF: no roll call can be created, edited or re-saved (commitments_flag_guard)');
select _ok((select count(*) = 0 from claim_due_commitment_reminders(10, 500) where athlete_id in (select a from _ro_ids union select b from _ro_ids)),
  'OFF: the reminder cron claims nothing (claim_due_commitment_reminders)');
select _ok((select count(*) = 0 from claim_missed_commitments(10, null, 500) where athlete_id in (select a from _ro_ids union select b from _ro_ids)),
  'OFF: the 6:05 escalation claims nothing (claim_missed_commitments, 0217)');
select _ok((select count(*) = 0 from claim_rollcall_card_opens(200) where instance_id in (select i1 from _ro_ids union select i2 from _ro_ids)),
  'OFF: no Live Activity opens at the window (claim_rollcall_card_opens)');
select _ok((select count(*) = 0 from _ro_ids, claim_rollcall_notices(rc, 500)),
  'OFF: no assignment / change notice is claimed (claim_rollcall_notices)');
select _ok((select (rollcall_notify_claim(rc, coach) ->> 'ok')::boolean is not true from _ro_ids),
  'OFF: Start/Save "tell them now" claims nothing (rollcall_notify_claim)');
select _ok((select (rollcall_arm_remind_claim(i1, coach) ->> 'ok')::boolean is not true from _ro_ids),
  'OFF: "Remind the N not set" claims nothing (rollcall_arm_remind_claim)');
select _ok((select count(*) = 0 from _ro_ids, rollcall_remind_rows_svc(rc, array[a, b])),
  'OFF: no remind rows are shaped (rollcall_remind_rows_svc)');
select _ok(materialize_rollcalls_ahead(14) = 0, 'OFF: the 14-day materializer does nothing');
select _ok(materialize_active_commitments() = 0, 'OFF: the per-minute materializer does nothing');
select _ok((select status from commitment_responses r, _ro_ids x where r.instance_id = x.i2 and r.athlete_id = x.a) = 'pending',
  'OFF: an unanswered morning stays pending, never marked missed');

-- ---- deliberately still answerable: a tap on a push sent before the switch
select _ok((select ack_commitment_by_token(i2, a) is not null from _ro_ids),
  'OFF: a lock-screen tap from before the switch is still recorded (ack_commitment_by_token)');
select _ok((select acknowledged_at is not null from commitment_responses r, _ro_ids x where r.instance_id = x.i2 and r.athlete_id = x.a),
  'OFF: that answer is durable');

-- ================================================================ switch back ON
update feature_flags set kill_switch = false where name = 'verified_commitments';

select _ok((select (rollcall_nudge_claim(i2, coach) ->> 'ok')::boolean from _ro_ids),
  'ON: coach Nudge claims again (the guard, not the fixture, silenced it)');
select _ok((select (rollcall_schedule_notice_claim(i1, coach) ->> 'ok')::boolean from _ro_ids),
  'ON: "Tell athletes" claims again');
select _ok((select count(*) >= 1 from _ro_ids, rollcall_window_rows_svc(a, 14)),
  'ON: alarm codes mint again');
select _ok((select count(*) = 1 from _ro_ids, rollcall_live_update_targets(i2)),
  'ON: the fan-out finds A''s card again');
select _ok((select count(*) = 1 from _ro_ids, claim_live_team_updates(i2, array[a], 0)),
  'ON: the team update claims again');
select _ok((select count(*) = 1 from _ro_ids, claim_rollcall_card_starts(i2, array[b])),
  'ON: a card start claims again');
select _as('7bb00000-0000-0000-0000-000000000001');
select _ok(jsonb_array_length(rollcall_arming('7bb00000-0000-0000-0000-0000000000e1') -> 'rows') = 2,
  'ON: the arming read lists both athletes again');
select _ok(jsonb_array_length(rollcall_summary('7bb00000-0000-0000-0000-0000000000c1')) >= 1,
  'ON: the results read has this morning again');
select _superuser();

-- ================================================================ scoreboard
do $$
declare fails int; total int; bad text;
begin
  select count(*) filter (where not ok), count(*) into fails, total from _ro_results;
  raise notice '================================================';
  raise notice 'ROLL CALL OFF SUITE: % / % checks passed', total - fails, total;
  if fails > 0 then
    raise notice 'FAILED CHECKS:';
    for bad in select label from _ro_results where not ok order by n loop
      raise notice '  - %', bad;
    end loop;
    raise exception 'ROLL CALL OFF SUITE FAILED: % check(s) — see the FAIL lines above', fails;
  end if;
  raise notice 'ALL GREEN.';
end $$;

rollback;
