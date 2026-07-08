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

/** The edge response: a best-match (top-level fields) plus, for name search, a ranked results list. */
type LookupResponse = { found?: boolean; results?: unknown } & Partial<FoodLookupResult>;

/** The request never reached a working endpoint (offline, CORS, timeout, 5xx). Distinct from
 *  "the database had no match" so the search UI can tell the athlete the truth about which
 *  one happened instead of blaming their search terms (the audit's error-honesty P0). */
export class FoodLookupTransportError extends Error {
  constructor() {
    super('food-lookup request failed');
    this.name = 'FoodLookupTransportError';
  }
}

/** POST to the food-lookup edge function; returns the parsed body, or null when unconfigured /
 *  offline / non-OK. Fail-soft by default so one-tap callers degrade to a photo estimate;
 *  `throwOnTransport` opts the ranked-search path into an honest failure instead. */
async function postLookup(
  body: { barcode?: string; query?: string },
  opts: { throwOnTransport?: boolean } = {},
): Promise<LookupResponse | null> {
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
    if (!res.ok) {
      if (opts.throwOnTransport) throw new FoodLookupTransportError();
      return null;
    }
    return (await res.json()) as LookupResponse;
  } catch (e) {
    if (opts.throwOnTransport) throw e instanceof FoodLookupTransportError ? e : new FoodLookupTransportError();
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** A lookup row is usable only with a name and per-100g macros. */
function toResult(row: Partial<FoodLookupResult> | null | undefined): FoodLookupResult | null {
  if (!row || !row.name || !row.per100) return null;
  return { name: row.name, serving: row.serving ?? null, per100: row.per100, source: row.source ?? 'usda' };
}

async function lookupBest(body: { barcode?: string; query?: string }): Promise<EditableFood | null> {
  const data = await postLookup(body);
  if (!data?.found) return null;
  const best = toResult(data);
  return best ? foodLookupToEditable(best) : null;
}

/** Look up a scanned barcode (Open Food Facts) -> EditableFood, or null. */
export function lookupBarcode(barcode: string): Promise<EditableFood | null> {
  const clean = barcode.replace(/\D/g, '');
  return clean ? lookupBest({ barcode: clean }) : Promise.resolve(null);
}

/** Search a food by name (USDA) -> best-match EditableFood, or null (the one-tap auto-pick path). */
export function searchFood(query: string): Promise<EditableFood | null> {
  const q = query.trim();
  return q ? lookupBest({ query: q }) : Promise.resolve(null);
}

/** Search a food by name (USDA) -> the ranked list of candidates for the athlete to pick from.
 *  Returns [] when unconfigured / offline / nothing found. Falls back to the single best-match when
 *  an older edge deploy returns no results[] array. */
export async function searchFoods(query: string): Promise<FoodLookupResult[]> {
  const q = query.trim();
  if (!q) return [];
  // Throws FoodLookupTransportError when the request itself fails, so the UI can
  // say "connection problem" instead of the lie "no matches, try a simpler name".
  const data = await postLookup({ query: q }, { throwOnTransport: true });
  if (!data?.found) return [];
  const rows = Array.isArray(data.results) ? (data.results as Array<Partial<FoodLookupResult>>) : [];
  const list = rows.length ? rows : [data];
  return list.map(toResult).filter((r): r is FoodLookupResult => r !== null);
}
