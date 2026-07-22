-- OnStandard — Command Center admin-auth GATE audit (Plan 1). Runs against a MIGRATED local db,
-- rolls back, fails non-zero if any check fails.
--   docker exec -i supabase_db_onstandard psql -U postgres -v ON_ERROR_STOP=1 < supabase/tests/admin_auth_test.sql
begin;

create table _aa (n serial, ok boolean, label text);
create or replace function _ok(cond boolean, label text) returns void language plpgsql security definer as $$
begin insert into _aa(ok,label) values (coalesce(cond,false),label);
  if coalesce(cond,false) then raise notice 'PASS: %',label; else raise warning 'FAIL: %',label; end if; end $$;
grant execute on function _ok(boolean,text) to authenticated, anon;

create or replace function _as1(p uuid) returns void language plpgsql as $$
begin execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub',p,'role','authenticated','aal','aal1')::text, false);
  execute 'set role authenticated'; end $$;
create or replace function _as2(p uuid) returns void language plpgsql as $$
begin execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub',p,'role','authenticated','aal','aal2')::text, false);
  execute 'set role authenticated'; end $$;
create or replace function _su() returns void language plpgsql as $$ begin execute 'reset role'; end $$;
grant execute on function _as1(uuid),_as2(uuid),_su() to authenticated, anon;

do $$
declare v_admin uuid; v_other uuid;
begin
  select id into v_admin from profiles order by created_at limit 1;
  select id into v_other from profiles where id <> v_admin order by created_at limit 1;
  insert into platform_admins(user_id) values (v_admin) on conflict do nothing;
  perform set_config('aa.admin', v_admin::text, false);
  perform set_config('aa.other', v_other::text, false);
end $$;

-- is_platform_admin (now aal2-gated) + assert_admin_mfa
select _su();
do $$
declare a uuid := current_setting('aa.admin')::uuid; o uuid := current_setting('aa.other')::uuid; m text;
begin
  perform _as2(a); perform _ok(is_platform_admin(),'is_platform_admin: admin@aal2 -> true');
  perform _as1(a); perform _ok(not is_platform_admin(),'is_platform_admin: admin@aal1 -> false');
  perform _as2(o); perform _ok(not is_platform_admin(),'is_platform_admin: non-admin@aal2 -> false');

  perform _as2(a);
  begin perform assert_admin_mfa(); perform _ok(true,'assert_admin_mfa: admin@aal2 passes');
  exception when others then perform _ok(false,'assert_admin_mfa admin@aal2 ('||sqlerrm||')'); end;
  perform _as1(a);
  begin perform assert_admin_mfa(); perform _ok(false,'assert_admin_mfa: admin@aal1 must raise');
  exception when others then m:=sqlerrm; perform _ok(m like '%mfa required%','assert_admin_mfa: admin@aal1 -> mfa required'); end;
  perform _as2(o);
  begin perform assert_admin_mfa(); perform _ok(false,'assert_admin_mfa: non-admin must raise');
  exception when others then m:=sqlerrm; perform _ok(m like '%not authorized%','assert_admin_mfa: non-admin -> not authorized'); end;

  -- self-allowlist check works at aal1 (for the recovery flow)
  perform _as1(a); perform _ok(admin_self_is_allowlisted(),'admin_self_is_allowlisted: admin@aal1 -> true');
  perform _as1(o); perform _ok(not admin_self_is_allowlisted(),'admin_self_is_allowlisted: non-admin -> false');
end $$;
select _su();

-- admin_bootstrap v2 routing flags
do $$
declare a uuid := current_setting('aa.admin')::uuid; o uuid := current_setting('aa.other')::uuid; b jsonb;
begin
  perform _as1(o); b := admin_bootstrap();
  perform _ok((b->>'is_admin')='false','bootstrap: non-admin is_admin=false');

  perform _su();  -- superuser to touch auth.mfa_factors directly
  delete from auth.mfa_factors where user_id = a;
  perform _as1(a); b := admin_bootstrap();
  perform _ok((b->>'mfa_enrolled')='false','bootstrap: admin no-factor mfa_enrolled=false');
  perform _ok((b->>'access_granted')='false','bootstrap: admin@aal1 access_granted=false');
  perform _ok((b->'capabilities'->>'read')='false','bootstrap: capabilities off @aal1');

  perform _su();  -- superuser to insert a verified factor
  insert into auth.mfa_factors(id,user_id,friendly_name,factor_type,status,created_at,updated_at)
    values (gen_random_uuid(), a, 'test', 'totp', 'verified', now(), now());
  perform _as2(a); b := admin_bootstrap();
  perform _ok((b->>'mfa_enrolled')='true','bootstrap: verified-factor mfa_enrolled=true');
  perform _ok((b->>'access_granted')='true','bootstrap: admin@aal2+factor access_granted=true');
  perform _ok((b->'capabilities'->>'read')='true','bootstrap: capabilities on @aal2');
end $$;
select _su();

-- existing admin RPC is auto-gated at aal1 (choke point), works at aal2
do $$
declare a uuid := current_setting('aa.admin')::uuid; m text;
begin
  perform _as1(a);
  begin perform admin_overview(); perform _ok(false,'admin_overview must be blocked @aal1');
  exception when others then m:=sqlerrm; perform _ok(m like '%not authorized%','admin_overview -> not authorized @aal1'); end;
  perform _as2(a);
  begin perform admin_overview(); perform _ok(true,'admin_overview works @aal2');
  exception when others then perform _ok(false,'admin_overview @aal2 ('||sqlerrm||')'); end;
end $$;
select _su();

-- recovery codes
do $$
declare a uuid := current_setting('aa.admin')::uuid; codes text[]; ok1 boolean; ok2 boolean;
begin
  perform _as2(a);
  codes := admin_generate_recovery_codes();
  perform _su();  -- superuser to inspect the deny-all recovery table
  perform _ok(array_length(codes,1)=10,'recovery: generates 10 codes');
  perform _ok((select count(*) from admin_recovery_codes where user_id=a and used_at is null)=10,'recovery: 10 unused hashes stored');
  perform _ok((select count(*) from admin_recovery_codes where user_id=a and code_hash=codes[1])=0,'recovery: plaintext not stored (hashed)');
  ok1 := admin_verify_recovery_code(a, codes[1]);
  ok2 := admin_verify_recovery_code(a, codes[1]);
  perform _ok(ok1 and not ok2,'recovery: code is single-use');
end $$;
select _su();

do $$
declare v_fail int;
begin
  select count(*) into v_fail from _aa where not ok;
  raise notice '=== admin-auth gate: % checks, % failed ===', (select count(*) from _aa), v_fail;
  if v_fail > 0 then raise exception '% admin-auth checks FAILED', v_fail; end if;
end $$;

rollback;
