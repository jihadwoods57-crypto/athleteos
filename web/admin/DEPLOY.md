# Command Center — deploy & bootstrap runbook

The Command Center (`web/admin/`) is a **static, zero-build** surface (vanilla ESM, no framework). It holds only the Supabase **publishable/anon key** + your login JWT — never a service-role key. All data crosses through `is_platform_admin()`-gated SECURITY DEFINER RPCs.

---

## 0. 🚨 First, seed yourself as a platform admin (BLOCKS EVERYTHING)

`platform_admins` is empty in prod. Until your UUID is in it, **every** RPC returns "not authorized" and the shell shows "access denied" — even for you. This is a one-time, service-role-only step (it can never be self-granted from the client).

In the Supabase SQL editor (or a service-role script) for the prod project:

```sql
-- find your id
select id, email from profiles where email = 'you@onstandard.app';
-- seed it (idempotent)
insert into platform_admins (user_id) values ('<your-uuid>') on conflict do nothing;
```

Verify: `select * from platform_admins;` should list your row. Then sign in at the Command Center — the shell should render.

---

## 1. Apply the Phase 1A migrations

Apply `0115`–`0118` to prod (in order). These add only gated read RPCs — no user-facing behavior changes.

```sh
supabase db push          # applies pending migrations to the linked project
# or apply a single file directly if the migration history is diverged:
# supabase db query --linked -f supabase/migrations/0115_cc_bootstrap.sql
```

## 2. Host the static files

Same approach as `web/landing/DEPLOY.md` — no build step. Cloudflare Pages / Netlify Drop / any static host serving `web/admin/`.

**Required response headers** (a CSP `<meta>` covers most of it, but these two can only be set as headers):

```
X-Frame-Options: DENY
Cache-Control: no-store
```

On Cloudflare Pages add a `web/admin/_headers` file:

```
/*
  X-Frame-Options: DENY
  Cache-Control: no-store
  Referrer-Policy: no-referrer
```

## 3. Runtime CDN dependencies

The page loads two things from CDNs at runtime:
- **Google Fonts** (Fira Sans / Fira Code) — `fonts.googleapis.com` + `fonts.gstatic.com`
- **`@supabase/supabase-js@2`** (pinned) — `esm.sh`

The CSP in `index.html` allowlists exactly these origins. A strict/offline host will break fonts + the Supabase client — if that's a concern, **vendor** the font CSS + `supabase-js` bundle into `web/admin/` and update the CSP to `'self'`.

`SUPABASE_URL` / publishable key / `PROJECT_REF` are hardcoded in `api.js` (and `flags.js`) — keep both in sync when pointing at a new project. The publishable key is safe to ship; never place a service-role key here.

## 4. Daily brief cron (optional but recommended)

So trends stay complete on days you don't visit:
```sql
select schedule_admin_brief('https://<project>.functions.supabase.co/admin-brief', '<BRIEF_CRON_KEY>');
```
Set the `BRIEF_CRON_KEY` secret on the `admin-brief` function first (`supabase secrets set BRIEF_CRON_KEY=…` + `supabase functions deploy admin-brief`).

---

## Environments
The env badge (top bar) reads `admin_bootstrap().environment`. It currently returns `production`; staging/dev projects will override it via typed config in Phase 1B. Point the surface at a different project by editing `api.js` and re-hosting.

---

## Phase 2 — MFA enforcement + monitoring (go-live runbook)

Migrations `0130` (the MFA gate) + `0131` (the monitor), 3 edge functions, and the client MFA flow.
Verified on the local stack (`docs/audit/cc-auth-evidence.md`). Do the steps **in this order** — step 0
prevents a lock-out. **Never `supabase config push`** (it regressed prod on 2026-07-22).

**0. Confirm prod MFA TOTP is ON** (a `config push` earlier today may have toggled it off). Bearer = the
CLI token in Windows Credential Manager `Supabase CLI:supabase`:
```sh
curl -s https://api.supabase.com/v1/projects/ftwrvylzoyznhbzhgism/config/auth \
  -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" | grep -o '"mfa_totp_[a-z]*_enabled":[a-z]*'
# both must be true; if not, PATCH them true (step 4 shows the PATCH shape) BEFORE step 1.
```

**1. Apply the migrations** (direct, not `db push` — shared-tree divergence):
```sh
supabase db query --linked -f supabase/migrations/0130_admin_auth_gate.sql
supabase db query --linked -f supabase/migrations/0131_admin_auth_monitor.sql
```
After `0130`, your next Command Center sign-in routes you to **enroll** (bootstrap stays `aal1`-callable) —
you are not locked out as long as step 0 is green.

**2. Deploy the functions:**
```sh
supabase functions deploy admin-mfa-recover
supabase functions deploy admin-alert
supabase functions deploy admin-auth-monitor
```

**3. Set secrets:**
```sh
supabase secrets set ALERT_KEY=$(openssl rand -hex 24) MONITOR_KEY=$(openssl rand -hex 24) \
  RESEND_API_KEY=re_xxx ADMIN_ALERT_EMAIL=you@onstandard.app
# optional: IPINFO_TOKEN=xxx (enables country/ASN + impossible-travel; degrades gracefully without it)
```

**4. Enable the MFA-code lockout hook** (Management API PATCH — enables the `0131` hook function):
```sh
curl -s -X PATCH https://api.supabase.com/v1/projects/ftwrvylzoyznhbzhgism/config/auth \
  -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" -H "content-type: application/json" \
  -d '{"hook_mfa_verification_attempt_enabled":true,
       "hook_mfa_verification_attempt_uri":"pg-functions://postgres/public/hook_mfa_verification_attempt"}'
```

**5. Schedule the monitor** (~1 min; needs `pg_cron` + `pg_net`, already used by `schedule_admin_brief`):
```sql
select cron.schedule('admin-auth-monitor', '* * * * *', $$
  select net.http_post(
    url    := 'https://ftwrvylzoyznhbzhgism.functions.supabase.co/admin-auth-monitor',
    headers:= jsonb_build_object('x-monitor-key','<the MONITOR_KEY from step 3>'))
$$);
```

**6. Host the client** — re-host `web/admin/` (now includes `reset.html`, `authflow.mjs`, `session.mjs`,
`sections/security.js`). The `_headers` + CSP are unchanged (no new origins).

**7. First sign-in:** enter your password → **enroll** your authenticator (scan the QR) → **save the 10
recovery codes** (shown once) → you land on the shell. Confirm a push `device_token` exists for your
account so alerts reach your phone.

**8. Verify:** open **Security** in the rail (recent sign-ins appear within a minute); sign out and back in
requiring the 6-digit code; a wrong code 5× shows the lockout message. Forgot-password + a recovery code
both round-trip.

### Recovery if you ever lose your authenticator
Sign in with your password → on the code screen tap **"Use a recovery code"** → enter one → MFA resets so
you can enroll a fresh app (you'll be alerted). If codes are exhausted, break-glass via service role:
`delete from auth.mfa_factors where user_id = '<your-uuid>';` then re-enroll + regenerate codes.
