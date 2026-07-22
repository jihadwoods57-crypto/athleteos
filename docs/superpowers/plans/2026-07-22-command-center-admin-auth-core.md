# Command Center — Admin Auth Core (MFA Gate) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make MFA (TOTP) mandatory to reach the Founder Command Center — enforced server-side in Postgres — with enroll, per-login challenge, recovery codes, forgot-password, and admin session timeouts.

**Architecture:** The Command Center is a static browser client using only the Supabase *publishable* key, so all enforcement lives server-side. A single guard, `assert_admin_mfa()`, requires `platform_admin` AND `aal2` on every admin data/mutation RPC; `admin_bootstrap` is the only RPC callable at `aal1` (it returns routing flags, no data). The client becomes a small state machine (password → enroll/challenge → shell) using Supabase's native MFA API; recovery + session limits are added client-side and via one edge function.

**Tech Stack:** Supabase Postgres (SECURITY DEFINER RPCs), Supabase Auth MFA (TOTP/`aal2`), Supabase Edge Functions (Deno), vanilla ESM (`web/admin`), `@supabase/supabase-js@2`. Tests: repo SQL authz suite (`psql` + `_ok/_as` harness), Node built-in test runner (`node --test`), Playwright headless smoke.

## Global Constraints

- **Server-authoritative only.** The browser never decides access; every guard is a Postgres/Edge check. Copy verbatim into every task.
- **Publishable key only in the browser.** Never place a service-role key in `web/admin`.
- **Spec invariant:** No admin data or mutation crosses without `platform_admin` AND `aal2`. `admin_bootstrap` is the ONLY admin RPC callable at `aal1`.
- **Migration numbering:** latest on the tree today is `0128`. **Verify the highest number immediately before creating the file** (a concurrent session may add more); this plan uses `0129`. Apply the file **directly** to prod (`supabase db query --linked -f <file>`), not `db push`, per the shared-tree lesson.
- **Prod auth config changes go through the Supabase Management API PATCH — NEVER `supabase config push`** (a push on 2026-07-22 regressed prod: disabled MFA/Apple, loosened rate limits).
- **UI:** match the existing dark-premium blue→teal system in `web/admin/index.html`; add no new fonts or runtime deps; keep the CSP in `index.html` intact (only add an origin if a new one is genuinely required).
- **Local test DB:** `supabase start` then apply migrations with `supabase db reset` (re-runs all migrations against local port 54322). SQL suite target: `postgresql://postgres:postgres@127.0.0.1:54322/postgres`.

---

### Task 1: AAL2 guard primitives (`admin_is_aal2`, `assert_admin_mfa`) + aal test harness

**Files:**
- Create: `supabase/migrations/0129_admin_auth_gate.sql`
- Create: `supabase/tests/admin_auth_test.sql`

**Interfaces:**
- Produces: `public.admin_is_aal2() returns boolean` (internal; execute revoked from app roles) — true iff `auth.jwt()->>'aal' = 'aal2'`.
- Produces: `public.assert_admin_mfa() returns void` — raises `not authorized` unless `is_platform_admin()`, then raises `mfa required` unless `admin_is_aal2()`. Granted to `authenticated` (RPCs call it).

- [ ] **Step 1: Write the failing test** — create `supabase/tests/admin_auth_test.sql` with a self-contained harness (this file runs against a migrated local DB and rolls back).

```sql
-- OnStandard — Command Center admin-auth gate audit. Runs against a MIGRATED local db, rolls back.
--   psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -v ON_ERROR_STOP=1 -f supabase/tests/admin_auth_test.sql
begin;

create table _aa_results (n serial, ok boolean, label text);
create or replace function _ok(cond boolean, label text) returns void
language plpgsql security definer as $$
begin
  insert into _aa_results(ok, label) values (coalesce(cond,false), label);
  if coalesce(cond,false) then raise notice 'PASS: %', label; else raise warning 'FAIL: %', label; end if;
end $$;
grant execute on function _ok(boolean, text) to authenticated, anon;

-- become an actor at aal1 (no aal claim)
create or replace function _as1(p_uid uuid) returns void language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub',p_uid,'role','authenticated','aal','aal1')::text, false);
  execute 'set role authenticated';
end $$;
-- become an actor at aal2 (MFA-verified)
create or replace function _as2(p_uid uuid) returns void language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub',p_uid,'role','authenticated','aal','aal2')::text, false);
  execute 'set role authenticated';
end $$;
create or replace function _su() returns void language plpgsql as $$ begin execute 'reset role'; end $$;
grant execute on function _as1(uuid), _as2(uuid), _su() to authenticated, anon;

-- seed: one platform admin, one non-admin (reuse any two existing profiles)
do $$
declare v_admin uuid; v_other uuid;
begin
  select id into v_admin from profiles order by created_at limit 1;
  select id into v_other from profiles where id <> v_admin order by created_at limit 1;
  insert into platform_admins(user_id) values (v_admin) on conflict do nothing;
  perform set_config('aa.admin', v_admin::text, false);
  perform set_config('aa.other', v_other::text, false);
end $$;

-- assert_admin_mfa: admin@aal2 passes; admin@aal1 raises 'mfa required'; non-admin raises 'not authorized'
select _su();
do $$
declare v_admin uuid := current_setting('aa.admin')::uuid; v_other uuid := current_setting('aa.other')::uuid; v_msg text;
begin
  perform _as2(v_admin);
  begin perform assert_admin_mfa(); perform _ok(true,'assert_admin_mfa: admin@aal2 passes');
  exception when others then perform _ok(false,'assert_admin_mfa: admin@aal2 passes ('||sqlerrm||')'); end;

  perform _as1(v_admin);
  begin perform assert_admin_mfa(); perform _ok(false,'assert_admin_mfa: admin@aal1 must raise');
  exception when others then v_msg := sqlerrm; perform _ok(v_msg like '%mfa required%','assert_admin_mfa: admin@aal1 -> mfa required'); end;

  perform _as2(v_other);
  begin perform assert_admin_mfa(); perform _ok(false,'assert_admin_mfa: non-admin must raise');
  exception when others then v_msg := sqlerrm; perform _ok(v_msg like '%not authorized%','assert_admin_mfa: non-admin -> not authorized'); end;
end $$;
select _su();

-- scoreboard: fail the run if any check failed
do $$
declare v_fail int;
begin
  select count(*) into v_fail from _aa_results where not ok;
  raise notice '=== admin-auth checks: % total, % failed ===', (select count(*) from _aa_results), v_fail;
  if v_fail > 0 then raise exception '% admin-auth checks FAILED', v_fail; end if;
end $$;

rollback;
```

