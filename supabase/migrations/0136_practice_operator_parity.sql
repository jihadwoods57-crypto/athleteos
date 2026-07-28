-- OnStandard — practice/operator parity: a TRAINER's practice gets the same coaching artifacts
-- a COACH's team already has (standing standards, assignments, interventions, notes, exceptions,
-- groups). Forward-only, idempotent. Slice C of the trainer-parity program.
--
-- WHY
-- Slices A and B unified the two operator experiences on the client: a trainer now renders the
-- same Home / Roster / Inbox / athlete deep-dive a coach does, and can already set macro targets
-- and reply on meal threads — because can_view() (0081) and coach_set_goals() (0054) BOTH already
-- authorize is_trainer_of. What a trainer still cannot do is anything backed by these six tables,
-- every one of which is `team_id uuid NOT NULL references teams(id)` gated by is_team_staff().
-- A practice has no team row, so those surfaces are capability-gated OFF in the client today.
--
-- THE SHAPE: DUAL-OWNER COLUMNS, NOT A SYNTHETIC TEAM
-- Each table gains a nullable practice_id alongside a now-nullable team_id, with a CHECK that
-- exactly one is set. Considered and REJECTED: minting a hidden teams row per practice. It would
-- have needed no new columns, but teams_read (0002) grants the team row to any active
-- team_members row, so mirroring clients into team_members makes fetchMyCoach() return a row for
-- every client — S.coach.kind flips to 'coach' and the entire client-facing noun swap inverts.
-- Worse, rls_authz_test.sql's REVOKE probe (delete the practice_clients row, assert the trainer
-- loses the client's meals) would keep passing via the team link: the strongest trainer-authz
-- test in the suite would silently go dead. Dual-owner columns keep the two link types distinct.
--
-- NULL-SAFE PREDICATES
-- Policies are written `(team_id is not null and is_team_staff(team_id)) or (practice_id is not
-- null and is_practice_staff(practice_id))`. The is-not-null guards are redundant TODAY
-- (is_team_staff(null) yields false, not null, because `s.team_id = null` matches no rows), but
-- they document the invariant and survive a future rewrite of those helpers.
--
-- ⚠ THE UNIQUE-INDEX TRAP (the load-bearing detail in this file)
-- requirement_sets' uniqueness is currently requirement_sets_unique_scope_version (0085 — it
-- REPLACED 0055's requirement_sets_unique_scope, which no longer exists), keyed on team_id.
-- With team_id nullable, EVERY practice row has team_id = null, and SQL unique indexes treat
-- nulls as DISTINCT — so a team_id-keyed index enforces nothing at all across practice rows.
-- Verified empirically both ways before shipping: two rows with identical
-- (practice_id, scope_kind, scope_value) and team_id NULL insert happily under the old key, and
-- are correctly refused under coalesce(team_id, practice_id). Hence the rebuild.
--
-- TWO consequences, and it matters which is which:
--   1. A DIRECT insert path (no ON CONFLICT) would silently accumulate duplicate 'team'-scope
--      sets per practice, and the client resolver's govern() reducer (requirements.js) would
--      become non-deterministic about which one governs. This is the quiet one.
--   2. The RPCs below name the index's exact expression list in ON CONFLICT, so a MISMATCHED
--      index fails loudly and immediately: "there is no unique or exclusion constraint matching
--      the ON CONFLICT specification". That is why set_team_requirements MUST be recreated in
--      this file — leaving 0085's team_id-keyed ON CONFLICT in place would break every COACH
--      standard save the moment this migration applies. A trainer-side migration silently
--      regressing the coach side is the sharpest risk here; rls_authz_test.sql probes it
--      directly ('set_team_requirements still works after the ON CONFLICT target was rebuilt').
--
-- SCOPE VOCABULARY (deliberate)
-- A practice's scope_kind stays the literal 'team', meaning "the practice default" — NOT a new
-- 'practice' value. resolveRequirementSet (requirements.js:131) matches on scope_kind === 'team'
-- and needs ZERO client change. 'position' is rejected for practices: practice_roster has no
-- position column, so a room-scoped practice set could never match anyone.
--
-- GUARDRAIL: authored + statically reviewed; NOT applied to live here. Founder applies via
-- `supabase db push` then `npm run test:rls` (new probes ship in this commit).

