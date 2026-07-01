-- OnStandard — per-meal analysis signals (conversational meal logging).
--
-- Adds three columns to `meals`, all nullable / defaulted so every existing row AND the
-- deterministic-fallback write path stay valid with no backfill:
--   * macro_confidence   — how much the grounder could corroborate the estimate
--                          ('high' | 'medium' | 'low'); surfaced to the athlete, drives the
--                          "estimated vs confirmed" read (Slice 2).
--   * description_signal  — how the athlete's typed note related to the photo, feeding the coach
--                          pattern signal ('match' | 'photo_heavier' | 'photo_lighter' | 'no_photo')
--                          (Slice 4).
--   * favorited           — athlete flagged this meal as a reusable "usual" (Slice 3).
--
-- Forward-only, idempotent. RLS is unchanged: the existing meals_read / meals_write policies
-- (0002) already gate these columns by row, so no policy edits are needed.
--
-- GUARDRAIL: authored here; apply with `supabase db push` alongside 0001-0015.

alter table public.meals add column if not exists macro_confidence  text;
alter table public.meals add column if not exists description_signal text;
alter table public.meals add column if not exists favorited boolean not null default false;

-- Defensive value checks (cheap; catch a bad writer early). Columns are nullable, so NULL passes.
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'meals_macro_confidence_chk') then
    alter table public.meals add constraint meals_macro_confidence_chk
      check (macro_confidence is null or macro_confidence in ('high', 'medium', 'low'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'meals_description_signal_chk') then
    alter table public.meals add constraint meals_description_signal_chk
      check (description_signal is null or description_signal in ('match', 'photo_heavier', 'photo_lighter', 'no_photo'));
  end if;
end $$;
