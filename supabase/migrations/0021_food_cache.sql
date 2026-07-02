-- OnStandard — food-lookup cache (barcode + USDA/Open Food Facts).
--
-- The food-lookup Edge Function resolves a barcode (Open Food Facts) or a food name (USDA
-- FoodData Central) into per-100g macros. This table caches every resolved lookup so repeat
-- scans/searches are instant and free (no re-hit of the external API), and over a season the
-- app accumulates its own DB of the foods athletes actually eat.
--
-- Internal cache: no client reads or writes it directly — the app calls the Edge Function, which
-- uses the service role. RLS on with NO grants denies all normal-role access (like ai_usage_daily).
--
-- Forward-only, idempotent. Numbered 0021 to sit above the 0016-0020 range already applied.

create table if not exists public.food_cache (
  source      text        not null,             -- 'off' (barcode) | 'usda' (name search)
  key         text        not null,             -- the barcode, or the normalized query string
  name        text        not null,
  serving     text,                             -- printed serving label, e.g. "1 bar (60 g)"
  per100      jsonb       not null,             -- { protein, kcal, carbs, fat } per 100 g
  attribution text,                             -- data source credit (USDA CC0 / OFF ODbL)
  synced_at   timestamptz not null default now(),
  primary key (source, key)
);

alter table public.food_cache enable row level security;
-- Only the Edge Function (service_role) touches the cache. Revoke the 0005 default-privilege
-- grants from anon/authenticated as defense-in-depth over the RLS deny-all.
revoke all on table public.food_cache from anon, authenticated;

-- Prune stale entries if the table ever grows large (food facts change rarely):
--   delete from public.food_cache where synced_at < now() - interval '180 days';
