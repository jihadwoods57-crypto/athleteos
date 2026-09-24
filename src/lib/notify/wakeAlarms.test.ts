// The reconcile half of the wake-up alarm: what the device ends up holding.
//
// The property worth protecting is that a wake-up a coach DELETED stops ringing. Appending would
// leave it armed on the athlete's phone with nothing in the app to turn it off, which is the worst
// failure this feature has.
import { syncWakeAlarms, wakeAlarmState, isUsable, cleanWeekdays, fixedAt, cancelWakeAlarmFor, _resetWakeAlarms, deviceAlarmIds } from './wakeAlarms';

type Scheduled = { instanceId: string; hour?: number; minute?: number; weekdays?: number[]; title: string; at?: number; ackCode?: string; ackUrl?: string };

const mockState = {
  supported: true,
  authorization: 'authorized' as string,
  scheduled: [] as Scheduled[],
  cancelled: [] as string[],
  /** Alarms the device holds that this process did not arm (e.g. the push extension, or another
   *  process). AlarmKit reports them alongside this process's own, uppercase, as real UUIDs do. */
  foreign: [] as string[],
  refuse: new Set<string>(),
  requested: 0,
  /** Whether the fake binary knows the dated call. */
  dated: true,
  /** What the fake server was told: instance -> armed. */
  told: [] as Array<{ p_instance: string; p_armed: boolean }>,
};

// NOT `{ virtual: true }`. Both of these modules really exist on disk, and a virtual mock is keyed
// on the raw request string rather than on the file `require()` actually resolves to. Jest shares
// one resolver — module-ID cache included — across every test file in a worker, so once ANOTHER
// file (src/proto/bridge.test.ts, via bridge.ts -> wakeAlarms.ts) has resolved these same requests
// for real, the cached id wins here and the virtual mock is silently skipped: `live()` handed back
// the REAL native shim, `isAlarmSupported()` is false under node, and all 12 alarm behaviours
// below asserted against a module that does nothing. It flaked roughly one full-suite run in eight,
// purely on which worker the two files landed in together. A plain mock is keyed on the resolved
// path, which is what `require()` asks for either way.
jest.mock('@/lib/supabase/client', () => ({
  supabase: { rpc: async (fn: string, args: { p_instance: string; p_armed: boolean }) => { if (fn === 'set_wake_alarm_armed') mockState.told.push(args); return { error: null }; } },
}));

jest.mock('react-native', () => ({ Platform: { OS: 'ios' } }));

jest.mock('../../../modules/rollcall-live', () => ({
  isAlarmSupported: () => mockState.supported,
  alarmAuthorizationState: () => mockState.authorization,
  requestAlarmAuthorization: async () => { mockState.requested++; mockState.authorization = 'authorized'; return 'authorized'; },
  scheduleWakeAlarm: async (a: Scheduled) => {
    if (mockState.refuse.has(a.instanceId)) return '';
    mockState.scheduled = mockState.scheduled.filter((x) => x.instanceId !== a.instanceId).concat(a);
    return a.instanceId;
  },
  hasDatedAlarms: () => mockState.dated,
  scheduleWakeAlarmAt: async (a: Scheduled) => {
    if (!mockState.dated) return '';
    if (mockState.refuse.has(a.instanceId)) return '';
    mockState.scheduled = mockState.scheduled.filter((x) => x.instanceId !== a.instanceId).concat(a);
    return a.instanceId;
  },
  cancelWakeAlarm: (id: string) => {
    mockState.cancelled.push(id);
    mockState.scheduled = mockState.scheduled.filter((x) => x.instanceId !== id);
    mockState.foreign = mockState.foreign.filter((x) => x.toLowerCase() !== id.toLowerCase());
  },
  // AlarmKit answers with the alarm's UUID, uppercase; the push extension's alarms are in the same list.
  scheduledWakeAlarms: () => [
    ...mockState.scheduled.map((s) => ({ id: s.instanceId.toUpperCase(), state: 'scheduled' })),
    ...mockState.foreign.map((id) => ({ id, state: 'scheduled' })),
  ],
}));

