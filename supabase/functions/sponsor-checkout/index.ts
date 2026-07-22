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
