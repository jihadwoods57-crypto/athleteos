# Parent-Funded Plans Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a parent pay for a trainer's coaching package on behalf of their linked child, reusing the OnStandard Pay Stripe Connect rails, with a payer-usable cancel for recurring plans.

**Architecture:** Thin extension of the existing Pay rails. Two nullable columns on the `offer_payments` ledger (`beneficiary_athlete_id`, `subscription_cancelled_at`); a parent-facing discovery RPC (`my_funded_offers`) and a funded-plans list RPC (`my_funded_plans`); `pay-offer-checkout` extended to accept a beneficiary child and server-verify the guardian→child and child→trainer chain; `stripe-webhook` extended to record the beneficiary and honor subscription deletion; a new `cancel-offer-subscription` function; parent-dashboard surfaces + a trainer payments label. No new tables.

**Tech Stack:** Supabase Postgres (SQL migrations, SECURITY DEFINER RPCs), Deno edge functions (`npm:stripe@^17`, `npm:@supabase/supabase-js@^2`), the proto WebView UI (`proto/redesign-2026-07/js`, vanilla ES modules), Playwright for live verification.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-22-parent-funded-plans-design.md`.
- Branch is shared (`feat/founder-command-center`); a concurrent Command Center session increments migrations too. **Verify the highest migration number immediately before creating the file** (`ls supabase/migrations | sort | tail -3`) and use the next free one. This plan writes `0128`; bump if taken.
- **Apply migrations DIRECTLY** to the linked prod DB via `supabase db query --linked -f <file>` (NOT `supabase db push` — that would apply the concurrent session's unapplied migrations). Record with `supabase migration repair --status applied <N>`.
- Stripe API version pinned `2025-02-24.acacia`; lazy Stripe client via `Stripe.createFetchHttpClient()`. Edge functions read `STRIPE_SECRET_KEY` (currently the TEST key in prod).
- Money values are always recorded from real Stripe objects, never recomputed. Idempotency on `stripe_charge_id` (unique index from 0121) is untouched.
- Every money/read path is SECURITY DEFINER / service-role and server-verifies the full chain (`guardianships.status='active'` AND `practice_clients.status='active'` AND `practices.stripe_connect_status='active'`). Never trust a client-supplied id.
- Verify edge functions with `deno check <file>`; new type errors are only acceptable if they match the pre-existing tolerated `SupabaseClient<any>` inference pattern (diff against `git show HEAD:<file>`).
- Copy rules: plain language, sentence case, no em dashes in UI strings, no guilt copy.

---

### Task 1: SQL migration — ledger columns + parent RPCs + extended payments RPC

**Files:**
- Create: `supabase/migrations/0128_parent_funded_plans.sql`

**Interfaces:**
- Produces (SQL, callable from proto via `supabase-js`):
  - `my_funded_offers() -> table(child_id uuid, child_name text, practice_id uuid, trainer_name text, offer_id uuid, name text, blurb text, price_cents int, cadence text, features text[])`
  - `my_funded_plans(p_limit int default 50) -> table(id uuid, offer_name text, child_name text, amount_cents int, cadence text, status text, stripe_subscription_id text, subscription_cancelled_at timestamptz, created_at timestamptz)`
  - `my_practice_payments(p_practice uuid, p_limit int default 30)` — now returns an explicit column list INCLUDING `beneficiary_athlete_id uuid`, `subscription_cancelled_at timestamptz`, and `beneficiary_name text`.
  - Columns `offer_payments.beneficiary_athlete_id uuid`, `offer_payments.subscription_cancelled_at timestamptz`.

- [ ] **Step 1: Verify the next migration number**

Run: `ls supabase/migrations | sort | tail -3`
Expected: highest is `0127_*` (concurrent session). If `0128` already exists, use the next free number for the filename and every reference below.

- [ ] **Step 2: Write the migration file**

Create `supabase/migrations/0128_parent_funded_plans.sql`:

```sql
-- 0128 — Parent-funded plans: a guardian funds a trainer's package for their child.
-- Thin extension of OnStandard Pay (0119/0121). Two nullable ledger columns + parent RPCs.

-- ---- ledger columns -------------------------------------------------------------------------
alter table public.offer_payments
  add column if not exists beneficiary_athlete_id  uuid references profiles(id) on delete set null,
  add column if not exists subscription_cancelled_at timestamptz;
-- beneficiary null = client bought for themselves (unchanged). set = a guardian funded it for the child.
-- subscription_cancelled_at is stamped on EVERY row of a recurring offer's subscription when cancelled;
-- per-charge `status` stays paid/refunded/failed (a past charge was genuinely paid).
create index if not exists offer_payments_beneficiary_idx
  on public.offer_payments (beneficiary_athlete_id) where beneficiary_athlete_id is not null;

-- ---- parent discovery: my children's trainers' payable offers ------------------------------
-- Mirrors my_trainer_offers (0119) but walks guardianships -> the child's active practice_clients.
create or replace function public.my_funded_offers()
returns table (child_id uuid, child_name text, practice_id uuid, trainer_name text,
               offer_id uuid, name text, blurb text, price_cents int, cadence text, features text[])
language plpgsql stable security definer set search_path = public as $$
begin
  return query
    select g.athlete_id, cp.full_name, pr.id, own.full_name,
           o.id, o.name, o.blurb, o.price_cents, o.cadence, o.features
    from guardianships g
    join profiles cp on cp.id = g.athlete_id
    join practice_clients pc on pc.client_id = g.athlete_id and pc.status = 'active'
    join practices pr on pr.id = pc.practice_id and pr.stripe_connect_status = 'active'
    join profiles own on own.id = pr.owner_id
    join offers o on o.practice_id = pr.id and o.active
    where g.guardian_id = auth.uid() and g.status = 'active'
    order by cp.full_name, o.sort, o.created_at;