const morning = (instanceId: string, hour = 5, minute = 45) => ({ instanceId, hour, minute, title: 'Wake up' });

beforeEach(() => {
  mockState.supported = true;
  mockState.authorization = 'authorized';
  mockState.scheduled = [];
  mockState.cancelled = [];
  mockState.foreign = [];
  mockState.refuse = new Set();
  mockState.requested = 0;
  mockState.dated = true;
  mockState.told = [];
  _resetWakeAlarms();
});

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('a dated morning', () => {
  const at = Date.now() + 18 * 3600000;

  it('is armed at its exact instant, not at hour:minute', async () => {
    await syncWakeAlarms([{ ...morning('a'), at }]);
    expect(mockState.scheduled[0].at).toBe(Math.round(at));
    expect(mockState.scheduled[0].hour).toBeUndefined();
  });

  it('falls back to hour:minute on a binary that predates the dated call', async () => {
    mockState.dated = false;
    await syncWakeAlarms([{ ...morning('a'), at }]);
    expect(mockState.scheduled[0].hour).toBe(5);
    expect(mockState.scheduled[0].at).toBeUndefined();
  });

  it('never trusts an instant already behind us', () => {
    expect(fixedAt({ ...morning('a'), at: Date.now() - 1000 })).toBe(0);
    expect(fixedAt({ ...morning('a'), at: Number.NaN })).toBe(0);
    expect(fixedAt({ ...morning('a') })).toBe(0);
    expect(fixedAt({ ...morning('a'), at }, at - 5)).toBe(Math.round(at));
  });

  it('tells the server which mornings this phone will ring for, and only on a change', async () => {
    await syncWakeAlarms([morning('a'), morning('b')]);
    await flush();
    expect(mockState.told.filter((t) => t.p_armed).map((t) => t.p_instance).sort()).toEqual(['a', 'b']);
    mockState.told = [];
    await syncWakeAlarms([morning('a'), morning('b')]);
    await flush();
    expect(mockState.told).toEqual([]);
    await syncWakeAlarms([morning('a')]);
    await flush();
    expect(mockState.told).toEqual([{ p_instance: 'b', p_armed: false }]);
  });

  it('a refused morning is reported as NOT armed, so the server keeps its sound', async () => {
    mockState.refuse.add('a');
    await syncWakeAlarms([morning('a')]);
    await flush();
    expect(mockState.told).toEqual([]);
    expect(mockState.scheduled).toEqual([]);
  });
});

describe('cancelWakeAlarmFor', () => {
  it('cancels the answered morning, forgets it, and tells the server', async () => {
    await syncWakeAlarms([morning('a'), morning('b')]);
    await flush();
    mockState.told = [];
    cancelWakeAlarmFor('a');
    await flush();
    expect(mockState.cancelled).toContain('a');
    expect(mockState.scheduled.map((s) => s.instanceId)).toEqual(['b']);
    expect(mockState.told).toEqual([{ p_instance: 'a', p_armed: false }]);
    // The next sync does not try to cancel it again.
    mockState.cancelled = [];
    await syncWakeAlarms([morning('b')]);
    expect(mockState.cancelled).toEqual([]);
  });

  it('is harmless for an instance that never had one', () => {
    expect(() => cancelWakeAlarmFor('nope')).not.toThrow();
    expect(() => cancelWakeAlarmFor('')).not.toThrow();
  });
});

describe('arming waits for permission (G-P2)', () => {
  it('arms nothing, and asks nothing, while the athlete has not been asked', async () => {
    mockState.authorization = 'notDetermined';
    const n = await syncWakeAlarms([morning('a')]);
    expect(n).toBe(0);
    expect(mockState.scheduled).toHaveLength(0);
    expect(mockState.requested).toBe(0);
  });

  it('cancels what was armed once permission is gone', async () => {
    await syncWakeAlarms([morning('a')]);
    expect(mockState.scheduled).toHaveLength(1);
    mockState.authorization = 'denied';
    await syncWakeAlarms([morning('a')]);
    expect(mockState.scheduled).toHaveLength(0);
  });
});

