// OnStandard — the coach's two lock-screen roll-call actions. Public (no JWT): the signed coach
// code IS the credential, exactly as roll-call-ack works for the athlete.
//
// Deploy: supabase functions deploy roll-call-coach --use-api --no-verify-jwt
//         (reuses ROLLCALL_ACK_SECRET — same secret, different code KIND. See _shared/rollcall-code.ts.)
//
// WHY THIS EXISTS
// A roll call was one tap for the athlete and a phone-unlock-plus-three-screens for the coach. The
// L3 digest ("3 of 12 aren't up") could be read from the lock screen but not acted on, so the
// feature asked the busiest person in the loop to do the most work. These two actions close that:
//
//   seen  — mark this instance's escalation read. Clears it from the coach's feed. Nothing else.
//   nudge — re-push ONLY the athletes still not up, each with a fresh "I'm Up" button of their own.
//
// Roll call v3 (2026-09-24) adds three in-app actions, all through the ONE notice claim (0247
// claim_rollcall_notices + _shared/rollcall-notice-send.ts), so the every-minute cron and a
// coach's button can never both send the same notice:
//   notify     { commitment } — after Start or Save: tell the roster now, not at the next tick.
//                               Cooled down per roll call (60 s): a press inside it answers
//                               { ok, cooldown: true } and the cron says it within the minute.
//   schedule   { instance }   — a day moved or skipped from the board (0216); now said by the claim.
//   remind_arm { instance }   — "Remind the N not set": re-send the assignment push to everyone
//                               whose phone has not armed. Cooled down per roll call (429).
//
// THE NUDGE IS ITSELF ONE-TAP-ANSWERABLE. That is the point worth protecting in review: the push
// this sends carries a freshly minted ATHLETE code and the same notification category the original
// reminder used, so the athlete answers it from their own lock screen. A nudge that merely said
// "open the app" would push the cost back onto the person who is asleep.
//
// TWO CALLERS, ONE AUTHORIZATION MODEL
//   1. The lock screen posts { code, action } with no session.
//   2. The in-app board posts { instance, action } with the coach's bearer token.
// Both resolve to a coach id that is then re-checked against the instance's staff by
// rollcall_nudge_claim (0209) — the code is proof of WHO, never proof of WHAT they may do. A coach
// removed from the team between the digest and the tap is refused.
//
// NO FEEDBACK ON DEVICE. An action with opensAppToForeground:false shows the coach nothing at all —
// the notification simply dismisses. Everything below is therefore built so the silent case is the
// correct case: the rate limit is server-side (a coach who presses twice cannot double-push), and
// the durable notification rows are written inside the same RPC that claims the nudge.
import { createClient } from 'npm:@supabase/supabase-js@2.110.0';
import { verifyRollCallCode, signRollCallCode } from '../_shared/rollcall-code.ts';
import { rollCallCategoryId, ROLLCALL_CHANNEL } from '../_shared/rollcall-category.ts';
import { evaluateFlag, type FlagRow } from '../_shared/feature-flags.ts';
import { parseAction, parseAthlete, httpStatusForCoach, nudgeBody, remindArmOutcome, type CoachFailure } from './logic.ts';
// Expo answers a refused batch with HTTP 200 + per-message error tickets, so `r.ok` counted
// refusals as deliveries. sendExpoPush reads the tickets; see _shared/expo-push.mjs.
import { sendExpoPush } from '../_shared/expo-push.mjs';
import { blockersOf, withoutBlockers, deviceCounts, sumDevices, logBlocked } from '../_shared/blocks.mjs';
import { sendRollcallNotices } from '../_shared/rollcall-notice-send.ts';
import type { NoticeRow } from '../_shared/rollcall-notice.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
const SECRET = Deno.env.get('ROLLCALL_ACK_SECRET') ?? '';

