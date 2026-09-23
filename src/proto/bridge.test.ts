jest.mock('react-native', () => ({ Share: { share: jest.fn() }, Platform: { OS: 'ios' } }));
jest.mock('../lib/notify', () => ({ getPushToken: jest.fn(async () => 'ExponentPushToken[abc]') }));
jest.mock('expo-haptics', () => ({
  impactAsync: jest.fn(), notificationAsync: jest.fn(),
  ImpactFeedbackStyle: { Light: 1, Medium: 2, Heavy: 3 },
  NotificationFeedbackType: { Success: 1, Warning: 2, Error: 3 },
}));
jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async () => null), setItemAsync: jest.fn(), deleteItemAsync: jest.fn(),
  AFTER_FIRST_UNLOCK: 0,
}));
jest.mock('../lib/notify/execSync', () => ({ syncExecNotifications: jest.fn(async () => undefined) }));
jest.mock('../../modules/rollcall-live', () => ({ endLiveActivity: jest.fn(async () => undefined) }));
// Mock the native auth seams so the bridge is tested against a KNOWN seam state (unavailable),
// deterministically, whether or not expo-apple-authentication / expo-local-authentication are
// installed. The bridge's job is to route whatever the seam reports; the seams' own availability
// logic lives in src/lib/auth/*.
jest.mock('../lib/auth/apple', () => ({
  isAppleAuthAvailable: false,
  requestAppleIdentityToken: jest.fn(async () => null),
}));
jest.mock('../lib/auth/google', () => ({
  isGoogleAuthAvailable: false,
  requestGoogleIdToken: jest.fn(async () => null),
}));
jest.mock('../lib/auth/biometrics', () => ({
  isBiometricsAvailable: false,
  biometricsUsable: jest.fn(async () => false),
  authenticateBiometric: jest.fn(async () => true),
}));

// The location seam is mocked so the bridge is tested for ROUTING only; the seam's own decisions
// (one reading, verify_arrival_at, never a bare yes) are tested in src/lib/location.
jest.mock('../lib/location', () => ({
  isLocationAvailable: jest.fn(() => true),
  getPermissionState: jest.fn(async () => 'always'),
  requestPermission: jest.fn(async (bg: boolean) => (bg ? 'always' : 'when_in_use')),
  refreshGeofences: jest.fn(async () => ({ armed: 2, capped: 0, state: 'always' })),
  disarmAll: jest.fn(async () => undefined),
  checkArrival: jest.fn(async () => ({ within: true, reason: null, distance_m: 40 })),
  REPORTS_PRESENCE: true,
}));

import { handleBridgeMessage, BRIDGE_SHIM } from './bridge';
import { syncExecNotifications } from '../lib/notify/execSync';
import { endLiveActivity } from '../../modules/rollcall-live';

function fakeRef() {
  const injected: string[] = [];
  return { injected, ref: { current: { injectJavaScript: (js: string) => injected.push(js) } } as never };
}

test('APPLE_AVAILABLE resolves false when the auth seam reports unavailable', async () => {
  const { injected, ref } = fakeRef();
  const handled = await handleBridgeMessage(ref, { type: 'APPLE_AVAILABLE', id: 1 } as never);
  expect(handled).toBe(true);
  expect(injected[0]).toContain('__onNativeResult(1, false');
});

test('APPLE_SIGNIN resolves null when the auth seam reports unavailable', async () => {
  const { injected, ref } = fakeRef();
  await handleBridgeMessage(ref, { type: 'APPLE_SIGNIN', id: 2 } as never);
  expect(injected[0]).toContain('__onNativeResult(2, null');
});

test('shim exposes the apple API', () => {
  expect(BRIDGE_SHIM).toContain('APPLE_AVAILABLE');
  expect(BRIDGE_SHIM).toContain('APPLE_SIGNIN');
});

test('BIO_AVAILABLE resolves false when the auth seam reports unavailable', async () => {
  const { injected, ref } = fakeRef();
  await handleBridgeMessage(ref, { type: 'BIO_AVAILABLE', id: 3 } as never);
  expect(injected[0]).toContain('__onNativeResult(3, false');
});

test('NOTIFY_SYNC hands the plan to the exec seam (fire-and-forget)', async () => {
  const { ref } = fakeRef();
  const plan = [{ id: 'dinner', atISO: '2026-07-09T19:15:00.000Z', title: 't', body: 'b' }];
  const handled = await handleBridgeMessage(ref, { type: 'NOTIFY_SYNC', plan } as never);
  expect(handled).toBe(true);
  expect(syncExecNotifications).toHaveBeenCalledWith(plan);
});

test('shim exposes notify.sync', () => {
  expect(BRIDGE_SHIM).toContain('NOTIFY_SYNC');
});

test('PUSH_TOKEN resolves the token + platform for the proto to register server-side', async () => {
  const { injected, ref } = fakeRef();
  const handled = await handleBridgeMessage(ref, { type: 'PUSH_TOKEN', id: 4 } as never);
  expect(handled).toBe(true);
  expect(injected[0]).toContain('ExponentPushToken[abc]');
  expect(injected[0]).toContain('ios');
});