- [ ] **Step 2: Run it to verify it fails**

Run: `supabase start && supabase db reset` then
`psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -v ON_ERROR_STOP=1 -f supabase/tests/admin_auth_test.sql`
Expected: FAIL — `function assert_admin_mfa() does not exist`.

- [ ] **Step 3: Write minimal implementation** — start `0129_admin_auth_gate.sql`:

```sql
-- OnStandard — Command Center Phase 2 auth: MFA/AAL2 enforcement. The spine invariant:
-- no admin data or mutation crosses without platform_admin AND aal2. admin_bootstrap is the ONLY
-- admin RPC callable at aal1 (it returns routing flags, no data). See spec 2026-07-22.

-- aal2 from the SIGNED jwt. Internal (no app role gets EXECUTE).
create or replace function public.admin_is_aal2() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(auth.jwt()->>'aal', 'aal1') = 'aal2';
$$;
revoke execute on function public.admin_is_aal2() from anon, authenticated;

-- The single guard every admin data/mutation RPC calls.
create or replace function public.assert_admin_mfa() returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_platform_admin() then raise exception 'not authorized'; end if;
  if not admin_is_aal2()     then raise exception 'mfa required';   end if;
end $$;
grant execute on function public.assert_admin_mfa() to authenticated;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `supabase db reset && psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -v ON_ERROR_STOP=1 -f supabase/tests/admin_auth_test.sql`
Expected: PASS — `admin-auth checks: 3 total, 0 failed`.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/0129_admin_auth_gate.sql supabase/tests/admin_auth_test.sql
git commit -m "feat(cc-auth): admin_is_aal2 + assert_admin_mfa guard + aal test harness"
```

---

### Task 2: `admin_bootstrap` v2 — mfa_enrolled + aal + access_granted

**Files:**
- Modify: `supabase/migrations/0129_admin_auth_gate.sql` (append)
- Modify: `supabase/tests/admin_auth_test.sql` (append checks before the scoreboard)

**Interfaces:**
- Consumes: `admin_is_aal2()` (Task 1), `is_platform_admin()` (existing).
- Produces: `admin_bootstrap()` now returns, in addition to today's fields: `mfa_enrolled boolean` (from `auth.mfa_factors` where `status='verified'`), `aal text`, `access_granted boolean = is_admin AND aal='aal2' AND mfa_enrolled`, and `capabilities` all `false` unless `access_granted`.

- [ ] **Step 1: Write the failing test** — append to `admin_auth_test.sql` (before the scoreboard `do $$`):

```sql
-- admin_bootstrap v2: non-admin -> {is_admin:false}; admin@aal1 no factor -> access_granted:false, mfa_enrolled:false;
-- admin@aal2 with a verified factor -> access_granted:true
select _su();
do $$
declare v_admin uuid := current_setting('aa.admin')::uuid; v_other uuid := current_setting('aa.other')::uuid; b jsonb;
begin
  perform _as1(v_other);
  b := admin_bootstrap();
  perform _ok((b->>'is_admin')='false','bootstrap: non-admin is_admin=false');

  -- ensure no verified factor for the admin, aal1
  delete from auth.mfa_factors where user_id = v_admin;
  perform _as1(v_admin);
  b := admin_bootstrap();
  perform _ok((b->>'mfa_enrolled')='false','bootstrap: admin no-factor mfa_enrolled=false');
  perform _ok((b->>'access_granted')='false','bootstrap: admin@aal1 access_granted=false');
  perform _ok((b->'capabilities'->>'read')='false','bootstrap: capabilities gated off at aal1');

  -- simulate a verified TOTP factor + aal2
  insert into auth.mfa_factors(id,user_id,friendly_name,factor_type,status,created_at,updated_at)
    values (gen_random_uuid(), v_admin, 'test', 'totp', 'verified', now(), now());
  perform _as2(v_admin);
  b := admin_bootstrap();
  perform _ok((b->>'mfa_enrolled')='true','bootstrap: verified-factor mfa_enrolled=true');
  perform _ok((b->>'access_granted')='true','bootstrap: admin@aal2+factor access_granted=true');
  perform _ok((b->'capabilities'->>'read')='true','bootstrap: capabilities on at aal2');
end $$;
select _su();
```

- [ ] **Step 2: Run to verify it fails**

Run: `supabase db reset && psql … -f supabase/tests/admin_auth_test.sql`
Expected: FAIL — `mfa_enrolled` / `access_granted` keys missing (null).

- [ ] **Step 3: Implement** — append to `0129_admin_auth_gate.sql`:

```sql
-- admin_bootstrap v2 — still callable at aal1 (returns routing flags only, no platform data).
create or replace function public.admin_bootstrap()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_admin boolean; v_email text; v_enrolled boolean; v_aal text; v_access boolean;
begin
  v_admin := is_platform_admin();
  if not v_admin then return jsonb_build_object('is_admin', false); end if;
  select email into v_email from profiles where id = auth.uid();
  v_enrolled := exists (select 1 from auth.mfa_factors f where f.user_id = auth.uid() and f.status = 'verified');
  v_aal := coalesce(auth.jwt()->>'aal', 'aal1');
  v_access := v_admin and v_aal = 'aal2' and v_enrolled;
  return jsonb_build_object(
    'is_admin', true,
    'email', v_email,
    'environment', 'production',
    'spec_version', 'phase-2-auth',
    'mfa_enrolled', v_enrolled,
    'aal', v_aal,
    'access_granted', v_access,
    'billing_connected', false,
    'reauth_required', false,
    'server_time', now(),
    'capabilities', jsonb_build_object(
      'read', v_access, 'mutate_users', v_access, 'impersonate', v_access,
      'financial', v_access, 'flags', v_access, 'config', v_access)
  );
end $$;
grant execute on function public.admin_bootstrap() to authenticated;
```