// The coach's window to act. Deliberately WIDER than the athlete's 10-minute ack grace: the athlete
// is racing their own deadline, but a coach may not pick up the phone for an hour, and a "Nudge
// them" that quietly expired while the roll call was still open would be the worst of both worlds
// (no push sent, no way to tell). The instance's own scheduled/cancelled state, not this window, is
// what ultimately decides whether a nudge is still meaningful.
const COACH_GRACE_MS = 6 * 60 * 60 * 1000;
const NUDGE_COOLDOWN_MIN = 10;
const NOTIFY_COOLDOWN_SEC = 60;

const json = (obj: unknown, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });
const fail = (reason: CoachFailure) => json({ ok: false, error: reason }, httpStatusForCoach(reason));

/** Resolve the signed-in coach from a bearer token, or null. auth.getUser() validates against the
 *  auth server, so a forged `sub` cannot act as another coach (mirrors assist/index.ts). */
async function resolveUserId(req: Request): Promise<string | null> {
  const token = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '').trim();
  if (!token || token === ANON_KEY || !SUPABASE_URL || !ANON_KEY) return null;
  try {
    const sb = createClient(SUPABASE_URL, ANON_KEY);
    const { data, error } = await sb.auth.getUser(token);
    if (error || !data.user) return null;
    return data.user.id;
  } catch {
    return null;
  }
}