end $$;
grant execute on function public.my_funded_offers() to authenticated;

-- ---- parent's funded plans (dashboard list) ------------------------------------------------
create or replace function public.my_funded_plans(p_limit int default 50)
returns table (id uuid, offer_name text, child_name text, amount_cents int, cadence text,
               status text, stripe_subscription_id text, subscription_cancelled_at timestamptz, created_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  return query
    select op.id, o.name, cp.full_name, op.amount_cents, o.cadence,
           op.status, op.stripe_subscription_id, op.subscription_cancelled_at, op.created_at
    from offer_payments op
    left join offers o on o.id = op.offer_id
    left join profiles cp on cp.id = op.beneficiary_athlete_id
    where op.payer_id = auth.uid() and op.beneficiary_athlete_id is not null
    order by op.created_at desc limit greatest(least(p_limit, 200), 1);
end $$;
grant execute on function public.my_funded_plans(int) to authenticated;

-- ---- trainer payments list, now carrying the beneficiary name ------------------------------
-- my_practice_payments returned `setof offer_payments`; adding a joined name needs an explicit
-- column list, so DROP + recreate (and re-grant — a dropped function loses its grants).
drop function if exists public.my_practice_payments(uuid, int);
create or replace function public.my_practice_payments(p_practice uuid, p_limit int default 30)
returns table (
  id uuid, practice_id uuid, offer_id uuid, payer_id uuid,
  stripe_checkout_session_id text, stripe_payment_intent_id text, stripe_subscription_id text, stripe_charge_id text,
  amount_cents int, application_fee_cents int, currency text, status text,
  beneficiary_athlete_id uuid, subscription_cancelled_at timestamptz, created_at timestamptz,
  beneficiary_name text
)
language plpgsql stable security definer set search_path = public as $$
begin
  if not owns_practice(p_practice) then raise exception 'not authorized'; end if;
  return query
    select op.id, op.practice_id, op.offer_id, op.payer_id,
           op.stripe_checkout_session_id, op.stripe_payment_intent_id, op.stripe_subscription_id, op.stripe_charge_id,
           op.amount_cents, op.application_fee_cents, op.currency, op.status,
           op.beneficiary_athlete_id, op.subscription_cancelled_at, op.created_at,
           bp.full_name
    from offer_payments op
    left join profiles bp on bp.id = op.beneficiary_athlete_id
    where op.practice_id = p_practice
    order by op.created_at desc limit greatest(least(p_limit, 200), 1);
end $$;
grant execute on function public.my_practice_payments(uuid, int) to authenticated;
```

- [ ] **Step 3: Apply directly to prod**

Run: `supabase db query --linked -f supabase/migrations/0128_parent_funded_plans.sql`
Expected: JSON with `"rows": []` and no error.

- [ ] **Step 4: Verify columns + functions exist**

Run:
```bash
supabase db query --linked "select
  (select count(*) from information_schema.columns where table_name='offer_payments' and column_name in ('beneficiary_athlete_id','subscription_cancelled_at')) as cols,
  (select count(*) from pg_proc where proname in ('my_funded_offers','my_funded_plans')) as fns;"
```
Expected: `"cols": 2`, `"fns": 2`.

- [ ] **Step 5: Verify the extended payments RPC has the beneficiary_name column**

Run: `supabase db query --linked "select beneficiary_name from my_practice_payments('00000000-0000-0000-0000-000000000000'::uuid, 1)" 2>&1 | head`
Expected: an authorization error (`not authorized`) — proves the function exists with the new signature and its owner gate fires (behavioral data test happens in Task 7 with real fixtures).

- [ ] **Step 6: Record + commit**

```bash
supabase migration repair --status applied 0128
git add supabase/migrations/0128_parent_funded_plans.sql
git commit -m "feat(pay): 0128 parent-funded plans — ledger cols + my_funded_offers/plans + payments beneficiary"
```

---

### Task 2: Extend `pay-offer-checkout` to accept a beneficiary child

**Files:**
- Modify: `supabase/functions/pay-offer-checkout/index.ts`

**Interfaces:**
- Consumes: request body now `{ offerId: string, beneficiaryAthleteId?: string }`.
- Produces: when `beneficiaryAthleteId` is set and the guardian/client chain verifies, the Checkout Session (and its payment/subscription) carries `metadata.beneficiary_athlete_id`. Behavior with no `beneficiaryAthleteId` is byte-for-byte unchanged.

- [ ] **Step 1: Parse the beneficiary from the body**

Find `const offerId = typeof body.offerId === 'string' ? body.offerId : '';` and the `body` type. Change the body type and add parsing right after the `offerId` UUID check:

```ts
  let body: { offerId?: unknown; beneficiaryAthleteId?: unknown };
```
```ts
  const offerId = typeof body.offerId === 'string' ? body.offerId : '';
  if (!UUID_RE.test(offerId)) return json({ error: 'bad request' }, 400, cors);
  const beneficiaryAthleteId = typeof body.beneficiaryAthleteId === 'string' ? body.beneficiaryAthleteId : '';
  if (beneficiaryAthleteId && !UUID_RE.test(beneficiaryAthleteId)) return json({ error: 'bad request' }, 400, cors);
```

- [ ] **Step 2: Branch the buyer-standing check**

Replace the existing block:
```ts
  const { data: link } = await svc.from('practice_clients')
    .select('status').eq('practice_id', offer.practice_id).eq('client_id', user.id).maybeSingle();
  if (!link || link.status !== 'active') return json({ error: 'connect with this trainer first' }, 403, cors);
```
with:
```ts
  if (beneficiaryAthleteId) {
    // Parent funding for their child: the caller must be the child's ACTIVE guardian, and the child
    // must be an ACTIVE client of this exact practice. Never let a stranger fund a stranger's plan.
    const { data: guard } = await svc.from('guardianships')
      .select('status').eq('athlete_id', beneficiaryAthleteId).eq('guardian_id', user.id).maybeSingle();
    if (!guard || guard.status !== 'active') return json({ error: 'not your dependent' }, 403, cors);
    const { data: clink } = await svc.from('practice_clients')
      .select('status').eq('practice_id', offer.practice_id).eq('client_id', beneficiaryAthleteId).maybeSingle();
    if (!clink || clink.status !== 'active') return json({ error: 'this athlete is not a client of this trainer' }, 403, cors);
  } else {
    const { data: link } = await svc.from('practice_clients')
      .select('status').eq('practice_id', offer.practice_id).eq('client_id', user.id).maybeSingle();
    if (!link || link.status !== 'active') return json({ error: 'connect with this trainer first' }, 403, cors);
  }
```

- [ ] **Step 3: Stamp the beneficiary into metadata**

Replace the `metadata` object:
```ts
  const metadata = {
    kind: 'offer_purchase',
    offer_id: offer.id,
    practice_id: offer.practice_id,
    payer_id: user.id,
  };
```
with:
```ts
  const metadata = {
    kind: 'offer_purchase',
    offer_id: offer.id,
    practice_id: offer.practice_id,
    payer_id: user.id,
    ...(beneficiaryAthleteId ? { beneficiary_athlete_id: beneficiaryAthleteId } : {}),
  };
```
(The `metadata` object is already spread into the session and into `payment_intent_data`/`subscription_data`, so no other change is needed.)

- [ ] **Step 4: Type-check**

Run: `deno check supabase/functions/pay-offer-checkout/index.ts`
Expected: exit 0 (this function checked clean before; keep it clean).

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/pay-offer-checkout/index.ts
git commit -m "feat(pay): pay-offer-checkout accepts a beneficiary child (guardian+client verified)"
```

---

### Task 3: Extend `stripe-webhook` to record the beneficiary + honor cancellation

**Files:**
- Modify: `supabase/functions/stripe-webhook/index.ts`

**Interfaces:**
- Consumes: `metadata.beneficiary_athlete_id` on offer-purchase sessions (from Task 2).
- Produces: `offer_payments.beneficiary_athlete_id` is populated on record; a `customer.subscription.deleted` event stamps `subscription_cancelled_at` on all rows for that subscription.

- [ ] **Step 1: Add the beneficiary to `recordOfferPayment`**

In the `recordOfferPayment` `fields` type, add `beneficiaryAthleteId: string | null;`. In the `upsert({...})` object add `beneficiary_athlete_id: fields.beneficiaryAthleteId,` next to `payer_id`.

- [ ] **Step 2: Pass the beneficiary from `handleOfferCheckout`**

Near the top of `handleOfferCheckout`, add:
```ts
  const beneficiaryAthleteId = session.metadata?.beneficiary_athlete_id ?? null;
```
Add `beneficiaryAthleteId,` to BOTH `recordOfferPayment(svc, { ... })` calls (payment and subscription branches).

- [ ] **Step 3: Carry the beneficiary through renewals**

In `handleOfferRenewal`, extend the prior-row lookup to also select the beneficiary:
```ts
  const { data: priorRow } = await svc.from('offer_payments')
    .select('practice_id, offer_id, payer_id, beneficiary_athlete_id').eq('stripe_subscription_id', subId).limit(1).maybeSingle();
```
and add `beneficiaryAthleteId: priorRow.beneficiary_athlete_id ?? null,` to the `recordOfferPayment(svc, { ... })` call in that function.

- [ ] **Step 4: Add the `customer.subscription.deleted` case**

In the main `switch (event.type)`, add a new case (next to `charge.refunded`):
```ts
      case 'customer.subscription.deleted': {
        // OnStandard Pay: a recurring offer subscription ended (parent/client cancelled, or Stripe
        // terminated it). Stamp every ledger row for that subscription so "Funded plans" shows it
        // stopped. Past paid charges keep status 'paid'.
        const sub = event.data.object as Stripe.Subscription;
        const { error } = await svc.from('offer_payments')
          .update({ subscription_cancelled_at: new Date().toISOString() })
          .eq('stripe_subscription_id', sub.id).is('subscription_cancelled_at', null);
        if (error) throw error;
        break;
      }
```
Also add `customer.subscription.deleted` to the header comment listing the handled events.

- [ ] **Step 5: Type-check against the tolerated baseline**

Run: `deno check supabase/functions/stripe-webhook/index.ts 2>&1 | grep -oE "TS[0-9]+" | sort | uniq -c`
Expected: the same error profile as before this task (`TS2339` x5, `TS2345` x4, `TS2353` x2 — the tolerated `SupabaseClient<any>` inference noise). No new error CODES. If a new code appears, fix that line.

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/stripe-webhook/index.ts
git commit -m "feat(pay): stripe-webhook records beneficiary + stamps subscription cancellation"
```

---

### Task 4: New `cancel-offer-subscription` edge function

**Files:**
- Create: `supabase/functions/cancel-offer-subscription/index.ts`

**Interfaces:**
- Consumes: `{ paymentId: string }` (a row id from `my_funded_plans`/the client's payments) + the caller's bearer token.
- Produces: `{ ok: true }` on success; cancels the Stripe subscription and stamps `subscription_cancelled_at` on all rows for that subscription. Callable by the `payer_id` only (parent OR client).

- [ ] **Step 1: Write the function (mirrors `refund-payment`)**

Create `supabase/functions/cancel-offer-subscription/index.ts`:

```ts
// OnStandard — cancel-offer-subscription: lets the PAYER (a parent who funded a child's plan, or a
// client who bought their own) cancel their own recurring offer subscription. Ownership is by
// payer_id on the ledger row — not a founder/admin action. Stripe cancels the subscription;
// customer.subscription.deleted (stripe-webhook) independently confirms the same stamp.
//
// Deploy:
//   supabase functions deploy cancel-offer-subscription
import Stripe from 'npm:stripe@^17';
import { createClient } from 'npm:@supabase/supabase-js@^2';

const STRIPE_SECRET_KEY = Deno.env.get('STRIPE_SECRET_KEY') ?? '';
const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY');
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

const stripe = new Stripe(STRIPE_SECRET_KEY, {
  apiVersion: '2025-02-24.acacia',
  httpClient: Stripe.createFetchHttpClient(),
});

const ALLOWED_ORIGINS = (Deno.env.get('ALLOWED_ORIGINS') ?? '').split(',').map((o) => o.trim()).filter(Boolean);
const BASE_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Headers': 'authorization, content-type, apikey, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  Vary: 'Origin',
};
function corsFor(req: Request): Record<string, string> {
  const origin = req.headers.get('origin');
  if (!origin) return BASE_HEADERS;
  if (ALLOWED_ORIGINS.includes(origin)) return { ...BASE_HEADERS, 'Access-Control-Allow-Origin': origin };
  return BASE_HEADERS;
}
const RL_MAX = Number(Deno.env.get('RATE_LIMIT_PER_MIN') ?? '10');
const rlHits = new Map<string, { count: number; resetAt: number }>();
function rateLimited(req: Request): boolean {
  const ip = (req.headers.get('x-forwarded-for') ?? '').split(',')[0].trim() || 'unknown';
  const now = Date.now();
  const e = rlHits.get(ip);
  if (!e || now > e.resetAt) { rlHits.set(ip, { count: 1, resetAt: now + 60_000 }); return false; }
  e.count++;
  return e.count > RL_MAX;
}

