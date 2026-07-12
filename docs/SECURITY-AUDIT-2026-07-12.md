# OnStandard — Full Security Audit (2026-07-12)

Whole-codebase + Supabase-backend audit run against the "vibe-coded app" checklist (secrets, RLS,
server-side validation, dependencies, auth middleware, rate limiting, CORS, file upload) by four
parallel read-only auditors (RLS/database, edge functions, client/WebView/secrets, dependencies +
git-history). **Every CRITICAL / HIGH / MEDIUM finding was adversarially re-verified against the
actual code** (grants + policy lifecycle across all 52 migrations, the `messaging_authorized` trace,
the Stripe-signature path, the spend-guard call sites) before any fix was written. Fixes were applied
in one batch; `npm run verify` stays green (**1745 tests**, up from 1018 at the 2026-06-29 audit; iOS
bundle exports). Migration `0053` is **authored only — NOT applied to the live project** (founder
applies at go-live after `test:rls`, per guardrail D1).

**Headline:** the codebase remains unusually disciplined — no secrets in source or git history,
session tokens in the OS Keychain/Keystore, an RLS spine with `WITH CHECK` + `auth.uid()` throughout,
a signature-verified Stripe webhook, and fail-closed global AI spend caps. But one legacy link table,
**`guardianships`, never received the self-insert fix its two siblings got in `0038`** — a CRITICAL
authorization bypass that let any user appoint themselves guardian of anyone (reading an adult's
private data AND opening a message channel to any minor). A second, HIGH IDOR existed in meal-plan
assignments. Both are now fixed in `0053`. The rest were defense-in-depth. Dependencies carry no
critical/high advisories.

Severity legend: **CRITICAL** (active breach / auth bypass) · **HIGH** · **MEDIUM** · **LOW/INFO**.
Status: **FIXED** (this batch) · **GO-LIVE** (founder action before the flag flips) · **DEFERRED**
(LOW, scheduled) · **CORRECT** (verified safe).

---

## FIXED in this batch

