import { permissionGranted, locateMe, withTimeout } from './nearMe';

type Perm = { granted: boolean; canAskAgain: boolean };
function fakeL(perm: Perm, opts: { last?: unknown; current?: () => Promise<unknown> } = {}) {
  return {
    getForegroundPermissionsAsync: jest.fn(async () => perm),
    requestForegroundPermissionsAsync: jest.fn(async () => ({ granted: true, canAskAgain: true })),
    getLastKnownPositionAsync: jest.fn(async () => opts.last ?? null),
    getCurrentPositionAsync: jest.fn(opts.current ?? (async () => ({ coords: { latitude: 1, longitude: 2 } }))),
    Accuracy: { Balanced: 3 },
  };
}

test('opening the picker only READS the permission; it never asks', async () => {
  const L = fakeL({ granted: false, canAskAgain: true });
  expect(await permissionGranted(L as never)).toBe(false);
  expect(L.requestForegroundPermissionsAsync).not.toHaveBeenCalled();
  expect(await permissionGranted(null)).toBe(false);
});

test('Near me asks when it may, then centres on one fix', async () => {
  const L = fakeL({ granted: false, canAskAgain: true });
  expect(await locateMe(L as never)).toEqual({ ok: true, pos: { lat: 1, lng: 2 } });
  expect(L.requestForegroundPermissionsAsync).toHaveBeenCalledTimes(1);
});

test('a recent fix is used without waiting for a new one', async () => {
  const L = fakeL({ granted: true, canAskAgain: true }, { last: { coords: { latitude: 5, longitude: 6 } } });
  expect(await locateMe(L as never)).toEqual({ ok: true, pos: { lat: 5, lng: 6 } });
  expect(L.getCurrentPositionAsync).not.toHaveBeenCalled();
});

test('a refusal the OS will not ask again reads as blocked; no module reads as unavailable', async () => {
  expect(await locateMe(fakeL({ granted: false, canAskAgain: false }) as never)).toEqual({ ok: false, reason: 'blocked' });
  expect(await locateMe(null)).toEqual({ ok: false, reason: 'unavailable' });
});

test('no fix in time is a plain miss, and the timer is cleared either way', async () => {
  jest.useFakeTimers();
  try {
    const slow = locateMe(fakeL({ granted: true, canAskAgain: true }, { current: () => new Promise(() => {}) }) as never, 4000);
    await jest.advanceTimersByTimeAsync(4000);
    expect(await slow).toEqual({ ok: false, reason: 'nofix' });
    await withTimeout(Promise.resolve(1), 4000);
    expect(jest.getTimerCount()).toBe(0);
  } finally {
    jest.useRealTimers();
  }
});
