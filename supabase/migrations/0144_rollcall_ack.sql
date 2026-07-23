-- supabase/migrations/0144_rollcall_ack.sql
-- OnStandard — lock-screen roll call: record an "I'm Up" from a signed code, no athlete session.
-- GUARDRAIL: authored + statically reviewed; NOT applied to live here.

-- The ack path used by the roll-call-ack edge fn. Mirrors ack_commitment(0138) but keyed by the
-- athlete the signed code already proved, instead of auth.uid() — because the caller is the service
-- role, which has no user. SERVICE-ROLE ONLY: revoked from anon + authenticated so a normal client
-- cannot mark anyone present without the coach-scheduled code.
create or replace function ack_commitment_by_token(p_instance uuid, p_athlete uuid)
returns timestamptz
language plpgsql security definer set search_path = public as $$
declare v_at timestamptz;
begin
  update commitment_responses
     set acknowledged_at = coalesce(acknowledged_at, now()),
         status = case when status in ('pending','missed') then 'acknowledged' else status end,
         updated_at = now()
   where instance_id = p_instance and athlete_id = p_athlete
   returning acknowledged_at into v_at;
  if v_at is null then raise exception 'no commitment for this athlete on this instance'; end if;
  return v_at;
end $$;

revoke all on function ack_commitment_by_token(uuid, uuid) from public, anon, authenticated;

-- Extend the reminder claim to also hand back the coach's action label and the deadline, so the
-- reminder fn can label the notification button and sign the code's expiry. Two columns are added to
-- the returns table and the selects; the filter logic is left exactly as it stands.
--
-- NOTE: the current definition is 0141's, NOT 0140's — 0141 added `vc_enabled(r.athlete_id)`, the
-- per-athlete kill switch. That gate is PRESERVED here: dropping it would let a 4:45 AM push fire for
-- a team whose coach flipped the switch off, which is the one thing the switch exists to stop.
--
-- Adding columns to the RETURNS TABLE changes the function's return type, which CREATE OR REPLACE
-- cannot do (Postgres: "cannot change return type of existing function"). Drop the old definition
-- first. Nothing depends on it — it is reached only by the reminder edge fn via the service role.
drop function if exists claim_due_commitment_reminders(int);
create or replace function claim_due_commitment_reminders(p_grace_min int default 10)
returns table (
  athlete_id uuid, instance_id uuid, title text, body text, offset_min smallint,
  action_label text, respond_by_at timestamptz
)
language plpgsql security definer set search_path = public as $$
begin
  return query
  with due as (
    select r.id as response_id, r.athlete_id, i.id as instance_id,
           coalesce(c.title, 'Commitment') as title,
           c.action_label as action_label,
           coalesce(i.respond_by_at, i.starts_at) as deadline_at,
           o.off
      from commitment_responses r
      join commitment_instances i on i.id = r.instance_id
      join commitments c on c.id = i.commitment_id
      cross join lateral unnest(c.reminder_offsets_min) as o(off)
     where r.status = 'pending'
       and i.status = 'scheduled'
       and c.active
       and coalesce(i.respond_by_at, i.starts_at) is not null
       and not (o.off = any(r.reminded_offsets))
       and now() >= coalesce(i.respond_by_at, i.starts_at) - make_interval(mins => o.off::int)
       and now() <  coalesce(i.respond_by_at, i.starts_at) - make_interval(mins => o.off::int)
                    + make_interval(mins => greatest(1, p_grace_min))
       and vc_enabled(r.athlete_id)
  ), claimed as (
    update commitment_responses r
       set reminded_offsets = array_append(r.reminded_offsets, d.off),
           updated_at = now()
      from due d
     where r.id = d.response_id
    returning r.id, d.athlete_id, d.instance_id, d.title, d.action_label, d.off, d.deadline_at
  )
  select cl.athlete_id, cl.instance_id, cl.title,
         case when cl.off <= 0 then 'Last call. Your coach is waiting.'
              else format('%s minutes left to respond.', cl.off) end as body,
         cl.off::smallint,
         cl.action_label,
         cl.deadline_at
    from claimed cl;
end $$;

revoke all on function claim_due_commitment_reminders(int) from public, anon, authenticated;
