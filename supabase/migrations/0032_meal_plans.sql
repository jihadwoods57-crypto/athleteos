-- OnStandard — Meal Plans. A plan is authored by a coach/nutritionist and assigned to athletes.
-- plan_json holds the PlanSlot[] (same jsonb-blob discipline as days.meals). RLS: an author manages
-- their own plans; an assigned athlete can read a plan assigned to them.
create table meal_plans (
  id           uuid primary key default gen_random_uuid(),
  author_id    uuid not null references profiles(id) on delete cascade,
  athlete_id   uuid references profiles(id) on delete cascade,   -- null = template/master
  name         text not null default 'Meal Plan',
  version      int  not null default 1,
  status       text not null default 'draft',                    -- draft | active | archived
  goal_json    jsonb not null default '{}'::jsonb,               -- protocol-builder inputs the AI received
  plan_json    jsonb not null default '[]'::jsonb,               -- PlanSlot[]
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index meal_plans_author on meal_plans(author_id, updated_at desc);
create index meal_plans_athlete on meal_plans(athlete_id, updated_at desc);
create trigger meal_plans_updated before update on meal_plans
  for each row execute function set_updated_at();

create table plan_assignments (
  id           uuid primary key default gen_random_uuid(),
  plan_id      uuid not null references meal_plans(id) on delete cascade,
  athlete_id   uuid not null references profiles(id) on delete cascade,
  assigned_by  uuid not null references profiles(id) on delete cascade,
  assigned_at  timestamptz not null default now(),
  status       text not null default 'active',                   -- active | ended
  unique (plan_id, athlete_id)
);
create index plan_assignments_athlete on plan_assignments(athlete_id, assigned_at desc);

create table meal_templates (
  id          uuid primary key default gen_random_uuid(),
  author_id   uuid not null references profiles(id) on delete cascade,
  name        text not null,
  meal_json   jsonb not null default '{}'::jsonb,                 -- a single PlanMeal
  tags        text[] not null default '{}',
  created_at  timestamptz not null default now()
);
create index meal_templates_author on meal_templates(author_id);

alter table meal_plans enable row level security;
alter table plan_assignments enable row level security;
alter table meal_templates enable row level security;

-- Author manages their own plans; an athlete may read a plan currently assigned to them.
create policy meal_plans_author_all on meal_plans
  for all using (author_id = auth.uid()) with check (author_id = auth.uid());
create policy meal_plans_athlete_read on meal_plans
  for select using (
    exists (select 1 from plan_assignments a where a.plan_id = meal_plans.id and a.athlete_id = auth.uid() and a.status = 'active')
  );

-- Assigner manages assignments they created; the assigned athlete may read theirs.
create policy plan_assignments_assigner_all on plan_assignments
  for all using (assigned_by = auth.uid()) with check (assigned_by = auth.uid());
create policy plan_assignments_athlete_read on plan_assignments
  for select using (athlete_id = auth.uid());

create policy meal_templates_author_all on meal_templates
  for all using (author_id = auth.uid()) with check (author_id = auth.uid());
