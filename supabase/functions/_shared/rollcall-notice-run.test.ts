// supabase/functions/_shared/rollcall-notice-run.test.ts
import { runRollcallNotices, MAX_GROUPS_PER_RUN, type NoticeDeps, type NoticeSendOutcome } from './rollcall-notice-run';
import type { NoticeRow, NoticeContext, SettleRow } from './rollcall-notice';

const CLAIM = '2026-09-24T20:00:00.123Z';
let seq = 0;
function row(p: Partial<NoticeRow> = {}): NoticeRow {
  seq++;
  return {
    response_id: `r${seq}`, athlete_id: 'a1', commitment_id: 'c1', instance_id: `i${seq}`,
    kind: 'assigned', starts_at: '2026-09-28T10:45:00Z', occurs_on: '2026-09-28', was_starts_at: null,
    off: false, claimed_at: CLAIM, ...p,
  };
}
const CTX: NoticeContext = {
  commitment_id: 'c1', title: 'Wake-Up', action_label: null, coach_id: 'coach', coach_name: 'Coach K',
  repeat_days: [1, 2, 3, 4, 5], starts_min: 345, timezone: 'America/New_York', alarm: true,
};

type Call = { rows: SettleRow[]; notified: boolean };
function deps(o: Partial<NoticeDeps> & { outcome?: NoticeSendOutcome; tokenMap?: Record<string, string[]> } = {}) {
  const settles: Call[] = [];
  const sent: Array<Array<Record<string, unknown>>> = [];
  const tok = o.tokenMap ?? { a1: ['ExponentPushToken[a1]'] };
  const d: NoticeDeps = {
    contexts: async (ids) => new Map(ids.filter((id) => id === 'c1' || id === 'c2').map((id) => [id, { ...CTX, commitment_id: id }])),
    tokens: async (ids) => new Map(ids.map((id) => [id, (tok[id] ?? []).map((t) => ({ token: t, platform: 'ios' }))])),
    optedOut: async () => new Set(),
    blockers: async () => new Set(),
    armOn: () => false,
    windows: async (ids) => new Map(ids.map((id) => [id, { opensMs: 1, closesMs: 2 }])),
    sign: async (i) => `code-${i}`,
    send: async (m) => { sent.push(m); return o.outcome ?? { sent: m.length, failed: 0, dead: [] }; },
    settle: async (rows, notified) => { settles.push({ rows, notified }); return rows.length; },
    ackUrl: 'https://x.supabase.co/functions/v1/roll-call-ack',
    channelId: 'rollcall',
    ...(({ outcome: _o, tokenMap: _t, ...rest }) => rest)(o),
  };
  return { d, settles, sent };
}
const told = (settles: Call[]) => settles.filter((c) => c.notified).flatMap((c) => c.rows).filter((r) => r.sent).map((r) => r.response_id);
const untold = (settles: Call[]) => settles.filter((c) => c.notified).flatMap((c) => c.rows).filter((r) => !r.sent).map((r) => r.response_id);
const released = (settles: Call[]) => settles.filter((c) => !c.notified).flatMap((c) => c.rows).map((r) => r.response_id);

