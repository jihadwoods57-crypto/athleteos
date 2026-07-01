-- OnStandard — Performance Profile (doc-05 §4). Forward-only, idempotent.
--
-- One athlete-owned, portable row: curated summary, derived habits, preferences (mirrors Memory),
-- an append-only coach feedback log, and immutable baselines. Read-mostly: the runtime view is
-- projected from history + this row + memory. The athlete owns it; joining a new org gains ACCESS
-- (can_view), not ownership.
--
-- RLS: the athlete reads/updates their own row; a coach who can_view() may read it. Coach feedback
-- is appended via a SECURITY DEFINER RPC (so the coach can add feedback without full write of the
-- athlete's row); the athlete confirms derived facts via confirm_profile_fact.
--
-- GUARDRAIL: authored here; NOT applied to the live project. The founder applies it with the others.

create table if not exists public.performance_profiles (
  athlete_id     uuid primary key references auth.users(id) on delete cascade,
  summary        jsonb not null default '{}',   -- curated strengths/weaknesses, coach-visible narrative
  habits         jsonb not null default '{}',   -- derived+confirmed: meal timing, skipped meals, hydration
  preferences    jsonb not null default '{}',   -- favorites, budget band, dislikes/allergies (mirrors Memory)
  feedback_log   jsonb not null default '[]',   -- append-only {author_id, scope, text, at}
  baselines      jsonb not null default '{}',   -- starting score, anchor weight, onboarding inputs
  updated_at     timestamptz not null default now(),
  schema_version int not null default 1
);

alter table public.performance_profiles enable row level security;

drop policy if exists pp_read on public.performance_profiles;
create policy pp_read on public.performance_profiles for select
  using (athlete_id = auth.uid() or can_view(athlete_id));

drop policy if exists pp_self_update on public.performance_profiles;
create policy pp_self_update on public.performance_profiles for update
  using (athlete_id = auth.uid())
  with check (athlete_id = auth.uid());

drop policy if exists pp_self_insert on public.performance_profiles;
create policy pp_self_insert on public.performance_profiles for insert
  with check (athlete_id = auth.uid());

grant select, insert, update on public.performance_profiles to authenticated;

-- ---------------------------------------------------------------- coach feedback (append-only)
-- A coach who can_view the athlete appends a feedback entry without full write access to the row.
create or replace function public.add_coach_feedback(p_athlete uuid, p_scope text, p_text text)
returns public.performance_profiles
language plpgsql
security definer
set search_path = public
as $$
declare
  prof public.performance_profiles;
begin
  if not can_view(p_athlete) then
    raise exception 'not authorized to add feedback for this athlete';
  end if;

  insert into public.performance_profiles (athlete_id) values (p_athlete)
  on conflict (athlete_id) do nothing;

  update public.performance_profiles
     set feedback_log = feedback_log || jsonb_build_object(
           'author_id', auth.uid(), 'scope', p_scope, 'text', p_text, 'at', now()),
         updated_at = now()
   where athlete_id = p_athlete
   returning * into prof;

  return prof;
end;
$$;

revoke execute on function public.add_coach_feedback(uuid, text, text) from public;
grant  execute on function public.add_coach_feedback(uuid, text, text) to authenticated;

-- ---------------------------------------------------------------- athlete confirms a derived fact
-- The athlete patches their own habits/preferences (e.g. confirming an inferred meal-timing habit).
create or replace function public.confirm_profile_fact(p_athlete uuid, p_patch jsonb)
returns public.performance_profiles
language plpgsql
security definer
set search_path = public
as $$
declare
  prof public.performance_profiles;
begin
  if p_athlete <> auth.uid() then
    raise exception 'an athlete may only confirm their own facts';
  end if;

  insert into public.performance_profiles (athlete_id) values (p_athlete)
  on conflict (athlete_id) do nothing;

  update public.performance_profiles
     set habits = habits || coalesce(p_patch, '{}'::jsonb), updated_at = now()
   where athlete_id = p_athlete
   returning * into prof;

  return prof;
end;
$$;

revoke execute on function public.confirm_profile_fact(uuid, jsonb) from public;
grant  execute on function public.confirm_profile_fact(uuid, jsonb) to authenticated;
