# OnStandard Business Model

*Original: Bo Woods, 2026-07-05. **Rewritten 2026-09-15** against measured reality.*

> **Why this was rewritten.** The first version was written on 2026-07-05, before the product
> shipped. It was a good hypothesis document, and it was being read as a facts document. Every
> number in it was a forecast, and the scorecard in §6 marked five targets with a green tick
> against a business that had not yet taken a dollar.
>
> Nothing here deletes that thinking. What changed is that there is now evidence, and the doc has
> to separate three things it used to blend: what is **measured**, what is **decided**, and what
> is still **assumed**. The original is in git history at `docs/founding/BUSINESS_MODEL.md`
> before commit of this file.

---

## 0. Ground truth, measured 2026-09-15

Read from production and from App Store Connect, not from memory or from a planning doc.

| | Measured | Source |
|---|---|---|
| Revenue, all time | **$0** | `subscriptions`, `payments`, `offer_payments` all empty |
| Paying customers, all time | **0** | same |
| Profiles | 59, of which roughly **6 look real** | `profiles`; the rest are test and demo accounts |
| Profiles touched in the last 7 days | **1** | `profiles.updated_at` |
| Weekly meal-logging athletes, peak | **6**, week of 2026-08-17 | `meals` grouped by week |
| Weekly meal-logging athletes, now | **1** | same |
| Meals logged, all time | 100 | `meals` |
| Day rows, all time | 46 | `days` |
| Teams | 20, every one seeded demo data; largest roster **2** | `teams`, `team_members` |
| App Store | version 1.0 **WAITING_FOR_REVIEW** | ASC `/v1/apps/.../appStoreVersions` |
| In-app purchase products | **0** | ASC `inAppPurchasesV2` |
| Subscription groups | **0** | ASC `subscriptionGroups` |
| Stripe | built, sandbox-verified, **live key switch not thrown** | `.env`, and the go-live runbook |
| Entitlement enforcement | client-side only; **RLS does not consult `book_access`** | migration 0223 and its memory note |
| Academics pillar | **does not exist in the app**, 0 files | grep over `proto/` and `src/core` |
| AI cost per seat | **not measured**; `ai_usage_daily` counts calls, carries no cost column | schema |

**The one-line read:** the product is built and good, nobody is using it, and it cannot be bought
on either rail today. The constraint is commercial, not technical.

---

## 1. What is still true and worth keeping

The original doc's best work survives contact with the evidence. Keep all of this.

- **The reframe.** OnStandard is an athlete execution platform, not a nutrition app. It answers
  "is this athlete executing the plan?" for everyone around the athlete. That is a genuinely
  differentiated position against calorie trackers, and the product delivers it.
- **One engine, N pillars.** The pillar-registry architecture is the right bet and it is real in
  the code: requirements, standards, the score engine and the commitment primitive are already
  generic. A second pillar is a parser and a config, not a second product.
- **Execution layer, not system of record.** Staying out of LMS/SIS integration, FERPA and
  official grades is correct and keeps the product solo-buildable.
- **The org tier is the right anchor.** Per-seat on Stripe, one sale covering a 30 to 150 athlete
  roster, is the only rail where the arithmetic reaches a serious number with an account count one
  person could survive. See §4.
- **Consumer as byproduct, not anchor.** The 30% store cut, teen churn and paid CAC all argue
  against anchoring there. Still right.
- **The coach-to-roster loop is the real asset.** One coach brings forty-five athletes at no
  acquisition cost. Very little vertical SaaS has that. Protect it above any feature.

---

## 2. What the evidence falsified or left untested

Not failures. A hypothesis doc did its job by being checkable.

| Claim in the original | Status now |
|---|---|
| "Nutrition (pillar #1, live) + Academics (pillar #2). Ship now: the co-wedge." | **Falsified.** Academics has zero lines in the app. The product is one pillar. |
| Gross margin 85 to 90% | **Unmeasurable.** AI cost per seat is not instrumented, and there are no seats. |
| Monthly churn under 3% | **Untested.** No customer has ever renewed or cancelled. |
| LTV:CAC 15 to 25:1 | **Untested.** Both terms are zero. |
| Payback under one month | **Untested.** |
| "Club/academy is the cleanest org payer" | **Untested.** Zero club accounts exist. |
| Consumer inherited from org rosters at ~$0 CAC | **Blocked.** There is no org roster to inherit from, and no store product to convert into. |
| "Warm intros drive CAC toward zero" | **One data point, and it is sobering.** The UCF linebacker pilot came from exactly this advantage and produced six weekly active athletes at peak, zero revenue, and one active athlete today. The channel may still be right; it has not yet been shown to convert. |

The scorecard in the original §6 should be read as a set of **hypotheses to test**, not results
achieved. Every green tick in it was a forecast.

---

## 3. The open ruling that governs everything else

The original's north star is **profitable solo business, minimal team, no raise**. Every downstream
choice follows from it: low account count, high dollars per account, organic channel only, no
hires, no paid acquisition.

On 2026-09-15 the owner asked what it would take to make this a $100M company. **Those are two
different businesses.** The solo constraint is not a preference that can coexist with that goal; it
is the thing that makes it arithmetically impossible, because the account counts in §4 require a
sales organization and a support organization.

**This is an open founder ruling.** Nothing below resolves it, and the two answers lead to
different products, different prices and different hiring.

