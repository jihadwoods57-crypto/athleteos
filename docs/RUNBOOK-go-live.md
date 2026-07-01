# OnStandard — GO-LIVE EXECUTION RUNBOOK

**For:** the founder, hands on the keyboard. **Updated:** 2026-06-29.

This is the single, ordered, copy-paste runbook for turning the backend on **safely**. It
consolidates and supersedes the older, narrower `docs/GO-LIVE-NOW.md`. The "why" behind any
item lives in `docs/LAUNCH-CHECKLIST.md` (Phase 1) and `docs/SECURITY-AUDIT-2026-06-29.md`.

> **Two iron rules.**
> 1. **STAGING FIRST.** You never touch the live project until the exact same sequence has
>    run clean on a throwaway project (Section A). "Compiled fine" is not "live RLS behaves."
> 2. **`EXPO_PUBLIC_BACKEND_LIVE` is the master switch and the instant kill-switch.** With it
>    unset/`false`, the app is pure local mock data even if the URL/key are present. You flip it
>    `true` only at the very end, and flip it back to roll the whole backend off in one move.

**Migration apply order (memorize this):**
`0004 → 0005 → 0006 → 0007 → 0008 → 0009 → 0010 → 0011 → 0012 → 0013 → 0014`

- `0014` (revoke_viewer, security G1) is **additive + safe** (a new SECURITY DEFINER RPC, no behavior
  change to existing functions) and was **validated on a throwaway Postgres** (`supabase/tests/
  revoke_viewer_test.sql`). It goes after `0013`. It must be applied before any real minor's data syncs
  (it's what makes "remove viewer" actually revoke access — A7 smoke-test step 5).

- `0011` is **purely additive** (creates `org_memberships` + `can_view_via_memberships`; changes
  no behavior).
- `0012` is the **behavioral cutover**: it backfills `org_memberships` from the team link tables
  and **swaps `can_view()`'s body** to the membership predicate. It carries an in-file
  equivalence-check note — **re-run that check on real-shaped data before trusting it (Section A6).**
- `0013` is the **security hardening** (lock down service-role-only writes, symmetric minor-messaging
  gate, keep trainer/guardian access after the `0012` cutover, scope the org-list read). It must go
  **last**.

> **Note on your live project:** a Supabase project already exists for the AI function
> (`ftwrvylzoyznhbzhgism`), and migrations `0001→0008` were applied + verified there previously
> (see the old `GO-LIVE-NOW.md`). **Do NOT assume that means you can skip staging.** `0009→0013`
> have never touched it, and `0012` rewrites how access is checked. Treat the live apply
> (Section B) as starting from whatever `supabase migration list` actually reports, and run the
> full sequence on a *fresh* staging project first regardless.

---

## A. STAGING FIRST (non-negotiable)

Goal: prove the entire migration sequence + RLS behavior on a throwaway project with
real-shaped data, **before** a single real user.

### A1. Tools
```bash
# Supabase CLI (one-time)
npm install -g supabase        # or: brew install supabase/tap/supabase
supabase --version             # confirm it runs
supabase login                 # opens a browser; authorize the CLI
```

### A2. Create a throwaway staging project (dashboard)
1. Go to <https://supabase.com/dashboard> → **New project**.
2. Name it `onstandard-staging`. Pick the same region you'll use in prod. Generate a strong DB
   password and save it in your password manager (you may need it for `db push`).
3. Wait for it to finish provisioning (~2 min).
4. **Settings → General → Reference ID** — copy the project ref (looks like `abcd...wxyz`).
   This is your `<STAGING_REF>`.
5. **Settings → API** — copy the **Project URL** and the **anon public** key. These are your
   staging `EXPO_PUBLIC_SUPABASE_URL` / `EXPO_PUBLIC_SUPABASE_ANON_KEY`.

### A3. Link the CLI to staging
```bash
cd /path/to/onstandard          # repo root (folder with package.json + supabase/)
supabase link --project-ref <STAGING_REF>
# enter the DB password from A2 if prompted
supabase migration list        # baseline: shows local migrations not yet applied remotely
```

### A4. Apply migrations 0004 → 0013, in order
The repo's migration files are numbered, so `db push` applies them in order. The earlier
`0001→0003` (schema/RLS/storage) are prerequisites; on a brand-new staging project push
everything from scratch:
```bash
supabase db push               # applies ALL pending migrations in filename order (0001..0013)
```
Confirm the full set landed:
```bash
supabase migration list        # every migration 0001..0013 should now show as applied remotely
```
If you prefer to watch the cutover land one at a time (recommended the first time you do this),
apply incrementally instead of a single push — push, inspect, repeat — and pause specifically
**before `0012`** to run the equivalence check in A6 against seeded data.

### A5. Configure staging auth + AI so the smoke test can run
- **Dashboard → Authentication → Providers → Email:** turn **Confirm email = ON** (matches the
  committed `supabase/config.toml` `enable_confirmations = true`). For staging you can use
  Supabase's built-in email (low rate limit) or wire your chosen SMTP (Section C).
- **Edge Function key (for the meal-log step):**
  ```bash
  supabase secrets set ANTHROPIC_API_KEY=sk-ant-...      # staging key
  supabase functions deploy analyze-meal
  ```

### A6. RE-RUN the `0012` `can_view` equivalence check on representative data
This is the step `0012`'s header calls out. The point: prove that after the cutover,
`can_view(athlete)` returns **exactly** what the legacy `is_team_coach_of` disjunction returned —
no coach silently gains or loses an athlete.

1. **Seed representative data** on staging (SQL editor or `psql`): a couple of orgs/teams, a
   handful of athletes per team via `team_members`, head + assistant coaches via `team_staff`,
   and at least one **trainer** (`practice_clients`) and one **guardian** (`guardianships`) link
   so you also exercise the `0013` union that preserves their access. Use a copy of real-shaped
   rows if you have any; otherwise mirror your actual roster shapes.
2. **Run the equivalence assertion** (SQL editor). For every athlete, the new membership-based
   `can_view` must equal the legacy team-coach check, for each viewer:
   ```sql
   -- For a given coach (set the role to that coach's uid for the test), compare new vs legacy.
   -- Expect ZERO rows: any row is an athlete where the cutover changed visibility.
   select a.athlete_id, can_view(a.athlete_id) as new_can_view,
          is_team_coach_of(a.athlete_id)       as legacy_team_coach
   from   team_members a
   where  can_view(a.athlete_id) is distinct from is_team_coach_of(a.athlete_id);
   ```
   (Run this impersonating each test coach — set the JWT/`auth.uid()` context the same way the
   crew's throwaway-Postgres harness did, or call it as the seeded coach via a signed-in session.)
3. **Expected:** 0 differing rows for the team-coach cases. Trainer/guardian access is preserved
   by `0013`'s union, not by the backfill — verify those separately in the smoke test (A7).

If the query returns any rows, **STOP**. The cutover is not behavior-preserving on your data;
do not proceed to the live apply.

### A7. End-to-end smoke test on staging
Point a local build at staging and turn the backend on **for staging only**:
```bash
# In the repo root, create a TEMPORARY .env (gitignored) pointing at STAGING:
cat > .env <<'EOF'
EXPO_PUBLIC_SUPABASE_URL=https://<STAGING_REF>.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=<staging anon key>
EXPO_PUBLIC_BACKEND_LIVE=true
EOF
npx expo start -c            # -c clears the cache so the new EXPO_PUBLIC_* vars are picked up
```
Now walk the real loop (use real accounts, not mock data):
1. **Sign up** a new athlete (adult age). Confirm the email-confirmation step fires and the
   account becomes usable only after confirming.
2. **Log a meal** (photo → analyze → score → log). Confirm the row lands in the `meals`/`days`
   tables (Dashboard → Table editor), not local mock data.
3. **Coach sees the linked athlete.** Create a team/coach, join the athlete to it, sign in as the
   coach, confirm the coach can read that athlete's day/meal data (the `can_view` path).
4. **Minor stays gated.** Sign up a minor (age 13–17). Confirm their data does **not** sync and no
   coach can see it while `guardianStatus` is `pending`. Then mark their
   `guardian_consent_requests` row `verified` **via a service-role call** (simulating the verify
   endpoint) and confirm the minor unblocks and syncs. A minor must never be able to self-verify.
5. **Remove-viewer revokes access.** As the athlete, remove a coach/guardian viewer. Confirm the
   coach can **no longer** read that athlete. (If `removeViewer` still only edits a local list —
   security **G1** — this is your proof that the `revoke_viewer` RPC must be wired before the live
   apply; see Section B note.)

When all five pass on staging, delete the temporary `.env`, and **pause** any staging deploy of
the AI function you don't want billed. You're cleared for the live apply.

---

## B. LIVE APPLY (the real project)

Do this only after Section A is green and Phase 0 (legal + vendors, `docs/LAUNCH-CHECKLIST.md`)
is in motion. Apply **one migration at a time** and inspect between each.

### B1. Link the CLI to the LIVE project
```bash
cd /path/to/onstandard
supabase link --project-ref ftwrvylzoyznhbzhgism      # the live project (or your prod ref)
supabase migration list                                # see what's ALREADY applied live
```
The live project already has `0001→0008` applied. Apply the rest in order.

### B2. Apply the additive + remaining migrations, in order
Run the pending migrations and verify the count climbs by exactly one each time. Either push all
pending at once **after** you've proven staging, or (safer the first time) apply incrementally and
inspect:
```bash
# Apply everything still pending, in filename order:
supabase db push
supabase migration list        # confirm 0009, 0010, 0011 now show applied
```
`0011` is additive and safe — it changes no behavior.

### B3. `0012` — the cutover (CAUTION)
> **CAUTION:** `0012` backfills `org_memberships` and **swaps `can_view()`'s body** to the
> membership predicate. This is the one migration that changes who can see what.
> **Do NOT apply it live until the A6 equivalence check returned 0 differing rows on
> representative data.** It is teams-only by design — trainers/families are preserved by `0013`,
> not by this backfill.

When A6 is green:
```bash
supabase db push               # applies 0012 (and 0013 if you push together — see B4)
supabase migration list        # confirm 0012 applied
```
Spot-check on live immediately after: pick one real coach and one of their athletes and confirm
`can_view` still returns true; pick an unrelated athlete and confirm it returns false.

### B4. `0013` — security hardening (LAST)
`0013` must go on top of `0012`. It revokes direct writes on `subscriptions`/`org_memberships`,
makes the minor-messaging gate symmetric, **restores trainer/guardian view access after the
cutover**, and scopes the org-list read.
```bash
supabase db push               # applies 0013
supabase migration list        # confirm 0013 applied — apply order now ends at 0013
```

> **Before any real minor's data syncs (security G1):** wire `removeViewer` to a real
> `revoke_viewer` RPC that flips the link row's `status <> 'active'` (which `can_view` already
> excludes). Today `removeViewer` only edits a local list, so a "removed" coach/guardian would keep
> `can_view` access once the backend is live. This is a safety affordance, not cosmetic — confirm
> it in the A7 step 5 smoke test.

---

## C. SUPABASE DASHBOARD TOGGLES (live project)

### C1. Email confirmation ON
1. Dashboard → **Authentication → Providers → Email**.
2. Set **Confirm email = ON.** (The committed `supabase/config.toml` already sets
   `enable_confirmations = true`; the hosted project needs the same toggle flipped once.)
3. Leave **Allow new users to sign up = ON.**

### C2. SMTP (real email sender)
Supabase's built-in email is rate-limited and **not** for production. Configure your own SMTP so
sign-up confirmation emails **and** the guardian-approval link actually deliver.

> **Email sender = still an open Phase 0 decision.** Picking the email service is an unchecked
> item in `docs/LAUNCH-CHECKLIST.md` Phase 0 and `docs/FOUNDER-DECISIONS.md` (no vendor ratified
> yet, and there is no `docs/specs/2026-06-29-phase0-decisions.md`). `supabase/config.toml`'s
> commented `[auth.email.smtp]` stub uses SendGrid (`smtp.sendgrid.net`, user `apikey`) purely as
> the example shape. **Decide the vendor first** (SendGrid / Postmark / Resend / SES), then:

1. Dashboard → **Project Settings → Authentication → SMTP Settings** → enable **Custom SMTP**.
2. Fill: **Host** (e.g. `smtp.sendgrid.net`), **Port** `587`, **Username** (e.g. `apikey`),
   **Password** (the provider API key), **Sender email** + **Sender name** (a real, monitored
   from-address on a domain you control).
3. Verify your sending domain with the provider (SPF/DKIM) so confirmation emails don't spam-box.
4. Send yourself a test confirmation (sign up a throwaway account) and confirm it arrives.

### C3. OAuth providers — LATER (not this slice)
Leave all `[auth.external.*]` providers **off** for go-live. **Sign in with Apple** is required by
Apple *because* you offer email login, but it's a Phase 2 / App Store slice
(`docs/LAUNCH-CHECKLIST.md` Phase 2): it needs the Apple Developer setup + native module on a real
device. Do not block backend go-live on it.

---

## D. APP CONFIG + REBUILD (the master switch)

### D1. Set the three EXPO_PUBLIC vars
In the repo root, create `.env` (gitignored — never commit it) pointing at the **live** project:
```
EXPO_PUBLIC_SUPABASE_URL=https://ftwrvylzoyznhbzhgism.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=<live anon public key, from Settings -> API>
EXPO_PUBLIC_BACKEND_LIVE=true
```
- The **anon** key is the public client key — safe to ship in the bundle (every table is RLS-gated).
- **Never** put the `service_role` key or the DB password in the app or any `EXPO_PUBLIC_*` var.

### D2. Rebuild (this is a build, not a server switch)
`EXPO_PUBLIC_*` vars are baked at build time, so flipping `BACKEND_LIVE` requires a rebuild:
```bash
npx expo start -c          # dev: clears cache so the new env is read
# or for a distributable build:
# eas build --platform ios   (TestFlight / App Store path — see LAUNCH-CHECKLIST Phase 2)
```

> **`EXPO_PUBLIC_BACKEND_LIVE` is the instant kill-switch.** With it `true`, auth + data sync +
> messaging are on. Set it back to `false` (or unset) and rebuild to revert the entire app to
> local mock data in one move — no migration rollback needed for an app-side incident.

---

## E. WIRE THE ENDPOINTS

### E1. Deploy `analyze-meal` (with go-live hardening — security G4)
The function holds `ANTHROPIC_API_KEY` server-side; the app never sees it. Today it ships open
CORS (`*`) and **no rate limiting** — fine for staging, **not** for real users on a paid endpoint.
1. Harden before deploy: restrict the `CORS['Access-Control-Allow-Origin']` to your app origin
   instead of `*`, and add per-user rate limiting (key off the bearer/anon-authenticated user;
   reject over a sane per-minute cap) so the paid Anthropic endpoint can't be hammered or run up a
   bill. The oversized-photo guard (413 over ~8MB) is already in the function.
2. Set the secret and deploy against the **live** project:
   ```bash
   supabase secrets set ANTHROPIC_API_KEY=sk-ant-...        # live key
   # optional: supabase secrets set ANTHROPIC_MODEL=claude-sonnet-5   # (this is the default)
   supabase functions deploy analyze-meal
   ```
3. The app derives the endpoint from `EXPO_PUBLIC_SUPABASE_URL` (`.../functions/v1/analyze-meal`),
   so no app change is needed once D1 is set. (Turning the data backend on does **not** by itself
   require AI; you can deploy this separately.)

### E2. Deploy the guardian-consent verify endpoint (the parent-approval link)
This is the small service-role endpoint the parent's email link hits to flip a
`guardian_consent_requests` row to `verified`. **It does not exist yet** — only `analyze-meal` is
in `supabase/functions/`. Add it under `supabase/functions/` (e.g. `guardian-verify/`).

Contract (matches migration `0008`):
- The minor's `request_guardian_consent(guardian_email)` RPC has already inserted/updated a row
  with an opaque `token` (`encode(gen_random_bytes(16),'hex')`, rotated on every resend) and
  `status = 'pending'`.
- The verify endpoint receives that `token` from the emailed link, **re-validates the guardian's
  identity** via your chosen parent-verification (VPC) vendor (the Phase 0 vendor — an
  identity/payment check, not a bare checkbox), and **only then** sets the row
  `status = 'verified'`, `verified_at = now()`.
- It must run with the **service_role** key (server-side secret, never in the app). `verified` is
  settable **only** by service_role — a minor can read their own request but can never write
  `verified` (enforced by the `0008` RLS policy). The client only ever hydrates `verified`
  read-only (security G2, already wired).

Deploy:
```bash
supabase functions deploy guardian-verify
# set any vendor secret it needs, e.g.:
# supabase secrets set VPC_VENDOR_API_KEY=...
```
Until this endpoint + the VPC vendor exist, **every minor stays local-only**, which is the safe
fail-closed default — do not work around it.

### E3. Overseer-alert pipeline → a push mechanism (design choice — cheapest path)
Per-event alert preferences (athlete below the line, missed logging, check-in submitted, weekly
digest) are already **stored + editable per overseer** and gated by the master notifications
toggle. What's missing is the **delivery seam**: nothing actually pushes them yet.

**The seam:** a server-side trigger needs to (a) detect the event, (b) read the overseer's stored
preference, and (c) deliver. Options, cheapest first:

- **Cheapest / start here — Expo push + a DB-triggered Edge Function.** Have the app register for
  Expo push and store each user's Expo push token (a column on `profiles`, write-gated to self).
  On the events that already write to the DB (a new low-scoring `day`, a submitted `checkin`), use
  a Postgres trigger / `pg_net` call (or a lightweight Edge Function invoked by the same write
  path) to look up linked overseers, check their stored preference, and POST to Expo's push API
  (`https://exp.host/--/api/v2/push/send`). No third-party push vendor, no extra cost beyond
  Supabase. This covers the real-time alerts.
- **For the weekly digest — a scheduled function.** Use a Supabase **scheduled** Edge Function
  (cron) once a week that aggregates per athlete and sends the digest via the same Expo push (or
  via your SMTP sender as an email digest, reusing Section C2). Scheduling avoids any always-on
  worker.
- **Later / if you outgrow Expo push** — a dedicated provider (e.g. OneSignal/FCM directly). Not
  needed for beta; the Expo-push + scheduled-function path is the cheapest route that ships.

Recommended for go-live: real-time alerts via the DB-triggered Edge Function + Expo push, and the
weekly digest via a scheduled function. Defer anything fancier until beta gives you signal.

---

## F. GO / NO-GO CHECKLIST + ROLLBACK

### F1. Pre-flight (all must be TRUE before you flip `BACKEND_LIVE=true` for real users)
- [ ] **Staging passed.** The full `0004→0013` sequence applied clean on a throwaway project, and
      all five A7 smoke checks passed (sign up, log meal, coach sees athlete, minor gated until
      verified, remove-viewer revokes).
- [ ] **A6 equivalence check returned 0 differing rows** on representative data (the `0012`
      cutover is behavior-preserving on your roster shapes).
- [ ] **Live migrations applied in order, ending at `0013`.** `supabase migration list` shows
      `0001…0013` all applied on the live project.
- [ ] **`removeViewer` wired to a real `revoke_viewer` RPC (G1)** — a removed viewer actually loses
      `can_view`. Verified on staging.
- [ ] **Email confirmation ON** in the live dashboard, and **custom SMTP configured + a test email
      delivered** (Section C).
- [ ] **Guardian-verify endpoint deployed (E2)** and the VPC vendor wired — OR you accept that
      every minor stays local-only until it is (the safe default).
- [ ] **`analyze-meal` hardened (CORS scoped + rate-limited) and deployed (E1)** with the live
      `ANTHROPIC_API_KEY` secret set; the key is **only** server-side.
- [ ] **No secrets in the app.** `.env` holds only the URL, the **anon** key, and `BACKEND_LIVE`.
      No `service_role` key, no DB password anywhere client-side. `.env` is gitignored and uncommitted.
- [ ] **Legal hosted.** Privacy Policy + Terms live at public URLs the app links to; Anthropic DPA
      signed and disclosed as a subprocessor (Phase 0).
- [ ] **`npm run verify` green** on the build you're shipping.

If every box is checked → **GO**: set `EXPO_PUBLIC_BACKEND_LIVE=true` (D1), rebuild (D2), ship.

### F2. Instant rollback
- **App-side incident (anything misbehaving in the live app):** set
  `EXPO_PUBLIC_BACKEND_LIVE=false` (or unset it) and rebuild/redeploy. The whole backend — auth,
  data sync, messaging — goes dark and the app reverts to local mock data immediately. This is the
  first lever for any go-live problem; it needs **no** database change.
- **AI-only incident (Anthropic bill/abuse):** unset the AI endpoint or remove the
  `ANTHROPIC_API_KEY` secret (`supabase secrets unset ANTHROPIC_API_KEY`) — AI degrades to the
  on-device deterministic analysis while the rest of the backend stays up.
- **Migration-level problem:** because `0013` redefines functions/policies forward-only, a clean
  DB-level rollback is **restore-from-backup**, not a down-migration. So: confirm the live project's
  **PITR / backup cadence is enabled before you apply** (Section A is your real safety net — it
  exists precisely so you never need this), and keep the kill-switch as the day-one mitigation
  while you decide whether to restore.

---

## Where to read more
- Full human to-do list + Phase 0 gates: `docs/LAUNCH-CHECKLIST.md`
- The security findings behind `0013` and the G1/G2/G4 go-live items: `docs/SECURITY-AUDIT-2026-06-29.md`
- The migration intent (esp. the `0011`/`0012` cutover): the headers of
  `supabase/migrations/0011_org_memberships.sql` and `0012_can_view_cutover.sql`
- Plain-English orientation: `START-HERE.md`
