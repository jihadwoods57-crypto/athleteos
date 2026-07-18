-- OnStandard — Coach OS Slice F (part 1 of 2): the scoped staff-role vocabulary
-- (spec: docs/superpowers/specs/2026-07-16-coach-os-design.md, Slice F).
--
-- staff_role grows to the pragmatic-v1 set: head_coach · coordinator · position_coach ·
-- nutritionist · readonly. Existing 'assistant' rows are NOT rewritten — 'assistant' is
-- treated as coordinator everywhere (labels + permissions); new invites mint the new names.
--
-- SPLIT-FILE RULE: ALTER TYPE ... ADD VALUE commits fine inside this migration's
-- transaction, but the new values cannot be REFERENCED until that transaction commits —
-- so everything that branches on 'coordinator'/'position_coach'/'readonly' lives in 0078,
-- which supabase db push runs as its own later transaction.

alter type staff_role add value if not exists 'coordinator';
alter type staff_role add value if not exists 'position_coach';
alter type staff_role add value if not exists 'readonly';
