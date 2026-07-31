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

## Key rotation — status as verified 2026-07-31 ~11:00 UTC

The founder rotated keys the same morning. Verified live against each provider:

| Key | Status |
|---|---|
| `STRIPE_SECRET_KEY` (live) | ✅ **Rotated completely** — new key in `.env` AND Supabase fn secrets (digests match, 09:45 UTC), API accepts it |
| Supabase platform keys | ✅ Changed 09:47 UTC without breakage — verified sign-in, authenticated REST, anon RPC (founding counter), edge fns + service-role writes all 200. Only `/rest/v1/` OpenAPI root is now service-role-only (harmless; clients never call it) |
| `CLOUDFLARE_API_TOKEN` | ❌ **Rotated in dashboard but `.env` still has the DEAD token** — next `wrangler deploy` of landing/admin fails until the new token is pasted into `.env` |
| `OPENAI_API_KEY` | ✅ Works — either rotated+updated or still pending per founder's count |
| `HIGGSFIELD_*` | untested (nonstandard API); rotate or delete when done with hero-video |
| `LANDING_ADMIN_KEY` | zero repo references — delete from `.env`, or `wrangler secret put` if the worker checks it |
| `STRIPE_TEST_SECRET_KEY` | works; rotate at leisure |

**⚠️ Do NOT click "disable legacy API keys" in the Supabase dashboard.** The shipped app
(build 23 + all OTAs) and the landing page authenticate with the LEGACY anon key. Functions
already receive the new-style keys (`sb_publishable_`/`sb_secret_`), but disabling legacy
kills every installed client until a new build/OTA ships with the publishable key. Migration
path when ready: swap `EXPO_PUBLIC_SUPABASE_ANON_KEY` + landing `SB_ANON` to the publishable
key → OTA + redeploy landing → verify → only then disable legacy.

## Known, accepted, not blockers

- `billing-overage-invoice` (monthly, 2nd) and `weekly-digest` (Sun 22:00 UTC) have simply not
  had their first firing yet — check after their windows pass.
- iOS review prompt reports unavailable under TestFlight — expected platform behavior.
- QC harness can't photograph the meal-thread composer (seed has no mealId) — harness gap, not
  product.
- Solo-accountability design + plan (docs/superpowers/, 2026-07-30) are specced but unbuilt.
