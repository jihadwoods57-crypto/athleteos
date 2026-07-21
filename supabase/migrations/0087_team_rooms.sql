-- OnStandard — position rooms (T-04, slice 1: the first-class room object).
--
-- A ROOM is a formal, sport-position unit of the team (DBs, O-line, distance group, …), distinct
-- from the ad-hoc custom GROUPS in coach_groups (0071). Rooms are creatable BEFORE athletes join,
-- can carry a staff owner, and are the anchor a room-scoped standard and (later) auto-assignment
-- hang off. THIS SLICE is only the object + its CRUD surface: no change to join_team (auto-assign)
-- and no change to scoring/resolveRequirementSet (room→athlete inheritance) — those are slice 2.
--
-- RLS: any team member may READ the room list (an athlete will see their room); team staff may
-- write. Forward-only, idempotent.
--
-- GUARDRAIL: authored + statically reviewed; NOT applied to live here (founder applies via
-- `supabase db push` + `npm run test:rls` at the next go-live batch).

create table if not exists team_rooms (
  id             uuid primary key default gen_random_uuid(),
  team_id        uuid not null references teams(id) on delete cascade,
  -- stable machine key (slug of the label at creation) so a later auto-assign can map a position
  -- to a room without depending on the display label; unique per team.
  key            text not null check (char_length(key) between 1 and 40),
  label          text not null check (char_length(label) between 1 and 40),
  sort           int not null default 0,
  -- the staff member who owns this room (position coach). on delete set null so a staff erasure
  -- (0079) is never blocked by this FK; the room belongs to the team (team_id cascade).
  staff_owner_id uuid references profiles(id) on delete set null,
  created_by     uuid not null default auth.uid(),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (team_id, key)
);
create index team_rooms_team on team_rooms(team_id);

alter table team_rooms enable row level security;

-- Members read their team's rooms; staff read + write.
drop policy if exists tr_read on team_rooms;
create policy tr_read on team_rooms
  for select using (
    is_team_staff(team_id)
    or exists (
      select 1 from team_members m
      where m.team_id = team_rooms.team_id
        and m.athlete_id = auth.uid() and m.status = 'active')
  );
drop policy if exists tr_staff_insert on team_rooms;
create policy tr_staff_insert on team_rooms
  for insert with check (is_team_staff(team_id));
drop policy if exists tr_staff_update on team_rooms;
create policy tr_staff_update on team_rooms
  for update using (is_team_staff(team_id)) with check (is_team_staff(team_id));
drop policy if exists tr_staff_delete on team_rooms;
create policy tr_staff_delete on team_rooms
  for delete using (is_team_staff(team_id));

comment on table team_rooms is
  'First-class position rooms (T-04). Distinct from ad-hoc coach_groups (0071). Slice 1 = the object '
  '+ CRUD; auto-assign on join and room-scoped standard inheritance are a later slice.';
