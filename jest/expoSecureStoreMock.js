// Node-test stub for expo-secure-store (a native ESM module babel-jest won't transform).
// The store graph imports it transitively via the Supabase client's secure-storage adapter, so
// every suite needs it to load. Stateful + inspectable so the adapter's chunking round-trip can
// be unit-tested; __store / __opts / __reset are test-only helpers. No real keychain in node.
// __opts records the options each key was last WRITTEN with (keychainAccessible is the iOS
// accessibility class), so the adapter's AFTER_FIRST_UNLOCK writes can be asserted.
const store = new Map();
const opts = new Map();
module.exports = {
  AFTER_FIRST_UNLOCK: 0,
  AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: 1,
  WHEN_UNLOCKED: 5,
  getItemAsync: async (k) => (store.has(k) ? store.get(k) : null),
  setItemAsync: async (k, v, o) => { store.set(k, String(v)); opts.set(k, o); },
  deleteItemAsync: async (k) => { store.delete(k); opts.delete(k); },
  __store: store,
  __opts: opts,
  __reset: () => { store.clear(); opts.clear(); },
};
