# Launch audit — 2026-07-31

A full production-readiness pass over the live system. State as verified this morning (UTC),
not as remembered.

## Verified green

| Surface | State |
|---|---|
| Prod DB | migrations **0001–0175** applied, local == remote |
| Edge functions | meal-chat v25 (safety hand-off live); 38 fns deployed |
| OTA | b9772c90 (thread batch) — bundle `152ee013abf5a207` matches the committed proto.zip and already carries the founding-copy fix |
| Landing | deployed (version `325c46ee`); live site verified free of the retired "free through the beta" clause |
| Crons | 12 active; every job's last run succeeded (data-retention fixed today, see below) |
| Tests | typecheck · 2796 jest · 181 proto · XSS lint · RLS/authz suites · spend-gate suite (9) · Metro iOS export — all green |
| security-sweep | tracked_secrets ✅ · dep_cves ✅ (re-anchored after `npm audit fix`) |

## Fixed today

**0174 — the spend gate now reserves what it approves.** `ai_spend_gate` read only settled
costs, which land seconds after each call, so N concurrent callers all passed a cap with room
for one — the exact burst an anon-key abuser produces. Advisory lock + a 3-minute reservation
ledger (`ai_spend_pending`), SQL-only, no caller changes. Regression suite asserts the race.

**0175 — the nightly retention purge has never run since 0148.** pg_cron wraps job commands in
an explicit transaction, so the procedure's intra-loop `COMMIT` raised "invalid transaction
termination" at 03:17 UTC every night, unread. Rewritten to bound work per run (20×10k rows per
table) with no transaction control. Applied and executed clean on prod by hand; confirm
tomorrow's 03:17 run in `cron.job_run_details`.

**Founding-copy retirement shipped end-to-end** (commit cb3d5bc): landing dialog (site.js),
in-app plan-upgrade card, ASO promotional-text recommendation, founding.ts contract comment,
pricing docs. The offer is the price lock, only.

**Dependency CVEs**: non-breaking `npm audit fix` applied. Declined: the uuid advisory (forces
a breaking expo-splash-screen major — ABI skew is a known launch-crash source, ITMS-90863) and
brace-expansion copies pinned inside jest's own tree (dev-only; npm's offered fix is jest@25).

## Still owed — founder actions (dashboards I can't reach)

**Key rotation** (security audit 2026-07-30 finding #1 follow-through). Until the .easignore
fix, `.env` was uploaded to EAS build servers on every build — retrievable by anyone with EAS
project access or a stolen EAS token. The hole is closed; the exposed keys are not yet rotated:

1. `STRIPE_SECRET_KEY` — **live-mode key; do this first.** Stripe Dashboard → Developers →
   API keys → roll. Update `.env`; check Supabase function secrets independently (they were
   never exposed via EAS, but if they share this key value, rolling it breaks them until
   updated — `supabase secrets list` to compare).
2. `CLOUDFLARE_API_TOKEN` — CF Dashboard → My Profile → API Tokens → roll. Update `.env`
   (used for wrangler deploys of the landing + admin).
3. `OPENAI_API_KEY` — platform.openai.com → API keys. Used by the eval harness only.
4. `HIGGSFIELD_API_KEY` / `_SECRET` — hero-video pipeline; rotate or delete if done with it.
5. `LANDING_ADMIN_KEY` — no reference anywhere in the repo; likely vestigial. Delete from
   `.env`, or if the deployed worker still checks it, rotate via `wrangler secret put`.
6. `STRIPE_TEST_SECRET_KEY` — test-mode; rotate whenever convenient.

`EXPO_PUBLIC_*` values and the Supabase anon key are public by design — no action.

## Known, accepted, not blockers

- `billing-overage-invoice` (monthly, 2nd) and `weekly-digest` (Sun 22:00 UTC) have simply not
  had their first firing yet — check after their windows pass.
- iOS review prompt reports unavailable under TestFlight — expected platform behavior.
- QC harness can't photograph the meal-thread composer (seed has no mealId) — harness gap, not
  product.
- Solo-accountability design + plan (docs/superpowers/, 2026-07-30) are specced but unbuilt.
