import {
  liveLine, liveContentState, liveStartPayload, liveUpdatePayload, liveEndPayload,
  liveActivityHeaders, LIVE_ATTRIBUTES_TYPE, LIVE_LINE_MAX_CHARS, LIVE_LINGER_SEC, rollCallPushData,
  liveAnsweredUpdate, teamFields, pointsFor, liveWindowMs, livePriority,
  type LiveAttributes,
} from './rollcall-live';

const row = {
  respond_by_at: '2026-09-02T10:05:00Z',
  closes_at: '2026-09-02T10:30:00Z',
  message: 'Scout meet at 7 AM. Get breakfast in early.',
};
const attrs: LiveAttributes = {
  instanceId: 'i1', title: 'Wake-Up Roll Call', coachName: "Coach D'Onofrio", coachInitials: 'D',
  ackCode: 'p.s', ackUrl: 'https://x.supabase.co/functions/v1/roll-call-ack',
};
const alert = { title: "Coach D'Onofrio", body: 'Scout meet at 7 AM.', sound: 'default' };
const NOW = Date.parse('2026-09-02T10:00:00Z');

describe('liveLine: one lock-screen line, because 160 points is the ceiling', () => {
  it('leaves a short message alone and flattens its newlines', () => {
    expect(liveLine('Up and at it.')).toBe('Up and at it.');
    expect(liveLine('Up and at it.\n\nScout meet at 7.')).toBe('Up and at it. Scout meet at 7.');
    expect(liveLine('  padded  ')).toBe('padded');
  });
  it('cuts on a word boundary with an ellipsis', () => {
    const long = 'Everyone up and moving before the sun is over the trees this morning please';
    const out = liveLine(long);
    expect([...out].length).toBeLessThanOrEqual(LIVE_LINE_MAX_CHARS);
    expect(out.endsWith('…')).toBe(true);
    expect(out).not.toMatch(/\s…$/);
    // The cut landed between words: everything before the ellipsis is a whole word of the original.
    expect(long.startsWith(out.slice(0, -1))).toBe(true);
  });
  it('never splits an emoji', () => {
    const out = liveLine('🏈'.repeat(200), 10);
    expect([...out]).toHaveLength(10);
    expect([...out.slice(0, -1)].every((c) => c === '🏈')).toBe(true);
  });
  it('is empty for no message at all', () => {
    expect(liveLine(null)).toBe('');
    expect(liveLine(undefined)).toBe('');
    expect(liveLine('   ')).toBe('');
  });
});

describe('liveContentState', () => {
  it('carries epoch SECONDS, never a Date, so Swift needs no decoding strategy', () => {
    const s = liveContentState(row, 'initial');
    expect(s.deadlineEpoch).toBe(1788343500);
    expect(s.closesEpoch).toBe(1788345000);
    expect(typeof s.deadlineEpoch).toBe('number');
    expect(Number.isInteger(s.deadlineEpoch)).toBe(true);
  });
  it('has null for a check-in until there is one', () => {
    expect(liveContentState(row, 'initial').checkedInEpoch).toBeNull();
    expect(liveContentState(row, 'answered', '2026-09-02T10:01:00Z').checkedInEpoch).toBe(1788343260);
  });
  it('degrades to zero rather than NaN on a missing timestamp', () => {
    const s = liveContentState({ respond_by_at: null, closes_at: undefined, message: null }, 'initial');
    expect(s.deadlineEpoch).toBe(0);
    expect(s.closesEpoch).toBe(0);
  });
});

describe('the start payload is what Apple requires', () => {
  const p = liveStartPayload(attrs, liveContentState(row, 'initial'), alert, NOW) as
    { aps: Record<string, unknown> };

  it('names the event, the attributes type, the attributes and an alert', () => {
    expect(p.aps.event).toBe('start');
    expect(p.aps['attributes-type']).toBe(LIVE_ATTRIBUTES_TYPE);
    expect(p.aps.attributes).toEqual(attrs);
    // Apple documents `alert` as REQUIRED on a start, not optional.
    expect(p.aps.alert).toEqual(alert);
    expect(p.aps['content-state']).toBeDefined();
  });
  it('stamps the timestamp Apple uses to discard out-of-order updates', () => {
    expect(p.aps.timestamp).toBe(1788343200);
  });
  it('goes stale at the deadline, so a phone we can never reach again stops lying', () => {
    expect(p.aps['stale-date']).toBe(1788343500);
  });
});

