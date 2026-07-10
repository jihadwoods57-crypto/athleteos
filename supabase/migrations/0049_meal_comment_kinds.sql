-- OnStandard — meal comment kinds (spec docs/superpowers/specs/2026-07-09-meal-intelligence-design.md §5).
-- Reactions (🔥 💪 👏 👍) are meal_comments rows with kind='reaction' so the coach's one-tap
-- acknowledgment rides the exact same RLS surface as comments. 0046's policies already allow
-- coach-authored rows; nothing about who-may-write changes here. AI rows stay service-role-only.
--
-- Forward-only, idempotent (`add column if not exists` + a guarded constraint add, matching the
-- 0016 / 0029 idiom): re-running this migration is a no-op on a DB that already has it.
--
-- GUARDRAIL: authored only; the founder applies this at go-live (like 0004+). Additive; the
-- meal-chat function retries its insert without `kind` on a pre-migration DB.

alter table meal_comments add column if not exists kind text not null default 'message';

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'meal_comments_kind_check') then
    alter table meal_comments add constraint meal_comments_kind_check
      check (kind in ('message', 'reaction'));
  end if;
end $$;

comment on column meal_comments.kind is
  'message = a thread bubble; reaction = a one-tap emoji acknowledgment rendered as a strip, not a bubble.';
