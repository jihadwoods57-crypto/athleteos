# Stripe — take your first payment (founder steps)

**The code is done — all of it (2026-07-04 revenue build).** The app now has a real in-app
checkout: a trainer taps "Start" on a plan, a Stripe payment page opens in their browser, they
pay, and the webhook flips their account to active automatically. Manage / update card / pause /
cancel all work through Stripe's hosted portal. Dunning (failed cards) and the give-a-month
referral loop are wired too.

What's left is only what needs your business identity and bank: **~40 minutes of clicking in
Stripe**, then two secrets, then I deploy. Here it is click-by-click.

Your model is **B2B off-platform** (a trainer/gym pays; their athletes ride free), so you skip
Apple's in-app-purchase cut entirely — this is just Stripe. (The consumer Individual/Family
plans are App Store IAP later, separate track.)

---

## Step 1 — Create a Stripe account (~15 min)
1. Go to **https://stripe.com** → Sign up.
2. Fill in your business details and connect a bank account (payouts land there). You can test
   everything in **Test mode** first; you need the bank before real charges.

## Step 2 — Create the plans as Products (~15 min)
In Stripe: **Products → Add product** — one product per plan, each with a monthly AND an annual
recurring price. **The critical detail: every Price must carry its `lookup_key`** (shown below) —
that is how the app finds the price, so no price IDs ever live in code and you can change a
price in the dashboard without a deploy.

| Product | Monthly price | its lookup_key | Annual price | its lookup_key |
|---|---|---|---|---|
| **Solo** | $99 | `pro_solo_monthly` | $990 | `pro_solo_annual` |
| **Professional** | $179 | `professional_monthly` | $1,790 | `professional_annual` |
| **Starter** | $249 | `org_starter_monthly` | $2,490 | `org_starter_annual` |
| **Growth** | $499 | `org_growth_monthly` | $4,990 | `org_growth_annual` |
| **Performance** | $799 | `org_performance_monthly` | $7,990 | `org_performance_annual` |

(In the dashboard, the lookup key field is under the price's **Advanced / additional options**.
If you only want to start with one plan, create just Solo — the others' buttons will say
"plan not available yet" honestly until you add them.)

## Step 3 — Referral coupon (~3 min)
**Products → Coupons → New:** name it `Referral month`, **100% off, once** (duration: once).
Copy its coupon ID. This one coupon powers both halves of give-a-month/get-a-month: the new
customer gets it applied at checkout when they enter a friend's code, and the friend gets it
applied to their own next invoice automatically by the webhook.

## Step 4 — Customer portal ON (~5 min)
**Settings → Billing → Customer portal → Activate.** Turn on: update payment method, cancel
subscription, and **pause subscription** (this is the churn-saver — the app's cancel flow
points people at pause first). You do NOT need to copy a portal link — the app now creates a
per-customer portal session on demand.

## Step 5 — Point Stripe at the webhook (~5 min)
1. **Developers → Webhooks → Add endpoint.**
2. Endpoint URL:
   ```
   https://ftwrvylzoyznhbzhgism.supabase.co/functions/v1/stripe-webhook
   ```
3. Select events: **`checkout.session.completed`**, **`customer.subscription.updated`**,
   **`customer.subscription.deleted`**, **`invoice.payment_failed`**, **`invoice.paid`**.
   (The last two power dunning — the "your card failed, fix it" banner and its all-clear.)
4. Add endpoint → copy the **Signing secret** (`whsec_...`).
5. While you're in Billing settings: **Settings → Billing → Automatic collection → Smart
   Retries ON** (recovers 20-40% of failed charges for free).

## Step 6 — Set three secrets (everything else is ALREADY deployed)
**Status 2026-07-04: migration 0042 is applied to live and all four billing functions
(stripe-webhook, billing-checkout, billing-portal, billing-return) are deployed.** Until
the secrets below exist they answer an honest "billing not configured" — nothing can break.
The ONLY remaining step is:

- **`STRIPE_SECRET_KEY`** — Developers → API keys → Secret key (`sk_live_...` / `sk_test_...`)
- **`STRIPE_WEBHOOK_SECRET`** — the `whsec_...` from step 5
- **`STRIPE_REFERRAL_COUPON_ID`** — the coupon ID from step 3

Don't paste them in chat — set them yourself (or tell me you've saved them somewhere and I'll
run it with you):
```
supabase secrets set STRIPE_SECRET_KEY=sk_... STRIPE_WEBHOOK_SECRET=whsec_... STRIPE_REFERRAL_COUPON_ID=... --project-ref ftwrvylzoyznhbzhgism
supabase functions deploy billing-checkout billing-portal --use-api
supabase functions deploy stripe-webhook billing-return --use-api --no-verify-jwt
```
(The redeploy just rebinds the new secrets to fresh instances — same code.)

## Step 7 — Test one checkout end to end (before going live)
In **Test mode**: open the app signed in as a test trainer → Account → See plans → pick Solo →
Start. Stripe's test card is `4242 4242 4242 4242` (any future expiry/CVC). Then check
**Supabase → Table editor → subscriptions**: the row should read `tier = team`,
`status = active`, `plan_id = pro_solo`. Reopen the app — the plan shows as active and
"Manage / pause / cancel" opens the portal. Test the referral too: create a second test
account, grab the first account's code from Account → Refer & earn, and check out with it —
both sides should show the free month.

Once that works, flip your keys to **live** and you're taking real money.

---

**How a payment finds the right account (for your mental model):** the app's checkout carries
the signed-in buyer's user id in the Stripe session (`client_reference_id`), so the webhook
knows exactly whose row to flip. No manual URL editing, no telling me user ids — the old
Payment-Link instructions from the previous version of this doc are obsolete.
