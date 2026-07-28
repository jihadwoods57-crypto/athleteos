// OnStandard — cancel-offer-subscription: lets the PAYER (a parent who funded a child's plan, or a
// client who bought their own) cancel their own recurring offer subscription. Ownership is by
// payer_id on the ledger row — not a founder/admin action. Stripe cancels the subscription;
// customer.subscription.deleted (stripe-webhook) independently confirms the same stamp.
//
// Deploy:
//   supabase functions deploy cancel-offer-subscription
import Stripe from 'npm:stripe@^17';
import { createClient } from 'npm:@supabase/supabase-js@^2';
import { clientIpFrom } from '../_shared/client-ip.ts';

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
  const ip = clientIpFrom(req);
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
