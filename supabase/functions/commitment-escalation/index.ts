// OnStandard — the roll-call escalation ladder. Scheduled every minute (schedule_commitment_escalation,
// 0211/0159: '* * * * *'), right behind commitment-reminders. Shared cron key (reuse
// COMMITMENT_CRON_KEY). Deploy --no-verify-jwt:
//   supabase functions deploy commitment-escalation --use-api --no-verify-jwt
//   select schedule_commitment_escalation(...)  -- schedule this fn on the same one-minute cadence
//
// WHAT IT DOES
//   1. Claims the responses whose deadline just crossed while still pending (claim_missed_commitments,
//      0145) — marking them 'missed' in the same statement so no rung ever fires twice.
//   2. L2 breakthrough: one time-sensitive push to each missed athlete whose commitment opted in.
//   3. L3 coach digest: one "who's up" push per opted-in instance, built from rollcall_digest (0145).
//   4. THE CLOSE (0239): every wake-up whose close just passed has its lock-screen card ENDED in the
//      `missed` state for whoever never answered, and its update tokens cleared. Before this the red
//      "CHECK IN" card kept counting past a close the server refuses, until iOS timed it out.
//      2026-09-23: a check-in no longer ends the card, so the close also ends every ANSWERED card,
//      in its answered state with the final team count.
//   5. THE CLOSING SUMMARY (2026-09-23): at the close of EVERY wake-up (not opt-in, unlike L3), one
//      push to the commitment's creator and the team's coaches: "Roll call closed: 10 of 12 on
//      time" / "Tyrek was late (6:08). Tommy and Ray missed. Tap to nudge them." Once per instance
//      (claim_rollcall_summary, summary_sent_at). The tap opens the board on the misses.
//
// L4 GUARDIAN IS DEFERRED. `escalation.notify_guardian_on_miss` exists in the config shape but is off
// by default and no guardian rung is built here — a follow-up commit adds it once the founder
// confirms the default and the guardianship link (0008). This fn ships L2 + L3 only.
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2.110.0';
import { digestBody, breakthroughCopy, platformCopy, LATE_ACTION_LABEL, closingSummary, summaryRoute, lateRoute, digestRoute } from './logic.ts';
import { ApnsClient, apnsFromEnv } from '../_shared/apns.ts';
import { pushLiveActivity, loadLiveCard, loadTeamBoard } from '../_shared/rollcall-live-send.ts';
import { rollCallPushData, teamFields, type TeamBoard } from '../_shared/rollcall-live.ts';
import { signCoachCode, signRollCallCode } from '../_shared/rollcall-code.ts';
import { COACH_DIGEST_CATEGORY, ROLLCALL_CHANNEL, rollCallCategoryId } from '../_shared/rollcall-category.ts';
// Expo answers a refused batch with HTTP 200 + per-message error tickets, so `r.ok` counted
// refusals as deliveries. sendExpoPush reads the tickets; see _shared/expo-push.mjs.
import { sendExpoPush } from '../_shared/expo-push.mjs';

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
  const out = await sendExpoPush(messages);
  // This used to swallow the answer entirely: no return value, no log, nothing to notice when a
  // whole night of escalations was refused at Expo's door. Now it says so.
  if (out.failed) console.error('commitment-escalation: push refused', out.failed, out.errors.join('; '));
  return out;
}

/** Coach code for one recipient on one instance (see the L3 digest below for why one per coach). */
async function coachCodeFor(instId: string, coachId: string): Promise<string> {
  return ACK_SECRET
    ? await signCoachCode(ACK_SECRET, {
        instanceId: instId, coachId, deadlineMs: Date.now() + COACH_CODE_TTL_MS, iatMs: Date.now(),
      })
    : '';
}

/** The closing summary for one closed instance. Once per instance (claim_rollcall_summary). The
 *  claim is taken only after the board has been read, so an unreadable board leaves
 *  summary_sent_at empty (the close sweep itself claims each instance once, via live_ended_at, so
 *  there is no automatic retry; the empty column is the trace). Recipients: the digest's staff query
 *  (rollcall_digest.coach_ids: active team staff, or the practice owner) plus the commitment's
 *  creator. Returns whether a summary was sent. */
