# Apply-to-Live Runbook — Cycle 2 security batch (2026-07-11)

Branch: `fix/cycle1-release-blockers`. Everything here is **authored + statically reviewed +
suite-green, NOT applied to live** (standing guardrail: the crew never runs `supabase db push`
or deploys functions). Two artifacts need your hands; both are small.

## 1. Migration `0050_minor_consent_enforcement.sql` — the P1 from the 2026-07-11 audit

**What it closes:** guardian consent for minors was enforced ONLY by the client. Server-side,
any linked coach could read a minor's rows the moment they joined by code, and nothing stopped
a minor's rows from landing in `days`/`meals`/`checkins`/photos. Now:
- a **provable minor** (base_age or dob < 18) cannot sync rows or photos until a
  `guardian_consent_requests` row is `verified` (write-block trigger + storage policies);
- `can_view()` denies every third party (coach/trainer/guardian/org) on an unconsented
  provable minor — self-access untouched;
- **age ruling** (the audit's queued judgment call, now written into the migration header):
  unknown age = adult for these gates, because `base_age` is never written by the current app
  and `dob` only arrived in 0048 — fail-closed here would sever every live adult's sync.
  Messaging keeps its stricter fail-closed `is_minor()` semantics. Revisit when a
  verified-age/parent-verification vendor lands.

**Apply steps (your machine, Docker needed):**
```bash
supabase start && supabase db reset          # applies 0001..0050 from scratch
supabase/tests/run.sh                        # RLS suite now includes section 10 (0050 probes)
supabase db push                             # after both are green
```
The updated `supabase/tests/rls_authz_test.sql` seeds verified consent for minor M (so link
probes keep testing links) and adds minor N (dob-only, unconsented) probing: write-block,
photo-block, legacy-row read-block, self-access, consent unlock, and the
unknown-age-adult-not-blocked guarantee.

**Post-push spot-check (SQL editor as postgres):**
```sql
select tgname from pg_trigger where tgrelid='public.days'::regclass and not tgisinternal;
-- expect trg_minor_consent_days (plus the 0041 clamp trigger)
select has_function_privilege('authenticated','is_provable_minor(uuid)','execute');   -- false
select has_function_privilege('authenticated','has_verified_guardian_consent(uuid)','execute'); -- false
```

## 2. Edge functions — global AI spend caps now fail CLOSED

`analyze-meal`, `assist`, `meal-chat`: the GLOBAL bill backstop (and analyze-meal's anon
per-IP cap) previously returned `true` on any counter error — an RPC hiccup silently disabled
the last line of defense on paid Anthropic spend via the public anon key. They now return 429
when the counter is unreachable; per-user fairness caps still fail open (a legit athlete's log
is never blocked by an infra hiccup). `deep-analysis` already worked this way.

Since 0030 is applied on live and the env vars are set in deployed functions, fail-closed
changes nothing in normal operation — it only changes what a counter outage means.

```bash
supabase functions deploy analyze-meal assist meal-chat org-directory
```

## 3. Cycle 3 additions (same branch, same deploy)

- **`org-directory` `preview_code` enumeration guard**: on top of the per-minute in-memory
  limiter, code previews now claim against the durable DB day-counter (`preview:<ip>`,
  default 150/day/IP, tune via `PREVIEW_CODE_IP_DAY_CAP`). Sustained code-guessing — which
  harvests coach names and school affiliations — now hits a wall that survives isolate
  recycling. Included in the deploy line above.
- **App-side (ships with the next build, no live action)**: reconnect-safe day merge (an
  offline-logged day can no longer be erased by an older server row, and is pushed back up
  on reconnect — the "coach sees 'not logged' for an honestly-logged day" gap); flush of the
  debounced day push when the app is backgrounded; invite deep links
  (`onstandard://join?code=X`) now open Connect prefilled; the WebView's secure-store bridge
  is key-allowlisted (`sb-*`/`onstd-*` only) so a hypothetical XSS can't use it as an
  arbitrary Keychain oracle; latent XSS sinks (food names, plan titles, notes) escaped
  before the real food database lands.

## Known-open (no action needed from you yet)
- Per-IP rate limits across functions are per-isolate and `x-forwarded-for`-spoofable —
  DB-backed counters remain the real control (by design, but worth a shared store later).
- In-range score self-reporting (evidence ceiling holds; full server recompute is the
  long-term fix — roadmap #15).
- `meals` table has no unique key per (athlete, day, slot) — cross-device re-logs can
  duplicate rows. A dedup-then-constraint migration needs a look at live data first
  (multiple snacks/day may be legitimate); flagged for a future cycle, not authored blind.
