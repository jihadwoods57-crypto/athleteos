// OnStandard — the dollar-denominated brake on paid AI calls.
//
// Every other guard in this codebase counts CALLS: per-athlete daily caps, per-IP caps, a global
// per-day backstop. A call count is not the unit the Anthropic bill is denominated in — a price
// change or a shift to a costlier path moves the real exposure without moving any counter. This
// helper is the one gate expressed in money.
//
// Backed by public.ai_spend_gate (migration 0152) over the cost data 0105 already computes.
// Two ways it says no:
//
//   kill_switch  an operator flipped app_config.ai_kill_switch during an incident
//   daily_cap    today's spend + this call's estimate exceeds ai_daily_hard_cap_usd
//
// FAIL-CLOSED, deliberately. This is the last line of defence on real money, so a missing service
// key or a broken RPC must not silently disable it — that is exactly how a spend guard becomes
// decorative. The precedent is the global backstop in analyze-meal (audit 2026-07-11 P2).
//
// It applies to EVERY caller, signed-in included. That is the difference between this and the
// call-count caps, which deliberately exempt signed-in athletes so a paying user is never denied
// their own meal log. A dollar ceiling cannot make that exemption: if the bill is genuinely at the
// wall, continuing to spend is not a kindness to anyone. The cap should therefore be set high
// enough that it only ever fires on abuse or a runaway loop — never on a normal day.

import { createClient } from 'npm:@supabase/supabase-js@2.110.0';

export type SpendVerdict = {
  allowed: boolean;
  reason: 'ok' | 'kill_switch' | 'daily_cap' | 'unavailable';
  spentUsd: number;
  capUsd: number;
};

/** A rough per-call cost so the gate can refuse the call that would CROSS the line, not the one
 *  after it. Deliberately coarse — the authoritative number is computed in SQL after the fact. */
export const EST_USD = {
  vision: 0.03,   // a photo analysis
  text: 0.005,    // chat / prose
} as const;

/**
 * Ask whether a paid AI call may proceed.
 *
 * Returns `allowed: false` on ANY failure to reach the gate, including a missing service key.
 * Callers should surface an honest, non-alarming message and a retry — never a silent failure.
 */
export async function checkSpend(estimatedUsd: number = EST_USD.vision): Promise<SpendVerdict> {
  const url = Deno.env.get('SUPABASE_URL');
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !key) {
    return { allowed: false, reason: 'unavailable', spentUsd: 0, capUsd: 0 };
  }
  try {
    const sb = createClient(url, key);
    const { data, error } = await sb.rpc('ai_spend_gate', { p_estimated_usd: estimatedUsd });
    if (error || !data) return { allowed: false, reason: 'unavailable', spentUsd: 0, capUsd: 0 };
    const row = (Array.isArray(data) ? data[0] : data) as Record<string, unknown>;
    return {
      allowed: row?.allowed === true,
      reason: (row?.reason as SpendVerdict['reason']) ?? 'unavailable',
      spentUsd: Number(row?.spent_usd ?? 0),
      capUsd: Number(row?.cap_usd ?? 0),
    };
  } catch {
    return { allowed: false, reason: 'unavailable', spentUsd: 0, capUsd: 0 };
  }
}

/** The message an athlete should see. Never exposes the spend figure or the cap — that is
 *  operator data, and "we spent $50 today" is not an answer to "why didn't my meal log?". */
export function spendMessage(v: SpendVerdict): string {
  return v.reason === 'kill_switch'
    ? 'Meal analysis is paused for maintenance. Your photo is saved — try again shortly.'
    : 'Meal analysis is at capacity right now. Your photo is saved — try again shortly.';
}
