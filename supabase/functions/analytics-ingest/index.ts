// OnStandard — anonymous activation/funnel event ingest (Supabase / Deno).
//
// Receives a batch of anonymous events from the app and appends them to `analytics_events`
// (migration 0052) via the service role. Complements 0037's retroactive loop analytics with the
// funnel/drop-off signals days/meals can't see (onboarding steps, meal-analysis failures, the
// age gate). NO auth required — the most valuable events (onboarding drop-off) happen before an
// account exists, so callers use the public anon key.
//
// TRUST NOTHING FROM THE CLIENT (defense in depth — the client already redacts, this re-does it):
//   - event NAME must be in a fixed server-side whitelist (unknown names dropped);
//   - session_id must be a short opaque token (no PII shape);
//   - props are re-filtered to numbers / booleans / short enum strings — a name/email/free-text
//     note is structurally unstorable, so a row can never carry PII even if the client is modified;
//   - batch size, per-event size, and a per-IP rate limit bound abuse of the public endpoint.
//
// Deploy (founder): supabase functions deploy analytics-ingest
//   (SERVICE_ROLE + URL are auto-injected). Then set EXPO_PUBLIC_ANALYTICS_URL to this function's
//   URL and ship an app build — until then the client seam is inert and this never receives calls.
import { createClient } from "npm:@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });

// The server-side event vocabulary — MUST stay in sync with proto analytics.js EVENTS.
const ALLOWED = new Set([
  "app_open", "onboarding_started", "onboarding_role", "goal_selected", "age_blocked",
  "onboarding_completed", "meal_logged", "meal_analysis_failed", "commitment_set",
  "recovery_submitted", "checkin_submitted", "weight_logged", "coach_connected",
  "code_join_failed", "app_error",
  // Paywall funnel (2026-07-21) — surface events; must match proto analytics.js EVENTS.
  "paywall_viewed", "plan_selected", "trial_started",
  // Deterministic-scoring cutover (2026-07-21) — AI-vs-app score delta + tone-conflict signals.
  "meal_score_delta", "meal_text_conflict",
]);
const ENUM_RE = /^[a-z0-9_.:-]{1,24}$/;
const SID_RE = /^[a-z0-9_.:-]{1,64}$/i;

// Re-filter props to counts/enums only (the PII firewall, server side).
function cleanProps(p: unknown): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (!p || typeof p !== "object") return out;
  let n = 0;
  for (const k of Object.keys(p as Record<string, unknown>)) {
    if (n >= 6) break;
    if (!/^[a-z][a-z0-9_]{0,19}$/.test(k)) continue;
    const v = (p as Record<string, unknown>)[k];
    if (typeof v === "number" && Number.isFinite(v)) { out[k] = v; n++; }
    else if (typeof v === "boolean") { out[k] = v; n++; }
    else if (typeof v === "string" && ENUM_RE.test(v)) { out[k] = v; n++; }
  }
  return out;
}

// Per-isolate sliding window: bounds abuse of the public endpoint. Not perfect (isolates recycle);
// the batch cap + validation are the real controls.
const hits = new Map<string, { n: number; t: number }>();
function limited(ip: string, max = 120, windowMs = 60_000): boolean {
  const now = Date.now();
  const h = hits.get(ip);
  if (!h || now - h.t > windowMs) { hits.set(ip, { n: 1, t: now }); return false; }
  h.n++;
  return h.n > max;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "bad_request" }, 400);
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  if (limited(ip)) return json({ error: "rate_limited" }, 429);

  const body = await req.json().catch(() => null) as { events?: unknown } | null;
  const raw = body && Array.isArray(body.events) ? body.events : null;
  if (!raw) return json({ error: "bad_request" }, 400);

  const now = new Date().toISOString();
  const rows: Array<Record<string, unknown>> = [];
  for (const e of raw.slice(0, 100)) { // hard batch cap
    if (!e || typeof e !== "object") continue;
    const ev = e as Record<string, unknown>;
    const name = typeof ev.n === "string" ? ev.n : "";
    const sid = typeof ev.s === "string" ? ev.s : "";
    if (!ALLOWED.has(name) || !SID_RE.test(sid)) continue;
    const occurred = typeof ev.t === "number" && Number.isFinite(ev.t)
      ? new Date(Math.max(0, Math.min(ev.t, Date.now() + 60_000))).toISOString() : null;
    rows.push({ session_id: sid, name, props: cleanProps(ev.p), occurred_at: occurred, created_at: now });
  }
  if (!rows.length) return json({ ok: true, accepted: 0 });

  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) return json({ error: "unavailable" }, 503);
  try {
    const sb = createClient(url, key);
    const { error } = await sb.from("analytics_events").insert(rows);
    if (error) return json({ error: "unavailable" }, 503);
    return json({ ok: true, accepted: rows.length });
  } catch {
    return json({ error: "unavailable" }, 503);
  }
});