describe('runRollcallNotices', () => {
  it('one push per athlete per roll call; every row it said is settled as told, claimed_at handed back', async () => {
    const a = row(); const b = row({ starts_at: '2026-09-29T10:45:00Z' });
    const { d, settles, sent } = deps();
    const r = await runRollcallNotices([a, b], d);
    expect(sent).toHaveLength(1);
    expect(sent[0][0]).toMatchObject({ to: 'ExponentPushToken[a1]', title: 'Coach K put you on roll call', data: { route: 'rollcall-assigned/c1', from_coach: true } });
    expect(told(settles).sort()).toEqual([a.response_id, b.response_id].sort());
    expect(settles.flatMap((c) => c.rows).every((x) => x.claimed_at === CLAIM)).toBe(true);
    expect(r).toMatchObject({ groups: 1, pushed: 1, told: 2 });
  });

  it('a 200 with only error tickets is NOT a delivery: settled, not told, not re-sent', async () => {
    const a = row();
    const { d, settles } = deps({ outcome: { sent: 0, failed: 1, dead: [] } });
    const r = await runRollcallNotices([a], d);
    expect(told(settles)).toEqual([]);
    expect(untold(settles)).toEqual([a.response_id]);
    expect(released(settles)).toEqual([]);
    expect(r.pushed).toBe(0);
  });

  it('a send that throws settles not told, never counted', async () => {
    const a = row();
    const { d, settles } = deps({ send: async () => { throw new Error('network'); } });
    const r = await runRollcallNotices([a], d);
    expect(untold(settles)).toEqual([a.response_id]);
    expect(r.pushed).toBe(0);
  });

  it('a silent-only group never reaches the copy or Expo; it is settled, not told', async () => {
    const s = row({ kind: 'silent', off: true });
    const { d, settles, sent } = deps({ contexts: async () => { throw new Error('must not read context'); } });
    const r = await runRollcallNotices([s], d);
    expect(sent).toHaveLength(0);
    expect(untold(settles)).toEqual([s.response_id]);
    expect(r).toMatchObject({ groups: 1, pushed: 0 });
  });

  it('silent rows beside spoken ones settle untold while the spoken ones are told', async () => {
    const s = row({ kind: 'silent', off: true }); const m = row({ kind: 'moved' });
    const { d, settles, sent } = deps();
    await runRollcallNotices([s, m], d);
    expect(sent).toHaveLength(1);
    expect(told(settles)).toEqual([m.response_id]);
    expect(untold(settles)).toEqual([s.response_id]);
  });

  it('no device, or notifications switched off: settled, not told, no push', async () => {
    const a = row({ athlete_id: 'nophone' }); const b = row({ athlete_id: 'optout' });
    const { d, settles, sent } = deps({
      tokenMap: { optout: ['ExponentPushToken[o]'] },
      optedOut: async () => new Set(['optout']),
    });
    await runRollcallNotices([a, b], d);
    expect(sent).toHaveLength(0);
    expect(untold(settles).sort()).toEqual([a.response_id, b.response_id].sort());
  });

  it('blocked: no push in the coach\'s name, answered exactly like a delivery (I1)', async () => {
    const a = row();
    const { d, settles, sent } = deps({ blockers: async (coach, ids) => new Set(coach === 'coach' ? ids : []) });
    const r = await runRollcallNotices([a], d);
    expect(sent).toHaveLength(0);
    expect(told(settles)).toEqual([a.response_id]);
    expect(r).toMatchObject({ pushed: 0, ghost: 1 });
  });

  it('a failed read (context, tokens) releases instead of settling anyone as "no phone"', async () => {
    const a = row();
    const { d, settles, sent } = deps({ tokens: async () => { throw new Error('db'); } });
    await runRollcallNotices([a], d);
    expect(sent).toHaveLength(0);
    expect(released(settles)).toEqual([a.response_id]);
    expect(untold(settles)).toEqual([]);
  });

  it('no roll call context: released for the next tick, not settled', async () => {
    const a = row({ commitment_id: 'gone' });
    const { d, settles, sent } = deps();
    await runRollcallNotices([a], d);
    expect(sent).toHaveLength(0);
    expect(released(settles)).toEqual([a.response_id]);
  });

  it('over the per-run cap: the rest is released, not dropped', async () => {
    const rows = Array.from({ length: MAX_GROUPS_PER_RUN + 2 }, (_, k) => row({ athlete_id: `x${k}` }));
    const { d, settles } = deps({ tokenMap: {} });
    const r = await runRollcallNotices(rows, d);
    expect(r.groups).toBe(MAX_GROUPS_PER_RUN);
    expect(released(settles)).toHaveLength(2);
  });

  it('a settle that throws costs nothing but the tick', async () => {
    const { d } = deps({ settle: async () => { throw new Error('db'); } });
    await expect(runRollcallNotices([row()], d)).resolves.toMatchObject({ pushed: 1, settled: 0 });
  });

  it('flag off (production): no schedule, no mutableContent, the banner asks them to open the app', async () => {
    const { d, sent } = deps();
    await runRollcallNotices([row()], d);
    const m = sent[0][0] as { data: Record<string, unknown>; body: string };
    expect(m.data.rc).toBeUndefined();
    expect(m).not.toHaveProperty('mutableContent');
    expect(m.body).toMatch(/Open OnStandard to set your alarm/);
    expect(m.body).not.toMatch(/✓/);
  });

  it('flag on: the schedule rides, titled via alarmTitleOf/alarmLabelOf, with a window code per morning', async () => {
    const a = row();
    const { d, sent } = deps({ armOn: () => true });
    await runRollcallNotices([a], d);
    const m = sent[0][0] as { data: { rc: { title: string; label: string; arm: Array<{ i: string; c?: string }> } }; mutableContent?: boolean };
    expect(m.mutableContent).toBe(true);
    expect(m.data.rc.title).toBe('Wake-Up');
    expect(m.data.rc.label).toBe('I’m Up');
    expect(m.data.rc.arm).toEqual([{ i: a.instance_id, at: Date.parse(a.starts_at), c: `code-${a.instance_id}` }]);
  });

  it('flag on but the coach wants no alarm: no schedule', async () => {
    const { d, sent } = deps({ armOn: () => true, contexts: async () => new Map([['c1', { ...CTX, alarm: false }]]) });
    await runRollcallNotices([row()], d);
    expect((sent[0][0] as { data: Record<string, unknown> }).data.rc).toBeUndefined();
  });

  it('two roll calls for one athlete are two pushes; two athletes are two pushes', async () => {
    const { d, sent } = deps({ tokenMap: { a1: ['t1'], a2: ['t2'] } });
    await runRollcallNotices([row(), row({ commitment_id: 'c2' }), row({ athlete_id: 'a2' })], d);
    expect(sent).toHaveLength(3);
  });

  it('nothing claimed: nothing read, nothing sent', async () => {
    const { d, settles, sent } = deps();
    expect(await runRollcallNotices([], d)).toMatchObject({ groups: 0, pushed: 0 });
    expect(sent).toHaveLength(0);
    expect(settles).toHaveLength(0);
  });
});