test('PUSH_TOKEN resolves null when no token is available (denied / no EAS project)', async () => {
  const { getPushToken } = jest.requireMock('../lib/notify') as { getPushToken: jest.Mock };
  getPushToken.mockResolvedValueOnce(null);
  const { injected, ref } = fakeRef();
  await handleBridgeMessage(ref, { type: 'PUSH_TOKEN', id: 5 } as never);
  expect(injected[0]).toContain('__onNativeResult(5, null');
});

test('shim exposes push.token', () => {
  expect(BRIDGE_SHIM).toContain('PUSH_TOKEN');
});

test('HAPTIC success routes to the notification generator, not an impact', async () => {
  const Haptics = jest.requireMock('expo-haptics') as {
    impactAsync: jest.Mock; notificationAsync: jest.Mock;
    NotificationFeedbackType: { Success: number };
  };
  Haptics.impactAsync.mockClear();
  Haptics.notificationAsync.mockClear();
  const { ref } = fakeRef();
  const handled = await handleBridgeMessage(ref, { type: 'HAPTIC', style: 'success' } as never);
  expect(handled).toBe(true);
  expect(Haptics.notificationAsync).toHaveBeenCalledWith(Haptics.NotificationFeedbackType.Success);
  expect(Haptics.impactAsync).not.toHaveBeenCalled();
});

test('HAPTIC light is an impact, so the two are distinguishable on device', async () => {
  const Haptics = jest.requireMock('expo-haptics') as {
    impactAsync: jest.Mock; notificationAsync: jest.Mock;
    ImpactFeedbackStyle: { Light: number };
  };
  Haptics.impactAsync.mockClear();
  Haptics.notificationAsync.mockClear();
  const { ref } = fakeRef();
  await handleBridgeMessage(ref, { type: 'HAPTIC', style: 'light' } as never);
  expect(Haptics.impactAsync).toHaveBeenCalledWith(Haptics.ImpactFeedbackStyle.Light);
  expect(Haptics.notificationAsync).not.toHaveBeenCalled();
});

// The shim's capture-phase click listener is the SINGLE source of tap feedback. navigator.vibrate
// used to route to haptic('light') as well, so every tap fired two impacts and a real 'success'
// notification could never read as different. Keep the stub inert.
test('navigator.vibrate is a no-op so taps fire exactly one haptic', () => {
  expect(BRIDGE_SHIM).toMatch(/navigator\.vibrate\s*=\s*function\(\)\{\s*return true;\s*\}/);
  expect(BRIDGE_SHIM).not.toContain("navigator.vibrate = function(){ window.OnStandardNative.haptic('light')");
});

/* The lock-screen card has to stop when the answer came from inside the app (P0, 2026-09-15).
   endLiveActivity was written, exported and never called by anything, so an in-app "I'm up" left
   the Live Activity counting until iOS timed it out. */
test('ROLLCALL_ACKED ends the lock-screen Live Activity for that instance', async () => {
  const { ref } = fakeRef();
  const handled = await handleBridgeMessage(ref, { type: 'ROLLCALL_ACKED', instanceId: 'rc-9' } as never);
  expect(handled).toBe(true);
  expect(endLiveActivity).toHaveBeenCalledWith('rc-9');
});

test('the proto can reach it: the shim exposes rollcall.acked as a one-way post', () => {
  expect(BRIDGE_SHIM).toContain('rollcall:');
  expect(BRIDGE_SHIM).toContain("type: 'ROLLCALL_ACKED'");
});


/* Location is back (founder 2026-09-23), verified by distance on the server. Five messages; the
   coach's "use where I'm standing" (LOCATION_PLACE) is NOT restored: coaches pick places on a map. */
