-- OnStandard — preferred coach name (WS2a of the coach-experience overhaul, founder-approved).
-- A coach may go by "Coach JB" / "Coach Brown" — not their legal first name. One nullable
-- column + the single display funnel (team_head_coach_name) means every athlete-facing
-- surface (join preview, home references, meal threads, digests) picks it up at once.
--
-- GUARDRAIL: authored by direction of the founder 2026-07-14; apply with supabase db push.

alter table profiles add column if not exists coach_display_name text
  check (coach_display_name is null or length(trim(coach_display_name)) between 2 and 40);

-- The coach sets their own handle. Definer RPC (not a column grant) so the write path is
-- explicit and self-scoped, like set_my_team_code (0026).
create or replace function set_my_coach_name(new_name text) returns text
language plpgsql security definer set search_path = public as $$
declare
  cleaned text := nullif(trim(coalesce(new_name, '')), '');
begin
  if cleaned is not null and (length(cleaned) < 2 or length(cleaned) > 40) then
    raise exception 'Keep it between 2 and 40 characters.';
  end if;
  update profiles set coach_display_name = cleaned where id = auth.uid();
  return cleaned;
end; $$;
revoke all on function set_my_coach_name(text) from public;
grant execute on function set_my_coach_name(text) to authenticated;

-- The display funnel: preferred name wins, full name stays the fallback. Every RPC that
-- surfaces coach_name (discover_teams, resolve_team_code, previews) calls this helper.
create or replace function team_head_coach_name(team uuid) returns text
language sql stable security definer set search_path = public as $$
  select coalesce(nullif(trim(p.coach_display_name), ''), p.full_name)
  from team_staff s join profiles p on p.id = s.staff_id
  where s.team_id = team and s.role = 'head_coach' and s.status = 'active'
  limit 1;
$$;
