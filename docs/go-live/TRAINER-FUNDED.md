# Trainer-funded access — go-live

Built 2026-07-30 on `feat/premium-polish`. **Authored and verified against local Postgres and the
proto render harness; nothing here is live yet.** Design doc:
`docs/superpowers/specs/2026-07-30-trainer-funded-access-design.md`.

## What changed, in one screen

| Problem | Fix |
|---|---|
| A trainer paid a seat bill AND 15%, and their client paid a third bill for the app | A client on a recurring Pay package gets Premium included and **leaves the trainer's billable seat count** (0166) |
| The public trainer page could take an application but never a payment | `public-offer-checkout` — pay first, and the payment creates the relationship |
| A pay-first buyer has no account to grant | Webhook mints a `TR-XXXXX-XXXXX` claim; `redeem_offer_code` makes the link + both grants in one transaction |
| Non-subscription premium was labelled "sponsored" for everyone | `my_premium_source()` → the billing screen says **Premium · via your trainer** |
| Claim/sponsor codes came from `Math.random()` | CSPRNG. A claim code is a bearer credential and the mint path is public |

## Order of operations

1. **Subscription model v2 must be live first** (`docs/go-live/SUBSCRIPTION-MODEL.md`). 0166 rewrites
   `has_premium_access` and `active_athlete_count` on top of 0163's definitions.
2. **Migration:**
   ```bash
   supabase db push --linked        # applies 0165, 0166
   ```
3. **Deploy functions:**
   ```bash
   supabase functions deploy stripe-webhook --no-verify-jwt
   supabase functions deploy public-offer-checkout --no-verify-jwt   # buyers are anonymous BY DESIGN
   supabase functions deploy billing-return --no-verify-jwt
   ```
   `--no-verify-jwt` on `public-offer-checkout` is the whole point of the endpoint, not an oversight.
   Deploying it with JWT verification on makes every prospect's checkout 401 — the exact silent
   failure the roll-call trio shipped with.
4. **Secrets:**
   ```bash
   # ALLOWED_ORIGINS must include the landing domain or the browser blocks the checkout call.
   supabase secrets set ALLOWED_ORIGINS="https://onstandard.app,https://www.onstandard.app"
   # Optional: RESEND_API_KEY already set for guardian mail also delivers claim codes.
   # Optional: PUBLIC_RATE_LIMIT_PER_MIN (default 6)
   ```
5. **Landing:** deploy `web/landing/t.html` (Cloudflare, per `web/landing/DEPLOY.md`).
6. **OTA the app** — redeem screen, billing label, trainer Grow surfaces ship in the proto.

## The rules worth remembering

- **Access falls out of billing.** `expires_at` is written on purchase and pushed forward on every
  renewal invoice. A dead card runs dunning and the grant ages out. **There is no revoke path and
  there should never be one** — if access isn't lapsing, the expiry maintenance in
  `handleOfferRenewal` is what's broken.
- **Recurring only.** `month`/`week` fund access; `one-time`/`session` do not, and are not buyable
  from the public page. A funded grant lasts as long as a live subscription, so a one-off has no
  period to cover.
- **The seat exclusion is scoped to the owner's own practices.** An athlete funded by trainer T
  still bills coach B, who sees none of T's platform fee. Both directions are pinned in
  `supabase/tests/trainer_funded_test.sql`; if you ever "simplify" that to exclude by athlete alone,
  one operator's payment starts discounting an unrelated operator's invoice.
- **The trainer rides along.** Granting a client also grants the practice owner, so a trainer
  running money through Pay never sees a paywall. That is why the predicate has three arms, not four.

## Verify after go-live

```sql
-- grants exist and are in the future
select athlete_id, is_owner_grant, expires_at from trainer_funded_access order by granted_at desc limit 10;
-- a funded client should NOT be in their own trainer's billable count
select owner_id, seats_used from subscriptions where tier = 'team';
-- unredeemed claims — a growing pile means buyers aren't finding the redeem screen
select code, status, payer_email, created_at from offer_claims where status = 'pending' order by created_at desc;
```

End-to-end in Stripe **test mode**: publish a trainer page with a monthly offer → buy it as a
stranger → the return page shows a code → redeem in the app → the client is linked and reads
`Premium · via your trainer` → the trainer's Grow tab lists them as Covered. Then push a
`subscription_cycle` invoice with the Stripe CLI and confirm `expires_at` advances.

## Known gaps

- **Unredeemed claims have no nudge.** If a buyer never redeems, nothing chases them beyond the one
  email. Watch the pending-claims query above; a reminder job is the obvious follow-up.
- **The 15% is unchanged.** Tiered take rate stays a founder pricing decision; `fee_percent` is
  already admin-tunable via `admin_set_platform_fee` if that call gets made.
- **Offer position is the public checkout's handle.** If a trainer reorders offers between page load
  and click, the buyer gets the offer now in that slot. Prices are shown on Stripe's own confirm
  screen, so nobody is charged an unseen amount, but it is worth revisiting if trainers churn their
  packages often.
