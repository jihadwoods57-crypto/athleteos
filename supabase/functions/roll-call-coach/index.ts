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
import { rollCallCategoryId } from '../_shared/rollcall-category.ts';
import { evaluateFlag, type FlagRow } from '../_shared/feature-flags.ts';
import { parseAction, httpStatusForCoach, nudgeBody, type CoachFailure } from './logic.ts';

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
  let sent = 0;
  for (let i = 0; i < messages.length; i += 100) {
    try {
      const r = await fetch('https://exp.host/--/api/v2/push/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(messages.slice(i, i + 100)),
      });
      if (r.ok) sent += Math.min(100, messages.length - i);
    } catch { /* best effort */ }
  }
  return sent;
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return json({ ok: false, error: 'method not allowed' }, 405);
  if (!SUPABASE_URL || !SERVICE_ROLE) return json({ ok: false, error: 'not configured' }, 500);

  let body: { code?: unknown; instance?: unknown; action?: unknown } = {};
  try { body = (await req.json()) as typeof body; } catch { /* empty */ }

  const action = parseAction(body.action);
  if (!action) return fail('bad_action');

  // ---------------------------------------------------------------- who is asking
  let coachId = '';
  let instanceId = '';
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

  // ---------------------------------------------------------------- "Nudge them"
  const { data: claim, error: claimErr } = await svc.rpc('rollcall_nudge_claim', {
    p_instance: instanceId, p_coach: coachId, p_cooldown_min: NUDGE_COOLDOWN_MIN,
  });
  if (claimErr) return fail('db_error');
  const c = (claim ?? {}) as {
    ok?: boolean; reason?: CoachFailure; title?: string;
    action_label?: string | null; respond_by_at?: string | null; athlete_ids?: string[];
  };
  if (!c.ok) return fail(c.reason ?? 'db_error');

  const targets = Array.isArray(c.athlete_ids) ? c.athlete_ids : [];
  // Everyone answered between the digest and the tap. A real success with nothing to send — the
  // coach must not be told this failed, and the cooldown has legitimately been spent.
  if (!targets.length) return json({ ok: true, action: 'nudge', targeted: 0, pushed: 0 });

  const { data: toks } = await svc
    .from('device_tokens').select('token,user_id').in('user_id', targets);

  const deadlineMs = c.respond_by_at ? Date.parse(c.respond_by_at) : NaN;
  const now = Date.now();
  const bodyText = nudgeBody(Number.isFinite(deadlineMs) ? deadlineMs : null, now);
  const title = c.title || 'Roll call';

  const messages: Array<Record<string, unknown>> = [];
  for (const t of (toks ?? []) as Array<{ token: string; user_id: string }>) {
    // A fresh ATHLETE code per recipient, so the nudge is answerable from the lock screen the same
    // way the original reminder was. Minted against the athlete's own deadline; when the coach
    // nudges after it has passed, `now` is used so the code stays spendable for the ack grace —
    // otherwise the button we just drew would be dead on arrival.
    const codeDeadline = Number.isFinite(deadlineMs) && deadlineMs > now ? deadlineMs : now;
    const athleteCode = SECRET
      ? await signRollCallCode(SECRET, {
          instanceId, athleteId: t.user_id, deadlineMs: codeDeadline, iatMs: now,
        })
      : '';
    messages.push({
      to: t.token,
      title,
      body: bodyText,
      data: { route: `roll-call/${instanceId}`, code: athleteCode, action_label: c.action_label ?? null },
      categoryId: athleteCode ? rollCallCategoryId(c.action_label ?? null) : undefined,
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

  return json({ ok: true, action: 'nudge', targeted: targets.length, pushed });
});
