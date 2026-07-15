-- OnStandard — client-side "who is my trainer" read (the athlete/client half of the mirror).
--
-- Gap: the client dashboard could never show the trainer a client linked to. fetchMyCoach reads
-- only `teams` (a client joins a `practice`), and while practices_read RLS (0002) already lets a
-- client SELECT their practice row, the trainer's display NAME lives in `profiles` and is not
-- client-readable. This SECURITY DEFINER RPC returns the caller's active practice + the trainer's
-- real name in one call — the practice mirror of team_head_coach_name (0024/0056) for the coach
-- side, and it reuses the same safe "owner full_name via subquery" shape as resolve_practice_code
-- (0025).
--
-- Scope-safe: it returns ONLY the caller's own active practice_clients link (auth.uid()); it never
-- exposes another client's link or a practice the caller hasn't joined. Read-only, one row.
--
-- GUARDRAIL: authored only; the founder applies it at go-live (like 0004+). The client
-- (roles.fetchMyTrainer) fails OPEN when this RPC is absent — it degrades to the practice name
-- from the practices_read select, never an error.

create or replace function my_trainer()
returns table (practice_id uuid, practice_name text, trainer_name text, handle text)
language sql stable security definer set search_path = public as $$
  select p.id,
         p.name,
         (select pr.full_name from profiles pr where pr.id = p.owner_id),
         p.handle
  from practice_clients pc
  join practices p on p.id = pc.practice_id
  where pc.client_id = auth.uid() and pc.status = 'active'
  order by pc.last_active_at desc nulls last
  limit 1;
$$;

grant execute on function my_trainer() to authenticated;
