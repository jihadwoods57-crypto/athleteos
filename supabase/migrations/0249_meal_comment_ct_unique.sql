-- OnStandard 0249: Nia's reply to a correction is filed at most once (2026-09-24).
--
-- meal-chat's correctionOutcome mode (supabase/functions/meal-chat/correction-outcome.mjs) files
-- Nia's words about a correction only after the client reports what actually happened to the
-- plate, with a one-time signed token. Each row it writes carries the token's nonce in meta.ct:
-- the lead as the bare nonce, the receipt as nonce || ':r', a follow-up question as nonce || ':q'.
--
-- The function read "is this ct already filed?" before inserting, which left a race: the client's
-- outbox retries a report whose response was lost, and two requests for one token could both pass
-- the read and both file Nia's words. This index is the part that cannot race. The function treats
-- a unique violation (23505) on the lead as "already filed" and returns success.
--
-- Additive and idempotent: a partial index over rows that carry a ct (none existed before this
-- feature), no table or column change, safe to re-run.

create unique index if not exists meal_comments_ct_once
  on public.meal_comments ((meta->>'ct'))
  where meta ? 'ct';
