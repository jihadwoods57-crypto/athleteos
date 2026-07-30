// OnStandard — billing-overage-report: seats_used stamping + the $10/active-athlete overage.
//
// Two modes, scheduled by 0164's schedule_billing_overage():
//   { mode: "stamp" }    daily — write this month's active-athlete count onto every Stripe-rail
//                        subscription (subscriptions.seats_used), so the Plan & billing screen and
//                        admin_revenue() read reality instead of the permanent zero they read
//                        before 0163.
//   { mode: "invoice" }  monthly (the 2nd) — bill LAST month's overage in arrears: one invoice
//                        item per owner, "N active athletes over your M included · July", finalized
//                        immediately against the card on file.
//
// THE BILLING SAFETY RULE (see 0164): a charge may only happen if its ledger row inserted. The
// (owner_id, month) primary key on billing_overage_reports is the double-billing guard — insert
// first, charge second, write the invoice id back. A crashed run leaves an inspectable row with no
// invoice id; a re-fired cron finds the row present and skips. Stripe is ALSO given an idempotency
// key derived from (owner, month) so even the insert-then-crash-before-charge path cannot
// double-charge on manual replay.
//
// In arrears, not on the subscription: Stripe forbids mixed billing intervals on one subscription,
// so an annual subscriber could never carry a monthly overage item. A standalone monthly invoice
// serves monthly and annual buyers with one code path.
//
// Founding members are billed at their LOCKED overage rate (founding_lock.locked_extra_seat_cents,
// 0161) — the first time that column has ever been read for money, which is what "lock today's
// price permanently" was supposed to mean.
//
// Deploy (--no-verify-jwt; the cron key is the auth):
//   supabase secrets set BILLING_CRON_KEY=... STRIPE_SECRET_KEY=...
//   supabase functions deploy billing-overage-report --no-verify-jwt
import Stripe from 'npm:stripe@17.7.0';
import { createClient } from 'npm:@supabase/supabase-js@2.110.0';

const STRIPE_SECRET_KEY = Deno.env.get('STRIPE_SECRET_KEY') ?? '';
const CRON_KEY = Deno.env.get('BILLING_CRON_KEY') ?? '';
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

function safeEqual(a: string, b: string): boolean {
  const e = new TextEncoder();
  const ab = e.encode(a);
  const bb = e.encode(b);
  if (ab.length !== bb.length) return false;
  let d = 0;
  for (let i = 0; i < ab.length; i++) d |= ab[i] ^ bb[i];
  return d === 0;
}

const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } });

/** First day of the PREVIOUS month, as YYYY-MM-DD — the month a monthly run bills in arrears. */
function previousMonthISO(now = new Date()): string {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  return d.toISOString().slice(0, 10);
}