- [ ] **Step 4: Run to verify it passes**

Run: `supabase db reset && psql … -f supabase/tests/admin_auth_test.sql`
Expected: PASS — all bootstrap checks green.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/0129_admin_auth_gate.sql supabase/tests/admin_auth_test.sql
git commit -m "feat(cc-auth): admin_bootstrap v2 reports mfa_enrolled/aal/access_granted, gates capabilities"
```

---

### Task 3: Require aal2 on all mutation/sensitive admin RPCs

**Files:**
- Modify: `supabase/migrations/0129_admin_auth_gate.sql` (append `create or replace` re-definitions)
- Modify: `supabase/tests/admin_auth_test.sql` (append denial checks)

**Interfaces:**
- Consumes: `assert_admin_mfa()` (Task 1).
- Produces: every listed RPC raises `mfa required` at `aal1` and works at `aal2`.

**The mutation/sensitive set** (guard swap: replace the body's `if not is_platform_admin() then raise exception 'not authorized'; end if;` with `perform assert_admin_mfa();`, keeping the rest of each body verbatim from its origin migration):

- `admin_open_sensitive_window(text, boolean)` — `0120`
- `admin_set_flag(text,text,boolean,boolean,uuid[],text[],uuid[])` — `0109`
- user actions in `0122_cc_user_actions.sql` (e.g. `admin_set_user_role`, `admin_suspend_user`, `admin_soft_delete_user` — enumerate from the file)
- view-as in `0123_cc_view_as.sql` (`admin_begin_view_as`, `admin_end_view_as`)
- support actions in `0125_cc_support.sql` (ticket status/assignment mutations)
- config writes in `0126_cc_config.sql` (`admin_set_config` and siblings)
- payments actions in `0127_cc_payments.sql` (any mutating RPC; read-only payment RPCs go in Task 4)

> **How to do this mechanically:** open each origin migration, copy the current function definition, change ONLY the guard line to `perform assert_admin_mfa();`, and paste the whole `create or replace function …` into `0129`. `create or replace` is idempotent and re-defining in a later migration is the established pattern in this repo.

- [ ] **Step 1: Write the failing test** — append to `admin_auth_test.sql`. Pick two representative mutations that are safe to call in-txn (they raise before doing work at aal1):

```sql
select _su();
do $$
declare v_admin uuid := current_setting('aa.admin')::uuid; v_msg text;
begin
  perform _as1(v_admin);  -- aal1 admin
  begin perform admin_open_sensitive_window('test_scope', false);
        perform _ok(false,'mutation admin_open_sensitive_window blocked at aal1');
  exception when others then v_msg := sqlerrm;
        perform _ok(v_msg like '%mfa required%','admin_open_sensitive_window -> mfa required @aal1'); end;

  begin perform admin_set_flag('__t','',false,false,'{}','{}','{}');
        perform _ok(false,'mutation admin_set_flag blocked at aal1');
  exception when others then v_msg := sqlerrm;
        perform _ok(v_msg like '%mfa required%','admin_set_flag -> mfa required @aal1'); end;
end $$;
select _su();
```

- [ ] **Step 2: Run to verify it fails**

Expected: FAIL — at `aal1` these currently raise `reauth required` / succeed-then-`not authorized`, not `mfa required`.

- [ ] **Step 3: Implement** — append the guard-swapped `create or replace` definitions of every function in the mutation set to `0129_admin_auth_gate.sql`. (Enumerate by reading `0120/0109/0122/0123/0125/0126/0127`; paste each full body with the single guard line changed.)

- [ ] **Step 4: Run to verify it passes**

Expected: PASS — both representative mutations raise `mfa required` at `aal1`.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/0129_admin_auth_gate.sql supabase/tests/admin_auth_test.sql
git commit -m "feat(cc-auth): require aal2 on all admin mutation/sensitive RPCs"
```

---

### Task 4: Require aal2 on all read admin RPCs (complete the spine)

**Files:**
- Modify: `supabase/migrations/0129_admin_auth_gate.sql` (append)
- Modify: `supabase/tests/admin_auth_test.sql` (append)

**Interfaces:**
- Produces: every admin **read** RPC (`admin_global_search`, `admin_audit_search`, `admin_recent_audit`, `admin_daily_activity`, `admin_overview`, and the section read RPCs in `0116/0117/0118/0127`) raises `mfa required` at `aal1`.

> Same mechanical guard swap as Task 3, applied to the read RPCs. `admin_bootstrap` is explicitly EXCLUDED (must stay aal1-callable).

- [ ] **Step 1: Write the failing test** — append representative read checks:

```sql
select _su();
do $$
declare v_admin uuid := current_setting('aa.admin')::uuid; v_msg text;
begin
  perform _as1(v_admin);
  begin perform admin_overview(); perform _ok(false,'read admin_overview blocked at aal1');
  exception when others then v_msg := sqlerrm; perform _ok(v_msg like '%mfa required%','admin_overview -> mfa required @aal1'); end;

  begin perform admin_daily_activity(7); perform _ok(false,'read admin_daily_activity blocked at aal1');
  exception when others then v_msg := sqlerrm; perform _ok(v_msg like '%mfa required%','admin_daily_activity -> mfa required @aal1'); end;

  -- and confirms it WORKS at aal2 (does not raise)
  perform _as2(v_admin);
  begin perform admin_overview(); perform _ok(true,'admin_overview works @aal2');
  exception when others then perform _ok(false,'admin_overview works @aal2 ('||sqlerrm||')'); end;
end $$;
select _su();
```

- [ ] **Step 2: Run to verify it fails** — Expected: FAIL (reads currently succeed at aal1).

- [ ] **Step 3: Implement** — append guard-swapped `create or replace` for every admin read RPC (exclude `admin_bootstrap`).

