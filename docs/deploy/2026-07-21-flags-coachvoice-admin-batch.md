# Deploy Runbook — Feature Flags + Coach Voice v2 + Admin Command Center + Multi-Domain Exec

**Date:** 2026-07-21, updated 2026-07-22 after the live deploy
**Branch:** `compliance-fixes` (all commits present)
**What's shipping:** 4 slices, all behind flags / parity-safe. Nothing changes for any user until you deploy AND (for slice 4) push an OTA update AND flip a flag on.

Migrations `0109` (feature flags + admin_audit_log), `0110` (coach voice version + `coach_voice_v2` flag), `0111` (admin command-center RPCs), `0112` (days.checked_tasks). Functions `flags` (new), `analyze-meal` (modified), `coach-voice-nudge` (modified). Web pages `web/admin/` (command center + flags panel). Proto changes (slice 4: multi-domain completion) live in `proto/redesign-2026-07/js/` — client-visible only after an OTA update (see §9).

> Note: there is **no migration `0108`** — the number was reserved for the admin center then superseded (the admin RPCs are `0111` so they can read the `0109` audit log). The gap is intentional; `supabase db push` applies `0109`–`0112` regardless.

> **STATUS (2026-07-22): steps 1–3 below are DONE on prod** (project `ftwrvylzoyznhbzhgism` / AthleteOS). Migrations 0104–0112 applied and verified; `flags`/`analyze-meal`/`coach-voice-nudge` deployed and smoke-tested; `web/admin/admin.js` + `flags.js` configured with the prod URL + publishable anon key. **Still open:** no `platform_admins` row exists yet on prod — nobody can sign into the command center or flags panel until one is added (§4a). The client-facing OTA push for slice 4 (§9) has NOT been run — it needs an explicit go/no-go since it changes behavior for every installed user on next launch.

