-- OnStandard — Command Center admin-auth MONITOR audit (Plan 2). Migrated local db, rolls back.
--   docker exec -i supabase_db_onstandard psql -U postgres -v ON_ERROR_STOP=1 < supabase/tests/admin_monitor_test.sql
begin;

create table _mo (n serial, ok boolean, label text);
create or replace function _ok(cond boolean, label text) returns void language plpgsql security definer as $$
begin insert into _mo(ok,label) values (coalesce(cond,false),label);
  if coalesce(cond,false) then raise notice 'PASS: %',label; else raise warning 'FAIL: %',label; end if; end $$;

do $$
declare a uuid;
begin
  select id into a from profiles order by created_at limit 1;
  insert into platform_admins(user_id) values (a) on conflict do nothing;
  perform set_config('mon.admin', a::text, false);
end $$;

-- MFA throttle hook: 4 fails continue, 5th rejects, stays locked, valid resets
do $$
declare a uuid := current_setting('mon.admin')::uuid; r jsonb; i int;
begin
  delete from admin_auth_throttle where user_id=a;
  for i in 1..4 loop
    r := hook_mfa_verification_attempt(jsonb_build_object('user_id',a,'valid',false,'factor_type','totp'));
  end loop;
  perform _ok((r->>'decision')='continue','throttle: 4 fails still continue');
  r := hook_mfa_verification_attempt(jsonb_build_object('user_id',a,'valid',false,'factor_type','totp'));
  perform _ok((r->>'decision')='reject','throttle: 5th fail rejects');
  r := hook_mfa_verification_attempt(jsonb_build_object('user_id',a,'valid',false,'factor_type','totp'));
  perform _ok((r->>'decision')='reject','throttle: stays locked');
  update admin_auth_throttle set locked_until = now() - interval '1s' where user_id=a;
  r := hook_mfa_verification_attempt(jsonb_build_object('user_id',a,'valid',true,'factor_type','totp'));
  perform _ok((r->>'decision')='continue' and (select fail_count from admin_auth_throttle where user_id=a)=0,'throttle: valid resets');
  -- fail-open on a garbage event (no user_id)
  r := hook_mfa_verification_attempt('{}'::jsonb);
  perform _ok((r->>'decision')='continue','throttle: garbage event fails open');
end $$;

-- Anomaly detector
do $$
declare a uuid := current_setting('mon.admin')::uuid; f text[];
begin
  delete from admin_login_events where user_id=a;
  insert into admin_login_events(user_id,event_type,ip,country,asn,occurred_at)
    values (a,'login','1.1.1.1','US','AS1', now() - interval '2 days');

  f := admin_detect_login_anomalies(a,'1.1.1.1','US','AS1', (current_date + time '14:00') at time zone 'America/New_York', 'America/New_York');
  perform _ok(not ('new_ip'=any(f)) and not ('new_country'=any(f)) and not ('off_hours'=any(f)),'detect: known ip/country/daytime -> clean');

  f := admin_detect_login_anomalies(a,'9.9.9.9','RU','AS9', now(), 'America/New_York');
  perform _ok('new_country'=any(f),'detect: flags new_country');
  perform _ok('new_ip'=any(f),'detect: flags new_ip');
  perform _ok('new_asn'=any(f),'detect: flags new_asn');

  f := admin_detect_login_anomalies(a,'1.1.1.1','US','AS1', (current_date + time '03:00') at time zone 'America/New_York', 'America/New_York');
  perform _ok('off_hours'=any(f),'detect: flags off_hours');

  -- impossible travel: a recent US login, then RU seconds later
  insert into admin_login_events(user_id,event_type,ip,country,asn,occurred_at)
    values (a,'login','2.2.2.2','US','AS2', now() - interval '2 minutes');
  f := admin_detect_login_anomalies(a,'9.9.9.9','RU','AS9', now(), 'America/New_York');
  perform _ok('impossible_travel'=any(f),'detect: flags impossible_travel');
end $$;

do $$
declare v_fail int;
begin
  select count(*) into v_fail from _mo where not ok;
  raise notice '=== admin-auth monitor: % checks, % failed ===', (select count(*) from _mo), v_fail;
  if v_fail > 0 then raise exception '% monitor checks FAILED', v_fail; end if;
end $$;

rollback;
