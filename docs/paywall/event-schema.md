# Paywall Event Schema

**Status (2026-07-21):** client + server code is wired. What remains is founder **ops** — deploying
the two edge functions, applying migration 0102, and setting three env values (see "Founder ops to
go live"). No more code is required to start collecting the funnel.

The paywall research report's strongest structural finding is: *optimize the screen, but judge the
system.* Surface conversion (trial starts) can rise while the money (proceeds, renewals, refunds)
gets worse. To see that, we need the **full funnel** — from the moment the paywall is visible all the
way to renewal and refund — with **exposure logged correctly**. This doc is the map.

Because billing is **go-live gated** (nothing charges yet), the client can only honestly emit the
*surface* events. The *lagging* events (trial→paid, renewal, refund, billing issue) are **store truth**
and must come from Apple/Google server notifications, not the client. Both halves are specified here so
the funnel is complete the day billing turns on.

---

## The funnel

```
                 CLIENT (proto/analytics.js — anonymous, live)          SERVER (store notifications — not yet wired)
 paywall_viewed ──► plan_selected ──► trial_started ──►  [ store checkout ]  ──► trial_converted ──► renewal ──► ...
   (exposure)        (interest)       (intent tap)                              │                     │
                                                                               ├─► refund
                                                                               └─► billing_issue
```

- **paywall_viewed** is the denominator for every screen-level conversion rate. It MUST fire the moment
  the paywall is on screen — if it undercounts, every rate downstream is wrong. (Report: exposure
  tracking is non-negotiable; RevenueCat requires `trackCustomPaywallImpression` for the same reason.)
- **trial_started** is *intent* today (the "Start free" tap). It is NOT proof of a trial — the real
  trial start is the store transaction. Keep them distinct so we never conflate a tap with a purchase.

---

## Client surface events (live now)

Defined in the fixed vocabulary in [`proto/redesign-2026-07/js/analytics.js`](../../proto/redesign-2026-07/js/analytics.js)
and fired from [`js/screens/ob2-athlete.js`](../../proto/redesign-2026-07/js/screens/ob2-athlete.js).
The analytics seam is a **PII firewall by construction**: only known event names survive, and prop
values may only be numbers, booleans, or short enum-shaped strings (`/^[a-z0-9_.:-]{1,24}$/`). A name,
email, or free-text note is structurally impossible to emit. Events are keyed to an **anonymous
per-install session id**, never a user id or email.

| Event | Fires when | Props | Fired from |
|---|---|---|---|
| `paywall_viewed` | the plans screen **or** the "covered by team" screen becomes visible | `{ variant, cadence }` | `plans` step mount; `covered` step mount |
| `plan_selected` | a plan card is tapped | `{ plan, cadence }` | `plans` card click |
| `trial_started` | "Start free — no card today" is tapped (intent; billing go-live gated) | `{ plan, cadence }` | `plans` start button |

Enum values (all enum-shaped, PII-safe):
- `variant`: `individual` · `team_covered` · `trainer_covered` · `org` · `pro` · `free` · `seat`
- `plan`: `individual` · `individual_plus` · (pro/org ids when those flows are wired)
- `cadence`: `annual` · `monthly`

Existing adjacent events already in the vocabulary: `onboarding_completed {role}` (account created),
`code_join_failed`, `coach_connected {kind}`. The paywall events slot into that same funnel.

---

## Server lagging events — WIRED via `revenuecat-webhook`

These are **store truth** and cannot be trusted from the client (the client can't see a renewal, a
refund, a cross-device restore, or a billing failure). Rather than integrate Apple's App Store Server
Notifications V2 and Google Play RTDN separately, we take them **through RevenueCat**, which the app
already chose as its consumer-IAP aggregator (`src/lib/billing/portal.ts`, `_shared/plans.ts`). One
normalized webhook covers both stores.

- Function: [`supabase/functions/revenuecat-webhook/index.ts`](../../supabase/functions/revenuecat-webhook/index.ts)
  (mirrors `stripe-webhook`'s safety model: shared-secret auth, inert-503 until configured, service-role
  is the only writer, 500-on-DB-error so events retry).
- Mapping (unit-tested): [`supabase/functions/_shared/revenuecat.ts`](../../supabase/functions/_shared/revenuecat.ts).
- Storage: the `subscriptions` table, extended for the consumer rail by migration **0102**
  (`tier='consumer'`, `rc_app_user_id`, `store`, `store_product_id`).
- Entitlement: [`src/core/subscription.ts`](../../src/core/subscription.ts) now recognizes the `consumer`
  tier (`isPro`, `hasFeature`, `planLabel`, `billingRowCopy`), so a paid consumer row grants access.

| RevenueCat event | Row effect | Why it matters |
|---|---|---|
| `INITIAL_PURCHASE` / `RENEWAL` / `PRODUCT_CHANGE` / `UNCANCELLATION` | `active` | the real conversion + renewals (Renewal 1 is the key retention checkpoint) |
| `CANCELLATION` | `active` + `cancel_at_period_end` | auto-renew off; access to expiry — the moment to offer a save |
| `BILLING_ISSUE` | `past_due` + `payment_failed_at` | involuntary churn (recoverable) — drives the "update your card" banner |
| `SUBSCRIPTION_PAUSED` | `paused` | paused, no paid access, nothing deleted |
| `EXPIRATION` | `canceled`, tier → `preview` | the real end / refund landing |

These rows are keyed to the **billing account** (`owner_id` = profile UUID; the client sets the RevenueCat
App User ID to that UUID), NOT the anonymous client session — they live server-side and never flow through
the client PII firewall. Joining them to the client funnel is done on an anonymized cohort key, not identity.

---

## KPI dashboard (what to actually judge)

Straight from the report — the screen-level metrics are the top rows; the ones that decide whether a
variant *made money* are the bottom rows. Never ship a paywall test on the top rows alone.

| KPI | Definition | Built from |
|---|---|---|
| Paywall view rate | `paywall_viewed` / eligible users | client |
| Paywall→trial | `trial_started` / `paywall_viewed` | client (exposure-correct denominator) |
| Trial→paid | `trial_converted` / trial starts | **server** |
| Proceeds per user | net proceeds over a cohort / cohort size | server |
| RLTV (D30/D60/Y1) | cumulative cohort revenue over horizon | server |
| Refund rate | `refund` / transactions | server |
| Renewal 1 | first-renewal success rate | server |
| 6-mo / Y1 retention | active subscribers retained at horizon | server |
| Reactivation | churned who return within a year | server |

Health & Fitness benchmarks to sanity-check against (report): median trial→paid **37.7%**, month-1
RLTV **$24.23**, year-1 RLTV **$35.64**, annual plans **60.6%** of category revenue — which is exactly
why the annual anchor (now 30% off) leads the screen.

---

## Founder ops to go live (no code left — just deploy + config)

**A. Analytics sink** (client injection + function already exist; server whitelist synced 2026-07-21):
1. `supabase functions deploy analytics-ingest`
2. Set `EXPO_PUBLIC_ANALYTICS_URL` to that function's URL and ship an app build. Until set, the client
   buffers locally and sends nothing (guardrail). That's the whole sink.

**B. RevenueCat lagging-events webhook:**
1. Apply migration `0102_consumer_iap_subscriptions.sql` to the live project (per the 0010/0102 guardrail,
   the crew never applies it — the founder does at consumer go-live).
2. `supabase secrets set REVENUECAT_WEBHOOK_SECRET=<long random string>` then
   `supabase functions deploy revenuecat-webhook --no-verify-jwt`. Inert (503) until the secret is set.
3. In RevenueCat → Integrations → Webhooks: URL = `<project>/functions/v1/revenuecat-webhook`, and set the
   **Authorization** header value to the same secret.
4. Create the store products (App Store Connect / Play Console) and map them in RevenueCat. Name them to
   match `CONSUMER_PRODUCTS` in `_shared/revenuecat.ts` (e.g. `onstandard_individual_annual`) — or any name
   containing the plan id, which the loose matcher resolves.
5. **Store-launch native piece (separate):** the client must set the RevenueCat App User ID to the profile
   UUID and present the purchase via the IAP SDK (`react-native-purchases`). Until that ships, the webhook
   receives nothing because no purchases occur — but it's ready the moment they do.

**Checkout rail:** keep native (StoreKit / Play Billing) — the report's Dipsea case earned only **$0.93
per $1.00** when checkout moved to web. Treat web billing as a tested exception, not a default.

## A/B tests this schema unblocks (in the report's priority order)

Once the sink + webhook are live: (1) annual anchor depth, (2) social-proof placement, (3) trial length
(7 vs 14 days — judge on trial→paid + Renewal 1, not trial starts), (4) contextual copy from onboarding
answers. All four are already instrumented by the events above except the server lagging half.
