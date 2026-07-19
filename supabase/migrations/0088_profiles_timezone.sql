-- OnStandard — athlete IANA timezone, so coach-facing "overdue" / "due soon" can be judged in the
-- ATHLETE's local day instead of the coach's device clock (fixes the cross-timezone half of the
-- coach overdue bug, logic-audit P0-1). Additive + nullable: a null timezone falls back to the
-- existing viewer-clock behavior, so every existing athlete is completely unaffected.
-- Forward-only, idempotent. No RLS change — the column inherits profiles' existing row policies
-- (the athlete updates their own row; a coach reads it through the same access it already has).

alter table profiles add column if not exists timezone text;

comment on column profiles.timezone is
  'IANA timezone (e.g. America/New_York) captured on the athlete''s own device. Coach-facing '
  'overdue/due-soon should compute the athlete''s local minute-of-day from this; null = fall back '
  'to the viewer clock. Additive; never used for scoring math beyond the deadline comparison.';