describe('location bridge', () => {
  const loc = () => jest.requireMock('../lib/location') as Record<string, jest.Mock>;

  test('LOCATION_AVAILABLE reports availability, permission state and presence support', async () => {
    const { injected, ref } = fakeRef();
    expect(await handleBridgeMessage(ref, { type: 'LOCATION_AVAILABLE', id: 20 } as never)).toBe(true);
    expect(injected[0]).toContain('__onNativeResult(20, {"available":true,"state":"always","presence":true}');
  });

  test('LOCATION_PERMISSION asks for background only when the proto says so', async () => {
    const { injected, ref } = fakeRef();
    await handleBridgeMessage(ref, { type: 'LOCATION_PERMISSION', id: 21, background: true } as never);
    expect(loc().requestPermission).toHaveBeenLastCalledWith(true);
    expect(injected[0]).toContain('__onNativeResult(21, "always"');
    await handleBridgeMessage(ref, { type: 'LOCATION_PERMISSION', id: 22 } as never);
    expect(loc().requestPermission).toHaveBeenLastCalledWith(false);
  });

  test('LOCATION_ARM and LOCATION_DISARM reach the seam', async () => {
    const { injected, ref } = fakeRef();
    await handleBridgeMessage(ref, { type: 'LOCATION_ARM', id: 23 } as never);
    expect(injected[0]).toContain('"armed":2');
    await handleBridgeMessage(ref, { type: 'LOCATION_DISARM', id: 24 } as never);
    expect(loc().disarmAll).toHaveBeenCalled();
    expect(injected[1]).toContain('__onNativeResult(24, true');
  });

  test('LOCATION_CHECK is the I-am-here tap: checkArrival for that instance, verdict back, no coordinate', async () => {
    const { injected, ref } = fakeRef();
    await handleBridgeMessage(ref, { type: 'LOCATION_CHECK', id: 25, instanceId: 'inst-7' } as never);
    expect(loc().checkArrival).toHaveBeenCalledWith('inst-7');
    expect(injected[0]).toContain('"within":true');
    expect(injected[0]).not.toMatch(/lat|lng|latitude|longitude/);
  });

  test('the shim exposes location.{available,request,arm,disarm,check} and no place capture', () => {
    for (const t of ['LOCATION_AVAILABLE', 'LOCATION_PERMISSION', 'LOCATION_ARM', 'LOCATION_DISARM', 'LOCATION_CHECK']) {
      expect(BRIDGE_SHIM).toContain(t);
    }
    expect(BRIDGE_SHIM).toContain('location:');
    expect(BRIDGE_SHIM).not.toContain('LOCATION_PLACE');
  });
});

/* The PROTO writes the Supabase session through SECURE_SET. A region wake with the phone LOCKED
   has to read it, so every write uses AFTER_FIRST_UNLOCK rather than the iOS default. */
describe('SECURE_SET keychain class', () => {
  const SS = () => jest.requireMock('expo-secure-store') as { setItemAsync: jest.Mock; AFTER_FIRST_UNLOCK: number };

  test.each(['sb-abcdefghij-auth-token', 'sb-abcdefghij-auth-token.0', 'onstd-biolock'])(
    'SECURE_SET %s passes keychainAccessible AFTER_FIRST_UNLOCK', async (key) => {
      SS().setItemAsync.mockClear();
      const { injected, ref } = fakeRef();
      await handleBridgeMessage(ref, { type: 'SECURE_SET', id: 30, key, value: 'v' } as never);
      expect(SS().setItemAsync).toHaveBeenCalledWith(key, 'v', { keychainAccessible: SS().AFTER_FIRST_UNLOCK });
      expect(injected[0]).toContain('__onNativeResult(30, true');
    });

  test('a key outside the allow-list is still refused before any write', async () => {
    SS().setItemAsync.mockClear();
    const { ref } = fakeRef();
    await handleBridgeMessage(ref, { type: 'SECURE_SET', id: 31, key: 'other', value: 'v' } as never);
    expect(SS().setItemAsync).not.toHaveBeenCalled();
  });
});

describe('MAP_PICK: the coach draws the check-in bubble', () => {
  // The coordinator is real (pure); only the presenter ProtoApp would register is faked.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { setMapPresenter } = require('../lib/maps/pickRequest') as typeof import('../lib/maps/pickRequest');
  afterEach(() => setMapPresenter(null));

  test('Save replies { place } with the name, address, point and radius', async () => {
    const seen: unknown[] = [];
    setMapPresenter(async (initial) => {
      seen.push(initial);
      return { name: 'Weight room', address: '4000 Central Florida Blvd', lat: 28.6, lng: -81.2, radius_m: 150 };
    });
    const { injected, ref } = fakeRef();
    const handled = await handleBridgeMessage(ref, { type: 'MAP_PICK', id: 41, initial: { lat: 28.5, lng: -81.1, radius_m: 300, name: 'Old' } } as never);
    expect(handled).toBe(true);
    expect(seen[0]).toEqual({ lat: 28.5, lng: -81.1, radius_m: 300, name: 'Old' });
    expect(injected[0]).toContain('__onNativeResult(41, {"place":{"name":"Weight room","address":"4000 Central Florida Blvd","lat":28.6,"lng":-81.2,"radius_m":150}}, null)');
  });

  test('Cancel replies { place: null } and is not an error', async () => {
    setMapPresenter(async () => null);
    const { injected, ref } = fakeRef();
    await handleBridgeMessage(ref, { type: 'MAP_PICK', id: 42 } as never);
    expect(injected[0]).toContain('__onNativeResult(42, {"place":null}, null)');
  });

  test('no picker mounted: { place: null } with an error, never a hang', async () => {
    const { injected, ref } = fakeRef();
    await handleBridgeMessage(ref, { type: 'MAP_PICK', id: 43 } as never);
    expect(injected[0]).toContain('__onNativeResult(43, {"place":null}, "map-unavailable")');
  });

  test('the shim exposes maps.pick, which resolves the place itself (or null)', () => {
    expect(BRIDGE_SHIM).toContain("call('MAP_PICK'");
    expect(BRIDGE_SHIM).toMatch(/maps:\s*\{\s*pick: function\(initial\)/);
    expect(BRIDGE_SHIM).toContain('r && r.place ? r.place : null');
  });
});