- [ ] **Step 4: Run to verify it passes** — Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/0129_admin_auth_gate.sql supabase/tests/admin_auth_test.sql
git commit -m "feat(cc-auth): require aal2 on all admin read RPCs (spine complete)"
```

---

### Task 5: Recovery codes — table + `admin_generate_recovery_codes()`

**Files:**
- Modify: `supabase/migrations/0129_admin_auth_gate.sql` (append)
- Modify: `supabase/tests/admin_auth_test.sql` (append)

**Interfaces:**
- Produces: table `public.admin_recovery_codes(id uuid, user_id uuid, code_hash text, created_at, used_at)` (deny-all).
- Produces: `admin_generate_recovery_codes() returns text[]` — requires `assert_admin_mfa()`; deletes the caller's prior unused codes, generates **10** random codes, stores their `sha256` hashes, returns the 10 plaintext codes ONCE; audited `recovery.codes_generated`.
- Produces: `admin_verify_recovery_code(p_user uuid, p_code text) returns boolean` — internal (execute revoked from app roles); marks a matching unused hash used and returns true, else false. Called by the `admin-mfa-recover` edge function under service role.

- [ ] **Step 1: Write the failing test** — append:

```sql
select _su();
do $$
declare v_admin uuid := current_setting('aa.admin')::uuid; codes text[]; ok1 boolean; ok2 boolean;
begin
  -- generate requires aal2
  perform _as2(v_admin);
  codes := admin_generate_recovery_codes();
  perform _ok(array_length(codes,1) = 10, 'recovery: generates 10 codes');
  perform _ok((select count(*) from admin_recovery_codes where user_id=v_admin and used_at is null)=10,'recovery: 10 unused hashes stored');
  perform _ok((select count(*) from admin_recovery_codes where user_id=v_admin and code_hash = codes[1])=0,'recovery: plaintext not stored (hashed)');

  -- verify (as service role / superuser context) consumes one code, second use fails
  perform _su();
  ok1 := admin_verify_recovery_code(v_admin, codes[1]);
  ok2 := admin_verify_recovery_code(v_admin, codes[1]);
  perform _ok(ok1 and not ok2, 'recovery: code is single-use');
end $$;
select _su();
```

- [ ] **Step 2: Run to verify it fails** — Expected: FAIL (table/functions absent).

- [ ] **Step 3: Implement** — append to `0129`:

```sql
create table if not exists public.admin_recovery_codes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  code_hash text not null,
  created_at timestamptz not null default now(),
  used_at timestamptz
);
create index if not exists admin_recovery_codes_user on public.admin_recovery_codes (user_id) where used_at is null;
alter table public.admin_recovery_codes enable row level security;
revoke all on table public.admin_recovery_codes from anon, authenticated;

-- 10 fresh codes; store sha256 hashes; return plaintext once. Requires just-enrolled aal2 admin.
create or replace function public.admin_generate_recovery_codes() returns text[]
language plpgsql volatile security definer set search_path = public, extensions as $$
declare v_codes text[] := '{}'; v_code text; i int;
begin
  perform assert_admin_mfa();
  delete from public.admin_recovery_codes where user_id = auth.uid() and used_at is null;
  for i in 1..10 loop
    v_code := encode(gen_random_bytes(6), 'hex');   -- 12 hex chars
    v_codes := array_append(v_codes, v_code);
    insert into public.admin_recovery_codes(user_id, code_hash)
      values (auth.uid(), encode(digest(v_code, 'sha256'), 'hex'));
  end loop;
  insert into public.admin_audit_log(actor_id, action, target)
    values (auth.uid(), 'recovery.codes_generated', auth.uid()::text);
  return v_codes;
end $$;
grant execute on function public.admin_generate_recovery_codes() to authenticated;

-- Internal: consume a code (single-use). Called by admin-mfa-recover under service role.
create or replace function public.admin_verify_recovery_code(p_user uuid, p_code text) returns boolean
language plpgsql volatile security definer set search_path = public, extensions as $$
declare v_id uuid;
begin
  select id into v_id from public.admin_recovery_codes
    where user_id = p_user and used_at is null
      and code_hash = encode(digest(p_code, 'sha256'), 'hex')
    limit 1;
  if v_id is null then return false; end if;
  update public.admin_recovery_codes set used_at = now() where id = v_id;
  return true;
end $$;
revoke execute on function public.admin_verify_recovery_code(uuid, text) from anon, authenticated;
```

> Requires the `pgcrypto` extension (`digest`, `gen_random_bytes`). It is already present (used across the schema); if a fresh DB errors, prepend `create extension if not exists pgcrypto with schema extensions;`.

- [ ] **Step 4: Run to verify it passes** — Expected: PASS (4 recovery checks).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/0129_admin_auth_gate.sql supabase/tests/admin_auth_test.sql
git commit -m "feat(cc-auth): admin recovery codes (hashed, single-use) + generate/verify RPCs"
```

---

### Task 6: `admin-mfa-recover` edge function (break-glass factor reset)

**Files:**
- Create: `supabase/functions/admin-mfa-recover/index.ts`
- Modify: `supabase/config.toml` (add `[functions.admin-mfa-recover]` with `verify_jwt = true`)
- Create: `supabase/functions/admin-mfa-recover/index.test.ts` (pure-logic unit test)

