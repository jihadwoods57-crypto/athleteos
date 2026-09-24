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
// INVOCATION: scheduled every minute (schedule_commitment_reminders, 0211: '* * * * *').
// Protected by a shared key so only the scheduler can fire it (deploy with --no-verify-jwt; an
// anon caller without the key gets 401):
//   supabase secrets set COMMITMENT_CRON_KEY=<long random string>
//   supabase functions deploy commitment-reminders --use-api --no-verify-jwt
// Then: select schedule_commitment_reminders('<fn url>', '<the same key>');
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2.110.0';
import { signRollCallCode } from '../_shared/rollcall-code.ts';
import { rollCallCategoryId, ROLLCALL_CHANNEL, ROLLCALL_QUIET_CHANNEL } from '../_shared/rollcall-category.ts';
import { composeReminderPush, codeDeadlineMs, platformCopy, isInitialPush, cardPlanAtRung, splitStartGroups, openingDelivery, clockIn, reminderRoute, type ReminderRow } from './logic.ts';
import { ApnsClient, apnsFromEnv } from '../_shared/apns.ts';
import { pushLiveActivity, loadLiveCard, loadTeamBoard, windowCodesFor, ackUrlFor } from '../_shared/rollcall-live-send.ts';
import { rollCallPushData, teamFields } from '../_shared/rollcall-live.ts';
// Expo answers a refused batch with HTTP 200 + per-message error tickets, so `r.ok` counted
// refusals as deliveries. sendExpoPush reads the tickets; see _shared/expo-push.mjs.
import { sendExpoPush } from '../_shared/expo-push.mjs';
import { sendRollcallNotices, type NoticeRunResult } from '../_shared/rollcall-notice-send.ts';
import type { NoticeRow } from '../_shared/rollcall-notice.ts';

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

/** Undo a start claim (commitment_responses.card_started_at) for athletes a push did not
 *  genuinely reach, or after anything downstream of the claim threw — so the next minute's tick
 *  claims and retries them instead of leaving them silently claimed forever (fix round 1, review
 *  round 1, Important #1). Best effort and never throws: a release that itself fails just means
 *  the retry happens a tick later than it could have. */
async function releaseCardStarts(svc: SupabaseClient, instanceId: string, athleteIds: string[]): Promise<void> {
  if (!athleteIds.length) return;
  try {
    await svc.rpc('release_rollcall_card_start', { p_instance: instanceId, p_athletes: athleteIds });
  } catch { /* best effort */ }
}

/** Roll call v3: tell them. Wake-ups exist 14 days ahead (the alarm horizon), then ONE assignment /
 *  change / cancel push per athlete per roll call for whatever changed since they were last told
 *  (0247 claim_rollcall_notices). This is what makes a coach's 8 PM move reach a phone whose app is
 *  closed. Runs AFTER the reminder rungs (a burst of assignments must never delay a 6:00 reminder)
 *  and is independent of them: a failure costs one tick, never a reminder; an unsettled claim
 *  lapses in two minutes and the next tick retries it. */
