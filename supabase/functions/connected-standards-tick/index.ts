// OnStandard — connected-standards-tick: the server half of Connected Standards.
//
// WHY THIS EXISTS
// Everything else in the feature happens because a person or a device did something. Three things
// have to happen because TIME passed, whether or not anyone has the app open:
//   1. materialize  — tomorrow's periods must exist before anyone can make progress against them
//   2. adjudicate   — a deadline that passed needs a verdict, and the athlete is asleep
//   3. remind       — a nudge is only useful BEFORE the deadline, which is exactly when nobody
//                     is looking at their phone on purpose
//
// All three in one request, so there is one scheduled thing to watch instead of three.
//
// It holds NO scheduling and NO adjudication logic. claim_missed_connected_standards and
// claim_due_connected_standard_reminders (migration 0156) each select and mark in a single
// statement, so two overlapping ticks can never double-send or double-judge. The full transition
// matrix lives in SQL and is pinned by "the deadline matrix" in supabase/tests/rls_authz_test.sql.
//
// ⚠ NO AI. The copy is a template over numbers SQL computed. Adding a model here would put a
// probabilistic sentence on top of an accountability record, which is the one place this product
// does not do that.
//
// INVOCATION: scheduled every 5 minutes. Protected by a shared key so only the scheduler can fire
// it (deploy with --no-verify-jwt; an anon caller without the key gets 401):
//   supabase secrets set CONNECTED_STANDARDS_CRON_KEY=<long random string>
//   supabase functions deploy connected-standards-tick --use-api --no-verify-jwt
// Then: select schedule_connected_standards('<fn url>', '<the same key>');
import { createClient } from 'npm:@supabase/supabase-js@2.110.0';
import { reminderCopy, type DueRow } from '../_shared/activity-copy.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const CRON_KEY = Deno.env.get('CONNECTED_STANDARDS_CRON_KEY') ?? '';
const DEFAULT_TZ = Deno.env.get('DEFAULT_TIMEZONE') ?? 'America/New_York';

const json = (obj: unknown, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });

// Constant-time compare of the shared cron key (audit 2026-07-12) — mirrors commitment-reminders.
function safeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const ab = enc.encode(a);
  const bb = enc.encode(b);
  if (ab.length !== bb.length) return false;
  let diff = 0;
  for (let i = 0; i < ab.length; i++) diff |= ab[i] ^ bb[i];
  return diff === 0;
}

type Claimed = {
  result_id: string; athlete_id: string; standard_id: string;
  title: string; new_status: string;
};
type Due = DueRow & {
  result_id: string; athlete_id: string; standard_id: string; instance_id: string;
};

const CLAIM_LIMIT = 500;
const PAGE_CAP = 20;   // up to 10,000 rows per invocation; the next tick picks up any remainder

