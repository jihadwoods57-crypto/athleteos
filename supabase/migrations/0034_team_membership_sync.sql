-- OnStandard — fix: keep org_memberships in sync with team links (audit 2026-07-02, item 1)
--
-- THE BUG THIS CLOSES
-- 0012 swapped can_view() to read org_memberships and ran backfill_org_memberships_teams()
-- ONCE at migration time. 0013 kept team-coach visibility routing *only* through
-- org_memberships (it restored the legacy path for trainers/guardians, but not coaches).
-- Nothing has maintained org_memberships since: join_team, request_join_team + coach
-- approve (a direct `update team_members set status='active'`), and create_team all write
-- only the legacy team_* tables. RESULT: every coach<->athlete TEAM link formed after the
-- cutover grants the coach ZERO visibility of the athlete's day — the product's core loop,
-- silently broken. (Trainer/guardian links are unaffected: 0013 still honors is_trainer_of
-- / is_guardian_of for them.)
--
-- THE FIX (enforcement at the data layer, not convention)
-- A trigger on team_members / team_staff mirrors each active link into org_memberships with
-- the SAME group-scope + org-synthesis logic as 0012's backfill. A trigger (not a change to
-- the join RPCs) is used deliberately: the coach-approve path is a direct UPDATE with no RPC
-- to hook, and a trigger cannot be bypassed by any future write path. can_view() is NOT
-- touched, so trainer/guardian behavior is unchanged. Finally we re-run the existing
-- idempotent backfill to catch every team link created between the cutover and now.
--
-- SCOPE: TEAMS ONLY — matches 0012/0013. practice_clients (trainers) and guardianships
-- (parents) still route through the legacy predicates in 0013 and are intentionally left
-- alone here; their org_memberships unification is the deferred trainer/family go-live.
--
-- BEHAVIOR-PRESERVING: every staff grant maps to GROUP scope = the team (never org scope),
-- so a coach sees exactly the athletes they see today — no widening. Status mapping is
-- fail-closed: any non-active/non-removed link (pending, invited) becomes an INVISIBLE
-- 'invited' membership, so a pending join request stays hidden from the coach until approve
-- flips it to 'active' — preserving the documented pending-is-invisible invariant.
--
-- GUARDRAIL: authored + validated locally; NOT applied to live here. The founder applies it
-- (see docs/audit/2026-07-02-PHASE-0-GO-LIVE.md). Requires 0011 (org_memberships) — which is
-- live — and is harmless if the 0012 cutover were ever rolled back (it would just maintain a
-- table can_view no longer reads).

-- ---------------------------------------------------------------- org resolution helper
-- Return a team's org_id, synthesizing + persisting an org-of-one for legacy null-org teams.
-- Idempotent: a second call for the same team returns the org created by the first.
-- Mirrors backfill_org_memberships_teams() lines 34-41 exactly.
create or replace function ensure_team_org(p_team uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_org     uuid;
  v_name    text;
  v_creator uuid;
begin
  select org_id, name, created_by into v_org, v_name, v_creator from teams where id = p_team;
  if v_org is null then
    insert into orgs(name, type, created_by) values (v_name, 'club', v_creator)
      returning id into v_org;
    update teams set org_id = v_org where id = p_team;
  end if;
  return v_org;
end $$;

-- ---------------------------------------------------------------- upsert helper
-- Reactivate-in-place (the unique grant per (org, member, role, scope) from 0011). Clears
-- ended_at when the grant goes active; stamps it when the grant is deactivated.
create or replace function sync_org_membership(
  p_org uuid, p_member uuid, p_role membership_role, p_team uuid, p_status membership_status
) returns void
language plpgsql security definer set search_path = public as $$
begin
  insert into org_memberships(organization_id, member_id, role, scope_kind, scope_id, status)
  values (p_org, p_member, p_role, 'group', p_team, p_status)
  on conflict (organization_id, member_id, role, scope_kind, scope_id)
  do update set status   = excluded.status,
                ended_at = case when excluded.status = 'active' then null else now() end;
end $$;

-- ---------------------------------------------------------------- link_status -> membership_status
-- 'active' -> visible; everything else -> not visible (fail-closed). 'removed' stays 'removed'
-- so a re-backfill never resurrects a revoked grant; 'pending'/'invited' become 'invited'.
create or replace function link_status_to_membership(s link_status) returns membership_status
language sql immutable as $$
  select case s
    when 'active'  then 'active'::membership_status
    when 'removed' then 'removed'::membership_status
    else 'invited'::membership_status
  end;
$$;

-- ---------------------------------------------------------------- team_members trigger
-- Athlete side: role 'athlete', group scope = the team.
create or replace function tg_team_member_membership() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid;
begin
  if TG_OP = 'DELETE' then
    v_org := ensure_team_org(OLD.team_id);
    perform sync_org_membership(v_org, OLD.athlete_id, 'athlete', OLD.team_id, 'removed');
    return OLD;
  end if;
  v_org := ensure_team_org(NEW.team_id);
  perform sync_org_membership(
    v_org, NEW.athlete_id, 'athlete', NEW.team_id, link_status_to_membership(NEW.status)
  );
  return NEW;
end $$;

drop trigger if exists trg_team_member_membership on team_members;
create trigger trg_team_member_membership
  after insert or update or delete on team_members
  for each row execute function tg_team_member_membership();

-- ---------------------------------------------------------------- team_staff trigger
-- Staff side: staff_role 'head_coach' -> head_coach, 'assistant' -> assistant_coach, group
-- scope = the team (role drives permissions; scope preserves today's per-team visibility).
create or replace function tg_team_staff_membership() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_org  uuid;
  v_role membership_role;
begin
  if TG_OP = 'DELETE' then
    v_role := case when OLD.role = 'head_coach' then 'head_coach'::membership_role
                   else 'assistant_coach'::membership_role end;
    v_org := ensure_team_org(OLD.team_id);
    perform sync_org_membership(v_org, OLD.staff_id, v_role, OLD.team_id, 'removed');
    return OLD;
  end if;
  v_role := case when NEW.role = 'head_coach' then 'head_coach'::membership_role
                 else 'assistant_coach'::membership_role end;
  v_org := ensure_team_org(NEW.team_id);
  perform sync_org_membership(
    v_org, NEW.staff_id, v_role, NEW.team_id, link_status_to_membership(NEW.status)
  );
  return NEW;
end $$;

drop trigger if exists trg_team_staff_membership on team_staff;
create trigger trg_team_staff_membership
  after insert or update or delete on team_staff
  for each row execute function tg_team_staff_membership();

-- ---------------------------------------------------------------- catch up the gap
-- Re-run the canonical idempotent backfill to mirror every team link created between the
-- 0012 cutover and this migration. NOT EXISTS guards mean it only inserts what's missing and
-- never reactivates a 'removed' grant.
select backfill_org_memberships_teams();

-- Least privilege: these helpers are internal (triggers + backfill call them). No app code
-- calls them directly. 0005 set a DEFAULT PRIVILEGE granting EXECUTE to anon+authenticated
-- on every new function, so we must revoke from those roles explicitly (not just public).
-- The trigger functions run as SECURITY DEFINER regardless of the caller's execute grant.
-- The broader default-privilege fix that stops this recurring is 0035 (item 3).
revoke execute on function ensure_team_org(uuid)                        from anon, authenticated;
revoke execute on function sync_org_membership(uuid, uuid, membership_role, uuid, membership_status) from anon, authenticated;
revoke execute on function link_status_to_membership(link_status)      from anon, authenticated;
