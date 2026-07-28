-- OnStandard — post-log meal enrichment: the AI-vs-authoritative-DB eval corpus.
--
-- WHY: the shipped photo flow grounds macros against a ~50-item CURATED table, not USDA. For any
-- food outside that table (branded products, restaurant plates), the AI's raw macro estimate rides
-- through nearly unchecked. The enrich-meal background job (fired best-effort after a meal logs)
-- resolves each detected food against USDA/Open Food Facts and (a) warms food_cache — the learned
-- store the grounder will consult for FUTURE meals — and (b) records the AI-estimate ↔ DB-truth
-- pairing HERE, building the eval dataset the brief flags as missing (AI-priority #7).
--
-- SAFETY / INVARIANTS: this pipeline NEVER touches a logged meal or its score. Post-log meal data
-- stays immutable (only the athlete's own correctMeal path may change it); a background process
-- silently rewriting a score the athlete already saw would break trust. Enrichment is forward-only:
-- it improves what future meals ground against, and measures drift — it does not re-grade the past.
--
-- PRIVACY: de-identified BY CONSTRUCTION. Rows carry only a food NAME + two macro sets + source.
-- No athlete id, no meal id, no photo, no timestamp finer than the row's own created_at. A food
-- name and its calories are not personal data, so this corpus can never carry PII even by mistake.
--
-- ACCESS: internal, like food_cache (0021) — only the enrich-meal Edge Function (service role)
-- writes it; the founder reads it via admin SQL. RLS on + grants revoked = deny-all for normal roles.
--
-- GUARDRAIL: authored only; NOT applied to live by the crew. Founder applies via `supabase db push`.
-- (Unlike 0103 this needs no client-first ordering — it adds a table nothing reads yet.)

create table if not exists public.food_enrichment_samples (
  id            uuid        primary key default gen_random_uuid(),
  detected_name text        not null,               -- the AI's detected food label (the lookup query)
  ai_protein    int,        ai_kcal  int,           -- the AI's per-food estimate for THIS food, as given
  ai_carbs      int,        ai_fat   int,
  db_name       text        not null,               -- what USDA/OFF actually matched
  db_per100     jsonb       not null,               -- { protein, kcal, carbs, fat } per 100 g (authoritative)
  source        text        not null,               -- 'usda' | 'off'
  created_at    timestamptz not null default now()
);
-- Query the corpus by food to see the population's most-logged unmatched foods, newest first.
create index if not exists food_enrichment_name on public.food_enrichment_samples (lower(detected_name), created_at desc);

alter table public.food_enrichment_samples enable row level security;
-- Only the Edge Function (service_role) touches this. Revoke the 0005 default-privilege grants from
-- anon/authenticated as defense-in-depth over the RLS deny-all (mirrors food_cache 0021).
revoke all on table public.food_enrichment_samples from anon, authenticated;