// Best-effort Expo send, one request per batch of 100. The notification ROWS are already durable
// (written inside rollcall_nudge_claim), so a dropped push never means the athlete has no record.
async function push(messages: Array<Record<string, unknown>>): Promise<number> {
  const out = await sendExpoPush(messages);
  if (out.failed) console.error('roll-call-coach: push refused', out.failed, out.errors.join('; '));
  return out.sent;
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return json({ ok: false, error: 'method not allowed' }, 405);
  if (!SUPABASE_URL || !SERVICE_ROLE) return json({ ok: false, error: 'not configured' }, 500);

  let body: { code?: unknown; instance?: unknown; action?: unknown; athlete?: unknown; commitment?: unknown } = {};
  try { body = (await req.json()) as typeof body; } catch { /* empty */ }

  const action = parseAction(body.action);
  if (!action) return fail('bad_action');

  // ---------------------------------------------------------------- who is asking
  let coachId = '';
  let instanceId = '';
  // A single target (0211) exists only on the in-app path: the row's "Ping" button. The lock
  // screen's coach code names an instance, never an athlete, so it is ignored there.
  let athleteId: string | null = null;
  const code = typeof body.code === 'string' ? body.code : '';
  if (code) {
    if (!SECRET) return json({ ok: false, error: 'not configured' }, 500);
    // 'coach' is asserted, so an athlete's own code — which that athlete legitimately holds for
    // this same instance — cannot buy them the power to nudge their whole team.
    const v = await verifyRollCallCode(SECRET, code, Date.now(), COACH_GRACE_MS, 'coach');
    if (!v.ok) return fail(v.reason);
    coachId = v.claims.subjectId;
    instanceId = v.claims.instanceId;
  } else {
    // In-app path: the session names the coach, the body names the instance. The instance is
    // caller-supplied here (unlike the code path, where it is signed), which is precisely why
    // authorization is re-derived from p_coach server-side rather than assumed.
    const uid = await resolveUserId(req);
    if (!uid) return fail('bad_sig');
    coachId = uid;
    instanceId = typeof body.instance === 'string' ? body.instance : '';
    athleteId = parseAthlete(body.athlete);
  }

  // ---------------------------------------------------------------- v3: tell them now (in-app)
  // After Start or Save on the coach's roll call screen: run the notice claim for THIS roll call
  // now instead of at the next cron tick, so the screen shows who was notified at once. Same claim,
  // same sender, same stamps as the cron, so the two can never both send.
  if (action === 'notify') {
    if (code) return fail('bad_action');
    const commitmentId = parseAthlete(body.commitment);   // a uuid parser; the name is historical
    if (!commitmentId) return fail('malformed');
    const svcN = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });
    const { data: flagN } = await svcN.from('feature_flags').select('*').eq('name', 'rollcall_lockscreen').maybeSingle();
    if (flagN && !evaluateFlag(flagN as FlagRow, { userId: coachId })) return fail('flag_off');
    // Authorized, kill switch, active, and the per-roll-call cooldown, in one call (0247).
    const { data: nc, error: ncErr } = await svcN.rpc('rollcall_notify_claim', {
      p_commitment: commitmentId, p_coach: coachId, p_cooldown_sec: NOTIFY_COOLDOWN_SEC,
    });
    if (ncErr) return fail('db_error');
    const n = (nc ?? {}) as { ok?: boolean; reason?: string; cooldown?: boolean };
    if (!n.ok) {
      const why = remindArmOutcome(n.reason);
      return fail(why === 'nobody' ? 'db_error' : why);
    }
    if (n.cooldown) return json({ ok: true, action: 'notify', cooldown: true, groups: 0, pushed: 0 });
    // Wake-ups exist 14 days ahead before the claim looks (a roll call started seconds ago has
    // none yet): THIS roll call only. Best effort: the claim then says whatever does exist.
    try { await svcN.rpc('materialize_rollcall_ahead_svc', { p_commitment: commitmentId, p_days: 14 }); } catch { /* next tick */ }
    const { data: rowsN, error: eN } = await svcN.rpc('claim_rollcall_notices', { p_commitment: commitmentId, p_limit: 500 });
    if (eN) return fail('db_error');
    const r = await sendRollcallNotices({ svc: svcN, secret: SECRET, supabaseUrl: SUPABASE_URL, rows: (rowsN ?? []) as NoticeRow[] });
    // I1: a blocked athlete's devices count as delivered, exactly like everywhere else.
    return json({ ok: true, action: 'notify', cooldown: false, groups: r.groups, pushed: r.pushed + r.ghost });
  }

  if (!instanceId) return fail('malformed');

  const svc = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });

  // Kill switch — fail OPEN on a missing row (0141 convention), evaluated for the COACH, who is the
  // user actually taking the action.
  const { data: flag } = await svc
    .from('feature_flags').select('*').eq('name', 'rollcall_lockscreen').maybeSingle();
  if (flag && !evaluateFlag(flag as FlagRow, { userId: coachId })) return fail('flag_off');

  // ---------------------------------------------------------------- "Got it"
  if (action === 'seen') {
    const { data, error } = await svc.rpc('coach_digest_seen', {
      p_instance: instanceId, p_coach: coachId,
    });
    if (error) return fail('db_error');
    // `cleared: 0` is a success, not a miss: the coach pressed twice, or the offline queue replayed
    // the action after the app had already marked it read. Idempotent by design.
    return json({ ok: true, action: 'seen', cleared: Number(data) || 0 });
  }

  // ---------------------------------------------------------------- "Tell athletes" (0216)
  // A day was moved or skipped from the board. In-app only: a lock-screen coach code names a
  // roll call that is already running, and there is nothing to announce about that one.
  if (action === 'schedule') {
    if (code) return fail('bad_action');
    const { data: sc, error: scErr } = await svc.rpc('rollcall_schedule_notice_claim', {
      p_instance: instanceId, p_coach: coachId, p_cooldown_min: NUDGE_COOLDOWN_MIN,
    });
    if (scErr) return fail('db_error');
    const s = (sc ?? {}) as {
      ok?: boolean; reason?: CoachFailure; title?: string; coach_name?: string;
      occurs_on?: string; today?: string; skipped?: boolean; starts_min?: number | null; athlete_ids?: string[];
    };
    if (!s.ok) return fail(s.reason ?? 'db_error');
    // Block (0244): an athlete who blocked this coach gets no notice from them. I1: the coach's
    // counts include them, as if delivered.
    const whoAll = Array.isArray(s.athlete_ids) ? s.athlete_ids : [];
    const sBlocked = await blockersOf(svc, coachId, whoAll);
    const who = withoutBlockers(whoAll, sBlocked);
    const sGhostIds = whoAll.filter((id) => sBlocked.has(String(id)));
    logBlocked('roll-call-coach:schedule', sGhostIds.length);
    const sGhost = sumDevices(await deviceCounts(svc, sGhostIds), sGhostIds);
    // v3: the notice claim says it (one push per athlete per roll call), so the old per-day notice
    // and the cron can never both buzz the roster. The claim above still writes the bell rows and
    // spends the cooldown; the claim below decides who is pushed. Its sender re-checks blocks
    // against the roll call's coach and answers a blocked athlete as delivered, like sGhost here.
    const { data: instS } = await svc.from('commitment_instances').select('commitment_id').eq('id', instanceId).maybeSingle();
    const cidS = (instS as { commitment_id?: string } | null)?.commitment_id;
    let pushedS = 0;
    if (cidS && who.length) {
      const { data: rowsS } = await svc.rpc('claim_rollcall_notices', { p_commitment: cidS, p_limit: 500 });
      pushedS = (await sendRollcallNotices({ svc, secret: SECRET, supabaseUrl: SUPABASE_URL, rows: (rowsS ?? []) as NoticeRow[] })).pushed;
    }
    return json({ ok: true, action: 'schedule', targeted: whoAll.length, pushed: pushedS + sGhost });
  }

  // ---------------------------------------------------------------- v3: "Remind the N not set"
  // The coach's one action before the window: the same assignment push, re-sent to everyone whose
  // phone has not armed that morning. rollcall_arm_remind_claim authorizes the coach, honours the
  // kill switch and spends a per-morning cooldown (429 on a second press); rollcall_remind_rows_svc
  // shapes the rows like a claim so the same sender builds the push.
  if (action === 'remind_arm') {
    if (code) return fail('bad_action');
    // A caller-supplied id: a non-uuid is the caller's mistake (400), never a database error (500).
    if (!parseAthlete(instanceId)) return fail('bad_action');
    const { data: rc, error: rcErr } = await svc.rpc('rollcall_arm_remind_claim', {
      p_instance: instanceId, p_coach: coachId, p_cooldown_min: NUDGE_COOLDOWN_MIN,
    });
    if (rcErr) return fail('db_error');
    const s = (rc ?? {}) as { ok?: boolean; reason?: string; commitment_id?: string; athlete_ids?: string[] };
    if (!s.ok) {
      const why = remindArmOutcome(s.reason);
      // Everyone armed between the board read and the tap: nothing to send, nothing spent.
      if (why === 'nobody') return json({ ok: true, action: 'remind_arm', targeted: 0, pushed: 0 });
      return fail(why);
    }
    const ids = Array.isArray(s.athlete_ids) ? s.athlete_ids : [];
    if (!ids.length || !s.commitment_id) return json({ ok: true, action: 'remind_arm', targeted: 0, pushed: 0 });
    const { data: rowsR, error: rrErr } = await svc.rpc('rollcall_remind_rows_svc', { p_commitment: s.commitment_id, p_athletes: ids });
    if (rrErr) return fail('db_error');
    const r = await sendRollcallNotices({ svc, secret: SECRET, supabaseUrl: SUPABASE_URL, rows: (rowsR ?? []) as NoticeRow[] });
    return json({ ok: true, action: 'remind_arm', targeted: ids.length, pushed: r.pushed + r.ghost });
  }

  // ---------------------------------------------------------------- "Nudge them"
  const { data: claim, error: claimErr } = await svc.rpc('rollcall_nudge_claim', {
    p_instance: instanceId, p_coach: coachId, p_cooldown_min: NUDGE_COOLDOWN_MIN,
    p_athlete: athleteId,
  });
  if (claimErr) return fail('db_error');
  const c = (claim ?? {}) as {
    ok?: boolean; reason?: CoachFailure; title?: string;
    action_label?: string | null; respond_by_at?: string | null; closes_at?: string | null;
    athlete_ids?: string[];
  };
  if (!c.ok) return fail(c.reason ?? 'db_error');

  // Block (0244): an athlete who blocked this coach is not nudged by them. I1: counted as if
  // delivered, so the coach cannot tell.
  const targetsAll = Array.isArray(c.athlete_ids) ? c.athlete_ids : [];
  const nBlocked = await blockersOf(svc, coachId, targetsAll);
  const targets = withoutBlockers(targetsAll, nBlocked);
  const nGhostIds = targetsAll.filter((id) => nBlocked.has(String(id)));
  logBlocked('roll-call-coach:nudge', nGhostIds.length);
  const nGhost = sumDevices(await deviceCounts(svc, nGhostIds), nGhostIds);
  // Everyone answered between the digest and the tap. A real success with nothing to send — the
  // coach must not be told this failed, and the cooldown has legitimately been spent.
  if (!targets.length) return json({ ok: true, action: 'nudge', targeted: targetsAll.length, pushed: nGhost });

  const { data: toks } = await svc
    .from('device_tokens').select('token,user_id').in('user_id', targets);

  const deadlineMs = c.respond_by_at ? Date.parse(c.respond_by_at) : NaN;
  const now = Date.now();
  const bodyText = nudgeBody(Number.isFinite(deadlineMs) ? deadlineMs : null, now);
  const title = c.title || 'Roll call';

  const messages: Array<Record<string, unknown>> = [];
  for (const t of (toks ?? []) as Array<{ token: string; user_id: string }>) {
    // A fresh ATHLETE code per recipient, so the nudge is answerable from the lock screen the same
    // way the original reminder was. It lasts until the roll call CLOSES (0211) so a late answer
    // is recorded as late rather than refused; when there is no close (older types) it falls back
    // to the deadline, then to `now` so the button we just drew is not dead on arrival.
    const closeMs = Date.parse(c.closes_at ?? '');
    const codeDeadline = Number.isFinite(closeMs) && closeMs > now ? closeMs
      : Number.isFinite(deadlineMs) && deadlineMs > now ? deadlineMs : now;
    const athleteCode = SECRET
      ? await signRollCallCode(SECRET, {
          instanceId, athleteId: t.user_id, deadlineMs: codeDeadline, iatMs: now,
        })
      : '';
    messages.push({
      to: t.token,
      title,
      body: bodyText,
      data: { route: `roll-call/${instanceId}`, code: athleteCode, action_label: c.action_label ?? null, from_coach: false },
      categoryId: athleteCode ? rollCallCategoryId(c.action_label ?? null) : undefined,
      channelId: ROLLCALL_CHANNEL,
      // A nudge is the coach chasing a deadline they set — the same standing as the original
      // reminder, and time-sensitive because by definition the window is closing or closed. The
      // athlete's own Do Not Disturb still wins.
      priority: 'high',
      sound: 'default',
      interruptionLevel: 'time-sensitive',
    });
  }

  const pushed = await push(messages);

  // Acting on the digest IS having seen it. Without this the coach presses "Nudge them", the
  // notification dismisses, and the app still shows an unread escalation for the roll call they
  // just handled — the badge outliving the thing it was reporting. Deliberately after the push and
  // deliberately unchecked: clearing a feed row is housekeeping, and a failure here must never turn
  // a nudge that actually went out into a reported failure.
  try {
    await svc.rpc('coach_digest_seen', { p_instance: instanceId, p_coach: coachId });
  } catch { /* best effort */ }

  return json({ ok: true, action: 'nudge', targeted: targetsAll.length, pushed: pushed + nGhost });
});
