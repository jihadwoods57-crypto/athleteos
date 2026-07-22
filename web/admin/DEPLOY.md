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

## Phase 2 — MFA enforcement + monitoring (LIVE as of 2026-07-22)

Migrations `0130`/`0131`, all 3 edge functions, the cron monitor, and the re-hosted client are **already
applied to production** (`ftwrvylzoyznhbzhgism`) — see `docs/audit/cc-auth-evidence.md` for the exact
verification evidence. The Command Center is live at
`https://onstandard-admin.gelatinous-twin.workers.dev`. What's below is what's actually left, plus the
reference runbook for repeating any of these on a different environment.

### What's left (only you can do these)

1. **Sign in and enroll.** Go to `https://onstandard-admin.gelatinous-twin.workers.dev`, sign in with your
   password — you'll land on **Enroll two-factor**. Scan the QR with your authenticator app, enter the
   6-digit code, then **save the 10 recovery codes shown** (they're shown exactly once).
2. **(Optional) Turn on email alerts.** No `RESEND_API_KEY` is set yet, so `admin-alert` currently sends
   push only (once you have a push `device_token`) and skips email. Get a key from resend.com, then:
   `supabase secrets set RESEND_API_KEY=re_xxx`.
3. **(Optional) Instant MFA-code lockout.** The Management API rejected enabling
   `hook_mfa_verification_attempt` with `402 — cannot be configured for this organization` (a Supabase
   plan/tier limit, not a bug). The MFA *requirement* is fully enforced regardless; only the instant,
   GoTrue-side lockout on repeated bad codes is unavailable — the monitor's ban-on-burst fallback covers
   it with ~1 minute of lag instead of instantly. If you upgrade the org tier, re-run step 4 below.

### Reference runbook (for a different project/environment)

**Never `supabase config push`** (it regressed prod on 2026-07-22 — diffs the *entire* local `[auth]`
block onto prod). All PATCHes below are single-field and safe.

**0. Confirm target project's MFA TOTP is ON** first (skip if already known-good):
```sh
curl -s https://api.supabase.com/v1/projects/<ref>/config/auth \
  -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" | grep -o '"mfa_totp_[a-z]*_enabled":[a-z]*'
```
**1. Apply migrations directly** (not `db push`): `supabase db query --linked -f supabase/migrations/0130_admin_auth_gate.sql` then `...0131_admin_auth_monitor.sql`.
**2. Deploy functions:** `supabase functions deploy admin-mfa-recover|admin-alert|admin-auth-monitor`.
**3. Set secrets:** `supabase secrets set ALERT_KEY=$(openssl rand -hex 24) MONITOR_KEY=$(openssl rand -hex 24) RESEND_API_KEY=re_xxx ADMIN_ALERT_EMAIL=you@onstandard.app` (optional `IPINFO_TOKEN`).
**4. Enable the MFA-code hook** (may 402 depending on plan tier):
```sh
curl -s -X PATCH https://api.supabase.com/v1/projects/<ref>/config/auth \
  -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" -H "content-type: application/json" \
  -d '{"hook_mfa_verification_attempt_enabled":true,
       "hook_mfa_verification_attempt_uri":"pg-functions://postgres/public/hook_mfa_verification_attempt"}'
```
**5. Schedule the monitor:**
```sql
select cron.schedule('admin-auth-monitor', '* * * * *', $$
  select net.http_post(url:='https://<ref>.functions.supabase.co/admin-auth-monitor',
    headers:=jsonb_build_object('x-monitor-key','<MONITOR_KEY>'))
$$);
```
**6. Re-host the client** (`cd web/admin && npx wrangler deploy`, `CLOUDFLARE_API_TOKEN` from `.env`).
**7. Add the deployed origin to Supabase's `uri_allow_list`** (PATCH, preserving existing entries) —
"Forgot password" silently fails otherwise: `https://<your-worker>.workers.dev` +
`https://<your-worker>.workers.dev/reset.html`.
**8. Verify:** Security panel shows sign-ins; wrong-code lockout message; forgot-password + a recovery
code both round-trip; `net._http_response` shows real `200`s from the cron.

### Recovery if you ever lose your authenticator
Sign in with your password → on the code screen tap **"Use a recovery code"** → enter one → MFA resets so
you can enroll a fresh app (you'll be alerted). If codes are exhausted, break-glass via service role:
`delete from auth.mfa_factors where user_id = '<your-uuid>';` then re-enroll + regenerate codes.