### C1 — `guardianships` self-appoint → PII read + minor-messaging bypass · CRITICAL · FIXED
`supabase/migrations/0002_rls.sql:136` (`g_manage`) + grant `0005_grants.sql:14` → fixed in **`0053`**.
`g_manage FOR ALL ... WITH CHECK (guardian_id = auth.uid())` only proved the caller was the *guardian*,
never that the *athlete* consented, and `authenticated` still held INSERT (blanket 0005 grant, never
revoked for this table). Any signed-in user could `insert into guardianships (athlete_id=<victim>,
guardian_id=<self>, status='active')`, which flips `is_guardian_of → can_view` (read an adult/
unknown-age victim's `days`/`meals`/`checkins`/`athlete_profiles`/photos) **and** `is_guardian_link →
messaging_authorized` (open a thread to any **minor** — `0050` gates `can_view` + writes for minors but
**not** the messaging path). Verified end-to-end: the grant/revoke lifecycle across all 52 migrations
(no revoke ever named `guardianships`), the `g_manage` policy is never superseded, and `0038` fixed the
identical hole on `team_members`/`practice_clients` but skipped this table.
**Fix (`0053`, mirrors `0038`):** drop `g_manage`; add guardian/athlete revoke-only (UPDATE/DELETE)
policies; **no INSERT policy** (creation is service-role/RPC-only, per the consent flow) +
`REVOKE INSERT ... FROM authenticated` as defense-in-depth. No current client flow inserts
guardianships (consent uses `guardian_consent_requests` + the service-role `guardian-verify`
endpoint), so nothing legit breaks. New probes in `rls_authz_test.sql §3b` (stranger can't self-appoint
over an adult or a minor).

### H1 — `plan_assignments` IDOR: self-assign another author's plan · HIGH · FIXED
`supabase/migrations/0032_meal_plans.sql:55` + grant `0036_fix_table_grants.sql:33` → fixed in **`0053`**.
`plan_assignments_assigner_all ... WITH CHECK (assigned_by = auth.uid())` never verified the caller
owns the plan or can view the athlete, so a user could self-assign another coach's plan (then read its
`plan_json` via `meal_plans_athlete_read`) or dump a plan onto a stranger. (The feature is not wired
into the client yet — `docs/proto-native-app/PHASE6-P4-SCOPE.md` flags this exact gap — so hardening
breaks nothing.)
**Fix (`0053`):** `WITH CHECK (assigned_by = auth.uid() AND caller owns the plan AND can_view(athlete))`.
New probes in `rls_authz_test.sql §3b` (stranger can't self-assign; the plan author still can).

### M1 — AI spend: per-caller fairness caps incomplete (roster DoS) · MEDIUM · FIXED
The global bill backstops already failed **closed** (total Anthropic cost bounded), but the per-caller
fairness caps had gaps that let one anon-key actor exhaust a feature's shared daily budget:
- `analyze-meal/index.ts` — `phase:'finalize'` (a full paid vision call) was exempt from the per-caller
  cap; an anon-key finalize-loop skipped it. **Fixed:** finalize now counts (`countsAgainstDailyCap =
  !isMemory && !isOrder`).
- `assist/index.ts` — had no per-caller cap at all. **Fixed:** added the `analyze-meal` pattern
  (per-user fail-open / anon-IP fail-closed, keyed `assist_user:`/`assist_ip:`).
- `plan-generate/index.ts` — its global + anon-IP `withinKeyCap` **failed open** (lone violator of the
  house rule). **Fixed:** added the `failOpen` param and made both fail closed.

### L1 — Weak password policy · LOW · FIXED
`supabase/config.toml`: `minimum_password_length` 6 → **8**; `password_requirements` `""` →
**`letters_digits`** (rejects `password` / `12345678` without forcing symbols on a youth signup).

### L2 — Three `--no-verify-jwt` functions unpinned · LOW · FIXED
`supabase/config.toml`: pinned `verify_jwt = false` for `billing-return`, `guardian-verify`,
`weekly-digest` (as `stripe-webhook`/`analytics-ingest` already are) so a redeploy can't flip JWT
verification back on and 401 the flow.

### L3 — `analyze-meal` image content-type assumed · LOW · FIXED
`media_type` was hardcoded `image/jpeg`. **Fixed:** `detectImageMime()` magic-byte sniff
(jpeg/png/gif/webp) rejects non-images with 400 and passes the model the real type (size cap unchanged).

### L4 — One unescaped WebView sink · LOW · FIXED
`proto/redesign-2026-07/js/screens/home.js` — the Trust-Pass `${t.note}` was the single interpolation
that skipped `esc()`. **Fixed:** `${esc(t.note)}` (both call sites). Safe today (hardcoded literal), a
stored-XSS landmine the moment the note becomes author-controlled.

### L5 — No Content-Security-Policy on the WebView document · LOW · FIXED
`proto/redesign-2026-07/index.html` — added a conservative CSP: hard-blocks `object`/`embed`,
`<base>`-tag hijacking, and framing, while staying permissive for the bundle's actual patterns
(inline config + inline styles, `data:`/`blob:` images, https Supabase + analytics). Smoke-test on
device before tightening further.

### L6 — `guardian-verify` had no rate limit · LOW · FIXED
Added a best-effort per-IP limit on the approval POST (defense-in-depth atop the 128-bit token).

### L7 — `weekly-digest` non-constant-time cron-key compare · LOW · FIXED
Replaced `!==` with a constant-time `safeEqual()`.

---

## GO-LIVE — founder action

- **Apply `0053_authz_hardening.sql`** in the migration batch (`… → 0052 → 0053`) after running
  `npm run test:rls` **green** on a throwaway stack (seeds now include the §3b probes). Per guardrail
  D1, migrations are applied by the founder, never by the crew.

---

## DEFERRED — LOW, scheduled (considered, intentionally not hotfixed)

- **`team_staff` self-add** (`ts_manage FOR ALL`): a head coach can add an arbitrary user as staff of
  *their own* team. Requires already being staff (collusion/insider, not open escalation) and the
  legit "add a co-coach" flow depends on it — a proper fix is an invite/accept RPC, not a policy
  removal. Schedule; do not block.
- **Name-enumeration RPCs** (`resolve_team_code`, `team_head_coach_name`): return a coach/trainer
  display name for any team-id/code. Names-only leak, blunted by 6-char codes (36⁶); the real fix is a
  per-caller throttle at the gateway.
- **`profiles.primary_role` from user metadata:** seeded from user-editable `raw_user_meta_data` but
  **never used for authorization** today (authz flows through link tables). Keep it that way — a future
  policy trusting it would be instant privilege escalation.
- **Dependencies:** 11 moderate advisories, **0 critical / 0 high**, all transitive via `uuid` inside
  the Expo *build* toolchain (`@expo/cli`, `xcode`, `metro-config`) — not shipped at runtime and not
  applicable to the v4-random usage here. `npm audit fix` wanted to reshuffle the Expo toolchain (build
  risk, zero runtime benefit); left for routine Expo-SDK maintenance.

---

## CORRECT — verified safe (do not regress)

- **No secrets** in source or git history. Only the Supabase URL + anon key are public (RLS-gated);
  Anthropic / Stripe / service-role keys are server-only (`Deno.env.get` / `supabase secrets set`).
- **Session tokens in OS-backed secure storage** — Keychain/Keystore via `expo-secure-store` (chunked),
  native and WebView-bridge paths; a bridge capability allowlist (`sb-*`/`onstd-*`) contains any
  WebView compromise.
- **RLS spine sound** — 37/37 tables RLS-enabled, `WITH CHECK` on writes, `auth.uid()` identity, all
  SECURITY DEFINER helpers pin `search_path`; internal counter/admin tables have DML revoked from
  `anon`/`authenticated`.
- **Storage** — `meal-photos` bucket private, per-`athlete_id`-folder scoping + server-enforced MIME
  allowlist (SVG excluded) + 8 MB cap + `0050` minor-consent gate.
- **Score/leaderboard integrity** — `CHECK` shape constraints + an evidence-ceiling trigger clamp
  fabricated scores.
- **Stripe webhook correct** — raw-body `constructEventAsync` with `STRIPE_WEBHOOK_SECRET` **before**
  the service-role client is constructed; owner never guessed; referral idempotent.
- **Auth validated server-side everywhere** — `getUser()` (never `getSession()`); write identity always
  from the token, never a body id. CORS is allowlist-reflection; `*` only on the two anonymous endpoints;
  no `Allow-Credentials` anywhere.
- **Structural analytics PII firewall** — fixed event vocabulary + enum/number-only values make
  free-text/PII unstorable.

---

## Checklist summary

```
1.1 PASS  1.2 PASS  1.3 PASS  1.4 PASS  1.5 N/A  1.6 PASS
2.1 PASS  2.2 PASS  2.3 FIXED(C1+H1)  2.4 PASS  2.5 PASS  2.6 PASS  2.7 PASS  2.8 PASS
3.1 N/A(RLS+getUser)  3.2 PASS  3.3 PASS  3.4 PASS  3.5 PASS  3.6 PASS  3.7 N/A  3.8 FIXED(L1)
4.1 PASS  4.2 PASS  4.3 FIXED(L4,L5)  4.4 PASS  4.5 PASS  4.6 PASS
5.1 DEFERRED(build-only)  5.2 PASS  5.3 PASS  5.4 DEFERRED  5.5 N/A
6.1 FIXED(M1)  6.2 PASS  6.3 FIXED(M1)
7.1 PASS  7.2 PASS
8.1 FIXED(L3)  8.2 PASS  8.3 PASS
```

---

## Verification

- `npm run verify`: **green** — `tsc --noEmit` clean, **1745** tests pass (143 suites), iOS bundle
  exports (proto.zip repacked with the CSP + `esc()` edits).
- Edge functions are excluded from `tsc` (Deno runtime); the four function edits were hand-verified
  against the established patterns in the same files.
- `0053_authz_hardening.sql` + the new `rls_authz_test.sql §3b` probes are statically verified against
  the proven `0013`/`0038`/`0050` patterns; **the founder runs `npm run test:rls` on a throwaway stack
  before `supabase db push`** (no live DB was touched).

**Apply order at go-live now ends with `… → 0052 → 0053`.**
