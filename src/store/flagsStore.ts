// OnStandard — runtime feature-flag client cache. Fetches the per-caller { name: bool } map from
// the `flags` edge function at launch/resume, persists it, and serves reads. NEVER blocks render:
// on failure it keeps the last cache, and unknown flags fall back to DEFAULT_FLAGS (compile-time
// safe defaults). This is UX gating (eventually-consistent — flips next launch); anything
// security- or cost-critical is re-checked server-side in the relevant edge function.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { supabase } from '@/lib/supabase/client';

// Compile-time safe defaults — mirror the 0109 seed's default_on (all OFF today). If the network
// map omits a key, this governs. Keep in sync with the migration seed.
export const DEFAULT_FLAGS: Record<string, boolean> = {
  engines: false,
  meal_plans: false,
  trust_pass: false,
  streak_grace: false,
  assistant_gate: false,
};

const CACHE_KEY = 'os.flags.v1';

type FlagsState = {
  map: Record<string, boolean>;
  source: 'network' | 'cache' | 'default';
  hydrate: () => Promise<void>;
  refresh: () => Promise<void>;
};

export const useFlagsStore = create<FlagsState>((set) => ({
  map: { ...DEFAULT_FLAGS },
  source: 'default',

  // Load the last-persisted map synchronously-early at launch (before the network answers).
  hydrate: async () => {
    try {
      const raw = await AsyncStorage.getItem(CACHE_KEY);
      if (raw) set({ map: { ...DEFAULT_FLAGS, ...JSON.parse(raw) }, source: 'cache' });
    } catch {
      /* keep defaults */
    }
  },

  // Fetch the caller's evaluated flags. Fire-and-forget: never throws, never blocks render.
  refresh: async () => {
    const supaUrl = process.env.EXPO_PUBLIC_SUPABASE_URL?.trim();
    const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY?.trim();
    const endpoint = supaUrl ? `${supaUrl}/functions/v1/flags` : '';
    if (!endpoint) return; // seam inert until the backend URL is configured

    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        apikey: anonKey ?? '',
        Authorization: `Bearer ${anonKey ?? ''}`,
      };
      try {
        const token = (await supabase?.auth.getSession())?.data.session?.access_token;
        if (token) headers.Authorization = `Bearer ${token}`;
      } catch {
        /* no session — keep the anon-key bearer (function treats caller as anonymous) */
      }

      const res = await fetch(endpoint, { method: 'GET', headers });
      if (!res.ok) return; // keep last map
      const body = await res.json();
      const flags = body && typeof body.flags === 'object' && body.flags ? body.flags : null;
      if (!flags) return;

      set({ map: { ...DEFAULT_FLAGS, ...flags }, source: 'network' });
      try {
        await AsyncStorage.setItem(CACHE_KEY, JSON.stringify(flags));
      } catch {
        /* persistence is best-effort */
      }
    } catch {
      /* offline / network error — keep whatever we have. Never throw. */
    }
  },
}));

// Imperative reader for non-React code paths (e.g. store logic). Not reactive — reflects the map
// at call time, which is the launch-refresh model (a flag flip takes effect next launch).
export function getFlag(name: string): boolean {
  const map = useFlagsStore.getState().map;
  return name in map ? map[name] : (DEFAULT_FLAGS[name] ?? false);
}
