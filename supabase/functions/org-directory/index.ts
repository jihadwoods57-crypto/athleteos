// OnStandard — anonymous directory for pre-account onboarding (spec 2026-07-09 §4).
// The athlete has no session at step 2, and search_orgs/find_org/discover_teams require
// auth.uid() — so this function fronts the SAME safe display columns with the service role,
// guarded by a per-IP rate limit. It never returns created_by or a join_code: knowing a code
// is the only capability, and preview only confirms a code the caller already has.
import { createClient } from "npm:@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

// Per-isolate sliding window: 30 requests/min/IP. Best-effort (isolates recycle) — the goal is
// stopping scripted enumeration, not perfect accounting. Same spirit as claim_ai_usage_key.
const hits = new Map<string, { n: number; t: number }>();
function limited(ip: string, max = 30, windowMs = 60_000): boolean {
  const now = Date.now();
  const h = hits.get(ip);
  if (!h || now - h.t > windowMs) { hits.set(ip, { n: 1, t: now }); return false; }
  h.n++;
  return h.n > max;
}
// strip characters that would let user input escape a PostgREST or() filter
const clean = (s: unknown) => String(s ?? "").replace(/[,()]/g, " ").trim();

// Durable per-IP/day ceiling on code previews (enumeration guard; see preview_code below).
const PREVIEW_IP_DAY_CAP = Math.max(1, Math.floor(Number(Deno.env.get("PREVIEW_CODE_IP_DAY_CAP") ?? "150")) || 150);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    if (req.method !== "POST") return json({ error: "bad_request" }, 400);
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
    if (limited(ip)) return json({ error: "rate_limited" }, 429);

    const body = await req.json().catch(() => null);
    if (!body || typeof body.op !== "string") return json({ error: "bad_request" }, 400);
    const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    if (body.op === "search") {
      const q = clean(body.q);
      if (q.length < 2) return json({ orgs: [] });
      const { data: orgs, error } = await sb.from("orgs")
        .select("id,name,type,city,state").ilike("name", `%${q}%`).order("name").limit(20);
      if (error) return json({ error: "bad_request" }, 400);
      const ids = (orgs ?? []).map((o) => o.id);
      const counts: Record<string, number> = {};
      if (ids.length) {
        const { data: teams } = await sb.from("teams")
          .select("org_id").in("org_id", ids).eq("discoverable", true);
        for (const t of teams ?? []) counts[t.org_id] = (counts[t.org_id] || 0) + 1;
      }
      return json({ orgs: (orgs ?? []).map((o) => ({ ...o, teams: counts[o.id] || 0 })) });
    }

    if (body.op === "teams") {
      if (typeof body.org !== "string" || !body.org) return json({ error: "bad_request" }, 400);
      const { data, error } = await sb.rpc("discover_teams", { org: body.org });
      if (error) return json({ error: "bad_request" }, 400);
      return json({ teams: data ?? [] });
    }

    if (body.op === "practices") {
      const q = clean(body.q);
      if (q.length < 2) return json({ practices: [] });
      const { data: rows, error } = await sb.from("practices")
        .select("id,name,handle,owner_id").eq("discoverable", true)
        .or(`name.ilike.%${q}%,handle.ilike.%${q}%`).limit(20);
      if (error) return json({ error: "bad_request" }, 400);
      const owners = [...new Set((rows ?? []).map((r) => r.owner_id))];
      const names: Record<string, string> = {};
      if (owners.length) {
        const { data: profs } = await sb.from("profiles").select("id,full_name").in("id", owners);
        for (const p of profs ?? []) names[p.id] = p.full_name;
      }
      return json({
        practices: (rows ?? []).map((r) => ({
          id: r.id, name: r.name, handle: r.handle, trainer_name: names[r.owner_id] || null,
        })),
      });
    }

    if (body.op === "preview_code") {
      const code = String(body.code ?? "").trim().toUpperCase();
      if (!/^[A-Z0-9]{4,12}$/.test(code)) return json({ match: null });
      // Enumeration guard (audit 2026-07-11): the per-minute limiter above is per-isolate and
      // trusts x-forwarded-for, so sustained code-guessing (which harvests coach names + school
      // affiliations) needs a DURABLE ceiling. Reuse the DB-backed keyed day counter (0030,
      // service-role-only). The cap is ~30x what a legitimate onboarding ever previews.
      // Fail-open on a counter hiccup — the per-minute limiter still applies, and a real
      // athlete's join must never break on an infra blip.
      try {
        const { data: claim, error: claimErr } = await sb.rpc("claim_ai_usage_key", {
          p_key: `preview:${ip}`, p_limit: PREVIEW_IP_DAY_CAP,
        });
        const row = Array.isArray(claim) ? claim[0] : claim;
        if (!claimErr && row?.allowed === false) return json({ error: "rate_limited" }, 429);
      } catch { /* fail-open — see above */ }
      const { data: team, error: teamErr } = await sb.rpc("resolve_team_code", { code });
      if (teamErr) return json({ error: "unavailable" }, 503);
      if (team && team.length) {
        const t = team[0];
        return json({ match: { kind: "team", id: t.id, name: t.name, sport: t.sport, coach_name: t.coach_name, school: t.school } });
      }
      const { data: prac, error: pracErr } = await sb.rpc("resolve_practice_code", { code });
      if (pracErr) return json({ error: "unavailable" }, 503);
      if (prac && prac.length) {
        const p = prac[0];
        return json({ match: { kind: "practice", id: p.id, name: p.name, trainer_name: p.trainer_name } });
      }
      return json({ match: null });
    }

    return json({ error: "bad_request" }, 400);
  } catch {
    return json({ error: "unavailable" }, 503);
  }
});
