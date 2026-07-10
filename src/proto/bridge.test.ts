jest.mock('react-native', () => ({ Share: { share: jest.fn() } }));
jest.mock('expo-haptics', () => ({
  impactAsync: jest.fn(), notificationAsync: jest.fn(),
  ImpactFeedbackStyle: { Light: 1, Medium: 2, Heavy: 3 },
  NotificationFeedbackType: { Success: 1, Warning: 2, Error: 3 },
}));
jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async () => null), setItemAsync: jest.fn(), deleteItemAsync: jest.fn(),
}));

import { handleBridgeMessage, BRIDGE_SHIM } from './bridge';

function fakeRef() {
  const injected: string[] = [];
  return { injected, ref: { current: { injectJavaScript: (js: string) => injected.push(js) } } as never };
}

test('APPLE_AVAILABLE resolves false while the native module is absent', async () => {
  const { injected, ref } = fakeRef();
  const handled = await handleBridgeMessage(ref, { type: 'APPLE_AVAILABLE', id: 1 } as never);
  expect(handled).toBe(true);
  expect(injected[0]).toContain('__onNativeResult(1, false');
});

test('APPLE_SIGNIN resolves null while the native module is absent', async () => {
  const { injected, ref } = fakeRef();
  await handleBridgeMessage(ref, { type: 'APPLE_SIGNIN', id: 2 } as never);
  expect(injected[0]).toContain('__onNativeResult(2, null');
});

test('shim exposes the apple API', () => {
  expect(BRIDGE_SHIM).toContain('APPLE_AVAILABLE');
  expect(BRIDGE_SHIM).toContain('APPLE_SIGNIN');
});

test('BIO_AVAILABLE resolves false while the native module is absent', async () => {
  const { injected, ref } = fakeRef();
  await handleBridgeMessage(ref, { type: 'BIO_AVAILABLE', id: 3 } as never);
  expect(injected[0]).toContain('__onNativeResult(3, false');
});