async function resolveUser(req: Request): Promise<{ id: string } | null> {
  const token = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '').trim();
  if (!token || !SUPABASE_URL || !SUPABASE_ANON_KEY || token === SUPABASE_ANON_KEY) return null;
  try {
    const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    const { data, error } = await sb.auth.getUser(token);
    if (error || !data.user) return null;
    return { id: data.user.id };
  } catch {
    return null;
  }
}

const json = (obj: unknown, status: number, cors: Record<string, string>) =>
  new Response(JSON.stringify(obj), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

Deno.serve(async (req) => {
  const cors = corsFor(req);
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405, cors);
  if (rateLimited(req)) return json({ error: 'rate limited, slow down' }, 429, cors);
  if (!STRIPE_SECRET_KEY) return json({ error: 'billing not configured' }, 503, cors);
  if (!SUPABASE_URL || !SERVICE_ROLE) return json({ error: 'server not configured' }, 500, cors);

  const user = await resolveUser(req);
  if (!user) return json({ error: 'sign in required' }, 401, cors);

  let body: { paymentId?: unknown };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'bad request' }, 400, cors);
  }
  const paymentId = typeof body.paymentId === 'string' ? body.paymentId : '';
  if (!UUID_RE.test(paymentId)) return json({ error: 'bad request' }, 400, cors);

  const svc = createClient(SUPABASE_URL, SERVICE_ROLE);

  const { data: payment } = await svc.from('offer_payments')
    .select('id, payer_id, stripe_subscription_id, subscription_cancelled_at').eq('id', paymentId).maybeSingle();
  if (!payment) return json({ error: 'plan not found' }, 404, cors);
  if (payment.payer_id !== user.id) return json({ error: 'not authorized' }, 403, cors);
  if (!payment.stripe_subscription_id) return json({ error: 'this is a one-time purchase, nothing to cancel' }, 400, cors);
  if (payment.subscription_cancelled_at) return json({ error: 'already cancelled' }, 400, cors);

  try {
    await stripe.subscriptions.cancel(payment.stripe_subscription_id);
    // Optimistic — customer.subscription.deleted (stripe-webhook) confirms the same stamp.
    await svc.from('offer_payments')
      .update({ subscription_cancelled_at: new Date().toISOString() })
      .eq('stripe_subscription_id', payment.stripe_subscription_id);
    return json({ ok: true }, 200, cors);
  } catch (e) {
    console.error('cancel-offer-subscription error:', e);
    return json({ error: 'cancel failed' }, 502, cors);
  }
});
```

- [ ] **Step 2: Type-check**

Run: `deno check supabase/functions/cancel-offer-subscription/index.ts`
Expected: exit 0, or only the tolerated `SupabaseClient<any>` `TS2339`/`TS2345` inference noise (diff-confirm it matches the pattern in `refund-payment`).

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/cancel-offer-subscription/index.ts
git commit -m "feat(pay): cancel-offer-subscription — payer cancels a recurring offer plan"
```