describe('syncWakeAlarms', () => {
  it('arms the set it is given', async () => {
    const n = await syncWakeAlarms([morning('a'), morning('b')]);
    expect(n).toBe(2);
    expect(mockState.scheduled.map((s) => s.instanceId).sort()).toEqual(['a', 'b']);
  });

  it('cancels a morning the coach removed', async () => {
    await syncWakeAlarms([morning('a'), morning('b')]);
    const n = await syncWakeAlarms([morning('a')]);
    expect(n).toBe(1);
    expect(mockState.cancelled).toContain('b');
    expect(mockState.scheduled.map((s) => s.instanceId)).toEqual(['a']);
  });

  it('an empty set disarms everything', async () => {
    await syncWakeAlarms([morning('a'), morning('b')]);
    expect(await syncWakeAlarms([])).toBe(0);
    expect(mockState.scheduled).toEqual([]);
  });

  it('is idempotent, so calling it on every foreground beat is correct', async () => {
    await syncWakeAlarms([morning('a')]);
    await syncWakeAlarms([morning('a')]);
    await syncWakeAlarms([morning('a')]);
    expect(mockState.scheduled.map((s) => s.instanceId)).toEqual(['a']);
    expect(mockState.cancelled).toEqual([]);
  });

  it('a morning the device refuses is not counted as armed', async () => {
    mockState.refuse = new Set(['b']);
    expect(await syncWakeAlarms([morning('a'), morning('b')])).toBe(1);
    // And the next sync must not then try to cancel something that was never set.
    mockState.refuse = new Set();
    await syncWakeAlarms([morning('a')]);
    expect(mockState.cancelled).not.toContain('b');
  });

  it('one bad morning does not cost the rest', async () => {
    const bad = { instanceId: 'bad', hour: 99, minute: 0 };
    expect(await syncWakeAlarms([bad, morning('good')])).toBe(1);
    expect(mockState.scheduled.map((s) => s.instanceId)).toEqual(['good']);
  });

  it('a device that cannot set alarms reports zero rather than throwing', async () => {
    mockState.supported = false;
    expect(await syncWakeAlarms([morning('a')])).toBe(0);
    expect(mockState.scheduled).toEqual([]);
  });

  it('a title is bounded before it reaches native', async () => {
    await syncWakeAlarms([{ ...morning('a'), title: 'x'.repeat(500) }]);
    expect(mockState.scheduled[0].title.length).toBe(80);
  });
});

describe('wakeAlarmState', () => {
  it('asks for permission once, when nobody has been asked and the athlete tapped Continue', async () => {
    mockState.authorization = 'notDetermined';
    const s = await wakeAlarmState({ ask: true });
    expect(mockState.requested).toBe(1);
    expect(s.authorization).toBe('authorized');
  });

  // G-P2: reading the state (Home, the roll call line) must never put up the system question.
  it('never asks without an explicit ask', async () => {
    mockState.authorization = 'notDetermined';
    const s = await wakeAlarmState();
    expect(mockState.requested).toBe(0);
    expect(s.authorization).toBe('notDetermined');
  });

  it('does not re-ask somebody who said no', async () => {
    mockState.authorization = 'denied';
    const s = await wakeAlarmState();
    expect(mockState.requested).toBe(0);
    expect(s.authorization).toBe('denied');
  });

  it('reports honestly on a device with no alarms at all', async () => {
    mockState.supported = false;
    expect(await wakeAlarmState()).toEqual({ supported: false, authorization: 'unsupported', armed: 0, ids: [] });
  });
});

describe('input cleaning', () => {
  it('rejects a request that names no instance or no real time', () => {
    expect(isUsable({ instanceId: 'a', hour: 5, minute: 45 })).toBe(true);
    expect(isUsable({ instanceId: '', hour: 5, minute: 45 })).toBe(false);
    expect(isUsable({ instanceId: 'a', hour: 24, minute: 0 })).toBe(false);
    expect(isUsable({ instanceId: 'a', hour: -1, minute: 0 })).toBe(false);
    expect(isUsable({ instanceId: 'a', hour: 5, minute: 60 })).toBe(false);
    expect(isUsable({ instanceId: 'a', hour: 5.5, minute: 0 } as never)).toBe(false);
    expect(isUsable(null)).toBe(false);
  });

  it('drops a weekday it cannot trust rather than guessing one', () => {
    // A wrong weekday is an alarm at 5:45 on the wrong morning.
    expect(cleanWeekdays([1, 7, 4])).toEqual([1, 4, 7]);
    expect(cleanWeekdays([2, 2, 2])).toEqual([2]);
    expect(cleanWeekdays([0, 8, -3, 'x', null, 3])).toEqual([3]);
    expect(cleanWeekdays('nonsense')).toEqual([]);
    expect(cleanWeekdays(undefined)).toEqual([]);
  });
});

