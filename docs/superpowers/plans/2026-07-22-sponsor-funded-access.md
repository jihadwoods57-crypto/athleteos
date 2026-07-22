# Sponsor-Funded Access Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** A sponsor buys a batch of premium seats (Stripe platform checkout) and gets a redemption code; athletes redeem the code to unlock the premium tier (same entitlement as premium reports/Deep Dive) for the sponsored window.

**Architecture:** Two new tables (`sponsorships`, `sponsored_access`); a combined `has_premium_access(user)` (paid subscription OR active sponsored grant) that deep-analysis + monthly-report now call; a `sponsor-checkout` edge function (platform charge, ad-hoc price_data × seats); a `stripe-webhook` branch that records the sponsorship + generates a code; an atomic `redeem_sponsor_code(code)` RPC; sponsor + athlete proto screens.

**Tech Stack:** Supabase Postgres (migration, SECURITY DEFINER RPCs, RLS), Deno edge functions (`npm:stripe@^17`, `npm:@supabase/supabase-js@^2`), the proto WebView.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-22-sponsor-funded-access-design.md`.
- Branch `feat/founder-command-center` is shared. **Verify the highest migration number before creating the file** (`ls supabase/migrations | sort | tail -3`); this plan writes `0132`, bump if taken. Apply migrations DIRECTLY via `supabase db query --linked -f <file>` (NOT `db push`); record with `supabase migration repair --status applied <N>`.
- `deno check` new errors acceptable ONLY if they match the pre-existing tolerated `SupabaseClient<any>`/tool-schema pattern (diff vs `git show HEAD:<file>`).
- This is a PLATFORM charge (sponsor pays the platform), NOT a Connect destination charge — do NOT add `managed_payments` opt-out or `transfer_data` here.
- Premium is unlocked by EITHER an active paid subscription OR a `sponsored_access` row with `expires_at > now()`. All writes are server-side (webhook / SECURITY DEFINER RPC); the atomic seat claim must not oversell under concurrency.
- `git add` ONLY the explicit files each task names. NEVER `git add -A` (shared branch). Copy: plain language, sentence case, no em dashes in UI strings.

---

### Task 1: Migration — tables + entitlement + redeem RPC

**Files:** Create `supabase/migrations/0132_sponsor_funded_access.sql`

**Interfaces:** Produces tables `sponsorships`, `sponsored_access`; `has_premium_access(p_user uuid) -> boolean`; `redeem_sponsor_code(p_code text) -> table(ok boolean, reason text, label text, expires_at timestamptz)`.

- [ ] **Step 1: Verify next migration number** — `ls supabase/migrations | sort | tail -3`. If `0132_*` exists, use the next free number everywhere.

- [ ] **Step 2: Write the migration** — create `supabase/migrations/0132_sponsor_funded_access.sql`:

```sql
-- 0132 — sponsor-funded access: a sponsor buys premium seats; athletes redeem a code to unlock premium.
create table if not exists public.sponsorships (
  id             uuid primary key default gen_random_uuid(),
  sponsor_id     uuid not null references profiles(id) on delete cascade,
  sponsor_label  text not null default '',
  code           text not null unique,
  seats          int  not null check (seats > 0),
  seats_claimed  int  not null default 0 check (seats_claimed >= 0),
  months         int  not null default 12 check (months > 0),
  status         text not null default 'active' check (status in ('active','closed')),
  stripe_checkout_session_id text,
  stripe_payment_intent_id   text,
  amount_cents   int,
  created_at     timestamptz not null default now()
);
create index if not exists sponsorships_sponsor_idx on public.sponsorships (sponsor_id);
create unique index if not exists sponsorships_session_uq on public.sponsorships (stripe_checkout_session_id);

create table if not exists public.sponsored_access (
  athlete_id     uuid not null references profiles(id) on delete cascade,
  sponsorship_id uuid not null references sponsorships(id) on delete cascade,
  granted_at     timestamptz not null default now(),
  expires_at     timestamptz not null,
  primary key (athlete_id, sponsorship_id)
);
create index if not exists sponsored_access_active_idx on public.sponsored_access (athlete_id, expires_at);

