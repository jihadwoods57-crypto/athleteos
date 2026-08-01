# Launch pricing — the catalog of record

> **Rewritten 2026-07-30.** This document was stale on 6 of 9 plans while `src/core/pricing.ts`
> cited it as its own source — Solo $69, Professional $124.99, a $3 overage, no Family plan, and
> a 17% consumer annual rule, none true since the 2026-07-04 cost sweep. It now states the
> shipped catalog. **`src/core/pricing.ts` is the machine truth**; this file explains it. If
> they disagree, fix whichever is wrong *and* the parity test that let it drift
> (`src/core/obPlanPricingParity.test.ts`).

## The model in one paragraph

The people who profit pay; the people who sweat don't. Athletes and clients are $0 on a roster.
Professionals and organizations pay per **active athlete** — someone who logged at least 5 real
days that month — with a block included in the plan and **$10/month per active athlete beyond
it** on Solo/Professional, **$15/month** on every organization (gym) tier. Idle seats are free: a kid who quits stops counting, which is both
the honest pitch and the alignment of revenue with our real AI cost (only active athletes burn
paid meal reads). Consumer plans are the moat, not the business: the free-with-roster record is
the coach's switching cost, and Individual Plus is the "your record stays yours" continuation
when a roster ends.

## Consumer (Apple/Google IAP · 7-day trial · annual = 30% off)

| Plan | Monthly | Annual | Effective /mo | Who it's for |
|---|---|---|---|---|
| Individual | $14.99 | $126 | $10.50 | History, score, AI coach, one supporter |
| Individual Plus | $24.99 | $210 | $17.50 | Portable record + recruiting card |
| Family | $39.99 | $336 | $28.00 | Up to 4 athletes, one bill, parent dashboards |

## Professional & organization (Stripe · 14-day trial · annual = 2 months free · $10/mo overage on Solo/Professional, $15/mo on organization tiers)

| Plan | Monthly | Annual | Active athletes included |
|---|---|---|---|
| Solo | $99 | $990 | 25 |
| Professional | $179 | $1,790 | 50 |
| Starter | $249 | $2,490 | 30 |
| Growth | $499 | $4,990 | 75 |
| Performance | $799 | $7,990 | 150 |
| Enterprise | Custom | Custom | Custom (no self-serve trial) |

**Active athlete** = logged ≥ 5 qualifying days in the calendar month (`active_athlete_count`,
migration 0163; a day qualifies only if something was actually logged). Overage bills **in
arrears** as one monthly invoice line via `billing-overage-report` (0164) — a single code path
for monthly and annual buyers, founding members at their locked rate.

## Founding 50

**Today's price, locked permanently** — including the overage rate. The standard 14-day trial,
nothing more: founding members pay like everyone else, they just never pay *more* than they do on
the day they join.

Deliberately a lock, never a discount: 50% off puts the pro tiers under the per-seat AI cost
floor (that offer was retired 2026-07-23; see `web/landing-src/fix-founding.py`). The **"free
through the beta"** clause was retired the same way on **2026-07-30**
(`web/landing-src/fix-founding-free.py`) — free is the 50%-off problem made worse, since the
fifty most engaged rosters would have been the fifty largest losses, and it was never implemented
in any case: `founding_members.billing_starts_at` (0161) is vestigial, written and read by
nothing. Slots claim
automatically on a completed first checkout (`stripe-webhook` → `claim_founding_slot`; capped,
idempotent). The remaining count is public via `founding_slots_left()`.

## Economics guardrails (why these numbers)

- Measured AI cost: **~$0.0204 per meal read** on sonnet-5 intro pricing; the 0105 price table
  reverts to list (+50%) on **2026-09-01** automatically. ~120 meals/month ≈ $2.45 → $3.67 per
  heavy athlete.
- Every included-seat price clears that ceiling, and overage runs **~3–4x heavy-seat cost on
  Solo/Professional ($10) and ~4–6x on organization tiers ($15)** — growth past the block is
  margin, not loss, which is what makes net revenue retention able to exceed 100%.
- The cheap-first read router (`ANTHROPIC_MODEL_ANALYZE_FIRST` on analyze-meal) can roughly
  cancel the September increase — enable only after an eval replay shows quality holds.
- Sponsor seats default **$60/seat-year** (`SPONSOR_SEAT_PRICE_CENTS=6000`): a real community
  discount (~52% off Individual annual), not the $20 accident that undercut the paywall 6x.

## Change control

Prices live in Stripe (lookup_keys `<plan_id>_<cadence>`, generation-suffixed on a rise) and in
the store products for IAP. A price rise = new generation of Stripe Prices + `PRICE_GENERATION`
bump; founding members keep resolving to their locked generation (0161). Willingness-to-pay for
the *next* generation comes from the Founding 50 onboarding conversations — ask each: "at what
price is this a no-brainer?" and "at what price would you not even consider it?"
