// OnStandard: the roll call v3 assignment/change push, the decision half (2026-09-24).
//
// Every rule about WHO gets a push and HOW each claimed row is settled lives here, with the IO
// injected (rollcall-notice-send.ts wires Supabase and Expo), so jest pins the rules without a
// database. Imports only the pure rollcall-notice.ts: loaded by Deno (edge) and jest (babel).
//
// THE SETTLE RULES (0247: settled is not told).
//   - A row whose push reached a phone (an `ok` Expo ticket for at least one of the athlete's
//     tokens) settles with sent: true. That is the ONLY way notified_at is stamped. A 200 carrying
//     error tickets is not a delivery (push-never-delivered, 2026-09-18).
//   - A row with nothing to say (silent), an athlete with no token, notifications switched off, or a
//     push Expo refused settles with sent: false: it is not re-claimed every minute (the claim's
//     notice_settled_at), and the coach's board still reads "Hasn't been told". The coach's Remind
//     is the retry.
//   - Blocked (0244, I1): the athlete who blocked the coach gets no push in that coach's name, and
//     is answered EXACTLY like a delivered one (sent: true, counted as ghost pushes), so the coach
//     cannot tell they were blocked.
//   - A group this run cannot finish (over the per-run cap, no roll call context) is RELEASED for
//     the next tick. A settle that itself fails is swallowed: the claim lapses in two minutes.
import {
  groupNotices, noticeCopy, armPayload, alarmTitleOf, alarmLabelOf, settleRowsOf, NOTICE_ROUTE,
  type NoticeRow, type NoticeContext, type NoticeGroup, type ArmItem, type ArmPayload, type SettleRow,
} from './rollcall-notice.ts';

/** One athlete is one Expo request (settling needs to know THEIR delivery). Beyond this many per
 *  run, groups are released and go out on the next tick, a minute later. */
export const MAX_GROUPS_PER_RUN = 150;

export type NoticeToken = { token: string; platform: string | null };
export type NoticeSendOutcome = { sent: number; failed: number; dead: string[] };
export type NoticeWindow = { opensMs: number; closesMs: number };

export type NoticeDeps = {
  contexts(commitmentIds: string[]): Promise<Map<string, NoticeContext>>;
  tokens(athleteIds: string[]): Promise<Map<string, NoticeToken[]>>;
  /** Athletes whose master switch (profiles.notifications_opt_out) is off. */
  optedOut(athleteIds: string[]): Promise<Set<string>>;
  /** The athletes (of `athleteIds`) who blocked `coachId`. Fails open (empty) like blocks.mjs. */
  blockers(coachId: string, athleteIds: string[]): Promise<Set<string>>;
  /** rollcall_push_arming for this athlete. OFF in production (the device spike failed). */
  armOn(athleteId: string): boolean;
  windows(instanceIds: string[]): Promise<Map<string, NoticeWindow>>;
  /** A WINDOW code for the extension to report the alarm armed; '' when it cannot be signed. */
  sign(instanceId: string, athleteId: string, w: NoticeWindow): Promise<string>;
  send(messages: Array<Record<string, unknown>>): Promise<NoticeSendOutcome>;
  settle(rows: SettleRow[], notified: boolean): Promise<number>;
  /** The roll-call-ack URL the extension posts its armed report to; '' disables the schedule. */
  ackUrl: string;
  channelId: string;
};

export type NoticeRunResult = {
  groups: number;    // groups this run handled (sent, settled or released)
  pushed: number;    // Expo `ok` tickets
  ghost: number;     // devices of blocked athletes, answered as delivered (I1)
  told: number;      // rows settled as actually told (sent: true)
  settled: number;   // rows settled (told or not)
  released: number;  // rows released for the next tick
};

/** Whether a group has anything to say. A group made only of silent rows never reaches noticeCopy. */
export const hasSomethingToSay = (g: NoticeGroup) => g.arm.length > 0 || g.cancel.length > 0;

/** Delivered = at least one `ok` ticket. Nothing else counts. */
export const delivered = (o: NoticeSendOutcome | null | undefined) => !!o && o.sent > 0;

/** The push for one athlete's group, one message per device. `rc` (the schedule) rides only when
 *  given, and mutableContent only with it and only on iOS (what wakes the Service Extension). */
export function noticeMessages(
  g: NoticeGroup, copy: ReturnType<typeof noticeCopy>, tokens: NoticeToken[], rc: ArmPayload | null, channelId: string,
): Array<Record<string, unknown>> {
  return tokens.map((t) => ({
    to: t.token,
    title: copy.title,
    body: copy.body,
    data: { route: NOTICE_ROUTE(g.commitmentId), from_coach: g.kind !== 'extend', ...(rc ? { rc } : {}) },
    ...(rc && t.platform === 'ios' ? { mutableContent: true } : {}),
    channelId,
    priority: 'high',
    sound: copy.sound,
    ...(copy.interruption === 'passive' ? { interruptionLevel: 'passive' } : {}),
    // One roll call's notice replaces its previous one on the lock screen.
    tag: `rollcall-notice-${g.commitmentId}`,
    collapseId: `rollcall-notice-${g.commitmentId}`,
  }));
}

