-- OnStandard — Coach OS Slice F (part 2 of 2): scoped visibility + permissions v1
-- (spec: docs/superpowers/specs/2026-07-16-coach-os-design.md, Slice F).
-- One slice, one logic migration (0055/0071 idiom; 0077 carries the enum values because a
-- freshly added enum value can't be referenced in the transaction that adds it).
--
-- WHAT THIS DOES
-- 1. staff_scope_blocks(athlete): the 0071 team_staff.scope_kind/scope_value columns come
--    alive. A staff member with a narrowing scope (position room(s) or a coach_group) stops
--    seeing athletes outside it — enforced server-side, not by client courtesy.
-- 2. can_view() surgery: the 0050 body is preserved EXACTLY (is_self hoisted outside the
--    consent gate; the minor-consent AND-gate unchanged) — the memberships path just gains
--    "and not staff_scope_blocks(athlete)". Trainer/guardian paths untouched.
-- 3. is_write_staff(team): 'readonly' staff read everything their scope allows but write
--    NOTHING — enforced in the coach-OS table policies AND inside the definer write RPCs
--    (definer functions bypass RLS, so the guard must live in the function body).
-- 4. Roster/insights RPCs (team_roster, team_day_rollup, team_intervention_outcomes)
--    filter their per-athlete rows by the caller's scope.
-- 5. set_staff_scope / set_staff_role: head coach manages staff; a staffer may self-declare
--    only their INITIAL narrowing (onboarding responsibility step) — never re-widen.
-- 6. create_staff_invite accepts the new roles; team_staff_list returns scope columns.
--
-- WHAT THIS DELIBERATELY DOES NOT DO (pragmatic v1, per spec)
-- - Coordinator/position-coach WRITE-audience capping stays client-side (the fan-out RPCs
--   still accept any scope for non-readonly staff). Reads are the hard wall; finer write
--   scoping is a later slice if the founder wants it.
-- - coach_interventions/coach_notes/announcements table reads stay team-wide for staff
--   (metadata about coach actions, not athlete data); athlete data itself is can_view-walled.
-- - org-admin + academic-advisor roles: schema room only (enum is open), no logic.

-- ---------------------------------------------------------------- 1. scope predicate
-- TRUE iff the caller is active staff on a team this athlete is active on, and NO staff row
-- of theirs covers the athlete. Coverage: null scope (whole team), a head_coach row (the
-- head coach is never narrowed — set_staff_scope refuses it, this backstops legacy rows),
-- a position scope whose comma-separated room list contains the athlete's team position,
-- or a group scope whose coach_groups row contains the athlete.
-- Non-staff viewers (guardians, trainers, org admins, the athlete) are never blocked here —
-- the first EXISTS fails and the function returns false.
create or replace function staff_scope_blocks(athlete uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
      select 1 from team_staff s
      join team_members m on m.team_id = s.team_id
      where s.staff_id = auth.uid() and s.status = 'active'
        and m.athlete_id = athlete and m.status = 'active'
    )
    and not exists (
      select 1 from team_staff s
      join team_members m on m.team_id = s.team_id
      where s.staff_id = auth.uid() and s.status = 'active'
        and m.athlete_id = athlete and m.status = 'active'
        and (
          s.scope_kind is null
          or s.role = 'head_coach'
          or (s.scope_kind = 'position' and upper(coalesce(m.position, '')) in (
                select upper(trim(x)) from unnest(string_to_array(coalesce(s.scope_value, ''), ',')) x))
          or (s.scope_kind = 'group' and exists (
                select 1 from coach_groups g
                where g.team_id = s.team_id and g.id::text = s.scope_value
                  and m.athlete_id = any (g.athlete_ids)))
        )
    );
$$;
revoke all on function staff_scope_blocks(uuid) from public, anon;
grant execute on function staff_scope_blocks(uuid) to authenticated;

-- ---------------------------------------------------------------- 2. can_view surgery
-- 0050's body verbatim except the memberships path gains the scope narrowing. is_self stays
-- hoisted OUTSIDE the consent gate (an athlete can never be gated out of their own data);
-- the minor-consent AND-gate wraps exactly the same three channels as before.
create or replace function can_view(athlete uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select is_self(athlete)
      or ( ( ( can_view_via_memberships(athlete)
               and not staff_scope_blocks(athlete) )     -- Slice F: responsibility ends here
             or is_trainer_of(athlete)    -- practice_clients not yet backfilled into org_memberships
             or is_guardian_of(athlete) ) -- guardianships not yet backfilled into org_memberships
           and (not is_provable_minor(athlete) or has_verified_guardian_consent(athlete)) );
$$;

-- ---------------------------------------------------------------- 3. write-staff predicate
create or replace function is_write_staff(t uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from team_staff s
    where s.team_id = t and s.staff_id = auth.uid() and s.status = 'active'
      and s.role <> 'readonly'
  );
$$;
revoke all on function is_write_staff(uuid) from public, anon;
grant execute on function is_write_staff(uuid) to authenticated;

-- Coach-OS table policies: reads stay is_team_staff (readonly views), writes become
-- is_write_staff. The 0071 'for all' policies are split so readonly keeps select only.
drop policy if exists ci_staff_rw on coach_interventions;
drop policy if exists ci_staff_read on coach_interventions;
create policy ci_staff_read on coach_interventions
  for select using (is_team_staff(team_id));
drop policy if exists ci_staff_insert on coach_interventions;
create policy ci_staff_insert on coach_interventions
  for insert with check (is_write_staff(team_id) and coach_id = auth.uid());

drop policy if exists cg_staff_rw on coach_groups;
drop policy if exists cg_staff_read on coach_groups;
create policy cg_staff_read on coach_groups
  for select using (is_team_staff(team_id));
drop policy if exists cg_staff_insert on coach_groups;
create policy cg_staff_insert on coach_groups
  for insert with check (is_write_staff(team_id));
drop policy if exists cg_staff_update on coach_groups;
create policy cg_staff_update on coach_groups
  for update using (is_write_staff(team_id)) with check (is_write_staff(team_id));
drop policy if exists cg_staff_delete on coach_groups;
create policy cg_staff_delete on coach_groups
  for delete using (is_write_staff(team_id));

drop policy if exists ae_staff_rw on athlete_exceptions;
drop policy if exists ae_staff_read on athlete_exceptions;
create policy ae_staff_read on athlete_exceptions
  for select using (is_team_staff(team_id));
drop policy if exists ae_staff_insert on athlete_exceptions;
create policy ae_staff_insert on athlete_exceptions
  for insert with check (is_write_staff(team_id));
drop policy if exists ae_staff_update on athlete_exceptions;
create policy ae_staff_update on athlete_exceptions
  for update using (is_write_staff(team_id)) with check (is_write_staff(team_id));
drop policy if exists ae_staff_delete on athlete_exceptions;
create policy ae_staff_delete on athlete_exceptions
  for delete using (is_write_staff(team_id));
-- ae_athlete_read (athlete sees own excused windows) is untouched.

drop policy if exists rt_staff_rw on requirement_templates;
drop policy if exists rt_staff_read on requirement_templates;
create policy rt_staff_read on requirement_templates
  for select using (is_team_staff(team_id));
drop policy if exists rt_staff_insert on requirement_templates;
create policy rt_staff_insert on requirement_templates
  for insert with check (is_write_staff(team_id));
drop policy if exists rt_staff_update on requirement_templates;
create policy rt_staff_update on requirement_templates
  for update using (is_write_staff(team_id)) with check (is_write_staff(team_id));
drop policy if exists rt_staff_delete on requirement_templates;
create policy rt_staff_delete on requirement_templates
  for delete using (is_write_staff(team_id));

drop policy if exists cn_staff_write on coach_notes;
create policy cn_staff_write on coach_notes
  for insert with check (is_write_staff(team_id) and author_id = auth.uid());
-- cn_staff_read / cn_author_delete unchanged (readonly can read notes; only authors delete,
-- and a readonly staffer can never have authored one).

-- ---------------------------------------------------------------- 4. readonly guards in write RPCs
-- Definer functions bypass RLS, so 'readonly writes nothing' must live in the bodies.
-- Each body below is its live definition verbatim with only the gate swapped.

-- 0055 set_team_requirements: is_staff_of_team -> is_write_staff
create or replace function set_team_requirements(
  p_team uuid, p_scope_kind text, p_scope_value text, p_items jsonb
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  set_id uuid;
begin
  if not is_write_staff(p_team) then
    raise exception 'Only team staff can set requirements.';
  end if;
  insert into requirement_sets (team_id, scope_kind, scope_value, items, created_by)
  values (p_team, p_scope_kind, nullif(p_scope_value, ''), p_items, auth.uid())
  on conflict (team_id, scope_kind, coalesce(scope_value, ''))
  do update set items = excluded.items, created_by = excluded.created_by, updated_at = now()
  returning id into set_id;
  return set_id;
end; $$;

-- 0058 clear_team_requirements: is_staff_of_team -> is_write_staff
create or replace function clear_team_requirements(
  p_team uuid, p_scope_kind text, p_scope_value text
) returns boolean
language plpgsql security definer set search_path = public as $$
declare
  hit int;
begin
  if not is_write_staff(p_team) then
    raise exception 'Only team staff can change requirements.';
  end if;
  delete from requirement_sets
   where team_id = p_team and scope_kind = p_scope_kind
     and coalesce(scope_value, '') = coalesce(nullif(p_scope_value, ''), '');
  get diagnostics hit = row_count;
  return hit > 0;
end; $$;

-- 0055 assign_requirement: is_staff_of_team -> is_write_staff
create or replace function assign_requirement(
  p_team uuid, p_scope_kind text, p_scope_value text,
  p_title text, p_proof text default 'check',
  p_due_at timestamptz default null, p_due_label text default null,
  p_note text default null
) returns int
language plpgsql security definer set search_path = public as $$
declare
  n int := 0; ath record;
begin
  if not is_write_staff(p_team) then
    raise exception 'Only team staff can assign.';
  end if;
  if p_scope_kind not in ('team','position','athlete') then
    raise exception 'Bad scope.';
  end if;
  for ath in
    select tm.athlete_id from team_members tm
    where tm.team_id = p_team and tm.status = 'active'
      and (p_scope_kind = 'team'
        or (p_scope_kind = 'position' and upper(coalesce(tm.position, '')) = upper(coalesce(p_scope_value, '')))
        or (p_scope_kind = 'athlete' and tm.athlete_id = p_scope_value::uuid))
  loop
    insert into requirement_assignments
      (team_id, athlete_id, title, note, proof, due_at, due_label, created_by)
    values
      (p_team, ath.athlete_id, trim(p_title), nullif(trim(coalesce(p_note, '')), ''),
       coalesce(p_proof, 'check'), p_due_at, nullif(trim(coalesce(p_due_label, '')), ''), auth.uid());
    perform notify(ath.athlete_id, 'assignment',
      'New from your coach: ' || trim(p_title),
      coalesce(nullif(trim(coalesce(p_due_label, '')), ''), 'On your list now'));
    n := n + 1;
  end loop;
  return n;
end; $$;

-- 0055 cancel_assignment: is_staff_of_team -> is_write_staff
create or replace function cancel_assignment(p_id uuid) returns boolean
language plpgsql security definer set search_path = public as $$
declare
  hit int;
begin
  update requirement_assignments ra
     set status = 'cancelled'
   where ra.id = p_id and ra.status = 'open' and is_write_staff(ra.team_id);
  get diagnostics hit = row_count;
  return hit > 0;
end; $$;

-- 0074 post_announcement: is_team_staff -> is_write_staff
create or replace function post_announcement(
  p_team uuid, p_scope_kind text, p_scope_value text, p_title text, p_body text
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  ann_id uuid;
  n int := 0;
  ath record;
begin
  if not is_write_staff(p_team) then
    raise exception 'not team staff';
  end if;
  insert into announcements (team_id, author_id, scope_kind, scope_value, title, body)
  values (p_team, auth.uid(), coalesce(p_scope_kind,'team'),
          case when coalesce(p_scope_kind,'team') = 'team' then null else p_scope_value end,
          trim(p_title), trim(p_body))
  returning id into ann_id;

  for ath in
    select tm.athlete_id from team_members tm
    where tm.team_id = p_team and tm.status = 'active'
      and (
        coalesce(p_scope_kind,'team') = 'team'
        or (p_scope_kind = 'position' and upper(coalesce(tm.position,'')) = upper(p_scope_value))
        or (p_scope_kind = 'athlete' and tm.athlete_id::text = p_scope_value)
        or (p_scope_kind = 'group' and tm.athlete_id = any (
              select unnest(g.athlete_ids) from coach_groups g
              where g.id::text = p_scope_value and g.team_id = p_team))
      )
  loop
    perform notify(ath.athlete_id, 'announcement', trim(p_title), trim(p_body));
    n := n + 1;
  end loop;

  update announcements set sent_count = n where id = ann_id;
  return jsonb_build_object('id', ann_id, 'count', n);
end $$;

-- ---------------------------------------------------------------- 5. scoped roster + insights reads
-- 0040 team_roster: a scoped staffer's roster is their responsibility, not the whole team.
create or replace function team_roster(team uuid)
returns table (athlete_id uuid, athlete_name text, "position" text, joined_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_team_staff(team) then
    raise exception 'not authorized for this team';
  end if;
  return query
    select m.athlete_id, p.full_name, m.position, m.joined_at
    from team_members m join profiles p on p.id = m.athlete_id
    where m.team_id = team and m.status = 'active'
      and not staff_scope_blocks(m.athlete_id)
    order by coalesce(p.full_name, ''), m.joined_at;
end; $$;

-- 0076 team_day_rollup: per-athlete facts respect the caller's scope.
create or replace function team_day_rollup(p_team uuid, p_from date, p_to date)
returns table (
  athlete_id uuid, day date, "position" text, score int,
  meals_logged int, tasks_done text[], checkin_done boolean, weight_logged boolean
)
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_team_staff(p_team) then
    raise exception 'not authorized for this team';
  end if;
  if p_to < p_from or p_to - p_from > 62 then
    raise exception 'window must be 0-62 days';
  end if;
  return query
  select
    d.athlete_id,
    d.date as day,
    tm.position,
    d.score,
    coalesce((select count(*)::int from meals m
              where m.athlete_id = d.athlete_id and m.day_date = d.date), 0) as meals_logged,
    coalesce((select array_agg(t->>'id')
              from jsonb_array_elements(
                     case when jsonb_typeof(d.tasks) = 'array' then d.tasks else '[]'::jsonb end) t
              where (t->>'done') = 'true'), '{}') as tasks_done,
    (coalesce(d.checkin->>'submitted','') <> ''
      or exists (select 1 from checkins c
                 where c.athlete_id = d.athlete_id
                   and c.submitted_at::date between d.date - 6 and d.date)) as checkin_done,
    (d.current_weight is not null) as weight_logged
  from days d
  join team_members tm on tm.team_id = p_team and tm.athlete_id = d.athlete_id and tm.status = 'active'
  where d.date between p_from and p_to
    and not staff_scope_blocks(d.athlete_id)
  ;
end $$;

-- 0076 team_intervention_outcomes: same scope filter on the athlete column.
create or replace function team_intervention_outcomes(p_team uuid, p_from date)
returns table (
  intervention_id uuid, athlete_id uuid, kind text, tier text, day date,
  score_before numeric, score_after numeric, days_before int, days_after int
)
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_team_staff(p_team) then
    raise exception 'not authorized for this team';
  end if;
  return query
  select
    ci.id, ci.athlete_id, ci.kind, ci.tier, ci.day,
    (select avg(d.score) from days d where d.athlete_id = ci.athlete_id
      and d.date between ci.day - 7 and ci.day - 1 and d.score is not null),
    (select avg(d.score) from days d where d.athlete_id = ci.athlete_id
      and d.date between ci.day + 1 and ci.day + 7 and d.score is not null),
    (select count(*)::int from days d where d.athlete_id = ci.athlete_id
      and d.date between ci.day - 7 and ci.day - 1 and d.score is not null),
    (select count(*)::int from days d where d.athlete_id = ci.athlete_id
      and d.date between ci.day + 1 and ci.day + 7 and d.score is not null)
  from coach_interventions ci
  where ci.team_id = p_team and ci.day >= p_from
    and not staff_scope_blocks(ci.athlete_id);
end $$;

-- ---------------------------------------------------------------- 6. staff management RPCs
-- Head coach sets anyone's scope; a staffer may self-declare ONLY their initial narrowing
-- (the onboarding responsibility step: scope null -> narrowed). They can never widen or
-- clear their own scope — that would let a narrowed coach re-grant themselves the team.
create or replace function set_staff_scope(
  p_team uuid, p_staff uuid, p_kind text, p_value text
) returns boolean
language plpgsql security definer set search_path = public as $$
declare
  cur record;
begin
  if p_kind is not null and p_kind not in ('position','group') then
    raise exception 'Scope kind must be position or group.';
  end if;
  if p_kind is not null and (p_value is null or length(trim(p_value)) not between 1 and 120) then
    raise exception 'A narrowed scope needs a value.';
  end if;
  if p_kind = 'group' and not exists (
    select 1 from coach_groups g where g.team_id = p_team and g.id::text = trim(p_value)
  ) then
    raise exception 'That group does not exist on this team.';
  end if;
  select s.role, s.scope_kind into cur from team_staff s
   where s.team_id = p_team and s.staff_id = p_staff and s.status = 'active';
  if cur is null then
    raise exception 'No active staff member found.';
  end if;
  if cur.role = 'head_coach' and p_kind is not null then
    raise exception 'The head coach always sees the whole team.';
  end if;
  if not is_head_coach_of(p_team) then
    if p_staff <> auth.uid() or cur.scope_kind is not null or p_kind is null then
      raise exception 'Only the head coach can change scope.';
    end if;
  end if;
  update team_staff
     set scope_kind = p_kind,
         scope_value = case when p_kind is null then null else trim(p_value) end
   where team_id = p_team and staff_id = p_staff;
  return true;
end; $$;
revoke all on function set_staff_scope(uuid, uuid, text, text) from public, anon;
grant execute on function set_staff_scope(uuid, uuid, text, text) to authenticated;

-- Head coach re-roles a staff member (never the head-coach row, never to head_coach —
-- succession is deliberately out of v1).
create or replace function set_staff_role(p_team uuid, p_staff uuid, p_role text)
returns boolean
language plpgsql security definer set search_path = public as $$
declare
  hit int;
begin
  if not is_head_coach_of(p_team) then
    raise exception 'Only the head coach can change roles.';
  end if;
  if p_role not in ('coordinator','position_coach','nutritionist','readonly','assistant') then
    raise exception 'Bad role.';
  end if;
  update team_staff set role = p_role::staff_role
   where team_id = p_team and staff_id = p_staff and status = 'active' and role <> 'head_coach';
  get diagnostics hit = row_count;
  return hit > 0;
end; $$;
revoke all on function set_staff_role(uuid, uuid, text) from public, anon;
grant execute on function set_staff_role(uuid, uuid, text) to authenticated;

-- 0061 create_staff_invite: the invitable set grows to the v1 roles ('assistant' kept for
-- back-compat clients; it reads as Coordinator everywhere).
create or replace function create_staff_invite(p_team uuid, p_role text) returns text
language plpgsql security definer set search_path = public as $$
declare
  chars text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  c text; i int; taken bool;
begin
  if not is_head_coach_of(p_team) then
    raise exception 'Only the head coach can invite staff.';
  end if;
  if p_role not in ('assistant', 'coordinator', 'position_coach', 'nutritionist', 'readonly') then
    raise exception 'Invite role must be coordinator, position_coach, nutritionist, or readonly.';
  end if;
  loop
    c := '';
    for i in 1..8 loop
      c := c || substr(chars, 1 + floor(random() * length(chars))::int, 1);
    end loop;
    select exists(select 1 from staff_invites where code = c) into taken;
    exit when not taken;
  end loop;
  insert into staff_invites (team_id, role, code, created_by)
  values (p_team, p_role::staff_role, c, auth.uid());
  return c;
end; $$;

-- 0061 team_staff_list: now returns scope columns (return type changes -> drop first).
drop function if exists team_staff_list(uuid);
create function team_staff_list(p_team uuid)
returns table (staff_id uuid, role text, status text, name text, scope_kind text, scope_value text)
language sql stable security definer set search_path = public as $$
  select s.staff_id, s.role::text, s.status,
         coalesce(nullif(trim(p.coach_display_name), ''), p.full_name, 'Staff') as name,
         s.scope_kind, s.scope_value
  from team_staff s left join profiles p on p.id = s.staff_id
  where s.team_id = p_team and is_staff_of_team(p_team)
  order by (s.role = 'head_coach') desc, p.full_name;
$$;
revoke all on function team_staff_list(uuid) from public, anon;
grant execute on function team_staff_list(uuid) to authenticated;

comment on function staff_scope_blocks(uuid) is
  'Slice F: TRUE when the caller''s only staff basis for seeing this athlete is narrowed away by team_staff.scope_kind/scope_value. can_view(), team_roster(), and the insights RPCs all consult it.';
comment on function is_write_staff(uuid) is
  'Active staff whose role is not readonly. Every coach-side write (policy or definer RPC) gates on this; is_team_staff stays the read gate.';