**Interfaces:**
- Consumes: `admin_verify_recovery_code(uuid,text)` (Task 5), `is_platform_admin()` context (via the caller's JWT), Supabase Admin API.
- Produces: `POST { code } ` with the caller's `aal1` JWT → verifies caller is a platform admin, consumes a recovery code, deletes the caller's TOTP factors via Admin API (so they can re-enroll), audits `recovery.used`; returns `{ ok: true }` or `4xx`.

- [ ] **Step 1: Write the failing test** — extract the pure guard into a helper and test it (`node --test`):

```ts
// index.test.ts — Deno/Node-agnostic pure logic; run: node --test supabase/functions/admin-mfa-recover/index.test.ts
import test from 'node:test';
import assert from 'node:assert';
import { parseRecoverBody } from './logic.mjs';

test('rejects empty code', () => {
  assert.deepEqual(parseRecoverBody({}), { ok: false, error: 'code required' });
});
test('trims and accepts a code', () => {
  assert.deepEqual(parseRecoverBody({ code: '  abc123  ' }), { ok: true, code: 'abc123' });
});
```

- [ ] **Step 2: Run to verify it fails** — Run: `node --test supabase/functions/admin-mfa-recover/index.test.ts` → FAIL (`logic.mjs` missing).

- [ ] **Step 3: Implement** — create `logic.mjs` + `index.ts`:

```js
// logic.mjs — pure request validation, testable outside Deno.
export function parseRecoverBody(body) {
  const code = typeof body?.code === 'string' ? body.code.trim() : '';
  if (!code) return { ok: false, error: 'code required' };
  return { ok: true, code };
}
```

```ts
// index.ts — break-glass MFA recovery. Auth: caller's aal1 JWT (verify_jwt=true) proves the password.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { parseRecoverBody } from './logic.mjs';

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  const url = Deno.env.get('SUPABASE_URL')!;
  const authHeader = req.headers.get('Authorization') ?? '';
  // caller-scoped client (their JWT) to identify + authorize
  const asUser = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: authHeader } } });
  const { data: u } = await asUser.auth.getUser();
  if (!u?.user) return json(401, { error: 'unauthenticated' });
  const { data: isAdmin } = await asUser.rpc('is_platform_admin_self'); // see note below
  // NOTE: is_platform_admin() is internal; add a tiny SECURITY DEFINER `is_platform_admin_self()`
  //       returning is_platform_admin(), granted to authenticated, in 0129 — OR check via service role.
  const svc = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const parsed = parseRecoverBody(await req.json().catch(() => ({})));
  if (!parsed.ok) return json(400, { error: parsed.error });

  const { data: ok } = await svc.rpc('admin_verify_recovery_code', { p_user: u.user.id, p_code: parsed.code });
  if (!ok) return json(403, { error: 'invalid or used code' });

  // remove the user's TOTP factors so they can re-enroll fresh
  const { data: factors } = await svc.auth.admin.mfa.listFactors({ userId: u.user.id });
  for (const f of factors?.factors ?? []) await svc.auth.admin.mfa.deleteFactor({ userId: u.user.id, id: f.id });
  await svc.from('admin_audit_log').insert({ actor_id: u.user.id, action: 'recovery.used', target: u.user.id });
  return json(200, { ok: true });
});
function json(status: number, body: unknown) { return new Response(JSON.stringify(body), { status, headers: { ...CORS, 'content-type': 'application/json' } }); }
```

> Add to `0129`: a thin `is_platform_admin_self() returns boolean` = `select is_platform_admin();`, granted to `authenticated`, so the edge function can authorize the caller without exposing the internal helper. (Add its trivial test to `admin_auth_test.sql`.)

Add to `supabase/config.toml`:
```toml
[functions.admin-mfa-recover]
verify_jwt = true
```

- [ ] **Step 4: Run to verify it passes** — Run: `node --test supabase/functions/admin-mfa-recover/index.test.ts` → PASS. Integration (manual, local): enroll a factor, generate codes, POST one to the served function, confirm the factor is removed + `recovery.used` audited.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/admin-mfa-recover supabase/config.toml supabase/migrations/0129_admin_auth_gate.sql supabase/tests/admin_auth_test.sql
git commit -m "feat(cc-auth): admin-mfa-recover break-glass edge function + is_platform_admin_self"
```

---

### Task 7: Client — login state machine + MFA challenge screen

**Files:**
- Modify: `web/admin/index.html` (add challenge/enroll/recovery/reset markup + a mount for messages)
- Modify: `web/admin/admin.js` (turn sign-in into a state machine; add challenge)

**Interfaces:**
- Consumes: `sb.auth.mfa.getAuthenticatorAssuranceLevel()`, `sb.auth.mfa.listFactors()`, `sb.auth.mfa.challengeAndVerify()`, `admin_bootstrap().access_granted`.
- Produces: after a correct password, if `nextLevel==='aal2' && currentLevel==='aal1'` the user is shown a 6-digit challenge; on success `gate()` runs and mounts the shell only when `access_granted`.

- [ ] **Step 1: Write the failing test** — extract the routing decision into a pure module `web/admin/authflow.mjs` and test it:

```ts
// web/admin/authflow.test.mjs — run: node --test web/admin/authflow.test.mjs
import test from 'node:test'; import assert from 'node:assert';
import { nextScreen } from './authflow.mjs';
test('no factor -> enroll', () => assert.equal(nextScreen({ currentLevel:'aal1', nextLevel:'aal1', hasFactor:false }), 'enroll'));
test('factor, aal1 -> challenge', () => assert.equal(nextScreen({ currentLevel:'aal1', nextLevel:'aal2', hasFactor:true }), 'challenge'));
test('aal2 -> app', () => assert.equal(nextScreen({ currentLevel:'aal2', nextLevel:'aal2', hasFactor:true }), 'app'));
```

- [ ] **Step 2: Run to verify it fails** — `node --test web/admin/authflow.test.mjs` → FAIL (`authflow.mjs` missing).

- [ ] **Step 3: Implement** — create `web/admin/authflow.mjs`:

```js
// Pure routing decision from Supabase MFA state. Keeps admin.js thin + testable.
export function nextScreen({ currentLevel, nextLevel, hasFactor }) {
  if (currentLevel === 'aal2') return 'app';
  if (nextLevel === 'aal2' && hasFactor) return 'challenge';
  return 'enroll';
}
```

Then wire `admin.js` sign-in to use it (replace the current `$('signin').onclick`):

```js
import { nextScreen } from './authflow.mjs';

async function routeAfterPassword() {
  const { data: aal } = await sb.auth.mfa.getAuthenticatorAssuranceLevel();
  const { data: f } = await sb.auth.mfa.listFactors();
  const hasFactor = (f?.totp ?? []).some(x => x.status === 'verified');
  const screen = nextScreen({ currentLevel: aal?.currentLevel, nextLevel: aal?.nextLevel, hasFactor });
  if (screen === 'app') return gate();
  if (screen === 'challenge') return showChallenge(f.totp.find(x => x.status === 'verified').id);
  return showEnroll();
}

$('signin').onclick = async () => {
  $('loginerr').textContent = '';
  const { error } = await sb.auth.signInWithPassword({ email: $('email').value.trim(), password: $('pw').value });
  if (error) { $('loginerr').textContent = error.message; return; }   // surfaces 'Too many attempts' etc.
  routeAfterPassword();
};

async function showChallenge(factorId) {
  show($('login'), false); show($('challenge'), true);
  $('chal-verify').onclick = async () => {
    $('chalerr').textContent = '';
    const { error } = await sb.auth.mfa.challengeAndVerify({ factorId, code: $('chal-code').value.trim() });
    if (error) { $('chalerr').textContent = error.message; return; }  // surfaces MFA lockout msg (Plan 2)
    gate();
  };
}
```

Add the challenge markup to `index.html` (dark-premium styling, reuse `.login .card`):

```html
<div id="challenge" class="login hidden"><div class="card">
  <div class="brand" style="margin-bottom:14px"><span class="mark"></span><div>OnStandard<small>Command Center</small></div></div>
  <h1>Enter your code</h1>
  <p>6-digit code from your authenticator app.</p>
  <label class="fld" for="chal-code">Authentication code</label>
  <input id="chal-code" inputmode="numeric" autocomplete="one-time-code" placeholder="123456">
  <div style="height:14px"></div>
  <button id="chal-verify" class="btn pri" style="width:100%;justify-content:center">Verify</button>
  <p id="chalerr" class="err"></p>
  <p style="margin-top:10px"><a id="use-recovery" href="#">Use a recovery code</a></p>
</div></div>
```

- [ ] **Step 4: Run to verify it passes** — `node --test web/admin/authflow.test.mjs` → PASS. Manual: with a seeded MFA-enrolled admin on the local stack, sign in → challenge appears → correct code → shell mounts.

- [ ] **Step 5: Commit**

```bash
git add web/admin/authflow.mjs web/admin/authflow.test.mjs web/admin/admin.js web/admin/index.html
git commit -m "feat(cc-auth): client login state machine + MFA challenge screen"
```

---

### Task 8: Client — TOTP enroll screen + recovery-code reveal

**Files:**
- Modify: `web/admin/admin.js` (add `showEnroll()`)
- Modify: `web/admin/index.html` (enroll markup)

**Interfaces:**
- Consumes: `sb.auth.mfa.enroll({ factorType:'totp' })`, `sb.auth.mfa.challengeAndVerify()`, `rpc('admin_generate_recovery_codes')` (Task 5).
- Produces: first-run admins enroll TOTP (QR + secret), verify a code, then see 10 recovery codes ONCE before the shell mounts.

- [ ] **Step 1: Write the failing test** — pure formatter test:

```ts
// web/admin/authflow.test.mjs — append
import { formatRecoveryCodes } from './authflow.mjs';
test('formats codes for display', () => assert.equal(formatRecoveryCodes(['aa','bb']), 'aa\nbb'));
```

- [ ] **Step 2: Run to verify it fails** — `node --test web/admin/authflow.test.mjs` → FAIL (`formatRecoveryCodes` missing).

- [ ] **Step 3: Implement** — add to `authflow.mjs`: `export const formatRecoveryCodes = (c) => c.join('\n');`

Add `showEnroll()` to `admin.js`:

```js
async function showEnroll() {
  show($('login'), false); show($('enroll'), true);
  const { data: en, error } = await sb.auth.mfa.enroll({ factorType: 'totp' });
  if (error) { $('enrollerr').textContent = error.message; return; }
  $('enroll-qr').src = en.totp.qr_code;            // data: URI (allowed by CSP img-src data:)
  $('enroll-secret').textContent = en.totp.secret;
  $('enroll-verify').onclick = async () => {
    $('enrollerr').textContent = '';
    const { error: vErr } = await sb.auth.mfa.challengeAndVerify({ factorId: en.id, code: $('enroll-code').value.trim() });
    if (vErr) { $('enrollerr').textContent = vErr.message; return; }
    const codes = await rpc('admin_generate_recovery_codes');   // now aal2
    $('recovery-list').textContent = formatRecoveryCodes(codes);
    show($('enroll'), false); show($('recovery'), true);
    $('recovery-done').onclick = () => gate();
  };
}
```

Add enroll + recovery markup to `index.html` (QR img, secret, code input; recovery: monospace list + "I saved these" button). Confirm `img-src 'self' data:` is already in the CSP (it is) so the QR renders.

- [ ] **Step 4: Run to verify it passes** — `node --test` → PASS. Manual: fresh admin (no factor) signs in → enroll → scan → verify → 10 codes shown → continue → shell.

- [ ] **Step 5: Commit**

```bash
git add web/admin/authflow.mjs web/admin/authflow.test.mjs web/admin/admin.js web/admin/index.html
git commit -m "feat(cc-auth): TOTP enroll screen + one-time recovery-code reveal"
```

---

### Task 9: Client — forgot-password + reset page

**Files:**
- Modify: `web/admin/index.html` (forgot link on login)
- Modify: `web/admin/admin.js` (reset email handler)
- Create: `web/admin/reset.html` (+ inline module to set a new password)

**Interfaces:**
- Consumes: `sb.auth.resetPasswordForEmail(email, { redirectTo })`, `sb.auth.updateUser({ password })`.
- Produces: a "Forgot password?" link that emails a reset; `reset.html` completes the new password from the recovery link.

- [ ] **Step 1: Write the failing test** — pure validator in `authflow.mjs`:

```ts
// authflow.test.mjs — append
import { validateNewPassword } from './authflow.mjs';
test('rejects <8', () => assert.equal(validateNewPassword('abc12').ok, false));
test('requires letters+digits', () => assert.equal(validateNewPassword('abcdefgh').ok, false));
test('accepts strong', () => assert.equal(validateNewPassword('abcd1234').ok, true));
```

- [ ] **Step 2: Run to verify it fails** — FAIL (`validateNewPassword` missing).

- [ ] **Step 3: Implement** — add to `authflow.mjs` (mirror prod rule: min 8, letters+digits):

```js
export function validateNewPassword(pw) {
  if (!pw || pw.length < 8) return { ok: false, error: 'At least 8 characters' };
  if (!/[a-zA-Z]/.test(pw) || !/[0-9]/.test(pw)) return { ok: false, error: 'Needs letters and numbers' };
  return { ok: true };
}
```

Add the forgot link + handler in `admin.js`:

```js
$('forgot').onclick = async (e) => {
  e.preventDefault();
  const email = $('email').value.trim();
  if (!email) { $('loginerr').textContent = 'Enter your email first.'; return; }
  const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + '/reset.html' });
  $('loginerr').textContent = error ? error.message : 'Check your email for a reset link.';
};
```

Create `web/admin/reset.html` (reuses `index.html` CSS via a small inline block or a link; imports `api.js`, validates with `validateNewPassword`, calls `sb.auth.updateUser({ password })`, then links back to `/`). Add `<a id="forgot" href="#">Forgot password?</a>` under the sign-in button in `index.html`. Confirm the reset redirect origin is in the Supabase `additional_redirect_urls` (founder-ops, §checklist).

- [ ] **Step 4: Run to verify it passes** — `node --test` → PASS. Manual: request reset on local (inbucket at :54324 captures the email), open link → set password → sign in.

- [ ] **Step 5: Commit**

```bash
git add web/admin/authflow.mjs web/admin/authflow.test.mjs web/admin/admin.js web/admin/index.html web/admin/reset.html
git commit -m "feat(cc-auth): forgot-password + reset page"
```

---

### Task 10: Client — recovery-code entry path

**Files:**
- Modify: `web/admin/admin.js` (wire `#use-recovery` → `admin-mfa-recover`)
- Modify: `web/admin/index.html` (recovery-entry markup)
- Modify: `web/admin/api.js` (export the functions base URL for the fetch)

