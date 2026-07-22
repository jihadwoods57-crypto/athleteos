// OnStandard — Command Center shared client. Holds ONLY the publishable key + the founder's login JWT
// (never a service-role key). Every read/write is a platform-admin-gated RPC. One client, shared by
// every section module so there is a single auth/session source of truth.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

export const SUPABASE_URL = 'https://ftwrvylzoyznhbzhgism.supabase.co';
export const SUPABASE_ANON_KEY = 'sb_publishable_W_h82SgYL7_XE5SqGnNp1A_tYXap0TJ'; // publishable — safe to ship
export const PROJECT_REF = 'ftwrvylzoyznhbzhgism';
export const FUNCTIONS_URL = 'https://ftwrvylzoyznhbzhgism.functions.supabase.co';
export const VERSION = 'phase-1a';
export const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

export async function rpc(name, args) {
  const { data, error } = await sb.rpc(name, args || {});
  if (error) throw new Error(`${name}: ${error.message}`);
  return data;
}

// admin_bootstrap returns {is_admin:false} for a non-admin (it NEVER throws) — the client renders a
// clean "access denied" from that instead of a broken shell full of 'not authorized' errors.
export async function bootstrap() {
  return rpc('admin_bootstrap');
}
