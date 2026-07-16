# OnStandard / AthleteOS — Data-Protection Compliance Audit & Remediation

**Date:** 2026-07-15 · **Branch:** `compliance-fixes` · **Scope:** technical compliance remediation (not legal advice — a qualified attorney must confirm where flagged)

**Headline:** This app was already **substantially compliant** — it ships a real, fail-closed AI-egress consent gate (client + server triggers), true cascade account deletion, a finalized privacy policy + terms (with auto-renewal disclosure and an AI/subprocessor disclosure), **no third-party trackers**, PCI **SAQ-A** payments (no card data on servers), clean secret hygiene, and PII-safe logging. The gaps were narrow and specific: **policy↔code mismatches** and **missing server-side enforcement/completeness**. Nine were fixed in code across seven commits; the rest need a human (deploy, contracts, or a business/legal decision).

Every finding is grounded in `file:line` evidence. No migration was applied to a live database; no user data was mutated; nothing was deployed.

---

## a. FIXED

| # | Gap | Regime + article | Files changed | Commit |
|---|-----|------------------|---------------|--------|
| P4 | Served privacy policy omitted two **active** data recipients — **Stripe** (billing email + customer/subscription IDs, `billing-checkout/index.ts:137`) and **Expo Push** (device token + notification bodies with athlete names, `send-push/index.ts:81`, `weekly-digest/index.ts:143`) — and did not list the **payment / push-token / IP-for-security** data categories it processes. | GDPR **Art. 13(1)(e) / 14**; CCPA §1798.100 | `web/landing/privacy.html` (§3, §7) | `114d634` |
| P2 | ToS/data-processing **consent was recorded only in device-local storage** (`useStore.ts` `termsAcceptedAt`/`realDataConsent`), unversioned — the operator could not *demonstrate* who consented, to which policy version, and when. Columns `profiles.tos_accepted_at/tos_version` existed (`0048`) but were never written. | GDPR **Art. 7(1) / 5(2)** (accountability) | `constants.ts`, `useStore.ts`, `queries.ts`, `database.types.ts`, `+0064_consent_receipt.sql` | `8aeaa56` |
| P1 | Account deletion (`delete_account()` `0007`) cascades Postgres + Storage but is pure SQL and **cannot reach Stripe**, so erasure left the **Stripe customer + active subscription alive** — continued billing of a deleted user + payment-PII retention. | GDPR **Art. 17**; US **ROSCA** / CA **ARL** | `+supabase/functions/cancel-subscription/index.ts`, `queries.ts`, `useStore.ts` | `b09fabe` |
| P8 | The store **swallowed a failed server delete**, wiped locally, and reported success — a false "deleted" when the RPC is undeployed/errors. | GDPR **Art. 17** (integrity of erasure) | `useStore.ts` (returns `{ok}`), `Account.tsx` (honest failure alert) | `b09fabe` |
| P3 | "Export my data" built JSON from **local device state only** while the UI claimed a copy of *"everything in your account"* — omitting server-held records the policy §3 lists (messages, coach comments/feedback, memory facts, guardian-consent, subscription, device tokens, notifications). | GDPR **Art. 15 / 20**; CCPA right to know | `+0065_export_account_data.sql`, `database.types.ts`, `queries.ts`, `useStore.ts` (async merge), `Account.tsx` (corrected copy), `dataRights.test.ts` | `ef83163` |
| P5 | Settings "Privacy & terms" row rendered the policy/terms URLs as **plain, non-tappable text** — the policy was reachable at signup but not from Settings. | App Store guideline + GDPR/CCPA transparency | `Account.tsx` (tappable links), `account.ts` | `62ceff2` |
| P6 | **No data retention** — `analytics_events` (pseudonymous telemetry) + `food_cache` grew unbounded; retention lines were commented-out (`0021:30`, `0045:22`). | GDPR **Art. 5(1)(e)** storage limitation | `+0066_data_retention.sql` (`purge_stale_data` + cron helper) | `6108a21` |
| P7 | The in-app **Notifications toggle was device-local only** — the automated `weekly-digest` engagement push ignored it. | GDPR/**PECR** (respect withdrawal of consent to non-essential messaging) | `+0067_notification_prefs.sql`, `database.types.ts`, `queries.ts`, `useStore.ts` (`toggleNotif` persists), `weekly-digest/index.ts` (fail-open opt-out filter) | `6108a21` |

Supporting commit `38b0cde` aligns `auth.test.ts` + `account.test.ts` with P2/P5.

**Design constraints honored throughout:** all four authored migrations (`0064`–`0067`) are **author-only** (the repo's established "founder applies at go-live" convention, matching `0007`/`0048`/`0050`); every server-side write is **best-effort + backend-gated** (inert offline, swallowed if a column isn't applied yet); the `weekly-digest` opt-out read is **fail-open** so function-deploy vs migration-apply order is not load-bearing. The app stays green (see §d).

---

## b. APPLICABILITY MATRIX

Determined from what the code demonstrably does — global App Store distribution with **no geo-gate** (`app.json`/`eas.json` set no region restriction), a US-built product (Florida governing law, USD-only pricing `pricing.ts:18`, English-only), whose **own privacy policy grants EU/UK + California rights** (`web/landing/privacy.html:144,166`) and processes **special-category health data** on a **13–22 audience that includes minors** (`PRODUCT.md:13`).

| Regime | Verdict | Evidence / reasoning |
|--------|---------|----------------------|
| **GDPR** (EU) | **APPLIES** | Global store reach, no geo-block; policy grants EU rights + describes US transfer (`privacy.html:144,166`); special-category health data (weight/sleep/HRV/macros/meal photos — `0001_schema.sql:144,178`, `recovery.ts:13`, `0003_storage.sql:5`). |
| **UK GDPR** | **APPLIES** | Same basis as GDPR; policy names UK residents explicitly (`privacy.html:144`). |
| **ePrivacy / cookie consent** | **DOES NOT APPLY** | No cookies/trackers: landing loads only first-party `js/site.js` + `supabase-js` (reset), **zero** GA/Meta/Segment/etc. (`web/landing/index.html`); native app has no browser cookies. No banner required. *Load-bearing: adding any tracker later re-triggers this.* |
| **CCPA / CPRA** (California) | **APPLIES (prospective)** | US consumer app reaching CA residents; policy grants CCPA rights + "we do not sell/share" (`privacy.html:144-147`). **Caveat:** statutory business-size thresholds ($25M rev / 100k consumers / 50%+ data-sale revenue) may not be met yet — confirm with counsel; the policy already opts in. |
| **Other US state privacy laws** (VA/CO/CT/UT/TX…) | **UNCERTAIN (threshold)** | Same consumer reach; each has its own applicability thresholds a startup likely doesn't meet yet. Mirroring the CCPA posture satisfies most. |
| **COPPA** (US under-13) | **APPLIES → mitigated** | Under-13 barred by construction: `MIN_SIGNUP_AGE = 13` + stepper floors at 13 (`constants.ts:18`, `useStore.ts:635`). Residual: age is **self-attested** (no DOB verification). |
| **GDPR-K / child data (under 16)** | **APPLIES → mitigated** | No dedicated under-16 gate; instead a **stricter blanket under-18** guardian-consent gate (`consent.ts:36`, server triggers `0050:59-100`). Residual: unknown-age server fail-open (see §c). |
| **PCI-DSS** | **APPLIES → satisfied (SAQ-A)** | Card data entered only on **Stripe-hosted Checkout**; no PAN touches servers (`billing-checkout/index.ts:141` uses `price.id`; no card/PaymentIntent handling anywhere). Webhook signature verified (`stripe-webhook/index.ts:156`). |
| **Biometric (BIPA / TX CUBI / WA)** | **DOES NOT APPLY** | Meal photos are food images, not biometric identifiers; `meals.photo_hash` (`0062`) is a **sha256 of the JPEG bytes for anti-cheat dedup**, not a facial/biometric template. No face recognition anywhere. |
| **Consumer protection / auto-renewal** (US ROSCA, CA ARL, EU CRD) | **APPLIES → largely satisfied** | Terms §8 disclose auto-renewal, pre-checkout pricing, easy cancel (`terms.html:91`); portal-based cancellation (`billing-portal`). **P1 closed** the erasure-doesn't-cancel gap. |
| **HIPAA** | **DOES NOT APPLY** | Consumer wellness app; **no covered-entity / BAA context** in code (no provider, insurer, or claims processing). Not medical advice (`privacy.html:93`). *If ever sold into a covered-entity workflow, re-evaluate.* |
| **FERPA** | **CONDITIONAL** | Only if schools supply rosters/education records; policy §9 addresses it (`privacy.html:134`). A school DPA is a business step. |
| **CAN-SPAM / marketing consent** | **APPLIES (latent)** | No commercial-email program today (only transactional/auth via Supabase; **Resend listed but not wired**). If marketing email launches, add unsubscribe + sender ID. Push opt-out server-honored via **P7**. |
| **Accessibility (ADA / WCAG / EU EAA)** | **APPLIES — conformance UNCERTAIN** | US commercial app + EAA (in force June 2025). Landing sets `lang`/viewport; a formal WCAG 2.1 AA audit of app + landing is unaddressed. |
| **Breach notification** (GDPR Art. 33/34; US state laws) | **APPLIES — process not in code** | No security-event log / breach detection (only a narrow copilot `activity_log`, `0018:16`). Operational runbook needed (see §c). |
| **Processor / DPA obligations** (GDPR Art. 28) | **APPLIES — contracts needed** | Signed DPAs required with Supabase, Stripe, Anthropic, Expo. Business/legal step (see §c). |

---

## c. NOT FIXED / NEEDS HUMAN

> **Actionable pack (added at close-out):** [`GO-LIVE-COMPLIANCE-CHECKLIST.md`](GO-LIVE-COMPLIANCE-CHECKLIST.md) (every item below as concrete steps + commands), [`RoPA-record-of-processing.md`](RoPA-record-of-processing.md) (Art. 30 register), [`DPIA-draft.md`](DPIA-draft.md) (Art. 35 draft for counsel).

These require a deploy, a contract, a lawyer, or a business decision — or are one of the explicit STOP-AND-ASK actions (applying migrations to live, deploying, adding a paid processor, transmitting data to a new service).

### STOP-AND-ASK (I authored the code; enabling it is yours)
1. **Apply the four authored migrations to live** — `0064` (consent receipt), `0065` (export RPC), `0066` (retention), `0067` (notification pref). Follow the repo runbook (throwaway stack → `supabase/tests` → `db push`). *Irreversible schema change to prod — not done by this audit.*
2. **Deploy the `cancel-subscription` Edge Function** — `supabase functions deploy cancel-subscription` (shares `STRIPE_SECRET_KEY` + service role). It **mutates external billing state** (deletes the caller's Stripe customer on account deletion), so enabling it is your call. Until deployed, deletion completes locally exactly as before.
3. **Wire the guardian-consent email sender** — the VPC flow (`guardian-verify`) is inert until an email vendor is connected (`0008:15`, `guardian-verify/index.ts:22`). **Verifiable parental consent for minors is not fully live until this ships.** A new email provider = a new data processor → your decision (and likely a paid dependency).

### Legal / contractual (attorney or counterparty required)
4. **Anthropic DPA** — the policy asserts "not used to train… retained a limited period" (`privacy.html:91`). This matches Anthropic's standard commercial API terms but must be **confirmed against the DPA/commercial terms in force**. The most sensitive egress (meal photos + weight/health history to a US LLM) rides on it.
5. **EU/UK Article 27 representative** — not named; required if you have EU/UK users and no EU establishment. Also consider whether an **Art. 37 DPO** is warranted (large-scale special-category + minors' data leans "yes, or document why not").
6. **Signed DPAs (GDPR Art. 28)** with Supabase, Stripe, Anthropic, Expo.
7. **Legal entity** — operator is "Jihad Woods, doing business as OnStandard" (sole proprietor). Given health data + minors, counsel should advise on an entity/liability structure.
8. **DPIA (GDPR Art. 35)** — large-scale special-category processing of minors' data almost certainly requires a Data Protection Impact Assessment. Recommend commissioning one.

### Judgment calls I deliberately did NOT auto-change
9. **Unknown-age server fail-open** (`0050_minor_consent_enforcement.sql:19-28`): the server minor-gate treats *unknown* age (no `base_age`/`dob`) as **adult** — a **documented, deliberate founder decision** (keying it fail-closed would "sever every existing adult's sync overnight"). The client gate *does* fail-closed on unknown age (`consent.ts:36`), and new signups collect DOB (`0048`). Residual COPPA/GDPR-K risk on legacy/null-DOB rows. **Not overridden** — it would break the live beta and reverse an explicit decision. Revisit when an age-verification vendor lands.
10. **Stale `docs/legal/` drafts** — `docs/legal/public/privacy.html` + `docs/legal/PRIVACY-POLICY.md` still carry `[TODO]`/`[FOUNDER TO CONFIRM]` placeholders and diverge from the finalized **served** copy (`web/landing/privacy.html`, which users actually see and which P4 fixed). I **did not overwrite** them — they're internal working docs with your annotations. Recommend you delete them or sync them to the served version to remove the "accidentally publish the placeholder policy" footgun.
11. **`send-push` (coach→athlete nudges)** intentionally still delivers even when the recipient toggled notifications off — it's relational (gated by `can_view`) and the in-app notification is the durable record. Extending the P7 opt-out to it is a product choice, not a clear legal requirement.

### Residual data-completeness notes (optional hardening)
12. **Erasure residue:** `copilot_artifacts.athlete_id` is `ON DELETE SET NULL` (`0018:35`) — a coach's AI draft *about* a deleted athlete is retained (id nulled; `meta` jsonb may still name them). `analytics_events` is session-keyed (no `user_id`) so account deletion doesn't purge it — now bounded by the P6 180-day retention. Both are defensible; flag for your retention policy.
13. **Secret hygiene (no repo exposure):** no secrets are git-tracked (only `.env.example`; `.gitignore` covers `.env*`, `*.p8/p12/key/pem`, `credentials.json`, `ios-certs/`, `_secrets/`). The Supabase **anon** key is hardcoded in static landing/proto HTML — acceptable by design (RLS-gated) but it pins the prod project ref; rotating it is low-urgency housekeeping.

### Operational
14. **Breach-notification runbook** (GDPR Art. 33/34 + US state laws) and broader **audit/security-event logging** — not code-fixable in a single change; needs a documented incident-response process.
15. **Accessibility (WCAG 2.1 AA) audit** of the app + landing (ADA + EU EAA).

---

## d. VERIFICATION

Run on the `compliance-fixes` HEAD after all fixes, real output:

| Check | Command | Result |
|-------|---------|--------|
| Typecheck | `npx tsc --noEmit` | **exit 0** (clean; run after each code fix) |
| XSS lint | `npm run lint:xss` | **clean** — "every user-data innerHTML interpolation is escaped" |
| Unit/integration tests | `npm test` (jest) | **150 suites, 1833 tests, all passed** (0 failed) |
| iOS bundle | `npm run bundle` (`expo export`) | **exit 0** — produced a 3.9 MB iOS Hermes bundle (`entry-….hbc`) + `metadata.json` to `.aos-export` |

The project's full gate `npm run verify` (= `lint:xss && typecheck && test && bundle`) therefore passes end to end.

Notes:
- Two tests failed on the first run and were **legitimately updated** to the intended new behavior (not silenced): `auth.test.ts` (mocked `db` now includes `updateProfile`, which the consent-receipt writes call) and `account.test.ts` (legal-row copy names the docs; the URLs moved into tappable links). Re-run: green.
- Edge Functions (`supabase/functions/**`) are Deno/`npm:`-import modules excluded from the RN `tsc` project, consistent with every existing function; they are validated by review against the established `billing-portal`/`stripe-webhook` idioms.

---

## Branch note (concurrent committer)
`compliance-fixes` also received unrelated **marketing/landing/skills commits from a second agent** sharing the working tree (`e01af9e`, `6f888ec`, `f557324`, `ac86c6b`). Verified: **none touched any compliance file**, and all seven compliance commits are intact. The compliance work is: `114d634`, `8aeaa56`, `b09fabe`, `ef83163`, `62ceff2`, `38b0cde`, `6108a21`. No git history surgery was performed (the concurrent agent was active).
