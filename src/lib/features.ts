// OnStandard — build/config-time feature flags (same pattern as isBackendLive).
//
// isEnginesEnabled is the SINGLE master switch for the two new engines:
//   - the Nutrition Intelligence Engine (Restaurant Coach), and
//   - the Accountability Engine surfaces (Plan-execution card + Coach Plan editor +
//     the per-meal "Plan check").
// It is OFF by default so the first closed beta can prove the CORE LOOP (log a meal ->
// the score moves) without the extra breadth. The founder/board flip it on by setting
// EXPO_PUBLIC_ENGINES_ENABLED=true (env only, no code change, then rebuild) — the same
// way EXPO_PUBLIC_BACKEND_LIVE works, and it doubles as an instant kill-switch.
//
// The engines themselves stay fully built + unit-tested either way; this gates only their
// UI entry points, so flipping it on reveals finished features rather than half-built ones.
export const isEnginesEnabled = process.env.EXPO_PUBLIC_ENGINES_ENABLED?.trim() === 'true';

// Master switch for the Meal Plans feature (structured prescribed meals + plan compliance).
// OFF by default so the prove-the-loop beta is untouched; flip with EXPO_PUBLIC_MEAL_PLANS_ENABLED=true.
export const isMealPlansEnabled = process.env.EXPO_PUBLIC_MEAL_PLANS_ENABLED?.trim() === 'true';

// Master switch for the Trust Pass (an earned, coach-granted camera-free reward whose daily
// one-tap credits the athlete's own proven nutrition baseline). OFF by default; gates the coach
// grant control + the athlete-facing pass UI. The scoring credit itself is DATA-gated (it only
// applies when an active pass exists in state), so flipping this off leaves scoring untouched.
// Server-authoritative pass state (Supabase RLS) + seeded-random spot-checks are the go-live
// upgrade (docs/council/2026-07-02-trust-pass.md); this pilot build keeps the pass client-side.
export const isTrustPassEnabled = process.env.EXPO_PUBLIC_TRUST_PASS_ENABLED?.trim() === 'true';
