-- OnStandard — 0169/0170/0171 audit-fix suite (security audit 2026-07-30).
-- Runs against a MIGRATED local db, rolls back, fails non-zero if any check fails.
--   docker exec -i supabase_db_onstandard psql -U postgres -v ON_ERROR_STOP=1 < supabase/tests/code_entropy_and_limits_test.sql
--
-- Covers the three things those migrations are FOR:
--   · codes come from a CSPRNG, at the new width, from the unambiguous alphabet   (0169, finding #4)
--   · staff invites expire, and guessing is throttled after 10 misses            (0170, finding #5)
--   · photo buckets bound mime + size; has_premium_access is no longer probeable  (0171, findings #7/#11)
begin;

create table _ce (n serial, ok boolean, label text);
-- SECURITY DEFINER + explicit grants: half these checks run after `set role authenticated`, and a
-- plain function would hit "permission denied for table _ce". Same shape as admin_auth_test.
create or replace function _ok(cond boolean, label text) returns void language plpgsql security definer as $$
begin insert into _ce(ok,label) values (coalesce(cond,false),label);
  if coalesce(cond,false) then raise notice 'PASS: %',label; else raise warning 'FAIL: %',label; end if; end $$;
create or replace function _as(p uuid) returns void language plpgsql as $$
begin execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub',p,'role','authenticated','aal','aal1')::text, false);
  execute 'set role authenticated'; end $$;
create or replace function _su() returns void language plpgsql as $$ begin execute 'reset role'; end $$;
grant execute on function _ok(boolean,text) to authenticated, anon;
grant execute on function _as(uuid), _su() to authenticated, anon;

-- ---------------------------------------------------------------- actors
do $$
declare v_coach uuid; v_team uuid;
begin
  select id into v_coach from profiles order by created_at limit 1;
  if v_coach is null then raise exception 'seed at least one profile before running this suite'; end if;
  insert into teams (id, name, sport, join_code, created_by)
    values ('cccc0000-0000-0000-0000-0000000000c1','Entropy Test Team','football','ENTROPY1', v_coach)
    on conflict (id) do nothing;
  insert into team_staff (team_id, staff_id, role, status)
    values ('cccc0000-0000-0000-0000-0000000000c1', v_coach, 'head_coach', 'active')
    on conflict (team_id, staff_id) do update set role = 'head_coach', status = 'active';
  perform set_config('ce.coach', v_coach::text, false);
end $$;

-- ================================================================ 0169: CSPRNG codes
select _su();
select _ok(length(gen_code(10)) = 10, '0169: gen_code honours its length argument');
select _ok(gen_code(12) ~ '^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{12}$',
           '0169: gen_code emits only the unambiguous alphabet (no 0/O/1/I)');
-- Two draws colliding would mean a constant, i.e. no entropy at all.
select _ok(gen_code(16) <> gen_code(16), '0169: two draws differ');
select _ok(length(gen_join_code()) = 6, '0169: join codes stay 6 chars');
select _ok(gen_join_code() ~ '^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$',
           '0169: join codes use the unambiguous alphabet');

-- gen_code must not be reachable by a client role — it is an internal primitive.
select _ok(not has_function_privilege('authenticated', 'public.gen_code(int)', 'execute'),
           '0169: gen_code is revoked from authenticated');
select _ok(not has_function_privilege('anon', 'public.gen_code(int)', 'execute'),
           '0169: gen_code is revoked from anon');

-- Staff invites: minted by the head coach, at the WIDENED 10-char length.
select _as(current_setting('ce.coach')::uuid);
select _ok(length(create_staff_invite('cccc0000-0000-0000-0000-0000000000c1','assistant')) = 10,
           '0169: staff invite codes widened to 10 chars');

-- ================================================================ 0170: expiry + throttle
select _su();
select _ok((select expires_at from staff_invites
             where team_id = 'cccc0000-0000-0000-0000-0000000000c1' order by created_at desc limit 1)
           > now(), '0170: a fresh staff invite carries a future expiry');
select _ok((select attnotnull from pg_attribute
             where attrelid = 'staff_invites'::regclass and attname = 'expires_at'),
           '0170: staff_invites.expires_at is NOT NULL (no expiry-less row can exist)');

-- An EXPIRED invite must not redeem, even though it is still unused.
do $$
declare v_code text; v_other uuid;
begin
  select id into v_other from profiles where id <> current_setting('ce.coach')::uuid order by created_at limit 1;
  perform set_config('ce.other', coalesce(v_other::text, current_setting('ce.coach')), false);
  insert into staff_invites (team_id, role, code, created_by, expires_at)
    values ('cccc0000-0000-0000-0000-0000000000c1','assistant','EXPIRED123',
            current_setting('ce.coach')::uuid, now() - interval '1 day');
end $$;

-- A bad/expired code returns ZERO ROWS and does NOT raise. Both properties matter:
--   · zero rows (not a NULL row) — state.js reads a truthy row as a successful join;
--   · no raise — a raise would roll back the attempt counter claimed on the way in, which is the
--     bug the first draft of 0170 shipped with. See the migration header.
select _as(current_setting('ce.other')::uuid);
do $$
declare v_rows int; v_raised boolean := false;
begin
  begin
    select count(*) into v_rows from join_staff('EXPIRED123');
  exception when others then v_raised := true;
  end;
  perform _ok(not v_raised, '0170: an expired staff invite does not raise (counter must survive)');
  perform _ok(v_rows = 0,   '0170: an expired staff invite yields zero rows');
end $$;

-- The budget must ACTUALLY BIND: after 10 attempts the counter stops the lookup, and the
-- increments must have COMMITTED along the way (the whole point of the redesign).
do $$
declare i int;
begin
  for i in 1..10 loop
    perform join_staff('NOSUCHCODE' || i::text);
  end loop;
end $$;

-- ai_usage_key_daily is deny-all to clients (by design), so read the tally as superuser.
select _su();
do $$
declare v_count int;
begin
  select count into v_count from ai_usage_key_daily
   where key = 'joinstaff:' || current_setting('ce.other') and day = current_date;
  perform _ok(coalesce(v_count,0) >= 10,
              '0170: failed attempts are actually recorded (increment survives the miss path)');
end $$;

-- THE DECISIVE CHECK. Mint two identical, valid codes. The caller who just burned ten attempts
-- gets NOTHING for a perfectly good code — proof the budget blocks before the lookup runs and is
-- not merely counting. A caller with a fresh budget redeems the other one normally.
select _su();
do $$
declare v_third uuid;
begin
  select id into v_third from profiles
   where id not in (current_setting('ce.coach')::uuid, current_setting('ce.other')::uuid)
   order by created_at limit 1;
  if v_third is null then raise exception 'this suite needs 3 profiles seeded'; end if;
  perform set_config('ce.third', v_third::text, false);
  insert into staff_invites (team_id, role, code, created_by) values
    ('cccc0000-0000-0000-0000-0000000000c1','assistant','GOODCODEA1', current_setting('ce.coach')::uuid),
    ('cccc0000-0000-0000-0000-0000000000c1','assistant','GOODCODEB2', current_setting('ce.coach')::uuid);
end $$;

select _as(current_setting('ce.other')::uuid);   -- budget spent
do $$
declare v_rows int;
begin
  select count(*) into v_rows from join_staff('GOODCODEA1');
  perform _ok(v_rows = 0, '0170: an over-budget caller is refused even a VALID code');
end $$;

select _su();
do $$
declare v_used uuid;
begin
  select used_by into v_used from staff_invites where code = 'GOODCODEA1';
  perform _ok(v_used is null, '0170: the blocked attempt did not consume the invite');
end $$;

select _as(current_setting('ce.third')::uuid);   -- fresh budget
do $$
declare v_rows int;
begin
  select count(*) into v_rows from join_staff('GOODCODEB2');
  perform _ok(v_rows = 1, '0170: a caller with budget left still redeems a valid code');
end $$;

-- join_team is deliberately UNCHANGED (it still raises) — its callers distinguish team from
-- practice by the error. Pin that so nobody "helpfully" makes it quiet later.
do $$
declare v_raised boolean := false;
begin
  begin
    perform join_team('NOSUCHTEAMCODE');
  exception when others then v_raised := true;
  end;
  perform _ok(v_raised, '0170: join_team still raises on a bad code (its callers rely on it)');
end $$;

-- ================================================================ 0171: storage + grants
select _su();
select _ok((select allowed_mime_types from storage.buckets where id = 'meal-photos') @> array['image/jpeg'],
           '0171: meal-photos allows jpeg');
select _ok(not ((select allowed_mime_types from storage.buckets where id = 'meal-photos') @> array['text/html']),
           '0171: meal-photos REFUSES text/html (the stored-XSS vector)');
select _ok((select file_size_limit from storage.buckets where id = 'meal-photos') = 12582912,
           '0171: meal-photos carries a 12MB ceiling');
select _ok(not ((select allowed_mime_types from storage.buckets where id = 'progress-photos') @> array['text/html']),
           '0171: progress-photos REFUSES text/html');

select _ok(not has_function_privilege('authenticated', 'public.has_premium_access(uuid)', 'execute'),
           '0171: has_premium_access(uuid) is no longer callable by authenticated');
select _ok(has_function_privilege('service_role', 'public.has_premium_access(uuid)', 'execute'),
           '0171: has_premium_access(uuid) is still callable by service_role');
select _ok(has_function_privilege('authenticated', 'public.my_premium_access()', 'execute'),
           '0171: my_premium_access() (self-only) is granted to authenticated');
select _ok(not has_function_privilege('anon', 'public.my_premium_access()', 'execute'),
           '0171: my_premium_access() is revoked from anon');

-- ---------------------------------------------------------------- verdict
select _su();
do $$
declare v_total int; bad int; r record;
begin
  select count(*), count(*) filter (where not ok) into v_total, bad from _ce;
  raise notice '=== audit-fix suite: % checks, % failed ===', v_total, bad;
  if bad > 0 then
    for r in select label from _ce where not ok order by _ce.n loop
      raise notice '  - %', r.label;
    end loop;
    raise exception 'AUDIT-FIX SUITE FAILED: % check(s)', bad;
  end if;
end $$;

rollback;
