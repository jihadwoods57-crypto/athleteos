-- 0224: the avatars bucket never accepted a single upload (2026-09-08).
--
-- THE EVIDENCE. storage.objects on prod: 85 rows in meal-photos, uploaded by exactly the same
-- client code (atob -> Uint8Array -> storage.upload), and ZERO rows in avatars, ever. Every
-- athlete who tried saw "The photo didn't upload. Check your connection and try again." on a
-- phone with a perfectly good connection.
--
-- THE CAUSE. 0206 gave the bucket owner-scoped INSERT, UPDATE and DELETE policies and made it
-- public, and stopped there — a public bucket is READ through the public endpoint, so no SELECT
-- policy seemed necessary. But the client uploads with `upsert: true`, and an upsert is not an
-- insert: storage-api resolves it against the existing object, which is a row-level SELECT on
-- storage.objects under the caller's role. With no SELECT policy for `authenticated` on this
-- bucket that read is denied, the upsert fails, the client's boolean swallows the reason, and the
-- athlete is told to check their Wi-Fi. meal-photos never hit it because it uploads with
-- upsert:false and its 0003 policy set includes an owner SELECT.
--
-- THE FIX. A SELECT policy for the bucket. It is public anyway, so read is open to anon too —
-- this changes nothing about what can be seen, only about what the database will answer for.
drop policy if exists avatar_public_read on storage.objects;
create policy avatar_public_read on storage.objects for select to anon, authenticated
  using (bucket_id = 'avatars');
