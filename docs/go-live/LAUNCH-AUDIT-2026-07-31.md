# Launch audit — 2026-07-31

A full production-readiness pass over the live system. State as verified this morning (UTC),
not as remembered.

> **Re-verified 11:20 UTC.** Every credential below was re-tested against the tool that actually
> *consumes* it, rather than a generic verify endpoint. Four claims in the original pass were
> wrong: `CLOUDFLARE_API_TOKEN` (healthy, not dead), `LANDING_ADMIN_KEY` (live, not orphaned),
> the cron "all succeeded" line, and the function count. All four are corrected in place below.
> The method note under *Key rotation* explains the class of mistake — worth reading before
> trusting any future credential audit.

## Verified green

| Surface | State |
|---|---|
| Prod DB | migrations **0001–0175** applied, local == remote |
| Edge functions | meal-chat **v25** ✅ (safety hand-off live); **41** fns deployed, all ACTIVE (not 38 — recount 11:20 UTC) |
| OTA | b9772c90 (thread batch) — bundle `152ee013abf5a207` matches the committed proto.zip and already carries the founding-copy fix |
| Landing | deployed (version `325c46ee`); live site verified free of the retired "free through the beta" clause |
| Crons | 12 active. **NOT "all succeeded"** — `data-retention`'s last scheduled run FAILED (07-31 03:17, 3 failures total); it predates today's 0175 fix, which is verified live. `billing-overage-invoice` + `weekly-digest` have never fired yet. The other 9 are green |
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
| `CLOUDFLARE_API_TOKEN` | ✅ **Live in `.env`; `wrangler whoami` authenticates as "Gelatinous Twin"** (re-verified 2026-07-31 ~11:15 UTC). The earlier ❌ was a BAD TEST, not a dead key — see the note below |
| `OPENAI_API_KEY` | ✅ Works — either rotated+updated or still pending per founder's count |
| `HIGGSFIELD_*` | ✅ **Tested and working** (re-verified 11:20 UTC). `GET /requests/<bogus-id>/status` with real creds → 404 (auth passed); with bogus creds → 401. Rotate or delete when done with hero-video |
| `LANDING_ADMIN_KEY` | ✅ **LIVE — do NOT delete.** The earlier "zero repo references" was a string-match miss: the worker reads it as **`env.ADMIN_KEY`** (worker.js:35), a Cloudflare Worker secret, which `wrangler secret list` confirms is set. `curl -H "x-admin-key: $LANDING_ADMIN_KEY" https://onstandard.app/api/leads` → **200**; wrong/absent key → 404 (fails closed, and deliberately hides the route). Deleting this from `.env` would have thrown away the only copy of a working credential |
| `STRIPE_TEST_SECRET_KEY` | works; rotate at leisure |

### ⚠️ How to test a Cloudflare token (the trap that produced a false ❌)

OnStandard's token is an **Account API token** (`cfat_` prefix = CloudFlare Account Token), created
under *Manage account → Account API tokens*. It is NOT a User API token (*My Profile → API Tokens*).
The two live in different namespaces, and the popular verify endpoint only resolves user tokens:

```sh
# ✗ WRONG — always says "Invalid API Token" (code 1000) for an account token, even a perfect one
curl https://api.cloudflare.com/client/v4/user/tokens/verify -H "Authorization: Bearer $TOK"

# ✓ RIGHT — hit an account-scoped endpoint the token has rights to, or just ask wrangler
curl https://api.cloudflare.com/client/v4/accounts/d526c8ba5659275611952133e471f3d4 \
     -H "Authorization: Bearer $TOK"
CLOUDFLARE_API_TOKEN=$TOK npx wrangler whoami
```

**Read the error code, they are not interchangeable:**

| Code | Means |
|---|---|
| `1000 Invalid API Token` | wrong namespace — you tested an account token against `/user/`. Says nothing about validity |
| `9109 Invalid access token` | genuinely revoked/rolled. This is what a real dead token returns |

The 2026-07-31 morning audit used the `/user/` endpoint, declared a healthy token dead, and cost
three unnecessary token rolls before the account-scoped call proved it had been working all along.
A rolled token invalidates every prior secret, so each roll really did break `.env` until it was
re-pasted — the "fix" was causing the failure it reported.

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
