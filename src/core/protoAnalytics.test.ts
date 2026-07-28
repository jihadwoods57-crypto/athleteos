/**
 * ANONYMOUS ACTIVATION ANALYTICS (instrumentation seam): the event model must be a PII firewall
 * by construction — only known event names survive, and props may only carry numbers, booleans,
 * or short enum-shaped strings. A name/email/free-text note must be structurally impossible to
 * emit. Also locks the bounded buffer + batch semantics the runtime relies on.
 *
 * Pure functions (Node-importable; no window touched by the parts under test).
 */
/* eslint-disable @typescript-eslint/no-var-requires */
const {
  EVENTS, redactProps, makeEvent, bufferPush, takeBatch,
} = require('../../proto/redesign-2026-07/js/analytics.js');

describe('redactProps — the PII firewall', () => {
  test('keeps numbers, booleans, and short enum strings', () => {
    expect(redactProps({ slot: 'breakfast', count: 3, late: true })).toEqual({ slot: 'breakfast', count: 3, late: true });
  });

  test('drops names, emails, and free text (structurally unrepresentable)', () => {
    expect(redactProps({ name: 'Jihad Woods' })).toEqual({});          // has a space → not enum-shaped
    expect(redactProps({ email: 'a@b.com' })).toEqual({});             // '@' not allowed
    expect(redactProps({ note: 'ate a big lunch at Chipotle' })).toEqual({});
    expect(redactProps({ goal: 'lose' })).toEqual({ goal: 'lose' });   // a real enum survives
  });

  test('drops objects, arrays, null, NaN, and over-long strings', () => {
    expect(redactProps({ obj: { a: 1 }, arr: [1, 2], z: null, bad: NaN, long: 'x'.repeat(40) })).toEqual({});
  });

  test('rejects non-enum-shaped KEYS too, and caps at 6 props', () => {
    expect(redactProps({ 'Bad-Key': 'x' })).toEqual({});
    const many: Record<string, number> = {};
    for (let i = 0; i < 10; i++) many['k' + i] = i;
    expect(Object.keys(redactProps(many)).length).toBe(6);
  });

  test('non-object input is safe', () => {
    expect(redactProps(null)).toEqual({});
    expect(redactProps('nope' as unknown as object)).toEqual({});
  });
});

describe('makeEvent — vocabulary gate', () => {
  test('only known event names produce an event', () => {
    expect(makeEvent(EVENTS.MEAL_LOGGED, { slot: 'lunch' }, 1000, 'sid123')).toEqual({
      n: 'meal_logged', t: 1000, p: { slot: 'lunch' }, s: 'sid123',
    });
    expect(makeEvent('exfiltrate_everything', { x: 1 }, 1000, 'sid')).toBeNull();
  });

  test('an event with no valid props omits the p field entirely', () => {
    expect(makeEvent(EVENTS.RECOVERY_SUBMITTED, { name: 'Jihad' }, 5, 'sid')).toEqual({ n: 'recovery_submitted', t: 5, s: 'sid' });
  });

  test('floors the timestamp and ignores a malformed session id', () => {
    expect(makeEvent(EVENTS.APP_OPEN, undefined, 1234.9, 'has space')).toEqual({ n: 'app_open', t: 1234 });
  });
});

describe('bufferPush — bounded buffer', () => {
  test('appends and never exceeds the cap (drops oldest)', () => {
    let buf: unknown[] = [];
    for (let i = 0; i < 12; i++) buf = bufferPush(buf, { n: 'app_open', t: i }, 5);
    expect(buf).toHaveLength(5);
    expect((buf[0] as { t: number }).t).toBe(7);  // oldest kept is the 8th push
    expect((buf[4] as { t: number }).t).toBe(11); // newest
  });

  test('a null event is a no-op', () => {
    expect(bufferPush([{ n: 'x', t: 1 }], null, 5)).toEqual([{ n: 'x', t: 1 }]);
  });
});

describe('takeBatch — flush split', () => {
  test('splits oldest-first into batch + remainder', () => {
    const buf = Array.from({ length: 7 }, (_, i) => ({ n: 'app_open', t: i }));
    const { batch, rest } = takeBatch(buf, 3);
    expect(batch.map((e: { t: number }) => e.t)).toEqual([0, 1, 2]);
    expect(rest.map((e: { t: number }) => e.t)).toEqual([3, 4, 5, 6]);
  });

  test('a short buffer yields an empty remainder', () => {
    const { batch, rest } = takeBatch([{ n: 'app_open', t: 0 }], 50);
    expect(batch).toHaveLength(1);
    expect(rest).toHaveLength(0);
  });
});

/**
 * INGEST PARITY (2026-07-23): the client vocabulary and the analytics-ingest edge function's
 * server-side whitelist are two hand-maintained lists that must agree. They had drifted THREE
 * times — the meal edge signals, the entire Verified Commitments funnel, and the OB2 step
 * funnel were all being fired by the app and silently dropped by the server, so those metrics
 * read zero while looking wired. Nothing surfaced it, because a dropped event is indistinguishable
 * from an event that never happened. This test is the tripwire: add a name to EVENTS and this
 * fails until analytics-ingest is updated and redeployed.
 */
describe('client EVENTS ⊆ analytics-ingest ALLOWED', () => {
  const fs = require('fs') as typeof import('fs');
  const path = require('path') as typeof import('path');
  const src = fs.readFileSync(
    path.join(__dirname, '../../supabase/functions/analytics-ingest/index.ts'), 'utf8',
  );
  const allowed = new Set(
    (src.split('const ALLOWED = new Set([')[1] || '').split(']);')[0]
      .match(/"([a-z0-9_]+)"/g)?.map((s) => s.replace(/"/g, '')) ?? [],
  );

  test('the ingest whitelist parsed', () => {
    expect(allowed.size).toBeGreaterThan(20);
  });

  test('every event the client can fire is accepted server-side', () => {
    const dropped = Object.values(EVENTS as Record<string, string>).filter((n) => !allowed.has(n));
    expect(dropped).toEqual([]);
  });
});