**Interfaces:**
- Consumes: `admin-mfa-recover` edge function (Task 6), the caller's current `aal1` session token.
- Produces: from the challenge screen, "Use a recovery code" collects a code, POSTs it with the session JWT; on success prompts a fresh re-enroll (factor was removed).

- [ ] **Step 1: Write the failing test** — pure body-builder in `authflow.mjs`:

```ts
// authflow.test.mjs — append
import { recoverRequest } from './authflow.mjs';
test('builds authorized POST', () => {
  const r = recoverRequest('https://x.functions.supabase.co', 'tok', ' code1 ');
  assert.equal(r.url, 'https://x.functions.supabase.co/admin-mfa-recover');
  assert.equal(r.init.headers.Authorization, 'Bearer tok');
  assert.equal(JSON.parse(r.init.body).code, 'code1');
});
```

- [ ] **Step 2: Run to verify it fails** — FAIL (`recoverRequest` missing).

- [ ] **Step 3: Implement** — add to `authflow.mjs`:

```js
export function recoverRequest(fnBase, token, code) {
  return {
    url: `${fnBase}/admin-mfa-recover`,
    init: { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
            body: JSON.stringify({ code: (code || '').trim() }) },
  };
}
```

Add `export const FUNCTIONS_URL = 'https://ftwrvylzoyznhbzhgism.functions.supabase.co';` to `api.js`, and wire the handler in `admin.js`:

