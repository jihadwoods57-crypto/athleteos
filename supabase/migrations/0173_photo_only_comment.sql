-- OnStandard — let a chat message be a PHOTO with no words.
--
-- THE GAP. 0046 declared `text text not null check (char_length(text) between 1 and 1000)`, written
-- when a comment could only ever BE text. Chat photo attachments (2026-07-30) carry their storage
-- key in `meta.photo`, which made a wordless photo structurally impossible: the client had to
-- invent a stand-in string ("Sent a photo") purely to satisfy a constraint, and every consumer of
-- `text` — the coach inbox preview, the AI's context blob, a notification body — then had to
-- special-case that magic string back out again. A sentinel value in a data column is a bug that
-- has not happened yet.
--
-- THE FIX. Keep the 1000-character ceiling exactly as it is, and keep text NOT NULL (so no consumer
-- has to start null-checking). Only relax the FLOOR, and only for a row that actually carries an
-- attachment: an empty message with nothing attached is still meaningless and still rejected.
--
--   char_length(text) between 1 and 1000            <- unchanged for every ordinary message
--   OR (char_length(text) = 0 and meta ? 'photo')   <- a photo standing on its own
--
-- `meta ? 'photo'` is jsonb key-existence. It is null-safe: `meta` is nullable and `null ? 'photo'`
-- evaluates to null, so the OR arm cannot accidentally admit an empty text on a row with no meta.
--
-- ORDERING NOTE: this depends on `meta` existing, which 0157 added. It is therefore safe to apply
-- on any database at 0157 or later; on prod (0171+) that is already true.
--
-- Idempotent and forward-only: the constraint is dropped IF EXISTS and recreated under a new name,
-- so a re-run cannot fail on a duplicate.

alter table public.meal_comments drop constraint if exists meal_comments_text_check;
alter table public.meal_comments drop constraint if exists meal_comments_text_len;

alter table public.meal_comments add constraint meal_comments_text_len check (
  (char_length(text) between 1 and 1000)
  or (char_length(text) = 0 and meta ? 'photo')
);

-- ROLLBACK (only safe once no wordless-photo rows exist, or they will violate the restored rule):
--   delete from public.meal_comments where char_length(text) = 0;   -- destructive; check first
--   alter table public.meal_comments drop constraint if exists meal_comments_text_len;
--   alter table public.meal_comments add constraint meal_comments_text_check
--     check (char_length(text) between 1 and 1000);
