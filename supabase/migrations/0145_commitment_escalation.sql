-- supabase/migrations/0145_commitment_escalation.sql
-- OnStandard — roll-call escalation ladder. Silence gets louder, not repeated politely.
--
-- WHAT THIS IS
-- The server half of the escalation ladder that runs behind commitment-reminders. Every 5 minutes
-- the commitment-escalation edge fn claims the responses whose deadline just crossed while still
-- pending, marks them 'missed' (the board's red state), and — for the commitments that opted in —
-- fires L2 (a time-sensitive "window is closing" push to the missed athlete) and L3 (one "who's up"
-- digest push to the owning coaches). L4 (guardian) is deliberately deferred; see the edge fn.
--
-- WHY A CLAIM, NOT A SCAN
-- claim_missed_commitments marks the row 'missed' in the same statement that selects it, exactly as
-- claim_due_commitment_reminders (0140/0144) does. Two overlapping cron ticks therefore cannot fire
-- the same rung twice, and only PENDING rows inside the grace window are ever touched — an athlete
-- who already answered, was excused, or came up 'unverified' is never re-flagged.
--
-- NOTHING ELSE TRANSITIONS pending -> 'missed'. Verified before authoring: 0138/0144 only read
-- 'missed' (status in ('pending','missed') -> 'acknowledged'); 0139 moves rows INTO 'unverified',
-- never into 'missed'; staff_set_response (0138) is the only other writer and that is a manual coach
-- correction. So this claim is the sole automated deadline transition — no double-handling.
--
-- GUARDRAIL: authored + statically reviewed; NOT applied to live here. Founder applies via
-- `supabase db push` then `npm run test:rls`.

-- ---------------------------------------------------------------- escalation config
-- Per-commitment opt-ins for the ladder. Empty default = nothing escalates, so a commitment created
-- before this feature (or one the coach never configures) stays silent past the deadline exactly as
-- it does today. Shape: { breakthrough: bool, notify_coach_on_miss: bool, notify_guardian_on_miss: bool }.
alter table commitments add column if not exists
  escalation jsonb not null default '{}'::jsonb;

-- ---------------------------------------------------------------- claim_missed_commitments
-- Deadline-crossed, still-pending responses, claimed once so overlapping cron ticks can't double
-- fire a rung. Marks the row 'missed' as it claims (the board's red state). Returns the athlete to
-- reach plus the per-commitment escalation config; the coach ids come from rollcall_digest, not here.
create or replace function claim_missed_commitments(p_grace_min int default 10)
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
  ), claimed as (
    update commitment_responses r
       set status = 'missed', updated_at = now()
      from crossed x
     where r.id = x.response_id
    returning x.instance_id, x.athlete_id, x.title, x.config
  )
  select cl.instance_id, cl.athlete_id, cl.title, cl.config from claimed cl;
end $$;

revoke all on function claim_missed_commitments(int) from public, anon, authenticated;

-- ---------------------------------------------------------------- rollcall_digest
-- The per-instance read behind the L3 coach digest. Counts + non-responder names + the coaches to
-- notify, for exactly one instance. SERVICE-ROLE ONLY like the claim above: the coach's own live
-- view is commitment_board (0138), which is RLS-gated to staff; this is the server's push builder.
--
-- coach_ids UNION (a commitment has exactly one of team_id / practice_id, num_nonnulls = 1):
--   TEAM     -> team_staff.staff_id where team_id = c.team_id and status = 'active' (0055/0002)
--   PRACTICE -> practices.owner_id where id = c.practice_id — the single operator that is_practice_staff
--               resolves to today via owns_practice (0136:63, 0002:50). The seam widens to a
--               practice_staff join here the day assistant trainers ship, nowhere else.
-- The non-matching branch simply contributes no rows, so the union is null-safe for either owner.
create or replace function rollcall_digest(p_instance uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'title', coalesce(c.title, 'Roll call'),
    'total', (select count(*) from commitment_responses r where r.instance_id = i.id),
    'not_up_names', coalesce((
      select array_agg(p.full_name order by p.full_name)
        from commitment_responses r
        join profiles p on p.id = r.athlete_id
       where r.instance_id = i.id and r.acknowledged_at is null
    ), array[]::text[]),
    'coach_ids', coalesce((
      select array_agg(distinct s.sid) from (
        select ts.staff_id as sid from team_staff ts
         where c.team_id is not null and ts.team_id = c.team_id and ts.status = 'active'
        union
        select pr.owner_id as sid from practices pr
         where c.practice_id is not null and pr.id = c.practice_id
      ) s where s.sid is not null
    ), array[]::uuid[])
  )
  from commitment_instances i
  join commitments c on c.id = i.commitment_id
  where i.id = p_instance;
$$;

revoke all on function rollcall_digest(uuid) from public, anon, authenticated;
