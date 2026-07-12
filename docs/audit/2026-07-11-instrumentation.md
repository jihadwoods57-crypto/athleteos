# Instrumentation — how to turn it on (2026-07-11)

The beta now has two complementary analytics layers. One is **already live and needs one insert
from you**; the other is **authored and inert** until you deploy it.

## Layer 1 — retroactive loop analytics (LIVE + DONE, migration 0037)

> **STATUS 2026-07-11: DONE.** The founder (`jihadwoods57@gmail.com`, id
> `36f2b2b9-7083-4fbd-8e91-a3e05681b07b`) is seeded into `platform_admins` on live, and both RPCs
> were verified returning real numbers as that user. First read: 10 athletes / 2 coaches, but **0
> active in the last 7 days** and 0 meal-loggers — i.e. the accounts are dev/test and there is no
> live daily usage yet. The instrument works; the job now is getting real users in front of it.

Answers "how many athletes logged today?" by aggregating the `days`/`meals` you already collect —
no client events, works retroactively. Use it any time from the Supabase **SQL editor** (you're
logged in as yourself there, so the admin gate passes automatically):

```sql
select * from admin_overview();          -- totals, active today, active 7d, new athletes 7d, ...
select * from admin_daily_activity(30);  -- per-day active / scored / meal-logging athletes + avg score
```

Counts only, no PII, gated to the `platform_admins` allowlist. To add another admin later:
`insert into platform_admins (user_id) values ('<their-uuid>');`

## Layer 2 — anonymous funnel/activation events (LIVE as of 2026-07-11)

> **STATUS: DEPLOYED + VERIFIED.** `0052_analytics_events.sql` applied to live; the
> `analytics-ingest` edge function deployed (`--use-api`, `verify_jwt=false` pinned in
> config.toml); `EXPO_PUBLIC_ANALYTICS_URL` wired into all three `eas.json` build profiles + local
> `.env`. Verified end-to-end on live: a POST of `{app_open, meal_logged(+a planted PII prop),
> exfiltrate}` returned `accepted:2` — the bad name was **dropped** (not in the vocabulary), and the
> `meal_logged` row stored `{slot, source}` only (the planted `name` prop was **stripped
> server-side**). Test rows deleted. Read the funnel with `admin_onboarding_funnel(14)` /
> `admin_event_counts(14)`.
>
> **ONE step remains, and it's yours (it's your existing launch step anyway):** the app only starts
> *sending* once a build/bundle carries `EXPO_PUBLIC_ANALYTICS_URL`. That variable is now in
> `eas.json`, so your **next `eas build`** (the same one that puts the app on TestFlight) includes
> it automatically — no separate analytics step. For an OTA `eas update` instead, also set it as an
> EAS environment variable (`eas env:create`) since Update resolves env separately from build. Until
> a build ships with it, the seam stays inert and the function simply receives nothing.

### (original authoring notes below)

Captures what Layer 1 structurally can't see: **onboarding drop-off** (opened → picked a role →
chose a goal → created an account), the **age-gate turn-aways**, **meal-analysis failures**, and
connect attempts. All anonymous — keyed to a random per-install session id, never a user id or
email. Props are counts/enums only; a name/email/free-text note is structurally unstorable (the
client redacts, and the ingest function re-validates — verified live, incl. against deliberate
injection).

**It sends nothing until you wire it.** With no sink configured, the app buffers events locally
(bounded, rolls over) and never makes a network call. To turn it on:

1. **Apply the migration** (throwaway-DB validation first, per the standing runbook):
   ```bash
   supabase db push        # applies 0052_analytics_events.sql
   ```
2. **Deploy the ingest function** (Docker):
   ```bash
   supabase functions deploy analytics-ingest
   ```
3. **Point the app at it** — set the env var and ship an app build (or `eas update`):
   ```
   EXPO_PUBLIC_ANALYTICS_URL=https://<project>.functions.supabase.co/analytics-ingest
   ```
   Until this env var is present in a build, the seam stays inert.
4. **Read the funnel** (same admin allowlist as Layer 1):
   ```sql
   select * from admin_onboarding_funnel(14);  -- opens → roles → goals → completed, + age_blocked, meal_fails
   select * from admin_event_counts(14);       -- per-event daily counts
   ```

### Event vocabulary (fixed; client `proto/redesign-2026-07/js/analytics.js` ↔ server `analytics-ingest`)
`app_open` · `onboarding_role{role}` · `goal_selected{goal}` · `age_blocked` ·
`onboarding_completed{role}` · `meal_logged{slot,source}` · `meal_analysis_failed{reason}` ·
`commitment_set{answer}` · `recovery_submitted` · `weight_logged` · `coach_connected{kind}` ·
`code_join_failed` · `app_error{where}`. Adding a signal = add it in both files.

## Crash reporting
`app_error` events (window errors + unhandled rejections, message truncated to an enum-ish token,
no PII) flow through the same seam once Layer 2 is on — a lightweight crash signal without a
native SDK. A full crash SDK (Sentry) still wants the EAS build and is tracked in the go-live doc,
not here.

## What is NOT collected (by construction)
No names, emails, weights, meal contents, notes, message text, or any health data — the redaction
whitelist (numbers / booleans / `^[a-z0-9_.:-]{1,24}$` strings) makes those unrepresentable, on
both the client and the server. Session ids are random and identity-free.
