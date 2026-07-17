-- OnStandard — Coach OS Slice B: per-athlete private coach notes.
-- Notes ABOUT an athlete (not tied to a meal — that's 0068's meal_comments kind='note').
-- Visible to team STAFF only; the athlete must NEVER read their own notes.
-- CRITICAL: the read policy is is_team_staff(team_id), NOT can_view(athlete_id) —
-- can_view() includes is_self(), which would leak the note to the athlete it's about.
-- Forward-only, idempotent (create-if-not-exists + guarded policy recreate).

create table if not exists coach_notes (
  id          uuid primary key default gen_random_uuid(),
  team_id     uuid not null references teams(id) on delete cascade,
  athlete_id  uuid not null references profiles(id) on delete cascade,
  author_id   uuid not null default auth.uid() references profiles(id),
  body        text not null check (char_length(body) between 1 and 4000),
  created_at  timestamptz not null default now()
);
create index if not exists cn_team_athlete on coach_notes (team_id, athlete_id, created_at desc);
alter table coach_notes enable row level security;

drop policy if exists cn_staff_read on coach_notes;
create policy cn_staff_read on coach_notes
  for select using (is_team_staff(team_id));
drop policy if exists cn_staff_write on coach_notes;
create policy cn_staff_write on coach_notes
  for insert with check (is_team_staff(team_id) and author_id = auth.uid());
drop policy if exists cn_author_delete on coach_notes;
create policy cn_author_delete on coach_notes
  for delete using (is_team_staff(team_id) and author_id = auth.uid());

comment on table coach_notes is
  'Per-athlete private staff notes. Staff-only (is_team_staff); the athlete never reads notes about themselves — do not switch to can_view.';