async function runNotices(svc: SupabaseClient): Promise<NoticeRunResult | null> {
  try {
    await svc.rpc('materialize_rollcalls_ahead', { p_days: 14 });
    const { data: nrows, error } = await svc.rpc('claim_rollcall_notices', { p_commitment: null, p_limit: 500 });
    if (error) return null;
    return await sendRollcallNotices({ svc, secret: ACK_SECRET, supabaseUrl: SUPABASE_URL, rows: (nrows ?? []) as NoticeRow[] });
  } catch {
    return null;
  }
}

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

  // ---------------------------------------------------------------- the card opens at the OPEN
  // 2026-09-23 (spec correction 7): a wake-up opens 10 minutes before its start (0242
  // rollcall_opens_at), and its Live Activity goes up then, by itself, on every pending athlete's
  // iPhone. It carries each athlete's WINDOW code and the ack URL in its attributes, so the card's
  // I'm Up posts the check-in with the app closed. The alert is SILENT: the card lights the screen,
  // but the loud moment stays the start (the alarm, or the start-time rung below, which then
  // UPDATES this card with the coach's words and the sound instead of starting a second one).
  // Claimed once per ATHLETE (commitment_responses.card_started_at), before the early return: a
  // tick with no reminder rungs due still has cards to open, and this same call runs every tick.
  // Fix round 1 (review round 1, Important #1): claim_rollcall_card_opens now only claims an
  // athlete who is START-ELIGIBLE right now (an unrevoked push-to-start token, no card yet), so an
  // athlete with no token at all is simply left unclaimed rather than claimed-and-wasted — the
  // very next tick, once their phone registers one, claims them. And any athlete claimed here
  // whose push does NOT land in pushLiveActivity's `live` set (APNs refused it, the token was
  // gone) or whose push throws is released (release_rollcall_card_start) below, so the next
  // tick's claim picks them straight back up instead of leaving them silently claimed forever.
  // No notification here: an athlete whose card did not start still gets the start-time
  // notification, exactly as before.
  const opened = { instances: 0, started: 0, skipped: 0, revoked: 0 };
  const apnsForOpen = apnsFromEnv((k) => Deno.env.get(k));
  if (apnsForOpen) {
    try {
      const { data: opens } = await svc.rpc('claim_rollcall_card_opens', { p_limit: 200 });
      const list = (Array.isArray(opens) ? opens : []) as Array<{ instance_id: string; athlete_ids: string[] | null }>;
      if (list.length) {
        const apns = new ApnsClient(apnsForOpen);
        for (const o of list) {
          opened.instances++;
          const ids = Array.isArray(o.athlete_ids) ? o.athlete_ids : [];
          if (!ids.length) continue;
          try {
            const card = await loadLiveCard(svc, o.instance_id);
            if (!card) { await releaseCardStarts(svc, o.instance_id, ids); continue; }
            const board = await loadTeamBoard(svc, o.instance_id);
            const dl = clockIn(card.respond_by_at, card.timezone);
            const title = card.title || 'Wake-Up Roll Call';
            const r = await pushLiveActivity({
              svc, apns, card, phase: 'initial', athleteIds: ids, allowStart: true,
              alert: { title: card.coach_name || title, body: dl ? `${title} · up by ${dl}` : title, sound: '' },
              team: (id) => teamFields(board, id),
              ackCodes: await windowCodesFor(ACK_SECRET, card, ids),
              ackUrl: ackUrlFor(SUPABASE_URL),
              nowMs: Date.now(),
            });
            opened.started += r.started + r.updated; opened.skipped += r.skipped; opened.revoked += r.revoked;
            const missed = ids.filter((id) => !r.live.has(id));
            if (missed.length) await releaseCardStarts(svc, o.instance_id, missed);
          } catch {
            // Anything that threw after the claim (a bad card read, a push that blew up) leaves
            // these athletes claimed with no attempt made — release so the next tick retries them.
            await releaseCardStarts(svc, o.instance_id, ids);
          }
        }
      }
    } catch { /* the RPC may not exist on an un-migrated stack; the rungs below are unaffected */ }
  }

  // Claim + mark in one call. Anything returned here is ours to deliver and will not be
  // returned to a concurrent run. `p_limit` (migration 0148, capacity audit F8) bounds each
  // call, so a burst that crosses more due reminders than one page could ever hold no longer
  // marks rows delivered that this invocation never actually saw — page until a call returns
  // fewer than p_limit rows (fully drained). PAGE_CAP is a hard backstop against a runaway loop
  // outrunning the function's own wall clock; hitting it just means the next minute's tick picks
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
  if (!due.length) return json({ sent: 0, pushed: 0, materialized, opened, notices: await runNotices(svc) });

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

  // ---------------------------------------------------------------- who is already ringing
  // A phone on iOS 26.1 or Android arms a REAL alarm for the wake-up and reports it (0239
  // alarm_armed_at). For that athlete the OPENING push and the card's alert go out silent: the
  // alarm is the sound, and an alarm plus a chime plus a card alert for one morning was the
  // "triple alert" the 2026-09-15 audit recorded. Only the opening rung is muted; a reminder or a
  // late push arrives after the alarm has stopped and keeps its sound. Read separately rather
  // than through the claim RPC, whose return type is a deploy-ordering hazard to change.
  const armed = new Set<string>();
  const openingWake = due.filter((d) => d.type === 'morning_roll_call' && isInitialPush(d));
  if (openingWake.length) {
    try {
      const { data: rows } = await svc
        .from('commitment_responses').select('instance_id,athlete_id,alarm_armed_at')
        .in('instance_id', [...new Set(openingWake.map((d) => d.instance_id))])
        .not('alarm_armed_at', 'is', null);
      for (const r of (rows ?? []) as Array<{ instance_id: string; athlete_id: string }>) {
        armed.add(`${r.instance_id}:${r.athlete_id}`);
      }
    } catch { /* best-effort: nobody is muted, which is the pre-0239 behaviour */ }
  }
  const isArmed = (d: Due) => isInitialPush(d) && armed.has(`${d.instance_id}:${d.athlete_id}`);

  // ---------------------------------------------------------------- iOS Live Activity, FIRST
  // ONE roll call puts ONE thing on the lock screen. The card goes up before any notification is
  // composed, and every athlete Apple accepted a card for is then SKIPPED below, so nobody ends up
  // with a Live Activity and a notification stacked under it saying the same words.
  //
  // Order matters and is the whole safety argument: suppressing on the INTENT to send a card would
  // leave an athlete whose card failed with nothing at all. Suppressing on the ACCEPTED push means
  // the notification is still there for every phone that did not get a card, for whatever reason.
  const live = { started: 0, updated: 0, ended: 0, revoked: 0, skipped: 0 };
  const hasCard = new Set<string>();
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
    // Which (instance, athlete) pairs already have a start claimed (card_started_at). Per
    // athlete, not per instance: an athlete the open pass never reached (no start token yet at
    // the open, a roll call made after its own open already passed) still gets a start attempt
    // from THIS rung, below, once claim_rollcall_card_starts finds them start-eligible. Unknown (a
    // read failure, an un-migrated stack) reads as NOT started, the pre-0242 behaviour: everyone
    // is a start candidate below (claim_rollcall_card_starts still gates on eligibility either way).
    const started = new Set<string>(); // `${instanceId}:${athleteId}`
    if (byInstance.size) {
      try {
        const { data: resp } = await svc
          .from('commitment_responses').select('instance_id,athlete_id')
          .in('instance_id', [...byInstance.keys()]).not('card_started_at', 'is', null);
        for (const r of (resp ?? []) as Array<{ instance_id: string; athlete_id: string }>) {
          started.add(`${r.instance_id}:${r.athlete_id}`);
        }
      } catch { /* best effort */ }
    }
    const ackUrl = ackUrlFor(SUPABASE_URL);
    for (const [instanceId, rows] of byInstance) {
      const card = await loadLiveCard(svc, instanceId);
      if (!card) continue;
      // Only the phase matters here; allowStart is decided per athlete just below, so the second
      // argument (which only affects allowStart) is irrelevant.
      const phase = cardPlanAtRung(rows[0], true).phase;
      const board = await loadTeamBoard(svc, instanceId);
      const c = copy.get(rows[0])!;
      // Claim a fresh start for whichever of this rung's athletes have never been claimed AND are
      // start-eligible right now (claim_rollcall_card_starts checks the push-to-start token) — the
      // open pass may have missed them entirely, or they had no token until just now. Atomic, so a
      // concurrent open-pass tick cannot also attempt the same athlete: only the ids it returns may
      // start; anyone else in `rows` already has a claim (accepted, or awaiting release) or still
      // has no start token, and gets update-only.
      let justClaimed = new Set<string>();
      if (phase === 'initial') {
        const candidates = [...new Set(rows.map((r) => r.athlete_id))]
          .filter((id) => !started.has(`${instanceId}:${id}`));
        if (candidates.length) {
          try {
            const { data: won } = await svc.rpc('claim_rollcall_card_starts', {
              p_instance: instanceId, p_athletes: candidates,
            });
            justClaimed = new Set((Array.isArray(won) ? won : []).map((x: unknown) =>
              typeof x === 'string' ? x : String(Object.values((x ?? {}) as Record<string, unknown>)[0] ?? '')));
          } catch { /* best effort: nobody newly claimed here; the open pass may still catch them */ }
        }
      }
      // Two axes: alarm-armed (sound on/off) and start-eligible (start vs update-only) — pure,
      // tested in logic.ts (splitStartGroups, review round 1, Minor #2). The card IS the
      // notification now, so its alert is what lights the phone up and plays the sound. Same words
      // the suppressed notification would have carried.
      // Roll call v3 (the backup alert): at the START the card's alert is quiet for everyone. For an
      // armed athlete the alarm is the sound; for an unarmed one the time-sensitive notification
      // below (openingDelivery) is, and that notification is no longer suppressed under the card,
      // so a sounding card alert as well would be two noises for one roll call. Follow-up rungs
      // keep the card's sound (cardQuiet is false there).
      const armedIds = new Set(rows.filter((x) => isArmed(x)).map((x) => x.athlete_id));
      const rowOf = new Map(rows.map((x) => [x.athlete_id, x] as const));
      const quietCard = (id: string) => armedIds.has(id)
        || (phase === 'initial' && openingDelivery(rowOf.get(id)!, false).cardQuiet);
      const groups = splitStartGroups(rows.map((r) => r.athlete_id), quietCard, justClaimed);
      for (const g of groups) {
        try {
          const r = await pushLiveActivity({
            svc, apns, card, phase,
            athleteIds: g.ids,
            allowStart: phase === 'initial' && g.allowStart,
            team: (id) => teamFields(board, id),
            ackCodes: (phase === 'initial' && g.allowStart) ? await windowCodesFor(ACK_SECRET, card, g.ids) : undefined,
            ackUrl,
            alert: { title: c.title, body: c.subtitle ?? c.body, sound: g.sound },
            nowMs: now,
          });
          live.started += r.started; live.updated += r.updated; live.ended += r.ended;
          live.revoked += r.revoked; live.skipped += r.skipped;
          for (const id of r.live) hasCard.add(id);
          // Fix round 1 (review round 1, Important #1): a start we just claimed but that did not
          // genuinely reach a device is released, so the next tick's claim retries it instead of
          // leaving that athlete silently claimed for the rest of the morning.
          if (g.allowStart) {
            const missed = g.ids.filter((id) => !r.live.has(id));
            if (missed.length) await releaseCardStarts(svc, instanceId, missed);
          }
        } catch {
          if (g.allowStart) await releaseCardStarts(svc, instanceId, g.ids);
        }
      }
    }
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

  // How many iPhones each athlete has registered. A card is started on ONE device (the newest
  // push-to-start token), so on an athlete with two iPhones suppressing by athlete would leave the
  // second phone silent. Below, the notification is only withheld when there is exactly one iOS
  // device for it to be redundant with.
  const iosTokenCount = new Map<string, number>();
  for (const t of (toks ?? []) as Array<{ user_id: string; platform: string | null }>) {
    if (t.platform === 'ios') iosTokenCount.set(t.user_id, (iosTokenCount.get(t.user_id) ?? 0) + 1);
  }

  const messages: Array<Record<string, unknown>> = [];
  let suppressed = 0;
  let backup = 0;
  for (const t of (toks ?? []) as Array<{ token: string; user_id: string; platform: string | null }>) {
    const d = byAthlete.get(t.user_id);
    if (!d) continue;
    // The card is already on this phone saying exactly this. Skipping is the whole point of doing
    // the Live Activity first. Android never matches (it has no card) and neither does an athlete
    // whose card Apple refused, so neither can be left with a silent morning.
    // Roll call v3: EXCEPT the start push of an athlete with no armed alarm. The card cannot ring
    // for 28 seconds and nothing else will wake them, so that notification always goes out
    // (openingDelivery: time-sensitive, the bundled alarm sound).
    const delivery = openingDelivery(d, isArmed(d));
    if (t.platform === 'ios' && hasCard.has(t.user_id) && iosTokenCount.get(t.user_id) === 1 && delivery.suppressWithCard) {
      suppressed++;
      continue;
    }
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
        route: reminderRoute(d.type, d.instance_id),
        code, action_label: d.action_label, from_coach: c.fromCoach,
        // Read on Android by RollCallPresentationDelegate (modules/rollcall-live) to turn this into
        // an alarm-grade notification: a countdown the OS ticks to `rc_deadline`, the alarm
        // category, the state colour, and an Android 16 Live Update promotion until `rc_closes`.
        // iOS ignores them: there the same job is done properly by the Live Activity.
        ...rollCallPushData(d, isInitialPush(d) ? 'initial' : 'reminder'),
      },
      // Expo maps categoryId -> iOS notification category / Android action set. Only offer the
      // quick-action affordance when we actually minted a verifiable code.
      categoryId: code ? rollCallCategoryId(d.action_label) : undefined,
      // The quiet channel for a phone already ringing its own alarm (Android plays the CHANNEL's
      // sound); iOS reads `sound` directly below.
      channelId: isArmed(d) ? ROLLCALL_QUIET_CHANNEL : ROLLCALL_CHANNEL,
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
      // iOS only (Expo drops both on Android, where the channel decides). The custom sound is part
      // of the BINARY (app.json expo-notifications `sounds`): an older build plays the default
      // sound for a name it does not have, and one without the time-sensitive entitlement gets it
      // as 'active'. Both are the pre-v3 behaviour.
      sound: delivery.sound,
      ...(delivery.interruptionLevel === 'time-sensitive' ? { interruptionLevel: 'time-sensitive' } : {}),
    });
    if (delivery.interruptionLevel === 'time-sensitive') backup++;
  }

  // Best-effort: the notification row is already written, so the athlete still sees it in app.
  // `pushed` is what Expo ACCEPTED — a refusal is logged, never counted as a delivery.
  const pushOut = await sendExpoPush(messages);
  const pushed = pushOut.sent;
  if (pushOut.failed) console.error('commitment-reminders: push refused', pushOut.failed, pushOut.errors.join('; '));

  const notices = await runNotices(svc);
  return json({ sent: recorded, pushed, claimed: due.length, materialized, live, suppressed, backup, opened, notices });
});
