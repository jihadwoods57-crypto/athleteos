-- 0225: the head coach's id, for the athlete's side of the link (2026-09-08).
--
-- Profile pictures are keyed on the user id (avatars/<uid>/avatar.jpg, 0206) and every surface
-- paints a face from the uid alone. The coach side has always had the athlete's id, so the
-- roster, priorities and threads could show faces. The athlete side had only the coach's NAME
-- (team_head_coach_name, 0024/0056), so "your coach" was initials everywhere an athlete met them:
-- the requirement's "why it's on your standard", the connected screen, the standards board.
--
-- Same shape and the same security-definer posture as team_head_coach_name: an id is no more
-- sensitive than the display name it sits beside, the bucket it unlocks is public, and the
-- caller can only ask about a team they can already name. Returns null for a team with no
-- active head coach, exactly like the name function.
create or replace function team_head_coach_id(team uuid) returns uuid
language sql stable security definer set search_path = public as $$
  select s.staff_id
  from team_staff s
  where s.team_id = team and s.role = 'head_coach' and s.status = 'active'
  limit 1;
$$;
revoke execute on function team_head_coach_id(uuid) from public, anon;
grant execute on function team_head_coach_id(uuid) to authenticated;