-- ---------------------------------------------------------------- practice staff predicate
-- Mirrors is_staff_of_team(t) (0055) so the two branches of every policy below read alike.
-- A practice is single-operator today, so this is owns_practice; the indirection is the seam
-- for assistant trainers later (an added `or exists (... practice_staff ...)` here, nowhere else).
create or replace function is_practice_staff(p uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select owns_practice(p);
$$;
revoke all on function is_practice_staff(uuid) from public, anon;
grant execute on function is_practice_staff(uuid) to authenticated;

-- ---------------------------------------------------------------- dual-owner columns
-- team_id keeps its FK + cascade; practice_id mirrors it. The CHECK is added under an existence
-- guard because ADD CONSTRAINT is not idempotent. Every pre-existing row has team_id set and
-- practice_id null, so num_nonnulls = 1 and the constraint validates without a backfill.
do $$
declare t text;
begin
  foreach t in array array[
    'coach_interventions','coach_groups','athlete_exceptions',
    'coach_notes','requirement_sets','requirement_assignments'
  ] loop
    execute format('alter table %I alter column team_id drop not null', t);
    execute format('alter table %I add column if not exists practice_id uuid references practices(id) on delete cascade', t);
    if not exists (select 1 from pg_constraint where conname = t || '_one_owner') then
      execute format('alter table %I add constraint %I check (num_nonnulls(team_id, practice_id) = 1)', t, t || '_one_owner');
    end if;
  end loop;
end $$;

create index if not exists ci_practice_day     on coach_interventions (practice_id, day desc);
create index if not exists cg_practice         on coach_groups (practice_id);
create index if not exists ae_practice_window  on athlete_exceptions (practice_id, starts_on, ends_on);
create index if not exists cn_practice_athlete on coach_notes (practice_id, athlete_id, created_at desc);
create index if not exists ra_practice         on requirement_assignments (practice_id, created_at desc);

-- ---------------------------------------------------------------- requirement_sets uniqueness
-- See THE UNIQUE-INDEX TRAP above. Drop BOTH historical names so this is safe on any DB whose
-- migration history stopped at 0055 or at 0085.
drop index if exists requirement_sets_unique_scope;
drop index if exists requirement_sets_unique_scope_version;
create unique index if not exists requirement_sets_unique_scope_version
  on requirement_sets (
    coalesce(team_id, practice_id), scope_kind,
    coalesce(scope_value, ''), coalesce(effective_date, '0001-01-01')
  );

-- ---------------------------------------------------------------- policies (null-safe)
-- coach_interventions (0071 + 0078 split)
drop policy if exists ci_staff_read on coach_interventions;
create policy ci_staff_read on coach_interventions
  for select using (
    (team_id is not null and is_team_staff(team_id))
    or (practice_id is not null and is_practice_staff(practice_id)));
drop policy if exists ci_staff_insert on coach_interventions;
create policy ci_staff_insert on coach_interventions
  for insert with check (
    coach_id = auth.uid()
    and ((team_id is not null and is_write_staff(team_id))
      or (practice_id is not null and is_practice_staff(practice_id))));

-- coach_groups
drop policy if exists cg_staff_read on coach_groups;
create policy cg_staff_read on coach_groups
  for select using (
    (team_id is not null and is_team_staff(team_id))
    or (practice_id is not null and is_practice_staff(practice_id)));
drop policy if exists cg_staff_insert on coach_groups;
create policy cg_staff_insert on coach_groups
  for insert with check (
    (team_id is not null and is_write_staff(team_id))
    or (practice_id is not null and is_practice_staff(practice_id)));
drop policy if exists cg_staff_update on coach_groups;
create policy cg_staff_update on coach_groups
  for update using (
    (team_id is not null and is_write_staff(team_id))
    or (practice_id is not null and is_practice_staff(practice_id)))
  with check (
    (team_id is not null and is_write_staff(team_id))
    or (practice_id is not null and is_practice_staff(practice_id)));
drop policy if exists cg_staff_delete on coach_groups;
create policy cg_staff_delete on coach_groups
  for delete using (
    (team_id is not null and is_write_staff(team_id))
    or (practice_id is not null and is_practice_staff(practice_id)));

-- athlete_exceptions (ae_athlete_read — the athlete's own excused windows — is untouched and
-- already works for either owner, since it keys on athlete_id alone.)
drop policy if exists ae_staff_read on athlete_exceptions;
create policy ae_staff_read on athlete_exceptions
  for select using (
    (team_id is not null and is_team_staff(team_id))
    or (practice_id is not null and is_practice_staff(practice_id)));
drop policy if exists ae_staff_insert on athlete_exceptions;
create policy ae_staff_insert on athlete_exceptions
  for insert with check (
    (team_id is not null and is_write_staff(team_id))
    or (practice_id is not null and is_practice_staff(practice_id)));
drop policy if exists ae_staff_update on athlete_exceptions;
create policy ae_staff_update on athlete_exceptions
  for update using (
    (team_id is not null and is_write_staff(team_id))
    or (practice_id is not null and is_practice_staff(practice_id)))
  with check (
    (team_id is not null and is_write_staff(team_id))
    or (practice_id is not null and is_practice_staff(practice_id)));
drop policy if exists ae_staff_delete on athlete_exceptions;
create policy ae_staff_delete on athlete_exceptions
  for delete using (
    (team_id is not null and is_write_staff(team_id))
    or (practice_id is not null and is_practice_staff(practice_id)));

-- coach_notes — CRITICAL (0073): the read predicate must stay STAFF-scoped, never can_view(),
-- because can_view() includes is_self() and would leak the note to the athlete it is about.
-- The practice branch is is_practice_staff(practice_id) — the trainer — for the same reason.
drop policy if exists cn_staff_read on coach_notes;
create policy cn_staff_read on coach_notes
  for select using (
    (team_id is not null and is_team_staff(team_id))
    or (practice_id is not null and is_practice_staff(practice_id)));
drop policy if exists cn_staff_write on coach_notes;
create policy cn_staff_write on coach_notes
  for insert with check (
    author_id = auth.uid()
    and ((team_id is not null and is_write_staff(team_id))
      or (practice_id is not null and is_practice_staff(practice_id))));
drop policy if exists cn_author_delete on coach_notes;
create policy cn_author_delete on coach_notes
  for delete using (
    author_id = auth.uid()
    and ((team_id is not null and is_team_staff(team_id))
      or (practice_id is not null and is_practice_staff(practice_id))));

-- requirement_sets — staff read, plus the MEMBER read that lets an athlete see the standard
-- governing them. The practice branch of req_sets_member_read is what makes the client's Plan
-- screen stop attributing the app's built-in defaults to a named trainer (proto plan.js).
drop policy if exists req_sets_staff_read on requirement_sets;
create policy req_sets_staff_read on requirement_sets
  for select using (
    (team_id is not null and is_staff_of_team(team_id))
    or (practice_id is not null and is_practice_staff(practice_id)));
drop policy if exists req_sets_member_read on requirement_sets;
create policy req_sets_member_read on requirement_sets
  for select using (
    (team_id is not null and exists (
      select 1 from team_members tm
      where tm.team_id = requirement_sets.team_id
        and tm.athlete_id = auth.uid() and tm.status = 'active'))
    or (practice_id is not null and exists (
      select 1 from practice_clients pc
      where pc.practice_id = requirement_sets.practice_id
        and pc.client_id = auth.uid() and pc.status = 'active')));

-- requirement_assignments — the athlete branch already covers a practice client (it keys on
-- athlete_id alone); only the staff branch needs the practice owner.
drop policy if exists req_asg_read on requirement_assignments;
create policy req_asg_read on requirement_assignments
  for select using (
    athlete_id = auth.uid()
    or (team_id is not null and is_staff_of_team(team_id))
    or (practice_id is not null and is_practice_staff(practice_id)));

-- ---------------------------------------------------------------- set_team_requirements (coach)
-- MUST be recreated: its ON CONFLICT names the rebuilt index's expression list. Behavior is
-- otherwise identical to 0085 (same is_write_staff gate, same signature, same versioning).
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
  on conflict (coalesce(team_id, practice_id), scope_kind, coalesce(scope_value, ''), coalesce(effective_date, '0001-01-01'))
  do update set items = excluded.items, created_by = excluded.created_by, updated_at = now()
  returning id into set_id;
  return set_id;
end; $$;
revoke all on function set_team_requirements(uuid, text, text, jsonb, date) from public, anon;
grant execute on function set_team_requirements(uuid, text, text, jsonb, date) to authenticated;

-- ---------------------------------------------------------------- set/clear (practice)
-- Mirror of set_team_requirements. scope_kind is restricted to ('team','athlete'): 'team' means
-- THE PRACTICE DEFAULT (keeping the client resolver unchanged), and 'position' is refused because
-- practice_roster carries no position, so such a set could never govern anyone.
create or replace function set_practice_requirements(
  p_practice uuid, p_scope_kind text, p_scope_value text, p_items jsonb, p_effective_date date default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  set_id uuid;
begin
  if not is_practice_staff(p_practice) then
    raise exception 'Only the practice owner can set requirements.';
  end if;
  if p_scope_kind not in ('team','athlete') then
    raise exception 'A practice standard is either the practice default or one client.';
  end if;
  insert into requirement_sets (practice_id, scope_kind, scope_value, items, created_by, effective_date)
  values (p_practice, p_scope_kind, nullif(p_scope_value, ''), p_items, auth.uid(), p_effective_date)
  on conflict (coalesce(team_id, practice_id), scope_kind, coalesce(scope_value, ''), coalesce(effective_date, '0001-01-01'))
  do update set items = excluded.items, created_by = excluded.created_by, updated_at = now()
  returning id into set_id;
  return set_id;
end; $$;
revoke all on function set_practice_requirements(uuid, text, text, jsonb, date) from public, anon;
grant execute on function set_practice_requirements(uuid, text, text, jsonb, date) to authenticated;

create or replace function clear_practice_requirements(
  p_practice uuid, p_scope_kind text, p_scope_value text
) returns boolean
language plpgsql security definer set search_path = public as $$
declare
  hit int;
begin
  if not is_practice_staff(p_practice) then
    raise exception 'Only the practice owner can change requirements.';
  end if;
  delete from requirement_sets
   where practice_id = p_practice and scope_kind = p_scope_kind
     and coalesce(scope_value, '') = coalesce(nullif(p_scope_value, ''), '');
  get diagnostics hit = row_count;
  return hit > 0;
end; $$;
revoke all on function clear_practice_requirements(uuid, text, text) from public, anon;
grant execute on function clear_practice_requirements(uuid, text, text) to authenticated;

-- ---------------------------------------------------------------- assign (practice)
-- Mirror of assign_requirement, fanning out from practice_clients. The notify() copy says
-- "trainer" — the athlete-facing noun must match who actually sent it.
create or replace function assign_practice_requirement(
  p_practice uuid, p_scope_kind text, p_scope_value text,
  p_title text, p_proof text default 'check',
  p_due_at timestamptz default null, p_due_label text default null,
  p_note text default null
) returns int
language plpgsql security definer set search_path = public as $$
declare
  n int := 0; cli record;
begin
  if not is_practice_staff(p_practice) then
    raise exception 'Only the practice owner can assign.';
  end if;
  if p_scope_kind not in ('team','athlete') then
    raise exception 'Bad scope.';
  end if;
  for cli in
    select pc.client_id from practice_clients pc
    where pc.practice_id = p_practice and pc.status = 'active'
      and (p_scope_kind = 'team' or (p_scope_kind = 'athlete' and pc.client_id = p_scope_value::uuid))
  loop
    insert into requirement_assignments
      (practice_id, athlete_id, title, note, proof, due_at, due_label, created_by)
    values
      (p_practice, cli.client_id, trim(p_title), nullif(trim(coalesce(p_note, '')), ''),
       coalesce(p_proof, 'check'), p_due_at, nullif(trim(coalesce(p_due_label, '')), ''), auth.uid());
    perform notify(cli.client_id, 'assignment',
      'New from your trainer: ' || trim(p_title),
      coalesce(nullif(trim(coalesce(p_due_label, '')), ''), 'On your list now'));
    n := n + 1;
  end loop;
  return n;
end; $$;
revoke all on function assign_practice_requirement(uuid, text, text, text, text, timestamptz, text, text) from public, anon;
grant execute on function assign_practice_requirement(uuid, text, text, text, text, timestamptz, text, text) to authenticated;

-- cancel_assignment gains the practice branch (complete_assignment is athlete-scoped and already
-- works for a practice client unchanged).
create or replace function cancel_assignment(p_id uuid) returns boolean
language plpgsql security definer set search_path = public as $$
declare
  hit int;
begin
  update requirement_assignments ra
     set status = 'cancelled'
   where ra.id = p_id and ra.status = 'open'
     and ((ra.team_id is not null and is_staff_of_team(ra.team_id))
       or (ra.practice_id is not null and is_practice_staff(ra.practice_id)));
  get diagnostics hit = row_count;
  return hit > 0;
end; $$;
revoke all on function cancel_assignment(uuid) from public, anon;
grant execute on function cancel_assignment(uuid) to authenticated;

-- ---------------------------------------------------------------- grants
-- requirement_sets / requirement_assignments stay SELECT-only (all writes go through the definer
-- RPCs above). The four direct-write tables were granted in 0098; those grants are whole-table,
-- so the new practice_id column is already covered and no re-grant is needed. Re-stating the two
-- select grants is a harmless no-op that keeps this file self-describing.
grant select on requirement_sets to authenticated;
grant select on requirement_assignments to authenticated;

comment on function is_practice_staff(uuid) is
  'Practice-side mirror of is_staff_of_team. Single-operator today (owns_practice); the seam for assistant trainers later.';
comment on index requirement_sets_unique_scope_version is
  'Keyed on coalesce(team_id, practice_id) — a plain team_id key treats every practice row''s NULL team_id as distinct, so it enforces nothing across practices. Both set_* RPCs name this exact expression list in ON CONFLICT; changing one without the other breaks standard saves.';