---

### Task 5: Pure `groupFundedPlans` helper (grouping + status) with a test

**Files:**
- Create: `proto/redesign-2026-07/js/funded.js`
- Test: `proto/redesign-2026-07/js/funded.test.mjs`

**Interfaces:**
- Produces: `groupFundedPlans(rows) -> Plan[]` where a `Plan` is `{ key, id, offer_name, child_name, amount_cents, cadence, recurring, cancelled }`. `rows` are `my_funded_plans` rows. Recurring rows (cadence `month`/`week`) sharing a `stripe_subscription_id` collapse to ONE plan (the newest row, its `id` used for cancel); one-time rows each stand alone. `cancelled` reflects `subscription_cancelled_at`.

- [ ] **Step 1: Write the failing test**

Create `proto/redesign-2026-07/js/funded.test.mjs`:

```js
import assert from 'node:assert';
import { groupFundedPlans } from './funded.js';

// two charges of one monthly subscription collapse to a single active plan
const monthly = groupFundedPlans([
  { id: 'b', offer_name: 'Full', child_name: 'Sam', amount_cents: 15000, cadence: 'month', status: 'paid', stripe_subscription_id: 'sub_1', subscription_cancelled_at: null, created_at: '2026-07-02T00:00:00Z' },
  { id: 'a', offer_name: 'Full', child_name: 'Sam', amount_cents: 15000, cadence: 'month', status: 'paid', stripe_subscription_id: 'sub_1', subscription_cancelled_at: null, created_at: '2026-06-02T00:00:00Z' },
]);
assert.strictEqual(monthly.length, 1);
assert.strictEqual(monthly[0].recurring, true);
assert.strictEqual(monthly[0].cancelled, false);
assert.strictEqual(monthly[0].id, 'b'); // newest row drives cancel

// a cancelled subscription is reported cancelled
const cancelled = groupFundedPlans([
  { id: 'c', offer_name: 'Light', child_name: 'Sam', amount_cents: 5000, cadence: 'month', status: 'paid', stripe_subscription_id: 'sub_2', subscription_cancelled_at: '2026-07-10T00:00:00Z', created_at: '2026-07-01T00:00:00Z' },
]);
assert.strictEqual(cancelled[0].cancelled, true);

// one-time purchases each stand alone and are never recurring
const oneTime = groupFundedPlans([
  { id: 'd', offer_name: 'Review', child_name: 'Sam', amount_cents: 7500, cadence: 'session', status: 'paid', stripe_subscription_id: null, subscription_cancelled_at: null, created_at: '2026-07-05T00:00:00Z' },
  { id: 'e', offer_name: 'Review', child_name: 'Sam', amount_cents: 7500, cadence: 'session', status: 'paid', stripe_subscription_id: null, subscription_cancelled_at: null, created_at: '2026-07-06T00:00:00Z' },
]);
assert.strictEqual(oneTime.length, 2);
assert.strictEqual(oneTime[0].recurring, false);

console.log('groupFundedPlans: all assertions passed');
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx tsx proto/redesign-2026-07/js/funded.test.mjs`
Expected: FAIL — `Cannot find module './funded.js'` (or `groupFundedPlans is not a function`).