| | Solo-profitable | Scale |
|---|---|---|
| Target | $1M to $3M ARR, most of it take-home | $12M ARR for a $100M valuation |
| Accounts | 250 to 750 | roughly 3,000 |
| Price point | today's catalog | department contracts, 10x the ACV |
| Team | one person | sales, support, engineering |
| Capital | none | a raise |
| Timeline | 3 to 5 years | 7 to 10 years |

Everything in §7 is identical under both answers for at least the next two quarters, so the ruling
is not urgent. It is, however, the most consequential decision in this document.

---

## 4. The arithmetic, at the real price catalog

Prices are `src/core/pricing.ts`, the source of truth, as of 2026-09-08.

| Plan | Buyer | Rail | Annual | Seats | Per athlete / yr |
|---|---|---|---|---|---|
| Individual | athlete | IAP | $84 | 1 | $84 |
| Individual Plus | athlete | IAP | $126 | 1 | $126 |
| Family | household | IAP | $156 | 4 | $39 |
| Solo | trainer / RD | Stripe | $990 | 25 | $40 |
| Professional | trainer / RD | Stripe | $1,790 | 50 | $36 |
| Starter | org | Stripe | $2,490 | 30 | $83 |
| Growth | org | Stripe | $4,990 | 75 | $67 |
| Performance | org | Stripe | $7,990 | 150 | $53 |
| Enterprise | org | Stripe | custom | 150+ | |

Average org account, blended across the three self-serve bands: call it **$4,000 a year**.

**What each revenue target costs in accounts:**

| Target | Org accounts at $4k | Or consumer subs at $84 |
|---|---|---|
| $1M ARR | 250 | 11,900 |
| $12M ARR (a $100M valuation) | 3,000 | 143,000 |
| $100M ARR | 25,000 | 1.2M |

There are on the order of 50,000 to 100,000 US club and academy programs of meaningful size.
**25,000 accounts is a quarter to a half of the entire addressable market**, which no vertical SaaS
achieves. So $100M ARR is not reachable at this price catalog, by this model, at any execution
quality.

$100M ARR becomes arithmetically possible only if ACV rises roughly ten times, which means selling
an athletic department rather than a coach: every sport, every athlete, multiple pillars, $50k to
$150k a contract. That is the Teamworks shape. Note that the whole NCAA at $75k average is $82M, so
even that path requires college plus professional plus international plus large school districts.

$12M ARR at 3,000 accounts is three to six percent of the market. That is hard and ordinary, which
is what makes it a real target.

---

## 5. Why nothing can be bought today

Two independent blockers, both small relative to what has already been built.

**Consumer rail.** Apple requires in-app purchase for digital subscriptions sold in the app. There
are zero IAP products and zero subscription groups configured. The version sitting in review cannot
sell anything even if it is approved tomorrow. The product sheet to create them from is
`docs/go-live/CONSUMER-IAP.md`.

**Org rail.** Checkout, webhooks, the overage ledger, Connect and the entitlement predicate are all
built and were verified end to end in the Stripe sandbox. Two things remain: the live key has never
been switched on, and `book_access` is enforced client-side only, so a modified client writes for
free. The second needs the RLS suite, which needs Docker.

Until both are closed, every hour spent on features is unpaid by construction.

---

## 6. Economics, honestly labelled

- **Measured:** nothing. No customer, no renewal, no cancellation, no cost per seat.
- **Decided:** the price catalog, the tier stack, the rails, the trial length (14 days, both rails).
- **Assumed:** margin, churn, CAC, LTV, payback, and that a club will pay $2,490.

The single cheapest thing that converts an assumption into a measurement is **instrumenting AI cost
per seat**. `ai_usage_daily` counts calls today and carries no cost column, so the 85 to 90% gross
margin claim rests on a number nobody can see. That should be fixed before the first ten accounts,
not after, because it is the input to every pricing decision that follows.

---

## 7. What to do next, and it is the same under either ruling

1. **Make one thing purchasable.** Throw the Stripe live switch and enforce `book_access` in RLS.
   Days of work. Everything else is unpaid until this is done.
2. **Create the store products** so the consumer rail exists at all, even though it stays a
   byproduct. A subscription group and the ladder in `CONSUMER-IAP.md`.
3. **Instrument AI cost per seat.** One column and a write. It turns the margin claim into a fact.
4. **Sell ten programs at list price.** Not one, because one is an anecdote. Ten tells you whether
   $2,490 holds, what the objection is, and how long the cycle runs. This is the only activity in
   this list that produces information nothing else can.
5. **Then, and only then, revisit §3.** The first ten customers will change what you believe about
   the buyer, the price and the product. Making the solo-versus-scale ruling before that is
   deciding with less information than you will have in ninety days.

What is deliberately **not** on this list: new audiences, new pillars, and new surfaces. Adding an
audience to a product with one active user multiplies zero, and the original doc's own discipline
(dollars per account, not account count) argues against breadth anyway.

---

## 8. What this asks of the product

Unchanged from the original where it still holds, trimmed where it does not.

1. Keep the one-engine, N-pillar architecture. It is the reason a second pillar is affordable, and
   it is what justifies a department-sized price later.
2. Build toward institutional expansion rather than consumer breadth: multi-team rollups, staff
   roles with real permissions, department views. The iPad work of 2026-09-15 started this.
3. Academics remains the right second pillar and the right expansion revenue. It is not built. It
   should follow the first ten paying accounts, not precede them.
4. Org self-serve checkout with monthly and annual, annual incentivised, as already priced.
5. Protect the coach-to-roster loop above any individual feature. It is the durable advantage.

---

*Living document. The next rewrite should be triggered by the first paying account, and it should
move rows out of "assumed" in §6 into "measured" in §0.*