/** Page a claim RPC until it returns short. Each page is already marked, so nothing is re-served. */
async function drain<T>(svc: ReturnType<typeof createClient>, fn: string): Promise<T[]> {
  const out: T[] = [];
  for (let page = 0; page < PAGE_CAP; page++) {
    const { data, error } = await svc.rpc(fn, { p_limit: CLAIM_LIMIT });
    if (error) throw new Error(`${fn}: ${error.message}`);
    const rows = (Array.isArray(data) ? data : []) as T[];
    out.push(...rows);
    if (rows.length < CLAIM_LIMIT) break;
  }
  return out;
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);
  if (!CRON_KEY || !safeEqual(req.headers.get('x-cron-key') ?? '', CRON_KEY)) {
    return json({ error: 'unauthorized' }, 401);
  }
  if (!SUPABASE_URL || !SERVICE_ROLE) return json({ error: 'not configured' }, 500);

  const svc = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });

  // ---- 1. materialize -------------------------------------------------------------------
  // Best-effort and first: a standard nobody opened still needs its periods to exist, or the
  // deadline pass below has nothing to adjudicate and the miss simply never happens.
  let materialized = 0;
  try {
    const { data } = await svc.rpc('cs_materialize_all', { p_days: 2 });
    materialized = Number(data) || 0;
  } catch { /* the tick is still worth running without it */ }

  // ---- 2. adjudicate --------------------------------------------------------------------
  let claimed: Claimed[] = [];
  try {
    claimed = await drain<Claimed>(svc, 'claim_missed_connected_standards');
  } catch (e) {
    return json({ error: String((e as Error).message), materialized }, 500);
  }

  // Only a genuine miss is worth telling someone about. 'awaiting_sync' and 'disconnected' are
  // the system saying it doesn't know — pushing "we couldn't verify you" at 11:59 PM would turn
  // a deliberately gentle state into an accusation, and the card already says it plainly when
  // they next open the app.
  const missed = claimed.filter((c) => c.new_status === 'missed');

  // ---- 3. remind ------------------------------------------------------------------------
  let due: Due[] = [];
  try {
    due = await drain<Due>(svc, 'claim_due_connected_standard_reminders');
  } catch (e) {
    return json({ error: String((e as Error).message), materialized, claimed: claimed.length }, 500);
  }

  const now = new Date().toISOString();
  const notes: Array<{ user_id: string; kind: string; title: string; body: string; route: string }> = [];

  // The athlete's OWN timezone (profiles.timezone, 0088) for the "by 9:00 PM" clause. One global
  // DEFAULT_TIMEZONE printed Eastern clock times to athletes in California; the default is now
  // only the fallback for a profile that never reported a zone.
  const tzById = new Map<string, string>();
  {
    const ids = [...new Set([...due.map((d) => d.athlete_id), ...missed.map((m) => m.athlete_id)])];
    if (ids.length) {
      const { data: profs, error: profErr } = await svc.from('profiles').select('id, timezone').in('id', ids);
      // Surfaced, not fatal: on a failed read every athlete falls to the default zone, which is
      // only a wrong clock label in copy — but the failure itself must never be invisible.
      if (profErr) console.error('connected-standards-tick: timezone read failed, using defaults', profErr.message);
      for (const p of (profs ?? []) as Array<{ id: string; timezone: string | null }>) if (p?.timezone) tzById.set(p.id, p.timezone);
    }
  }

  // The result id rides the kind as a suffix (`cs_reminder:<id>`, the meal_flag convention) so the
  // BELL row can deep-link to the standard. The route below was computed for the push and then
  // dropped before the row insert, so the tap worked from the lock screen and nowhere else.
  for (const d of due) {
    const c = reminderCopy(d, now, tzById.get(d.athlete_id) ?? DEFAULT_TZ);
    notes.push({
      user_id: d.athlete_id, kind: `cs_reminder:${d.result_id}`,
      title: c.title, body: c.body, route: `connected-standard/${d.result_id}`,
    });
  }
  for (const m of missed) {
    notes.push({
      // Its own kind: a miss is a record of something already over, and the bell shows it that
      // way instead of as one more "reminder".
      user_id: m.athlete_id, kind: `cs_missed:${m.result_id}`, title: m.title,
      // Says what happened and what recourse exists. No scolding: the athlete may well have done
      // the work and had a phone in a locker.
      body: 'Today’s target wasn’t met. If that’s wrong, open it and tell your coach.',
      route: `connected-standard/${m.result_id}`,
    });
  }

  if (!notes.length) {
    return json({ materialized, claimed: claimed.length, missed: missed.length, sent: 0, pushed: 0 });
  }

  // In-app rows first: they are the durable record. A push that fails (stale token, Expo outage)
  // must not mean the athlete never learns their standard closed.
  let recorded = 0;
  for (let i = 0; i < notes.length; i += 200) {
    const { error } = await svc.from('notifications').insert(
      notes.slice(i, i + 200).map((n) => ({
        user_id: n.user_id, kind: n.kind, title: n.title, body: n.body,
      })));
    if (!error) recorded += Math.min(200, notes.length - i);
  }

  // Then push, best-effort, at most one per athlete per tick.
  const byAthlete = new Map<string, typeof notes[number]>();
  for (const n of notes) if (!byAthlete.has(n.user_id)) byAthlete.set(n.user_id, n);

  const { data: toks } = await svc
    .from('device_tokens').select('token,user_id').in('user_id', [...byAthlete.keys()]);

  const messages: Array<Record<string, unknown>> = [];
  for (const t of (toks ?? []) as Array<{ token: string; user_id: string }>) {
    const n = byAthlete.get(t.user_id);
    if (!n) continue;
    messages.push({
      to: t.token, title: n.title, body: n.body,
      // The tap lands on the standard itself, not Home — the last inch of the loop.
      data: { route: n.route },
      // A step goal is not a 4:45 AM roll call. It rides normal priority and loses to Do Not
      // Disturb, because nothing here is worth waking someone up for.
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

  return json({
    materialized, claimed: claimed.length, missed: missed.length,
    reminders: due.length, sent: recorded, pushed,
  });
});