alter table public.sponsorships enable row level security;
alter table public.sponsored_access enable row level security;
drop policy if exists sponsorships_read_own on public.sponsorships;
create policy sponsorships_read_own on public.sponsorships for select using (sponsor_id = auth.uid());
drop policy if exists sponsored_access_read_own on public.sponsored_access;
create policy sponsored_access_read_own on public.sponsored_access for select using (athlete_id = auth.uid());
-- No client INSERT/UPDATE policy on either: webhook (sponsorships) + redeem RPC (sponsored_access) write.

-- Combined premium entitlement: a paid subscription OR an active sponsored grant.
create or replace function public.has_premium_access(p_user uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists(
    select 1 from subscriptions
    where owner_id = p_user and status in ('active','past_due')
      and coalesce(tier,'') not in ('','preview','free','none','trial_expired')
  ) or exists(
    select 1 from sponsored_access where athlete_id = p_user and expires_at > now()
  );
$$;
grant execute on function public.has_premium_access(uuid) to authenticated, service_role;

-- Atomic redemption: claims exactly one seat (no oversell under concurrency), idempotent per athlete.
create or replace function public.redeem_sponsor_code(p_code text)
returns table (ok boolean, reason text, label text, expires_at timestamptz)
language plpgsql security definer set search_path = public as $$
declare
  v_sp record;
  v_uid uuid := auth.uid();
  v_exp timestamptz;
begin
  if v_uid is null then return query select false, 'sign_in', ''::text, null::timestamptz; return; end if;
  select * into v_sp from public.sponsorships where upper(code) = upper(btrim(p_code)) and status = 'active';
  if not found then return query select false, 'invalid_code', ''::text, null::timestamptz; return; end if;
  select sa.expires_at into v_exp from public.sponsored_access sa where sa.athlete_id = v_uid and sa.sponsorship_id = v_sp.id;
  if found then return query select true, 'already_redeemed', v_sp.sponsor_label, v_exp; return; end if;
  -- Guarded UPDATE: Postgres re-checks the predicate under the row lock, so concurrent redeems of the
  -- last seat let exactly one win.
  update public.sponsorships set seats_claimed = seats_claimed + 1 where id = v_sp.id and seats_claimed < seats;
  if not found then return query select false, 'full', v_sp.sponsor_label, null::timestamptz; return; end if;
  v_exp := now() + make_interval(months => v_sp.months);
  insert into public.sponsored_access (athlete_id, sponsorship_id, expires_at) values (v_uid, v_sp.id, v_exp);
  return query select true, 'redeemed', v_sp.sponsor_label, v_exp;
end $$;
grant execute on function public.redeem_sponsor_code(text) to authenticated;
```

- [ ] **Step 3: Apply** — `supabase db query --linked -f supabase/migrations/0132_sponsor_funded_access.sql` → expect `"rows": []`.

- [ ] **Step 4: Verify** — `supabase db query --linked "select (select count(*) from information_schema.tables where table_name in ('sponsorships','sponsored_access')) as tables, (select count(*) from pg_proc where proname in ('has_premium_access','redeem_sponsor_code')) as fns"` → tables 2, fns 2.

- [ ] **Step 5: Record + commit**
```bash
supabase migration repair --status applied 0132
git add supabase/migrations/0132_sponsor_funded_access.sql
git commit -m "feat(sponsor): 0132 sponsorships + sponsored_access + has_premium_access + redeem_sponsor_code"
```

---

### Task 2: Entitlement — deep-analysis + monthly-report honor sponsored access

**Files:** Modify `supabase/functions/deep-analysis/index.ts`, `supabase/functions/monthly-report/index.ts`

**Interfaces:** Both functions gate on `has_premium_access(userId)` (subscription OR sponsored) instead of reading `subscriptions` directly.

- [ ] **Step 1: deep-analysis** — replace its gate block:
```ts
  if (REQUIRES_PLAN) {
    const { data: sub } = await svc.from('subscriptions').select('status, tier').eq('owner_id', userId).maybeSingle();
    if (!isPremiumUnlocked(sub)) return json({ error: 'deep analysis requires a plan' }, 402, cors);
  }
```
with:
```ts
  if (REQUIRES_PLAN) {
    const { data: hasAccess } = await svc.rpc('has_premium_access', { p_user: userId });
    if (hasAccess !== true) return json({ error: 'deep analysis requires a plan' }, 402, cors);
  }
```
(Leave the `isPremiumUnlocked` import in place if still referenced elsewhere; if it becomes unused, remove the import line to keep `deno check` clean.)

- [ ] **Step 2: monthly-report** — replace its gate block:
```ts
  if (REQUIRES_PLAN) {
    const { data: sub } = await svc.from('subscriptions').select('status, tier').eq('owner_id', userId).maybeSingle();
    if (!isPremiumUnlocked(sub)) return json({ error: 'monthly report requires a plan' }, 402, cors);
  }
```
with:
```ts
  if (REQUIRES_PLAN) {
    const { data: hasAccess } = await svc.rpc('has_premium_access', { p_user: userId });
    if (hasAccess !== true) return json({ error: 'monthly report requires a plan' }, 402, cors);
  }
```
(Remove the now-unused `isPremiumUnlocked` import from monthly-report if nothing else uses it.)

- [ ] **Step 3: Type-check** — `deno check` both files; no new error codes vs `git show HEAD:<file>`.

- [ ] **Step 4: Commit**
```bash
git add supabase/functions/deep-analysis/index.ts supabase/functions/monthly-report/index.ts
git commit -m "feat(sponsor): premium features honor sponsored access via has_premium_access"
```

---

### Task 3: `sponsor-checkout` edge function

**Files:** Create `supabase/functions/sponsor-checkout/index.ts`

**Interfaces:** Consumes `{ seats:number, label?:string }` + bearer. Produces `{ url }` (Stripe Checkout); metadata `kind='sponsor_seats'`.

- [ ] **Step 1: Write the function** — create `supabase/functions/sponsor-checkout/index.ts`:

```ts
// OnStandard — sponsor-checkout: a signed-in sponsor buys a batch of premium seats. PLATFORM charge
// (the sponsor pays OnStandard), NOT a Connect destination charge — no transfer_data / managed_payments.
// stripe-webhook (kind='sponsor_seats') records the sponsorship + generates the redemption code.
//
// Deploy: supabase secrets set SPONSOR_SEAT_PRICE_CENTS=2000 SPONSOR_MONTHS=12
//         supabase functions deploy sponsor-checkout
import Stripe from 'npm:stripe@^17';
import { createClient } from 'npm:@supabase/supabase-js@^2';

const STRIPE_SECRET_KEY = Deno.env.get('STRIPE_SECRET_KEY') ?? '';
const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY');
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const SEAT_PRICE = (() => { const n = Number(Deno.env.get('SPONSOR_SEAT_PRICE_CENTS') ?? '2000'); return Number.isFinite(n) && n > 0 ? Math.floor(n) : 2000; })();
const RETURN_BASE = Deno.env.get('BILLING_RETURN_URL') ?? (SUPABASE_URL ? `${SUPABASE_URL}/functions/v1/billing-return` : '');

const stripe = new Stripe(STRIPE_SECRET_KEY, { apiVersion: '2025-02-24.acacia', httpClient: Stripe.createFetchHttpClient() });

const ALLOWED_ORIGINS = (Deno.env.get('ALLOWED_ORIGINS') ?? '').split(',').map((o) => o.trim()).filter(Boolean);
const BASE_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Headers': 'authorization, content-type, apikey, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS', Vary: 'Origin',
};
function corsFor(req: Request): Record<string, string> {
  const origin = req.headers.get('origin');
  if (origin && ALLOWED_ORIGINS.includes(origin)) return { ...BASE_HEADERS, 'Access-Control-Allow-Origin': origin };
  return BASE_HEADERS;
}
const RL_MAX = Number(Deno.env.get('RATE_LIMIT_PER_MIN') ?? '10');
const rlHits = new Map<string, { count: number; resetAt: number }>();
function rateLimited(req: Request): boolean {
  const ip = (req.headers.get('x-forwarded-for') ?? '').split(',')[0].trim() || 'unknown';
  const now = Date.now();
  const e = rlHits.get(ip);
  if (!e || now > e.resetAt) { rlHits.set(ip, { count: 1, resetAt: now + 60_000 }); return false; }
  e.count++; return e.count > RL_MAX;
}
async function resolveUser(req: Request): Promise<{ id: string; email: string | null } | null> {
  const token = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '').trim();
  if (!token || !SUPABASE_URL || !SUPABASE_ANON_KEY || token === SUPABASE_ANON_KEY) return null;
  try {
    const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    const { data, error } = await sb.auth.getUser(token);
    if (error || !data.user) return null;
    return { id: data.user.id, email: data.user.email ?? null };
  } catch { return null; }
}
const json = (obj: unknown, status: number, cors: Record<string, string>) =>
  new Response(JSON.stringify(obj), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  const cors = corsFor(req);
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405, cors);
  if (rateLimited(req)) return json({ error: 'rate limited, slow down' }, 429, cors);
  if (!STRIPE_SECRET_KEY) return json({ error: 'billing not configured' }, 503, cors);
  if (!SUPABASE_URL || !SERVICE_ROLE) return json({ error: 'server not configured' }, 500, cors);

  const user = await resolveUser(req);
  if (!user) return json({ error: 'sign in required' }, 401, cors);

  let body: { seats?: unknown; label?: unknown };
  try { body = await req.json(); } catch { return json({ error: 'bad request' }, 400, cors); }
  const seats = Math.floor(Number(body.seats));
  if (!Number.isFinite(seats) || seats < 1 || seats > 500) return json({ error: 'choose 1 to 500 seats' }, 400, cors);
  const label = typeof body.label === 'string' ? body.label.slice(0, 80) : '';

  const metadata = { kind: 'sponsor_seats', sponsor_id: user.id, seats: String(seats), label };
  try {
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      client_reference_id: user.id,
      customer_email: user.email ?? undefined,
      line_items: [{
        price_data: { currency: 'usd', product_data: { name: `OnStandard premium — ${seats} seat${seats === 1 ? '' : 's'}` }, unit_amount: SEAT_PRICE },
        quantity: seats,
      }],
      metadata,
      payment_intent_data: { metadata },
      success_url: `${RETURN_BASE}?state=sponsor_success`,
      cancel_url: `${RETURN_BASE}?state=sponsor_cancel`,
    });
    return json({ url: session.url }, 200, cors);
  } catch (e) {
    console.error('sponsor-checkout error:', e);
    return json({ error: 'checkout unavailable' }, 502, cors);
  }
});
```

- [ ] **Step 2: Type-check** — `deno check supabase/functions/sponsor-checkout/index.ts` → exit 0 or only the tolerated `SupabaseClient<any>` noise (diff vs `pay-offer-checkout`).

- [ ] **Step 3: Commit**
```bash
git add supabase/functions/sponsor-checkout/index.ts
git commit -m "feat(sponsor): sponsor-checkout edge function (platform charge for premium seats)"
```

---

### Task 4: `stripe-webhook` — record the sponsorship + generate a code

**Files:** Modify `supabase/functions/stripe-webhook/index.ts`

**Interfaces:** On `checkout.session.completed` with `metadata.kind==='sponsor_seats'`, insert a `sponsorships` row with a unique code. Idempotent on `stripe_checkout_session_id`.

- [ ] **Step 1: Add a code generator + handler** — near the offer helpers, add:
```ts
// Short, unambiguous redemption code (no 0/O/1/I). Not a secret on its own — the sponsorship row's
// unique index + the [1,500]-seat cap bound guessing; collisions retry.
function sponsorCode(): string {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < 8; i++) s += A[Math.floor(Math.random() * A.length)];
  return `SP-${s.slice(0, 4)}-${s.slice(4)}`;
}

