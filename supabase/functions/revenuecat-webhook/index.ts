// OnStandard — revenuecat-webhook: the CONSUMER IAP entitlement seam (the consumer analogue of
// stripe-webhook's "first dollar", 2026-07-21).
//
// RevenueCat aggregates Apple App Store + Google Play subscriptions and calls this endpoint on
// every lifecycle change (purchase, renewal, billing issue, cancellation, expiration). We
// authenticate the call by a shared Authorization header (set in the RevenueCat dashboard), map
// the event to a `subscriptions` row (0010 + 0042 + 0102) with service_role — the ONLY writer of
// that table — and upsert it. The client only ever READS its own row (queries.ts:fetchEntitlement),
// so a user can never grant themselves a plan. This is the ACCESS/billing half only; no athlete
// data is touched.
//
// OWNER RESOLUTION: the client sets the RevenueCat App User ID to the signed-in profile UUID, so
// each event carries its owner. Events without a clean UUID are acknowledged (200) and logged,
// never guessed — exactly like stripe-webhook.
//
// Lifecycle handled (see _shared/revenuecat.ts for the mapping, which is unit-tested):
//   INITIAL_PURCHASE / RENEWAL / PRODUCT_CHANGE / UNCANCELLATION -> active
//   CANCELLATION        -> active + cancel_at_period_end (access runs to expiry; offer a save)
//   BILLING_ISSUE       -> past_due (grace window; app shows "update your card")
//   SUBSCRIPTION_PAUSED -> paused
//   EXPIRATION          -> canceled, tier back to preview
//
// Deploy (JWT OFF — RevenueCat has no Supabase JWT; it authenticates via the shared header):
//   supabase secrets set REVENUECAT_WEBHOOK_SECRET=<a long random string>
//   supabase functions deploy revenuecat-webhook --no-verify-jwt
// Then in RevenueCat: Integrations -> Webhooks -> URL = <project>/functions/v1/revenuecat-webhook,
//   Authorization header value = the same REVENUECAT_WEBHOOK_SECRET. Until the secret is set this
//   endpoint answers 503 (inert), so deploying it early is safe.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { rcEventToRow, ownerOf, type RcEvent } from '../_shared/revenuecat.ts';

const WEBHOOK_SECRET = Deno.env.get('REVENUECAT_WEBHOOK_SECRET') ?? '';
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

const json = (obj: unknown, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);

  // Authenticate the request SHAPE first: RC always sends the Authorization header we configured.
  // A call without it is a probe/scanner -> 401 (fail closed, no retry storm), mirroring how
  // stripe-webhook rejects a missing signature.
  const auth = req.headers.get('authorization') ?? '';
  if (!auth) return json({ error: 'missing authorization' }, 401);

  // Config gate AFTER the header-presence check. An authorized-looking call we can't verify because
  // the secret is unset is a transient server condition: 503 tells RevenueCat to retry with backoff
  // (the event is preserved for when billing is configured) rather than 500 (also retried but reads
  // as a crash) or 200 (which would silently DROP a real paid event). Consumer billing is not live
  // yet (no REVENUECAT_WEBHOOK_SECRET), so today this only tames probe traffic; it also makes the
  // endpoint correct the moment the secret lands.
  if (!WEBHOOK_SECRET || !SUPABASE_URL || !SERVICE_ROLE) {
    console.error('revenuecat-webhook: missing configuration');
    return json({ error: 'server not configured' }, 503);
  }

  // The shared secret is the endpoint's only authentication. Accept "Bearer <secret>" or the bare
  // secret (RevenueCat sends the raw header value you enter).
  const presented = auth.startsWith('Bearer ') ? auth.slice(7) : auth;
  if (presented !== WEBHOOK_SECRET) {
    console.error('revenuecat-webhook: bad authorization');
    return json({ error: 'unauthorized' }, 401);
  }

  const body = await req.json().catch(() => null) as { event?: RcEvent } | null;
  const ev = body?.event;
  if (!ev || typeof ev !== 'object') return json({ error: 'bad request' }, 400);

  const owner = ownerOf(ev);
  if (!owner) {
    // No resolvable owner: acknowledge so RevenueCat stops retrying, but never guess who it is.
    console.error('revenuecat-webhook: event with no valid app_user_id', ev.type);
    return json({ received: true, note: 'no owner reference' });
  }

  const fields = rcEventToRow(ev, new Date().toISOString());
  if (!fields) return json({ received: true, note: 'ignored event type' }); // ack + no-op

  const svc = createClient(SUPABASE_URL, SERVICE_ROLE);
  try {
    // owner_id is the PK, so upsert is idempotent — a RevenueCat retry can't create a duplicate.
    const { error } = await svc.from('subscriptions').upsert({ owner_id: owner, ...fields });
    if (error) throw error;
  } catch (e) {
    // A DB error returns 500 so RevenueCat RETRIES (the event isn't lost). Never leak detail.
    console.error(`revenuecat-webhook: handling ${ev.type} failed:`, e);
    return json({ error: 'handler error' }, 500);
  }

  return json({ received: true });
});
