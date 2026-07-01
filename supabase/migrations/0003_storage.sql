-- OnStandard — Phase 2 Storage: meal photos
-- Path convention: meal-photos/{athlete_id}/{date}/{meal_id}.jpg
-- First path segment == athlete_id, which the policies key off.

insert into storage.buckets (id, name, public)
values ('meal-photos', 'meal-photos', false)
on conflict (id) do nothing;

-- read: the athlete + anyone with an active link (coach/trainer/parent)
create policy meal_photos_read on storage.objects for select using (
  bucket_id = 'meal-photos'
  and can_view(((storage.foldername(name))[1])::uuid)
);

-- write/update/delete: the athlete only (their own folder)
create policy meal_photos_insert on storage.objects for insert with check (
  bucket_id = 'meal-photos'
  and (storage.foldername(name))[1] = auth.uid()::text
);
create policy meal_photos_update on storage.objects for update using (
  bucket_id = 'meal-photos'
  and (storage.foldername(name))[1] = auth.uid()::text
);
create policy meal_photos_delete on storage.objects for delete using (
  bucket_id = 'meal-photos'
  and (storage.foldername(name))[1] = auth.uid()::text
);
