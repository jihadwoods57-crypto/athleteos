-- OnStandard — persisted coach first-run setup state (was client-only RT.coachSetup). One row per
-- (team, step); required completion is still DERIVED from real signals (a live join code, a saved
-- team requirement_set), so this table is not the source of truth for "done" — it carries the
-- in_progress / failed / skipped nuance and lets a team's staff see the same setup progress across
-- devices. Staff-scoped RLS (is_team_staff, per 0073). Forward-only, idempotent.

create table if not exists coach_setup_state (
  team_id     uuid not null references teams(id) on delete cascade,
  -- client step keys (RT.coachSetup): mirror them verbatim so the client wiring needs no mapping.
  step        text not null check (step in ('sharedCode','standard','notif','staff','group')),
  state       text not null default 'not_started'
                check (state in ('not_started','in_progress','completed','skipped','failed')),
  -- on delete set null: a staff member deleting their account (auth.users → profiles cascade) must
  -- not be blocked by this FK — the same right-to-erasure fix 0079_staff_erasure_fk applied to every
  -- other profiles(id) reference. The row belongs to the team (team_id cascade), not this editor.
  updated_by  uuid references profiles(id) on delete set null,
  updated_at  timestamptz not null default now(),
  primary key (team_id, step)
);
alter table coach_setup_state enable row level security;

drop policy if exists css_staff_read on coach_setup_state;
create policy css_staff_read on coach_setup_state
  for select using (is_team_staff(team_id));
drop policy if exists css_staff_insert on coach_setup_state;
create policy css_staff_insert on coach_setup_state
  for insert with check (is_team_staff(team_id));
drop policy if exists css_staff_update on coach_setup_state;
create policy css_staff_update on coach_setup_state
  for update using (is_team_staff(team_id)) with check (is_team_staff(team_id));

comment on table coach_setup_state is
  'Per-team coach first-run setup steps. Required completion (sharedCode, standard) is derived from '
  'real signals; this table carries in_progress/failed/skipped and syncs progress across staff devices.';