async function handleSponsorSeats(svc: ReturnType<typeof createClient>, session: Stripe.Checkout.Session): Promise<void> {
  const sponsorId = session.metadata?.sponsor_id ?? session.client_reference_id ?? '';
  if (!UUID_RE.test(sponsorId)) { console.error('stripe-webhook: sponsor_seats with no sponsor_id', session.id); return; }
  // Idempotent — a Stripe retry must not create a second batch for the same checkout.
  const { data: existing } = await svc.from('sponsorships').select('id').eq('stripe_checkout_session_id', session.id).maybeSingle();
  if (existing) return;
  const seats = Math.max(1, Math.floor(Number(session.metadata?.seats ?? '1')) || 1);
  const label = (session.metadata?.label ?? '').toString().slice(0, 80);
  const months = Math.max(1, Math.floor(Number(Deno.env.get('SPONSOR_MONTHS') ?? '12')) || 12);
  const piId = typeof session.payment_intent === 'string' ? session.payment_intent : session.payment_intent?.id ?? null;
  let amount: number | null = null;
  if (piId) { try { const pi = await stripeClient().paymentIntents.retrieve(piId); amount = pi.amount ?? null; } catch { /* best-effort */ } }
  // Insert with a fresh code; on the rare unique-code collision, retry a couple of times.
  for (let attempt = 0; attempt < 3; attempt++) {
    const { error } = await svc.from('sponsorships').insert({
      sponsor_id: sponsorId, sponsor_label: label, code: sponsorCode(), seats, months,
      stripe_checkout_session_id: session.id, stripe_payment_intent_id: piId, amount_cents: amount,
    });
    if (!error) return;
    if (!String(error.message || '').toLowerCase().includes('duplicate')) throw error;
    if (String(error.message).includes('stripe_checkout_session_id')) return; // idempotent race — already inserted
  }
  throw new Error('sponsor code generation failed after retries');
}
```

- [ ] **Step 2: Route it** — in the `checkout.session.completed` case, add a branch alongside the existing `offer_purchase` check (before the platform-subscription handling):
```ts
        if (session.metadata?.kind === 'sponsor_seats') {
          await handleSponsorSeats(svc, session);
          break;
        }
