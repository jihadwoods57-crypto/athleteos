-- 0229: meal_views, the per-thread read receipt (2026-09-10, coach inbox audit item 6)
--
-- THE PROBLEM, two-sided:
--   * The coach inbox's "unopened" queue lived in RT.coachSeenMealIds, a per-DEVICE list capped
--     at 300. Two coaches on one team, or one coach on two phones, saw different queue depths,
--     and none of them was the team's.
--   * The athlete had no way to know a coach had replied except from inside that one meal
--     screen. "Unread coach reply" needs a per-thread "last opened" stamp for the athlete too.
--
-- One table serves both. A row is (meal, viewer, seen_at): a coach opening a plate, or an
-- athlete opening their own thread, upserts their own row. It is 0043's coach_views (the DAY
-- receipt) pointed at a MEAL, and it reuses that table's exact fence:
--   * you write only your OWN row, and only on a meal you can genuinely see;
--   * you read your own rows, plus every row on a meal you can see. That second arm is what
--     makes queue depth SHARED across staff: every staff member who can view the athlete
--     (can_view, the same predicate meal_comments and coach_views already gate on) sees the
--     same set of opened plates, so "unopened" means unopened by anyone on staff. The athlete,
--     who can view their own meals, can see who opened them, exactly as coach_views lets them.
--
-- "Same team" is not re-derived here. can_view() (0081) is the established membership
-- predicate: team staff over active members, trainers over active clients, guardians with
-- verified consent, scope blocks honored. Inventing a parallel team_staff join would drift
-- from it the first time can_view learned something new.
--
-- Additive: one helper, one table, no change to any existing policy or row.

-- Can the caller see this meal? Definer so the fence does not depend on the meals table's own
-- read policy being evaluated a second time inside the policy of another table; the predicate
-- IS that policy's (0004/0081): self, or can_view of the athlete. search_path pins pg_temp
-- last, per 0219's hardening.
create or replace function meal_viewable(p_meal uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from meals m
    where m.id = p_meal and (m.athlete_id = auth.uid() or can_view(m.athlete_id))
  );
$$;
revoke all on function meal_viewable(uuid) from public;
grant execute on function meal_viewable(uuid) to authenticated;

create table if not exists meal_views (
  meal_id   uuid not null references meals(id) on delete cascade,
  viewer_id uuid not null references profiles(id) on delete cascade,
  seen_at   timestamptz not null default now(),
  primary key (meal_id, viewer_id)
);
-- The athlete's unread-reply read ("my views, newest first") and the pk both serve the coach's
-- batched "views for these meal ids" read; this one serves the athlete side.
create index if not exists meal_views_viewer_seen on meal_views (viewer_id, seen_at desc);

alter table meal_views enable row level security;
revoke all on table meal_views from anon;

-- The viewer stamps their own receipt, only on a meal they can really see. Re-opening a thread
-- refreshes seen_at via upsert, hence the update policy with the same fence (0043's shape).
drop policy if exists meal_views_insert_own on meal_views;
create policy meal_views_insert_own on meal_views
  for insert with check (viewer_id = auth.uid() and meal_viewable(meal_id));
drop policy if exists meal_views_update_own on meal_views;
create policy meal_views_update_own on meal_views
  for update using (viewer_id = auth.uid())
  with check (viewer_id = auth.uid() and meal_viewable(meal_id));

-- Own rows, plus every row on a meal you can see: staff share one queue, the athlete sees who
-- opened their plate. A stranger to the athlete sees nothing, same as the meal itself.
drop policy if exists meal_views_read on meal_views;
create policy meal_views_read on meal_views
  for select using (viewer_id = auth.uid() or meal_viewable(meal_id));

grant select, insert, update on meal_views to authenticated;
grant select, insert, update, delete on meal_views to service_role;
