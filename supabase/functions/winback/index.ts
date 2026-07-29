// OnStandard — winback: the one message that reaches someone who already stopped.
//
// WHY THIS EXISTS
// Every other reminder in the product is anchored to a requirement that exists TODAY. An athlete
// who logs nothing gets a 'soon', a 'due', and then silence — permanently. There was no D3, no
// D7, no "your log is still here", no path back. The single moment retention is actually decided
// was the single moment nothing spoke.
//
// It cannot live in the on-device planner (proto notify-plan.js). That planner only runs when the
// app is opened, and schedules today and tomorrow. Someone who has not opened the app in a week
// has nothing scheduled and never will. Winback has to be server-side by nature.
//
// WHY EVERY RULE IS ABOUT NOT SENDING
// See _shared/winback.ts for the selection contract. Two messages in a lifetime (day 3, day 10),
// never to a brand-new account, never to someone who never logged at all, never twice for the
// same stage, never to someone opted out. Anyone still gone after day 10 has told us something,
// and the respectful reading is that they are done.
//
// SAFETY: flag-gated and fails CLOSED. With `winback` absent or off this function is a no-op, so
// it can be deployed and scheduled long before anyone decides to turn it on.
//
// INVOCATION: daily, shared-key protected (deploy with --no-verify-jwt):
//   supabase secrets set WINBACK_CRON_KEY=<long random string>
//   supabase functions deploy winback --no-verify-jwt
//   select schedule_winback('https://<project>.supabase.co/functions/v1/winback', '<key>');
// Add ?dry=1 to see exactly who would be selected without writing or sending anything.
import { createClient } from 'npm:@supabase/supabase-js@^2';
import { selectWinbacks, type LapsedCandidate } from '../_shared/winback.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const CRON_KEY = Deno.env.get('WINBACK_CRON_KEY') ?? '';
// Start small. Raise it only once the return rate says the message is wanted.
const DAILY_CAP = Math.max(1, Number(Deno.env.get('WINBACK_DAILY_CAP') ?? '100'));
// How far back to look for a last-logged day. Past ABANDONED_AFTER_DAYS nobody is eligible.
const LOOKBACK_DAYS = 45;

const json = (obj: unknown, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });

/** Constant-time-ish compare so the shared key can't be probed byte by byte. */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

const isoDaysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);
  if (!CRON_KEY || !safeEqual(req.headers.get('x-winback-key') ?? '', CRON_KEY)) {
    return json({ error: 'unauthorized' }, 401);
  }
  if (!SUPABASE_URL || !SERVICE_ROLE) return json({ error: 'unavailable' }, 503);

  const dry = new URL(req.url).searchParams.get('dry') === '1';
  const svc = createClient(SUPABASE_URL, SERVICE_ROLE);

  // Fails CLOSED: an absent flag row means off. This message is the one we would least like to
  // send by accident, so its default is silence — the opposite of the roll-call flag's default.
  const { data: flag } = await svc.from('feature_flags')
    .select('default_on, kill_switch').eq('name', 'winback').maybeSingle();
  if (!flag || flag.kill_switch || !flag.default_on) return json({ ok: true, skipped: 'flag off' });

  const todayISO = new Date().toISOString().slice(0, 10);

  // Last logged day per athlete, from one bulk read of the recent window.
  const { data: dayRows, error: dayErr } = await svc.from('days')
    .select('athlete_id, date').gte('date', isoDaysAgo(LOOKBACK_DAYS));
  if (dayErr) return json({ error: 'unavailable' }, 503);

  const lastActive = new Map<string, string>();
  for (const r of (dayRows ?? []) as Array<{ athlete_id: string; date: string }>) {
    const prev = lastActive.get(r.athlete_id);
    if (!prev || r.date > prev) lastActive.set(r.athlete_id, r.date);
  }
  if (lastActive.size === 0) return json({ ok: true, selected: 0, sent: 0 });

  const ids = [...lastActive.keys()];
  const [profRes, notifRes] = await Promise.all([
    svc.from('profiles').select('id, created_at, notifications_opt_out').in('id', ids),
    // Durable dedupe: which winback kinds each athlete has ever been sent. A timer would forget
    // across redeploys and re-send; a notifications row does not.
    svc.from('notifications').select('user_id, kind').like('kind', 'winback:%').in('user_id', ids),
  ]);

  const sentByUser = new Map<string, string[]>();
  for (const n of (notifRes.data ?? []) as Array<{ user_id: string; kind: string }>) {
    if (!sentByUser.has(n.user_id)) sentByUser.set(n.user_id, []);
    sentByUser.get(n.user_id)!.push(n.kind);
  }

  const candidates: LapsedCandidate[] = ((profRes.data ?? []) as Array<{
    id: string; created_at: string; notifications_opt_out?: boolean | null;
  }>).map((p) => ({
    athleteId: p.id,
    lastActiveISO: lastActive.get(p.id) ?? null,
    createdISO: String(p.created_at).slice(0, 10),
    optedOut: p.notifications_opt_out ?? false,
    alreadySent: sentByUser.get(p.id) ?? [],
  }));

  const sends = selectWinbacks(candidates, todayISO, DAILY_CAP);
  if (dry) return json({ ok: true, dry: true, selected: sends.length, sends });
  if (!sends.length) return json({ ok: true, selected: 0, sent: 0 });

  // WRITE ORDER: the notification row first, then the push. The row is both the athlete's record
  // and the dedupe key, so it must exist even if the push fails — otherwise a failed push means
  // we try the same person again tomorrow, which is exactly the nagging this feature must avoid.
  let wrote = 0;
  for (const s of sends) {
    const { error } = await svc.from('notifications').insert({
      user_id: s.athleteId, kind: s.kind, title: s.title, body: s.body,
    });
    if (!error) wrote++;
  }

  const { data: toks } = await svc.from('device_tokens')
    .select('token, user_id').in('user_id', sends.map((s) => s.athleteId));
  const byUser = new Map(sends.map((s) => [s.athleteId, s]));
  const messages = ((toks ?? []) as Array<{ token: string; user_id: string }>)
    .map((t) => {
      const s = byUser.get(t.user_id);
      if (!s) return null;
      // Normal priority, default sound. This waits behind Do Not Disturb: someone who has been
      // gone ten days is not an interruption worth breaking a phone's silence for.
      return { to: t.token, title: s.title, body: s.body, data: { route: s.route }, sound: 'default' };
    })
    .filter(Boolean);

  let pushed = 0;
  for (let i = 0; i < messages.length; i += 100) {
    try {
      const r = await fetch('https://exp.host/--/api/v2/push/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(messages.slice(i, i + 100)),
      });
      if (r.ok) pushed += messages.slice(i, i + 100).length;
    } catch { /* best effort — the notification row is the durable record */ }
  }

  return json({ ok: true, selected: sends.length, wrote, pushed });
});
