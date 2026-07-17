-- OnStandard — fix the meal_plans ⇄ plan_assignments RLS policy recursion (42P17).
--
-- Forward-only, idempotent (create-or-replace / drop-then-create). Applies on top of 0001–0074.
--
-- THE BUG (pre-existing; surfaced by the Slice C RLS-gate run, reproduces with zero Slice C code):
--   0032 gave meal_plans an athlete-read policy that subqueries plan_assignments:
--     meal_plans_athlete_read  USING exists(select 1 from plan_assignments a where a.plan_id = ...)
--   0053 hardened plan_assignments' WITH CHECK to subquery meal_plans:
--     plan_assignments_assigner_all  WITH CHECK ... exists(select 1 from meal_plans p where p.id = ...)
--   These two policies reference each other's table. An INSERT into plan_assignments evaluates its
--   WITH CHECK → reads meal_plans under RLS → evaluates meal_plans_athlete_read → reads
--   plan_assignments under RLS → Postgres re-enters plan_assignments policy evaluation and raises
--   "42P17: infinite recursion detected in policy for relation". Net effect on live: a coach/
--   nutritionist assigning their OWN plan to an athlete they can view errors out. Fails closed
--   (no data leak) but the assign-plan write is broken.
--
-- THE FIX (the codebase's own idiom — 0002's can_view/is_team_staff/owns_practice): move each
--   cross-table lookup into a `stable security definer` helper. A definer function owned by the
--   migration role bypasses the callee table's RLS (these tables are not FORCE ROW LEVEL SECURITY),
--   so the policy subquery no longer nests a second RLS evaluation and the dependency cycle is gone.
--   Both policies keep byte-identical semantics — only the mechanism changes.

-- does auth.uid() author this meal plan? (mirror of owns_practice)
create or replace function owns_meal_plan(p_plan uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from meal_plans p where p.id = p_plan and p.author_id = auth.uid());
$$;

-- is auth.uid() an ACTIVE assignee of this meal plan?
create or replace function is_assigned_plan(p_plan uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from plan_assignments a
    where a.plan_id = p_plan and a.athlete_id = auth.uid() and a.status = 'active'
  );
$$;

grant execute on function owns_meal_plan(uuid)   to authenticated;
grant execute on function is_assigned_plan(uuid) to authenticated;

-- meal_plans: an assigned athlete may read a plan currently assigned to them (0032 semantics,
-- now via the definer helper so it no longer triggers plan_assignments RLS).
drop policy if exists meal_plans_athlete_read on meal_plans;
create policy meal_plans_athlete_read on meal_plans for select
  using (is_assigned_plan(meal_plans.id));

-- plan_assignments: the assigner must own the row, OWN the plan, and be allowed to view the target
-- athlete (0053 semantics, now via the definer helper so it no longer triggers meal_plans RLS).
drop policy if exists plan_assignments_assigner_all on plan_assignments;
create policy plan_assignments_assigner_all on plan_assignments for all
  using (assigned_by = auth.uid())
  with check (
    assigned_by = auth.uid()
    and owns_meal_plan(plan_id)
    and can_view(athlete_id)
  );
