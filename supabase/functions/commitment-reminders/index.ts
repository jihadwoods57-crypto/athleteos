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
import { createClient } from 'npm:@supabase/supabase-js@2.110.0';
import { signRollCallCode } from '../_shared/rollcall-code.ts';
import { rollCallCategoryId, ROLLCALL_CHANNEL } from '../_shared/rollcall-category.ts';
import { composeReminderPush, codeDeadlineMs, platformCopy, isInitialPush, type ReminderRow } from './logic.ts';
import { ApnsClient, apnsFromEnv } from '../_shared/apns.ts';
import { pushLiveActivity, loadLiveCard } from '../_shared/rollcall-live-send.ts';
import { rollCallPushData } from '../_shared/rollcall-live.ts';

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

type Due = ReminderRow;

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);
  if (!CRON_KEY || !safeEqual(req.headers.get('x-commitment-key') ?? '', CRON_KEY)) {
    return json({ error: 'unauthorized' }, 401);
  }
  if (!SUPABASE_URL || !SERVICE_ROLE) return json({ error: 'not configured' }, 500);

  const svc = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });

  // Occurrences exist before anyone opens the app (0211). Materialization used to happen only on
  // a Home or board load, so a team whose phones stayed in pockets all day had no instance for the
  // cron to claim at 6 AM. Best-effort and idempotent: a failure here only means the next tick
  // (or the next app open) does it, and today's already-materialized rows are claimed regardless.
  let materialized = 0;
  try {
    const { data } = await svc.rpc('materialize_active_commitments');
    materialized = Number(data) || 0;
  } catch { /* best-effort */ }

  // Claim + mark in one call. Anything returned here is ours to deliver and will not be
  // returned to a concurrent run. `p_limit` (migration 0148, capacity audit F8) bounds each
  // call, so a burst that crosses more due reminders than one page could ever hold no longer
  // marks rows delivered that this invocation never actually saw — page until a call returns
  // fewer than p_limit rows (fully drained). PAGE_CAP is a hard backstop against a runaway loop
  // outrunning the function's own wall clock; hitting it just means the next 5-minute tick picks
  // up where this one left off (claim_due_commitment_reminders is safe to call again — anything
  // still due and not yet reminded stays eligible).
  const CLAIM_LIMIT = 500;
  const PAGE_CAP = 20; // up to 10,000 reminders per invocation
  const due: Due[] = [];
  for (let page = 0; page < PAGE_CAP; page++) {
    const { data, error } = await svc.rpc('claim_due_commitment_reminders', {
      p_grace_min: 10, p_limit: CLAIM_LIMIT,
    });
    if (error) return json({ error: error.message, claimed: due.length }, 500);
    const rows = (Array.isArray(data) ? data : []) as Due[];
    due.push(...rows);
    if (rows.length < CLAIM_LIMIT) break;
  }
  if (!due.length) return json({ sent: 0, pushed: 0, materialized });

  // Who is speaking (0211): the coach on the first push of a roll call, OnStandard after that.
  // Composed once per claimed row so the durable bell row and the push say the same thing.
  const now = Date.now();
  const copy = new Map<Due, ReturnType<typeof composeReminderPush>>();
  for (const d of due) copy.set(d, composeReminderPush(d, now));

  // In-app notification rows first: they are the durable record. A push that fails (stale token,
  // Expo outage) must not mean the athlete has no idea their coach is waiting.
  let recorded = 0;
  for (const d of due) {
    const c = copy.get(d)!;
    const { error: e } = await svc.rpc('record_commitment_reminder', {
      // The bell row keeps the WHOLE message even when the push body was capped.
      p_athlete: d.athlete_id, p_title: c.title, p_body: c.fromCoach ? (d.message ?? c.body) : c.body,
    });
    if (!e) recorded++;
  }

  // Then push, best-effort. One Expo request per batch of tokens.
  const athleteIds = [...new Set(due.map((d) => d.athlete_id))];
  // `platform` (0028) decides which shape of the copy this device can render: iOS draws a real
  // title/subtitle/body hierarchy, Android draws no subtitle at all. Sending the iOS shape to an
  // Android phone silently throws away whichever half lived in the subtitle.
  const { data: toks } = await svc
    .from('device_tokens').select('token,user_id,platform').in('user_id', athleteIds);

  const byAthlete = new Map<string, Due>();
  for (const d of due) if (!byAthlete.has(d.athlete_id)) byAthlete.set(d.athlete_id, d);

  const messages: Array<Record<string, unknown>> = [];
  for (const t of (toks ?? []) as Array<{ token: string; user_id: string; platform: string | null }>) {
    const d = byAthlete.get(t.user_id);
    if (!d) continue;
    const c = copy.get(d)!;
    const pc = platformCopy(c, t.platform);
    // The signed code proves one athlete + one instance — minted fresh per push so a stale/replayed
    // notification can't ack a different roll call. It lasts the whole late window (0211): a tap
    // at 6:40 on the 6:00 notification records a LATE, not an "expired"; the RPC judges the time.
    const deadlineMs = codeDeadlineMs(d, now);
    const code = ACK_SECRET
      ? await signRollCallCode(ACK_SECRET, {
          instanceId: d.instance_id, athleteId: d.athlete_id, deadlineMs, iatMs: now,
        })
      : '';
    messages.push({
      to: t.token,
      title: pc.title,
      // iOS only; Expo drops it on Android, which is why platformCopy already folded it away there.
      ...(pc.subtitle ? { subtitle: pc.subtitle } : {}),
      body: pc.body,
      // The tap lands on the commitment itself, not Home — the last inch of the loop. `code` lets
      // a lock-screen action button ack without opening the app; empty when the secret isn't set.
      data: {
        route: `roll-call/${d.instance_id}`, code, action_label: d.action_label, from_coach: c.fromCoach,
        // Read on Android by RollCallPresentationDelegate (modules/rollcall-live) to turn this into
        // an alarm-grade notification: a countdown the OS ticks to `rc_deadline`, the alarm
        // category, the state colour, and an Android 16 Live Update promotion until `rc_closes`.
        // iOS ignores them: there the same job is done properly by the Live Activity.
        ...rollCallPushData(d, isInitialPush(d) ? 'initial' : 'reminder'),
      },
      // Expo maps categoryId -> iOS notification category / Android action set. Only offer the
      // quick-action affordance when we actually minted a verifiable code.
      categoryId: code ? rollCallCategoryId(d.action_label) : undefined,
      channelId: ROLLCALL_CHANNEL,
      // ONE roll call is ONE notification, replaced in place as its state changes — not three
      // cards stacking up on the lock screen. `tag` is what actually replaces an already-displayed
      // notification on Android; `collapseId` is the iOS/FCM equivalent. Both are keyed on the
      // instance, so 6:00, 6:03 and the 6:05 late push are the same card saying a different thing.
      // The coach's words survive the replacement in the bell row and in the app, which is where
      // an athlete goes to re-read them; the lock screen's job is to say what is true NOW.
      tag: `rollcall-${d.instance_id}`,
      collapseId: `rollcall-${d.instance_id}`,
      // A coach-scheduled commitment is a scheduled event, not a nudge: it is allowed to break
      // through at 4:45 AM. The phone's own Do Not Disturb still wins.
      priority: 'high',
      sound: 'default',
    });
  }

  // ---------------------------------------------------------------- iOS Live Activity
  // The notification above is what RECORDS the tap (its action button works while the phone is
  // locked). This is what makes the roll call PRESENT: a card the athlete's iPhone draws and keeps
  // on the lock screen, with a countdown it ticks itself. Entirely optional — no APNs key, no
  // registered iPhone, or an un-migrated stack all end here as a quiet no-op.
  const live = { started: 0, updated: 0, ended: 0, revoked: 0, skipped: 0 };
  const apnsCfg = apnsFromEnv((k) => Deno.env.get(k));
  if (apnsCfg) {
    const apns = new ApnsClient(apnsCfg); // ONE client: it caches the provider token Apple rate-limits.
    const byInstance = new Map<string, Due[]>();
    for (const d of due) {
      if (d.type !== 'morning_roll_call') continue;
      const list = byInstance.get(d.instance_id) ?? [];
      list.push(d);
      byInstance.set(d.instance_id, list);
    }
    for (const [instanceId, rows] of byInstance) {
      const card = await loadLiveCard(svc, instanceId);
      if (!card) continue;
      // The rung that fires AT the start time opens the activity; any later rung updates it.
      const phase = isInitialPush(rows[0]) ? 'initial' : 'reminder';
      const c = copy.get(rows[0])!;
      const r = await pushLiveActivity({
        svc, apns, card, phase,
        athleteIds: [...new Set(rows.map((x) => x.athlete_id))],
        // The card is already on screen at REMINDER, so the alert is what makes the phone light up
        // a second time. Same words the notification carries, so the two surfaces never disagree.
        alert: { title: c.title, body: c.subtitle ?? c.body, sound: 'default' },
        nowMs: now,
      });
      live.started += r.started; live.updated += r.updated; live.ended += r.ended;
      live.revoked += r.revoked; live.skipped += r.skipped;
    }
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

  return json({ sent: recorded, pushed, claimed: due.length, materialized, live });
});
