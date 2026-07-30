# Subscription model v2 — go-live

Built 2026-07-30 on `feat/premium-polish`, following the full subscription review. Everything is
**authored and verified against local Postgres, not yet live**. This doc is the exact order of
operations and every knob.

## What changed, in one screen

| Weakness found | Fix shipped |
|---|---|
| No expansion revenue — a coach's bill could never grow | $10/mo **overage on every Stripe tier**, billed monthly in arrears (0164 + `billing-overage-report`) |
| Billing metric (roster size) opposed the cost metric (usage) | Billing counts **active athletes** — logged ≥5 real days/month; idle seats free (0163) |
| "14-day free trial" promised everywhere, implemented nowhere | `billing-checkout` sends `trial_period_days` (default 14, one per customer) |
| Founding 50 unclaimable — the ledger had no callers | Auto-claim on first completed checkout; `founding_slots_left()` feeds the paywall |
| `past_due` (incl. Stripe's terminal `unpaid`) unlocked forever | Grace bounded to **7 days** from `payment_failed_at`, in SQL + both client copies, parity-tested |
| Plan change would mint a duplicate Stripe subscription | Checkout 409s a live subscriber → routed to the Stripe portal |
| Pro/org plans purchasable nowhere | `plan-upgrade` screen (role-aware) → Stripe Checkout via system browser |
| `seats_used` never written; billing screen said "0 of 25" | Stamped daily by cron + on checkout; Plan & billing shows "N active · M included" |
| Three disagreeing paid-predicates; sponsored athletes shown "Free" | One semantic everywhere + `Premium · sponsored` label; parity suite pins it |
| Sponsor seats $20/yr undercutting Individual 6x | Default now **$60/seat-year** (secret overrides) |
| Sept 1 AI price step (+50%) erodes pro-tier margin | `ANTHROPIC_MODEL_ANALYZE_FIRST` cheap-first routing with in-request escalation (default OFF) |

## Order of operations

1. **Migrations** (in order; both verified locally):
   ```bash
   supabase db push --linked     # applies 0163, 0164 (and 0162 if not yet applied)
   ```
2. **Deploy functions:**
   ```bash
   supabase functions deploy billing-checkout stripe-webhook sponsor-checkout analyze-meal
   supabase functions deploy billing-overage-report --no-verify-jwt   # cron-key auth
   ```
3. **Secrets:**
   ```bash
   supabase secrets set BILLING_CRON_KEY=<random-32+>
   # optional overrides: STRIPE_TRIAL_DAYS=14  SPONSOR_SEAT_PRICE_CENTS=6000
   ```
4. **Schedule the crons** (service role, once):
   ```sql
   select schedule_billing_overage(
     'https://<ref>.supabase.co/functions/v1/billing-overage-report', '<BILLING_CRON_KEY>');
   ```
   Two jobs appear: `billing-seats-stamp` (daily 06:10) and `billing-overage-invoice`
   (monthly, the 2nd at 06:20 — bills the *previous* month from complete data).
5. **Stripe dashboard** — unchanged from STRIPE-SETUP.md (Prices by lookup_key). **No new Prices
   are needed for the overage**: it bills as ad-hoc invoice items, deliberately, so one code path
   serves monthly and annual buyers. If ad-hoc `price_data`/`unit_amount` is blocked on the
   account, opt out of managed payments restrictions (the sponsor-checkout gotcha).
6. **OTA the app** (plan-upgrade screen, billing screen, keep-record card ship in the proto).

## Knobs and their defaults

| Env | Default | Meaning |
|---|---|---|
| `STRIPE_TRIAL_DAYS` | 14 | Stripe-rail trial. Change the catalog + site copy with it, or not at all |
| `SPONSOR_SEAT_PRICE_CENTS` | 6000 | $60/seat-year. The old $20 default was an unpriced accident |
| `BILLING_CRON_KEY` | — (required) | Auth for billing-overage-report |
| `ANTHROPIC_MODEL_ANALYZE_FIRST` | unset (OFF) | Cheap-first meal reads. **Enable only after** `npm run eval -- --replay` shows quality holds; watch `phase='escalate'` rate in ai_calls |
| `PRICE_GENERATION` | '' (launch) | Bump on a price rise; founding members stay pinned |

## The two safety rules worth remembering

- **A charge may only happen if its ledger row inserted.** `billing_overage_reports (owner, month)`
  PK + Stripe idempotency keys derived from the same pair. Crashed runs resume at the ledger's
  recorded numbers; nothing can double-bill.
- **Grace is 7 days, in one place per runtime, pinned by tests.** SQL (0163) ↔ `isPro`
  (subscription.ts) ↔ `isPaid` (settings.js) — `entitlementParity.test.ts` fails if they drift.

## Still deliberately NOT built

- **Metered/quantity overage on the subscription itself** — Stripe forbids mixed intervals; the
  arrears invoice is simpler and auditable.
- **Hard seat blocking** — a 31st athlete joins fine and bills; a hard wall at the join code was
  judged worse than expansion revenue.
- **Repricing the tiers** — the structure now protects margin (overage + active-based + routing);
  sticker changes should wait for Founding-50 willingness-to-pay conversations.
- **Feature-gating the app on entitlement** — `isPro` still has almost no call sites by design;
  what free vs paid *means* for athletes is a founder product decision, not a billing bug.

## What to verify after go-live

Week 1: `select * from billing_overage_reports order by created_at desc` after the first monthly
run — every row should have an invoice id or zero overage. `select seats, seats_used from
subscriptions where tier='team'` should show real numbers. `founding_slots_left()` should
decrement as founding checkouts complete. And the first trial subscriber's row should read
`status='active'` with a period end 14 days out.
