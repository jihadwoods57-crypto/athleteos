// OnStandard — daily Command Center heartbeat. Invoked by pg_cron (schedule_admin_brief, 0113) with
// the shared x-brief-key. Writes ONE lightweight snapshot row into admin_brief_snapshots so the
// dashboard's trend timeline + "since your last visit" diff stay complete even on days the founder
// never opens it. Read-only over the data; the only write is its own snapshot. Service role (RLS
// bypass) — the rich per-load snapshots come from the gated dashboard RPC, this is the daily anchor.
//
// Deploy (founder): supabase functions deploy admin-brief
//   supabase secrets set BRIEF_CRON_KEY=<random>
//   then (once) call schedule_admin_brief('<fn-url>', '<BRIEF_CRON_KEY>') via db query.
import { createClient } from "npm:@supabase/supabase-js@2.110.0";

/** Constant-time compare of the shared cron key — mirrors ai-followup / weekly-digest / winback.
 *  (Security audit 2026-07-30, finding #13: this was one of four still using `!==`.) */
function safeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const ab = enc.encode(a);
  const bb = enc.encode(b);
  if (ab.length !== bb.length) return false;
  let diff = 0;
  for (let i = 0; i < ab.length; i++) diff |= ab[i] ^ bb[i];
  return diff === 0;
}

Deno.serve(async (req) => {
  // Cron-only: reject anything without the shared secret. Not a browser surface, so no CORS.
  const key = req.headers.get("x-brief-key") || "";
  const expected = Deno.env.get("BRIEF_CRON_KEY") || "";
  if (!expected || !safeEqual(key, expected)) return new Response("forbidden", { status: 403 });

  const url = Deno.env.get("SUPABASE_URL");
  const svc = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !svc) return new Response("unavailable", { status: 503 });
  const sb = createClient(url, svc);

  const today = new Date().toISOString().slice(0, 10);
  const count = async (table: string, col: string, val: string) => {
    const { count: c } = await sb.from(table).select("*", { count: "exact", head: true }).eq(col, val);
    return c ?? 0;
  };

  try {
    // Each athlete has at most one `days` row per date, so a count of today's rows = athletes active today.
    const activeToday = await count("days", "date", today);
    const mealsToday = await count("meals", "day_date", today);
    const { count: subs } = await sb.from("subscriptions").select("*", { count: "exact", head: true }).eq("status", "active");
    const { data: cpm } = await sb.from("ai_cost_per_meal").select("cost_per_meal_usd").eq("day", today).maybeSingle();

    /* AI HEALTH (2026-09-21). ai_calls has carried a per-call `outcome` since July and nothing
       ever read it, so the meal reader's real failure rate sat unwatched for two months. Measured
       when someone finally looked: of 299 genuine analyses, 46 (15%) failed outright and 115 of
       the 253 that SUCCEEDED (45%) had their stated totals silently rewritten by repair. Both
       numbers are the kind that should arrive, not be discovered.

       THE DENOMINATOR IS THE TRAP. recordAiCall writes a SECOND, synthetic row for each repair
       (latency_ms = 0, no API call behind it), so counting rows overstates traffic and understates
       every rate against it. Real calls only: latency_ms > 0. Getting this wrong is what made the
       first read of this data say 27% when the answer was 45%. */
    const { data: aiRows } = await sb
      .from("ai_calls")
      .select("ok, outcome, latency_ms")
      .gte("created_at", `${today}T00:00:00Z`)
      .eq("fn", "analyze-meal");
    const rows = aiRows ?? [];
    const real = rows.filter((r) => Number(r.latency_ms) > 0);
    const repairs = rows.filter((r) => Number(r.latency_ms) === 0
      && typeof r.outcome === "string" && r.outcome.startsWith("verify_repair:"));
    const failed = real.filter((r) => r.ok === false
      || (typeof r.outcome === "string" && /^(invalid_tool_input|truncated|Error:)|still_empty$/.test(r.outcome)));
    const pct = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 1000) / 10 : null);

    const { error } = await sb.from("admin_brief_snapshots").insert({
      source: "cron",
      active_today: activeToday,
      meals_today: mealsToday,
      subs: subs ?? 0,
      cost_per_meal: cpm?.cost_per_meal_usd ?? null,
      metrics: {
        ai_meal: {
          calls: real.length,                              // real API calls, synthetic rows excluded
          failed: failed.length,
          failed_pct: pct(failed.length, real.length),     // an athlete who photographed and got nothing
          repaired: repairs.length,
          repaired_pct: pct(repairs.length, real.length - failed.length),  // of the reads that WORKED
        },
      },
    });
    // Opaque to the caller, detailed in the logs — the convention every other function here
    // follows. (Security audit 2026-07-30, finding #14: this one returned error.message and
    // String(e) straight to the requester, leaking table/column names and stack detail.)
    if (error) {
      console.error("admin-brief: snapshot insert failed:", error);
      return new Response(JSON.stringify({ error: "unavailable" }), { status: 500 });
    }
    return new Response(JSON.stringify({ ok: true, active_today: activeToday, meals_today: mealsToday }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("admin-brief: unhandled error:", e);
    return new Response(JSON.stringify({ error: "unavailable" }), { status: 500 });
  }
});
