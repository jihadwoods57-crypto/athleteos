// OnStandard — admin-auth-monitor: the "watch". Runs on a ~1-min cron. Pulls Supabase's own auth event
// log for admin accounts, records a clean sign-in event row, flags anomalies (new ip/country/asn,
// off-hours, impossible travel), alerts on anything suspicious, and applies a temporary GoTrue ban on a
// failed-attempt burst (burst-only — a single new-geo success alerts but never bans). Talks to the DB
// ONLY through SECURITY DEFINER RPCs (deny-all tables stay deny-all).
//
// Deploy:
//   supabase secrets set MONITOR_KEY=... ALERT_KEY=... [IPINFO_TOKEN=...]
//   supabase functions deploy admin-auth-monitor
//   -- then schedule via pg_cron (see web/admin/DEPLOY.md)
import { createClient } from 'npm:@supabase/supabase-js@^2';
import { classifyBurst, geoFromIp, describeFlags } from './logic.mjs';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const MONITOR_KEY = Deno.env.get('MONITOR_KEY') ?? '';
const ALERT_KEY = Deno.env.get('ALERT_KEY') ?? '';
const IPINFO_TOKEN = Deno.env.get('IPINFO_TOKEN') ?? '';
const FUNCTIONS_BASE = Deno.env.get('FUNCTIONS_BASE') ?? `${SUPABASE_URL}/functions/v1`;

async function geo(ip: string | null): Promise<{ country: string | null; asn: string | null }> {
  if (!ip || !IPINFO_TOKEN) return { country: null, asn: null };
  try {
    const r = await fetch(`https://ipinfo.io/${ip}?token=${IPINFO_TOKEN}`);
    if (!r.ok) return { country: null, asn: null };
    return geoFromIp(await r.json());
  } catch (_e) { return { country: null, asn: null }; }
}

async function alert(kind: string, subject: string, body: string) {
  if (!ALERT_KEY) return;
  try {
    await fetch(`${FUNCTIONS_BASE}/admin-alert`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-alert-key': ALERT_KEY },
      body: JSON.stringify({ kind, subject, body }),
    });
  } catch (_e) { /* best-effort */ }
}

Deno.serve(async (req: Request) => {
  const json = (s: number, b: unknown) => new Response(JSON.stringify(b), { status: s, headers: { 'content-type': 'application/json' } });
  if (!MONITOR_KEY || req.headers.get('x-monitor-key') !== MONITOR_KEY) return json(401, { error: 'unauthorized' });
  if (!SUPABASE_URL || !SERVICE_ROLE) return json(500, { error: 'misconfigured' });

  const svc = createClient(SUPABASE_URL, SERVICE_ROLE);
  const { data: since } = await svc.rpc('admin_get_checkpoint');
  const sinceTs = since ?? new Date(Date.now() - 15 * 60 * 1000).toISOString();

  const { data: events, error } = await svc.rpc('admin_pull_auth_events', { p_since: sinceTs });
  if (error) return json(500, { error: error.message });

  // per-user timezone cache for off-hours
  const tzCache = new Map<string, string>();
  async function tzOf(uid: string): Promise<string> {
    if (tzCache.has(uid)) return tzCache.get(uid)!;
    const { data } = await svc.from('profiles').select('timezone').eq('id', uid).maybeSingle();
    const tz = data?.timezone || 'UTC';
    tzCache.set(uid, tz);
    return tz;
  }

  let maxTs = sinceTs;
  const suspects = new Set<string>();
  for (const ev of (events ?? [])) {
    if (ev.occurred_at > maxTs) maxTs = ev.occurred_at;
    const g = await geo(ev.ip);
    const tz = await tzOf(ev.user_id);
    const { data: flags } = await svc.rpc('admin_detect_login_anomalies', {
      p_user: ev.user_id, p_ip: ev.ip, p_country: g.country, p_asn: g.asn, p_occurred_at: ev.occurred_at, p_tz: tz,
    });
    await svc.rpc('admin_ingest_login_event', {
      p_ext_id: ev.ext_id, p_user: ev.user_id, p_event_type: ev.event_type, p_ip: ev.ip,
      p_country: g.country, p_asn: g.asn, p_user_agent: ev.user_agent, p_occurred_at: ev.occurred_at, p_flags: flags ?? [],
    });
    if ((flags ?? []).length) {
      await alert('suspicious_login', 'Suspicious Command Center sign-in', describeFlags(flags, ev.ip, g.country));
    }
    suspects.add(ev.user_id);
  }

  // burst -> temporary ban (that account only, auto-expiring)
  const banned: string[] = [];
  for (const uid of suspects) {
    const { data: failures } = await svc.rpc('admin_recent_failures', { p_user: uid, p_mins: 15 });
    if (classifyBurst(failures ?? 0, 15)) {
      try {
        await svc.auth.admin.updateUserById(uid, { ban_duration: '30m' });
        banned.push(uid);
        await alert('account_locked', 'Command Center account temporarily locked',
          `A failed-attempt burst locked the admin account for 30 minutes. If this was not you, reset your password.`);
      } catch (_e) { /* best-effort */ }
    }
  }

  await svc.rpc('admin_advance_checkpoint', { p_ts: maxTs });
  return json(200, { processed: (events ?? []).length, banned: banned.length });
});