describe('the window code rides with the alarm (Stop checks in with the app closed)', () => {
  const at = Date.now() + 18 * 3600000;
  const url = 'https://x.supabase.co/functions/v1/roll-call-ack';

  test('scheduling a dated alarm passes the window code so Stop can check in with the app closed', async () => {
    await syncWakeAlarms([{ instanceId: 'i1', hour: 6, minute: 0, at, title: 'Roll call', buttonLabel: "I'm Up", ackCode: 'c0de', ackUrl: url }]);
    expect(JSON.stringify(mockState.scheduled)).toContain('c0de');
    expect(mockState.scheduled[0]).toMatchObject({ ackCode: 'c0de', ackUrl: url });
  });

  test('a morning with no code still arms (the app drains the tap instead)', async () => {
    await syncWakeAlarms([{ ...morning('a'), at }]);
    expect(mockState.scheduled[0].ackCode).toBeUndefined();
    expect(mockState.scheduled[0].ackUrl).toBeUndefined();
  });

  test('never hands native a URL that is not https, or a code without a URL', async () => {
    await syncWakeAlarms([
      { ...morning('a'), at, ackCode: 'c0de', ackUrl: 'http://evil.example/ack' },
      { ...morning('b'), at, ackCode: 'c0de' },
      { ...morning('c'), at, ackUrl: url },
    ]);
    for (const s of mockState.scheduled) {
      expect(s.ackCode).toBeUndefined();
      expect(s.ackUrl).toBeUndefined();
    }
  });
});

const U1 = '11111111-2222-3333-4444-555555555555';
const U2 = '66666666-7777-8888-9999-000000000000';
const later = (h: number) => Date.now() + h * 3600000;

describe('roll call v3: alarms the push armed while the app was closed', () => {
  it('deviceAlarmIds lowercases UUIDs and ignores anything else', () => {
    expect(deviceAlarmIds([{ id: U1.toUpperCase() }, { id: 'not-a-uuid' }, null, { id: U1 }])).toEqual([U1]);
  });
  it('a COMPLETE sync cancels a push-armed alarm the coach has since called off', async () => {
    mockState.foreign = [U2.toUpperCase()];
    await syncWakeAlarms([{ instanceId: U1, hour: 5, minute: 45, at: later(20) }], { complete: true });
    expect(mockState.cancelled.map((x) => x.toLowerCase())).toContain(U2);
    expect(mockState.scheduled.map((s) => s.instanceId)).toEqual([U1]);
  });
  it('a partial sync (the week ahead did not load) never cancels what it did not arm', async () => {
    mockState.foreign = [U2.toUpperCase()];
    await syncWakeAlarms([{ instanceId: U1, hour: 5, minute: 45, at: later(20) }]);
    expect(mockState.cancelled.map((x) => x.toLowerCase())).not.toContain(U2);
  });
  it('re-arming a moved morning at a new time tells the server again', async () => {
    await syncWakeAlarms([{ instanceId: U1, hour: 5, minute: 45, at: later(20) }]);
    await new Promise((r) => setTimeout(r, 0));
    await syncWakeAlarms([{ instanceId: U1, hour: 6, minute: 15, at: later(20.5) }]);
    await new Promise((r) => setTimeout(r, 0));
    expect(mockState.told.filter((t) => t.p_instance === U1 && t.p_armed)).toHaveLength(2);
  });
  it('the state names the mornings this phone holds', async () => {
    mockState.foreign = [U2.toUpperCase()];
    const st = await wakeAlarmState();
    expect(st.ids).toContain(U2);
  });
});
