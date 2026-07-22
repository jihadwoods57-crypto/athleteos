// OnStandard — connect-webhook: Stripe CONNECT account status changes (account.updated).
//
// Distinct from stripe-webhook (which handles the PLATFORM's own subscription billing): Connect
// events are a separate Stripe event stream with their own webhook endpoint + signing secret in
// the Dashboard (Developers -> Webhooks -> Connect events on connected accounts). This turns
// "the trainer finished/lost/regained onboarding" into the practices.stripe_connect_status the
// rest of the app reads (my_connect_status, my_trainer_offers' gate).
//
// Deploy (JWT OFF — Stripe authenticates itself via signature):
//   supabase secrets set STRIPE_SECRET_KEY=sk_live_... STRIPE_CONNECT_WEBHOOK_SECRET=whsec_...
//   supabase functions deploy connect-webhook --no-verify-jwt
// Then in Stripe: Developers -> Webhooks -> + Add endpoint -> "Listen to events on Connected
// accounts" -> <project>/functions/v1/connect-webhook -> account.updated.
import Stripe from 'npm:stripe@^17';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const STRIPE_SECRET_KEY = Deno.env.get('STRIPE_SECRET_KEY') ?? '';
const STRIPE_CONNECT_WEBHOOK_SECRET = Deno.env.get('STRIPE_CONNECT_WEBHOOK_SECRET') ?? '';
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

const json = (obj: unknown, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });

// Lazy construction: `new Stripe('')` throws at module load — see stripe-webhook for why this
// must be deferred until after the config gate confirms the key exists.
let _stripe: Stripe | null = null;
function stripeClient(): Stripe {
  if (!_stripe) _stripe = new Stripe(STRIPE_SECRET_KEY, { apiVersion: '2025-02-24.acacia', httpClient: Stripe.createFetchHttpClient() });
  return _stripe;
}
let _cryptoProvider: ReturnType<typeof Stripe.createSubtleCryptoProvider> | null = null;
function cryptoProvider() {
  if (!_cryptoProvider) _cryptoProvider = Stripe.createSubtleCryptoProvider();
  return _cryptoProvider;
}

/** Map a Connect account's live state to our status enum. Stripe's own three-signal read:
 *  fully able to charge+payout = active; a disabled_reason on requirements = restricted (Stripe
 *  paused something, e.g. a document expired); anything else mid-onboarding = pending. */
function mapAccountStatus(acct: Stripe.Account): 'pending' | 'active' | 'restricted' {
  if (acct.requirements?.disabled_reason) return 'restricted';
  if (acct.charges_enabled && acct.payouts_enabled) return 'active';
  return 'pending';
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);

  const sig = req.headers.get('stripe-signature');
  if (!sig) return json({ error: 'missing signature' }, 400);

  if (!STRIPE_SECRET_KEY || !STRIPE_CONNECT_WEBHOOK_SECRET || !SUPABASE_URL || !SERVICE_ROLE) {
    console.error('connect-webhook: missing configuration');
    return json({ error: 'server not configured' }, 503);
  }

  const raw = await req.text();
  let event: Stripe.Event;
  try {
    event = await stripeClient().webhooks.constructEventAsync(raw, sig, STRIPE_CONNECT_WEBHOOK_SECRET, undefined, cryptoProvider());
  } catch (e) {
    console.error('connect-webhook: signature verification failed:', (e as Error).message);
    return json({ error: 'invalid signature' }, 400);
  }

  const svc = createClient(SUPABASE_URL, SERVICE_ROLE);

  try {
    if (event.type === 'account.updated') {
      const acct = event.data.object as Stripe.Account;
      const status = mapAccountStatus(acct);
      const { error } = await svc.from('practices')
        .update({ stripe_connect_status: status, stripe_connect_updated_at: new Date().toISOString() })
        .eq('stripe_connect_account_id', acct.id);
      if (error) throw error;
    }
    // Every other Connect event type is acknowledged, not acted on, in v1.
  } catch (e) {
    console.error(`connect-webhook: handling ${event.type} failed:`, e);
    return json({ error: 'handler error' }, 500); // 500 -> Stripe retries, event not lost
  }

  return json({ received: true });
});
