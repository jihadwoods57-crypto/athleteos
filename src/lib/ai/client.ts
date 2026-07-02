// OnStandard — real AI meal-analysis client (inert until a backend endpoint exists).
//
// The API key NEVER lives in the app bundle. The app calls a backend Edge Function
// (supabase/functions/analyze-meal) that holds ANTHROPIC_API_KEY and calls Claude
// (vision) server-side. With no endpoint configured, `isAiConfigured` is false and
// the app falls back to the deterministic analysis (mealResultFor) so it runs exactly
// as today. Set EXPO_PUBLIC_AI_ENDPOINT (or EXPO_PUBLIC_SUPABASE_URL, from which the
// function URL is derived) + EXPO_PUBLIC_SUPABASE_ANON_KEY to light it up.
import type { LabelFacts, MealLabel, MealResult, MemoryInsight, RephrasedInsight, RephrasedOrder } from '@/core';
import { supabase } from '@/lib/supabase/client';

const explicit = process.env.EXPO_PUBLIC_AI_ENDPOINT?.trim();
const supaUrl = process.env.EXPO_PUBLIC_SUPABASE_URL?.trim();
const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY?.trim();

/** The analyze-meal endpoint: an explicit override, or the Supabase Edge Function URL. */
export const AI_ENDPOINT = explicit || (supaUrl ? `${supaUrl}/functions/v1/analyze-meal` : '');

/** True only when a real backend endpoint + auth key exist — gates every remote call. */
export const isAiConfigured = Boolean(AI_ENDPOINT && anonKey);

/**
 * Headers for a call to the Edge Function. Sends the signed-in athlete's session token as the
 * bearer when a session exists, so the function can identify the athlete and apply the
 * per-athlete daily cap; falls back to the shared anon key otherwise (preview / not signed in),
 * which the function treats as anonymous and leaves uncapped. `apikey` is always the anon key
 * (the Supabase gateway identifies the project from it). The key never leaves the backend — this
 * only forwards the user's own token.
 */
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
    // no session available — keep the anon-key bearer (call runs uncapped, as today)
  }
  return headers;
}

/** One clarifying question the model asked and the athlete's answer, sent back on 'finalize'. */
export interface Clarification {
  question: string;
  answer: string;
}

export interface AnalyzeMealRequest {
  /** Meal slot the athlete tagged (Breakfast/Lunch/Snack/Dinner). */
  mealType: MealLabel;
  /** Athlete's primary goal key (drives goal-aligned coaching). */
  goal: string | null;
  /** Optional free-text description for better accuracy. */
  description?: string;
  /** Base64-encoded JPEG of the meal photo (no data: prefix), when available. */
  photoBase64?: string;
  /** 'analyze' (default) may return clarifying questions; 'finalize' folds in answers and reports. */
  phase?: 'analyze' | 'finalize';
  /** For 'finalize': the questions already asked and the athlete's answers. */
  clarifications?: Clarification[];
  /** The active plan slot's macro target for this meal (Meal Plans feature), when the athlete has one. */
  slotTarget?: { kcal: number; protein: number };
}

/**
 * The backend's meal response: either the finished analysis, or 1-3 clarifying questions the
 * athlete should answer before the estimate is finalized. The app branches on `kind`.
 */
export type MealRemoteResponse =
  | { kind: 'result'; result: MealResult }
  | { kind: 'questions'; questions: string[] };

/**
 * Call the backend to analyze a meal photo with Claude vision. Returns EITHER the finished
 * MealResult (the UI's normal shape) OR up to three clarifying questions when the model needs
 * more to nail the macros. Throws on transport/HTTP error (callers fall back to the deterministic
 * result). 20s timeout. Pass `phase: 'finalize'` + `clarifications` to force a result after the
 * athlete has answered.
 */
