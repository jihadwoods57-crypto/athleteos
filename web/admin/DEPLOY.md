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
