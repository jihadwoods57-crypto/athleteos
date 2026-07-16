# OnStandard — Record of Processing Activities (GDPR Article 30)

**Controller:** Jihad Woods, doing business as OnStandard · **Contact:** support@onstandard.app
**Version:** 1.0 (2026-07-15, generated from the codebase during the compliance audit) · **Review:** update whenever a new data category, subprocessor, or purpose is added.

> This register was built from the actual schema (`supabase/migrations/*.sql`), edge functions, and client code — it reflects what the app *does*, not aspirations. Row citations are `file:line`. **[COUNSEL]** should confirm the stated legal bases.

## 1. Controller & roles
- **Controller:** OnStandard (sole proprietor, US/Florida).
- **Data subjects:** athletes (primary, **ages ~13–22 — includes minors**), and the adults who support them (parents/guardians, personal trainers, sports-performance coaches, nutritionists, high-school & college coaches).
- **EU/UK Article 27 representative:** ⛔ not yet appointed (see go-live checklist §4).

## 2. Categories of personal data

| Category | Examples | Where (file:line) | Sensitivity |
|----------|----------|-------------------|-------------|
| Identity & account | name, email, role, account id | `profiles` (`0001_schema.sql:23-25`) | Identifier |
| Athlete profile | sport, position, level, team, org, **age, DOB** | `athlete_profiles` (`0001:122-130`, `0048:9`) | Identifier + minor determinant |
| **Health / fitness (Art. 9 special-category)** | body weight, height, weight goals, macros/nutrition, hydration, sleep/HRV/resting-HR, recovery & check-in answers, accountability scores, PRs, **allergies/dislikes** | `days`/`checkins`/`meals` (`0001:140-181`), `recovery.ts:13`, `athlete_memory_facts` (`0019:16`) | **Special-category** |
| **Meal & label photos** | plate/label images (contain food; may include people/hands) | Storage bucket `meal-photos` (`0003_storage.sql:5`); `meals.photo_path` (`0001:161`) | Special-category-adjacent |
| Photo integrity hash | sha256 of the JPEG (anti-cheat dedup, **not biometric identification**) | `meals.photo_hash` (`0062:27`) | Low |
| Free-text | messages, meal comments, coach notes/feedback, check-in notes, memory facts | `messages`/`meal_comments`/`performance_profiles`/`checkins` | Variable (may embed anything) |
| Relationships | coach/guardian/trainer links, rosters, join codes | `team_members`/`guardianships`/`practice_clients` (`0001:80-115`) | Identifier |
| Guardian consent | guardian email, consent status/token/verified-at | `guardian_consent_requests` (`0008:19-35`) | Identifier + minor |
| Payment / subscription | billing email, plan, status, Stripe customer/subscription ids (**no card data**) | `subscriptions` (`0010:17-30`, `0042:20`) | Financial |
| Device push tokens | Expo push token + platform | `device_tokens` (`0028:9`) | Identifier |
| Consent receipts | ToS accepted-at + version, data-consent-at | `profiles.tos_accepted_at/tos_version/data_consent_at` (`0048`, `0064`) | Accountability record |
| Technical/security | IP address (transient, abuse caps), per-install analytics session id | `ai_usage_key_daily` (`0030:21`), `analytics_events.session_id` (`0052:19`) | Identifier (pseudonymous) |

## 3. Purposes & legal bases

| Purpose | Legal basis (GDPR) — **[COUNSEL] to confirm** |
|---------|-----------|
| Provide the accountability/logging service, sync, roster/coach views | Contract (Art. 6(1)(b)) |
| Process **special-category health data** + share with linked coaches | **Explicit consent (Art. 9(2)(a))** — enforced by the fail-closed consent gate (`consent.ts:51`, server triggers `0050`) |
| AI meal/label analysis (send photo to Anthropic) | Explicit consent (Art. 9(2)(a)) — same gate; disclosed in policy §4 |
| Minors' data (under 18) | **Verified guardian consent** before any server collection (`0050`, `guardian-verify`) |
| Payments / subscriptions | Contract (Art. 6(1)(b)) |
| Abuse prevention / rate limiting (IP) | Legitimate interests (Art. 6(1)(f)) |
| Push notifications / weekly digest | Consent, revocable via the in-app toggle (now honored server-side — `0067`) |
| Product analytics (pseudonymous) | Legitimate interests (Art. 6(1)(f)); no third-party trackers |

## 4. Recipients (subprocessors)

| Recipient | What it receives | Evidence |
|-----------|------------------|----------|
| **Supabase** | Everything (hosting, DB, storage, auth) | throughout |
| **Anthropic (Claude API)** | Meal/label photos, athlete notes, allergies, health-history context | `analyze-meal/index.ts:471`, `deep-analysis`, `meal-chat`, `assist`, `plan-generate` |
| **Stripe** | Billing email, Stripe customer/subscription ids (no card data — hosted checkout) | `billing-checkout/index.ts:137` |
| **Expo push (exp.host)** | Device tokens + notification title/body (may include athlete first names) | `send-push/index.ts:81`, `weekly-digest/index.ts:143` |
| **USDA / Open Food Facts** | Food-search string / barcode (no user identity) | `food-lookup/index.ts` |
| Email provider (guardian/account emails) | Guardian/recipient email + link | ⛔ not yet wired (see checklist §2) |

All disclosed in the served privacy policy §7 (as of audit commit `114d634`). **DPAs to be signed — checklist §3.**

## 5. International transfers
Controller operates from the **United States**; Supabase + Anthropic process in the US. Non-US users' data is transferred to the US. Policy §13 relies on providers' standard contractual protections (SCCs). **[COUNSEL]** confirm the transfer mechanism per subprocessor.

## 6. Retention
- Active-account personal data (meals/days/check-ins/photos): retained while the account is active; **erased on account deletion** — `delete_account()` cascade (`0007`) + Stripe teardown (`cancel-subscription`), completed within **30 days** (policy §11).
- Telemetry (`analytics_events`) + food cache: **180 days** then purged (`0066_data_retention.sql`).
- Consent receipts + guardian-consent records: retained as accountability evidence.

## 7. Security measures
- Row-Level Security on every table; server-side minor-consent triggers (`0050`).
- Auth session tokens in the OS keychain (`secureStorage.ts`); TLS in transit.
- Secrets server-side only (Anthropic/Stripe/service-role keys never in the app bundle); none git-tracked.
- AI-egress consent gate fails closed; PII-safe logging (error-only; analytics PII-filtered server-side).
- Payment card data never touches OnStandard servers (Stripe-hosted, PCI SAQ-A).

## 8. Data-subject rights mechanisms
- **Access/portability:** in-app export → local snapshot + `export_account_data()` server records (`0065`).
- **Erasure:** in-app "Delete account" → `delete_account()` + Stripe teardown; honest failure surfacing.
- **Consent withdrawal:** "Pause all sharing" (`consent.ts:56`); notification opt-out (`0067`); guardians can withdraw consent.
- **Rectification:** profile/onboarding editing in-app.
