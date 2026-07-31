-- OnStandard — publish meal_comments for Realtime, so a thread updates live instead of on a poll.
--
-- WHY. The meal thread is the product's only real conversation, and until now both sides polled
-- every 15 seconds: a coach's reply sat unseen for up to a quarter of a minute, and every tick
-- refetched up to 200 full rows. This is the FIRST realtime consumer in the project — nothing was
-- ever added to the supabase_realtime publication before this migration.
--
-- WHAT THE CLIENT ACTUALLY DOES WITH IT — read this before widening anything here.
-- The subscriber (proto/redesign-2026-07/js/screens/meal.js) treats realtime as a DOORBELL, not
-- as a delivery: the change payload is discarded and the callback simply re-runs the thread's
-- normal RLS-scoped SELECT. That is deliberate and it is the security argument for this migration.
--
--   Migration 0069 exists because 0068 leaked PRIVATE COACH NOTES (kind='note') to athletes. Those
--   notes live in this very table. A realtime payload is authorised through a different path than
--   the PostgREST SELECT that bug was fixed in, so shipping row data straight from the socket into
--   the UI would re-open exactly that class of leak. Because the client renders nothing from the
--   payload, a mis-scoped subscription can at worst cause a redundant fetch that returns nothing
--   new — it can never surface a row the reader could not already SELECT.
--
--   If a future change starts rendering realtime payload data directly, that reasoning no longer
--   holds and the note-visibility policy (0069) must be re-verified against the realtime path
--   FIRST. `npm run test:rls` covers the SELECT policy; it does NOT cover realtime delivery.
--
-- REPLICA IDENTITY is deliberately left at the default. The client only needs to know THAT
-- something changed, never the old values, so `replica identity full` would put the entire old row
-- (including note text) onto the replication stream for no consumer benefit.
--
-- Idempotent and forward-only. Applying this does not change any RLS policy or grant.

do $$
begin
  -- `alter publication ... add table` throws 42710 if the table is already a member, and there is
  -- no IF NOT EXISTS form, so membership is checked first to keep this re-runnable.
  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime'
       and schemaname = 'public'
       and tablename = 'meal_comments'
  ) then
    -- The publication itself is created by the Supabase platform. On a bare local database it may
    -- not exist yet; skip rather than fail, since realtime is a pure enhancement here and the
    -- client falls back to polling when it cannot subscribe.
    if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
      alter publication supabase_realtime add table public.meal_comments;
    else
      raise notice 'supabase_realtime publication not present — skipping (client falls back to polling)';
    end if;
  end if;
end $$;

-- ROLLBACK:
--   alter publication supabase_realtime drop table public.meal_comments;
-- Reverting is safe and invisible to users: the client's subscribe() simply stops reaching
-- 'SUBSCRIBED', and its polling floor (which is never removed) resumes at the normal interval.
