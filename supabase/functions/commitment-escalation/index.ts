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
import { createClient } from 'npm:@supabase/supabase-js@2.110.0';
import { digestBody, breakthroughCopy, LATE_ACTION_LABEL } from './logic.ts';
import { signCoachCode, signRollCallCode } from '../_shared/rollcall-code.ts';
import { COACH_DIGEST_CATEGORY, ROLLCALL_CHANNEL, rollCallCategoryId } from '../_shared/rollcall-category.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const CRON_KEY = Deno.env.get('COMMITMENT_CRON_KEY') ?? '';
// Same secret the athlete's ack uses, different code KIND (_shared/rollcall-code.ts). Absent
// secret simply means the digest ships without its action buttons — never without the digest.
const ACK_SECRET = Deno.env.get('ROLLCALL_ACK_SECRET') ?? '';
// How long a coach's "Got it" / "Nudge them" stays spendable. Hours, not minutes: a coach may not
// look at their phone until well after the 5 AM window, and an expired button is a silent no-op.
const COACH_CODE_TTL_MS = 6 * 60 * 60 * 1000;

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

type Missed = {
  instance_id: string; athlete_id: string; title: string; config: Record<string, boolean>;
  // 0211
  type?: string | null; action_label?: string | null; respond_by_at?: string | null; closes_at?: string | null;
};
// How long a late push's button stays spendable when the roll call has no close of its own
// (older types). The RPC judges the window; this only bounds the credential.
const LATE_CODE_FALLBACK_MS = 60 * 60 * 1000;
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

  // Claim deadline-crossed, still-pending responses (marks them 'missed'). Anything returned is
  // ours. `p_limit` (migration 0148, capacity audit F8) bounds each call — page until a call
  // returns fewer than p_limit rows so a burst of misses larger than one page can't get marked
  // 'missed' without this invocation ever seeing (and escalating on) the surplus. PAGE_CAP backs
  // off a runaway loop; anything left over stays 'pending' and is picked up crossed-again next tick.
  const CLAIM_LIMIT = 500;
  const PAGE_CAP = 20; // up to 10,000 misses per invocation
  const rows: Missed[] = [];
  for (let page = 0; page < PAGE_CAP; page++) {
    const { data: missed, error } = await svc.rpc('claim_missed_commitments', {
      p_grace_min: 10, p_only: only, p_limit: CLAIM_LIMIT,
    });
    if (error) return json({ error: error.message, missed: rows.length }, 500);
    const page_rows = (Array.isArray(missed) ? missed : []) as Missed[];
    rows.push(...page_rows);
    if (page_rows.length < CLAIM_LIMIT) break;
  }
  if (!rows.length) return json({ missed: 0, breakthrough: 0, digests: 0 });

  // -------------------------------------------------------------- L2 breakthrough
  // One time-sensitive push per missed athlete whose commitment opted in. iOS 'time-sensitive' lets
  // it break a Focus/summary; the athlete's own Do Not Disturb still wins.
  const wantBreak = rows.filter((r) => r.config?.breakthrough);
  const breakAthletes = [...new Set(wantBreak.map((r) => r.athlete_id))];
  let breakSent = 0;
  if (breakAthletes.length) {
    const now = Date.now();
    const rowByAthlete = new Map<string, Missed>();
    for (const r of wantBreak) if (!rowByAthlete.has(r.athlete_id)) rowByAthlete.set(r.athlete_id, r);
    // Durable row first (the reminder rule): a "You're late" the athlete reads at 7 is still the
    // record of what OnStandard told them at 6:05, whether or not the push landed.
    for (const [athleteId, r] of rowByAthlete) {
      const c = breakthroughCopy(r.type, r.title);
      try {
        await svc.rpc('record_commitment_reminder', { p_athlete: athleteId, p_title: c.title, p_body: c.body });
      } catch { /* best-effort */ }
    }
    const { data: toks } = await svc
      .from('device_tokens').select('token,user_id').in('user_id', breakAthletes);
    const messages: Array<Record<string, unknown>> = [];
    for (const t of (toks ?? []) as Array<{ token: string; user_id: string }>) {
      const r = rowByAthlete.get(t.user_id);
      if (!r) continue;
      const c = breakthroughCopy(r.type, r.title);
      // The late push is answerable from the lock screen too (0211). A wake-up carries a fresh
      // code that lasts until the roll call closes, and a "Check in now" button rather than the
      // on-time label, so the athlete cannot mistake a late answer for an on-time one. The RPC
      // records the server time and the verdict is late by construction.
      const isRollCall = r.type === 'morning_roll_call';
      const closeMs = Date.parse(r.closes_at ?? '');
      const codeDeadline = Number.isFinite(closeMs) ? closeMs : now + LATE_CODE_FALLBACK_MS;
      const code = ACK_SECRET && isRollCall
        ? await signRollCallCode(ACK_SECRET, {
            instanceId: r.instance_id, athleteId: t.user_id, deadlineMs: codeDeadline, iatMs: now,
          })
        : '';
      messages.push({
        to: t.token,
        title: c.title,
        body: c.body,
        data: { route: `roll-call/${r.instance_id}`, code, action_label: code ? LATE_ACTION_LABEL : null, from_coach: false },
        categoryId: code ? rollCallCategoryId(LATE_ACTION_LABEL) : undefined,
        channelId: ROLLCALL_CHANNEL,
        priority: 'high',
        sound: 'default',
        interruptionLevel: 'time-sensitive',
      });
    }
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
    // Durable row FIRST, push second (the winback rule: the row is the record). Before this,
    // the escalation existed only as a push — a coach who missed the banner had no trace of it
    // anywhere in the app. The suffix carries the instance id so the bell row deep-links to the
    // same board the push does (notif-feed.js `commitment_escalation`).
    const digestText = digestBody(d.title, d.total, d.not_up_names ?? []);
    try {
      await svc.from('notifications').insert(d.coach_ids.map((cid: string) => ({
        user_id: cid, kind: `commitment_escalation:${instId}`, title: d.title, body: digestText,
      })));
    } catch { /* best-effort: a feed-row failure must never block the push */ }
    const { data: ctoks } = await svc
      .from('device_tokens').select('token,user_id').in('user_id', d.coach_ids);
    const coachMsgs: Array<Record<string, unknown>> = [];
    for (const t of (ctoks ?? []) as Array<{ token: string; user_id: string }>) {
      // One code per COACH, not one per instance: it names who is acting, and a shared code would
      // let any recipient's device act as any other recipient. Minted here because this is the only
      // moment the server knows both the instance and the exact staff list it is addressing.
      const coachCode = ACK_SECRET
        ? await signCoachCode(ACK_SECRET, {
            instanceId: instId, coachId: t.user_id,
            deadlineMs: Date.now() + COACH_CODE_TTL_MS, iatMs: Date.now(),
          })
        : '';
      coachMsgs.push({
        to: t.token,
        title: d.title,
        body: digestText,
        // `coach-commitments/<id>`, NOT `roll-call/<id>`. The latter is the ATHLETE detail screen:
        // proto router.js refuses it to a known coach and bounces them to their dashboard, dropping
        // the instance id — so until now the one deep link this whole escalation existed to deliver
        // landed a coach nowhere. `coach_code` rides alongside so the lock-screen actions can spend
        // it without a session (roll-call-coach).
        data: { route: `coach-commitments/${instId}`, coach_code: coachCode },
        // Only offer the buttons when a code was actually minted — a category with no credential
        // behind it would draw "Nudge them" and then do nothing when pressed.
        categoryId: coachCode ? COACH_DIGEST_CATEGORY : undefined,
        channelId: ROLLCALL_CHANNEL,
        priority: 'high',
        sound: 'default',
      });
    }
    await push(coachMsgs);
    digests++;
  }

  return json({ missed: rows.length, breakthrough: breakSent, digests });
});
