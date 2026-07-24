// OnStandard — authed-caller AI spend signal (capacity audit F1/F2, docs/scale/CAPACITY-AUDIT.md).
//
// THE BUG THIS FIXES: analyze-meal / assist / meal-chat / coach-voice-nudge each guarded EVERY
// caller (signed-in or anonymous) behind one fail-CLOSED daily counter sized for anon-abuse
// protection (a few thousand/day). At ~3 meals/athlete/day that binds around 5-6k registered
// users and returns 429 to every caller, including paying subscribers, until UTC midnight — a
// bill guard turning into a platform-wide outage.
//
// THE FIX: a signed-in caller is NEVER blocked by a bill guard — their own per-athlete daily cap
// (DAILY_ANALYSIS_CAP / ASSIST_USER_CAP / MEAL_CHAT_DAILY_CAP / VOICE_USER_CAP, unchanged) already
// bounds their personal spend. Instead, track them against ONE shared monthly counter across all
// four AI functions (keyed `tier_budget:<uid>`, reusing ai_usage_key_daily with a month-truncated
// `day` via claim_ai_usage_key_monthly, migration 0148) and raise a Command Center signal the
// first time a caller crosses 80% of the configured monthly ceiling. This is a SIGNAL, not a gate
// — it never denies the call. Sizing the ceiling to the paying tier's AI cost budget (and wiring a
// real-time page) is a follow-up once subscription tiers are live; today this only prevents
// silent, unbounded per-user cost growth from going unnoticed.
//
// The fail-CLOSED global/IP counters for ANONYMOUS callers (the public anon key) are UNCHANGED —
// they remain each function's own concern and are the correct backstop for that traffic.
import { createClient } from 'npm:@supabase/supabase-js@^2';

function posIntEnv(name: string, fallback: number): number {
  const n = Math.floor(Number(Deno.env.get(name) ?? String(fallback)));
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

// One shared monthly ceiling across analyze-meal + assist + meal-chat + coach-voice-nudge.
// [estimate] sized generously above the ~$1.30-$2.00/user/month blended cost projected in the
// capacity audit (§4, F11) so it fires only on genuine outliers until real tier pricing exists.
const TIER_MONTHLY_CAP = posIntEnv('AI_TIER_MONTHLY_CAP', 400);

// Best-effort, never throws, never blocks. Call after a call is already known to proceed (i.e.
// after the caller's own per-user cap has already allowed it) — this only records + signals.
export async function trackAuthedAiSpend(
  supabaseUrl: string | undefined,
  serviceRoleKey: string | undefined,
  userId: string,
  fn: string,
): Promise<void> {
  if (!supabaseUrl || !serviceRoleKey) return;
  try {
    const sb = createClient(supabaseUrl, serviceRoleKey);
    const { data, error } = await sb.rpc('claim_ai_usage_key_monthly', {
      p_key: `tier_budget:${userId}`,
      p_limit: TIER_MONTHLY_CAP,
    });
    if (error) return;
    const row = Array.isArray(data) ? data[0] : data;
    const used = Number(row?.used ?? 0);
    const threshold = Math.floor(TIER_MONTHLY_CAP * 0.8);
    // Fires exactly once per crossing (the call that takes `used` from below to at/above
    // threshold) rather than on every subsequent call, so it doesn't spam the audit log.
    if (used === threshold) {
      await sb.from('admin_audit_log').insert({
        actor_id: null,
        action: 'alert.ai_budget_authed',
        target_type: 'user',
        target_id: userId,
        after: { used, limit: TIER_MONTHLY_CAP, fn },
      });
    }
  } catch {
    // Never let a telemetry hiccup affect the caller.
  }
}
