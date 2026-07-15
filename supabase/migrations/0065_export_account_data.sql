-- OnStandard — server-side account data export (GDPR Art. 15 access / Art. 20 portability;
-- CCPA "right to know"). The companion to delete_account() (0007): the same account whose data
-- can be ERASED can now be EXPORTED in full, server-side.
--
-- THE GAP (compliance audit 2026-07-15): the in-app "Export my data" built a JSON snapshot from
-- the DEVICE's local state only (src/core/dataExport.ts) — identity, targets, local history,
-- PRs — while the UI claimed a copy of "everything in your account". It omitted the server-held
-- records the privacy policy §3 says we process: messages, coach comments/feedback, memory facts
-- (allergies/dislikes), guardian-consent records, subscription, device tokens, notifications.
-- The client now merges THIS function's output with the local snapshot so the export is complete.
--
-- SECURITY: SECURITY DEFINER so it can read across the caller's own rows regardless of RLS
-- scope, but EVERY subquery is keyed to auth.uid() — it returns ONLY the caller's own data and
-- nothing about anyone else. Fails closed when not signed in (auth.uid() null -> all-null).
-- Whole rows are captured with to_jsonb(t) so the export stays complete as columns evolve.
--
-- GUARDRAIL: authored only — NOT applied to live by the audit. Founder applies at go-live
-- (supabase db reset on a throwaway stack, run supabase/tests, then db push).

create or replace function export_account_data() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'exported_at', now(),
    'user_id', auth.uid(),
    'profile',             (select to_jsonb(p)  from profiles p              where p.id = auth.uid()),
    'athlete_profile',     (select to_jsonb(ap) from athlete_profiles ap     where ap.athlete_id = auth.uid()),
    'subscription',        (select to_jsonb(s)  from subscriptions s         where s.owner_id = auth.uid()),
    'performance_profile', (select to_jsonb(pp) from performance_profiles pp where pp.athlete_id = auth.uid()),
    'days',           (select coalesce(jsonb_agg(to_jsonb(d)),  '[]'::jsonb) from days d                    where d.athlete_id = auth.uid()),
    'meals',          (select coalesce(jsonb_agg(to_jsonb(m)),  '[]'::jsonb) from meals m                   where m.athlete_id = auth.uid()),
    'checkins',       (select coalesce(jsonb_agg(to_jsonb(c)),  '[]'::jsonb) from checkins c                where c.athlete_id = auth.uid()),
    'messages_sent',  (select coalesce(jsonb_agg(to_jsonb(mg)), '[]'::jsonb) from messages mg               where mg.sender_id = auth.uid()),
    'meal_comments',  (select coalesce(jsonb_agg(to_jsonb(mc)), '[]'::jsonb) from meal_comments mc          where mc.author_id = auth.uid()),
    'memory_facts',   (select coalesce(jsonb_agg(to_jsonb(mf)), '[]'::jsonb) from athlete_memory_facts mf   where mf.athlete_id = auth.uid()),
    'guardian_consent',(select coalesce(jsonb_agg(to_jsonb(g)), '[]'::jsonb) from guardian_consent_requests g where g.athlete_id = auth.uid()),
    'device_tokens',  (select coalesce(jsonb_agg(to_jsonb(dt)), '[]'::jsonb) from device_tokens dt          where dt.user_id = auth.uid()),
    'notifications',  (select coalesce(jsonb_agg(to_jsonb(n)),  '[]'::jsonb) from notifications n            where n.user_id = auth.uid())
  );
$$;

-- Signed-in users may export THEIR OWN data (the function is self-scoped via auth.uid()).
grant execute on function export_account_data() to authenticated;