```
(Place it right next to `if (session.metadata?.kind === 'offer_purchase') { await handleOfferCheckout(svc, session); break; }`.) Also add `sponsor_seats` to the header comment listing handled `checkout.session.completed` variants.

- [ ] **Step 3: Type-check** — `deno check supabase/functions/stripe-webhook/index.ts 2>&1 | grep -oE "TS[0-9]+" | sort | uniq -c`; no new error CODES vs before this task.

- [ ] **Step 4: Commit**
```bash
git add supabase/functions/stripe-webhook/index.ts
git commit -m "feat(sponsor): stripe-webhook records sponsorship + redemption code on sponsor_seats checkout"
```

---

### Task 5: Proto UI — sponsor + redeem screens

**Files:** Modify `proto/redesign-2026-07/js/roles.js`; Create `proto/redesign-2026-07/js/screens/sponsor.js`, `proto/redesign-2026-07/js/screens/redeem-code.js`; Modify `proto/redesign-2026-07/js/screens/index.js`; Modify `proto/redesign-2026-07/js/screens/profile.js` (entry points)

**Interfaces:** `roles.startSponsorCheckout(seats,label)`, `roles.fetchMySponsorships()`, `roles.redeemSponsorCode(code)`; routes `sponsor`, `redeem-code`.

- [ ] **Step 1: roles.js wrappers** — after the report wrappers, add:
```js
/** Sponsor: start a Stripe checkout for N premium seats. Returns { url } or { error }. */
export async function startSponsorCheckout(seats, label) { return callFn('sponsor-checkout', { seats, label }); }
/** Sponsor: my purchased seat batches (code + claimed count). */
export async function fetchMySponsorships() {
  const c = sb(); if (!c) return [];
  try { const { data } = await c.from('sponsorships').select('*').order('created_at', { ascending: false }); return data || []; } catch { return []; }
}
/** Athlete: redeem a sponsor code. Returns the RPC row { ok, reason, label, expires_at } or { error }. */
export async function redeemSponsorCode(code) {
  const c = sb(); if (!c) return { error: 'not configured' };
  try { const { data, error } = await c.rpc('redeem_sponsor_code', { p_code: code }); if (error) return { error: error.message }; return Array.isArray(data) ? data[0] : data; }
  catch (e) { return { error: String((e && e.message) || e) }; }
}
```

- [ ] **Step 2: Create `sponsor.js`** — model on `my-trainer-offers.js` structure. A seats number input + a label input + a "Buy seats" button → `startSponsorCheckout` → `openExternal(url)`. Below, list `fetchMySponsorships()` rows: each shows the `code` (big, copyable), `seats_claimed`/`seats`, and label. Sentence case, no em dashes.

- [ ] **Step 3: Create `redeem-code.js`** — a code input + "Redeem" button → `redeemSponsorCode(code)`. On `ok:true` show "Premium unlocked" + (label ? "Sponsored by <label>" : "") + "until <expires_at date>". On failure map `reason`: `invalid_code`→"That code isn't valid.", `full`→"This sponsorship is full.", `already_redeemed`→"You already redeemed this.", else the error. Sentence case, no em dashes.

- [ ] **Step 4: Register** — in `screens/index.js` import both and add `'sponsor': sponsor, 'redeem-code': redeemCode,` to the `screens` map.

- [ ] **Step 5: Entry points** — in `screens/profile.js`, add two rows following the existing `lrow`/`data-go` pattern: `data-go="redeem-code"` ("Redeem a code" / "Unlock premium with a sponsor code") for everyone, and `data-go="sponsor"` ("Sponsor access" / "Fund premium for a group") — place both in a sensible section.

- [ ] **Step 6: Syntax gate** — `node --check` each new/modified file. All pass.

- [ ] **Step 7: Rebuild** — `node scripts/build-proto-zip.mjs`.

- [ ] **Step 8: Commit**
```bash
git add proto/redesign-2026-07/js/roles.js proto/redesign-2026-07/js/screens/sponsor.js proto/redesign-2026-07/js/screens/redeem-code.js proto/redesign-2026-07/js/screens/index.js proto/redesign-2026-07/js/screens/profile.js assets/proto.zip src/proto/protoVersion.ts
git commit -m "feat(sponsor): sponsor + redeem-code proto screens"
```

---

### Task 6: Live verification + cleanup (controller-run)

- [ ] **Step 1: Deploy** — `sponsor-checkout`, `stripe-webhook`, `deep-analysis`, `monthly-report`. Set `SPONSOR_SEAT_PRICE_CENTS`/`SPONSOR_MONTHS` if desired.
- [ ] **Step 2: Seed** — a sponsor (JWT) + two athletes (JWTs).
- [ ] **Step 3: Purchase** — call `sponsor-checkout` as the sponsor with `seats:1` → complete the Stripe test checkout (card 4242) → confirm a `sponsorships` row with a `code`, `seats=1`, `seats_claimed=0`, and the real `amount_cents`.
- [ ] **Step 4: Redeem** — athlete A calls `redeem_sponsor_code(code)` → `ok, reason='redeemed'`; a `sponsored_access` row exists; `sponsorships.seats_claimed=1`; `has_premium_access(A)` → true; with `MONTHLY_REQUIRES_PLAN=1`, `monthly-report` now returns 200 for A (ties to premium reports).
- [ ] **Step 5: Oversell + idempotency** — athlete B redeems the same (now full) code → `ok=false, reason='full'`; athlete A re-redeems → `ok=true, reason='already_redeemed'`, no second seat consumed.
- [ ] **Step 6: RLS** — athlete A cannot `select` the sponsor's `sponsorships` row; the sponsor cannot read A's `sponsored_access`.
- [ ] **Step 7: Cleanup** — delete sponsored_access, sponsorships, the seeded users + profiles + auth.users + any subscriptions; confirm counts 0. Note the LIVE key was never used for a mutation. Report.

## Notes for the implementer
- Reuse the OnStandard Pay test-user recipe (signup → confirm-in-DB → password grant) and the hosted-checkout Playwright flow (card 4242, uncheck the Link "save my info", fill billing name + ZIP).
- `deno check` noise: diff vs `git show HEAD:<file>`; only NEW error codes are real.
