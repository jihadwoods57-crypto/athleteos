# Coach Marketplace — go-live runbook

The Coach Partner Program: a person with no coach hires a real one inside OnStandard. Shipped
**dark** — every surface, RPC and payment path checks one switch, and it is off.

**State:** migrations 0183–0190 · `marketplace-checkout` + `stripe-webhook` (`marketplace_hire`) ·
6 proto screens · `web/admin/sections/marketplace.js` · `app_config.marketplace_enabled = false`.

---

## 0. 🔴 Do this first — it is a LIVE bug, unrelated to launching

`stripe-webhook` requires **seven** events. Until 2026-08-06 `STRIPE-SETUP.md` told you to
subscribe **five**, so if the endpoint was created before then it is missing:

- **`charge.refunded`**
- **`charge.dispute.created`**

Without them, refunds and chargebacks never revoke anything — **buy → refund → keep the app is
free and repeatable, and has been since 0166 shipped (2026-07-30)** for trainer-funded access,
independent of the marketplace.

**Developers → Webhooks → your endpoint → confirm all seven are checked.**
Then prove it in test mode: refund a charge and watch `trainer_funded_access.expires_at` jump to now.

```sql
select athlete_id, expires_at from trainer_funded_access
 where stripe_subscription_id = '<sub>' order by expires_at desc;
```

---

## 1. Turn it on for yourself only (staged rollout)

`marketplace_enabled` is global. 0190 adds an allowlist so the first real hire is rehearsed rather
than broadcast. Precedence, stated once:

| `marketplace_enabled` | on the allowlist | result |
|---|---|---|
| `true` | — | everyone (adults) sees it |
| `false` | yes | only those users see it |
| `false` | no | nobody — **today's state** |

```sql
-- add a tester (audited)
select admin_mkt_set_allowlist('<user-uuid>', true);
-- and to actually launch, later:
select admin_set_config('marketplace_enabled', 'true'::jsonb);
```

`marketplace_flags()` returns `preview: true` for an allowlisted user while the global switch is
still off, so a tester can tell "I'm on the list" from "we launched."

## 2. Approve the first coaches

Coaches apply in-app (**Profile → Coach marketplace**) — the form works while the switch is off,
which is how the supply pipeline fills before launch. You review at **admin.onstandard.app →
Marketplace**: read the application, open the actual certificate, verify or reject, then approve.

Approval (0186 + 0188) atomically: mints a practice if they have none · creates the listing with
**only** verified categories · mints a slug · **sets `primary_role = 'trainer'`** · audits everything.

**Coaching accounts are separate accounts.** An account with athlete activity (on a team, someone's
client, or has logged a day) cannot submit, and approval refuses it. `primary_role` is global and
the router bounces coaches off athlete screens, so promoting a personal account would silently take
that person's own Home/Plan/Camera/Progress away. `p_force := true` overrides once you've looked.

> **Known naming gap:** the app shell says **Trainer** (routes, nouns) while the marketplace says
> **Coach**. `'trainer'` is the only role value that actually loads a practice into the client
> runtime, so this is deliberate and accepted for now — not a bug report.

Then the coach sets their headline, prices all three tiers inside the admin bounds, and publishes.

## 3. Watch these in week 1

Funnel: `mkt_intro_viewed → mkt_directory_viewed → mkt_profile_viewed → mkt_checkout_started →
mkt_hired`, plus `mkt_application_submitted` and `mkt_report_submitted`.

```sql
select name, count(*) from analytics_events
 where name like 'mkt_%' and created_at > now() - interval '7 days' group by 1 order by 2 desc;
```

**The alarm is `mkt_checkout_started` without a matching `mkt_hired`** — someone tried to pay and
didn't land. Check `marketplace-checkout` logs for 409s (capacity / out-of-bounds price / already a
client) and 403s (adults-only).

```sql
-- money: marketplace hires share offer_payments with trainer offers
select status, count(*), sum(amount_cents)/100.0 gross, sum(application_fee_cents)/100.0 fee
  from offer_payments where created_at > now() - interval '7 days' group by 1;

-- supply health: a coach whose seats never free up is a coach nobody can hire
select l.slug, l.capacity,
       (select count(*) from practice_clients pc where pc.practice_id = l.practice_id and pc.status='active') active
  from coach_listings l where l.published and not l.suspended;
```

