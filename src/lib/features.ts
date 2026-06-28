// AthleteOS — build/config-time feature flags (same pattern as isBackendLive).
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