describe('update and end', () => {
  it('sends no alert unless the phase change deserves the screen', () => {
    const quiet = liveUpdatePayload(liveContentState(row, 'answered', '2026-09-02T10:01:00Z'), NOW) as
      { aps: Record<string, unknown> };
    expect(quiet.aps.event).toBe('update');
    expect(quiet.aps).not.toHaveProperty('alert');

    const loud = liveUpdatePayload(liveContentState(row, 'late'), NOW, alert) as { aps: Record<string, unknown> };
    expect(loud.aps.alert).toEqual(alert);
  });
  it('lets a LATE card live until close, not until the deadline it already passed', () => {
    const late = liveUpdatePayload(liveContentState(row, 'late'), NOW) as { aps: Record<string, unknown> };
    expect(late.aps['stale-date']).toBe(1788345000);
    const early = liveUpdatePayload(liveContentState(row, 'reminder'), NOW) as { aps: Record<string, unknown> };
    expect(early.aps['stale-date']).toBe(1788343500);
  });
  it('ends with the final state and clears itself instead of lingering four hours', () => {
    const e = liveEndPayload(liveContentState(row, 'missed'), NOW) as { aps: Record<string, unknown> };
    expect(e.aps.event).toBe('end');
    expect((e.aps['content-state'] as { phase: string }).phase).toBe('missed');
    expect(e.aps['dismissal-date']).toBe(1788343200 + LIVE_LINGER_SEC);
  });
});

describe('headers', () => {
  it('appends Apple\'s push-type suffix to the bundle id, with the dot', () => {
    const h = liveActivityHeaders('com.onstandard.app', 'JWT');
    expect(h['apns-topic']).toBe('com.onstandard.app.push-type.liveactivity');
    expect(h['apns-push-type']).toBe('liveactivity');
    expect(h.authorization).toBe('bearer JWT');
  });
  it('asks for immediate delivery: priority 5 may be deferred', () => {
    expect(liveActivityHeaders('b', 'j')['apns-priority']).toBe('10');
  });
  it('sends a count-only update at priority 5 when asked', () => {
    expect(liveActivityHeaders('b', 'j', 5)['apns-priority']).toBe('5');
    expect(liveActivityHeaders('b', 'j', 10)['apns-priority']).toBe('10');
  });
});

/* Final review I3: a ~40-minute card with a once-a-minute team count would spend the priority-10
   budget on cosmetic counts and let iOS delay the pushes that matter. */
describe('livePriority', () => {
  it('a teammate’s count moving is priority 5', () => {
    expect(livePriority('team_count')).toBe(5);
  });
  it('the athlete’s own moments stay at 10: start, answered, reminder, late, end', () => {
    for (const k of ['start', 'answered', 'reminder', 'late', 'end'] as const) expect(livePriority(k)).toBe(10);
  });
});

describe('the close and the quiet opening (0239)', () => {
  it('a missed phase reaches Android with the red state colour', () => {
    const d = rollCallPushData({ type: 'morning_roll_call', respond_by_at: '2026-09-16T10:05:00Z', closes_at: '2026-09-16T10:30:00Z' }, 'missed');
    expect(d.rc_phase).toBe('missed');
    expect(d.rc_color).toBe('#F65757');
  });

  it('an alert with no sound omits the key instead of sending an empty one', () => {
    const quiet = { title: 'Coach', body: 'Up.', sound: '' };
    const start = liveStartPayload(attrs, liveContentState(row, 'initial'), quiet, NOW) as { aps: { alert: Record<string, unknown> } };
    expect(start.aps.alert).toEqual({ title: 'Coach', body: 'Up.' });
    expect(start.aps.alert).not.toHaveProperty('sound');
    const loud = liveStartPayload(attrs, liveContentState(row, 'initial'), alert, NOW) as { aps: { alert: Record<string, unknown> } };
    expect(loud.aps.alert).toEqual(alert);
    const upd = liveUpdatePayload(liveContentState(row, 'reminder'), NOW, quiet) as { aps: { alert: Record<string, unknown> } };
    expect(upd.aps.alert).not.toHaveProperty('sound');
  });
});

// ---------------------------------------------------------------- the team on the card (2026-09-23)
describe('the card after the tap: it stays, and it carries the team', () => {
  test('answered is an update that keeps the card, not an end', () => {
    const p = liveAnsweredUpdate({ phase: 'answered', deadlineEpoch: 1, closesEpoch: 2, checkedInEpoch: 1, line: "You're up · 4th", teamUp: 6, teamTotal: 12, place: 4, points: 8 }) as
      { aps: Record<string, any> };
    expect(p.aps.event).toBe('update');
    expect(p.aps['dismissal-date']).toBeUndefined();
    expect(p.aps['content-state'].teamUp).toBe(6);
    expect(p.aps).not.toHaveProperty('alert');
  });
  test('an answered card goes stale at the close, not at the deadline', () => {
    const p = liveAnsweredUpdate({ phase: 'answered', deadlineEpoch: 100, closesEpoch: 200, checkedInEpoch: 90, line: '', teamUp: 1, teamTotal: 2, place: 1, points: 8 }, NOW) as
      { aps: Record<string, any> };
    expect(p.aps['stale-date']).toBe(200);
    expect(p.aps.timestamp).toBe(Math.round(NOW / 1000));
  });
  test('an old caller still gets a complete state: team fields default to 0 / null', () => {
    const s = liveContentState(row, 'initial');
    expect(s).toMatchObject({ teamUp: 0, teamTotal: 0, place: null, points: null });
  });
  test('the team fields ride in when given', () => {
    const s = liveContentState(row, 'reminder', null, { teamUp: 3, teamTotal: 9, place: null, points: null });
    expect(s).toMatchObject({ phase: 'reminder', teamUp: 3, teamTotal: 9 });
  });
  test('the start carries the check-in code and where to post it', () => {
    const p = liveStartPayload(attrs, liveContentState(row, 'initial'), alert, NOW) as { aps: Record<string, any> };
    expect(p.aps.attributes.ackCode).toBe('p.s');
    expect(p.aps.attributes.ackUrl).toBe('https://x.supabase.co/functions/v1/roll-call-ack');
  });
});

