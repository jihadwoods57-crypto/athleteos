-- 0217 — the escalation claim must honour the Verified Commitments kill switch.
--
-- Found while switching the morning roll call off (founder, 2026-09-02). `vc_enabled()` is the
-- product's off switch for commitments, and every other path in the loop respects it:
--   · commitment_board / my_commitments          → `and vc_enabled()` in the WHERE (0141)
--   · ensure_commitment_instances                → returns 0 (0141)
--   · materialize_active_commitments             → returns 0 on the kill switch (0211)
--   · commitments_flag_guard (the write trigger) → raises (0141)
--   · claim_due_commitment_reminders             → `and vc_enabled(r.athlete_id)` (0211)
--
-- `claim_missed_commitments` did NOT. It is the 6:05 rung: it flips every unanswered response to
-- `missed` and hands the escalation function the roster for the time-sensitive "You're late" push
-- AND the coach's "who missed" digest. So with the feature switched off, an athlete whose row was
-- materialized BEFORE the switch would still be marked missed at the deadline and still have their
-- phone buzz — from a feature that no longer exists anywhere in the app. Turning something off has
-- to turn off the part that wakes people up, or it is not off.
--
-- This is 0211's body with one added predicate and nothing else. It is a correctness fix in its
-- own right and stands whether or not the switch is ever thrown: the guard is per-athlete, exactly
-- like the reminder claim's, so an allowlisted rollout behaves consistently on both rungs.
--
-- NOT IN THIS MIGRATION, deliberately: the kill switch itself is a runtime flag, not schema. It is
-- flipped with one UPDATE against the environment being switched off, so a fresh database (and the
-- RLS suite, which exercises commitments end to end) still comes up with the feature ON.
--     off:  update feature_flags set kill_switch = true  where name = 'verified_commitments';
--     back: update feature_flags set kill_switch = false where name = 'verified_commitments';

-- ---------------------------------------------------------------- and so must the week ahead
-- Second gap, same cause. `rollcall_upcoming` (0215/0216) authorizes the caller but never asked
-- whether the feature is on, and it is what feeds the coach's Home "Next roll call" card and the
-- board's day strip. commitment_board and my_commitments both carry `vc_enabled()`, so with the
-- switch thrown every other surface empties and this one alone would keep announcing tomorrow's
-- 6:00 AM. Returning [] is the honest answer: off means there is no next one.
create or replace function rollcall_upcoming(p_commitment uuid, p_days int default 7)
returns jsonb language plpgsql security definer set search_path = public as $$
declare c commitments; v_today date; v_days int;
begin
  select * into c from commitments where id = p_commitment;
  if not found or not commitment_owner_is_staff(c.team_id, c.practice_id) then
    raise exception 'not authorized';
  end if;
  if not vc_enabled() then return '[]'::jsonb; end if;   -- 0217
  v_days := greatest(1, least(coalesce(p_days, 7), 31));
  v_today := (now() at time zone c.timezone)::date;
  perform materialize_commitment(c.id, v_today, v_today + v_days);
  return (
    select coalesce(jsonb_agg(x order by x->>'occurs_on'), '[]'::jsonb) from (
      select jsonb_build_object(
        'instance_id', i.id, 'commitment_id', c.id, 'occurs_on', i.occurs_on,
        'instance_status', i.status, 'skipped', i.skipped,
        'starts_at', i.starts_at, 'respond_by_at', i.respond_by_at,
        'opens_at', rollcall_opens_at(c.type, i.starts_at, i.respond_by_at, c.starts_min, c.opens_min),
        'closes_at', rollcall_closes_at(c.type, i.respond_by_at, i.starts_at, i.ends_at),
        'starts_min', _rc_min_of(i.starts_at, c.timezone),
        'rule_starts_min', c.starts_min,
        'starts_override_min', i.starts_override_min,
        'grace_min', case when c.respond_by_min is null then null else c.respond_by_min - c.starts_min end,
        'timezone', c.timezone,
        'message', coalesce(i.message_override, c.message),
        'message_override', i.message_override,
        'note', i.note,
        'schedule_set_at', i.schedule_set_at,
        'schedule_set_by_name', (select p.full_name from profiles p where p.id = i.schedule_set_by),
        'schedule_notified_at', i.schedule_notified_at,
        'total', (select count(*) from commitment_responses r where r.instance_id = i.id and r.status <> 'excused'),
        'reachable', (select count(*) from commitment_responses r where r.instance_id = i.id and r.status <> 'excused' and _rc_can_push(r.athlete_id)),
        'answered', (select count(*) from commitment_responses r where r.instance_id = i.id and r.acknowledged_at is not null)
      ) as x
      from commitment_instances i
      where i.commitment_id = c.id
        and i.occurs_on between v_today and v_today + v_days
    ) s
  );
end $$;
grant execute on function rollcall_upcoming(uuid, int) to authenticated;

-- ---------------------------------------------------------------- the 6:05 rung
create or replace function claim_missed_commitments(p_grace_min int default 10, p_only uuid[] default null, p_limit int default 500)
returns table (
  instance_id uuid, athlete_id uuid, title text, config jsonb,
  type text, action_label text, respond_by_at timestamptz, closes_at timestamptz
)
language plpgsql security definer set search_path = public as $$
begin
  return query
  with crossed as (
    select r.id as response_id, r.athlete_id, i.id as instance_id,
           coalesce(c.title, 'Commitment') as title, c.escalation as config,
           coalesce(i.respond_by_at, i.starts_at) as deadline_at,
           c.type as ctype, c.action_label as clabel,
           rollcall_closes_at(c.type, i.respond_by_at, i.starts_at, i.ends_at) as icloses
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
       -- 0217: the one added line. Same per-athlete guard the reminder claim already carries.
       and vc_enabled(r.athlete_id)
     order by deadline_at
     limit greatest(1, p_limit)
  ), claimed as (
    update commitment_responses r
       set status = 'missed', updated_at = now()
      from crossed x
     where r.id = x.response_id and r.status = 'pending'
    returning x.instance_id, x.athlete_id, x.title, x.config, x.ctype, x.clabel, x.deadline_at, x.icloses
  )
  select cl.instance_id, cl.athlete_id, cl.title, cl.config,
         cl.ctype, cl.clabel, cl.deadline_at, cl.icloses
    from claimed cl;
end $$;
revoke all on function claim_missed_commitments(int, uuid[], int) from public, anon, authenticated;
