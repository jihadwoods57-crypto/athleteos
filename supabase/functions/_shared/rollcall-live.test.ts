import {
  liveLine, liveContentState, liveStartPayload, liveUpdatePayload, liveEndPayload,
  liveActivityHeaders, LIVE_ATTRIBUTES_TYPE, LIVE_LINE_MAX_CHARS, LIVE_LINGER_SEC,
  type LiveAttributes,
} from './rollcall-live';

const row = {
  respond_by_at: '2026-09-02T10:05:00Z',
  closes_at: '2026-09-02T10:30:00Z',
  message: 'Scout meet at 7 AM. Get breakfast in early.',
};
const attrs: LiveAttributes = {
  instanceId: 'i1', title: 'Wake-Up Roll Call', coachName: "Coach D'Onofrio", coachInitials: 'D',
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
});
