-- OnStandard — close the anon minor-status oracle left open by 0050.
--
-- BUG: 0050 did `revoke execute ... from anon, authenticated` on is_provable_minor() and
-- has_verified_guardian_consent(), intending them to be non-callable. But PostgreSQL grants
-- EXECUTE to the PUBLIC pseudo-role by DEFAULT on every function, and anon/authenticated
-- inherit through PUBLIC — so the revoke was a no-op and both are anon-callable via PostgREST
-- RPC today (verified live: POST /rest/v1/rpc/is_provable_minor returns a boolean, not 403).
-- That is a minor-status oracle for any uuid a caller already holds.
--
-- CORRECT FIX (and why it isn't just "revoke from everyone"):
--   The meal-photos storage policies (0050) call is_provable_minor() and
--   has_verified_guardian_consent() DIRECTLY in their WITH CHECK. A function invoked inside
--   an RLS policy is permission-checked against the INVOKING role, so `authenticated` MUST
--   keep EXECUTE or every photo upload breaks. The trigger + can_view() paths are
--   SECURITY DEFINER and call these as the owner, so they need no invoker grant.
--   => revoke from PUBLIC (this removes the anon inheritance), then re-grant ONLY
--      authenticated (the role the storage policy actually needs).
--
-- Net: anon (pre-account / public anon key) can no longer probe minor status; authenticated
-- retains exactly the access the storage policy requires. This matches the intent 0050's
-- header stated. (The pre-existing is_minor()/is_registered_minor() oracle noted in the
-- 2026-07-02 audit is the same PUBLIC-default class and is closed here too, for consistency;
-- they are likewise only invoked from SECURITY DEFINER contexts, so no re-grant is needed —
-- but authenticated is granted defensively where a policy might reference them.)

revoke execute on function is_provable_minor(uuid)            from public, anon, authenticated;
revoke execute on function has_verified_guardian_consent(uuid) from public, anon, authenticated;
grant  execute on function is_provable_minor(uuid)            to authenticated;   -- storage WITH CHECK
grant  execute on function has_verified_guardian_consent(uuid) to authenticated;  -- storage WITH CHECK

-- Same bug class on the older minor-status helpers (audit 2026-07-02, finding 3 "also
-- exposed"): close the anon oracle. These are only called from SECURITY DEFINER functions /
-- policy predicates that run in a definer context, so PUBLIC losing execute is sufficient;
-- keep authenticated for any invoker-context policy reference (messaging policies).
do $$
begin
  if to_regprocedure('public.is_minor(uuid)') is not null then
    execute 'revoke execute on function is_minor(uuid) from public, anon';
    execute 'grant  execute on function is_minor(uuid) to authenticated';
  end if;
  if to_regprocedure('public.is_registered_minor(uuid)') is not null then
    execute 'revoke execute on function is_registered_minor(uuid) from public, anon';
    execute 'grant  execute on function is_registered_minor(uuid) to authenticated';
  end if;
end $$;
