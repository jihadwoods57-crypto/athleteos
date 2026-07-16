-- OnStandard — FIX: private coach notes leaked to the athlete (caught by RLS testing on
-- 0068 the same day). can_view(athlete) includes is_self(athlete) (0002), so 0068's read
-- policy second arm ("or can_view(athlete_id)") handed the athlete every note on their own
-- meals despite the first arm's exclusion. Notes must be readable ONLY by linked overseers
-- who are NOT the athlete.
--
-- Forward-only, idempotent (policy recreate).

drop policy if exists meal_comments_read on meal_comments;
create policy meal_comments_read on meal_comments
  for select using (
    -- non-notes: athlete on own meals, or any linked viewer (unchanged behavior)
    (coalesce(kind, 'message') <> 'note'
      and (athlete_id = auth.uid() or can_view(athlete_id)))
    -- notes: linked overseers only, and NEVER the athlete themself
    or (coalesce(kind, 'message') = 'note'
      and athlete_id <> auth.uid() and can_view(athlete_id))
  );
