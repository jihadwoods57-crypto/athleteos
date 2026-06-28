-- AthleteOS — Phase 1 go-live: delete_account RPC (Apple 5.1.1(v))
-- Additive migration. The app (src/lib/supabase/queries.ts:deleteAccount) already calls
-- rpc('delete_account'), and database.types.ts already declares it — but no migration
-- created the function. This is that function. Apple requires an in-app account deletion
-- that removes the account AND its server-side data; this does it ATOMICALLY.
--
-- HOW IT CASCADES: every athlete-owned table references profiles(id) ON DELETE CASCADE,
-- and profiles references auth.users(id) ON DELETE CASCADE (0001_schema.sql). So deleting
-- the one auth.users row removes the profile and every day/meal/checkin/link/thread the
-- user owned. Storage objects are NOT covered by that FK cascade, so we delete the user's
-- meal-photos folder explicitly first (same bucket + path convention as 0003_storage.sql).
--
-- SECURITY: SECURITY DEFINER so it can reach auth.users + storage.objects; it only ever
-- targets auth.uid() (the caller), so a signed-in user can delete ONLY their own account.
-- Fails closed when not signed in.
--
-- GUARDRAIL: authored + verified on a throwaway LOCAL postgres (see NIGHTSHIFT-LOG.md /
-- docs/FOUNDER-DECISIONS.md). NOT applied to the live project by the crew — the founder
-- applies it per-migration at go-live (D1).

create or replace function delete_account() returns void
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'must be signed in to delete account';
  end if;

  -- 1) the user's meal photos (FK cascade does not reach storage)
  delete from storage.objects
  where bucket_id = 'meal-photos'
    and (storage.foldername(name))[1] = uid::text;

  -- 2) the auth user — cascades to profiles and every athlete-owned row
  delete from auth.users where id = uid;
end; $$;

-- Explicit grant (defense in depth; 0005 default privileges also cover this).
grant execute on function delete_account() to authenticated, service_role;
