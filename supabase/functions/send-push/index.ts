// OnStandard — send-push: a coach/trainer nudges an athlete → an in-app notification PLUS a
// push to the athlete's device(s). Flow:
//   1) authorize the caller with THEIR jwt via can_view (must be linked to the athlete),
//   2) service-role: record the in-app notification (so it shows in the bell even with no token),
//   3) service-role: read the athlete's device tokens + POST to Expo's push API (best-effort).
// verify_jwt stays ON (default) — only a signed-in, linked overseer can call this.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const ANON = Deno.env.get('SUPABASE_ANON_KEY') ?? '';

const json = (obj: unknown, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });

// Best-effort per-IP rate limit (mirrors analyze-meal/assist) so a compromised overseer account
// can't spam pushes. In-memory/per-instance — blunts a single abusive caller. Tunable.
const RL_MAX = Number(Deno.env.get('RATE_LIMIT_PER_MIN') ?? '20');
const RL_WINDOW_MS = 60_000;
const rlHits = new Map<string, { count: number; resetAt: number }>();
function rateLimited(req: Request): boolean {
  const ip = (req.headers.get('x-forwarded-for') ?? '').split(',')[0].trim() || 'unknown';
  const now = Date.now();
  const e = rlHits.get(ip);
  if (!e || now > e.resetAt) { rlHits.set(ip, { count: 1, resetAt: now + RL_WINDOW_MS }); return false; }
  e.count++;
  return e.count > RL_MAX;
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);
  if (rateLimited(req)) return json({ error: 'rate limited, slow down' }, 429);
  const authHeader = req.headers.get('Authorization') ?? '';
  if (!authHeader) return json({ error: 'unauthorized' }, 401);

  let payload: { athlete_id?: string; title?: string; body?: string };
  try {
    payload = await req.json();
  } catch {
    return json({ error: 'bad request' }, 400);
  }
  const athleteId = payload.athlete_id;
  if (!athleteId) return json({ error: 'athlete_id required' }, 400);
  const title = (payload.title ?? 'Your coach sent a nudge').slice(0, 120);
  const message = (payload.body ?? '').slice(0, 300);

  // 1) Authorize with the CALLER's jwt: can_view is true only if they're linked to the athlete.
  const caller = createClient(SUPABASE_URL, ANON, { global: { headers: { Authorization: authHeader } } });
  const { data: allowed, error: viewErr } = await caller.rpc('can_view', { athlete: athleteId });
  if (viewErr || allowed !== true) return json({ error: 'not authorized for this athlete' }, 403);

  // 2) Record the in-app notification (service role bypasses the self-only insert policy).
  const svc = createClient(SUPABASE_URL, SERVICE_ROLE);
  await svc.from('notifications').insert({ user_id: athleteId, kind: 'nudge', title, body: message });

  // 3) Push to the athlete's registered devices (best-effort; the feed entry is already saved).
  const { data: toks } = await svc.from('device_tokens').select('token').eq('user_id', athleteId);
  const tokens = (toks ?? []).map((t: { token: string }) => t.token).filter(Boolean);
  let pushed = 0;
  if (tokens.length > 0) {
    try {
      const r = await fetch('https://exp.host/--/api/v2/push/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(tokens.map((to) => ({ to, title, body: message, sound: 'default' }))),
      });
      if (r.ok) pushed = tokens.length;
    } catch {
      /* push is best-effort; the in-app notification already landed */
    }
  }
  return json({ ok: true, pushed });
});