- [ ] **Step 3: Implement the helper**

Create `proto/redesign-2026-07/js/funded.js`:

```js
/* Pure helper for the parent "Funded plans" list. Collapses the per-charge rows my_funded_plans
   returns into one plan per recurring subscription (newest charge wins, and drives cancel), while
   one-time purchases each stand alone. No DOM, no network — unit-tested in funded.test.mjs. */
export function groupFundedPlans(rows) {
  const list = Array.isArray(rows) ? rows.slice() : [];
  // newest first so the first row seen for a subscription is the one we keep
  list.sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));
  const out = [];
  const seenSub = new Set();
  for (const r of list) {
    const recurring = r.cadence === 'month' || r.cadence === 'week';
    const sub = r.stripe_subscription_id || null;
    if (recurring && sub) {
      if (seenSub.has(sub)) continue;
      seenSub.add(sub);
    }
    out.push({
      key: (recurring && sub) ? sub : r.id,
      id: r.id,
      offer_name: r.offer_name || 'Package',
      child_name: r.child_name || '',
      amount_cents: r.amount_cents,
      cadence: r.cadence,
      recurring: !!(recurring && sub),
      cancelled: !!r.subscription_cancelled_at,
    });
  }
  return out;
}
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `npx tsx proto/redesign-2026-07/js/funded.test.mjs`
Expected: `groupFundedPlans: all assertions passed`.

- [ ] **Step 5: Commit**

```bash
git add proto/redesign-2026-07/js/funded.js proto/redesign-2026-07/js/funded.test.mjs
git commit -m "feat(pay): pure groupFundedPlans helper for the parent funded-plans list"
```

---

### Task 6: Proto UI — parent surfaces, roles.js wrappers, trainer label

**Files:**
- Modify: `proto/redesign-2026-07/js/roles.js` (add wrappers near the existing Pay wrappers, ~line 976)
- Create: `proto/redesign-2026-07/js/screens/fund-plan.js`
- Create: `proto/redesign-2026-07/js/screens/funded-plans.js`
- Modify: `proto/redesign-2026-07/js/screens/index.js` (register the two new screens)
- Modify: `proto/redesign-2026-07/js/screens/coach.js` (the `parent` dashboard — add two entry rows)
- Modify: `proto/redesign-2026-07/js/screens/trainer-grow.js` (payments beneficiary label)

**Interfaces:**
- Consumes: RPCs `my_funded_offers`, `my_funded_plans`; functions `pay-offer-checkout` (with `beneficiaryAthleteId`), `cancel-offer-subscription`; the pure `groupFundedPlans` from Task 5.
- Produces: routes `fund-plan` and `funded-plans` in the `screens` registry; `roles.fetchFundedOffers()`, `roles.fetchFundedPlans()`, `roles.startFundedCheckout(offerId, beneficiaryAthleteId)`, `roles.cancelFundedSubscription(paymentId)`.

- [ ] **Step 1: Add roles.js wrappers**

In `proto/redesign-2026-07/js/roles.js`, immediately after `export async function fetchMyTrainerOffers()` (around line 990), add:

```js
/** A guardian's children's trainers' payable offers (active guardianship + active client + active Connect). */
export async function fetchFundedOffers() {
  const c = sb(); if (!c) return [];
  try { const { data } = await c.rpc('my_funded_offers'); return data || []; } catch { return []; }
}
/** The guardian's own funded plans (for the Funded plans list). */
export async function fetchFundedPlans() {
  const c = sb(); if (!c) return [];
  try { const { data } = await c.rpc('my_funded_plans', { p_limit: 50 }); return data || []; } catch { return []; }
}
/** Start Checkout for an offer on behalf of a child. Returns { url } or { error }. */
export async function startFundedCheckout(offerId, beneficiaryAthleteId) {
  return callFn('pay-offer-checkout', { offerId, beneficiaryAthleteId });
}
/** Cancel a recurring funded plan (by an offer_payments row id). Returns { ok:true } or { error }. */
export async function cancelFundedSubscription(paymentId) {
  return callFn('cancel-offer-subscription', { paymentId });
}
```

- [ ] **Step 2: Create the "Fund a plan" screen**

Create `proto/redesign-2026-07/js/screens/fund-plan.js` (models on `my-trainer-offers.js`, but groups by child and passes the child as beneficiary):

```js
/* Parent "Fund a plan": each child's trainer's payable packages, with a Pay button that opens Stripe
   Checkout with the parent as payer and the child as beneficiary. Server verifies guardian+client. */
