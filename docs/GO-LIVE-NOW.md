# Go-Live — do this when you're back at your computer

A short, ordered runbook for finishing the backend turn-on. Most of the hard part is
already done; this is the desk-side finish. Updated 2026-06-28.

## Status (verified against your live project)
- ✅ **Supabase project is live and reachable** (`ftwrvylzoyznhbzhgism`).
- ✅ **Schema is complete** — migrations 0001→0008 all applied and verified (tables +
  `create_team`, `delete_account`, `request_guardian_consent`, `messaging_authorized`).
- ✅ **Email confirmation is already ON** (`mailer_autoconfirm: false`) — D2 is done.
- ✅ **Demo/sample data is gated** — fake stats (streak, weight Δ, retention, "Eastside HS")
  now hide automatically once the backend is live.
- ⛔ **App not yet wired** — no `.env`, so the app still runs on demo data.
- ⛔ **Legal not yet hosted** — Privacy Policy + Terms drafts in `docs/legal/` need public URLs.

## Step 1 — Wire the app (2 minutes)
Create a file named `.env` in the project root (same folder as `package.json`) and paste:
```
EXPO_PUBLIC_SUPABASE_URL=https://ftwrvylzoyznhbzhgism.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZ0d3J2eWx6b3l6bmhiemhnaXNtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIyODYyNDYsImV4cCI6MjA5Nzg2MjI0Nn0.mJBl-Esn2YRB_jaUv_SQXT8wGfbx06dx7Ss9xyGRoH0
EXPO_PUBLIC_BACKEND_LIVE=true
```
`.env` is gitignored on purpose (never commit it). The anon key is the public client key —
safe here; never put your `service_role` key or DB password in the app.

## Step 2 — Host the legal docs (before real users sign up)
Publish `docs/legal/PRIVACY-POLICY.md` + `docs/legal/TERMS-OF-SERVICE.md` at real URLs and
link them in the app/store listing. (Adult-trainer wedge = no COPPA vendor needed.)

## Step 3 — Restart + smoke-test (do this with Claude Code)
Restart the dev server so the new env is picked up. Then say "I'm wired up" and we'll
round-trip the real loop together: sign up → trainer makes a practice → client joins →
log a meal → confirm it hits the real database, not demo data.

## Step 4 — Build & distribute to real phones (the actual launch)
Getting it onto trainers'/clients' phones is a separate build step: Expo/EAS → TestFlight
(iOS). This is also a desk job; we'll set it up when you're ready.

## Separate switch — real AI (optional, later)
The data backend going live does NOT turn on AI (labels stay the honest "Nutrition Coach").
To make "AI" real: deploy `supabase/functions/analyze-meal` and set the Anthropic key
(`supabase secrets set ANTHROPIC_API_KEY=...`). One risk at a time — fine to leave for later.

## Still-open decisions (the only non-desk items)
- The 5 "general"-profile scoring numbers (headline mix, nutrition split, two-sided calorie
  band, general protein target, "Development" vs "Progress Score" label). Engine is built with
  proposed defaults; ratifying them is a one-line constant change. See the D9 spec.

## Kill switch
Set `EXPO_PUBLIC_BACKEND_LIVE=false` and rebuild to instantly revert to local/demo mode.
