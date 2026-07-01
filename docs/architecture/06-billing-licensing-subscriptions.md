# 06 — Enterprise Billing, Licensing & Subscriptions

**Slice owner:** Billing / Licensing / Subscriptions. **Covers:** Deliverables #5 (Billing
Architecture), #6 (Subscription Architecture), #7 (Licensing System), plus Active-Athlete Logic,
College Purchasing, Pricing Configuration, and Billing Tiers. **Status:** target 10-year
architecture + a non-destructive evolution of the inert per-owner seam (`src/core/subscription.ts`,
`migration 0010`). DESIGN ONLY — no app/TS code, no SQL migrations shipped here.
Authored 2026-06-29. Depends on doc `01` (the `organizations` hierarchy + `org_memberships`
contract) and doc `02` (RBAC permission keys). This doc owns *what is purchased, who pays, and
how access is inherited* — never *who may do what* (that is doc 02).

---

## 1. Summary

Billing must be split into **four independent layers that never blur**, so that pricing, plans,
seats, and feature access can each change without redesigning the others: a **Pricing Catalog**
(plans + prices + entitlements, all configurable *data*), a **Subscription** (an org's live
contract with a billing provider), a **License** (the seat/active-athlete capacity a subscription
grants), and **Entitlement Resolution** (the function the app reads to decide what is unlocked for
*this* viewer). The hard rule from the founder — *organizations purchase licenses; users inherit
access; never hardcode subscriptions around athletes; an athlete attached to an active org never
pays separately* — is realized by keying the subscription to `organization_id` (NOT a person) and
resolving every user's entitlement **through their `org_memberships`** (the doc-01 contract). The
existing inert seam is **generalized, not discarded**: `Entitlement`/`isPro()` survive as the
narrow legacy shape; the new resolver `resolveEntitlement(viewer)` is the cross-cutting contract
every gated feature checks (the generalized `isPro()`). Billing is split by rail: **Stripe** for
all B2B (Pro + Program + Enterprise, off-platform, no 30% cut) and **Apple/Google IAP via
RevenueCat** *only* for the consumer **Individual** tier — both writing the same `subscriptions`
shape through a service-role webhook. Active-athlete licensing is metered by a deterministic
**active-athlete definition** computed from `org_memberships.status` + recency, so graduated /
transferred / archived / inactive seats free up automatically with no manual reclaim.

---

## 2. Reconciliation with today

