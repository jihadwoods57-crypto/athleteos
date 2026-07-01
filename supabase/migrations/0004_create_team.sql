-- OnStandard — Phase 1 go-live: create_team RPC (Stage B)
-- Additive migration. A coach creates a team and is added as its head_coach staff
-- ATOMICALLY. This must be a SECURITY DEFINER RPC because team_staff's RLS
-- (`is_team_staff`) blocks self-inserting the FIRST staff row (chicken-and-egg:
-- you must already be staff to insert staff). The existing join_team/join_practice
-- RPCs use the same definer pattern. Replaces the static EAGLES24 invite code with a
-- real, unique, server-generated team code.
--
-- GUARDRAIL: this file is authored only; it is NOT applied to the live project by the
-- crew. The founder applies it (`supabase db push`) at go-live. It was applied to a
-- throwaway LOCAL stack to verify the round-trip (see NIGHTSHIFT-LOG.md). Because
-- Stage A recorded 0001-0003 as the applied set, this 0004 is a new go-live
-- dependency, flagged in docs/FOUNDER-DECISIONS.md.

-- Unambiguous 6-char code (no 0/O/1/I), unique across teams.
create or replace function gen_join_code() returns text
language plpgsql as $$
declare
  alphabet text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  code text;
  i int;
begin
  loop
    code := '';
    for i in 1..6 loop
      code := code || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
    end loop;
    exit when not exists (select 1 from teams where join_code = code);
  end loop;
  return code;
end; $$;

create or replace function create_team(team_name text, team_sport text default null)
returns text
language plpgsql security definer set search_path = public as $$
declare
  new_code text;
  new_team uuid;
begin
  if auth.uid() is null then
    raise exception 'must be signed in to create a team';
  end if;
  new_code := gen_join_code();
  insert into teams (name, sport, join_code, created_by)
  values (coalesce(nullif(team_name, ''), 'My Team'), team_sport, new_code, auth.uid())
  returning id into new_team;
  insert into team_staff (team_id, staff_id, role, status)
  values (new_team, auth.uid(), 'head_coach', 'active');
  return new_code;
end; $$;
