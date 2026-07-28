-- 0105_ai_calls.sql — AI cost + latency telemetry (AI back-half, item 8a).
--
-- Captures one row per paid Anthropic call (raw token counts + model + latency), and prices it in
-- SQL so a rate change is a one-row data edit, never a code deploy. This is the "what is AI costing
-- me per meal" surface. Writes come from the edge functions via the SERVICE ROLE (see
-- _shared/ai-telemetry.ts), which bypasses RLS + grants — so the tables are deny-by-default for
-- everyone else (no anon/authenticated grant, matching the 0103 posture). The founder reads the
-- views over the admin `supabase db query --linked` path.
--
-- No PII: token COUNTS only, never prompt/response content.

-- ── raw call log ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.ai_calls (
  id                     uuid primary key default gen_random_uuid(),
  created_at             timestamptz not null default now(),
  fn                     text        not null,            -- edge function, e.g. 'analyze-meal'
  mode                   text,                            -- 'meal'|'label'|'memory'|'order' | null
  phase                  text,                            -- 'analyze'|'finalize' (meal) | null
  user_id                uuid,                            -- athlete uuid | null (anonymous)
  model                  text        not null,            -- authoritative model string (message.model)
  input_tokens           integer     not null default 0,
  output_tokens          integer     not null default 0,
  cache_creation_tokens  integer     not null default 0,  -- cache_creation_input_tokens
  cache_read_tokens      integer     not null default 0,  -- cache_read_input_tokens
  latency_ms             integer,                         -- wall-clock around the Anthropic call
  ok                     boolean     not null default true,
  error_code             text                             -- short tag on failure | null
);

create index if not exists ai_calls_created_at_idx  on public.ai_calls (created_at desc);
create index if not exists ai_calls_user_created_idx on public.ai_calls (user_id, created_at desc);
create index if not exists ai_calls_fn_created_idx   on public.ai_calls (fn, created_at desc);

alter table public.ai_calls enable row level security;
-- No policies + no grant to anon/authenticated → deny-by-default (PostgREST won't expose it to the
-- app either). The service role bypasses RLS; grant it the write/read it needs explicitly, because
-- migration 0013 revoked the default table grants (see the table-grants gotcha).
revoke all on public.ai_calls from anon, authenticated;
grant insert, select on public.ai_calls to service_role;

-- ── price book (time-versioned) ──────────────────────────────────────────────────────────────
-- One row per (model, effective_from). The cost view picks the row in effect at each call's time,
-- so a scheduled price change is just another row — no back-fill, no code change. Prices are USD
-- per 1,000,000 tokens. cache_write = 1.25x input (the 5-min ephemeral TTL analyze-meal uses);
-- cache_read = 0.1x input.
create table if not exists public.ai_model_prices (
  model                     text        not null,
  effective_from            timestamptz not null default 'epoch',
  input_usd_per_mtok        numeric     not null,
  output_usd_per_mtok       numeric     not null,
  cache_write_usd_per_mtok  numeric     not null,
  cache_read_usd_per_mtok   numeric     not null,
  primary key (model, effective_from)
);

alter table public.ai_model_prices enable row level security;
revoke all on public.ai_model_prices from anon, authenticated;
grant select on public.ai_model_prices to service_role;

-- Seed current list prices. NOTE: claude-sonnet-5 carries introductory pricing ($2/$10 per Mtok)
-- through 2026-08-31; the second row flips it to list ($3/$15) automatically on 2026-09-01. When a
-- new model or price lands, INSERT a new row (do not edit history).
insert into public.ai_model_prices
  (model, effective_from, input_usd_per_mtok, output_usd_per_mtok, cache_write_usd_per_mtok, cache_read_usd_per_mtok)
values
  ('claude-sonnet-5',            'epoch',                2.00, 10.00, 2.50, 0.20),  -- intro pricing
  ('claude-sonnet-5',            '2026-09-01T00:00:00Z', 3.00, 15.00, 3.75, 0.30),  -- reverts to list
  ('claude-opus-4-8',            'epoch',                5.00, 25.00, 6.25, 0.50),
  ('claude-haiku-4-5',           'epoch',                1.00,  5.00, 1.25, 0.10),
  ('claude-haiku-4-5-20251001',  'epoch',                1.00,  5.00, 1.25, 0.10)
on conflict (model, effective_from) do nothing;

-- ── per-call cost ────────────────────────────────────────────────────────────────────────────
-- Left join → an unpriced model surfaces as cost_usd = null (a signal to add a price row), never a
-- silent zero. The lateral picks the price effective at the call's timestamp.
create or replace view public.ai_call_costs as
select
  c.*,
  p.input_usd_per_mtok,
  p.output_usd_per_mtok,
  round(
      (c.input_tokens::numeric          / 1000000) * p.input_usd_per_mtok
    + (c.output_tokens::numeric         / 1000000) * p.output_usd_per_mtok
    + (c.cache_creation_tokens::numeric / 1000000) * p.cache_write_usd_per_mtok
    + (c.cache_read_tokens::numeric     / 1000000) * p.cache_read_usd_per_mtok
  , 6) as cost_usd
from public.ai_calls c
left join lateral (
  select *
  from public.ai_model_prices mp
  where mp.model = c.model
    and mp.effective_from <= c.created_at
  order by mp.effective_from desc
  limit 1
) p on true;

-- ── rollups ──────────────────────────────────────────────────────────────────────────────────
-- Daily spend by function + model, with latency and cache-hit visibility.
create or replace view public.ai_cost_daily as
select
  date_trunc('day', created_at)                                             as day,
  fn,
  model,
  count(*)                                                                  as calls,
  count(*) filter (where not ok)                                            as failed_calls,
  sum(input_tokens)                                                         as input_tokens,
  sum(output_tokens)                                                        as output_tokens,
  sum(cache_read_tokens)                                                    as cache_read_tokens,
  round(avg(latency_ms))                                                    as avg_latency_ms,
  max(latency_ms)                                                           as max_latency_ms,
  round(sum(cost_usd), 4)                                                   as cost_usd
from public.ai_call_costs
group by 1, 2, 3
order by 1 desc, cost_usd desc nulls last;

-- Cost per meal analysis. There is no meal/session id on analyze-meal today, so a "meal" is counted
-- as one analyze-phase call (each meal photo starts with exactly one); a clarified meal adds a
-- finalize call, so meal_cost_usd / meals folds that second call into the true per-meal number.
create or replace view public.ai_cost_per_meal as
select
  date_trunc('day', created_at)                                                     as day,
  count(*) filter (where mode = 'meal' and phase = 'analyze')                        as meals,
  count(*) filter (where fn = 'analyze-meal' and mode = 'meal')                      as meal_calls,
  round(sum(cost_usd) filter (where fn = 'analyze-meal' and mode = 'meal'), 4)       as meal_cost_usd,
  round(
    sum(cost_usd) filter (where fn = 'analyze-meal' and mode = 'meal')
      / nullif(count(*) filter (where mode = 'meal' and phase = 'analyze'), 0)
  , 4)                                                                               as cost_per_meal_usd,
  round(avg(latency_ms) filter (where fn = 'analyze-meal' and mode = 'meal'))        as avg_meal_latency_ms
from public.ai_call_costs
group by 1
order by 1 desc;
