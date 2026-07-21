# Paywall Event Schema

**Status:** client surface events wired (2026-07-21); server-side lagging events and the sink are not yet live.
**Owner:** founder decision needed on the sink URL + the store-notification webhook (see "Not yet wired").

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

## Server lagging events (NOT yet wired — the important half)

These are **store truth** and cannot be trusted from the client (the client can't see a renewal, a
refund, a cross-device restore, or a billing failure). They must be captured from:

- **iOS:** App Store Server Notifications V2 → a webhook → a `subscriptions` table. Reconcile with the
  App Store Server API. Relevant notification types: `SUBSCRIBED` / `DID_RENEW` / `EXPIRED` /
  `DID_FAIL_TO_RENEW` (→ billing issue) / `REFUND` / `GRACE_PERIOD_EXPIRED`.
- **Android:** Google Play Real-time Developer Notifications (RTDN) via Pub/Sub → the same webhook →
  call the Play Developer API for the full purchase state. Relevant: `SUBSCRIPTION_PURCHASED`,
  `SUBSCRIPTION_RENEWED`, `SUBSCRIPTION_CANCELED`, `SUBSCRIPTION_ON_HOLD`, refund voided notifications.

| Logical event | Source | Why it matters |
|---|---|---|
| `trial_converted` | first paid transaction after trial | the real conversion, vs the `trial_started` tap |
| `renewal` (Renewal 1, N) | `DID_RENEW` / `SUBSCRIPTION_RENEWED` | Renewal 1 is the single most important early retention checkpoint |
| `refund` | `REFUND` / refund notification | guards against misleading "wins" and pricing mismatch |
| `billing_issue` | `DID_FAIL_TO_RENEW` / `ON_HOLD` | involuntary churn — recoverable, so worth its own signal |
| `reactivation` | resubscribe after lapse | matters for episodic/seasonal use (an athlete between seasons) |

These are keyed to the **billing account**, not the anonymous client session — they live server-side and
never flow through the client PII firewall. Joining them to the client funnel is done on an anonymized
cohort key, not on identity.

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

## Not yet wired (founder decisions)

1. **Sink URL.** The client seam is **inert by default** — events buffer locally and nothing leaves the
   device until `window.__ANALYTICS_SINK = { url }` is injected by the native shell (mirrors
   `__SUPABASE`). Decision: point it at a Supabase edge function / table, or a product-analytics vendor
   (Amplitude/Firebase). Until then the funnel is measurable only on-device.
2. **Store-notification webhook.** Stand up the App Store Server Notifications V2 + Play RTDN endpoint
   and the `subscriptions` table before billing go-live, or the entire bottom half of the dashboard is
   blind. This is the gating dependency for judging any paywall A/B test on revenue quality.
3. **Checkout rail.** Keep native (StoreKit / Play Billing). The report's Dipsea case earned only
   **$0.93 per $1.00** when checkout moved to web — treat web billing as a tested exception, not a default.

## A/B tests this schema unblocks (in the report's priority order)

Once the sink + webhook are live: (1) annual anchor depth, (2) social-proof placement, (3) trial length
(7 vs 14 days — judge on trial→paid + Renewal 1, not trial starts), (4) contextual copy from onboarding
answers. All four are already instrumented by the events above except the server lagging half.
