# Phase 6 → your phone: the deploy runbook

**Goal:** get the merged Phase 6 app (honest athlete surface + coach/trainer/parent role wiring)
onto your phone via TestFlight, with the backend it needs.

**Status going in:**
- ✅ Code is **merged to `master`** (PR #17, merge commit `c04e07b`). Build from `master`.
- ✅ The migration sequence `0001 → 0047` was **dry-run verified** end-to-end on a throwaway
  Postgres — all 46 files apply clean in order, and the P4 objects/RPCs (`trust_passes`,
  `meal_comments`, `meal_plans`, `plan_assignments`, `team_roster()`, `practice_roster()`,
  `grant_trust_pass()`, `handle_new_user()`) all exist after apply.
- ⬜ Everything below runs **on your Mac with your credentials** — it can't be done from a cloud
  agent (Apple signing key, EAS login, Supabase access all live with you).

Two ground rules from `RUNBOOK-go-live.md` still apply: **staging first**, and
`EXPO_PUBLIC_BACKEND_LIVE` is the master kill-switch.

---

## Step 1 — Apply the new backend migrations (`0029 → 0047`)

The merge added 19 migrations your live DB doesn't have yet. The role features (coach roster,
Trust Pass, meal-review comments, signup role) **fail silently** without them.

### 1a. ⚠️ Enable two managed extensions FIRST (or `0044` fails)
`0044_weekly_digest_cron.sql` requires `pg_cron` and `pg_net`. These are off by default.
**Supabase dashboard → Database → Extensions → enable `pg_cron` and `pg_net`.**
(This was the one hard dependency the dry-run surfaced — `db push` errors on `0044` without it.)

### 1b. Push — staging project first, then live
```bash
git checkout master && git pull origin master
supabase login
supabase link --project-ref <STAGING_REF>     # a throwaway project first
supabase migration list                        # see what's already applied
supabase db push                               # applies 0029..0047 that aren't live yet
# …smoke-test staging, then repeat link + push against the LIVE project (ftwrvylzoyznhbzhgism):
supabase link --project-ref ftwrvylzoyznhbzhgism
supabase migration list
supabase db push
```

## Step 2 — Build + submit the iOS app

Full detail (env vars, store listing, Apple privacy answers) is in **`APP-STORE-SETUP.md`**.
The short version:

```bash
npm install -g eas-cli && eas login
# one-time: point the production build at your backend (see APP-STORE-SETUP.md step 1)
eas env:create --environment production --name EXPO_PUBLIC_SUPABASE_URL \
  --value https://ftwrvylzoyznhbzhgism.supabase.co
eas env:create --environment production --name EXPO_PUBLIC_SUPABASE_ANON_KEY --value <anon key>

# build + submit (this is what `npm run ship` wraps)
eas build  --platform ios --profile production      # ~15-20 min in Expo's cloud
eas submit --platform ios --profile production --latest
```

`EXPO_PUBLIC_BACKEND_LIVE=true` is already baked into `eas.json`'s production profile.

## Step 3 — Onto your phone
Build lands in **App Store Connect → TestFlight**. Install it on your own device first, confirm
signup / meal photo / score / coach view against the live backend, then invite your first gym.

---

### Rollback
- App misbehaving against the backend: flip `EXPO_PUBLIC_BACKEND_LIVE=false` (kill-switch — app
  reverts to local mock data) and rebuild, or roll back the TestFlight build.
- Bad merge: `git revert -m 1 c04e07b` on `master` reverts the whole Phase 6 merge as one commit.
