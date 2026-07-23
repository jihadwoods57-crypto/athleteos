-- 0134 — Dietary restriction declarations: sync the athlete's allergies / intolerances /
-- preferences to the server so the coach's Team Dietary Sheet has real data. Until now these
-- lived only in the athlete's localStorage (on-device meal guardian), so a coach saw nothing.
--
-- A dedicated table (not a column on the sensitive athlete_profiles) keeps the RLS + grant surface
-- simple and avoids the 0103 weight-column-split gotcha. Coach-visible via can_view — this is a
-- SAFETY surface (a coach could order team meals off it), so it carries only the athlete's own
-- real declaration and is never invented client-side.

create table if not exists public.dietary_restrictions (
  athlete_id  uuid primary key references profiles(id) on delete cascade,
  data        jsonb not null default '{}'::jsonb,   -- { allergies:[{name,severity}], intolerances:[], preferences:[] }
  updated_at  timestamptz not null default now()
);

alter table public.dietary_restrictions enable row level security;

-- read: athlete or any active link (coach/trainer/parent). write: owner only.
drop policy if exists dietary_restrictions_read on public.dietary_restrictions;
create policy dietary_restrictions_read on public.dietary_restrictions
  for select using (athlete_id = auth.uid() or can_view(athlete_id));
drop policy if exists dietary_restrictions_insert on public.dietary_restrictions;
create policy dietary_restrictions_insert on public.dietary_restrictions
  for insert with check (athlete_id = auth.uid());
drop policy if exists dietary_restrictions_update on public.dietary_restrictions;
create policy dietary_restrictions_update on public.dietary_restrictions
  for update using (athlete_id = auth.uid());
drop policy if exists dietary_restrictions_delete on public.dietary_restrictions;
create policy dietary_restrictions_delete on public.dietary_restrictions
  for delete using (athlete_id = auth.uid());

-- 0013 revoked the default authenticated write grants; RLS alone still 42501s without this.
grant insert, update, delete on public.dietary_restrictions to authenticated;
