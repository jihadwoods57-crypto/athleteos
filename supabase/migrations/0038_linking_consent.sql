-- OnStandard — linking-consent hardening (audit 2026-07-02, item 16)
--
-- TWO GAPS on the now-live linking feature:
--
-- 1) tm_manage / pc_manage were `FOR ALL USING (is_team_staff / owns_practice)`, which let a coach
--    or trainer directly INSERT an *active* subject-side link (team_members / practice_clients) for
--    ANY profile id — flipping is_coach_link / is_trainer_link and opening an authorized-messaging
--    channel to an arbitrary athlete (possibly a MINOR) with no consent from that athlete.
--    THE FIX: staff/owners may only UPDATE and DELETE existing rows (approve a pending request,
--    remove a member, decline). They may NOT insert. Every real join already flows through the
--    athlete-driven SECURITY DEFINER RPCs (join_team / request_join_team / join_practice /
--    request_join_practice), which insert a row for auth.uid() (the athlete themselves) and bypass
--    RLS — so removing the staff INSERT capability breaks no legitimate flow and makes an athlete's
--    own action the ONLY way a link to them is created. Reads are unaffected (tm_read / pc_read).
--
-- 2) Vanity join codes allowed 4 chars (36^4 ≈ 1.7M) on unthrottled resolve/join RPCs — scriptable
--    to brute-force. Raise the floor to 6 (36^6 ≈ 2.2B), which makes guessing infeasible over HTTP.
--    Only NEW code-setting is affected; existing codes keep working (join_team doesn't check length).
--
-- GUARDRAIL: authored + statically reviewed; NOT applied to live here (next go-live batch). Behavior-
-- preserving for every real flow; it only removes an unused-but-dangerous staff/owner INSERT path.

-- ---------------------------------------------------------------- team_members: no staff INSERT
-- Replace the FOR ALL policy with UPDATE + DELETE only. team_members has no athlete INSERT policy
-- either (athletes join via the definer RPCs), so INSERT is now RPC-only by construction.
drop policy if exists tm_manage on team_members;
create policy tm_staff_update on team_members
  for update using (is_team_staff(team_id)) with check (is_team_staff(team_id));
create policy tm_staff_delete on team_members
  for delete using (is_team_staff(team_id));

-- ---------------------------------------------------------------- practice_clients: no owner INSERT
drop policy if exists pc_manage on practice_clients;
create policy pc_owner_update on practice_clients
  for update using (owns_practice(practice_id)) with check (owns_practice(practice_id));
create policy pc_owner_delete on practice_clients
  for delete using (owns_practice(practice_id));

-- ---------------------------------------------------------------- vanity codes: 6-char minimum
create or replace function set_my_team_code(new_code text)
returns text
language plpgsql security definer set search_path = public as $$
declare
  t uuid;
  up text := upper(trim(new_code));
begin
  if up !~ '^[A-Z0-9]{6,12}$' then
    raise exception 'Code must be 6 to 12 letters or numbers';
  end if;
  -- Deterministic team pick for a multi-team head coach (oldest team), so "my code" is stable
  -- rather than whichever row the planner returned (audit finding 10).
  select s.team_id into t from team_staff s
    join teams tm on tm.id = s.team_id
    where s.staff_id = auth.uid() and s.role = 'head_coach' and s.status = 'active'
    order by tm.created_at asc
    limit 1;
  if t is null then raise exception 'You do not have a team to update'; end if;
  begin
    update teams set join_code = up where id = t;
  exception when unique_violation then
    raise exception 'That code is already taken — try another';
  end;
  return up;
end; $$;

create or replace function set_my_practice_code(new_code text)
returns text
language plpgsql security definer set search_path = public as $$
declare
  p uuid;
  up text := upper(trim(new_code));
begin
  if up !~ '^[A-Z0-9]{6,12}$' then
    raise exception 'Code must be 6 to 12 letters or numbers';
  end if;
  select id into p from practices where owner_id = auth.uid()
    order by created_at asc
    limit 1;
  if p is null then raise exception 'You do not have a practice to update'; end if;
  begin
    update practices set join_code = up where id = p;
  exception when unique_violation then
    raise exception 'That code is already taken — try another';
  end;
  return up;
end; $$;
