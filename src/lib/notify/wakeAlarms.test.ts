// The reconcile half of the wake-up alarm: what the device ends up holding.
//
// The property worth protecting is that a wake-up a coach DELETED stops ringing. Appending would
// leave it armed on the athlete's phone with nothing in the app to turn it off, which is the worst
// failure this feature has.
import { syncWakeAlarms, wakeAlarmState, isUsable, cleanWeekdays, _resetWakeAlarms } from './wakeAlarms';

type Scheduled = { instanceId: string; hour: number; minute: number; weekdays: number[]; title: string };

const mockState = {
  supported: true,
  authorization: 'authorized' as string,
  scheduled: [] as Scheduled[],
  cancelled: [] as string[],
  refuse: new Set<string>(),
  requested: 0,
};

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
  cancelWakeAlarm: (id: string) => {
    mockState.cancelled.push(id);
    mockState.scheduled = mockState.scheduled.filter((x) => x.instanceId !== id);
  },
  scheduledWakeAlarms: () => mockState.scheduled,
}), { virtual: true });

const morning = (instanceId: string, hour = 5, minute = 45) => ({ instanceId, hour, minute, title: 'Wake up' });

beforeEach(() => {
  mockState.supported = true;
  mockState.authorization = 'authorized';
  mockState.scheduled = [];
  mockState.cancelled = [];
  mockState.refuse = new Set();
  mockState.requested = 0;
  _resetWakeAlarms();
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
  it('asks for permission once, when nobody has been asked', async () => {
    mockState.authorization = 'notDetermined';
    const s = await wakeAlarmState();
    expect(mockState.requested).toBe(1);
    expect(s.authorization).toBe('authorized');
  });

  it('does not re-ask somebody who said no', async () => {
    mockState.authorization = 'denied';
    const s = await wakeAlarmState();
    expect(mockState.requested).toBe(0);
    expect(s.authorization).toBe('denied');
  });

  it('reports honestly on a device with no alarms at all', async () => {
    mockState.supported = false;
    expect(await wakeAlarmState()).toEqual({ supported: false, authorization: 'unsupported', armed: 0 });
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
