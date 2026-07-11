// Creates the one Supabase client the proto uses. supabase-js (the UMD library) is loaded as a
// classic <script> in index.html and lands on window.supabase; here we capture createClient,
// build the client with the chunked Keychain session adapter, and expose it as window.sb.
//
// Config (url + anonKey) is injected as window.__SUPABASE by the native shell before proto code
// runs; index.html carries a :8124 fallback so the browser works too. The anon key is public
// (RLS is the real authorization).
import { secureStorage } from './secure-storage.js';

const cfg = window.__SUPABASE || {};
const lib = window.supabase; // the UMD library global (has createClient)

function makeClient() {
  if (!lib || !lib.createClient) {
    console.error('[supabase] library not loaded — vendor/supabase.js must load before the modules');
    return null;
  }
  if (!cfg.url || !cfg.anonKey) {
    console.error('[supabase] missing config (window.__SUPABASE) — cannot create client');
    return null;
  }
  return lib.createClient(cfg.url, cfg.anonKey, {
    auth: {
      storage: secureStorage,
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false, // no URL bar in a WebView; must stay false
    },
  });
}

export const sb = makeClient();
// Single handle for the rest of the proto. NOTE the name clash: `window.supabase` was the
// library; we deliberately reassign it to the client instance now that createClient is captured.
window.sb = sb;
window.supabase = sb;

// Keep the token fresh only while the app is foregrounded (mirrors the RN AppState behavior).
if (sb) {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') sb.auth.startAutoRefresh();
    else sb.auth.stopAutoRefresh();
  });
  // A session that dies mid-run (refresh failure, server-side revocation) must not leave the
  // app rendering authenticated screens against a signed-out client. Wipe the user-scoped
  // runtime (state.js exposes act as window.__act) and land on Welcome. act.signOut() also
  // triggers this event — the wipe is idempotent, so the double-run is harmless.
  sb.auth.onAuthStateChange((event) => {
    if (event !== 'SIGNED_OUT') return;
    try { if (window.__act) window.__act._wipeUserScopedState({ keepPendingOb: true }); } catch { /* never block */ }
    if ((location.hash || '') !== '#welcome') location.hash = '#welcome';
  });
}
