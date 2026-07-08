-- OnStandard — coach-seen receipts (churn build 2026-07-04, "close the loop").
--
-- THE PROBLEM: if an athlete logs and nothing visibly comes back, the app is a food diary,
-- and diaries get abandoned. The cheapest possible "something came back" is a read receipt:
-- when a coach/trainer/parent actually OPENS an athlete's day, the athlete sees
-- "Coach Mark saw your day". Nothing is fabricated: a receipt exists only because a real
-- human really looked.
--
-- One row per (athlete, viewer, date). The viewer writes their own receipt (RLS-checked to
-- their own id AND to athletes they are genuinely linked to via can_view); the athlete reads
-- receipts about themselves. viewer_name is denormalized at write time so the athlete render
-- needs no cross-profile read (athlete->coach profile reads are not otherwise granted).

create table coach_views (
  athlete_id  uuid not null references profiles(id) on delete cascade,
  viewer_id   uuid not null references profiles(id) on delete cascade,
  -- The athlete-local ISO day being viewed (matches days.date).
  date        text not null check (date ~ '^\d{4}-\d{2}-\d{2}$'),
  viewer_name text,
  seen_at     timestamptz not null default now(),
  primary key (athlete_id, viewer_id, date)
);
create index coach_views_athlete_date on coach_views (athlete_id, date);

alter table coach_views enable row level security;

-- The viewer stamps their own receipt, only for athletes they can really see. Re-opening a
-- day refreshes seen_at via upsert, hence the update policy with the same fence.
create policy coach_views_insert_own on coach_views
  for insert with check (viewer_id = auth.uid() and can_view(athlete_id));
create policy coach_views_update_own on coach_views
  for update using (viewer_id = auth.uid())
  with check (viewer_id = auth.uid() and can_view(athlete_id));

-- The athlete sees who looked at them; the viewer sees their own receipts.
create policy coach_views_read on coach_views
  for select using (athlete_id = auth.uid() or viewer_id = auth.uid());

grant select, insert, update on coach_views to authenticated;
grant select, insert, update, delete on coach_views to service_role;
