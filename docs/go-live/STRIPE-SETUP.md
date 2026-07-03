# Stripe — take your first payment (founder steps)

**The code is done.** The `stripe-webhook` function (which flips a customer's plan to "active" the
moment they pay) is written and committed — it just needs deploying with two secrets that only you
can create. Everything below is the part only you can do (it needs your business identity + bank),
laid out click-by-click. When you finish steps 1–4, hand me the two secrets from step 5 and I deploy
the rest in one shot.

Your model is **B2B off-platform** (a coach/gym pays per seat), so you skip Apple's in-app-purchase
system entirely — this is just Stripe.

---

## Step 1 — Create a Stripe account (~15 min)
1. Go to **https://stripe.com** → Sign up.
2. Fill in your business details and connect a bank account (this is where payouts land). You can
   test everything in **Test mode** first without this, but you need it before real charges.

## Step 2 — Create your plan(s) as Products (~10 min)
In Stripe: **Products → Add product.** Create at least the one you'll sell first. These match the
prices the app already assumes:

| Product name | Price | Billing | Who it's for |
|---|---|---|---|
| **Solo** | $69 / month | Recurring, monthly | a single personal trainer (up to 25 athletes) |
| **Starter** | $249 / month | Recurring, monthly | a small gym / program (up to 30 athletes) |
| **Growth** | $499 / month | Recurring | up to 75 athletes |
| **Performance** | $799 / month | Recurring | up to 150 athletes |

For each: set it **Recurring / monthly**, USD. (You can add the annual prices later — $690, $2490,
$4990, $7990.) **Start with just Solo or Starter** — you only need one to make your first sale.

## Step 3 — Create a Payment Link (~5 min)
1. **Products → your Starter (or Solo) price → Create payment link** (or **Payment Links → New**).
2. Turn **on** "Let customers adjust quantity" if you want to charge per-seat; otherwise leave the
   quantity at 1 seat-bundle.
3. Save it. You'll get a URL like `https://buy.stripe.com/xxxxx`.

**Important — how a payment finds the right coach:** when you send this link to a specific gym, add
their OnStandard account id to the end like this:

```
https://buy.stripe.com/xxxxx?client_reference_id=THAT-COACHS-USER-ID
```

(You get a coach's user id from **Supabase → Auth → Users** after they've signed up. This is how the
webhook knows whose account to upgrade. For your very first sale you can also just tell me the id and
I'll confirm the row flipped.)

## Step 4 — Point Stripe at your webhook (~5 min)
1. **Developers → Webhooks → Add endpoint.**
2. Endpoint URL:
   ```
   https://ftwrvylzoyznhbzhgism.supabase.co/functions/v1/stripe-webhook
   ```
3. Select events to send: **`checkout.session.completed`**, **`customer.subscription.updated`**,
   **`customer.subscription.deleted`**.
4. Add endpoint. Stripe shows a **Signing secret** that starts with `whsec_...` — copy it.

## Step 5 — Hand me two secrets, I finish it
Give me (paste them privately — actually, don't paste secrets in chat; drop them into a note and tell
me you're ready, OR set them yourself with the commands below):

- **`STRIPE_SECRET_KEY`** — Developers → API keys → Secret key (`sk_live_...` or `sk_test_...`)
- **`STRIPE_WEBHOOK_SECRET`** — the `whsec_...` from step 4

Then the deploy is two commands (I can run them, or you can):
```
supabase secrets set STRIPE_SECRET_KEY=sk_live_... STRIPE_WEBHOOK_SECRET=whsec_... --project-ref ftwrvylzoyznhbzhgism
supabase functions deploy stripe-webhook --project-ref ftwrvylzoyznhbzhgism --use-api --no-verify-jwt
```

## Step 6 — Set the "Manage / cancel" link (~2 min)
In Stripe: **Settings → Billing → Customer portal → activate.** Copy the portal link. That value goes
into the app build as `EXPO_PUBLIC_BILLING_PORTAL_URL` (an EAS environment variable — see the App
Store steps). This is what the in-app "Manage plan" button opens.

## Step 7 — Test one checkout (before going live)
Do a **Test mode** checkout using Stripe's test card `4242 4242 4242 4242` (any future expiry, any
CVC), with `?client_reference_id=<a test user id>` on the link. Then check **Supabase → Table editor
→ subscriptions** — that user's row should read `tier = team`, `status = active`. Once that works,
switch your keys to **live** and you're taking real money.

---

**What I can do the moment you're ready:** deploy the webhook (step 5) and verify the test checkout
flips the subscription row (step 7). The account, products, payment link, and bank connection are
inherently yours — but that's ~40 minutes of clicking, and then you can charge your first gym.
