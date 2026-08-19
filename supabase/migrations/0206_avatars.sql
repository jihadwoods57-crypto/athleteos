-- 0206: profile pictures.
--
-- One public bucket, one deterministic path per user (avatars/<uid>/avatar.jpg), owner-write.
-- The deterministic path is the design decision that makes the whole feature cheap: every
-- surface (coach roster, meal-thread facepiles, members sheet, parent cards) can render a
-- connected account's photo from the user id alone -- no profiles column, no RPC changes, no
-- signed-URL fan-out, no cross-table RLS to reason about. A missing object 404s and the UI
-- keeps its initials.
--
-- Public read is deliberate and follows 0200's verified-profile card precedent: the path is
-- keyed by an unguessable uuid, the object is a ~256px square the user themselves chose as
-- their face for connected accounts, and the bucket enforces a small size cap and image-only
-- MIME types. Writes stay owner-only via the 0003 meal-photos policy shape (first path
-- segment must be auth.uid()).

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', true, 524288, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set
  public = true,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists avatar_owner_insert on storage.objects;
create policy avatar_owner_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists avatar_owner_update on storage.objects;
create policy avatar_owner_update on storage.objects for update to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists avatar_owner_delete on storage.objects;
create policy avatar_owner_delete on storage.objects for delete to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
