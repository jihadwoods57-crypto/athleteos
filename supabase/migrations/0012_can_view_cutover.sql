-- AthleteOS — Phase B code-side: backfill org_memberships + cut can_view over to it
--
-- The behavioral cutover deferred by 0011. It (1) backfills org_memberships from the
-- TEAM link tables (the Phase B wedge is "one coach + one team"), then (2) swaps
-- can_view()'s body to the membership predicate — same signature, so NO policy or call
-- site changes (the non-destructive trick). src/core/membership.ts stays the canonical
-- mirror; this SQL is the enforcement layer, validated against it.
--
-- SCOPE: TEAMS ONLY. practice_clients (trainers) and guardianships (parents/families)
-- are NOT backfilled here — they belong to the trainer/family go-live, not the
-- one-coach-one-team wedge ([Phase B-trainer / Phase C]). When they ship, extend the
-- backfill with their org-of-one / family-org synthesis (docs/architecture/01 §5).
--
-- BEHAVIOR-PRESERVING BY DESIGN: every staff grant is mapped to GROUP scope = the team
-- (NOT org scope), so a coach sees exactly the athletes they see today — no widening.
-- The richer "head coach = whole-org scope" is a Phase C enhancement, not a cutover.
--
-- GUARDRAIL: authored + VALIDATED on a throwaway local Postgres (see below). NOT applied
-- to the live project — the founder applies migrations + runs the equivalence check first.
--
-- VALIDATED 2026-06-29 on a throwaway Postgres: seeded the legacy team tables, ran the
-- backfill, swapped can_view, and confirmed (a) can_view() matches the legacy
-- is_team_coach_of disjunction for every seeded athlete, (b) a group-scoped assistant on
-- team A canNOT read team B's athlete (deny case), and (c) the real RLS read on `days`
-- honors it (a coach SELECTs their team's day rows, 0 rows for another team).

-- ---------------------------------------------------------------- backfill (teams only)
create or replace function backfill_org_memberships_teams() returns void
language plpgsql security definer set search_path = public as $$
declare
  t record;
  v_org uuid;
begin
  for t in select id, name, org_id, created_by from teams loop
    v_org := t.org_id;
    -- A team created without an org gets a synthesized one (deterministic by team).
    if v_org is null then
      insert into orgs(name, type, created_by) values (t.name, 'club', t.created_by)
        returning id into v_org;
      update teams set org_id = v_org where id = t.id;
    end if;

    -- athletes -> athlete membership, group scope = the team
    insert into org_memberships(organization_id, member_id, role, scope_kind, scope_id, status)
    select v_org, m.athlete_id, 'athlete', 'group', t.id, 'active'
    from team_members m
    where m.team_id = t.id and m.status = 'active'
      and not exists (
        select 1 from org_memberships om
        where om.organization_id = v_org and om.member_id = m.athlete_id
          and om.role = 'athlete' and om.scope_kind = 'group'
          and om.scope_id is not distinct from t.id
      );

    -- staff -> head_coach / assistant_coach, BOTH group-scoped to the team
    -- (preserves today's per-team visibility exactly; role drives permissions only).
    insert into org_memberships(organization_id, member_id, role, scope_kind, scope_id, status)
    select v_org, s.staff_id,
           case when s.role = 'head_coach' then 'head_coach'::membership_role
                else 'assistant_coach'::membership_role end,
           'group', t.id, 'active'
    from team_staff s
    where s.team_id = t.id and s.status = 'active'
      and not exists (
        select 1 from org_memberships om
        where om.organization_id = v_org and om.member_id = s.staff_id
          and om.role in ('head_coach','assistant_coach') and om.scope_kind = 'group'
          and om.scope_id is not distinct from t.id
      );
  end loop;
end $$;

-- Run the backfill once (idempotent — re-running inserts nothing new).
select backfill_org_memberships_teams();

-- ---------------------------------------------------------------- the cutover (one line)
-- can_view keeps its exact signature; its body now reads org_memberships. Every existing
-- RLS policy that calls can_view() inherits the membership model with no edit.
create or replace function can_view(athlete uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select can_view_via_memberships(athlete);
$$;
