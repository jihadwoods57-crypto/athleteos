-- supabase/migrations/0146_rollcall_stage_missed.sql
-- OnStandard — stage the roll-call missed-marking behind the flag + guard the claim UPDATE.
--
-- WHAT THIS IS
-- Two follow-ups to claim_missed_commitments (0145), issued as a create-or-replace so everything
-- else about the function (SECURITY DEFINER, set search_path = public, the returns table, the CTE
-- shape) stays identical:
--
--   #3 PER-ATHLETE FILTER — a new optional p_only uuid[] arg. When null (the default, and what a
--      global rollout passes) the claim behaves exactly as it did before. When a non-null array is
--      passed, only those athletes' responses are eligible to be claimed. This is what lets the
--      commitment-escalation cron honor the rollcall_lockscreen flag's enabled_user_ids so a staged
--      pilot actually limits the missed-marking; flipping default_on=true takes it global.
--
--   #4 STATUS GUARD ON THE UPDATE — the claimed CTE now re-checks r.status = 'pending' at UPDATE
--      time, not only in the crossed CTE's select. Belt-and-suspenders against a concurrent
--      double-claim (two overlapping cron ticks racing the same row); the row is only transitioned
--      pending -> missed once. (Reviewer deferred this from 0145.)
--
-- The old 1-arg overload is DROPPED: with p_only defaulted, a lingering claim_missed_commitments(int)
-- would make a 1-arg call ambiguous (function is not unique). The escalation cron always passes 2
-- args now, so nothing needs the 1-arg form.

drop function if exists claim_missed_commitments(int);

create or replace function claim_missed_commitments(p_grace_min int default 10, p_only uuid[] default null)
returns table (instance_id uuid, athlete_id uuid, title text, config jsonb)
language plpgsql security definer set search_path = public as $$
begin
  return query
  with crossed as (
    select r.id as response_id, r.athlete_id, i.id as instance_id,
           coalesce(c.title, 'Commitment') as title, c.escalation as config
      from commitment_responses r
      join commitment_instances i on i.id = r.instance_id
      join commitments c on c.id = i.commitment_id
     where r.status = 'pending'
       and i.status = 'scheduled'
       and c.active
       and coalesce(i.respond_by_at, i.starts_at) is not null
       and now() >= coalesce(i.respond_by_at, i.starts_at)
       and now() <  coalesce(i.respond_by_at, i.starts_at) + make_interval(mins => greatest(1, p_grace_min))
       and (p_only is null or r.athlete_id = any(p_only))
  ), claimed as (
    update commitment_responses r
       set status = 'missed', updated_at = now()
      from crossed x
     where r.id = x.response_id and r.status = 'pending'
    returning x.instance_id, x.athlete_id, x.title, x.config
  )
  select cl.instance_id, cl.athlete_id, cl.title, cl.config from claimed cl;
end $$;

revoke all on function claim_missed_commitments(int, uuid[]) from public, anon, authenticated;
