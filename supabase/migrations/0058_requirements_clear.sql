-- OnStandard — clear a standing requirement set (WS5.1 standards editor).
-- A position room reverts to the team default by DELETING its override row; 0055 only
-- upserts. Same staff gate + definer pattern as set_team_requirements.
--
-- GUARDRAIL: authored by direction of the founder 2026-07-14; apply with supabase db push.

create or replace function clear_team_requirements(
  p_team uuid, p_scope_kind text, p_scope_value text
) returns boolean
language plpgsql security definer set search_path = public as $$
declare
  hit int;
begin
  if not is_staff_of_team(p_team) then
    raise exception 'Only team staff can change requirements.';
  end if;
  delete from requirement_sets
   where team_id = p_team and scope_kind = p_scope_kind
     and coalesce(scope_value, '') = coalesce(nullif(p_scope_value, ''), '');
  get diagnostics hit = row_count;
  return hit > 0;
end; $$;
revoke all on function clear_team_requirements(uuid, text, text) from public;
grant execute on function clear_team_requirements(uuid, text, text) to authenticated;
