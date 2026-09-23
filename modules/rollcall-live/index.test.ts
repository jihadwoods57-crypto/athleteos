// The JS surface of the native alarm call: which native function a dated alarm reaches.
//
// The property worth protecting is that NEW JS arriving over the air on an OLDER binary still arms
// the alarm. Expo rejects a call with more arguments than the native function declares, so the
// window code travels through a separately named function and the old four-argument call stays the
// fallback.
const mockNative: Record<string, unknown> = {};

jest.mock('expo-modules-core', () => ({ requireOptionalNativeModule: () => mockNative }));

import { scheduleWakeAlarmAt } from './index';

beforeEach(() => {
  for (const k of Object.keys(mockNative)) delete mockNative[k];
});

const ACK = { ackCode: 'c0de', ackUrl: 'https://x.supabase.co/functions/v1/roll-call-ack' };

test('a binary that knows the window code gets it, with the instant and the coach words', async () => {
  const withAck = jest.fn(async () => 'alarm-1');
  const old = jest.fn(async () => 'old');
  Object.assign(mockNative, { scheduleWakeAlarmAt: old, scheduleWakeAlarmAtWithAck: withAck });
  expect(await scheduleWakeAlarmAt({ instanceId: 'i1', at: 1000.4, title: 'Roll call', buttonLabel: 'Up', ...ACK })).toBe('alarm-1');
  expect(withAck).toHaveBeenCalledWith('i1', 1000, 'Roll call', 'Up', 'c0de', ACK.ackUrl);
  expect(old).not.toHaveBeenCalled();
});

test('an older binary still arms the alarm through the four-argument call', async () => {
  const old = jest.fn(async () => 'old');
  Object.assign(mockNative, { scheduleWakeAlarmAt: old });
  expect(await scheduleWakeAlarmAt({ instanceId: 'i1', at: 1000, ...ACK })).toBe('old');
  expect(old).toHaveBeenCalledWith('i1', 1000, 'Wake up', 'I’m Up');
});

test('a morning with no code uses the four-argument call even on a new binary', async () => {
  const withAck = jest.fn(async () => 'alarm-1');
  const old = jest.fn(async () => 'old');
  Object.assign(mockNative, { scheduleWakeAlarmAt: old, scheduleWakeAlarmAtWithAck: withAck });
  expect(await scheduleWakeAlarmAt({ instanceId: 'i1', at: 1000 })).toBe('old');
  expect(withAck).not.toHaveBeenCalled();
});
