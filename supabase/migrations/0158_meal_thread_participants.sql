-- OnStandard — who is in this conversation (2026-07-28, founder-directed).
--
-- THE PROBLEM THIS SOLVES. The meal thread renders every non-athlete bubble as the literal string
-- "Coach" with a hardcoded avatar letter. That was survivable when the thread was a two-party
-- accountability note. It is not survivable now that it is a group chat: the athlete should see
-- WHO is in the room — "You, Coach Brown, AI Nutritionist" — and be able to tap it to find out
-- exactly who can read what they write. A messaging surface that hides its own audience is a
-- privacy problem wearing a UI problem's clothes.
--
-- There was no way for an ATHLETE to learn this. fetchMyCoach returns a team name and a coach
-- name but no user id, so bubbles cannot be attributed; team_staff_list is staff-gated. Hence
-- one definer RPC, readable from both sides of the thread.
--
-- IT GRANTS NOTHING. The gate is the same can_view() that already governs the thread, and the
-- rows returned are exactly the people who could already read these meals. Naming them is the
-- honest thing: the alternative is an athlete typing into a room without knowing who is in it.
--
-- Forward-only, idempotent, and safe to run before the client knows about it.

create or replace function meal_thread_participants(p_athlete uuid)
returns table (id uuid, name text, kind text)
language plpgsql stable security definer set search_path = public as $$
begin
  -- Only the athlete themselves, or someone already cleared to see this athlete's record.
  if not (p_athlete = auth.uid() or can_view(p_athlete)) then
    return;
  end if;

  return query
  -- The athlete. Always first: it is their thread.
  select p.id, coalesce(nullif(p.full_name, ''), 'Athlete')::text, 'athlete'::text
    from profiles p where p.id = p_athlete

  union all
  -- Team staff, by their real role, and only those whose scope actually covers this athlete —
  -- a position coach narrowed away from them is not in this conversation and must not be listed.
  select p.id, coalesce(nullif(p.full_name, ''), 'Coach')::text, s.role::text
    from team_staff s
    join team_members m on m.team_id = s.team_id and m.athlete_id = p_athlete and m.status = 'active'
    join profiles p on p.id = s.staff_id
   where s.status = 'active'
     and (s.scope_kind is null or s.role = 'head_coach' or not staff_scope_blocks(p_athlete))

  union all
  -- The trainer whose practice this athlete is a client of.
  select p.id, coalesce(nullif(p.full_name, ''), 'Trainer')::text, 'trainer'::text
    from practice_clients pc
    join practices pr on pr.id = pc.practice_id
    join profiles p on p.id = pr.owner_id
   where pc.client_id = p_athlete and pc.status = 'active'

  union all
  -- Parents and guardians.
  select p.id, coalesce(nullif(p.full_name, ''), 'Guardian')::text, 'guardian'::text
    from guardianships g
    join profiles p on p.id = g.guardian_id
   where g.athlete_id = p_athlete and g.status = 'active';
end; $$;

revoke all on function meal_thread_participants(uuid) from public;
grant execute on function meal_thread_participants(uuid) to authenticated;

comment on function meal_thread_participants(uuid) is
  'The people who can read this athlete''s meal threads, for the participants header. Gated on can_view — grants no visibility, only names what already exists. The AI nutritionist is a client-side constant, not a profile row.';
