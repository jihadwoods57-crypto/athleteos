-- OnStandard — private coach notes on meal threads (conversation upgrade 2026-07-16).
-- A coach can attach a note to a meal that the ATHLETE never sees (scouting-style margin
-- notes: "watch portion sizes this week", "flag if this repeats"). Notes ride the existing
-- meal_comments surface — same table, same caps-free lane (the 0059 trigger only counts
-- kind='message'), same author integrity — with ONE new visibility rule.
--
-- Forward-only, idempotent (guarded constraint swap + policy recreate, matching the
-- 0049/0016 idiom): re-running is a no-op on a DB that already has it.

-- 1) Allow the new kind. (0049 added the check constraint with message|reaction.)
do $$ begin
  if exists (select 1 from pg_constraint where conname = 'meal_comments_kind_check') then
    alter table meal_comments drop constraint meal_comments_kind_check;
  end if;
  alter table meal_comments add constraint meal_comments_kind_check
    check (kind in ('message', 'reaction', 'note'));
end $$;

-- 2) Visibility: the athlete reads everything on their own meals EXCEPT notes; linked
--    overseers (can_view) keep reading everything, notes included.
drop policy if exists meal_comments_read on meal_comments;
create policy meal_comments_read on meal_comments
  for select using (
    (athlete_id = auth.uid() and coalesce(kind, 'message') <> 'note')
    or can_view(athlete_id)
  );

-- 3) Writes: notes are coach-lane rows (role='coach', author = the writer, can_view link) —
--    the existing insert policy already enforces exactly that for any kind, so no change.
--    The 0059 cap trigger ignores non-'message' kinds, so notes never consume the 2-message cap.

comment on constraint meal_comments_kind_check on meal_comments is
  'message = thread bubble · reaction = one-tap emoji strip · note = coach-only margin note (athlete never sees it; RLS-enforced).';
