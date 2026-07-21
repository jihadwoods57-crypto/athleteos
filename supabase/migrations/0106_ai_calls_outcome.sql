-- 0106_ai_calls_outcome.sql — records whether a paid AI call changed anything.
-- Used by the meal verifier (mode='verify') to prove the second call earns its keep:
-- 'no_change' | 'macros_moved' | 'allergen_caught'. Nullable; null for every non-verify call.
-- Idempotent (add-column-if-not-exists) — safe to re-run via a later `supabase db push`.
alter table public.ai_calls add column if not exists outcome text;
