# Founding 50

## What the site promises

> "the first 50 coaches and facilities are free through the beta, then lock today's price
> permanently — including the $10/month per active client beyond a plan's limit. A later price rise
> never touches them."
> — `web/landing/index.html:533`, repeated at `:593`, `:566`, and on coaches / trainers / dietitians

## What existed before

Nothing. No counter, no record of who claimed it, nothing stopping customer #51 or #5000 from being
told they were founding, and no mechanism to honor a "permanent" lock beyond someone remembering in
the Stripe dashboard. A promise with the word *permanently* in it cannot rest on memory.

It cost nothing to fix late: `subscriptions` is empty and Stripe has never charged anyone, so the
first real founding member is still ahead of us.

## How the lock works

Prices are not in this codebase — they are Stripe Price objects resolved by `lookup_key`
(`pro_solo_monthly`), which is what lets a price change without a deploy. So the lock cannot be
"remember $99". It has to be *keep resolving to the Price that existed when you joined*.

That is a **generation**:

- Today everyone is on the launch generation, `''`, whose keys are unsuffixed — every Price that
  exists right now. `PRICE_GENERATION` is unset, so **this is currently a no-op for everybody**.
- When prices rise: create the new Stripe Prices with the next generation suffix
  (`pro_solo_monthly_v2`), then set `PRICE_GENERATION=v2` on `billing-checkout`.
- New buyers resolve to `v2`. Founding members keep resolving to the generation on their row,
  forever. No coupons, no proration, nobody's subscription migrated.

The seat overage is locked the same way, on `locked_extra_seat_cents` — the clause a manual
arrangement loses first.

## Granting a slot

The site's CTA is `mailto:` ("Request founding access"), so this is intentionally a human decision.
`claim_founding_slot` is **service_role only** — a client that could call it could award itself a
permanent discount.

```sql
-- Find them, then grant. Idempotent: a second call returns the same slot, never a second one.
select id, email from profiles where email = 'coach@example.com';
select * from claim_founding_slot('<uuid>', '', 1000, 'Requested 2026-07-29 via support@');
--  ok | slot_no | reason
--   t |       7 | claimed

select founding_slots_taken();   -- how many of the fifty are gone
```

The 51st claim returns `ok=false, reason='founding 50 is full'`. That is enforced by a
`check (slot_no between 1 and 50)` plus a unique index, not by application logic, so two
simultaneous claims cannot both take slot 50 — verified by seeding 51 claims against a real
database.

"Free through the beta" is `billing_starts_at`: null while they are still free, set when billing
begins for them.

## Worth knowing

- `founding_slots_taken()` is granted to `anon`, so the landing page could show
  "N of 50 remaining" and make the scarcity verifiable rather than asserted. Not wired up yet.
- A member can read their own row (`fm_self_read`), so the app can say "founding member #7" without
  exposing anyone else.
- If `PRICE_GENERATION` is ever set to a malformed value, `normalizeGeneration` falls back to the
  base key rather than building a lookup_key that matches no Stripe Price — a wrong generation
  should not make plans unpurchasable.
