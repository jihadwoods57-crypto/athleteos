-- OnStandard — persist fiber on meals rows (conversation upgrade follow-through 2026-07-16).
-- The AI already estimates fiber per meal; it rode only the day jsonb, so meal HISTORY had no
-- fiber and the "produce below target in recent meals" pattern was honestly uncomputable.
-- Additive + idempotent; rows logged before this stay null (the pattern skips null rows —
-- history unlocks as new meals accumulate, never fabricated backward).

alter table meals add column if not exists fiber integer;

comment on column meals.fiber is
  'Estimated grams of dietary fiber from the AI read (photo estimate). Null on rows logged before 0070.';
