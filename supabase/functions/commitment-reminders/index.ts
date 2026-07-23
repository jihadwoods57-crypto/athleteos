// OnStandard — commitment-reminders: the server half of Verified Commitments reminders.
//
// WHY THIS EXISTS
// Reminders used to be planned on the client, from rows the Home screen fetched on mount. That
// meant an athlete who hadn't opened OnStandard since yesterday afternoon had nothing scheduled
// for a 4:45 AM roll call — which is precisely the athlete a 4:45 AM roll call is for. Now the
// server decides, so a reminder survives a closed app, a reinstall, and a new phone.
//
// It holds NO scheduling logic. claim_due_commitment_reminders (migration 0140) selects what is
// due and marks it in the same statement, so two overlapping cron ticks cannot double-send, and
// only PENDING responses are ever selected — an athlete who already answered is never pinged.
//
// INVOCATION: scheduled every 5 minutes. Protected by a shared key so only the scheduler can fire
// it (deploy with --no-verify-jwt; an anon caller without the key gets 401):
//   supabase secrets set COMMITMENT_CRON_KEY=<long random string>
//   supabase functions deploy commitment-reminders --use-api --no-verify-jwt
// Then: select schedule_commitment_reminders('<fn url>', '<the same key>');
import { createClient } from 'npm:@supabase/supabase-js@^2';
import { signRollCallCode } from '../_shared/rollcall-code.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const CRON_KEY = Deno.env.get('COMMITMENT_CRON_KEY') ?? '';
const ACK_SECRET = Deno.env.get('ROLLCALL_ACK_SECRET') ?? '';

const json = (obj: unknown, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });

// Constant-time compare of the shared cron key (audit 2026-07-12) — mirrors weekly-digest.
function safeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const ab = enc.encode(a);
  const bb = enc.encode(b);
  if (ab.length !== bb.length) return false;
  let diff = 0;
  for (let i = 0; i < ab.length; i++) diff |= ab[i] ^ bb[i];
  return diff === 0;
}

type Due = {
  athlete_id: string;
  instance_id: string;
  title: string;
  body: string;
  offset_min: number;
  action_label: string | null;
  respond_by_at: string | null; // ISO
};

// Slug an action label into a stable category id. MUST match rollCallCategoryId in
// src/core/rollcall.ts (Task 5) — Deno can't import RN's src/, so the two are kept in sync by hand.
const categoryIdFor = (label: string | null): string =>
  'RC::' + (label ?? 'Im Up').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 24);

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);
  if (!CRON_KEY || !safeEqual(req.headers.get('x-commitment-key') ?? '', CRON_KEY)) {
    return json({ error: 'unauthorized' }, 401);
  }
  if (!SUPABASE_URL || !SERVICE_ROLE) return json({ error: 'not configured' }, 500);

  const svc = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });

  // Claim + mark in one call. Anything returned here is ours to deliver and will not be
  // returned to a concurrent run.
  const { data, error } = await svc.rpc('claim_due_commitment_reminders', { p_grace_min: 10 });
  if (error) return json({ error: error.message }, 500);

  const due = (Array.isArray(data) ? data : []) as Due[];
  if (!due.length) return json({ sent: 0, pushed: 0 });

  // In-app notification rows first: they are the durable record. A push that fails (stale token,
  // Expo outage) must not mean the athlete has no idea their coach is waiting.
  let recorded = 0;
  for (const d of due) {
    const { error: e } = await svc.rpc('record_commitment_reminder', {
      p_athlete: d.athlete_id, p_title: d.title, p_body: d.body,
    });
    if (!e) recorded++;
  }

  // Then push, best-effort. One Expo request per batch of tokens.
  const athleteIds = [...new Set(due.map((d) => d.athlete_id))];
  const { data: toks } = await svc
    .from('device_tokens').select('token,user_id').in('user_id', athleteIds);

  const byAthlete = new Map<string, Due>();
  for (const d of due) if (!byAthlete.has(d.athlete_id)) byAthlete.set(d.athlete_id, d);

  const messages: Array<Record<string, unknown>> = [];
  for (const t of (toks ?? []) as Array<{ token: string; user_id: string }>) {
    const d = byAthlete.get(t.user_id);
    if (!d) continue;
    // The signed code proves one athlete + one instance, only inside the response window — minted
    // fresh per push so a stale/replayed notification can't ack a different roll call.
    const deadlineMs = d.respond_by_at ? Date.parse(d.respond_by_at) : Date.now();
    const code = ACK_SECRET
      ? await signRollCallCode(ACK_SECRET, {
          instanceId: d.instance_id, athleteId: d.athlete_id, deadlineMs, iatMs: Date.now(),
        })
      : '';
    messages.push({
      to: t.token,
      title: d.title,
      body: d.body,
      // The tap lands on the commitment itself, not Home — the last inch of the loop. `code` lets
      // a lock-screen action button ack without opening the app; empty when the secret isn't set.
      data: { route: `roll-call/${d.instance_id}`, code, action_label: d.action_label ?? 'I\'m Up' },
      // Expo maps categoryId -> iOS notification category / Android action set. Only offer the
      // quick-action affordance when we actually minted a verifiable code.
      categoryId: code ? categoryIdFor(d.action_label) : undefined,
      // A coach-scheduled commitment is a scheduled event, not a nudge: it is allowed to break
      // through at 4:45 AM. The phone's own Do Not Disturb still wins.
      priority: 'high',
      sound: 'default',
    });
  }

  let pushed = 0;
  for (let i = 0; i < messages.length; i += 100) {
    try {
      const r = await fetch('https://exp.host/--/api/v2/push/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(messages.slice(i, i + 100)),
      });
      if (r.ok) pushed += Math.min(100, messages.length - i);
    } catch {
      // Best-effort: the notification row is already written, so the athlete still sees it in app.
    }
  }

  return json({ sent: recorded, pushed, claimed: due.length });
});
