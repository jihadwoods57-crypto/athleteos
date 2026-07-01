// Node-test stub for expo-secure-store (a native ESM module babel-jest won't transform).
// The store graph imports it transitively via the Supabase client's secure-storage adapter, so
// every suite needs it to load. Stateful + inspectable so the adapter's chunking round-trip can
// be unit-tested; __store / __reset are test-only helpers. No real keychain in node.
const store = new Map();
module.exports = {
  getItemAsync: async (k) => (store.has(k) ? store.get(k) : null),
  setItemAsync: async (k, v) => { store.set(k, String(v)); },
  deleteItemAsync: async (k) => { store.delete(k); },
  __store: store,
  __reset: () => store.clear(),
};
