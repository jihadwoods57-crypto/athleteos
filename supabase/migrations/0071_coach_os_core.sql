-- OnStandard — Coach OS slice A core (spec: docs/superpowers/specs/2026-07-16-coach-os-design.md).
-- One slice, one migration (0055 idiom). Forward-only, idempotent.
--
-- coach_interventions: every coach action on an athlete (nudge/message/assign/handled).
--   Drives the Home priority queue (a handled reason leaves the queue) AND is the raw
--   data for Insights "did the intervention work?" later. Coach-side only — athletes
--   never read it (there is deliberately NO athlete-facing policy).
-- coach_groups: named custom athlete groups (scope selector, roster filters, bulk targets).
-- athlete_exceptions: excused windows (travel/injury/absence). Athlete READS their own
--   (their app shows "Excused"); only staff write.
-- team_staff scope columns: WHERE a staff member's responsibility ends (null = whole team).
--   Enforcement in can_view() lands in Slice F with the scoped roles — 0050's consent
--   logic makes that surgery its own reviewed change. Columns land now so groups/UI
--   and Slice F have the shape.

create table if not exists coach_interventions (
  id          uuid primary key default gen_random_uuid(),
  team_id     uuid not null references teams(id) on delete cascade,
  athlete_id  uuid not null,
  coach_id    uuid not null default auth.uid(),
  kind        text not null check (kind in ('nudge','message','assign','handled')),
  reason_key  text,                          -- priority signature, e.g. 'overdue:breakfast+lunch'
  tier        text check (tier in ('critical','below','due_soon')),
  day         date not null default (now() at time zone 'utc')::date,
  note        text,
  created_at  timestamptz not null default now()
);
create index if not exists ci_team_day  on coach_interventions (team_id, day desc);
create index if not exists ci_athlete   on coach_interventions (athlete_id, created_at desc);
alter table coach_interventions enable row level security;
drop policy if exists ci_staff_rw on coach_interventions;
create policy ci_staff_rw on coach_interventions
  for all using (is_team_staff(team_id))
  with check (is_team_staff(team_id) and coach_id = auth.uid());

create table if not exists coach_groups (
  id          uuid primary key default gen_random_uuid(),
  team_id     uuid not null references teams(id) on delete cascade,
  name        text not null check (char_length(name) between 1 and 40),
  athlete_ids uuid[] not null default '{}',
  created_by  uuid not null default auth.uid(),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists cg_team on coach_groups (team_id);
alter table coach_groups enable row level security;
drop policy if exists cg_staff_rw on coach_groups;
create policy cg_staff_rw on coach_groups
  for all using (is_team_staff(team_id))
  with check (is_team_staff(team_id));

create table if not exists athlete_exceptions (
  id          uuid primary key default gen_random_uuid(),
  team_id     uuid not null references teams(id) on delete cascade,
  athlete_id  uuid not null,
  starts_on   date not null default (now() at time zone 'utc')::date,
  ends_on     date not null default (now() at time zone 'utc')::date,
  reason      text check (reason is null or char_length(reason) <= 120),
  created_by  uuid not null default auth.uid(),
  created_at  timestamptz not null default now(),
  check (ends_on >= starts_on)
);
create index if not exists ae_team_window on athlete_exceptions (team_id, starts_on, ends_on);
alter table athlete_exceptions enable row level security;
drop policy if exists ae_staff_rw on athlete_exceptions;
create policy ae_staff_rw on athlete_exceptions
  for all using (is_team_staff(team_id))
  with check (is_team_staff(team_id));
drop policy if exists ae_athlete_read on athlete_exceptions;
create policy ae_athlete_read on athlete_exceptions
  for select using (athlete_id = auth.uid());

do $$ begin
  if not exists (select 1 from information_schema.columns
                 where table_name = 'team_staff' and column_name = 'scope_kind') then
    alter table team_staff add column scope_kind text
      check (scope_kind is null or scope_kind in ('position','group'));
    alter table team_staff add column scope_value text;
  end if;
end $$;

comment on table coach_interventions is
  'Every coach action on an athlete. kind=handled clears a priority card; all kinds feed Insights intervention-outcome analysis.';
