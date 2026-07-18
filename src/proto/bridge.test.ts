jest.mock('react-native', () => ({ Share: { share: jest.fn() }, Platform: { OS: 'ios' } }));
jest.mock('../lib/notify', () => ({ getPushToken: jest.fn(async () => 'ExponentPushToken[abc]') }));
jest.mock('expo-haptics', () => ({
  impactAsync: jest.fn(), notificationAsync: jest.fn(),
  ImpactFeedbackStyle: { Light: 1, Medium: 2, Heavy: 3 },
  NotificationFeedbackType: { Success: 1, Warning: 2, Error: 3 },
}));
jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async () => null), setItemAsync: jest.fn(), deleteItemAsync: jest.fn(),
}));
jest.mock('../lib/notify/execSync', () => ({ syncExecNotifications: jest.fn(async () => undefined) }));
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

import { handleBridgeMessage, BRIDGE_SHIM } from './bridge';
import { syncExecNotifications } from '../lib/notify/execSync';

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
