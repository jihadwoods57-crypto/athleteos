// Storage adapter for supabase-js auth.storage.
// In the native app: window.OnStandardNative.secureStore (iOS Keychain, ~2KB/item) — the
// Supabase session (access JWT + refresh + user) is chunked across keys to dodge that limit.
// At :8124 (no native shell): falls back to localStorage so the whole flow is testable in a browser.
const CHUNK = 1800; // safety margin under the ~2KB Keychain item cap
const native = () => (window.OnStandardNative && window.OnStandardNative.secureStore) || null;
const nKey = (k) => `${k}.__n`;
const cKey = (k, i) => `${k}.${i}`;

async function clearChunks(ns, k) {
  const n = Number(await ns.getItem(nKey(k)));
  await ns.removeItem(k);
  await ns.removeItem(nKey(k));
  if (n && !Number.isNaN(n)) for (let i = 0; i < n; i++) await ns.removeItem(cKey(k, i));
}

export const secureStorage = {
  async getItem(key) {
    const ns = native();
    if (!ns) return localStorage.getItem(key);
    const n = Number(await ns.getItem(nKey(key)));
    if (!n || Number.isNaN(n)) return await ns.getItem(key); // small single value
    let out = '';
    for (let i = 0; i < n; i++) {
      const part = await ns.getItem(cKey(key, i));
      if (part == null) return null; // a missing chunk → treat as no session (safe re-auth)
      out += part;
    }
    return out;
  },
  async setItem(key, value) {
    const ns = native();
    if (!ns) {
      localStorage.setItem(key, value);
      return;
    }
    await clearChunks(ns, key); // drop any previous representation first
    if (value.length <= CHUNK) {
      await ns.setItem(key, value);
      return;
    }
    const n = Math.ceil(value.length / CHUNK);
    await ns.setItem(nKey(key), String(n));
    for (let i = 0; i < n; i++) await ns.setItem(cKey(key, i), value.slice(i * CHUNK, (i + 1) * CHUNK));
  },
  async removeItem(key) {
    const ns = native();
    if (!ns) {
      localStorage.removeItem(key);
      return;
    }
    await clearChunks(ns, key);
  },
};