export async function analyzeMealRemote(req: AnalyzeMealRequest): Promise<MealRemoteResponse> {
  if (!isAiConfigured) throw new Error('AI endpoint not configured');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    const res = await fetch(AI_ENDPOINT, {
      method: 'POST',
      headers: await authHeaders(),
      body: JSON.stringify({ mode: 'meal', ...req }),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`analyze-meal HTTP ${res.status}`);
    const data = (await res.json()) as { kind?: string; questions?: unknown } & Record<string, unknown>;
    if (data?.kind === 'questions') {
      const questions = Array.isArray(data.questions)
        ? data.questions.filter((q): q is string => typeof q === 'string').slice(0, 3)
        : [];
      if (questions.length === 0) throw new Error('analyze-meal returned no questions');
      return { kind: 'questions', questions };
    }
    // 'result' (or a legacy bare object): the meal fields sit at the top level next to `kind`.
    const { kind: _kind, questions: _questions, ...result } = data;
    return { kind: 'result', result: result as unknown as MealResult };
  } finally {
    clearTimeout(timer);
  }
}

export interface AnalyzeLabelRequest {
  /** Base64-encoded JPEG of the Nutrition Facts label (no data: prefix). */
  photoBase64?: string;
}

/**
 * Transcribe a Nutrition Facts label with Claude vision via the SAME backend Edge Function
 * (mode: 'label' tells it to read the panel rather than estimate a plate). Returns the
 * printed facts verbatim — the label is ground truth, so this is transcription, not
 * estimation. Throws on transport/HTTP error (callers fall back to the deterministic
 * sample). 20s timeout, key stays server-side.
 */
export async function analyzeLabelRemote(req: AnalyzeLabelRequest): Promise<LabelFacts> {
  if (!isAiConfigured) throw new Error('AI endpoint not configured');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    const res = await fetch(AI_ENDPOINT, {
      method: 'POST',
      headers: await authHeaders(),
      body: JSON.stringify({ mode: 'label', ...req }),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`analyze-label HTTP ${res.status}`);
    const data = (await res.json()) as LabelFacts;
    return data;
  } finally {
    clearTimeout(timer);
  }
}

export interface RephraseMemoryRequest {
  /** The deterministic insights to reword. The model sees them but may only touch the prose. */
  insights: Pick<MemoryInsight, 'id' | 'kind' | 'tone' | 'headline' | 'detail' | 'metric'>[];
}

/**
 * Ask the model to rephrase the memory insights in a warmer coach voice via the SAME backend
 * Edge Function (mode: 'memory'). It returns prose only — {id, headline, detail} per insight —
 * which the caller runs through the core voice guard (mergeRephrasedInsights) so the numbers and
 * everything non-prose stay exactly the engine's. Throws on transport/HTTP error (callers fall
 * back to the deterministic insights). 20s timeout, key stays server-side.
 */
export async function rephraseMemoryRemote(req: RephraseMemoryRequest): Promise<RephrasedInsight[]> {
  if (!isAiConfigured) throw new Error('AI endpoint not configured');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    const res = await fetch(AI_ENDPOINT, {
      method: 'POST',
      headers: await authHeaders(),
      body: JSON.stringify({ mode: 'memory', ...req }),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`rephrase-memory HTTP ${res.status}`);
    const data = (await res.json()) as { insights?: RephrasedInsight[] };
    return Array.isArray(data?.insights) ? data.insights : [];
  } finally {
    clearTimeout(timer);
  }
}

export interface RephraseOrdersRequest {
  /** The recommended orders to reword, keyed ('primary' / alt label). Prose only is returned. */
  orders: RephrasedOrder[];
}

/**
 * Ask the model to reword the Restaurant Coach order explanations in a warmer voice via the SAME
 * backend Edge Function (mode: 'order'). It returns prose only — {id, why} per order — which the
 * caller runs through the core voice guard (mergeRephrasedOrders) so every macro/price number and
 * the item lines stay exactly the engine's. Throws on transport/HTTP error (callers fall back to
 * the deterministic orders). 20s timeout, key stays server-side.
 */
export async function rephraseOrdersRemote(req: RephraseOrdersRequest): Promise<RephrasedOrder[]> {
  if (!isAiConfigured) throw new Error('AI endpoint not configured');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    const res = await fetch(AI_ENDPOINT, {
      method: 'POST',
      headers: await authHeaders(),
      body: JSON.stringify({ mode: 'order', ...req }),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`rephrase-order HTTP ${res.status}`);
    const data = (await res.json()) as { orders?: RephrasedOrder[] };
    return Array.isArray(data?.orders) ? data.orders : [];
  } finally {
    clearTimeout(timer);
  }
}
