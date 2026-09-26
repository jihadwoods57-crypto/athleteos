-- OnStandard 0250: food preferences + the plan-ideas cache (goals and eating plan, phase A1,
-- 2026-09-25).
--
-- 1. profiles.food_prefs. Plan > Nutrition gets a small "Food preferences" section: three switches
--    (budget-friendly, no-cook or dorm, grab-and-go) and two short free-text lists (likes,
--    dislikes). Usuals are filtered by the dislikes and Nia's meal ideas are shaped by all of it.
--    Shape: { budget: bool, noCook: bool, grabGo: bool, likes: [text], dislikes: [text] }, written
--    and read through proto js/food-prefs.js cleanFoodPrefs (a byte-identical copy serves the edge
--    function). A preference never outranks an allergy or a coach food rule: those stay on
--    dietary_restrictions (0134) and are applied first.
--
--    Who can see it is exactly who can see the rest of the profile row, which is the rule the spec
--    asks for: the owner reads and writes their own (profiles_self_write, 0002), staff linked to the
--    athlete read it through profiles_read -> connected() -> can_view(), which already carries the
--    minor-consent gate, and a guardian reads nothing (0081 took guardians out of can_view). No new
--    policy is needed; this project grants profiles COLUMNS explicitly (see 0236, 0243 and the
--    table-grants gotcha), so the new column gets its own select and update grants here.
--
-- 2. plan_ideas. Nia's ideas for one athlete, one day, one meal slot, so opening Plan never pays
--    for the same answer twice. Written only by meal-chat under the service role; the athlete may
--    read their own rows; nobody else can see them. meal-chat drops an athlete's rows older than a
--    week each time it writes a new one, and the profile FK cascades on account deletion.
--
-- Additive and idempotent: a new column with a default, a new table, re-runnable grants and
-- policies. Nothing existing changes shape. Safe to apply before or after the client and function
-- that use it (both treat the column and table as optional).

-- ---------------------------------------------------------------- 1. profiles.food_prefs
alter table public.profiles
  add column if not exists food_prefs jsonb not null default '{}'::jsonb;

-- Bounded: an object, and small. The client caps each list at 8 items of 30 characters.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'profiles_food_prefs_shape') then
    alter table public.profiles add constraint profiles_food_prefs_shape
      check (jsonb_typeof(food_prefs) = 'object' and pg_column_size(food_prefs) <= 4096);
  end if;
end $$;

comment on column public.profiles.food_prefs is
  'Athlete food preferences for plan ideas: {budget, noCook, grabGo, likes[], dislikes[]}. Owner writes; linked staff read through profiles_read. Never outranks dietary_restrictions. 0250.';

grant select (food_prefs) on public.profiles to authenticated;
grant update (food_prefs) on public.profiles to authenticated;

-- ---------------------------------------------------------------- 2. plan_ideas
create table if not exists public.plan_ideas (
  athlete_id  uuid not null references public.profiles(id) on delete cascade,
  day_date    date not null,
  slot        text not null check (slot ~ '^[a-z0-9-]{1,16}$'),
  prefs_key   text not null default '',
  ideas       jsonb not null default '[]'::jsonb check (jsonb_typeof(ideas) = 'array'),
  created_at  timestamptz not null default now(),
  primary key (athlete_id, day_date, slot)
);

alter table public.plan_ideas enable row level security;

drop policy if exists plan_ideas_own_read on public.plan_ideas;
create policy plan_ideas_own_read on public.plan_ideas
  for select using (athlete_id = auth.uid());

-- Read-only to the athlete; every write is the function's (service role).
revoke all on table public.plan_ideas from public, anon, authenticated;
grant select on public.plan_ideas to authenticated;
grant select, insert, update, delete on public.plan_ideas to service_role;

comment on table public.plan_ideas is
  'Nia meal ideas cached per athlete, day and meal slot for Plan > Today, so a repeat open never re-bills. Written by meal-chat (service role); the athlete reads their own. 0250.';
