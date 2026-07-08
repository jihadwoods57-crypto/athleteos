# Weekly coach digest — one step left (schedule it)

**Status 2026-07-04: everything is deployed.** The `weekly-digest` function is live
(fails closed without its key — verified 401), its `DIGEST_CRON_KEY` secret is set, and
migration 0044 (the scheduling helper + pg_cron/pg_net) is applied. The digest sends every
coach/trainer their roster's week (logged days, team average, who went silent) as an
in-app notification + device push, every Sunday evening.

## The one remaining step (2 minutes)
Open **Supabase Dashboard → SQL Editor** and run:

```sql
select public.schedule_weekly_digest(
  'https://ftwrvylzoyznhbzhgism.supabase.co/functions/v1/weekly-digest',
  '<THE KEY>'
);
```

`<THE KEY>` is in the repo working directory at `.digest-cron-key.local` (gitignored, never
committed). That's it — Sundays 22:00 UTC (~6 PM Eastern), every coach gets their week.

## To verify it worked
```sql
select jobname, schedule, active from cron.job where jobname = 'weekly-digest';
```

## To test a digest RIGHT NOW (without waiting for Sunday)
```
curl -X POST https://ftwrvylzoyznhbzhgism.supabase.co/functions/v1/weekly-digest -H "x-digest-key: <THE KEY>"
```
Response `{"ok":true,"digests":N}` = N coaches/trainers got their digest (in-app feed
always; push only on devices with registered tokens).

## Knobs
- Rotate the key: `supabase secrets set DIGEST_CRON_KEY=<new>` then re-run the schedule SQL
  with the new key (it replaces the old job).
- Change the time: edit the cron expression in `schedule_weekly_digest` (0044) or re-run
  with a tweaked helper.
