// OnStandard — Deep Dive transport (add-on build 2026-07-04).
//
// Calls the deep-analysis edge function with the athlete's bounded, deterministic payload
// (core/deepDive.buildDeepDivePayload) and returns the parsed result. The weekly cap and
// the paywall seam live SERVER-side; this maps their HTTP statuses to typed reasons so the
// UI can be honest: "already used this week" is not "something broke".
import { supabase } from '@/lib/supabase/client';
import { parseDeepDiveResult, type DeepDivePayload, type DeepDiveResult } from '@/core';

const supaUrl = process.env.EXPO_PUBLIC_SUPABASE_URL?.trim();
const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY?.trim();
const ENDPOINT = supaUrl ? `${supaUrl}/functions/v1/deep-analysis` : '';

export const isDeepDiveConfigured = Boolean(ENDPOINT && anonKey);

export type DeepDiveFailure = 'not_configured' | 'sign_in_required' | 'weekly_used' | 'requires_plan' | 'error';

export type DeepDiveResponse =
  | { kind: 'result'; result: DeepDiveResult }
  | { kind: 'unavailable'; reason: DeepDiveFailure };

export async function runDeepDive(payload: DeepDivePayload): Promise<DeepDiveResponse> {
  if (!isDeepDiveConfigured) return { kind: 'unavailable', reason: 'not_configured' };
  let token: string | undefined;
  try {
    token = (await supabase?.auth.getSession())?.data.session?.access_token;
  } catch {
    token = undefined;
  }
  if (!token) return { kind: 'unavailable', reason: 'sign_in_required' };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 45_000); // a deep dive is allowed to think
  try {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: anonKey ?? '', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ data: payload }),
      signal: controller.signal,
    });
    if (res.status === 429) return { kind: 'unavailable', reason: 'weekly_used' };
    if (res.status === 402) return { kind: 'unavailable', reason: 'requires_plan' };
    if (res.status === 401) return { kind: 'unavailable', reason: 'sign_in_required' };
    if (!res.ok) return { kind: 'unavailable', reason: 'error' };
    const parsed = parseDeepDiveResult(await res.json());
    return parsed ? { kind: 'result', result: parsed } : { kind: 'unavailable', reason: 'error' };
  } catch {
    return { kind: 'unavailable', reason: 'error' };
  } finally {
    clearTimeout(timer);
  }
}
