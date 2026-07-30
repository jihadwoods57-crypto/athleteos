-- OnStandard 0171 — two narrow closures from the 2026-07-30 security audit.
--
-- ============================================================================
-- 1. PHOTO BUCKETS: BOUND WHAT THEY WILL ACCEPT  (finding #7, CWE-434)
-- ============================================================================
-- Both buckets were created with `public = false` and correct per-folder RLS (0003, 0133) — but
-- with NO allowed_mime_types and NO file_size_limit. The policies confine WHERE a user may write
-- (their own auth.uid() folder) and say nothing about WHAT.
--
-- content_type is supplied entirely by the client. day.js:894 and roles.js:280 both pass
-- { contentType: 'image/jpeg' }, but that is a request parameter an attacker rewrites freely. So
-- an athlete can store text/html in their own meal-photos folder; their coach — who legitimately
-- holds can_view — later opens it through createSignedUrl and it renders as HTML on the
-- *.supabase.co origin, carrying whatever the attacker wrote.
--
-- We already do this correctly one layer over: analyze-meal magic-byte sniffs the base64 before
-- sending it to Anthropic (functions/analyze-meal, `Magic-byte sniff of a base64 image`). Storage
-- just never got the same check. Enforcing it at the BUCKET means it holds no matter what any
-- client claims, now or later.
--
-- Size: 12 MB. A full-resolution phone JPEG is ~4-6 MB, so this is ~2x headroom. The only prior
-- ceiling was the project-wide 50 MiB, which let one account burn 50 MB per request.
update storage.buckets
   set allowed_mime_types = array['image/jpeg', 'image/png', 'image/heic', 'image/heif', 'image/webp'],
       file_size_limit    = 12582912
 where id in ('meal-photos', 'progress-photos');

-- ============================================================================
-- 2. has_premium_access: STOP LETTING ANYONE PROBE ANYONE  (finding #11)
-- ============================================================================
-- has_premium_access(p_user uuid default auth.uid()) is SECURITY DEFINER and was granted to
-- `authenticated` WITH THE PARAMETER EXPOSED (0132:47, re-granted 0166:126). Any signed-in user
-- could pass someone else's id and learn their billing status.
--
-- Its own siblings in the same file get this right: my_premium_source() pins auth.uid() internally
-- and active_athlete_count(uuid, date, int) is explicitly revoked from authenticated. This one was
-- the outlier.
--
-- Verified before revoking — every real caller keeps working:
--   · deep-analysis and monthly-report call it via svc.rpc (SERVICE ROLE) -> still granted;
--   · supabase/tests/trainer_funded_test.sql runs as the test superuser -> unaffected;
--   · no RLS policy references it;
--   · NO CLIENT CALLS IT AT ALL. The proto reads my_premium_source() (roles.js:1320) and the
--     settings screen derives from that. Zero client changes needed.
--
-- The body is untouched, so entitlementParity.test.ts (which pins isPro / isPaid to this
-- predicate's semantics) is unaffected.
revoke execute on function public.has_premium_access(uuid) from public, anon, authenticated;
grant  execute on function public.has_premium_access(uuid) to service_role;

-- The self-only surface, for whenever a client does need to ask. Named like my_premium_source()
-- so the "my_*" prefix keeps meaning "about the caller, parameterless, safe to grant".
create or replace function public.my_premium_access() returns boolean
language sql stable security definer set search_path = public as $$
  select public.has_premium_access(auth.uid());
$$;
revoke all on function public.my_premium_access() from public, anon;
grant execute on function public.my_premium_access() to authenticated;

-- ROLLBACK:
--   update storage.buckets set allowed_mime_types = null, file_size_limit = null
--    where id in ('meal-photos','progress-photos');
--   grant execute on function public.has_premium_access(uuid) to authenticated;
--   drop function if exists public.my_premium_access();
