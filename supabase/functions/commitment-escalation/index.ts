// OnStandard — the roll-call escalation ladder. Scheduled every 5 minutes, right behind
// commitment-reminders. Shared cron key (reuse COMMITMENT_CRON_KEY). Deploy --no-verify-jwt:
//   supabase functions deploy commitment-escalation --use-api --no-verify-jwt
//   select schedule_commitment_reminders(...)  -- schedule this fn on the same 5-min cadence
//
// WHAT IT DOES
//   1. Claims the responses whose deadline just crossed while still pending (claim_missed_commitments,
//      0145) — marking them 'missed' in the same statement so no rung ever fires twice.
//   2. L2 breakthrough: one time-sensitive push to each missed athlete whose commitment opted in.
//   3. L3 coach digest: one "who's up" push per opted-in instance, built from rollcall_digest (0145).
//
// L4 GUARDIAN IS DEFERRED. `escalation.notify_guardian_on_miss` exists in the config shape but is off
// by default and no guardian rung is built here — a follow-up commit adds it once the founder
// confirms the default and the guardianship link (0008). This fn ships L2 + L3 only.
import { createClient } from 'npm:@supabase/supabase-js@^2';
import { digestBody } from './logic.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const CRON_KEY = Deno.env.get('COMMITMENT_CRON_KEY') ?? '';

const json = (o: unknown, s = 200) =>
  new Response(JSON.stringify(o), { status: s, headers: { 'Content-Type': 'application/json' } });

// Constant-time compare of the shared cron key (audit 2026-07-12) — mirrors commitment-reminders.
function safeEqual(a: string, b: string): boolean {
  const e = new TextEncoder();
  const ab = e.encode(a);
  const bb = e.encode(b);
  if (ab.length !== bb.length) return false;
  let d = 0;
  for (let i = 0; i < ab.length; i++) d |= ab[i] ^ bb[i];
  return d === 0;
}

type Missed = { instance_id: string; athlete_id: string; title: string; config: Record<string, boolean> };
type Digest = { title: string; total: number; not_up_names: string[]; coach_ids: string[] };

// Best-effort Expo send, one request per batch of 100. The 'missed' claim is already durable in the
// DB, so a dropped push never means the coach's board is wrong — it only means one fewer nudge.
async function push(messages: Array<Record<string, unknown>>) {
  for (let i = 0; i < messages.length; i += 100) {
    try {
      await fetch('https://exp.host/--/api/v2/push/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(messages.slice(i, i + 100)),
      });
    } catch {
      // best effort
    }
  }
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);
  if (!CRON_KEY || !safeEqual(req.headers.get('x-commitment-key') ?? '', CRON_KEY)) {
    return json({ error: 'unauthorized' }, 401);
  }
  if (!SUPABASE_URL || !SERVICE_ROLE) return json({ error: 'not configured' }, 500);

  const svc = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });

  // Kill switch. FAIL OPEN on a missing row: the flag may not be seeded yet, and only an explicit
  // kill_switch = true stops the ladder. This mirrors the reminder fn's stance — the coach-scheduled
  // event is allowed to escalate by default; the switch exists solely to halt it.
  const { data: flag } = await svc
    .from('feature_flags').select('kill_switch,default_on,enabled_user_ids')
    .eq('name', 'rollcall_lockscreen').maybeSingle();
  if (flag && flag.kill_switch) return json({ skipped: 'flag off' });

  // Per-athlete staging. FAIL OPEN: a missing row OR default_on => global (only=null). Only an
  // explicit default_on=false narrows the missed-marking to the staged pilot athletes, so flipping
  // default_on=true is the single switch that takes the whole ladder global.
  let only: string[] | null = null;
  if (flag && flag.default_on === false) only = Array.isArray(flag.enabled_user_ids) ? flag.enabled_user_ids : [];

  // Claim deadline-crossed, still-pending responses (marks them 'missed'). Anything returned is ours.
  const { data: missed, error } = await svc.rpc('claim_missed_commitments', { p_grace_min: 10, p_only: only });
  if (error) return json({ error: error.message }, 500);
  const rows = (Array.isArray(missed) ? missed : []) as Missed[];
  if (!rows.length) return json({ missed: 0, breakthrough: 0, digests: 0 });

  // -------------------------------------------------------------- L2 breakthrough
  // One time-sensitive push per missed athlete whose commitment opted in. iOS 'time-sensitive' lets
  // it break a Focus/summary; the athlete's own Do Not Disturb still wins.
  const wantBreak = rows.filter((r) => r.config?.breakthrough);
  const breakAthletes = [...new Set(wantBreak.map((r) => r.athlete_id))];
  let breakSent = 0;
  if (breakAthletes.length) {
    const { data: toks } = await svc
      .from('device_tokens').select('token,user_id').in('user_id', breakAthletes);
    const titleByAthlete = new Map(wantBreak.map((r) => [r.athlete_id, r.title]));
    const messages = ((toks ?? []) as Array<{ token: string; user_id: string }>).map((t) => ({
      to: t.token,
      title: titleByAthlete.get(t.user_id) ?? 'Roll call',
      body: 'The window is closing. Answer now.',
      priority: 'high',
      sound: 'default',
      interruptionLevel: 'time-sensitive',
    }));
    await push(messages);
    breakSent = messages.length;
  }

  // -------------------------------------------------------------- L3 coach digest
  // One "who's up" push per instance whose commitment opted in. Built from rollcall_digest so the
  // coach never has to count replies; the tap deep-links to that instance's board.
  const coachInstances = [...new Set(rows.filter((r) => r.config?.notify_coach_on_miss).map((r) => r.instance_id))];
  let digests = 0;
  for (const instId of coachInstances) {
    const { data: digest } = await svc.rpc('rollcall_digest', { p_instance: instId });
    if (!digest) continue;
    const d = digest as Digest;
    if (!d.coach_ids?.length) continue;
    const { data: ctoks } = await svc
      .from('device_tokens').select('token,user_id').in('user_id', d.coach_ids);
    await push(((ctoks ?? []) as Array<{ token: string; user_id: string }>).map((t) => ({
      to: t.token,
      title: d.title,
      body: digestBody(d.title, d.total, d.not_up_names ?? []),
      data: { route: `roll-call/${instId}` },
      priority: 'high',
      sound: 'default',
    })));
    digests++;
  }

  return json({ missed: rows.length, breakthrough: breakSent, digests });
});
