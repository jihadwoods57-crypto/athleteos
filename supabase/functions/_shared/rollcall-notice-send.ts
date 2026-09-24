// OnStandard: the roll call v3 assignment/change push, the IO half (2026-09-24).
//
// Takes claim rows (claim_rollcall_notices or rollcall_remind_rows_svc, 0247), sends ONE push per
// athlete per roll call, and settles every row. Called by commitment-reminders every minute and by
// roll-call-coach's "notify" / "schedule" / "remind_arm" for an immediate send. The claim is the
// lock, so the cron and a coach's button can never both send the same notice.
//
// The rules (who is pushed, what counts as told, what is released) live in rollcall-notice-run.ts,
// pinned by jest. This file only wires Supabase and Expo into them.
//
// data.rc (the schedule for the Notification Service Extension) and mutableContent ride along only
// where the rollcall_push_arming flag says so for this athlete and the coach wants an alarm at all.
// THE DEVICE SPIKE FAILED (2026-09-24): the flag stays OFF, so the live push is a plain
// notification whose text never claims an alarm was set ("Open OnStandard to set your alarm").
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.110.0';
import { signWindowCode } from './rollcall-code.ts';
import { evaluateFlag, type FlagRow } from './feature-flags.ts';
import { sendExpoPushAndPrune } from './expo-push.mjs';
import { blockersOf, logBlocked } from './blocks.mjs';
import { ROLLCALL_CHANNEL } from './rollcall-category.ts';
import { ackUrlFor } from './rollcall-live-send.ts';
import type { NoticeRow, NoticeContext } from './rollcall-notice.ts';
import { runRollcallNotices, type NoticeRunResult, type NoticeToken, type NoticeWindow } from './rollcall-notice-run.ts';

export { MAX_GROUPS_PER_RUN } from './rollcall-notice-run.ts';
export type { NoticeRunResult } from './rollcall-notice-run.ts';

export const PUSH_ARMING_FLAG = 'rollcall_push_arming';

export async function sendRollcallNotices(o: {
  svc: SupabaseClient; secret: string; supabaseUrl: string; rows: NoticeRow[];
}): Promise<NoticeRunResult> {
  const { svc } = o;
  const rows = Array.isArray(o.rows) ? o.rows : [];
  if (!rows.length) return { groups: 0, pushed: 0, ghost: 0, told: 0, settled: 0, released: 0 };

  // Fails CLOSED: an unreadable flag row means no schedule, which is the safe (and live) default.
  let flagRow: FlagRow | null = null;
  try {
    const { data } = await svc.from('feature_flags').select('*').eq('name', PUSH_ARMING_FLAG).maybeSingle();
    flagRow = (data as FlagRow | null) ?? null;
  } catch { flagRow = null; }

  const r = await runRollcallNotices(rows, {
    ackUrl: o.secret ? ackUrlFor(o.supabaseUrl) : '',
    channelId: ROLLCALL_CHANNEL,
    armOn: (athleteId) => !!flagRow && evaluateFlag(flagRow, { userId: athleteId }),
    contexts: async (ids) => {
      const { data, error } = await svc.rpc('rollcall_notice_context_svc', { p_commitments: ids });
      if (error) throw error;
      return new Map(((data ?? []) as NoticeContext[]).map((c) => [String(c.commitment_id), c]));
    },
    tokens: async (ids) => {
      const out = new Map<string, NoticeToken[]>();
      const { data } = await svc.from('device_tokens').select('token,user_id,platform').in('user_id', ids);
      for (const t of (data ?? []) as Array<{ token: string; user_id: string; platform: string | null }>) {
        const list = out.get(t.user_id) ?? [];
        list.push({ token: t.token, platform: t.platform });
        out.set(t.user_id, list);
      }
      return out;
    },
    // The athlete's master switch (0067), the same one send-push honours. Fails OPEN like it.
    optedOut: async (ids) => {
      try {
        const { data } = await svc.from('profiles').select('id,notifications_opt_out').in('id', ids);
        return new Set(((data ?? []) as Array<{ id: string; notifications_opt_out?: boolean | null }>)
          .filter((p) => p.notifications_opt_out === true).map((p) => String(p.id)));
      } catch { return new Set<string>(); }
    },
    blockers: async (coachId, ids) => {
      const b = (await blockersOf(svc, coachId, ids)) as Set<string>;
      logBlocked('rollcall-notice', b.size);
      return b;
    },
    windows: async (ids) => {
      const { data } = await svc.rpc('rollcall_instance_windows_svc', { p_instances: ids });
      return new Map(((data ?? []) as Array<{ instance_id: string; opens_at: string; closes_at: string }>)
        .map((w) => [String(w.instance_id), { opensMs: Date.parse(w.opens_at), closesMs: Date.parse(w.closes_at) } as NoticeWindow]));
    },
    sign: (instanceId, athleteId, w) =>
      signWindowCode(o.secret, { instanceId, athleteId, opensMs: w.opensMs, closesMs: w.closesMs }),
    send: async (messages) => {
      const res = await sendExpoPushAndPrune(messages, svc);
      if (res.failed) console.error('rollcall-notice: push refused', res.failed, res.errors.join('; '));
      return res;
    },
    settle: async (settleRows, notified) => {
      const { data, error } = await svc.rpc('settle_rollcall_notices', { p_rows: settleRows, p_notified: notified });
      if (error) throw error;
      return Number(data) || 0;
    },
  });
  return r;
}
