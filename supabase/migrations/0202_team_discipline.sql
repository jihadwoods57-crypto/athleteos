-- 0202: teams.discipline — the team-book mirror of 0197's practices.discipline.
--
-- WHY: the team dietitian sign-up (obd) mints a TEAM whose operator is a college sports
-- RD / nutritionist, not a sport coach. The nutrition lens (coach-home vocab, the meal-review
-- queue board, fueling strips) was gated purely on practices.discipline, which a team book
-- can never satisfy — so the operator the product now onboards by name would land on a
-- sport-coach dashboard. Same vocabulary as 0197: discipline describes the OPERATOR, never
-- the roster; any sport.

alter table teams add column if not exists discipline text not null default 'training'
  check (discipline in ('training', 'nutrition'));

comment on column teams.discipline is
  'What this book''s operator runs: ''training'' (sport coach) or ''nutrition'' (team dietitian / '
  'nutritionist, any sport). Written once by create_team from the onboarding flow the owner chose.';

-- create_team grows a 5th defaulted arg. Same recipe as 0197's create_practice re-signature:
-- DROP the old arities first — CREATE OR REPLACE with a different parameter list would leave BOTH
-- functions live and PostgREST answers an ambiguous name with a 300. Prod probe 2026-08-18 found
-- TWO already live (0004's 2-arg survived 0022's re-signature), so both go. Old clients call with
-- named args and no team_discipline, which the default satisfies, so the previous OTA keeps working.
drop function if exists create_team(text, text);
drop function if exists create_team(text, text, uuid, boolean);

create or replace function create_team(
  team_name text,
  team_sport text default null,
  team_org uuid default null,
  team_discoverable boolean default false,
  team_discipline text default 'training'
) returns text
language plpgsql security definer set search_path = public as $$
declare
  new_code text;
  new_team uuid;
begin
  if auth.uid() is null then
    raise exception 'must be signed in to create a team';
  end if;
  if coalesce(team_discipline, 'training') not in ('training', 'nutrition') then
    raise exception 'unknown discipline';
  end if;
  new_code := gen_join_code();
  insert into teams (name, sport, join_code, org_id, discoverable, discipline, created_by)
  values (coalesce(nullif(team_name, ''), 'My Team'), team_sport, new_code,
          team_org, coalesce(team_discoverable, false),
          coalesce(team_discipline, 'training'), auth.uid())
  returning id into new_team;
  insert into team_staff (team_id, staff_id, role, status)
  values (new_team, auth.uid(), 'head_coach', 'active');
  return new_code;
end; $$;

revoke all on function create_team(text, text, uuid, boolean, text) from public;
grant execute on function create_team(text, text, uuid, boolean, text) to authenticated;
