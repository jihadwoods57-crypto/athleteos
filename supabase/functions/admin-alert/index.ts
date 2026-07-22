// OnStandard — admin-alert: fan a Command Center security alert out to email (Resend) + push (existing
// device_tokens). Called ONLY by trusted server code (admin-auth-monitor, admin-mfa-recover) with the
// x-alert-key shared secret — never by the browser. Deduped by kind within a 10-minute window via
// admin_audit_log so a noisy signal can't spam.
//
// Deploy:
//   supabase secrets set ALERT_KEY=... RESEND_API_KEY=... ADMIN_ALERT_EMAIL=you@onstandard.app
//   supabase functions deploy admin-alert
import { createClient } from 'npm:@supabase/supabase-js@^2';
import { buildResendPayload, shouldSend } from './logic.mjs';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const ALERT_KEY = Deno.env.get('ALERT_KEY') ?? '';
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY') ?? '';
const ALERT_EMAIL = Deno.env.get('ADMIN_ALERT_EMAIL') ?? '';
const ALERT_FROM = Deno.env.get('ALERT_FROM') ?? 'OnStandard Security <alerts@onstandard.app>';
const FUNCTIONS_BASE = Deno.env.get('FUNCTIONS_BASE') ?? `${SUPABASE_URL}/functions/v1`;

Deno.serve(async (req: Request) => {
  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  if (req.method !== 'POST') return json(405, { error: 'method not allowed' });
  if (!ALERT_KEY || req.headers.get('x-alert-key') !== ALERT_KEY) return json(401, { error: 'unauthorized' });
  if (!SUPABASE_URL || !SERVICE_ROLE) return json(500, { error: 'misconfigured' });

  const { kind, subject, body } = await req.json().catch(() => ({}));
  if (!kind || !subject || !body) return json(400, { error: 'kind, subject, body required' });

  const svc = createClient(SUPABASE_URL, SERVICE_ROLE);

  // dedupe: has this kind alerted in the last 10 min?
  const since = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  const { data: recent } = await svc
    .from('admin_audit_log').select('action').eq('action', `alert.${kind}`).gte('created_at', since);
  if (!shouldSend((recent ?? []).map((r: { action: string }) => r.action.replace('alert.', '')), kind)) {
    return json(200, { sent: false, reason: 'deduped' });
  }

  const results: Record<string, unknown> = {};

  // email via Resend
  if (RESEND_API_KEY && ALERT_EMAIL) {
    try {
      const payload = buildResendPayload({ from: ALERT_FROM, to: ALERT_EMAIL, subject, body });
      const r = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      results.email = r.ok;
    } catch (_e) { results.email = false; }
  } else { results.email = 'skipped'; }

  // push to every admin's device tokens via the existing send-push function
  try {
    const { data: admins } = await svc.from('platform_admins').select('user_id');
    const ids = (admins ?? []).map((a: { user_id: string }) => a.user_id);
    if (ids.length) {
      const { data: toks } = await svc.from('device_tokens').select('user_id').in('user_id', ids);
      if ((toks ?? []).length) {
        await fetch(`${FUNCTIONS_BASE}/send-push`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${SERVICE_ROLE}`, 'content-type': 'application/json' },
          body: JSON.stringify({ user_ids: ids, title: subject, body }),
        });
        results.push = true;
      } else { results.push = 'no-tokens'; }
    } else { results.push = 'no-admins'; }
  } catch (_e) { results.push = false; }

  await svc.from('admin_audit_log').insert({ action: `alert.${kind}`, target: kind, after: results });
  return json(200, { sent: true, results });
});