| Tag | Element | Detail |
|---|---|---|
| **[ALREADY BUILT]** | `Entitlement { tier, status, seats?, seatsUsed?, renewsAt? }` + `isPro()` + `entitlementFromRow()` (fail-safe) | `src/core/subscription.ts`. The deterministic gate. KEEP the *shape* and the fail-safe (garbage row → preview); GENERALIZE the resolution (today it reads one owner row; target reads org→license→membership). |
| **[ALREADY BUILT]** | `subscriptions` table — one row per OWNER, `tier/status/seats/seats_used/current_period_end/stripe_*`, service-role-only writes, owner-read RLS | `migration 0010`. The durable webhook-written row. EVOLVE the key from `owner_id` → `organization_id`; everything else (status enum, Stripe linkage, write model) carries forward. |
| **[ALREADY BUILT]** | `AppState.entitlement` (persisted, defaults to preview) + `refreshEntitlement()` gated on `isBackendLive` | `src/core/types.ts`. KEEP; `refreshEntitlement` learns to call the org resolver instead of the owner read. |
| **[ALREADY BUILT]** | `billingRowCopy(e, flow)` — Account "Billing & plan" row, preview byte-identical | `subscription.ts`. EVOLVE to read the resolved entitlement; preview copy unchanged. |
| **[ALREADY BUILT]** | FTC/ARL compliance contract (disclosure, easy-cancel via Billing Portal, no dark patterns, COPPA) | `docs/specs/2026-06-29-subscription-compliance.md`. HONORED verbatim; this doc adds the data model the disclosure component reads its numbers from. |
| **[ALREADY BUILT]** | `organizations` / `org_memberships(organization_id, member_id, role, scope, status)` as the access spine | doc `01`. Billing keys off `organization_id`; active-athlete metering reads `org_memberships.status`. |
| **[EVOLVE]** | `subscriptions.owner_id` (a single coach) → `subscriptions.organization_id` (the org) | The founder's core rule: licensing belongs to the org, not a person. doc 01 §2 already flags this EVOLVE. |
| **[EVOLVE]** | `PlanTier = 'preview' \| 'team'` (binary) → a **plan_code** referencing the Pricing Catalog (`individual`/`professional`/`program_*`/`enterprise`) | The two-value enum cannot express five tiers + custom contracts. Becomes a FK into `plans`. `'team'` maps to `program_*`/`professional`; `'preview'` stays the default. |
| **[EVOLVE]** | `isPro(e)` → `resolveEntitlement(viewer)` + `hasFeature(viewer, key)` | `isPro` becomes one derived convenience over a richer entitlement object; existing call sites keep a passing `isPro()` via a shim. |
| **[NEW]** | Pricing Catalog tables: `plans`, `plan_prices`, `plan_entitlements`, `feature_flags` (all data, no hardcoded $) | The "change price/name/limit/trial/feature without an app build" requirement. |
| **[NEW]** | `licenses` (capacity granted by a subscription: seat model, limit, active count) + `seat_usage` materialized view | Deliverable #7. The seat/active-athlete ledger. |
| **[NEW]** | `active_athlete` definition + `recompute_active_seats()` job | Automatic seat recovery (graduated/transferred/archived/inactive free up). |
| **[NEW]** | `billing_events` (append-only webhook/audit ledger) | Idempotent webhook processing + compliance audit trail. |
| **[NEW]** | `resolveEntitlement(viewer)` pure resolver in `src/core/entitlement.ts` | The generalized `isPro()` — the cross-cutting contract. |
| **[DON'T BUILD YET]** | Enterprise contract engine: usage-based invoicing, PO/ACH/net-30, multi-year ramp deals, custom line items, SSO/SCIM provisioning tied to billing, regional tax/VAT automation, dunning state machine, proration UI | Correct 10-year target for athletic departments. The wedge has **zero paying orgs**. Ship the *catalog as data* + the Stripe per-seat path; model Enterprise as a `plans` row with `pricing_mode='custom'` and a manually-set license — **the schema already supports it without building the contract tooling.** |
| **[DON'T BUILD YET]** | The consumer **Individual** IAP rail (RevenueCat + StoreKit/Play) | The model below reserves it cleanly (rail = data on the plan), but the wedge is B2B-coach-led; building IAP adds App Store review surface before there's a solo-buyer signal. Reserve the seam; populate it when a direct-consumer funnel is proven. |
| **[DON'T BUILD YET]** | In-app seat-purchase / plan-change UI, real-time usage dashboards for admins | The Stripe Billing Portal (hosted) covers manage/cancel/add-seats at launch with zero in-app payment UI. Build the admin usage dashboard only when an org asks. |

---

## 3. The design

### 3.1 The four layers (the rule that prevents a redesign)

```
  PRICING CATALOG   plans · plan_prices · plan_entitlements · feature_flags
  (configurable        "what can be bought, at what price, unlocking what"
   data, no $ in code)  changeable by admins WITHOUT an app build
        │  a subscription references a plan + a price
        ▼
  SUBSCRIPTION      subscriptions  (organization_id, plan_code, price_id, status, provider, stripe/rc ids)
  (the live contract)  "this ORG is paying, on this plan, in this state"
        │  a subscription grants a license (capacity)
        ▼
  LICENSE           licenses  (subscription_id, seat_model, seat_limit, active_count, overage_policy)
  (capacity/seats)     "how many active athletes / client seats this contract covers"
        │  a member consumes a seat by being an ACTIVE athlete in the org
        ▼
  ENTITLEMENT       resolveEntitlement(viewer) → { plan, status, features{}, seat:{used,limit}, source }
  RESOLUTION           "what is unlocked for THIS viewer right now"  ← every gated feature reads this
```

**Why four layers and not one row:** each layer changes on a different clock. Prices change
monthly (marketing). Plans get renamed and re-bundled (product). A subscription's *status* changes
on the billing provider's clock (Stripe webhook). A license's *active count* changes every day
(athletes graduate). Feature access changes per viewer per request. Collapsing these into one
`subscriptions` row — as the inert seam does today — is correct for a single-coach beta but would
force a schema migration every time any one of them moves. **The seam is the bottom two layers
fused; this design un-fuses them.**

> **Cross-cutting contract (the generalized `isPro()`):** every gated feature calls
> **`hasFeature(viewer, featureKey)`**, never a tier string and never `subscriptions` directly.
> `hasFeature` is derived from `resolveEntitlement(viewer)`, which resolves
> **org license → seat consumption → member access → feature flags**. No other doc may invent a
> parallel paywall path. `isPro(e)` survives as `hasFeature(viewer,'pro') || legacy team-tier`.

### 3.2 The Pricing Catalog (pricing is DATA, never hardcoded)

The founder's tier numbers are *seed rows*, not constants. An admin (or an Edge Function backed by
a future admin console) edits these tables; the app reads the resolved entitlement and never
contains a dollar figure, plan name, seat limit, or feature list in code.

```sql
-- PLANS: the catalog of purchasable products. Names/limits are columns, not enums.
create table plans (
  code            text primary key,        -- 'individual' | 'professional' | 'program_starter'
                                            --  | 'program_growth' | 'program_performance' | 'enterprise'
  display_name    text not null,           -- "Individual", "Program License — Growth" (editable)
  audience        text not null check (audience in ('consumer','professional','program','enterprise')),
  seat_model      text not null check (seat_model in ('none','client_seats','active_athletes','unlimited')),
  default_seat_limit int,                   -- 50 (professional), 30/75/150 (program tiers), null=unlimited/custom
  billing_rail    text not null check (billing_rail in ('stripe','iap','manual')),
  pricing_mode    text not null default 'fixed' check (pricing_mode in ('fixed','custom')),
  trial_days      int not null default 0,   -- configurable trial length, NO app build to change
  is_active       bool not null default true,
  sort_order      int not null default 0,
  created_at      timestamptz not null default now()
);

-- PLAN_PRICES: many prices per plan (regional, promo, grandfathered, experiment, seat-tier).
create table plan_prices (
  id               uuid primary key default gen_random_uuid(),
  plan_code        text not null references plans(code),
  provider_price_id text,                   -- Stripe price id / RevenueCat product id
  currency         text not null default 'usd',
  region           text,                    -- null = default; 'eu','uk' for regional pricing
  unit_amount      int not null,            -- minor units (cents). 1499 = $14.99
  interval         text not null default 'month' check (interval in ('month','year')),
  per_seat         bool not null default false, -- professional extra seats price per-seat
  max_active       int,                     -- the active-athlete ceiling THIS price covers (30/75/150)
  promo_code       text,                    -- ties to a promotion
  grandfathered    bool not null default false, -- locked-in legacy price; never auto-migrated
  active_from      timestamptz, active_to timestamptz, -- experiment / promo windows
  is_active        bool not null default true
);

-- PLAN_ENTITLEMENTS: which features a plan unlocks (the feature bundle, as data).
create table plan_entitlements (
  plan_code   text not null references plans(code),
  feature_key text not null references feature_flags(key),
  value       jsonb not null default 'true'::jsonb, -- true | number (limit) | {config}
  primary key (plan_code, feature_key)
);

-- FEATURE_FLAGS: the catalog of gateable capabilities. Adding a gated feature = a row.
create table feature_flags (
  key         text primary key,            -- 'restaurant_coach' | 'team_analytics' | 'sso' | 'api' | 'pro'
  label       text not null,
  description text,
  default_on  bool not null default false  -- on for free preview? (preview = generous beta)
);
```

The founder's proposed tiers seed exactly as data (these are **editable rows**, the doc is not
asserting them as final):

| `plans.code` | display | audience | seat_model | seat_limit | rail | price seed (`plan_prices`) |
|---|---|---|---|---|---|---|
| `individual` | Individual | consumer | none | — | **iap** | $14.99/mo |
| `professional` | Professional | professional | client_seats | 50 | stripe | $124.99/mo + per-seat overage price |
| `program_starter` | Program — Starter | program | active_athletes | 30 | stripe | $249/mo (`max_active=30`) |
| `program_growth` | Program — Growth | program | active_athletes | 75 | stripe | $499/mo (`max_active=75`) |
| `program_performance` | Program — Performance | program | active_athletes | 150 | stripe | $799/mo (`max_active=150`) |
| `enterprise` | Enterprise | enterprise | unlimited | null | manual | `pricing_mode='custom'` (sales-set) |

> **INFERRED — founder confirm:** Program tiers are modeled as **distinct plan codes selected by
> active-athlete band** rather than one `program` plan with a metered price, because the founder's
> numbers are *step pricing* ($249/$499/$799), not linear per-seat. The catalog supports either;
> step-via-plan-code keeps the Stripe products clean and the "you've outgrown Starter → upgrade to
> Growth" prompt obvious. An auto-upgrade when `active_count` crosses `max_active` is §3.5.

### 3.3 Subscription + License (the EVOLVE of `0010`)

```sql
-- EVOLVE of migration 0010: keyed to the ORG, not a person. The webhook still writes; the
-- status enum + Stripe linkage carry forward verbatim; owner_id → organization_id.
create table subscriptions (
  id                     uuid primary key default gen_random_uuid(),
  organization_id        uuid not null references organizations(id) on delete cascade,
  plan_code              text not null references plans(code) default 'preview', -- NEW: catalog FK (preview seeded as a plan)
  price_id               uuid references plan_prices(id),                          -- the locked-in price (grandfathering)
  status                 text not null default 'preview'
                           check (status in ('preview','trialing','active','past_due','canceled')),
  provider               text not null default 'none'
                           check (provider in ('none','stripe','revenuecat')),    -- NEW: which rail
  current_period_end     timestamptz,
  cancel_at_period_end   bool not null default false,
  -- provider linkage (written ONLY by the service-role webhook; carries forward from 0010)
  stripe_customer_id     text,
  stripe_subscription_id text,
  revenuecat_app_user_id text,
  updated_at             timestamptz not null default now(),
  unique (organization_id)                 -- one live subscription per org (multiple = upgrade in place)
);

-- LICENSE: the capacity a subscription grants. Separated from the subscription so capacity can
-- be metered/recomputed daily without touching the billing row.
create table licenses (
  id              uuid primary key default gen_random_uuid(),
  subscription_id uuid not null references subscriptions(id) on delete cascade,
  organization_id uuid not null references organizations(id) on delete cascade,
  seat_model      text not null,           -- copied from plan at issue (active_athletes/client_seats/unlimited)
  seat_limit      int,                     -- the purchased ceiling; null = unlimited (enterprise)
  active_count    int not null default 0,  -- recomputed by recompute_active_seats(); the metered usage
  overage_policy  text not null default 'block'
                    check (overage_policy in ('block','soft_warn','auto_upgrade','bill_overage')),
  issued_at       timestamptz not null default now(),
  unique (organization_id)
);
```

**RLS (preserves 0010's posture):** an org **admin** (`org_memberships.role='admin'`, scoped to
the org, via doc-02 `permission_check(... 'billing.view')`) may `select` their org's subscription
+ license to render the plan. **All writes are `service_role`** (the webhook + the recompute job)
— a user can never grant their org a plan or raise its seat limit. Athletes/coaches see no row;
their entitlement is *resolved*, never read raw.

```sql
alter table subscriptions enable row level security;
create policy subscriptions_read_org_admin on subscriptions for select
  using ( has_billing_view(organization_id) );   -- SECURITY DEFINER over org_memberships (doc 02)
grant select on subscriptions to authenticated;
grant select, insert, update, delete on subscriptions, licenses to service_role;
```

### 3.4 The active-athlete definition (the metering rule)

The founder's rule — *orgs pay only for ACTIVE athletes; graduated/transferred/archived/inactive
free up automatically* — needs one **deterministic, server-authoritative** definition. It lives in
`src/core/license.ts` as a pure predicate (testable offline) AND as the SQL the recompute job runs
(seeded from the same constant, the doc-02 anti-drift discipline).

> **An athlete consumes one active seat in org O iff:**
> 1. they hold an `org_memberships` row with `role='athlete'`, `organization_id=O`, **and**
> 2. `status = 'active'` (NOT `invited`, `suspended`, `left`, `transferred`, `graduated`,
>    `removed` — those statuses already exist in doc 01's lifecycle), **and**
> 3. they have **synced real activity within the inactivity window** — `last_active_at >=
>    now() - INTERVAL <inactivity_days>` (default 60 days, **configurable in `licenses` /
>    org settings, not hardcoded**), where `last_active_at` is the max of the athlete's `days`
>    rows for that org's consumption. Never-synced-yet but recently-invited athletes are **not**
>    billed (a roster of pending invites is free until they log).

```ts
// src/core/license.ts  (NEW, pure — no React/RN/Supabase)
export interface SeatCandidate {
  role: string; status: string; lastActiveAt: string | null; // ISO
}
export interface ActiveAthletePolicy { inactivityDays: number; } // default 60, from license config
export function consumesSeat(c: SeatCandidate, p: ActiveAthletePolicy, now: Date): boolean {
  if (c.role !== 'athlete' || c.status !== 'active') return false;
  if (c.lastActiveAt == null) return false;                       // invited-but-never-synced = free
  return new Date(c.lastActiveAt).getTime() >= now.getTime() - p.inactivityDays * 86400_000;
}
export function activeSeatCount(cs: SeatCandidate[], p: ActiveAthletePolicy, now: Date): number {
  return cs.filter(c => consumesSeat(c, p, now)).length;
}
```

**Automatic seat recovery** is then *emergent*, not a workflow: the instant a membership flips to
`graduated`/`transferred`/`left` (doc 01's lifecycle RPCs) or an athlete crosses the inactivity
window, the next `recompute_active_seats(org)` run lowers `licenses.active_count`. No admin
"reclaim seat" action exists or is needed. This is the Whoop/Stripe move — *usage is computed from
truth, never hand-managed*.

> **INFERRED — founder confirm:** the **inactivity window default = 60 days** and the active
> signal = "has a synced `days` row in that org's stream." For schools with off-seasons this may
> need to be **season-aware** (don't bill a benched athlete mid-summer) — recommend making
> `inactivity_days` an org/program setting and revisiting season-pause as a later Enterprise
> feature, not v1.

### 3.5 Seat-recovery + overage mechanism (real-time usage, License Management #7)

```
recompute_active_seats(org)  -- runs: (a) nightly cron, (b) on every membership lifecycle event,
                             --       (c) on every subscription webhook
  1. active_count := activeSeatCount( select role,status,last_active_at
                                      from org_memberships+days for org )
  2. update licenses set active_count = :n
  3. evaluate overage_policy when active_count > seat_limit:
       'block'        → new athlete activations rejected at the join RPC until upgrade
       'soft_warn'    → activation allowed; admin sees "X over your N-seat plan; upgrade"
       'auto_upgrade' → bump subscription to the next program tier (Starter→Growth→Performance)
                        via Stripe; append billing_event; notify admin
       'bill_overage' → meter the overage to Stripe usage (Professional extra seats)
  4. emit license.usage event (for the admin usage view + the "X of N seats" copy)
```

The License Management verbs (#7) map cleanly:
- **assign** = an athlete's membership becoming `active` (consumes a seat) — no separate assign UI.
- **transfer** = doc 01's `transfer_athlete` (frees a seat in org A, consumes in org B).
- **suspend** = membership `status='suspended'` (frees the seat, keeps the row + history).
- **archive** = `status='left'/'removed'` + doc 02's archive lifecycle (frees the seat).
- **upgrade/downgrade** = change `subscriptions.plan_code` (Stripe Checkout/Portal → webhook).
- **renew** = Stripe auto-renew; webhook updates `current_period_end`.
- **seat management / real-time usage** = `licenses.active_count` + `recompute_active_seats`.
- **automatic seat recovery** = §3.4 emergent behavior.

### 3.6 Entitlement resolution (the path the app reads — generalized `isPro()`)

This is the function that replaces every `isPro(entitlement)` call site. It resolves
**org license → seats → member access → feature flags** and is pure (no Supabase): the data is
fetched at the edge and passed in, exactly like today's `entitlementFromRow`.

```ts
// src/core/entitlement.ts  (NEW, pure — generalizes src/core/subscription.ts)
export interface ResolvedEntitlement {
  planCode: string;                         // 'preview' | 'professional' | 'program_growth' | ...
  status: 'preview'|'trialing'|'active'|'past_due'|'canceled';
  features: Record<string, boolean | number>; // resolved from plan_entitlements (∪ feature defaults)
  seat: { used: number; limit: number | null; model: string };
  source: 'self' | 'org';                   // 'org' = inherited under an org plan (athlete never pays)
}

/** The single gate. Every gated feature calls this — never a tier string. */
export function hasFeature(e: ResolvedEntitlement, key: string): boolean {
  const v = e.features[key];
  if (typeof v === 'number') return v > 0;
  return v === true;
}
/** Back-compat shim so ~970 tests + existing call sites keep passing. */
export function isPro(e: ResolvedEntitlement): boolean {
  return hasFeature(e, 'pro') && (e.status === 'active' || e.status === 'past_due' || e.status === 'trialing');
}
```

**Resolution order (server, gated on `isBackendLive`):**
1. Find the viewer's `org_memberships` (doc 01). For each org they belong to, read that org's
   `subscriptions` + `licenses`.
2. If the viewer is an **athlete/client/guardian** attached to an org with an **active** (or
   trialing/past_due-grace) subscription → entitlement is **inherited** (`source='org'`,
   `features` = the plan's bundle). **The athlete never pays** while attached. (Founder rule.)
3. If the viewer is an **org admin/coach** → same org entitlement, plus billing-management surfaces.
4. If the viewer has **no org plan** but a **self** Individual IAP subscription → `source='self'`.
5. Else → **`previewEntitlement()`** (the existing fail-safe default; byte-identical to today).

The **fail-safe is preserved end to end**: any missing/garbage row, any unresolvable membership →
free preview, never an accidental grant (carries forward `entitlementFromRow`'s contract).

### 3.7 The two billing rails (Stripe B2B vs. IAP consumer)

| | **Stripe rail** (B2B) | **IAP rail** (consumer) |
|---|---|---|
| Plans | `professional`, `program_*`, `enterprise` | `individual` only |
| Who buys | a coach/org admin, off-platform (hosted Checkout / Billing Portal) | a solo athlete/parent, in-app |
| Why | B2B SaaS sold to an org per active-athlete/seat is **not** Apple "consumer digital goods" → no 30% cut; invoicing, PO, per-seat all native to Stripe | a solo consumer buying in-app **must** use StoreKit/Play (Apple/Google policy) |
| SDK | none in-app (hosted URLs); webhook only | RevenueCat (wraps StoreKit/Play) |
| Cancel surface | Stripe Billing Portal (2 taps, compliance §3 satisfied) | OS subscription settings deep-link |
| Writer | service-role Stripe webhook Edge Function | service-role RevenueCat webhook Edge Function |

**Both rails write the same `subscriptions` shape**, differing only in `provider` + which `*_id`
columns are set. The resolver does not care which rail wrote the row — that is the whole point of
the split.

```
Stripe:     coach buys → checkout.session.completed / customer.subscription.{created,updated,deleted}
                       → POST /webhooks/stripe (service_role Edge Fn)
                       → verify signature → idempotent upsert into billing_events
                       → upsert subscriptions(organization_id, plan_code, price_id, status, period_end)
                       → issue/update licenses(seat_limit from plan) → recompute_active_seats(org)

RevenueCat: athlete buys IAP → RC validates receipt → RC webhook → POST /webhooks/revenuecat
                       → map revenuecat_app_user_id → the buyer's personal "org-of-one"
                       → same upsert path (provider='revenuecat')
```

> **INFERRED — founder confirm:** the Individual consumer plan is modeled as a **subscription on a
> private `kind='family'`/personal org-of-one** (doc 01 already makes the family an org), so the
> *same* org→license→resolution path serves both rails and there is **no athlete-keyed
> subscription anywhere** (honoring "never hardcode subscriptions around athletes"). Alternative:
> a nullable `subscriptions.owner_profile_id` for self-buyers. Recommend org-of-one for uniformity
> — one resolution path, no special case.

### 3.8 College / department purchasing (one contract, one implementation)

The doc-01 hierarchy makes this fall out for free with **no billing special-case**:

- **Single team (Football only):** the subscription is on an **organization** that contains one
  **program** (`Football`). `seat_limit` covers that program's active athletes.
- **Whole athletic department (one contract):** the subscription is on the **department
  organization**; its `licenses.seat_limit` (or unlimited, Enterprise) covers **active athletes
  across all programs** (Football + Track + Soccer + ...). `active_count` sums every program's
  active athletes via `org_memberships` scoped to the org. **One subscription row, one license,
  many programs** — billing never iterates teams.

The *only* difference is **where the subscription is attached** in the org tree (one program-org
vs. the department-org) and the `seat_limit`/`pricing_mode`. The same `resolveEntitlement` walks a
member's memberships up to whichever org holds the subscription. This is why billing must key on
`organization_id` and resolve *through* `org_memberships` — it is what lets "buy one team" and "buy
the department" share a single implementation.

> **INFERRED — founder confirm:** when an org has **nested** subscriptions (department-wide +ALSO a
> program that bought its own) — recommend **nearest-ancestor wins** (a member resolves to the
> closest org in their membership chain that holds an active subscription), with the department
> contract as the fallback. Flag for an Enterprise customer; **[DON'T BUILD YET]** until one
> exists.

### 3.9 Billing audit / webhook idempotency

```sql
create table billing_events (              -- append-only; never updated/deleted
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid references organizations(id) on delete set null,
  provider        text not null,
  provider_event_id text unique,           -- Stripe event id / RC event id → IDEMPOTENCY KEY
  kind            text not null,           -- 'subscription.created' | 'payment_failed' | ...
  payload         jsonb not null,
  processed_at    timestamptz not null default now()
);
```

The webhook is **idempotent on `provider_event_id`** (Stripe re-delivers; the unique constraint
makes re-processing a no-op) and gives the compliance audit trail (`docs/specs/...-compliance.md`).
Service-role-only.

### 3.10 Text ER sketch (target)

```
plans 1──< plan_prices                    plans 1──< plan_entitlements >──1 feature_flags
  │  (catalog: name/limit/trial/rail — all DATA, no $ in code)
  ▼
organizations 1──1 subscriptions ──refs──> plans + plan_prices
  │   (per-org contract: plan_code, status, provider, stripe/rc ids)
  │        │ 1──1
  │        ▼
  │      licenses (seat_model, seat_limit, active_count, overage_policy)
  │        ▲
  │        │ active_count := activeSeatCount( org_memberships ⋈ days.last_active )
  ▼
org_memberships (role='athlete', status, organization_id)  ── consumes a seat iff ACTIVE (§3.4)
                                              │
                                              ▼
                              resolveEntitlement(viewer) → hasFeature(viewer, key)   ← every gated feature
subscriptions 1──< billing_events (append-only, idempotent on provider_event_id)
```

---

## 4. RPC / Edge-Function surface (target signatures)

All `SECURITY DEFINER`, `search_path=public`, billing-permission-checked (doc 02), and
service-role for writes. None bypass the consent gate.

- **`POST /webhooks/stripe`** (Edge Fn, service_role) — verify signature → idempotent
  `billing_events` insert → upsert `subscriptions` + `licenses` → `recompute_active_seats(org)`.
- **`POST /webhooks/revenuecat`** (Edge Fn, service_role) — same path, `provider='revenuecat'`,
  resolves the personal org-of-one.
- **`create_billing_portal_session(organization_id) → url`** — admin-only; returns the Stripe
  Billing Portal URL (manage/cancel/add-seats/upgrade). The compliance "Manage plan" row.
- **`create_checkout_session(organization_id, plan_code, price_id) → url`** — admin-only; Stripe
  Checkout for first purchase/upgrade.
- **`recompute_active_seats(organization_id) → int`** — service_role/cron; recomputes
  `licenses.active_count`, applies `overage_policy`, returns active count.
- **`resolve_entitlement(member_id) → jsonb`** — read helper the app calls post-sign-in
  (`refreshEntitlement` evolves to call this); resolves org→license→features.
- **EVOLVE `coach_set_goals`** is unaffected (doc 01/02 own it) — billing never gates plan-setting;
  it gates *feature access*, which is a separate concern.

---

## 5. Migration path (non-destructive, staged)

1. **Phase 0 (now / pre-backend):** the seam is inert and flag-OFF. Author (do not push, per the
   D1 guardrail) the catalog tables + the `subscriptions` EVOLVE as migrations. Seed `plans`/
   `plan_prices`/`feature_flags` with the founder's tier rows + a `preview` plan whose entitlement
   bundle = the generous beta defaults. **`previewEntitlement()` stays the default; every account
   reads "Free preview" byte-identical to today.**
2. **Phase 1 (resolver shim):** introduce `src/core/entitlement.ts` (`resolveEntitlement`,
   `hasFeature`, the `isPro` shim) and `src/core/license.ts`. Re-point the few existing `isPro()`
   call sites at the shim. ~970 tests pass because the preview path is unchanged and the shim
   reproduces `isPro`'s truth table. `subscription.ts` is kept (legacy `Entitlement`/copy) and
   `billingRowCopy` is re-pointed to read the resolved entitlement.
3. **Phase 2 (org-key the subscription):** migrate `subscriptions.owner_id → organization_id`
   (doc 01's `orgs→organizations` is the prerequisite; backfill each owner's row to their org).
   Add `licenses`. Still no payment SDK — webhook is stubbed.
4. **Phase 3 (Stripe go-live):** wire the Stripe products/prices (from `plan_prices.provider_price_id`),
   Checkout + Billing Portal, the webhook Edge Fn, `billing_events`, `recompute_active_seats`.
   Turn on for the first paying org. **[DON'T BUILD YET]** the Individual IAP rail.
5. **Phase 4 (Enterprise + IAP, on demand):** Enterprise = a `plans` row + manually-issued license
   (no contract-tooling build). Add the RevenueCat rail only when a direct-consumer funnel is
   proven.

`src/core` is pure throughout (the resolver/license helpers take fetched data as args, like
`entitlementFromRow` today). Nothing in `src/core` imports Supabase; the fail-safe default is
preserved at every step.

---

## 6. Open decisions for the founder

1. **Program tiers as distinct plan codes vs. one metered plan** (§3.2). Recommend distinct codes
   for the step pricing; confirm.
2. **Inactivity window = 60 days + season-awareness** (§3.4). Confirm the default and whether
   off-season seat-pausing is needed at launch (recommend defer).
3. **Overage default = `block` vs. `auto_upgrade`** for Program tiers crossing `max_active` (§3.5).
   Recommend `soft_warn` at launch (don't surprise-bill or hard-block a coach mid-season).
4. **Individual plan = org-of-one** (§3.7) vs. a nullable self-owner column. Recommend org-of-one
   so no subscription is ever athlete-keyed.
5. **Nested-subscription resolution = nearest-ancestor wins** (§3.8). Confirm; defer until a real
   department customer.
6. **Which features each plan unlocks** (`plan_entitlements` seed). This doc seeds the *mechanism*;
   the exact bundle (what's in Professional vs. Program vs. Enterprise — `team_analytics`, `sso`,
   `api`, `custom_branding`, `priority_support`) is a product/packaging call the founder owns.
7. **Trial length** per plan (`plans.trial_days`, default 0). Confirm; the compliance doc requires
   the trial terms be disclosed once set.

---

## 7. Cross-cutting contract (what every other doc MUST honor)

1. **Every gated feature checks `hasFeature(viewer, featureKey)`** — derived from
   `resolveEntitlement(viewer)`. No doc reads a tier string, a `subscriptions` row, or `plan_code`
   directly to gate a feature. This is the generalized `isPro()`.
2. **Subscriptions key on `organization_id`, never a person.** Athlete/client/guardian entitlement
   is **inherited** by resolving through `org_memberships`; an athlete attached to an active org
   **never pays separately** and is never the subscription's key.
3. **All billing writes are `service_role`** (webhooks + recompute job). A user can never grant a
   plan or raise a seat limit. Admin reads gate on doc-02 `billing.view`.
4. **Pricing is data** — no dollar amount, plan name, seat limit, trial length, or feature bundle
   lives in app/TS code. They live in `plans`/`plan_prices`/`plan_entitlements`/`feature_flags`.
5. **The fail-safe default is `previewEntitlement()`** — any missing/garbage/unresolvable state →
   free preview, never an accidental grant (carries forward `entitlementFromRow`).
6. **The consent gate (`src/core/consent.ts`) sits ABOVE billing** — a paid seat never implies
   data access; consent + RBAC (docs 01/02) gate visibility independently of who pays.
7. **Active-seat metering is computed from truth** (`org_memberships.status` + recency), never
   hand-managed. Seat recovery is emergent from the lifecycle, not a manual reclaim action.
