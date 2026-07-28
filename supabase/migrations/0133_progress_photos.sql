-- 0133 — Progress-photo timeline: private before/after body-composition photos.
-- Path convention: progress-photos/{athlete_id}/{ts}.jpg  (first segment == athlete_id).
-- Coach-visible via the same link model as meal photos (can_view) — coaches already see meal
-- photos and weight, and the whole product is built on coach visibility. Own bucket keeps the
-- gating clean and lets retention/lifecycle rules differ from meal photos later.

insert into storage.buckets (id, name, public)
values ('progress-photos', 'progress-photos', false)
on conflict (id) do nothing;

-- read: the athlete + anyone with an active link (coach/trainer/parent)
create policy progress_photos_read on storage.objects for select using (
  bucket_id = 'progress-photos'
  and can_view(((storage.foldername(name))[1])::uuid)
);

-- write/update/delete: the athlete only (their own folder)
create policy progress_photos_insert on storage.objects for insert with check (
  bucket_id = 'progress-photos'
  and (storage.foldername(name))[1] = auth.uid()::text
);
create policy progress_photos_update on storage.objects for update using (
  bucket_id = 'progress-photos'
  and (storage.foldername(name))[1] = auth.uid()::text
);
create policy progress_photos_delete on storage.objects for delete using (
  bucket_id = 'progress-photos'
  and (storage.foldername(name))[1] = auth.uid()::text
);

-- ---- metadata table ----
create table if not exists public.progress_photos (
  id          uuid primary key default gen_random_uuid(),
  athlete_id  uuid not null references profiles(id) on delete cascade,
  photo_path  text not null,                                   -- {athlete_id}/{ts}.jpg in the bucket
  taken_on    date not null default (now() at time zone 'utc')::date,
  weight_lb   int,                                             -- optional weight captured alongside
  pose        text,                                            -- 'front' | 'side' | 'back' | free label
  note        text,
  created_at  timestamptz not null default now()
);
create index if not exists progress_photos_athlete_idx on public.progress_photos(athlete_id, taken_on desc);

alter table public.progress_photos enable row level security;

-- read: athlete or any active link (matches the storage read policy so a row is never visible
-- without its object, or vice-versa). insert/update/delete: owner only.
drop policy if exists progress_photos_row_read on public.progress_photos;
create policy progress_photos_row_read on public.progress_photos
  for select using (athlete_id = auth.uid() or can_view(athlete_id));
drop policy if exists progress_photos_row_insert on public.progress_photos;
create policy progress_photos_row_insert on public.progress_photos
  for insert with check (athlete_id = auth.uid());
drop policy if exists progress_photos_row_update on public.progress_photos;
create policy progress_photos_row_update on public.progress_photos
  for update using (athlete_id = auth.uid());
drop policy if exists progress_photos_row_delete on public.progress_photos;
create policy progress_photos_row_delete on public.progress_photos
  for delete using (athlete_id = auth.uid());

-- 0013 revoked the default authenticated write grants, so RLS alone would still 42501 on insert.
-- SELECT rides the 0005 default grant for a fresh whole-row table (no weight-style column split).
grant insert, update, delete on public.progress_photos to authenticated;
