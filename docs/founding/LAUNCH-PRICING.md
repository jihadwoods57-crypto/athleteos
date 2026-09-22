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
the coach's switching cost, and Individual is the "your record stays yours" continuation when a
roster ends.

## Consumer (Apple/Google IAP · 14-day trial · annual = an App Store price point)

**Re-mapped 2026-09-21** on measured AI cost (founder ruling; design in
`docs/superpowers/specs/2026-09-21-subscription-remap-design.md` §7).

| Plan | Monthly | Annual | Effective /mo | Who it's for |
|---|---|---|---|---|
| Individual | $19.99 | $199.99 | $16.67 | Score, AI coach, full history, unlimited supporters, recruiting card |
| Family | $24.99 | $249.99 | $20.83 | Up to 4 athletes, one bill, parent dashboards |

Three things changed at once, and each depends on the others:

- **Individual $9.99 → $19.99.** The old price was set "for capture, not ARPU" against an AI cost
  nobody had measured. It has been measured: **$3.61 per athlete per month** (`ai_call_costs`,
  Sept), and that is the figure for a *free-shaped* athlete — the three premium AI functions a
  subscriber unlocks have never been invoked by anyone, so the paying-athlete cost is still
  unknown and can only be higher. At $9.99 the plan netted $6.99 after Apple and cleared the
  measured floor by three dollars. $19.99 nets $13.99 and contributes $10.38 (52%).
- **Family $18.99 → $24.99.** Family must move whenever Individual moves or the 2× trap reopens:
  against a $9.99 Individual it saved a two-athlete household $0.99 a month. It now saves $14.99.
  `src/core/pricing.test.ts` asserts the comparison so the trap cannot reopen silently a third
  time.
- **Individual Plus is retired.** It sold the recruiting card and the portable record for $5 more,
  and `has_premium_access()` never read `tier` — every paid athlete already had both. Those facts
  are now part of the Individual description, which is where they always belonged. The products
  `onstandard_individual_plus_monthly` / `_annual` stop existing; a webhook event still naming one
  resolves to plan `individual`.

**Annual is not a percentage on this rail.** $199.99 and $249.99 are real App Store price points;
the ~17% they work out to is an output, not a rule. The old "30% off" line could not survive the
ladder — Apple sells no $167.93 — and the store's price is what the card is charged. Pro/org keep
two months free, below.

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
  discount — ~70% off Individual annual since the 2026-09-21 re-map, which is deeper than the
  ~52% it was set to be. Not re-derived here: sponsor pricing was out of scope of that ruling and
  is a founder call, flagged rather than quietly moved.

## Change control

Prices live in Stripe (lookup_keys `<plan_id>_<cadence>`, generation-suffixed on a rise) and in
the store products for IAP. A price rise = new generation of Stripe Prices + `PRICE_GENERATION`
bump; founding members keep resolving to their locked generation (0161). Willingness-to-pay for
the *next* generation comes from the Founding 50 onboarding conversations — ask each: "at what
price is this a no-brainer?" and "at what price would you not even consider it?"
