// OnStandard — per-caller feature-flag projection. Evaluates ALL flags for the authenticated
// caller server-side and returns ONLY a { name: boolean } map. Raw config/allowlists never
// leave the server, so "who is in beta" cannot leak. See _shared/feature-flags.ts for the rule.
//
// Deploy (founder): supabase functions deploy flags   (URL + SERVICE_ROLE auto-injected).
// Then set EXPO_PUBLIC_FLAGS_URL to this function's URL and ship an app build — until then the
// client seam is inert and every flag resolves to its compile-time default.
import { createClient } from "npm:@supabase/supabase-js@2";
import { evaluateAll, type FlagRow } from "../_shared/feature-flags.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) return json({ error: "unavailable" }, 503);

  // Resolve the caller from their JWT — never trust an id from the body.
  const authz = req.headers.get("Authorization") || "";
  const jwt = authz.startsWith("Bearer ") ? authz.slice(7) : "";
  const sb = createClient(url, key);

  let userId: string | null = null;
  if (jwt) {
    const { data } = await sb.auth.getUser(jwt);
    userId = data.user?.id ?? null;
  }

  // Best-effort role/org enrichment for allowlist matching. Both are optional: an anonymous or
  // unenriched caller simply falls to each flag's default. Failures here never fail the request.
  let role: string | null = null;
  let orgId: string | null = null;
  if (userId) {
    try {
      const { data: prof } = await sb.from("profiles").select("primary_role").eq("id", userId).maybeSingle();
      role = (prof?.primary_role as string) ?? null;
    } catch { /* role stays null */ }
    try {
      const { data: mem } = await sb
        .from("org_memberships")
        .select("organization_id")
        .eq("member_id", userId)
        .eq("status", "active")
        .limit(1)
        .maybeSingle();
      orgId = (mem?.organization_id as string) ?? null;
    } catch { /* orgId stays null */ }
  }

  const { data: flags, error } = await sb.from("feature_flags").select(
    "name, default_on, kill_switch, enabled_user_ids, enabled_roles, enabled_org_ids",
  );
  if (error) return json({ error: "unavailable" }, 503);

  const map = evaluateAll((flags ?? []) as FlagRow[], { userId, role, orgId });
  return json({ flags: map, fetched_at: new Date().toISOString() });
});
