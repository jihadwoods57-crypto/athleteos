# OnStandard — Recommended Launch Pricing (the catalog seed)

**Date:** 2026-06-29 · **From:** the crew (the founder asked us to pick) · **Status:** RECOMMENDED
**This is data, not code** — every number here is a row in the pricing catalog and can change any
time (price tests, promos, regional pricing, grandfathering) with no app release. These are the
*opening* numbers, set per the ratified strategy (`STRATEGIC-DECISIONS.md` #3) and the per-active
economics in `03_PRICING_AND_GTM.md`. Built to be the seed the checkout screen reads.

## The recommended catalog

### Consumer (a person on their own)
| Plan | Monthly | Annual (~2 mo free) | Free trial | Who / what it's for |
|---|---|---|---|---|
| **Individual** | **$14.99** | **$149/yr** | **7 days** | The "just graduated / on my own — keep my history" continuity plan. Core loop + AI coach + meal analysis + game plan + score. |
| **Individual Plus** | **$24.99** | **$249/yr** | **7 days** | Adds the full *portable* multi-org history + a shareable scholarship/recruiting card. Prices the irreplaceable record like the moat it is. |

### Professional (personal trainers, nutritionists)
| Plan | Monthly | Annual | Free trial | Limits |
|---|---|---|---|---|
| **Solo** | **$69** | **$690/yr** | **14 days** | Up to **25** active clients. The real entry point for the small trainer. |
| **Professional** | **$124.99** | **$1,249/yr** | **14 days** | Up to **50** active clients. Extra active clients beyond 50: **$3 / active client / mo.** |

### Organization & Gym (priced by ACTIVE participants — graduated/transferred/inactive seats free up automatically)
| Plan | Monthly | Annual | Free trial | Active participants |
|---|---|---|---|---|
| **Starter** | **$249** | **$2,490/yr** | **14 days** | up to **30** |
| **Growth** | **$499** | **$4,990/yr** | **14 days** | up to **75** |
| **Performance** | **$799** | **$7,990/yr** | **14 days** | up to **150** |
| **Enterprise** | **Custom** | Custom | white-glove | 150+, multi-location, full athletic departments, SSO/API |

Gyms use these org tiers (a gym is an organization), priced by **active OnStandard participants**,
not total gym membership.

## The rules of thumb behind the numbers
- **Per active athlete:** Starter $8.30 · Growth $6.65 · Performance $5.33 — it gets cheaper per head
  as the org grows (a built-in reason to expand). Trainers are higher-touch / fewer clients, so Solo
  ($2.76/client) and Professional ($2.50/client) sit lower per head but higher per *plan*.
- **Annual = pay for 10 months, get 12** (~17% off) — the standard lever to pull cash forward and cut
  churn. Monthly is the default at launch; annual is the upsell.
- **Free trial: 14 days for trainers/orgs** (long enough for a coach to see a roster signal), **7 days
  for consumers** (fast, low-friction at the hand-off).
- **Land low on the org tiers on purpose.** Keep them where they are for the land phase; once we can
  *prove* the retention/ROI we deliver, the catalog lets us raise the anchor later — with existing
  customers grandfathered.

## What still needs a human (not us)
- **Final blessing on the numbers** — these are the recommendation; change any before we seed them.
- **Stripe** set up with these as products/prices (founder, at go-live).
- The numbers are enough to **build the checkout + cancellation screen now** (the compliant flow that
  shows price, "renews monthly," trial length, and an easy cancel) — queued as Task #6.

## Promotions to keep in our back pocket (data, build later)
Founding-gym charter pricing, annual-prepay discount, a "bring your team" referral credit, and an
education/non-profit rate — all just catalog rows when we want them.
