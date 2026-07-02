// OnStandard — food-lookup client (barcode + name -> exact macros).
//
// Calls the food-lookup Edge Function (which holds the USDA key + caches results) and normalizes
// the response into an EditableFood for the normal saveMeal path. Fail-soft: returns null when
// unconfigured / offline / not found, so the caller falls back to a photo estimate or manual entry.
import { foodLookupToEditable, type EditableFood, type FoodLookupResult } from '@/core';
import { supabase } from '@/lib/supabase/client';

const explicit = process.env.EXPO_PUBLIC_FOOD_ENDPOINT?.trim();
const supaUrl = process.env.EXPO_PUBLIC_SUPABASE_URL?.trim();
const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY?.trim();

/** The food-lookup endpoint: an explicit override, or the Supabase Edge Function URL. */
export const FOOD_ENDPOINT = explicit || (supaUrl ? `${supaUrl}/functions/v1/food-lookup` : '');

/** True only when a real backend endpoint + auth key exist — gates every remote call. */
export const isFoodLookupConfigured = Boolean(FOOD_ENDPOINT && anonKey);

async function authHeaders(): Promise<Record<string, string>> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    apikey: anonKey ?? '',
    Authorization: `Bearer ${anonKey ?? ''}`,
  };
  try {
    const token = (await supabase?.auth.getSession())?.data.session?.access_token;
    if (token) headers.Authorization = `Bearer ${token}`;
  } catch {
    // keep the anon-key bearer
  }
  return headers;
}

async function lookup(body: { barcode?: string; query?: string }): Promise<EditableFood | null> {
  if (!isFoodLookupConfigured) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const res = await fetch(FOOD_ENDPOINT, {
      method: 'POST',
      headers: await authHeaders(),
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { found?: boolean } & Partial<FoodLookupResult>;
    if (!data?.found || !data.name || !data.per100) return null;
    return foodLookupToEditable({
      name: data.name,
      serving: data.serving ?? null,
      per100: data.per100,
      source: data.source ?? 'usda',
    });
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Look up a scanned barcode (Open Food Facts) -> EditableFood, or null. */
export function lookupBarcode(barcode: string): Promise<EditableFood | null> {
  const clean = barcode.replace(/\D/g, '');
  return clean ? lookup({ barcode: clean }) : Promise.resolve(null);
}

/** Search a food by name (USDA) -> best-match EditableFood, or null. */
export function searchFood(query: string): Promise<EditableFood | null> {
  const q = query.trim();
  return q ? lookup({ query: q }) : Promise.resolve(null);
}