import { backHead, esc } from '../components.js';
import { icon } from '../icons.js';
import * as roles from '../roles.js';

let CACHE = { rows: null, loaded: false };
let UI = { paying: null };

async function load(force) {
  if (CACHE.loaded && !force) return;
  CACHE.rows = await roles.fetchFundedOffers();
  CACHE.loaded = true;
  if (window.__render) window.__render();
}

function priceLabel(o) {
  if (o.price_cents == null) return 'Contact for pricing';
  const d = o.price_cents / 100; const n = Number.isInteger(d) ? d : d.toFixed(2);
  const per = o.cadence === 'one-time' ? ' one-time' : o.cadence === 'session' ? ' / session' : o.cadence === 'week' ? ' / wk' : ' / mo';
  return `$${n}${per}`;
}

function groupByChild(rows) {
  const map = new Map();
  for (const r of (rows || [])) {
    if (!map.has(r.child_id)) map.set(r.child_id, { child_id: r.child_id, child_name: r.child_name, trainer_name: r.trainer_name, offers: [] });
    map.get(r.child_id).offers.push(r);
  }
  return [...map.values()];
}

export default {
  render() {
    if (!CACHE.loaded) {
      return `${backHead('Fund a plan', 'Pay for your child’s coaching', 'parent')}
      <div class="sidebox"><div class="req-icon b" style="width:38px;height:38px">${icon('bolt', 17)}</div><div><div class="tt">Loading…</div></div></div>`;
    }
    const groups = groupByChild(CACHE.rows);
    return `${backHead('Fund a plan', 'Pay for your child’s coaching', 'parent')}
    ${groups.length ? groups.map(g => `
    <div class="eyebrow">${esc(g.child_name || 'Your child')}${g.trainer_name ? ` · ${esc(g.trainer_name)}` : ''}</div>
    <section class="card" style="padding:6px 16px">
      ${g.offers.map(o => `
      <div class="lrow" style="cursor:default;align-items:flex-start">
        <div class="lm" style="flex:1">
          <div class="lt">${esc(o.name)}</div>
          <div class="ls">${esc(priceLabel(o))}${o.blurb ? ' · ' + esc(o.blurb) : ''}</div>
          ${(o.features || []).length ? `<div class="ls" style="margin-top:4px">${(o.features || []).map(f => esc(f)).join(' · ')}</div>` : ''}
        </div>
        <button class="btn green sm" data-pay="${esc(o.offer_id)}" data-child="${esc(o.child_id)}" style="width:auto;padding:0 14px;height:34px;flex:none">${UI.paying === o.offer_id ? '…' : 'Pay'}</button>
      </div>`).join('')}
    </section>`).join('') + `
    <div class="sidebox" style="margin-top:10px"><div class="req-icon b" style="width:34px;height:34px">${icon('lock', 15)}</div>
      <div><div class="tt">Secure checkout via Stripe</div><div class="ts">Opens in your browser. OnStandard never sees or stores your card details.</div></div></div>`
    : `<div class="state-demo"><div class="sd-ic">${icon('bolt', 24)}</div>
      <div class="sd-t">Nothing to fund yet</div>
      <div class="sd-s">When your child connects with a trainer who accepts payments, their packages show up here.</div></div>`}
    <p id="fp-err" class="ls" style="color:var(--red-bright);padding:10px 16px"></p>`;
  },
  mount(root) {
    load();
    root.querySelectorAll('[data-pay]').forEach(b => b.addEventListener('click', async () => {
      const offerId = b.getAttribute('data-pay');
      const childId = b.getAttribute('data-child');
      const err = root.querySelector('#fp-err'); if (err) err.textContent = '';
      UI.paying = offerId; if (window.__render) window.__render();
      const r = await roles.startFundedCheckout(offerId, childId);
      UI.paying = null;
      if (r && r.url) { roles.openExternal(r.url); if (window.__render) window.__render(); }
      else { if (window.__render) window.__render(); const e2 = root.querySelector('#fp-err'); if (e2) e2.textContent = (r && r.error) || 'Could not start checkout'; }
    }));
  },
};
```

- [ ] **Step 3: Create the "Funded plans" screen**

Create `proto/redesign-2026-07/js/screens/funded-plans.js`:

```js
/* Parent "Funded plans": what the parent is paying for, with a Cancel on recurring plans. */
import { backHead, esc } from '../components.js';
import { icon } from '../icons.js';
import * as roles from '../roles.js';
import { groupFundedPlans } from '../funded.js';