> **Correction to the original plan:** slice 4 (multi-domain completion) does **NOT** need a new App Store build/submission. `runtimeVersion` is pinned to `policy: "appVersion"` and the proto ships as a zip asset specifically designed for `eas update` (see `scripts/build-proto-zip.mjs`'s own comment). An OTA update is enough — see §9.

---

## 0. Pre-flight (once)

```bash
cd /c/Users/Administrator/Downloads/athleteos
git status                 # clean tree on compliance-fixes; the 5+5+... commits present
git log --oneline -14      # confirm the flags/coach-voice/admin commits are here
supabase projects list     # confirm the CLI is logged in
supabase link --project-ref <YOUR_PROD_REF>   # if not already linked
```

You do **not** need any new secrets. Every function uses `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`, which Supabase auto-injects. `analyze-meal` already has `ANTHROPIC_API_KEY`. The RN app already has `EXPO_PUBLIC_SUPABASE_URL` (the `flags` client derives its endpoint from it — no new env var).

---

## 1. Apply the migrations (in order)

```bash
supabase db push
# if push complains about out-of-order history vs remote:
#   supabase db push --include-all
```

**Verify** (against live):
```bash
supabase db query --linked "select name, default_on, kill_switch from feature_flags order by name;"
#   expect 6 rows: assistant_gate, coach_voice_v2, engines, meal_plans, streak_grace, trust_pass
supabase db query --linked "select proname from pg_proc where proname like 'admin_%' order by 1;"
#   expect admin_ai_cost, admin_ai_cost_by_fn, admin_ai_verify, admin_recent_audit,
#          admin_revenue, admin_system_health (+ the pre-existing admin_overview etc.)
supabase db query --linked "select column_name from information_schema.columns
                            where table_name='coach_voice_config' and column_name='version';"
#   expect one row: version
```

---

## 2. Deploy the edge functions

```bash
supabase functions deploy flags
supabase functions deploy analyze-meal
supabase functions deploy coach-voice-nudge
```

`analyze-meal` and `coach-voice-nudge` now import `_shared/feature-flags.ts`, `_shared/coach-voice.ts`, and `_shared/coach-voice-load.ts` — the CLI bundles those automatically (same as today's `_shared/ai-telemetry.ts`).

**Verify** the `flags` function answers (anon call returns the caller's map — all defaults for an anon caller):
```bash
curl -s "$SUPABASE_URL/functions/v1/flags" -H "apikey: $SUPABASE_ANON_KEY" \
     -H "Authorization: Bearer $SUPABASE_ANON_KEY"
#   expect: {"flags":{"engines":false,"meal_plans":false,...,"coach_voice_v2":false},"fetched_at":"..."}
```

---

## 3. Configure + serve the web/admin pages

Fill the two constants (top of each file) with your **project URL** and **anon/publishable key** — never the service-role key:
- `web/admin/admin.js` → `SUPABASE_URL`, `SUPABASE_ANON_KEY`
- `web/admin/flags.js` → `SUPABASE_URL`, `SUPABASE_ANON_KEY`

Serve the folder (laptop, founder-only — it's not part of the public site):
```bash
npx serve web/admin      # or: python -m http.server 8080 --directory web/admin
# open http://localhost:3000  (serve)  /  http://localhost:8080  (python)
```

> Keep these keys out of the public `web/landing` deploy. This is an internal tool.

---

## 4. Confirm you're a platform admin

The dashboard + flags panel + all admin RPCs gate on `is_platform_admin()`. **On the AthleteOS prod project (`ftwrvylzoyznhbzhgism`), `platform_admins` is currently EMPTY** — no account has been granted yet, and no account matching the founder's usual email exists in `auth.users` on this project either. This is a founder decision (which real account should hold admin), not something to guess or auto-create.

```bash
supabase db query --linked "select pa.user_id, u.email from platform_admins pa join auth.users u on u.id = pa.user_id;"
# once you've signed up / signed in through the app with the account you want as admin:
supabase db query --linked "select id, email from auth.users where email = '<your-email>';"
supabase db query --linked "insert into platform_admins(user_id) values ('<that-uuid>') on conflict do nothing;"
```

Now sign in at `/index.html` (command center) and `/flags.html` (flags panel) with that account. A non-admin — or a signed-out visitor — gets nothing.

---

## 5. (Optional) App build — NOT required for this batch

The RN client (flag fetch at launch, `useFlag`) needs a new app build to be live **in the app**. But you don't need it yet:
- **Coach Voice v2 is enforced server-side** in `analyze-meal` — it reads the flag itself. No app build needed to pilot it.
- No client UX is gated by a runtime flag yet (the 5 legacy env flags migration was deferred).

Ship an app build only when you start gating client screens with `useFlag`. Until then the client seam is inert and harmless.

---

## 6. Turn on the Coach Voice pilot

1. In `/flags.html`, open **`coach_voice_v2`**. To pilot to specific athletes, put their auth UUIDs in **users** (comma-separated) and Save. (For a full rollout instead, tick **default on**.)
   - Note: `analyze-meal` evaluates this flag by **user id** — use the *users* allowlist or *default on*. (Org/role targeting for this specific flag is a later enhancement.)
2. Make sure the pilot athletes' **team has a Coach Voice config with `enabled=true`** (set by a coach in-app, or directly):
   ```bash
   supabase db query --linked "select team_id, enabled, version, config from coach_voice_config;"
   ```
3. Have a pilot athlete analyze a meal. The `note`/`analysis` should now read in the coach's configured tone. Check it landed:
   ```bash
   supabase db query --linked "select fn, mode, outcome, created_at from ai_calls
                               order by created_at desc limit 5;"
   #   a 'voice_banned_fallback' outcome would mean the banned-word guard re-ran without voice (rare/expected-safe).
   ```

---

## 9. Shipping slice 4 (multi-domain completion) — an OTA update, not an App Store build

The `proto/redesign-2026-07/js/` changes (coach lift/custom items surfacing + one-tap complete) live in `assets/proto.zip`, extracted by the app at runtime. Because `runtimeVersion` is pinned to `policy: "appVersion"` (unchanged), this ships as an **OTA update** — no new binary, no App Store review, minutes not days, and reversible by publishing another update.

**This is the one step in this whole batch that changes behavior for every installed user on their next app open** (once athletes are on a coach standard with lift/custom items, they'll now see + can complete them — tracked, not scored, so nothing about their score changes). Confirm before running:

```bash
node scripts/build-proto-zip.mjs   # rebuild assets/proto.zip from the current proto/ source
eas update --branch production --message "multi-domain completion surfaces (tracked, not scored)"
```

**Rollback:** `eas update --branch production --message "revert" ` republishing the prior commit's build, or `eas channel:rollback` — an OTA push is not one-way.

**Verify:** open the app as a coach-linked athlete on a standard with a `lift`/`custom` item; the item should now appear on Home/Plan and be completable ("Mark Done · coach sees it"); the Living Number must be unchanged before/after completing it.

## 7. Smoke checklist

- [ ] `/index.html` command center loads; briefing line + 7 panels render (mostly zeros today — expected).
- [ ] "Recent founder actions" shows your `coach_voice_v2` edit (proves the audit log works end-to-end).
- [ ] `/flags.html` lists 6 flags; toggling one persists on refresh.
- [ ] A pilot athlete's meal reads in the coach's voice; a non-pilot athlete's meal is unchanged.
- [ ] Existing (flag-off) meal analysis is byte-identical to before for everyone else.

## 8. Rollback (fast + safe)

- **Coach Voice:** in `/flags.html`, tick **kill-switch** on `coach_voice_v2` → OFF for everyone **immediately** (server re-checks per call). No redeploy.
- **A function:** `supabase functions deploy <name>` from the previous commit, or `git revert` the commit and redeploy. `analyze-meal` flag-off path is the exact prior behavior, so a kill-switch is almost always enough.
- **Migrations:** additive only (new tables/columns/RPCs, `coach_voice_config.version` default 1). Nothing to roll back for correctness; leave them applied.

---

## What each slice's "done" looks like after this

| Slice | Live when | Turned on by |
|---|---|---|
| Feature-flag infra | migrations + `flags` fn deployed | it IS the substrate; admin panel edits it |
| Coach Voice v2 | `analyze-meal` deployed | flip `coach_voice_v2` for a team + set that team's voice config |
| Admin Command Center | `0111` applied + `web/admin` served | sign in as platform admin |