```js
$('use-recovery').onclick = (e) => { e.preventDefault(); show($('challenge'), false); show($('recovery-entry'), true); };
$('rec-submit').onclick = async () => {
  $('recerr').textContent = '';
  const { data } = await sb.auth.getSession();
  const { url, init } = recoverRequest(FUNCTIONS_URL, data.session.access_token, $('rec-code').value);
  const res = await fetch(url, init);
  if (!res.ok) { const b = await res.json().catch(()=>({})); $('recerr').textContent = b.error || 'Recovery failed'; return; }
  $('recerr').textContent = 'Recovered. Set up your authenticator again.';
  showEnroll();   // factor removed server-side; re-enroll fresh
};
```

Add `#recovery-entry` markup (code input + submit) to `index.html`. Add `FUNCTIONS_URL` origin to the CSP `connect-src` (it's the same Supabase project host family — verify `*.functions.supabase.co` vs the pinned `ftwrvylzoyznhbzhgism.supabase.co`; add the functions host explicitly).

- [ ] **Step 4: Run to verify it passes** — `node --test` → PASS. Manual: lose-authenticator path end-to-end on local.

- [ ] **Step 5: Commit**

```bash
git add web/admin/authflow.mjs web/admin/authflow.test.mjs web/admin/admin.js web/admin/index.html web/admin/api.js
git commit -m "feat(cc-auth): recovery-code entry path -> admin-mfa-recover + re-enroll"
```

---

### Task 11: Client — admin session hardening (idle + absolute timeout)

**Files:**
- Create: `web/admin/session.mjs` (pure timeout logic)
- Create: `web/admin/session.test.mjs`
- Modify: `web/admin/admin.js` (start the watcher after the shell mounts)

**Interfaces:**
- Produces: `shouldExpire({ lastActivity, loginAt, now, idleMs, absoluteMs }) -> 'idle' | 'absolute' | null`.
- Produces: a watcher that signs the admin out on idle (30 min) or absolute cap (12 h), reused by `admin.js`.

- [ ] **Step 1: Write the failing test**

```ts
// session.test.mjs — run: node --test web/admin/session.test.mjs
import test from 'node:test'; import assert from 'node:assert';
import { shouldExpire } from './session.mjs';
const IDLE = 30*60*1000, ABS = 12*60*60*1000;
test('idle trips', () => assert.equal(shouldExpire({ lastActivity: 0, loginAt: 0, now: IDLE+1, idleMs: IDLE, absoluteMs: ABS }), 'idle'));
test('absolute trips', () => assert.equal(shouldExpire({ lastActivity: ABS, loginAt: 0, now: ABS+1, idleMs: IDLE, absoluteMs: ABS }), 'absolute'));
test('active session ok', () => assert.equal(shouldExpire({ lastActivity: 1000, loginAt: 0, now: 2000, idleMs: IDLE, absoluteMs: ABS }), null));
```

- [ ] **Step 2: Run to verify it fails** — `node --test web/admin/session.test.mjs` → FAIL.

- [ ] **Step 3: Implement** — `web/admin/session.mjs`:

```js
export function shouldExpire({ lastActivity, loginAt, now, idleMs, absoluteMs }) {
  if (now - loginAt >= absoluteMs) return 'absolute';
  if (now - lastActivity >= idleMs) return 'idle';
  return null;
}
export function startSessionWatch({ onExpire, idleMs = 30*60*1000, absoluteMs = 12*60*60*1000 }) {
  const loginAt = Date.now(); let last = Date.now();
  const bump = () => { last = Date.now(); };
  ['click','keydown','mousemove','scroll','touchstart'].forEach(e => window.addEventListener(e, bump, { passive: true }));
  const id = setInterval(() => {
    const why = shouldExpire({ lastActivity: last, loginAt, now: Date.now(), idleMs, absoluteMs });
    if (why) { clearInterval(id); onExpire(why); }
  }, 30*1000);
  return () => clearInterval(id);
}
```

Wire into `admin.js` after `mountShell(...)` in `gate()`:

```js
import { startSessionWatch } from './session.mjs';
// … inside gate(), after mountShell(SECTIONS, boot):
startSessionWatch({ onExpire: async () => { await sb.auth.signOut(); location.reload(); } });
```

- [ ] **Step 4: Run to verify it passes** — `node --test web/admin/session.test.mjs` → PASS. Manual: set `idleMs` low temporarily, confirm auto sign-out.

- [ ] **Step 5: Commit**

```bash
git add web/admin/session.mjs web/admin/session.test.mjs web/admin/admin.js
git commit -m "feat(cc-auth): admin session idle + absolute timeout"
```

---

### Task 12: Apply, verify end-to-end, and hand off ops

**Files:**
- Create: `docs/audit/cc-auth-core-evidence.md`
- Modify: `web/admin/DEPLOY.md` (append the MFA/auth section)

**Interfaces:** none (integration + ops).

- [ ] **Step 1: Full local verification**

Run, in order:
```bash
supabase db reset
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -v ON_ERROR_STOP=1 -f supabase/tests/admin_auth_test.sql   # all green
npm run test:rls                                                                                                          # existing suite still green
node --test web/admin/authflow.test.mjs web/admin/session.test.mjs supabase/functions/admin-mfa-recover/index.test.ts     # client + fn logic green
```
Then a Playwright headless smoke of the served `web/admin` login (enroll → challenge → shell), capturing screenshots into `docs/audit/`.

- [ ] **Step 2: Write the evidence doc** — `docs/audit/cc-auth-core-evidence.md`: paste the SQL scoreboard, the `node --test` output, and the smoke screenshots; state the spine invariant is enforced (aal1 admin denied on a real RPC).

- [ ] **Step 3: Founder-ops handoff** — append to `web/admin/DEPLOY.md`:
  - Apply `0129` **directly** (`supabase db query --linked -f supabase/migrations/0129_admin_auth_gate.sql`), not `db push`.
  - Deploy `admin-mfa-recover` (`supabase functions deploy admin-mfa-recover`).
  - **Management API PATCH** confirming `mfa_totp_enroll=true`, `mfa_totp_verify=true`, and `site_url`/`additional_redirect_urls` include the Command Center origin + `/reset.html`. **Never `supabase config push`.**
  - First sign-in: enroll your authenticator, **save the 10 recovery codes**.

- [ ] **Step 4: Verify prod is unbroken** — after apply, sign in to the hosted Command Center: enroll works, challenge works, an `aal1`-only direct RPC call is denied, shell renders at `aal2`.

- [ ] **Step 5: Commit**

```bash
git add docs/audit/cc-auth-core-evidence.md web/admin/DEPLOY.md
git commit -m "docs(cc-auth): auth-core evidence + MFA deploy/ops runbook"
```

---

## Self-Review

**Spec coverage (§ of `2026-07-22-command-center-admin-auth-design.md`):**
- §1/§3.1 MFA/AAL2 spine → Tasks 1–4 (guard, bootstrap v2, mutation + read RPC sweeps). ✅
- §2 MFA recovery codes → Task 5 (generate/verify) + Task 6 (break-glass fn) + Tasks 8/10 (reveal + use). ✅
- §4 auth flow (password→enroll/challenge, forgot-password, session limits) → Tasks 7, 8, 9, 11. ✅
- §6 server-authoritative posture → enforced in Tasks 1–4; verified Task 12. ✅
- **Deferred to Plan 2 (monitoring):** MFA-code lockout hook, sign-in event log, detection, email+push alerts, ban-based lockout, Security panel, Turnstile. The recovery fn (Task 6) audits but does NOT yet alert — Plan 2 adds the alert call. Stated, not a gap.

**Placeholder scan:** No TBD/TODO. Guard-swap Tasks 3/4 specify a *uniform mechanical transformation* + the exact function list + representative tests (not "similar to" hand-waving) — appropriate because the change is identical per function; the executor applies it and the test asserts the outcome.

**Type consistency:** `assert_admin_mfa()` (void, raises), `admin_bootstrap()` keys (`mfa_enrolled`/`aal`/`access_granted`), `admin_generate_recovery_codes() -> text[]`, `admin_verify_recovery_code(uuid,text) -> boolean`, `nextScreen(...)`/`formatRecoveryCodes`/`validateNewPassword`/`recoverRequest` (authflow.mjs), `shouldExpire`/`startSessionWatch` (session.mjs) — names used consistently across tasks. ✅

**Open dependency flagged for the executor:** Task 6 adds `is_platform_admin_self()` in `0129` — ensure it lands in the migration (and its trivial test) so the edge function can authorize the caller.
