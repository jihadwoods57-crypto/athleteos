// OnStandard — daily Command Center heartbeat. Invoked by pg_cron (schedule_admin_brief, 0113) with
// the shared x-brief-key. Writes ONE lightweight snapshot row into admin_brief_snapshots so the
// dashboard's trend timeline + "since your last visit" diff stay complete even on days the founder
// never opens it. Read-only over the data; the only write is its own snapshot. Service role (RLS
// bypass) — the rich per-load snapshots come from the gated dashboard RPC, this is the daily anchor.
//
// Deploy (founder): supabase functions deploy admin-brief
//   supabase secrets set BRIEF_CRON_KEY=<random>
//   then (once) call schedule_admin_brief('<fn-url>', '<BRIEF_CRON_KEY>') via db query.
import { createClient } from "npm:@supabase/supabase-js@2";

Deno.serve(async (req) => {
  // Cron-only: reject anything without the shared secret. Not a browser surface, so no CORS.
  const key = req.headers.get("x-brief-key") || "";
  const expected = Deno.env.get("BRIEF_CRON_KEY") || "";
  if (!expected || key !== expected) return new Response("forbidden", { status: 403 });

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

    const { error } = await sb.from("admin_brief_snapshots").insert({
      source: "cron",
      active_today: activeToday,
      meals_today: mealsToday,
      subs: subs ?? 0,
      cost_per_meal: cpm?.cost_per_meal_usd ?? null,
    });
    if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500 });
    return new Response(JSON.stringify({ ok: true, active_today: activeToday, meals_today: mealsToday }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500 });
  }
});
