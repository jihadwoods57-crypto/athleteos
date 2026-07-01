// OnStandard — Supabase integration barrel. Screens/store import from here, never
// from the raw client, so the backend can be swapped or mocked behind one seam.
export { isSupabaseConfigured, isBackendLive, supabase, requireSupabase } from './client';
export * as auth from './auth';
export * as db from './queries';
export type { DiscoveredTeam, ResolvedTeam, PendingRequest } from './queries';
export type * from './database.types';
