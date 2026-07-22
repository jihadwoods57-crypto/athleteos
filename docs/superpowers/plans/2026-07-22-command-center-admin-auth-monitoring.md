# Command Center — Admin Auth Monitoring (the Watch) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Detect and react to attacks on the Command Center — MFA-code lockout, a trustworthy sign-in event log, suspicious-activity detection, email+push alerts, ban-based account lockout, and a Security panel — building on Plan 1's MFA gate.

**Architecture:** A Supabase MFA-verification auth hook throttles bad-code attempts (admin-scoped, fail-open). A cron edge function pulls Supabase's own auth event log (`auth.audit_log_entries`) into an app-visible `admin_login_events` table, runs a pure anomaly detector, alerts on suspicious events (email via Resend + push via `device_tokens`), and applies a temporary GoTrue ban on a failed-attempt burst. A Command Center Security panel surfaces the log.

**Tech Stack:** Supabase Postgres (hook + detector, SECURITY DEFINER), Supabase Edge Functions (Deno), Resend email, existing `send-push`/`device_tokens`, `pg_cron`, vanilla ESM (`web/admin`). Tests: SQL authz suite, `node --test`.

## Global Constraints

- Same as Plan 1 (server-authoritative; publishable key only; direct migration apply; **never `config push`**; Management-API PATCH for prod auth/hook config; dark-premium UI).
- **Builds on Plan 1** (`assert_admin_mfa`, `admin_bootstrap` v2, `admin_recovery_codes`). Do Plan 1 first.
- **Migration number:** Plan 1 takes `0130`; this plan uses **`0131`** — verify the highest number immediately before creating the file (concurrent committer landed `0129` already).
- **Fail-safe:** the MFA hook must **fail-open** (any error → `{decision:'continue'}`) — a hook bug must never lock the sole admin out. The monitor is the backstop.
- **Auto-ban is burst-only** — a single new-geo *successful* login alerts but NEVER auto-bans (don't lock the founder out on a legit trip).

---

### Task 1: MFA-verification hook + throttle table (admin-scoped lockout)

**Files:**
- Create: `supabase/migrations/0131_admin_auth_monitor.sql`
- Create/append: `supabase/tests/admin_monitor_test.sql`

**Interfaces:**
- Produces: table `public.admin_auth_throttle(user_id uuid pk, fail_count int, lock_level int, window_start timestamptz, locked_until timestamptz)`.
- Produces: `public.hook_mfa_verification_attempt(event jsonb) returns jsonb` — Supabase MFA-verification hook. `valid=true` → reset + `{decision:continue}`; `valid=false` → increment (10-min window); at ≥5 fails → escalating lock (`lock_level` 1→1m, 2→5m, ≥3→30m) + `{decision:reject, message}`; while locked → reject. **Fail-open** on any error. Executable by `supabase_auth_admin` only.

- [ ] **Step 1: failing test** — `supabase/tests/admin_monitor_test.sql` (self-contained harness like `admin_auth_test.sql`; seed one admin `v_admin`). Drive the hook directly:

```sql
-- 5 invalid attempts -> the 5th returns reject; a valid attempt resets.
do $$
declare v_admin uuid := current_setting('mon.admin')::uuid; r jsonb; i int;
begin
  delete from admin_auth_throttle where user_id = v_admin;
  for i in 1..4 loop
    r := hook_mfa_verification_attempt(jsonb_build_object('user_id',v_admin,'valid',false,'factor_type','totp'));
  end loop;
  perform _ok((r->>'decision')='continue','throttle: 4 fails still continue');
  r := hook_mfa_verification_attempt(jsonb_build_object('user_id',v_admin,'valid',false,'factor_type','totp'));
  perform _ok((r->>'decision')='reject','throttle: 5th fail rejects');
  r := hook_mfa_verification_attempt(jsonb_build_object('user_id',v_admin,'valid',false,'factor_type','totp'));
  perform _ok((r->>'decision')='reject','throttle: stays locked');
  -- simulate lock expiry + a valid attempt resets
  update admin_auth_throttle set locked_until = now() - interval '1s' where user_id = v_admin;
  r := hook_mfa_verification_attempt(jsonb_build_object('user_id',v_admin,'valid',true,'factor_type','totp'));
  perform _ok((r->>'decision')='continue' and (select fail_count from admin_auth_throttle where user_id=v_admin)=0,'throttle: valid resets');
end $$;
```

- [ ] **Step 2: run → FAIL** (`docker exec ... -f supabase/tests/admin_monitor_test.sql`).

- [ ] **Step 3: implement** — in `0131`:

```sql
create table if not exists public.admin_auth_throttle (
  user_id uuid primary key references auth.users(id) on delete cascade,
  fail_count int not null default 0,
  lock_level int not null default 0,
  window_start timestamptz not null default now(),
  locked_until timestamptz
);
alter table public.admin_auth_throttle enable row level security;
revoke all on table public.admin_auth_throttle from anon, authenticated;

create or replace function public.hook_mfa_verification_attempt(event jsonb) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare v_user uuid; v_valid boolean; v_row admin_auth_throttle; v_mins int;
begin
  v_user := (event->>'user_id')::uuid;
  v_valid := coalesce((event->>'valid')::boolean, false);
  if v_user is null then return jsonb_build_object('decision','continue'); end if;

  select * into v_row from admin_auth_throttle where user_id = v_user for update;
  if not found then
    insert into admin_auth_throttle(user_id) values (v_user) returning * into v_row;
  end if;

  if v_row.locked_until is not null and v_row.locked_until > now() then
    return jsonb_build_object('decision','reject','message','Too many attempts. Try again later.');
  end if;

  if v_valid then
    update admin_auth_throttle set fail_count=0, lock_level=0, window_start=now(), locked_until=null where user_id=v_user;
    return jsonb_build_object('decision','continue');
  end if;

  -- invalid: roll the 10-min window
  if v_row.window_start < now() - interval '10 minutes' then
    update admin_auth_throttle set fail_count=1, window_start=now() where user_id=v_user;
    return jsonb_build_object('decision','continue');
  end if;

  update admin_auth_throttle set fail_count = fail_count + 1 where user_id=v_user returning * into v_row;
  if v_row.fail_count >= 5 then
    v_mins := case when v_row.lock_level = 0 then 1 when v_row.lock_level = 1 then 5 else 30 end;
    update admin_auth_throttle
      set locked_until = now() + make_interval(mins => v_mins), lock_level = lock_level + 1, fail_count = 0
      where user_id = v_user;
    return jsonb_build_object('decision','reject','message','Too many attempts. Locked for '||v_mins||' min.');
  end if;
  return jsonb_build_object('decision','continue');
exception when others then
  return jsonb_build_object('decision','continue');  -- FAIL-OPEN: never brick the admin
end $$;
-- Supabase auth calls the hook as supabase_auth_admin.
grant execute on function public.hook_mfa_verification_attempt(jsonb) to supabase_auth_admin;
revoke execute on function public.hook_mfa_verification_attempt(jsonb) from anon, authenticated, public;
grant all on table public.admin_auth_throttle to supabase_auth_admin;
```

- [ ] **Step 4: run → PASS.**
- [ ] **Step 5: commit** — `feat(cc-auth): MFA-verification hook + admin throttle (fail-open lockout)`.

---

### Task 2: Sign-in event log + pure anomaly detector

**Files:**
- Modify: `supabase/migrations/0131_admin_auth_monitor.sql`
- Modify: `supabase/tests/admin_monitor_test.sql`

**Interfaces:**
- Produces: table `public.admin_login_events(id bigint identity pk, user_id uuid, event_type text, ip inet, country text, asn text, user_agent text, occurred_at timestamptz, flags jsonb default '[]', alerted boolean default false, ext_id text unique)`.
- Produces: `public.admin_detect_login_anomalies(p_user uuid, p_ip inet, p_country text, p_asn text, p_occurred_at timestamptz, p_tz text) returns text[]` — pure over the user's prior `admin_login_events`: `new_ip`, `new_country`, `new_asn`, `off_hours` (00:00–06:00 local), `impossible_travel` (different country < 1h from last). Testable by seeding history.
- Produces: `public.admin_monitor_checkpoint(id boolean pk default true, last_seen_at timestamptz)` (singleton).
- Produces: `public.admin_recent_logins(p_limit int)` + `public.admin_active_locks()` — `assert_admin_mfa()`-gated reads for the Security panel.
- Produces: `public.admin_pull_auth_events(p_since timestamptz)` — SECURITY DEFINER read over `auth.audit_log_entries` for admin users (service-role only), returning normalized rows for the monitor.

- [ ] **Step 1: failing test** — detector over seeded history:

```sql
do $$
declare v_admin uuid := current_setting('mon.admin')::uuid; f text[];
begin
  delete from admin_login_events where user_id = v_admin;
  insert into admin_login_events(user_id,event_type,ip,country,asn,occurred_at)
    values (v_admin,'login','1.1.1.1','US','AS1', now() - interval '2 days');
  -- same ip/country -> no novelty flags, daytime
  f := admin_detect_login_anomalies(v_admin,'1.1.1.1','US','AS1', (current_date + time '14:00'), 'America/New_York');
  perform _ok(not ('new_ip' = any(f)) and not ('new_country' = any(f)),'detect: known ip/country -> no novelty');
  -- new country shortly after US -> new_country + impossible_travel
  f := admin_detect_login_anomalies(v_admin,'9.9.9.9','RU','AS9', now(), 'America/New_York');
  perform _ok('new_country' = any(f),'detect: flags new_country');
  perform _ok('new_ip' = any(f),'detect: flags new_ip');
  -- off-hours (03:00 local)
  f := admin_detect_login_anomalies(v_admin,'1.1.1.1','US','AS1', (current_date + time '03:00') at time zone 'America/New_York', 'America/New_York');
  perform _ok('off_hours' = any(f),'detect: flags off_hours');
end $$;
```

- [ ] **Step 2: run → FAIL.**
- [ ] **Step 3: implement** — tables + functions in `0131`:

```sql
create table if not exists public.admin_login_events (
  id bigint generated always as identity primary key,
  user_id uuid references auth.users(id) on delete set null,
  event_type text not null,
  ip inet, country text, asn text, user_agent text,
  occurred_at timestamptz not null,
  flags jsonb not null default '[]'::jsonb,
  alerted boolean not null default false,
  ext_id text unique
);
create index if not exists admin_login_events_user on public.admin_login_events (user_id, occurred_at desc);
alter table public.admin_login_events enable row level security;
revoke all on table public.admin_login_events from anon, authenticated;

create table if not exists public.admin_monitor_checkpoint (
  id boolean primary key default true, last_seen_at timestamptz not null default now(),
  constraint admin_monitor_singleton check (id)
);
insert into public.admin_monitor_checkpoint(id) values (true) on conflict do nothing;
alter table public.admin_monitor_checkpoint enable row level security;
revoke all on table public.admin_monitor_checkpoint from anon, authenticated;

create or replace function public.admin_detect_login_anomalies(
  p_user uuid, p_ip inet, p_country text, p_asn text, p_occurred_at timestamptz, p_tz text)
returns text[] language plpgsql stable security definer set search_path = public as $$
declare f text[] := '{}'; v_last record; v_hour int;
begin
  if not exists (select 1 from admin_login_events where user_id=p_user and ip=p_ip) then f := array_append(f,'new_ip'); end if;
  if p_country is not null and not exists (select 1 from admin_login_events where user_id=p_user and country=p_country) then f := array_append(f,'new_country'); end if;
  if p_asn is not null and not exists (select 1 from admin_login_events where user_id=p_user and asn=p_asn) then f := array_append(f,'new_asn'); end if;
  begin v_hour := extract(hour from (p_occurred_at at time zone coalesce(p_tz,'UTC')))::int;
        if v_hour >= 0 and v_hour < 6 then f := array_append(f,'off_hours'); end if;
  exception when others then null; end;
  select country, occurred_at into v_last from admin_login_events where user_id=p_user order by occurred_at desc limit 1;
  if v_last.country is not null and p_country is not null and v_last.country <> p_country
     and p_occurred_at - v_last.occurred_at < interval '1 hour' then f := array_append(f,'impossible_travel'); end if;
  return f;
end $$;
revoke execute on function public.admin_detect_login_anomalies(uuid,inet,text,text,timestamptz,text) from anon, authenticated;

create or replace function public.admin_recent_logins(p_limit int default 50)
returns setof public.admin_login_events language plpgsql stable security definer set search_path = public as $$
begin perform assert_admin_mfa();
  return query select * from public.admin_login_events order by occurred_at desc limit greatest(least(p_limit,200),1);
end $$;
grant execute on function public.admin_recent_logins(int) to authenticated;

create or replace function public.admin_active_locks()
returns table(user_id uuid, locked_until timestamptz, lock_level int)
language plpgsql stable security definer set search_path = public as $$
begin perform assert_admin_mfa();
  return query select t.user_id, t.locked_until, t.lock_level from public.admin_auth_throttle t where t.locked_until > now();
end $$;
grant execute on function public.admin_active_locks() to authenticated;

-- service-role read over the real auth event log for admin accounts
create or replace function public.admin_pull_auth_events(p_since timestamptz)
returns table(ext_id text, user_id uuid, event_type text, ip inet, occurred_at timestamptz, user_agent text)
language plpgsql stable security definer set search_path = public, auth as $$
begin
  return query
    select a.id::text, a.payload->>'actor_id' is not null and false, null::uuid, null, a.created_at, null  -- placeholder, replaced below
    where false;
end $$;
revoke execute on function public.admin_pull_auth_events(timestamptz) from anon, authenticated;
```

> **Implementer note (admin_pull_auth_events):** `auth.audit_log_entries(id uuid, payload jsonb, created_at, ip_address text)`. Real body: select entries since `p_since` whose `payload->>'actor_id'` (uuid) is in `platform_admins`, mapping `payload->>'action'` (`login`, `login_failed`, `token_refreshed`, `mfa_challenge_verified`, …) to `event_type`, `ip_address` → `ip`, `payload->'traits'->>'user_agent'` → `user_agent`. Verify exact payload keys against the local `auth.audit_log_entries` after a real login (`docker exec … psql -c "select payload from auth.audit_log_entries order by created_at desc limit 3"`), then finalize. Kept as a stub here so the plan doesn't hard-code unverified column names — **this is the one field-verification step to do live during build.**

- [ ] **Step 4: run → PASS** (detector checks; `admin_pull_auth_events` finalized after the live field check).
- [ ] **Step 5: commit** — `feat(cc-auth): admin login-event log + pure anomaly detector + gated reads`.

---

### Task 3: `admin-alert` edge function (email + push, deduped)

**Files:**
- Create: `supabase/functions/admin-alert/index.ts`, `supabase/functions/admin-alert/logic.mjs`, `supabase/functions/admin-alert/logic.test.mjs`
- Modify: `supabase/config.toml` (`[functions.admin-alert] verify_jwt = false`)

**Interfaces:**
- Consumes: `RESEND_API_KEY`, `send-push`/`device_tokens`, `ALERT_KEY` shared secret, `ADMIN_ALERT_EMAIL`.
- Produces: `POST { kind, subject, body }` + header `x-alert-key` → sends email (Resend) + push to admin device tokens; deduped by (kind) within 10 min via `admin_audit_log`.
- Produces (pure): `buildResendPayload({from,to,subject,body})`, `shouldSend(recentKinds, kind)`.

- [ ] **Step 1: failing test**

```ts
import test from 'node:test'; import assert from 'node:assert';
import { buildResendPayload, shouldSend } from './logic.mjs';
test('resend payload', () => { const p = buildResendPayload({from:'a@x',to:'b@x',subject:'S',body:'B'});
  assert.equal(p.from,'a@x'); assert.equal(p.subject,'S'); assert.ok(p.text.includes('B')); });
test('dedupe suppresses repeat', () => { assert.equal(shouldSend(['new_country'],'new_country'), false);
  assert.equal(shouldSend([],'new_country'), true); });
```

- [ ] **Step 2: run → FAIL.**
- [ ] **Step 3: implement** `logic.mjs`:

```js
export function buildResendPayload({ from, to, subject, body }) {
  return { from, to: [to], subject, text: body };
}
export function shouldSend(recentKinds, kind) { return !recentKinds.includes(kind); }
```

`index.ts`: validate `x-alert-key`; check `admin_audit_log` for a `alert.<kind>` in the last 10 min → if present, skip; else send Resend email + fan push to `device_tokens` of `platform_admins` (reuse `send-push` by invoking it, or POST FCM), then insert `alert.<kind>` audit row. Return `{ sent }`.

- [ ] **Step 4: run → PASS** (pure logic). Integration: manual invoke with a test payload once `RESEND_API_KEY` is set.
- [ ] **Step 5: commit** — `feat(cc-auth): admin-alert edge function (email+push, deduped)`.

---

### Task 4: `admin-auth-monitor` cron edge function

**Files:**
- Create: `supabase/functions/admin-auth-monitor/index.ts`, `.../logic.mjs`, `.../logic.test.mjs`
- Modify: `supabase/config.toml` (`[functions.admin-auth-monitor] verify_jwt = false`)

**Interfaces:**
- Consumes: `admin_pull_auth_events`, `admin_detect_login_anomalies`, `admin_login_events` insert, GoTrue Admin API (`updateUserById` ban), `admin-alert`, `MONITOR_KEY`, optional `IPINFO_TOKEN`.
- Produces (pure): `classifyBurst(failures, windowMins)` → boolean (≥10 fails/15 min); `geoFromIp(resp)` → `{country,asn}`.

- [ ] **Step 1: failing test**

```ts
import test from 'node:test'; import assert from 'node:assert';
import { classifyBurst, geoFromIp } from './logic.mjs';
test('burst threshold', () => { assert.equal(classifyBurst(10,15), true); assert.equal(classifyBurst(9,15), false); });
test('geo parse', () => { assert.deepEqual(geoFromIp({country:'US', org:'AS1 X'}), {country:'US', asn:'AS1'}); });
```

- [ ] **Step 2: run → FAIL.** **Step 3: implement** `logic.mjs`:

```js
export function classifyBurst(failures, windowMins, threshold = 10, window = 15) { return failures >= threshold && windowMins <= window; }
export function geoFromIp(resp) { return { country: resp?.country ?? null, asn: (resp?.org ?? '').split(' ')[0] || null }; }
```

`index.ts`: validate `x-monitor-key`; read checkpoint; `admin_pull_auth_events(since)`; per event → geo-enrich (ipinfo if token, else null) → insert `admin_login_events` (on-conflict ext_id do nothing) → `admin_detect_login_anomalies` → if flags: update the row's `flags`, insert `admin_audit_log`, call `admin-alert`; count recent `login_failed` per admin → if `classifyBurst` → `svc.auth.admin.updateUserById(id,{ban_duration:'30m'})` + alert. Advance checkpoint to max(occurred_at).

- [ ] **Step 4: run → PASS** (pure). Integration verified in Task 6 end-to-end.
- [ ] **Step 5: commit** — `feat(cc-auth): admin-auth-monitor cron (detect + ban + alert)`.

---

### Task 5: Wire the recovery alert into `admin-mfa-recover`

**Files:** Modify `supabase/functions/admin-mfa-recover/index.ts` (from Plan 1).

- [ ] **Step 1–3:** after the `recovery.used` audit insert, `fetch` `admin-alert` with `{ kind:'recovery_used', subject:'Command Center recovery code used', body:'A recovery code was used to reset MFA on your admin account.' }` + `x-alert-key`. (No new test; covered by manual E2E.)
- [ ] **Step 4:** manual — run recovery, confirm an alert fires.
- [ ] **Step 5:** commit — `feat(cc-auth): alert on MFA recovery use`.

---

### Task 6: Security panel in the Command Center

**Files:**
- Create: `web/admin/sections/security.js`
- Modify: `web/admin/admin.js` (register in `SECTIONS`), `web/admin/shell.js` if the rail is built from a static group list.

**Interfaces:**
- Consumes: `rpc('admin_recent_logins', {p_limit})`, `rpc('admin_active_locks')`.
- Produces: a section module `{ id:'security', title:'Security', rail:'Platform', render(view){…} }` matching the other `sections/*.js` shape (verify against `sections/audit.js`).

- [ ] **Step 1:** read `web/admin/sections/audit.js` to copy the exact section-module contract.
- [ ] **Step 2–3:** implement `security.js`: a table of recent sign-ins (time, email/uid, IP, country, flags as chips using existing `.badge`/`.chip` styles) + an "Active locks" card. Register `security` in `admin.js`'s `SECTIONS` array.
- [ ] **Step 4:** Playwright headless smoke — sign in (aal2), open Security, confirm the table renders from seeded `admin_login_events`.
- [ ] **Step 5:** commit — `feat(cc-auth): Security panel (recent sign-ins + active locks)`.

---

### Task 7 (optional): Turnstile bot-blunting on the login

**Files:** Create `supabase/functions/admin-login-precheck/index.ts`; modify `web/admin/index.html` (Turnstile widget), `web/admin/admin.js` (require token before sign-in), CSP (`script-src`/`connect-src` add `challenges.cloudflare.com`).

- [ ] Gate the sign-in button on a Turnstile token; verify server-side in `admin-login-precheck` (`TURNSTILE_SECRET`). **Smart-decision default: SKIP unless the founder wants it** — it adds a provider + CSP surface for defense-in-depth that MFA + ban already largely cover. Documented, not built by default.

---

### Task 8: Apply, verify, cron, ops handoff

**Files:** Create `docs/audit/cc-auth-monitor-evidence.md`; modify `web/admin/DEPLOY.md`.

- [ ] **Step 1:** `docker exec … -f supabase/tests/admin_monitor_test.sql` (green) + `node --test` across the three function `logic.test.mjs` (green).
- [ ] **Step 2:** live field-check `auth.audit_log_entries` payload; finalize `admin_pull_auth_events`; re-run.
- [ ] **Step 3:** E2E on local: fail an MFA code 5× → hook rejects; seed a failed-login burst → monitor bans + alerts (mock/real).
- [ ] **Step 4:** ops append to `DEPLOY.md`: apply `0131` direct; deploy `admin-alert`, `admin-auth-monitor`; **Management-API PATCH to enable the `mfa_verification_attempt` hook** (`uri = pg-functions://postgres/public/hook_mfa_verification_attempt`); set secrets (`RESEND_API_KEY`, `ADMIN_ALERT_EMAIL`, `ALERT_KEY`, `MONITOR_KEY`, optional `IPINFO_TOKEN`); schedule the monitor (`select cron.schedule('admin-auth-monitor','* * * * *', $$ select net.http_post(url:='…/admin-auth-monitor', headers:=jsonb_build_object('x-monitor-key','…')) $$)`); ensure a founder push `device_token` exists. **Never `config push`.**
- [ ] **Step 5:** commit — `docs(cc-auth): monitoring evidence + ops runbook`.

---

## Self-Review

**Spec coverage:** §3.2 throttle/hook → T1; login events + detection → T2; §3.3 `admin-alert` → T3, `admin-auth-monitor` → T4, recovery alert → T5; §5 Security panel → T6; Turnstile (optional §3.3) → T7; §9 ops (cron, secrets, hook enable) → T8. ✅
**Placeholder scan:** one deliberate, flagged live-verification (`admin_pull_auth_events` payload keys, T2) — the only responsible way to handle unverified `auth` schema internals; everything else is concrete. ✅
**Type consistency:** `hook_mfa_verification_attempt(jsonb)->jsonb`, `admin_detect_login_anomalies(uuid,inet,text,text,timestamptz,text)->text[]`, `admin_recent_logins(int)`, `admin_active_locks()`, `admin_pull_auth_events(timestamptz)`, pure helpers (`classifyBurst`,`geoFromIp`,`buildResendPayload`,`shouldSend`) — consistent. ✅
