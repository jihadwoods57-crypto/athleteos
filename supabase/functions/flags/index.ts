// OnStandard — per-caller feature-flag projection. Evaluates ALL flags for the authenticated
// caller server-side and returns ONLY a { name: boolean } map. Raw config/allowlists never
// leave the server, so "who is in beta" cannot leak. See _shared/feature-flags.ts for the rule.
//
// Deploy (founder): supabase functions deploy flags   (URL + SERVICE_ROLE auto-injected).
// Then set EXPO_PUBLIC_FLAGS_URL to this function's URL and ship an app build — until then the
// client seam is inert and every flag resolves to its compile-time default.
import { createClient } from "npm:@supabase/supabase-js@2.110.0";
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
      // NOT profiles.primary_role. That column is SELF-WRITABLE — 0047 seeds it from
      // raw_user_meta_data at signup (user-supplied) and the profiles_self_write policy (0002)
      // permits updating any column on your own row with no column-level grant restricting it.
      // Using it here let anyone flip themselves to 'coach' and self-enable any flag rolled out
      // by role. It grants no DATA access (primary_role appears in no RLS policy and no admin
      // gate — it only drives app-flow routing), which is why this is a targeting bug and not a
      // privilege escalation, but a targeting key still must not be attacker-set.
      //
      // Derive it from a link the user cannot fabricate instead: an ACTIVE team_staff row, or
      // ownership of a practice. Both are created only through gated RPCs.
      // (Security audit 2026-07-30, finding #12.)
      const [{ data: staff }, { data: prac }] = await Promise.all([
        sb.from("team_staff").select("staff_id")
          .eq("staff_id", userId).eq("status", "active").limit(1).maybeSingle(),
        sb.from("practices").select("id").eq("owner_id", userId).limit(1).maybeSingle(),
      ]);
      role = staff ? "coach" : prac ? "trainer" : "athlete";
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