export async function runRollcallNotices(rowsIn: NoticeRow[], d: NoticeDeps): Promise<NoticeRunResult> {
  const out: NoticeRunResult = { groups: 0, pushed: 0, ghost: 0, told: 0, settled: 0, released: 0 };
  const rows = Array.isArray(rowsIn) ? rowsIn : [];
  if (!rows.length) return out;

  const settle = async (list: NoticeRow[], sentIds: Iterable<string> = []) => {
    if (!list.length) return;
    const payload = settleRowsOf(list, sentIds);
    try {
      const n = Number(await d.settle(payload, true)) || 0;
      out.settled += n;
      out.told += Math.min(n, payload.filter((r) => r.sent).length);
    } catch { /* the claim lapses after two minutes and the next tick retries */ }
  };
  const release = async (list: NoticeRow[]) => {
    if (!list.length) return;
    try { out.released += Number(await d.settle(settleRowsOf(list), false)) || 0; }
    catch { /* the claim lapses after two minutes */ }
  };
  const rowsOf = (g: NoticeGroup) => [...g.arm, ...g.cancel, ...g.silent];

  const all = groupNotices(rows);
  const groups = all.slice(0, MAX_GROUPS_PER_RUN);
  await release(all.slice(MAX_GROUPS_PER_RUN).flatMap(rowsOf));

  // Silent-only groups: settle, never a push, never noticeCopy. The silent rows of a speaking group
  // settle the same way (nothing was said about them).
  const speaking: NoticeGroup[] = [];
  for (const g of groups) {
    out.groups++;
    await settle(g.silent);
    if (hasSomethingToSay(g)) speaking.push(g);
  }
  if (!speaking.length) return out;

  const athleteIds = [...new Set(speaking.map((g) => g.athleteId))];
  let ctxOf: Map<string, NoticeContext>, tokensOf: Map<string, NoticeToken[]>, optedOut: Set<string>;
  try {
    [ctxOf, tokensOf, optedOut] = await Promise.all([
      d.contexts([...new Set(speaking.map((g) => g.commitmentId))]),
      d.tokens(athleteIds),
      d.optedOut(athleteIds),
    ]);
  } catch {
    // A failed read must not settle anyone as "no phone": release it all for the next tick.
    await release(speaking.flatMap((g) => [...g.arm, ...g.cancel]));
    return out;
  }

  const blockedBy = new Map<string, Set<string>>();   // commitment -> athletes who blocked its coach
  for (const [cid, c] of ctxOf) {
    if (!c.coach_id) continue;
    const ids = [...new Set(speaking.filter((g) => g.commitmentId === cid).map((g) => g.athleteId))];
    try { blockedBy.set(cid, await d.blockers(c.coach_id, ids)); } catch { /* fail open */ }
  }

  const armFor = (g: NoticeGroup, ctx: NoticeContext) => ctx.alarm !== false && !!d.ackUrl && d.armOn(g.athleteId);
  const armIds = [...new Set(speaking.filter((g) => {
    const c = ctxOf.get(g.commitmentId);
    return !!c && armFor(g, c);
  }).flatMap((g) => g.arm.map((r) => r.instance_id)))];
  const win = armIds.length ? await d.windows(armIds) : new Map<string, NoticeWindow>();

  for (const g of speaking) {
    const said = [...g.arm, ...g.cancel];
    const ctx = ctxOf.get(g.commitmentId);
    if (!ctx) { await release(said); continue; }
    const tokens = tokensOf.get(g.athleteId) ?? [];
    if (blockedBy.get(g.commitmentId)?.has(g.athleteId)) {
      out.ghost += tokens.length;
      await settle(said, tokens.length ? said.map((r) => r.response_id) : []);
      continue;
    }
    if (!tokens.length || optedOut.has(g.athleteId)) { await settle(said); continue; }

    const copy = noticeCopy(g, ctx);
    let rc: ArmPayload | null = null;
    if (armFor(g, ctx)) {
      const items: ArmItem[] = [];
      for (const r of g.arm) {
        const at = Date.parse(r.starts_at);
        if (!Number.isFinite(at)) continue;
        const w = win.get(r.instance_id);
        let c = '';
        if (w && Number.isFinite(w.opensMs) && Number.isFinite(w.closesMs)) {
          try { c = await d.sign(r.instance_id, g.athleteId, w); } catch { c = ''; }
        }
        items.push(c ? { i: r.instance_id, at, c } : { i: r.instance_id, at });
      }
      rc = armPayload({
        kind: g.kind, title: alarmTitleOf(ctx), label: alarmLabelOf(ctx), url: d.ackUrl, items,
        cancel: g.cancel.map((r) => r.instance_id), set: copy.setBody,
      });
    }

    let res: NoticeSendOutcome | null = null;
    try { res = await d.send(noticeMessages(g, copy, tokens, rc, d.channelId)); } catch { res = null; }
    out.pushed += res ? res.sent : 0;
    await settle(said, delivered(res) ? said.map((r) => r.response_id) : []);
  }
  return out;
}