const MONTH_LABEL = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);
  if (!CRON_KEY || !safeEqual(req.headers.get('x-billing-key') ?? '', CRON_KEY)) {
    return json({ error: 'unauthorized' }, 401);
  }
  if (!SUPABASE_URL || !SERVICE_ROLE) return json({ error: 'not configured' }, 503);

  const svc = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });
  let mode = 'stamp';
  try { mode = String((await req.json())?.mode ?? 'stamp'); } catch { /* empty body = stamp */ }

  // ---- daily: stamp seats_used from this month's activity ----
  if (mode === 'stamp') {
    const { data, error } = await svc.rpc('stamp_seats_used');
    if (error) return json({ error: error.message }, 500);
    return json({ stamped: Array.isArray(data) ? data.length : 0 });
  }

  if (mode !== 'invoice') return json({ error: 'unknown mode' }, 400);

  // ---- monthly: bill last month's overage in arrears ----
  if (!STRIPE_SECRET_KEY) return json({ error: 'stripe not configured' }, 503);
  /* httpClient + the pinned API version, matching every other Stripe-touching function here.
   *
   * This was the ONE that constructed the SDK bare. Without Stripe.createFetchHttpClient() the SDK
   * reaches for Node's http module, which is not the runtime this is on — and the failure lands
   * inside the per-owner try/catch as an opaque string in `failures`, so a cron that bills nobody
   * still answers 200. Being the only function on 2024-06-20 was the same kind of drift: the version
   * is pinned deliberately across the board because stripe-webhook reads `invoice.subscription`,
   * which 2025-03-31.basil restructured. */
  const stripe = new Stripe(STRIPE_SECRET_KEY, {
    apiVersion: '2025-02-24.acacia',
    httpClient: Stripe.createFetchHttpClient(),
  });
  const month = previousMonthISO();
  const monthName = `${MONTH_LABEL[new Date(month + 'T00:00:00Z').getUTCMonth()]} ${month.slice(0, 4)}`;

  // Every live Stripe-rail subscription with a customer to bill.
  const { data: subs, error: subsErr } = await svc.from('subscriptions')
    .select('owner_id, seats, plan_id, stripe_customer_id, status, tier')
    .eq('tier', 'team').in('status', ['active', 'past_due'])
    .not('stripe_customer_id', 'is', null);
  if (subsErr) return json({ error: subsErr.message }, 500);

  let billed = 0, skipped = 0, zero = 0;
  const failures: string[] = [];

  for (const sub of subs ?? []) {
    try {
      const included = Number(sub.seats ?? 0);
      if (!Number.isFinite(included) || included <= 0) { skipped++; continue; }

      const { data: activeData, error: cntErr } = await svc.rpc('active_athlete_count', {
        p_owner: sub.owner_id, p_month: month,
      });
      if (cntErr) { failures.push(`${sub.owner_id}: count ${cntErr.message}`); continue; }
      const active = Number(activeData ?? 0);
      const overage = Math.max(0, active - included);

      // Founding members pay their locked rate; everyone else the standard 1000¢.
      let cents = 1000;
      const { data: lock } = await svc.rpc('founding_lock', { p_user: sub.owner_id });
      const lockRow = Array.isArray(lock) ? lock[0] : lock;
      if (lockRow && Number.isFinite(Number(lockRow.locked_extra_seat_cents))) {
        cents = Math.max(0, Number(lockRow.locked_extra_seat_cents));
      }

      // THE GUARD: the ledger insert is the permission to charge. A conflict means this month was
      // already decided for this owner (billed, zero, or in-flight from a crashed run) — skip.
      const { error: insErr } = await svc.from('billing_overage_reports').insert({
        owner_id: sub.owner_id, month,
        active_athletes: active, included_seats: included,
        overage_seats: overage, cents_per_seat: cents, total_cents: overage * cents,
      });
      let resume = false;   // a prior run inserted the row but died before Stripe answered
      let resumeOverage = overage, resumeCents = cents;
      if (insErr) {
        if (String(insErr.code) !== '23505') { failures.push(`${sub.owner_id}: ledger ${insErr.message}`); continue; }
        // Row exists. Finished rows (invoice id present, or a recorded zero) are settled — skip.
        // An unfinished row (charge owed, no invoice id) is a crashed run's debt: RESUME it, at
        // the numbers the ledger recorded then, not this month's recount — the ledger is what we
        // told ourselves we would charge, and the Stripe idempotency key makes the retry safe.
        const { data: prior } = await svc.from('billing_overage_reports')
          .select('overage_seats, cents_per_seat, stripe_invoice_id')
          .eq('owner_id', sub.owner_id).eq('month', month).maybeSingle();
        if (!prior || prior.stripe_invoice_id || prior.overage_seats === 0 || prior.cents_per_seat === 0) {
          skipped++; continue;
        }
        resume = true;
        resumeOverage = Number(prior.overage_seats);
        resumeCents = Number(prior.cents_per_seat);
      }
      if (!resume && (overage === 0 || cents === 0)) { zero++; continue; }   // row records the zero decision
      const chargeOverage = resume ? resumeOverage : overage;
      const chargeCents = resume ? resumeCents : cents;

      // Belt AND suspenders: Stripe idempotency keyed on (owner, month), so replaying the charge
      // after an insert-then-crash cannot duplicate it either.
      const idem = `overage-${sub.owner_id}-${month}`;
      await stripe.invoiceItems.create({
        customer: sub.stripe_customer_id,
        currency: 'usd',
        unit_amount: chargeCents,
        quantity: chargeOverage,
        description: `${chargeOverage} active athlete${chargeOverage === 1 ? '' : 's'} over your ${included} included · ${monthName}`,
        metadata: { owner_id: sub.owner_id, overage_month: month, plan_id: sub.plan_id ?? '' },
      }, { idempotencyKey: `${idem}-item` });
      const invoice = await stripe.invoices.create({
        customer: sub.stripe_customer_id,
        auto_advance: true,       // finalize + charge the card on file
        pending_invoice_items_behavior: 'include',
        metadata: { owner_id: sub.owner_id, overage_month: month },
      }, { idempotencyKey: `${idem}-inv` });

      await svc.from('billing_overage_reports')
        .update({ stripe_invoice_id: invoice.id })
        .eq('owner_id', sub.owner_id).eq('month', month);
      billed++;
    } catch (e) {
      failures.push(`${sub.owner_id}: ${String((e as Error)?.message ?? e)}`);
    }
  }

  // Failures are reported, never retried blindly inside the run — the ledger row (with no invoice
  // id) is the work list for a manual or next-run retry, and the founder can see exactly who.
  return json({ month, billed, zero_overage: zero, skipped, failures });
});
