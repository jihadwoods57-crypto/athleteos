// The launch splash is held until the proto paints, and every way out releases it exactly once.
const calls: string[] = [];
jest.mock('expo-splash-screen', () => ({
  preventAutoHideAsync: jest.fn(() => { calls.push('prevent'); return Promise.resolve(true); }),
  setOptions: jest.fn((o: unknown) => { calls.push('options:' + JSON.stringify(o)); }),
  hide: jest.fn(() => { calls.push('hide'); }),
}));

import { holdSplash, releaseSplash, releaseSplashAfter, resetSplashForTest, SPLASH_MAX_MS } from './launchSplash';

beforeEach(() => {
  calls.length = 0;
  resetSplashForTest();
  jest.useRealTimers();
});

test('holding asks for a fade and prevents the auto-hide, once', () => {
  holdSplash();
  holdSplash();
  expect(calls).toEqual(['options:{"duration":200,"fade":true}', 'prevent']);
});

test('release hides once however many paths ask', () => {
  holdSplash();
  releaseSplash();
  releaseSplash();
  expect(calls.filter((c) => c === 'hide')).toHaveLength(1);
});

test('the ceiling releases a splash nobody released', () => {
  jest.useFakeTimers();
  holdSplash();
  releaseSplashAfter();
  jest.advanceTimersByTime(SPLASH_MAX_MS - 1);
  expect(calls).not.toContain('hide');
  jest.advanceTimersByTime(1);
  expect(calls.filter((c) => c === 'hide')).toHaveLength(1);
});

test('a PAINTED before the ceiling wins, and the ceiling then does nothing', () => {
  jest.useFakeTimers();
  holdSplash();
  const cancel = releaseSplashAfter(1000);
  releaseSplash();            // the proto's first frame
  cancel();
  jest.advanceTimersByTime(5000);
  expect(calls.filter((c) => c === 'hide')).toHaveLength(1);
});

test('the ceiling stays under five seconds: a splash is not a loading screen', () => {
  expect(SPLASH_MAX_MS).toBeLessThanOrEqual(5000);
});
