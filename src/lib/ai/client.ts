// AthleteOS — real AI meal-analysis client (inert until a backend endpoint exists).
//
// The API key NEVER lives in the app bundle. The app calls a backend Edge Function
// (supabase/functions/analyze-meal) that holds ANTHROPIC_API_KEY and calls Claude
// (vision) server-side. With no endpoint configured, `isAiConfigured` is false and
// the app falls back to the deterministic analysis (mealResultFor) so it runs exactly
// as today. Set EXPO_PUBLIC_AI_ENDPOINT (or EXPO_PUBLIC_SUPABASE_URL, from which the
// function URL is derived) + EXPO_PUBLIC_SUPABASE_ANON_KEY to light it up.
import type { LabelFacts, MealLabel, MealResult } from '@/core';

const explicit = process.env.EXPO_PUBLIC_AI_ENDPOINT?.trim();
const supaUrl = process.env.EXPO_PUBLIC_SUPABASE_URL?.trim();
const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY?.trim();

/** The analyze-meal endpoint: an explicit override, or the Supabase Edge Function URL. */
export const AI_ENDPOINT = explicit || (supaUrl ? `${supaUrl}/functions/v1/analyze-meal` : '');

/** True only when a real backend endpoint + auth key exist — gates every remote call. */
export const isAiConfigured = Boolean(AI_ENDPOINT && anonKey);

export interface AnalyzeMealRequest {
  /** Meal slot the athlete tagged (Breakfast/Lunch/Snack/Dinner). */
  mealType: MealLabel;
  /** Athlete's primary goal key (drives goal-aligned coaching). */
  goal: string | null;
  /** Optional free-text description for better accuracy. */
  description?: string;
  /** Base64-encoded JPEG of the meal photo (no data: prefix), when available. */
  photoBase64?: string;
}

/**
 * Call the backend to analyze a meal photo with Claude vision. Returns the same
 * MealResult shape the UI already renders, so the screen is identical whether the
 * analysis is real or the deterministic fallback. Throws on transport/HTTP error
 * (callers fall back to the deterministic result). 20s timeout.
 */
export async function analyzeMealRemote(req: AnalyzeMealRequest): Promise<MealResult> {
  if (!isAiConfigured) throw new Error('AI endpoint not configured');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    const res = await fetch(AI_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${anonKey}`,
      },
      body: JSON.stringify(req),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`analyze-meal HTTP ${res.status}`);
    const data = (await res.json()) as MealResult;
    return data;
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
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${anonKey}`,
      },
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
