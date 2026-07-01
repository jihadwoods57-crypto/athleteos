-- OnStandard — AI Memory facts (doc-05 §5). Forward-only, idempotent.
--
-- Structured, typed, athlete-owned facts (allergies, dislikes, favorites, habits). Append-with-
-- supersede: a correction writes a NEW row pointing supersedes_id at the old — full provenance,
-- never a hard edit. Safety kinds (allergy/dislike) inferred from behavior land 'pending_confirmation'
-- and only an athlete action flips them 'active' (the LLM never writes a safety fact directly).
--
-- RLS: the athlete has full control of their own facts; a coach may READ only the coaching-relevant
-- kinds for athletes they can see (can_view). motivation/travel/etc. stay athlete-only.
--
-- GUARDRAIL: authored here; NOT applied to the live project. The founder applies it with the others.

create table if not exists public.athlete_memory_facts (
  id            uuid primary key default gen_random_uuid(),
  athlete_id    uuid not null references auth.users(id) on delete cascade,
  kind          text not null,
  value         jsonb not null,
  confidence    numeric not null default 1 check (confidence >= 0 and confidence <= 1),
  source        text not null check (source in ('athlete_stated', 'coach_stated', 'inferred_correction', 'inferred_log')),
  evidence_n    int not null default 1,
  status        text not null default 'active' check (status in ('active', 'superseded', 'rejected', 'pending_confirmation')),
  supersedes_id uuid null references public.athlete_memory_facts(id) on delete set null,
  first_seen    timestamptz not null default now(),
  last_seen     timestamptz not null default now(),
  created_at    timestamptz not null default now()
);
create index if not exists amf_athlete_active on public.athlete_memory_facts (athlete_id, status);

alter table public.athlete_memory_facts enable row level security;

-- The athlete fully owns their own facts (read + write).
drop policy if exists mem_self on public.athlete_memory_facts;
create policy mem_self on public.athlete_memory_facts
  using (athlete_id = auth.uid())
  with check (athlete_id = auth.uid());

-- A coach may READ only the coaching-relevant kinds for athletes they can see.
drop policy if exists mem_coach_rd on public.athlete_memory_facts;
create policy mem_coach_rd on public.athlete_memory_facts for select
  using (
    can_view(athlete_id)
    and kind in ('allergy', 'dislike', 'meal_timing', 'budget', 'favorite_food', 'favorite_restaurant', 'hydration_habit')
  );

-- New tables do NOT inherit authenticated DML after 0013 — grant it explicitly (RLS scopes rows).
grant select, insert, update on public.athlete_memory_facts to authenticated;