let CACHE = { rows: null, loaded: false };
let UI = { cancelling: null };

async function load(force) {
  if (CACHE.loaded && !force) return;
  CACHE.rows = await roles.fetchFundedPlans();
  CACHE.loaded = true;
  if (window.__render) window.__render();
}

function money(c) { const d = c / 100; return `$${Number.isInteger(d) ? d : d.toFixed(2)}`; }
function per(cad) { return cad === 'one-time' ? ' one-time' : cad === 'session' ? ' / session' : cad === 'week' ? ' / wk' : cad === 'month' ? ' / mo' : ''; }

export default {
  render() {
    if (!CACHE.loaded) {
      return `${backHead('Funded plans', 'What you’re paying for', 'parent')}
      <div class="sidebox"><div class="req-icon b" style="width:38px;height:38px">${icon('bolt', 17)}</div><div><div class="tt">Loading…</div></div></div>`;
    }
    const plans = groupFundedPlans(CACHE.rows);
    return `${backHead('Funded plans', 'What you’re paying for', 'parent')}
    ${plans.length ? `<section class="card" style="padding:6px 16px">
      ${plans.map(p => `
      <div class="lrow" style="cursor:default">
        <div class="lm"><div class="lt">${esc(p.offer_name)} ${p.cancelled ? '<span class="ls">· cancelled</span>' : ''}</div>
          <div class="ls">${esc(money(p.amount_cents))}${esc(per(p.cadence))}${p.child_name ? ' · for ' + esc(p.child_name) : ''}</div></div>
        ${(p.recurring && !p.cancelled) ? `<button class="btn ghost sm" data-cancel="${esc(p.id)}" style="width:auto;padding:0 12px;height:30px">${UI.cancelling === p.id ? '…' : 'Cancel'}</button>` : ''}
      </div>`).join('')}
    </section>` : `<div class="state-demo"><div class="sd-ic">${icon('bolt', 24)}</div>
      <div class="sd-t">No funded plans yet</div>
      <div class="sd-s">Plans you pay for your child show up here.</div></div>`}
    <p id="fpl-err" class="ls" style="color:var(--red-bright);padding:10px 16px"></p>`;
  },
  mount(root) {
    load();
    root.querySelectorAll('[data-cancel]').forEach(b => b.addEventListener('click', async () => {
      const id = b.getAttribute('data-cancel');
      if (!window.confirm('Cancel this plan? No future charges will be made.')) return;
      UI.cancelling = id; if (window.__render) window.__render();
      const r = await roles.cancelFundedSubscription(id);
      UI.cancelling = null;
      if (r && r.ok) { await load(true); }
      else { if (window.__render) window.__render(); const e = root.querySelector('#fpl-err'); if (e) e.textContent = (r && r.error) || 'Could not cancel'; }
    }));
  },
};
```

- [ ] **Step 4: Register the two screens**

In `proto/redesign-2026-07/js/screens/index.js`: add imports next to the other Pay screen import (`my-trainer-offers`):
```js
import fundPlan from './fund-plan.js';
import fundedPlans from './funded-plans.js';
```
and add to the `screens` object (next to `'my-trainer-offers': myTrainerOffers,`):
```js
  'fund-plan': fundPlan,
  'funded-plans': fundedPlans,
```

- [ ] **Step 5: Add the two entry rows to the parent dashboard**

Open `proto/redesign-2026-07/js/screens/coach.js`, find the `parent` screen's render (search for the parent dashboard card list). Following the existing `lrow`/`data-go` pattern used there (identical shape to the "Packages" row in `profile.js`), add two rows inside the parent's main card:
```js
      <div class="lrow" data-go="fund-plan">
        <div class="lic" style="background:var(--green-surface);color:var(--green-bright)">${icon('bolt', 17)}</div>
        <div class="lm"><div class="lt">Fund a plan</div><div class="ls">Pay for your child’s coaching package</div></div>
        ${icon('chevron', 17, 'style="color:var(--text-3)"')}
      </div>
      <div class="lrow" data-go="funded-plans">
        <div class="lic" style="background:var(--surface-2)">${icon('lock', 17)}</div>
        <div class="lm"><div class="lt">Funded plans</div><div class="ls">What you’re paying for</div></div>
        ${icon('chevron', 17, 'style="color:var(--text-3)"')}
      </div>
```
(Confirm `icon` and the `lrow`/`lic`/`lm` classes are already imported/used in `coach.js` — they are, since the parent screen already renders similar rows.)

- [ ] **Step 6: Show the beneficiary on the trainer's Payments list**

In `proto/redesign-2026-07/js/screens/trainer-grow.js`, in the Payments section map (the `<div class="ls">${timeAgo(p.created_at)} · fee ...` line), append the parent-funded label. Change:
```js
          <div class="ls">${timeAgo(p.created_at)} · fee $${(p.application_fee_cents / 100).toFixed(2)}</div></div>
