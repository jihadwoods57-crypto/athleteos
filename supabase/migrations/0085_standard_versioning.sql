-- OnStandard — standard versioning + prospective effective dates (handoff: "coach standards
-- never activate retroactively; standards versioned + prospective effective dates").
--
-- A requirement_set gains an effective_date. A null date is the always-in-effect BASE version
-- (every existing row, and the team-creation seed). A future-dated version is added alongside the
-- base, so editing the standard for tomorrow never rescopes today or any already-scored day. The
-- client resolver (resolveRequirementSet) picks, per scope, the latest version whose effective
-- date is on/before the day being scored.
--
-- GUARDRAIL: authored for founder review — apply with `supabase db push`, then `npm run test:rls`.

alter table requirement_sets add column if not exists effective_date date;

-- Replace one-row-per-scope with one-row-per-(scope, effective_date): prior versions are kept,
-- a future-dated version can be added, and re-saving the same date replaces that version.
drop index if exists requirement_sets_unique_scope;
create unique index if not exists requirement_sets_unique_scope_version
  on requirement_sets (team_id, scope_kind, coalesce(scope_value, ''), coalesce(effective_date, '0001-01-01'));

-- set_team_requirements gains an optional effective date (supersedes the 0078 definition; keeps
-- its is_write_staff gate). NULL upserts the base version (team creation + explicit "apply now");
-- a date inserts/updates that dated version, leaving earlier versions — and every already-scored
-- day — untouched.
drop function if exists set_team_requirements(uuid, text, text, jsonb);
create or replace function set_team_requirements(
  p_team uuid, p_scope_kind text, p_scope_value text, p_items jsonb, p_effective_date date default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  set_id uuid;
begin
  if not is_write_staff(p_team) then
    raise exception 'Only team staff can set requirements.';
  end if;
  insert into requirement_sets (team_id, scope_kind, scope_value, items, created_by, effective_date)
  values (p_team, p_scope_kind, nullif(p_scope_value, ''), p_items, auth.uid(), p_effective_date)
  on conflict (team_id, scope_kind, coalesce(scope_value, ''), coalesce(effective_date, '0001-01-01'))
  do update set items = excluded.items, created_by = excluded.created_by, updated_at = now()
  returning id into set_id;
  return set_id;
end; $$;
revoke all on function set_team_requirements(uuid, text, text, jsonb, date) from public, anon;
grant execute on function set_team_requirements(uuid, text, text, jsonb, date) to authenticated;