describe('teamFields / pointsFor', () => {
  const board = {
    total: 12, up: 6, asks_arrival: false,
    rows: [
      { athlete_id: 'a1', verdict: 'on_standard', place: 1, acknowledged_at: '2026-09-02T10:00:10Z' },
      { athlete_id: 'a2', verdict: 'late', place: 2, acknowledged_at: '2026-09-02T10:07:00Z' },
      { athlete_id: 'a3', verdict: 'review', place: null, acknowledged_at: '2026-09-02T10:02:00Z' },
      { athlete_id: 'a4', verdict: 'pending', place: null, acknowledged_at: null },
    ],
  };
  test('8 points for a wake-up alone, 4 when it asks arrival too', () => {
    expect(pointsFor(false)).toBe(8);
    expect(pointsFor(true)).toBe(4);
  });
  test("a counted answer has its place and the roll call's share of the morning", () => {
    expect(teamFields(board, 'a2')).toEqual({ teamUp: 6, teamTotal: 12, place: 2, points: 8 });
    expect(teamFields({ ...board, asks_arrival: true }, 'a1')).toEqual({ teamUp: 6, teamTotal: 12, place: 1, points: 4 });
  });
  test('an answer under review, or no answer, has no place and no points yet', () => {
    expect(teamFields(board, 'a3')).toEqual({ teamUp: 6, teamTotal: 12, place: null, points: null });
    expect(teamFields(board, 'a4')).toEqual({ teamUp: 6, teamTotal: 12, place: null, points: null });
    expect(teamFields(board, 'nobody')).toEqual({ teamUp: 6, teamTotal: 12, place: null, points: null });
  });
  test('no board at all degrades to the old card', () => {
    expect(teamFields(null, 'a1')).toEqual({ teamUp: 0, teamTotal: 0, place: null, points: null });
  });
});

describe('liveWindowMs', () => {
  test('reads the open and the close off the card', () => {
    expect(liveWindowMs({ opens_at: '2026-09-02T09:50:00Z', closes_at: '2026-09-02T10:30:00Z', starts_at: '2026-09-02T10:00:00Z' }))
      .toEqual({ opensMs: Date.parse('2026-09-02T09:50:00Z'), closesMs: Date.parse('2026-09-02T10:30:00Z') });
  });
  test('an older card with no open falls back to 10 minutes before the start', () => {
    expect(liveWindowMs({ closes_at: '2026-09-02T10:30:00Z', starts_at: '2026-09-02T10:00:00Z' }))
      .toEqual({ opensMs: Date.parse('2026-09-02T09:50:00Z'), closesMs: Date.parse('2026-09-02T10:30:00Z') });
  });
  test('no close means no window code', () => {
    expect(liveWindowMs({ starts_at: '2026-09-02T10:00:00Z', closes_at: null })).toBeNull();
  });
});

describe('sendLiveUpdates: the APNs timestamp is the moment the content was built', () => {
  test('uses the nowMs it is handed, never the send-time clock', async () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { sendLiveUpdates } = require('./rollcall-live-send') as typeof import('./rollcall-live-send');
    const builtAt = Date.parse('2026-09-25T10:02:00Z');
    const sent: Array<Record<string, { timestamp: number }>> = [];
    const apns = { send: async (_t: string, p: Record<string, { timestamp: number }>) => { sent.push(p); return { ok: true, gone: false }; } };
    const state = liveContentState(row, 'reminder', null, { teamUp: 3, teamTotal: 9, place: null, points: null });
    await sendLiveUpdates({ rpc: async () => ({}) } as never, apns as never, [{ token: 't', state }, { token: 'u', state: { ...state, phase: 'answered' } }], builtAt);
    expect(sent.map((p) => p.aps.timestamp)).toEqual([Math.round(builtAt / 1000), Math.round(builtAt / 1000)]);
  });
});