```
to:
```js
          <div class="ls">${timeAgo(p.created_at)} · fee $${(p.application_fee_cents / 100).toFixed(2)}${p.beneficiary_name ? ` · parent-funded for ${esc(p.beneficiary_name)}` : ''}</div></div>
```
(`esc` is already imported in `trainer-grow.js`.)

- [ ] **Step 7: Render-check both new screens (no console errors)**

Use the proto render harness (memory: `proto-headless-render-recipe` / `ob2-onboarding-render-harness`): serve `proto/redesign-2026-07` on a local port, boot, seed a signed-in parent (`RT.userId`, `RT.authRole='parent'`), inject a mock `window.sb` returning canned `my_funded_offers`/`my_funded_plans` rows, navigate to `#fund-plan` then `#funded-plans`, and capture `console`/`pageerror`.
Expected: both screens render their populated card, **0 console errors**. Screenshot each (dark) to `qc/pay/` for the founder.

- [ ] **Step 8: Rebuild the proto bundle**

Run: `node scripts/build-proto-zip.mjs`
Expected: `assets/proto.zip` rebuilt + `src/proto/protoVersion.ts` hash bumped.

- [ ] **Step 9: Commit**

```bash
git add proto/redesign-2026-07/js/roles.js proto/redesign-2026-07/js/screens/fund-plan.js proto/redesign-2026-07/js/screens/funded-plans.js proto/redesign-2026-07/js/screens/index.js proto/redesign-2026-07/js/screens/coach.js proto/redesign-2026-07/js/screens/trainer-grow.js assets/proto.zip src/proto/protoVersion.ts
git commit -m "feat(pay): parent-funded plans UI — fund-a-plan + funded-plans + trainer beneficiary label"
```

---

### Task 7: Live end-to-end verification against the Stripe test sandbox

**Files:** none (verification + cleanup; commit only if a fix is needed).

**Interfaces:** Consumes everything above. Produces a proven flow + a pristine prod DB.

- [ ] **Step 1: Deploy the three edge functions**

Run:
```bash
supabase functions deploy pay-offer-checkout
supabase functions deploy stripe-webhook
supabase functions deploy cancel-offer-subscription
```
Expected: each prints `Deployed Functions on project ftwrvylzoyznhbzhgism`.

- [ ] **Step 2: Seed test fixtures (all ids are throwaway, deleted in Step 8)**

Create, via `supabase db query --linked`: a parent user + a child user (public signup + `update auth.users set email_confirmed_at=now()` + password grant to get the parent's JWT, per the OnStandard Pay recipe); `profiles` rows for both; a trainer + practice with `stripe_connect_status='active'` and a real test Connect account (reuse the Connect-onboarding Playwright flow, OR set a known test `acct_…` the platform owns); an active `guardianships(athlete_id=child, guardian_id=parent, status='active')`; an active `practice_clients(practice_id, client_id=child, status='active')`; a monthly offer and a one-time offer priced on that practice.

- [ ] **Step 3: Verify discovery RPCs return the fixtures**

Run (as the parent JWT via PostgREST, or as service role impersonating): `my_funded_offers()` returns the two offers for the child; `my_funded_plans()` returns empty (nothing funded yet).
Expected: 2 offer rows; 0 plans.

- [ ] **Step 4: Fund the one-time offer as the parent**

Call `pay-offer-checkout` with the parent's bearer token and `{ offerId:<one-time>, beneficiaryAthleteId:<child> }`; complete Stripe test Checkout in Playwright (card `4242 4242 4242 4242`).
Expected: an `offer_payments` row with `payer_id=parent`, `beneficiary_athlete_id=child`, correct `amount_cents`/`application_fee_cents` (15%), `status='paid'`.

- [ ] **Step 5: Fund the monthly offer + confirm it records as a subscription**

Same, with the monthly offer.
Expected: an `offer_payments` row carrying a `stripe_subscription_id`, `beneficiary_athlete_id=child`.

- [ ] **Step 6: Cancel the recurring plan as the parent**

Call `cancel-offer-subscription` with the parent's token + the monthly row id.
Expected: `{ ok:true }`; the row's `subscription_cancelled_at` is set; the Stripe subscription shows `canceled` (verify via the Stripe API with the test key). `my_funded_plans` now reports that plan cancelled; `my_practice_payments` shows both payments with `beneficiary_name` = the child.

- [ ] **Step 7: Authorization negatives**

Confirm: a different signed-in user calling `cancel-offer-subscription` on the parent's row gets 403; `pay-offer-checkout` with a `beneficiaryAthleteId` the caller does not actively guardian gets 403; a child not an active client of the practice gets 403.

- [ ] **Step 8: Clean up ALL test data + report**

Delete every seeded row (offer_payments, offers, practice_clients, guardianships, practices, profiles, auth.users) and the Stripe test Connect account/subscriptions. Confirm counts are 0.
Expected: prod pristine. Note explicitly that the LIVE Stripe key was never used for any mutation.

---

## Notes for the implementer

- The OnStandard Pay memory (`onstandard-pay-2026-07-22`) has the exact test-user JWT recipe (signup → confirm-in-DB → password grant) and the `pgcrypto crypt()` password-reset trick.
- Migration 0121 already guards `practices.stripe_connect_*` and enforces `stripe_charge_id` uniqueness; do not re-add those.
- If `deno check` shows errors, diff against `git show HEAD:<file>` — only NEW error codes are real; the `SupabaseClient<any>` inference noise is pre-existing and tolerated (the project deploys via esbuild bundling, not `deno check`).