## 4. Money coming back (0189)

A refund, chargeback, or cancellation **ends the relationship**: the client goes to `removed`, the
agreement records `ended_at`/`ended_reason`, and **the capacity seat is released**.

That last part is not cosmetic — `marketplace_directory` *filters* on remaining capacity, so before
0189 every refunded client permanently consumed a seat and a coach with enough of them **vanished
from the directory forever**. The ledger also now distinguishes `disputed` from `refunded`, which
is what makes dispute rate measurable at all.

## 5. Testing Stripe locally

`handleMarketplaceHire` calls back into the real Stripe API (`subscriptions.retrieve`,
`charges.retrieve`), so **hand-rolled fixtures throw** — you need objects that exist in your test
account. Use a real test-mode checkout:

```bash
# 1. forward live test events at your local function
stripe listen --forward-to http://127.0.0.1:54321/functions/v1/stripe-webhook
#    → copy the whsec_… it prints into supabase/.env as STRIPE_WEBHOOK_SECRET (gitignored)

# 2. serve the functions against the local db
supabase functions serve --env-file supabase/.env

# 3. point the proto at local supabase — proto/redesign-2026-07/index.html window.__SUPABASE
#    (url http://127.0.0.1:54321 + the local anon key from `supabase status`), then:
node scripts/serve-proto.mjs          # → http://localhost:8799
```

Then hire a coach in the browser with card `4242 4242 4242 4242`, and refund it from the Stripe
dashboard. Assert the whole lifecycle:

```sql
select status from offer_payments      where stripe_charge_id = '<ch_…>';        -- refunded
select status from practice_clients    where practice_id = '<p>' and client_id = '<c>';  -- removed
select ended_reason from coach_agreements where practice_id = '<p>' and client_id = '<c>'; -- refund
```

Renewals ride the ordinary `invoice.paid → handleOfferRenewal` path — it keys off
`offer_payments.stripe_subscription_id` and never inspects `metadata.kind`, so a marketplace
subscription is handled identically to a trainer offer. Push one with
`stripe trigger invoice.payment_succeeded` and confirm `trainer_funded_access.expires_at` advances.

## 6. Browser-QC'ing the admin console locally

**Three** edits, not the two `web/admin/DEPLOY.md` lists — miss the third and the page makes
**zero network calls** with no visible error:

1. `web/admin/api.js` — `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `FUNCTIONS_URL`
2. `web/admin/flags.js` — its own duplicate pair (only needed for `flags.html`)
3. **`web/admin/index.html` line 7 — the CSP `connect-src`**, which pins the prod origins

Local MFA is off (`supabase/config.toml` `[auth.mfa.totp]` both false) while `admin_bootstrap`
requires aal2 + a verified factor. Patch it **locally only, never as a migration**:

```sql
create or replace function public.admin_is_aal2() returns boolean
language sql stable security definer set search_path = public as $$ select true $$;
-- admin_bootstrap reads the JWT claim directly, so patch it too; re-apply 0130 when done.
```

Note `is_platform_admin()` also reads the claim directly, so the Home/Revenue sections will still
401 under this bypass while the Marketplace section (which routes through `assert_admin_mfa()`)
works. That is the bypass being incomplete, not a defect.

Serve `web/admin/` over HTTP (`npx wrangler dev`, or any static server) — ES modules will not load
from `file://`. **Restore all three files and re-apply 0130 afterwards.**

## 7. The gate before shipping any change here

```bash
npm run verify        # xss + copy-lint + typecheck + jest + proto + admin tests + bundle
npm run verify:full   # the above + npm run test:rls  (needs Docker) ← use this before a marketplace ship
```

`test:rls` runs 33 marketplace checks inside `supabase/tests/rls_authz_test.sql`, including that a
credential can never be self-verified, that a coach cannot widen their own approved scope, that
unknown age fails closed, and that a removed client's seat is genuinely released.

## Known gaps

- The app shell says "Trainer" where the marketplace says "Coach" (see §2).
- A partial refund does not end the relationship — only a full refund/chargeback/cancel does,
  matching the deliberate `charge.refunded === true` gate in the webhook.
- Reviews, disputes, marketplace analytics, coach quality metrics and org-approved coaches are
  Phase 3 and not built.