async function sendClosingSummary(
  svc: SupabaseClient, instId: string, board: TeamBoard | null, timezone: string | null,
): Promise<boolean> {
  if (!board || !(Number(board.total) > 0)) return false;
  const { data: claimed } = await svc.rpc('claim_rollcall_summary', { p_instance: instId });
  if (claimed !== true) return false;

  const recipients = new Set<string>();
  try {
    const { data: digest } = await svc.rpc('rollcall_digest', { p_instance: instId });
    for (const id of ((digest as Digest | null)?.coach_ids ?? [])) if (id) recipients.add(id);
  } catch { /* best effort */ }
  try {
    const { data: inst } = await svc.from('commitment_instances')
      .select('commitments(created_by)').eq('id', instId).maybeSingle();
    const rel = (inst as { commitments?: { created_by?: string | null } | Array<{ created_by?: string | null }> } | null)?.commitments;
    const createdBy = Array.isArray(rel) ? rel[0]?.created_by : rel?.created_by;
    if (createdBy) recipients.add(createdBy);
  } catch { /* best effort */ }
  if (!recipients.size) return false;

  const s = closingSummary({ ...(board as unknown as { total: number; rows: Array<{ verdict: string }> }), timezone });
  const ids = [...recipients];
  // Durable row first (the winback rule). The kind reuses the escalation's so the bell row
  // deep-links to the same coach board (notif-feed.js `commitment_escalation`).
  try {
    await svc.from('notifications').insert(ids.map((uid) => ({
      user_id: uid, kind: `commitment_escalation:${instId}`, title: s.title, body: s.body,
    })));
  } catch { /* best-effort: a feed-row failure must never block the push */ }
  const { data: toks } = await svc.from('device_tokens').select('token,user_id').in('user_id', ids);
  const msgs: Array<Record<string, unknown>> = [];
  for (const t of (toks ?? []) as Array<{ token: string; user_id: string }>) {
    const coachCode = await coachCodeFor(instId, t.user_id);
    msgs.push({
      to: t.token,
      title: s.title,
      body: s.body,
      // A PATH, never a query string (ruling R2): the board, opened on the misses.
      data: { route: summaryRoute(instId), coach_code: coachCode },
      categoryId: coachCode ? COACH_DIGEST_CATEGORY : undefined,
      channelId: ROLLCALL_CHANNEL,
      priority: 'high',
      sound: 'default',
    });
  }
  await push(msgs);
  return true;
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
  const live = { started: 0, updated: 0, ended: 0, revoked: 0, skipped: 0, closed: 0 };
  let summaries = 0;
  const apnsCfg = apnsFromEnv((k) => Deno.env.get(k));

  // -------------------------------------------------------------- the close: the card comes down
  // Independent of the late claim above, and BEFORE its early return: a tick with no fresh misses
  // still has closes to sweep. Ends the Live Activity in its `missed` state for every athlete
  // still unanswered on an instance whose close passed (claimed once via live_ended_at, 0239), and
  // clears the dead update tokens. No alert: nothing to say at 6:30 that the card does not show.
  // Changes no record; the verdict is the clock's (rollcall_verdict) and the durable `missed`
  // claim is the one above.
  try {
    const { data: closed } = await svc.rpc('claim_closed_rollcalls', { p_window_min: 180, p_limit: 200 });
    const list = (Array.isArray(closed) ? closed : []) as Array<{ instance_id: string; athlete_ids: string[] | null }>;
    if (list.length) {
      const apns = apnsCfg ? new ApnsClient(apnsCfg) : null;
      for (const c of list) {
        live.closed++;
        const ids = Array.isArray(c.athlete_ids) ? c.athlete_ids : [];
        const card = await loadLiveCard(svc, c.instance_id);
        const board = await loadTeamBoard(svc, c.instance_id);
        const team = (id: string) => teamFields(board, id);
        if (apns && card) {
          if (ids.length) {
            const r = await pushLiveActivity({ svc, apns, card, phase: 'missed', athleteIds: ids, team, nowMs: Date.now() });
            live.ended += r.ended; live.revoked += r.revoked; live.skipped += r.skipped;
          }
          // The answered cards stayed up after the tap (2026-09-23); the close takes them down in
          // their answered state, with the final count, place and points.
          const answered = (board?.rows ?? []).filter((r) => r.acknowledged_at && !ids.includes(r.athlete_id));
          if (answered.length) {
            const r = await pushLiveActivity({
              svc, apns, card, phase: 'answered', end: true,
              athleteIds: answered.map((r) => r.athlete_id),
              checkedInAt: new Map(answered.map((r) => [r.athlete_id, String(r.acknowledged_at)])),
              team, nowMs: Date.now(),
            });
            live.ended += r.ended; live.revoked += r.revoked; live.skipped += r.skipped;
          }
        }
        try { await svc.rpc('clear_live_activity_tokens', { p_instance: c.instance_id }); } catch { /* best effort */ }
        try {
          if (await sendClosingSummary(svc, c.instance_id, board, card?.timezone ?? null)) summaries++;
        } catch { /* the summary is a courtesy; the board is the record */ }
      }
    }
  } catch { /* the RPC may not exist on an un-migrated stack; the ladder below is unaffected */ }

  if (!rows.length) return json({ missed: 0, breakthrough: 0, digests: 0, live, summaries });

  // -------------------------------------------------------------- Live Activity: turn it red
  // Runs BEFORE the breakthrough push, for the same reason it does in commitment-reminders: the
  // card that has been on the lock screen since 6:00 becomes the LATE state with an alert, and
  // every athlete whose card Apple accepted is then skipped below. One roll call, one card.
  const hasCard = new Set<string>();
  if (apnsCfg) {
    const apns = new ApnsClient(apnsCfg); // ONE client: it caches the provider token Apple rate-limits.
    const nowMs = Date.now();
    const wake = rows.filter((r) => r.type === 'morning_roll_call');
    const byInstance = new Map<string, Missed[]>();
    for (const r of wake) {
      const list = byInstance.get(r.instance_id) ?? [];
      list.push(r);
      byInstance.set(r.instance_id, list);
    }
    for (const [instanceId, missedRows] of byInstance) {
      const card = await loadLiveCard(svc, instanceId);
      if (!card) continue;
      const board = await loadTeamBoard(svc, instanceId);
      const c = breakthroughCopy('morning_roll_call', card.title, card.respond_by_at, nowMs);
      const r = await pushLiveActivity({
        svc, apns, card, phase: 'late',
        // The count rides every update: a content state replaces the whole card.
        team: (id) => teamFields(board, id),
        athleteIds: [...new Set(missedRows.map((x) => x.athlete_id))],
        alert: { title: c.title, body: c.body, sound: 'default' },
        nowMs,
      });
      live.started += r.started; live.updated += r.updated; live.ended += r.ended;
      live.revoked += r.revoked; live.skipped += r.skipped;
      for (const id of r.live) hasCard.add(id);
    }
  }

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
      // The bell row is written from the SAME composer as the push, with the same clock, so the
      // record an athlete reads at 07:00 says exactly what their lock screen said at 06:08.
      const c = breakthroughCopy(r.type, r.title, r.respond_by_at, now);
      try {
        await svc.rpc('record_commitment_reminder', { p_athlete: athleteId, p_title: c.title, p_body: c.body });
      } catch { /* best-effort */ }
    }
    const { data: toks } = await svc
      .from('device_tokens').select('token,user_id,platform').in('user_id', breakAthletes);
    // See commitment-reminders: withhold the notification only where a card is genuinely up AND
    // this is the athlete's only iPhone, so a second phone is never left silent.
    const iosTokenCount = new Map<string, number>();
    for (const t of (toks ?? []) as Array<{ user_id: string; platform: string | null }>) {
      if (t.platform === 'ios') iosTokenCount.set(t.user_id, (iosTokenCount.get(t.user_id) ?? 0) + 1);
    }
    const messages: Array<Record<string, unknown>> = [];
    for (const t of (toks ?? []) as Array<{ token: string; user_id: string; platform: string | null }>) {
      const r = rowByAthlete.get(t.user_id);
      if (!r) continue;
      // The red card is already on this phone saying exactly this.
      if (t.platform === 'ios' && hasCard.has(t.user_id) && iosTokenCount.get(t.user_id) === 1) continue;
      const c = breakthroughCopy(r.type, r.title, r.respond_by_at, now);
      const pc = platformCopy(c, t.platform);
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
        title: pc.title,
        ...(pc.subtitle ? { subtitle: pc.subtitle } : {}),
        body: pc.body,
        data: {
          route: lateRoute(r.type, r.instance_id), code,
          action_label: code ? LATE_ACTION_LABEL : null, from_coach: false,
          // Android: turns the card red and switches its chronometer from counting down to
          // counting up past the deadline. See modules/rollcall-live.
          ...rollCallPushData(r, 'late'),
        },
        categoryId: code ? rollCallCategoryId(LATE_ACTION_LABEL) : undefined,
        channelId: ROLLCALL_CHANNEL,
        // Replaces the 6:00/6:03 card in place rather than stacking a third one under them
        // (matching commitment-reminders): one roll call, one notification, current state.
        tag: `rollcall-${r.instance_id}`,
        collapseId: `rollcall-${r.instance_id}`,
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
  const wakeInsts = new Set(rows.filter((r) => r.type === 'morning_roll_call').map((r) => r.instance_id));
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
        // digestRoute: a wake-up's digest opens the board on the misses, the same route as its
        // bell row and the closing summary; a plain commitment keeps the commitments board.
        data: { route: digestRoute(wakeInsts.has(instId), instId), coach_code: coachCode },
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

  return json({ missed: rows.length, breakthrough: breakSent, digests, live, summaries });
});
