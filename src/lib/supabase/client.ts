// AthleteOS — Supabase client (inert until keys are provided).
//
// Phase 2 is "scaffolded, keys later": with no EXPO_PUBLIC_SUPABASE_URL /
// EXPO_PUBLIC_SUPABASE_ANON_KEY set, `supabase` is null and `isSupabaseConfigured`
// is false. Every call site checks the flag and falls back to the local mock data,
// so the app runs exactly as it does today. Drop the two env vars in `.env` (see
// `.env.example`) to light the backend up — no other code change required to connect.
import 'react-native-url-polyfill/auto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Database } from './database.types';
import { secureStorage } from './secureStorage';

const url = process.env.EXPO_PUBLIC_SUPABASE_URL?.trim();
const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY?.trim();

/** True only when both env vars are present — gates every remote call. */
export const isSupabaseConfigured = Boolean(url && anonKey);

/**
 * Separate go-live gate for the DATA backend (auth + day sync + roster reads),
 * independent of `isSupabaseConfigured` — which is already true whenever the AI
 * Edge Function's project URL/key are set. Real account + data wiring stays OFF
 * until EXPO_PUBLIC_BACKEND_LIVE is explicitly "true", so AI can run while the
 * database backend is staged, and it doubles as the instant kill-switch.
 */
export const isBackendLive =
  isSupabaseConfigured && process.env.EXPO_PUBLIC_BACKEND_LIVE?.trim() === 'true';

/**
 * The typed client, or null when unconfigured. Prefer `requireSupabase()` at call
 * sites that have already checked `isSupabaseConfigured`; use this for the guard.
 */
export const supabase: SupabaseClient<Database> | null = isSupabaseConfigured
  ? createClient<Database>(url as string, anonKey as string, {
      auth: {
        // Encrypted at rest via the OS keychain (security audit L1); web falls back to
        // AsyncStorage inside the adapter. See secureStorage.ts.
        storage: secureStorage,
        persistSession: true,
        autoRefreshToken: true,
        // React Native has no URL bar; the OAuth/redirect detection web uses
        // would throw, so disable it.
        detectSessionInUrl: false,
      },
    })
  : null;

/** Narrow `supabase` to non-null. Throws if called while unconfigured — only use
 *  after an `isSupabaseConfigured` check. */
export function requireSupabase(): SupabaseClient<Database> {
  if (!supabase) {
    throw new Error(
      'Supabase is not configured. Set EXPO_PUBLIC_SUPABASE_URL and ' +
        'EXPO_PUBLIC_SUPABASE_ANON_KEY (see .env.example) before calling remote APIs.',
    );
  }
  return supabase;
}
