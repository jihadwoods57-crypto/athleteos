// NOTE (adapted from the brief): babel-plugin-jest-hoist forbids a jest.mock() factory from
// closing over out-of-scope variables unless the name is prefixed `mock` (case-insensitive) —
// the mock() call is hoisted above any plain `const`/`let`. Renamed cancelAll/scheduled to
// mockCancelAll/mockScheduled to satisfy that; behavior is identical to the brief.
const mockScheduled: unknown[] = [];
const mockCancelAll = jest.fn(async () => undefined);
jest.mock('expo-notifications', () => ({
  cancelAllScheduledNotificationsAsync: () => mockCancelAll(),
  scheduleNotificationAsync: jest.fn(async (req: unknown) => { mockScheduled.push(req); return 'id'; }),
  SchedulableTriggerInputTypes: { DATE: 'date', DAILY: 'daily' },
  getPermissionsAsync: jest.fn(async () => ({ granted: true })),
  requestPermissionsAsync: jest.fn(async () => ({ granted: true })),
  setNotificationChannelAsync: jest.fn(async () => undefined),
}));
jest.mock('react-native', () => ({ Platform: { OS: 'ios' } }));

import { syncExecNotifications } from './execSync';

beforeEach(() => { mockScheduled.length = 0; mockCancelAll.mockClear(); });

test('cancels everything, then schedules only future date triggers', async () => {
  const future = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  const past = new Date(Date.now() - 60 * 1000).toISOString();
  await syncExecNotifications([
    { id: 'dinner', atISO: future, title: 'Dinner closes in 45', body: 'x' },
    { id: 'stale', atISO: past, title: 'old', body: 'y' },
  ]);
  expect(mockCancelAll).toHaveBeenCalledTimes(1);
  expect(mockScheduled).toHaveLength(1);
  expect((mockScheduled[0] as { identifier: string }).identifier).toContain('exec-dinner');
});

test('empty plan cancels and schedules nothing', async () => {
  await syncExecNotifications([]);
  expect(mockCancelAll).toHaveBeenCalledTimes(1);
  expect(mockScheduled).toHaveLength(0);
});

test('immediate items (atISO null) schedule with a null trigger', async () => {
  await syncExecNotifications([{ id: 'celebrate', atISO: null, title: "You're OnStandard.", body: 'z' }]);
  expect(mockScheduled).toHaveLength(1);
  expect((mockScheduled[0] as { trigger: unknown }).trigger).toBeNull();
});

test('an invalid atISO is skipped, not scheduled', async () => {
  await syncExecNotifications([
    { id: 'bad', atISO: 'not-a-date', title: 'x', body: 'y' },
    { id: 'good', atISO: new Date(Date.now() + 3600e3).toISOString(), title: 'a', body: 'b' },
  ]);
  expect(mockScheduled).toHaveLength(1);
  expect((mockScheduled[0] as { identifier: string }).identifier).toContain('exec-good');
});

test('one scheduling failure does not drop the remaining items', async () => {
  const future = new Date(Date.now() + 3600e3).toISOString();
  // First schedule call throws; subsequent calls fall back to the factory impl (which pushes).
  (require('expo-notifications').scheduleNotificationAsync as jest.Mock)
    .mockImplementationOnce(async () => { throw new Error('boom'); });
  await syncExecNotifications([
    { id: 'first', atISO: future, title: 'x', body: 'y' },
    { id: 'second', atISO: future, title: 'a', body: 'b' },
  ]);
  expect(mockScheduled).toHaveLength(1);
  expect((mockScheduled[0] as { identifier: string }).identifier).toContain('exec-second');
});
