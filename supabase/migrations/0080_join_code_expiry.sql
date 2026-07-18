-- OnStandard — join-code expiry + enforcement (founder security spec 2026-07-18)
--
-- THE GAP: teams.join_code / practices.join_code are plain unique text with no TTL
-- (audit 2026-07-18). A leaked or stale code grants immediate active membership
-- forever; the only kill-switch is a manual regenerate.
--
-- THE FIX (additive, non-breaking, opt-in): a nullable join_code_expires_at on each
-- table. NULL = never expires, so EVERY existing code is grandfathered and no current
-- team/practice breaks. join_team / join_practice now REJECT a code whose expiry is set
-- AND in the past. A head coach / practice owner sets or clears the window with the new
-- set_*_code_expiry RPCs. (Making expiry the DEFAULT on create/regenerate is a one-line
-- follow-up once this is reviewed — deliberately left opt-in so nothing changes silently.)
--
-- SCOPE: team + practice join codes only (staff invites are already single-use, 0061).
-- No column is dropped; no existing code's behavior changes until an expiry is set.
--
-- GUARDRAIL: authored only; NOT applied to live by the crew. Founder reviews, runs
--   `npm run test:rls` on a local DB, then applies at go-live per the runbook.

-- ---------------------------------------------------------------- columns (grandfather = NULL)
alter table teams     add column if not exists join_code_expires_at timestamptz;
alter table practices add column if not exists join_code_expires_at timestamptz;

-- ---------------------------------------------------------------- join guards (reject expired)
-- Supersedes join_team (0002:152). Identical body + one expiry check; NULL expiry passes.
create or replace function join_team(code text, athlete_position text default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare t uuid; exp timestamptz;
begin
  select id, join_code_expires_at into t, exp from teams where join_code = code;
  if t is null then raise exception 'invalid team code'; end if;
  if exp is not null and exp < now() then
    raise exception 'this team code has expired — ask your coach for a new one';
  end if;
  insert into team_members (team_id, athlete_id, position, status)
  values (t, auth.uid(), athlete_position, 'active')
  on conflict (team_id, athlete_id) do update set status = 'active';
  return t;
end; $$;

-- Supersedes join_practice (0002:164).
create or replace function join_practice(code text) returns uuid
language plpgsql security definer set search_path = public as $$
declare p uuid; exp timestamptz;
begin
  select id, join_code_expires_at into p, exp from practices where join_code = code;
  if p is null then raise exception 'invalid practice code'; end if;
  if exp is not null and exp < now() then
    raise exception 'this practice code has expired — ask your trainer for a new one';
  end if;
  insert into practice_clients (practice_id, client_id, status, last_active_at)
  values (p, auth.uid(), 'active', now())
  on conflict (practice_id, client_id) do update set status = 'active';
  return p;
end; $$;

-- ---------------------------------------------------------------- coach / trainer controls
-- Set an expiry window (days from now) on the CALLER's own code, or clear it (days <= 0 / null).
-- Mirrors the ownership resolution in set_my_team_code / set_my_practice_code (0026/0038).
create or replace function set_team_code_expiry(days int) returns timestamptz
language plpgsql security definer set search_path = public as $$
declare t uuid; exp timestamptz;
begin
  select s.team_id into t from team_staff s
    where s.staff_id = auth.uid() and s.role = 'head_coach' and s.status = 'active'
    limit 1;
  if t is null then raise exception 'You do not have a team to update'; end if;
  exp := case when days is not null and days > 0 then now() + (days || ' days')::interval else null end;
  update teams set join_code_expires_at = exp where id = t;
  return exp;
end; $$;

create or replace function set_practice_code_expiry(days int) returns timestamptz
language plpgsql security definer set search_path = public as $$
declare p uuid; exp timestamptz;
begin
  select id into p from practices where owner_id = auth.uid() limit 1;
  if p is null then raise exception 'You do not have a practice to update'; end if;
  exp := case when days is not null and days > 0 then now() + (days || ' days')::interval else null end;
  update practices set join_code_expires_at = exp where id = p;
  return exp;
end; $$;

grant execute on function set_team_code_expiry(int) to authenticated;
grant execute on function set_practice_code_expiry(int) to authenticated;
