-- OnStandard — Food Memory (Plan intelligence hub, 2026-08-06). Forward-only, idempotent.
--
-- WHY. The Plan page becomes a personal nutrition system that learns what the athlete
-- actually eats: saved usual meals, restaurant orders, and the places behind them. Memory is
-- built passively from normal logging ("You've eaten this 3x — save it?"), re-logged with one
-- tap (no photo, no AI call), and handed to analyze-meal as trusted context so a wrapped
-- Subway sandwich gets "Is this your usual order?" instead of hallucinated contents.
--
-- ACCURACY HIERARCHY (basis): 'label' (printed claims) > 'database' (exact resolved product)
-- > 'confirmed' (a saved meal the athlete has confirmed/repeated) > 'estimate' (photo read).
-- Never treat every nutrition number as equally reliable.
--
-- "Forget" is status='archived', never a hard delete — the log history the item produced
-- stays honest, and an accidental forget is recoverable.
--
-- RLS mirrors 0019 (athlete_memory_facts): the athlete fully owns their rows; a coach/trainer
-- who can_view() the athlete may READ them. Coach verification goes through the
-- coach_verify_memory_item() definer RPC below rather than an UPDATE policy, so a coach can
-- flip exactly the verified stamp and nothing else (RLS cannot scope columns; a definer can).

create table if not exists public.food_memory_places (
  id            uuid primary key default gen_random_uuid(),
  athlete_id    uuid not null references auth.users(id) on delete cascade,
  name          text not null check (char_length(name) between 1 and 80),
  kind          text not null default 'restaurant'
                check (kind in ('restaurant', 'campus', 'team', 'home', 'store', 'other')),
  times_eaten   int  not null default 1,
  last_eaten_at timestamptz not null default now(),
  status        text not null default 'active' check (status in ('active', 'archived')),
  created_at    timestamptz not null default now()
);
create index if not exists fmp_athlete on public.food_memory_places (athlete_id, status);
-- One place per name per athlete: "Subway" logged from two screens is the same Subway.
create unique index if not exists fmp_athlete_name
  on public.food_memory_places (athlete_id, lower(name)) where status = 'active';

create table if not exists public.food_memory_items (
  id             uuid primary key default gen_random_uuid(),
  athlete_id     uuid not null references auth.users(id) on delete cascade,
  place_id       uuid null references public.food_memory_places(id) on delete set null,
  name           text not null check (char_length(name) between 1 and 120),
  kind           text not null default 'meal'
                 check (kind in ('meal', 'order', 'food', 'supplement')),
  -- Component list, same shape the app's detectedRich carries:
  -- [{name, quantity?, brand?, product?, protein, kcal, carbs, fat, basis?}]
  items          jsonb not null default '[]'::jsonb,
  protein        int not null default 0 check (protein between 0 and 500),
  kcal           int not null default 0 check (kcal between 0 and 5000),
  carbs          int not null default 0 check (carbs between 0 and 1000),
  fat            int not null default 0 check (fat between 0 and 500),
  fiber          int not null default 0 check (fiber between 0 and 100),
  basis          text not null default 'confirmed'
                 check (basis in ('label', 'database', 'confirmed', 'estimate')),
  source         text not null default 'athlete_saved'
                 check (source in ('auto', 'manual', 'athlete_saved')),
  times_logged   int not null default 1,
  last_logged_at timestamptz not null default now(),
  verified_by    uuid null references auth.users(id) on delete set null,
  verified_at    timestamptz null,
  status         text not null default 'active' check (status in ('active', 'archived')),
  created_at     timestamptz not null default now()
);
create index if not exists fmi_athlete on public.food_memory_items (athlete_id, status);
create index if not exists fmi_place   on public.food_memory_items (place_id);

alter table public.food_memory_places enable row level security;
alter table public.food_memory_items  enable row level security;

-- The athlete fully owns their memory (all commands).
drop policy if exists fmp_self on public.food_memory_places;
create policy fmp_self on public.food_memory_places
  using (athlete_id = auth.uid())
  with check (athlete_id = auth.uid());
drop policy if exists fmi_self on public.food_memory_items;
create policy fmi_self on public.food_memory_items
  using (athlete_id = auth.uid())
  with check (athlete_id = auth.uid());

-- Coach/trainer read: same door every other athlete surface uses.
drop policy if exists fmp_coach_rd on public.food_memory_places;
create policy fmp_coach_rd on public.food_memory_places for select
  using (can_view(athlete_id));
drop policy if exists fmi_coach_rd on public.food_memory_items;
create policy fmi_coach_rd on public.food_memory_items for select
  using (can_view(athlete_id));

-- New tables do NOT inherit authenticated DML after 0013 — grant explicitly (RLS scopes rows).
grant select, insert, update, delete on public.food_memory_places to authenticated;
grant select, insert, update, delete on public.food_memory_items  to authenticated;

-- Coach verification. A verified saved meal is a higher-confidence reference for future
-- logging and carries a subtle "Coach Verified" badge athlete-side. Definer so no UPDATE
-- policy exists for coaches: this door can touch ONLY the verified stamp.
create or replace function public.coach_verify_memory_item(item uuid)
returns boolean
language plpgsql security definer set search_path = public as $$
declare
  a uuid;
begin
  select athlete_id into a from food_memory_items where id = item and status = 'active';
  if a is null or not can_view(a) or a = auth.uid() then
    return false; -- unknown item, not their athlete, or self-verification (meaningless)
  end if;
  update food_memory_items
     set verified_by = auth.uid(), verified_at = now()
   where id = item;
  return true;
end $$;
revoke all on function public.coach_verify_memory_item(uuid) from public;
grant execute on function public.coach_verify_memory_item(uuid) to authenticated;
