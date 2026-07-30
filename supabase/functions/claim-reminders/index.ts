// OnStandard — claim-reminders: nudge people who paid a trainer from the public page and never
// entered their claim code.
//
// The failure this exists for: a prospect buys a $200/mo package, closes the tab before saving the
// code, ignores the first email, and is then billed every month for an app they cannot open. Nothing
// else in the system notices. That is a chargeback and a furious trainer.
//
// Two nudges, then we stop (claims_needing_reminder enforces the ladder in SQL). Beyond that it is
// the trainer's to chase — my_pending_claims puts the buyer on their Grow tab by name, and they can
// refund outright. Mailing someone weekly about a code they keep ignoring earns a spam complaint.
//
// Deploy (cron-key auth, no Supabase JWT):
//   supabase secrets set BILLING_CRON_KEY=<same key as billing-overage-report>
//   supabase functions deploy claim-reminders --no-verify-jwt
// Schedule with 0167's schedule_claim_reminders().
import { createClient } from 'npm:@supabase/supabase-js@2.110.0';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const CRON_KEY = Deno.env.get('BILLING_CRON_KEY') ?? '';
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY') ?? '';
const EMAIL_FROM = Deno.env.get('GUARDIAN_EMAIL_FROM') ?? 'OnStandard <support@onstandard.app>';
const AFTER_DAYS = Number(Deno.env.get('CLAIM_REMINDER_AFTER_DAYS') ?? '2');
const MAX_REMINDERS = Number(Deno.env.get('CLAIM_REMINDER_MAX') ?? '2');

const json = (obj: unknown, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });

/** Constant-time compare so the cron key can't be probed a byte at a time. */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function esc(s: string): string {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);
  if (!CRON_KEY || !safeEqual(req.headers.get('x-billing-key') ?? '', CRON_KEY)) {
    return json({ error: 'unauthorized' }, 401);
  }
  if (!SUPABASE_URL || !SERVICE_ROLE) return json({ error: 'server not configured' }, 500);
  // No mail vendor means no reminders — but this is NOT an error worth alerting on, and the trainer
  // still sees every pending claim in-app. Report it plainly instead of failing the cron.
  if (!RESEND_API_KEY) return json({ ok: true, sent: 0, reason: 'email vendor not configured' });

  const svc = createClient(SUPABASE_URL, SERVICE_ROLE);
  const { data: claims, error } = await svc.rpc('claims_needing_reminder', {
    p_after_days: AFTER_DAYS, p_max_reminders: MAX_REMINDERS,
  });
  if (error) return json({ error: 'query failed', detail: error.message }, 500);

  let sent = 0, failed = 0;
  for (const c of claims ?? []) {
    // `code` comes from a fixed alphabet; practice_name is trainer-supplied, so it is escaped.
    const who = c.practice_name ? `your trainer at ${esc(c.practice_name)}` : 'your trainer';
    const html = `<div style="font-family:system-ui,-apple-system,sans-serif;color:#0F172A;line-height:1.5">
      <p>You paid for coaching with ${who}, but you haven't set up your OnStandard account yet — so you're paying for something you can't open.</p>
      <p>Download OnStandard, create your account, and enter this code:</p>
      <p style="font-family:ui-monospace,Menlo,monospace;font-size:24px;font-weight:800;letter-spacing:0.06em">${c.code}</p>
      <p style="color:#64748B;font-size:13px">Didn't mean to sign up? Reply to this email and we'll sort out a refund. Questions: support@onstandard.app</p>
    </div>`;
    try {
      const r = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: EMAIL_FROM, to: [c.payer_email],
          subject: 'Your OnStandard access is waiting', html,
        }),
      });
      if (!r.ok) { failed++; console.error('claim-reminders: send failed', r.status); continue; }
      // Only stamp AFTER a confirmed send, so a mail outage retries tomorrow instead of silently
      // burning one of the buyer's two nudges.
      await svc.rpc('mark_claim_reminded', { p_id: c.id });
      sent++;
    } catch (e) {
      failed++;
      console.error('claim-reminders: send error', e);
    }
  }

  return json({ ok: true, sent, failed, considered: (claims ?? []).length });
});
