-- OnStandard 0170 — staff invites expire, and staff-code guessing is throttled.
--
-- THE GAP (security audit 2026-07-30, finding #5). join_staff is a SECURITY DEFINER RPC granted to
-- `authenticated`, reachable directly over PostgREST, with NO attempt counter and NO lockout. A
-- signed-up attacker could guess codes as fast as the network allows and nothing recorded it. The
-- prize is the highest-value non-admin credential we mint: a staff code becomes an active
-- team_staff row, which passes can_view() for EVERY athlete on that team — their meals, progress
-- photos, health data, and for minors all of it.
--
-- Second half: staff_invites had used_by/used_at but no expiry. Single-use is not the same as
-- short-lived; a code texted to an assistant who never joined stayed a live key to the roster
-- forever. 0080 scoped itself to team/practice codes and said so ("staff invites are already
-- single-use"), which is where the gap came from.
--
-- ============================================================================
-- WHY THE THROTTLE IS BUILT THE WAY IT IS — READ BEFORE CHANGING
-- ============================================================================
-- The obvious implementation does not work, and fails SILENTLY:
--
--     if code not found then
--       perform bump_attempt_counter();      -- <-- rolled back
--       raise exception 'invalid code';      -- <-- by this
--     end if;
--
-- In PostgreSQL a RAISE aborts the (sub)transaction, and that discards every write made earlier in
-- it — including the counter increment. PostgREST calls the RPC as one statement, so the counter
-- resets to zero on every failed attempt and the limit never binds. The first draft of this
-- migration did exactly that; supabase/tests/code_entropy_and_limits_test.sql caught it. A guard
-- that silently never fires is worse than no guard, because it stops anyone looking.
--
-- So two rules hold this together:
--
--   1. THE COUNTER IS CLAIMED ON THE WAY IN, before the lookup — not on the miss. Every attempt
--      costs one, success or miss, and the write commits because nothing raises after it.
--
--   2. join_staff NEVER RAISES on a bad code. It returns ZERO ROWS. Both callers already treat an
--      empty result as failure and print their own message (roles.js:665 `row ? ok : 'That code
--      did not work.'`, state.js:2584 `if (!error && row)`), so this needs NO client change.
--      It must stay zero rows and never a row of NULLs — a truthy row would make state.js report
--      a successful join.
--
-- Over budget, we return before the lookup ever runs, so an attacker cannot test an eleventh code
-- today no matter what it responds. Ten attempts is generous for a coach joining a staff once and
-- tight for anyone guessing.
--
-- WHAT THIS DELIBERATELY DOES NOT TOUCH: join_team / join_practice. Their callers (state.js:2356)
-- distinguish "team code" from "practice code" by whether the RPC ERRORED, so making them return
-- quietly would read as success and silently mis-route onboarding. They also guard a much smaller
-- prize — an athlete roster row, not the roster's data. Throttling them needs the same pattern the
-- code-preview path already uses: do it in an edge function that calls claim_ai_usage_key in its
-- OWN transaction (see supabase/functions/org-directory, `preview:${ip}`). Left for that change.
--
-- ROLLBACK:
--   restore join_staff from 0061:64 verbatim;
--   alter table staff_invites alter column expires_at drop not null;   -- before any column drop
--   drop function if exists public.claim_code_attempt(text, int);

begin;

-- ---------------------------------------------------------------- staff invite expiry
-- Mirrors exactly how 0149 gave guardian consent tokens an expiry: add nullable, backfill every
-- existing row so nothing in flight breaks, default future inserts, THEN enforce not-null so no
-- row can ever be expiry-less again (which would quietly reopen the hole).
alter table staff_invites
  add column if not exists expires_at timestamptz;

update staff_invites
   set expires_at = created_at + interval '14 days'
 where expires_at is null;

alter table staff_invites
  alter column expires_at set default (now() + interval '14 days'),
  alter column expires_at set not null;

comment on column staff_invites.expires_at is
  'Staff codes are single-use AND time-boxed (0170). 14 days is long enough to text a code to an assistant and have them get to it, short enough that an unredeemed code stops being a standing key to the roster.';

-- ---------------------------------------------------------------- the attempt budget
-- Returns TRUE if this attempt is within today's budget (and consumes one), FALSE once spent.
-- Never raises — see rule 1 above; a raise here would roll back the very increment it just made.
--
-- Backed by claim_ai_usage_key (0030): atomic, day-keyed, service-role-only, and it does NOT
-- increment once already at the cap, so hammering a spent budget cannot extend the lockout.
-- Calling it from inside a SECURITY DEFINER function works regardless of its EXECUTE grants,
-- because the effective user here is the function owner.
create or replace function public.claim_code_attempt(p_kind text, p_limit int)
returns boolean
language plpgsql volatile security definer set search_path = public as $$
declare v_allowed boolean;
begin
  if auth.uid() is null then return true; end if;   -- callers gate the anonymous case themselves
  select allowed into v_allowed
    from public.claim_ai_usage_key(p_kind || ':' || auth.uid()::text, p_limit);
  return coalesce(v_allowed, true);
exception when others then
  -- The counter is infrastructure, not the wall. If it is unreachable, a real coach's join must
  -- still work — the code space itself still bounds the damage.
  return true;
end $$;
revoke all on function public.claim_code_attempt(text, int) from public, anon, authenticated;

-- ---------------------------------------------------------------- join_staff
-- Supersedes 0061:64. Adds: signed-in check, the attempt budget, an expiry predicate, and the
-- raise -> empty-result change described at the top. The insert and the single-use update are
-- 0061's, unchanged.
create or replace function join_staff(p_code text) returns table (team_id uuid, team_name text, staff_role text)
language plpgsql security definer set search_path = public as $$
declare
  inv record;
begin
  if auth.uid() is null then raise exception 'must be signed in to join a staff'; end if;

  -- Claimed BEFORE the lookup: over budget means no lookup happens at all, so an eleventh code
  -- cannot be tested today. Returning here (rather than raising) is what lets the claim commit.
  if not public.claim_code_attempt('joinstaff', 10) then
    return;
  end if;

  select * into inv from staff_invites si
   where si.code = upper(trim(p_code))
     and si.used_by is null
     and si.expires_at > now()
   limit 1;

  -- Zero rows, never a NULL row, and never an exception. See rule 2 at the top.
  if inv is null then
    return;
  end if;

  -- ON CONFLICT ON CONSTRAINT, not `on conflict (team_id, staff_id)`.
  --
  -- THIS LINE WAS A LIVE BUG, in production since 0061 shipped (2026-07-14). `team_id` is also an
  -- OUT parameter of this function's `returns table (team_id uuid, ...)` signature, and PL/pgSQL
  -- resolves identifiers against its own variables first, so the conflict target raised
  --     column reference "team_id" is ambiguous
  -- EVERY time a code was redeemed. join_staff has therefore never once succeeded: the client
  -- catches the error and shows "That code did not work", which reads as a bad code rather than a
  -- broken feature. Nothing caught it because the RLS suite only ever tested MINTING an invite —
  -- supabase/tests/code_entropy_and_limits_test.sql now exercises the redeem path too.
  --
  -- Naming the constraint sidesteps variable resolution entirely (team_staff_pkey IS
  -- (team_id, staff_id), so the semantics are identical).
  insert into team_staff (team_id, staff_id, role, status)
  values (inv.team_id, auth.uid(), inv.role, 'active')
  on conflict on constraint team_staff_pkey do update set role = excluded.role, status = 'active';
  update staff_invites set used_by = auth.uid(), used_at = now() where id = inv.id;
  return query select t.id, t.name, inv.role::text from teams t where t.id = inv.team_id;
end; $$;
revoke all on function join_staff(text) from public, anon;
grant execute on function join_staff(text) to authenticated;

commit;
