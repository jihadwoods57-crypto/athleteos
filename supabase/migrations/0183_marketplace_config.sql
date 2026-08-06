-- 0183 — Coach Marketplace: the switch + the money guardrails.
-- The WebView has no feature-flags channel (src/proto/bridge.ts:372), so the marketplace ships
-- dark behind an app_config switch the proto reads at boot via one cheap RPC. Nothing renders,
-- links, or checks out while marketplace_enabled is false — flipping it is the launch.

insert into public.app_config (key, value, value_type, description) values
  ('marketplace_enabled', 'false'::jsonb, 'boolean',
   'Coach Marketplace master switch. False = zero marketplace surface in the app.'),
  ('marketplace_tier_bounds', '{
     "essential":  { "min_cents": 4900,  "max_cents": 14900 },
     "daily":      { "min_cents": 9900,  "max_cents": 29900 },
     "high_touch": { "min_cents": 19900, "max_cents": 59900 }
   }'::jsonb, 'json',
   'Per-tier monthly price bounds for marketplace coach offers. Enforced server-side at price save AND at checkout.'),
  ('marketplace_agreement_version', '"v1"'::jsonb, 'string',
   'Version stamp written into coach_agreements at hire. Bump when the coaching agreement copy changes.')
on conflict (key) do nothing;

-- ---------------------------------------------------------------- the proto''s one read
-- Everything the client needs to decide whether to show the marketplace, in one call:
-- the switch, the tier bounds (for price hints in the listing editor), the agreement version,
-- and whether THIS user may hire (adults only — is_minor() is fail-closed: unknown age = minor).
create or replace function public.marketplace_flags()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'enabled',           coalesce((select value = 'true'::jsonb from app_config where key = 'marketplace_enabled'), false),
    'tier_bounds',       coalesce((select value from app_config where key = 'marketplace_tier_bounds'), '{}'::jsonb),
    'agreement_version', coalesce((select value #>> '{}' from app_config where key = 'marketplace_agreement_version'), 'v1'),
    'can_hire',          auth.uid() is not null and not is_minor(auth.uid())
  );
$$;
grant execute on function public.marketplace_flags() to authenticated;
