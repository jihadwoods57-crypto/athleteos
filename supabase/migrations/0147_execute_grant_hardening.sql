-- OnStandard — close the "revoke from anon, authenticated" no-op across the whole tree,
-- stop a minor from reading their own guardian-consent token, and end intra-team staff
-- privilege escalation.
--
-- ============================================================================
-- THE ROOT CAUSE (this repo has hit it before and only patched two functions)
-- ============================================================================
-- PostgreSQL grants EXECUTE to the PUBLIC pseudo-role by DEFAULT on every function it
-- creates, and anon/authenticated inherit through PUBLIC. So:
--
--     revoke execute on function f() from anon, authenticated;   -- NO-OP
--
-- leaves the function callable by everyone via PostgREST RPC. 0051 discovered this and
-- verified it live ("POST /rest/v1/rpc/is_provable_minor returns a boolean, not 403"),
-- but only fixed is_provable_minor() and has_verified_guardian_consent(). Every OTHER
-- lockdown in the tree still omits `public` and is therefore still wide open. 0034's
-- comment even reasons about it backwards ("we must revoke from those roles explicitly
-- (not just public)") — public is the ONLY one that matters.
--
-- WORST CASE THIS CLOSES (critical): sync_org_membership() is SECURITY DEFINER, writes
-- org_memberships, and performs ZERO authorization checks — it takes (org, member, role,
-- team, status) straight from the caller. Any signed-in user could chain
--   search_orgs() -> discover_teams() -> sync_org_membership(org, auth.uid(), 'head_coach', team, 'active')
-- to appoint themselves head coach of any team, satisfying can_view_via_memberships() ->
-- can_view() and thereby reading every athlete's days, meals, checkins, athlete_profiles
-- and the meal-photos storage bucket. That is a full cross-tenant breach of minors' health
-- data. 0038/0053 removed the direct-insert self-appointment paths but left this RPC as an
-- equivalent write door.
--
-- WHY NOT JUST "revoke from everyone": a function invoked inside an RLS policy is
-- permission-checked against the INVOKING role, so any function referenced by a policy
-- MUST keep `authenticated`. Group B below re-grants those (the 0051 pattern).

-- ---------------------------------------------------------------- GROUP A
-- Never legitimately called by a client. Privileged writes, destructive maintenance, and
-- the admin auth-monitor surface. No re-grant: reachable only from SECURITY DEFINER
-- callers (which run as owner) or the service role.

revoke execute on function sync_org_membership(uuid, uuid, membership_role, uuid, membership_status)
  from public, anon, authenticated;
revoke execute on function ensure_team_org(uuid)                  from public, anon, authenticated;
revoke execute on function link_status_to_membership(link_status) from public, anon, authenticated;
revoke execute on function backfill_org_memberships_teams()       from public, anon, authenticated;

-- notify() is a DEFINER insert into notifications for ANY user id. Left open, any caller
-- could forge arbitrary notification/push text into any user's feed, minors included.
-- 0035's own comment claims to close this; the revoke was a no-op. Callers are all
-- `perform notify(...)` inside SECURITY DEFINER functions, so they run as owner and need
-- no invoker grant.
revoke execute on function notify(uuid, text, text, text)         from public, anon, authenticated;

-- Destructive, unauthenticated maintenance: purge_stale_data() deletes from
-- analytics_events and food_cache with no caller check whatsoever.
revoke execute on function purge_stale_data(integer)              from public, anon, authenticated;
revoke execute on function schedule_data_retention()              from public, anon, authenticated;

-- Admin auth monitor (0130/0131). These have NO internal authz check — they rely entirely
-- on the revoke that never worked. Left open they let an attacker read the admin auth log
-- (actor ids, IPs, user agents), forge admin login events to poison the anomaly baseline,
-- and advance the monitor checkpoint so a real intrusion window is skipped entirely —
-- i.e. silently disable the intrusion alerting built in 0130/0131.
revoke execute on function public.admin_pull_auth_events(timestamptz)  from public, anon, authenticated;
revoke execute on function public.admin_advance_checkpoint(timestamptz) from public, anon, authenticated;
revoke execute on function public.admin_get_checkpoint()               from public, anon, authenticated;
revoke execute on function public.admin_recent_failures(uuid, int)     from public, anon, authenticated;
revoke execute on function public.admin_ingest_login_event(text, uuid, text, inet, text, text, text, timestamptz, jsonb)
  from public, anon, authenticated;
revoke execute on function public.admin_detect_login_anomalies(uuid, inet, text, text, timestamptz, text)
  from public, anon, authenticated;
revoke execute on function public.safe_inet(text)                      from public, anon, authenticated;

-- Unauthenticated MFA-recovery oracle: each successful call CONSUMES the code, and there
-- is no rate limit on this path.
revoke execute on function public.admin_verify_recovery_code(uuid, text) from public, anon, authenticated;

-- ---------------------------------------------------------------- GROUP B
-- Read-only predicates that ARE referenced by RLS policies and/or read by the signed-in
-- admin console. Strip the anon/PUBLIC inheritance but keep `authenticated`, or the
-- policies that call them start failing for legitimate users (the 0051 lesson).

revoke execute on function is_platform_admin()                  from public, anon, authenticated;
grant  execute on function is_platform_admin()                  to authenticated;

revoke execute on function public.admin_is_aal2()               from public, anon, authenticated;
grant  execute on function public.admin_is_aal2()               to authenticated;

revoke execute on function public.admin_is_allowlisted()        from public, anon, authenticated;
grant  execute on function public.admin_is_allowlisted()        to authenticated;

revoke execute on function public.admin_recent_auth_epoch()     from public, anon, authenticated;
grant  execute on function public.admin_recent_auth_epoch()     to authenticated;

-- ============================================================================
-- GUARDIAN CONSENT: a minor could approve their own guardian
-- ============================================================================
-- 0008 stores the emailed approval `token` as a column on the same row the athlete is
-- allowed to SELECT (policy gcr_read: athlete_id = auth.uid()). RLS is ROW-level, not
-- COLUMN-level, so the minor can simply read their own token — and guardian-verify
-- (verify_jwt = false) treats possession of that token as the sole proof of guardian
-- mailbox control before writing status='verified' with the service role.
--
-- Result: a signed-in minor reads their token via PostgREST, POSTs it to the public
-- endpoint, and is "parent-approved" with no parent ever involved — defeating the
-- invariant 0008 states in its own comments ("verified set ONLY by the service_role
-- verify endpoint", "a minor can never self-verify") and the COPPA/GDPR-K control it backs.
--
-- Fix: column-level grant. The athlete keeps exactly the columns the app renders
-- (guardian status UI) and loses `token`. Row filtering still comes from gcr_read.
-- Writes are revoked outright — 0008 already routes every write through the
-- SECURITY DEFINER RPC (request_guardian_consent) or the service role, both of which
-- are unaffected by an invoker-grant revoke.

revoke select, insert, update, delete on guardian_consent_requests from authenticated;
grant  select (id, athlete_id, guardian_email, status, requested_at, verified_at)
  on guardian_consent_requests to authenticated;

-- ============================================================================
-- TEAM_STAFF: any staffer could rewrite the staff table
-- ============================================================================
-- 0002:130 `create policy ts_manage on team_staff for all using (is_team_staff(team_id))`
-- — and is_team_staff() is "ANY active staff row on this team". So a position coach could
-- update their own row to role='head_coach', delete the head coach, or insert an arbitrary
-- profile id as staff. 0038/0053 closed the analogous self-appointment paths on
-- team_members / practice_clients / guardianships; team_staff was never revisited, and
-- 0077/0082/0083 layered role SEMANTICS on top of a policy that ignores role entirely.
--
-- Split read from write: all active staff may READ the staff list; only the head coach may
-- change it. `is_team_creator` is the bootstrap escape hatch — when a coach first creates a
-- team there is no staff row yet, so is_head_coach_of() is false and the very first insert
-- would deadlock without it.

create or replace function is_team_creator(t uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from teams x where x.id = t and x.created_by = auth.uid());
$$;
revoke execute on function is_team_creator(uuid) from public, anon, authenticated;
grant  execute on function is_team_creator(uuid) to authenticated;  -- referenced by the policies below

drop policy if exists ts_manage on team_staff;

create policy ts_read on team_staff for select
  using (is_team_staff(team_id));

create policy ts_insert on team_staff for insert
  with check (is_head_coach_of(team_id) or is_team_creator(team_id));

create policy ts_update on team_staff for update
  using      (is_head_coach_of(team_id) or is_team_creator(team_id))
  with check (is_head_coach_of(team_id) or is_team_creator(team_id));

create policy ts_delete on team_staff for delete
  using (is_head_coach_of(team_id) or is_team_creator(team_id));
