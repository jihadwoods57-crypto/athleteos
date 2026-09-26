-- OnStandard 0253: adaptive targets, suggested then approved (goals and eating plan, phase B,
-- 2026-09-26).
--
-- Founder, 2026-09-26: target changes need coach approval. The athlete's device looks at their
-- weight pace (at most once every 14 days, deterministic, no model call: proto
-- js/target-suggest-model.js) and, when a gaining or losing adult is off the plan's pace, files ONE
-- suggestion here: the current and proposed protein and calories, and a plain reason ("Gaining 0.2
-- lb a week against a plan of 0.5. Suggest +200 calories."). It is labelled "Suggested change" and
-- never signed as Nia.
--
-- WHO DECIDES
--   * An athlete on a team, or a trainer's client: linked staff with target-edit rights. For a team
--     that is the staff who edit the standard (can_set_team_phase's role list, 0252: head coach,
--     coordinator, nutritionist, S&C, team admin) and can view this athlete (can_view: a scoped
--     coordinator's scope, the minor-consent gate); for a practice it is the trainer. APPROVE runs
--     through the existing coach_set_goals door first (the client calls roles.coachSetGoals), so the
--     numbers become coach-set exactly as a hand edit would, and only then marks the row approved:
--     decide_target_suggestion refuses 'approved' from staff unless the athlete's stored targets
--     already equal the proposal. A row can never read approved over numbers nobody applied.
--   * A solo athlete (no team, no trainer): themselves. Approving writes the two numbers into their
--     own athlete_profiles.targets with source 'self' (the device then says "You set these").
--   * An athlete on a team or a practice client never self-approves.
--   * Guardians see nothing (not staff, not can_view since 0081).
--
-- THE RAILS THE DATABASE HOLDS (not a client courtesy)
--   * never for a provable minor (0050: unknown age is an adult);
--   * only for a gain or lose goal;
--   * at most one per athlete per 14 days, counted from the later of when the last one was made and
--     when it was decided, so a decline also buys 14 quiet days;
--   * a pending row older than 14 days is expired: nobody can decide it, and the next insert sweeps
--     it to 'expired';
--   * the calorie change is at most 250 either way and never below the 1500 floor; the protein
--     change is bounded too.
--
-- Additive: a new table, its policies and grants, a trigger and one RPC. Nothing existing changes.

create table if not exists public.target_suggestions (
  id               uuid primary key default gen_random_uuid(),
  athlete_id       uuid not null references public.profiles(id) on delete cascade,
  team_id          uuid references public.teams(id) on delete set null,
  created_at       timestamptz not null default now(),
  current_protein  int not null check (current_protein between 0 and 500),
  current_kcal     int not null check (current_kcal between 0 and 9000),
  proposed_protein int not null check (proposed_protein between 40 and 500),
  proposed_kcal    int not null check (proposed_kcal between 1500 and 9000),
  reason           text not null check (char_length(reason) between 1 and 240),
  status           text not null default 'pending' check (status in ('pending', 'approved', 'declined', 'expired')),
  decided_by       uuid references public.profiles(id) on delete set null,
  decided_at       timestamptz,
  check (abs(proposed_kcal - current_kcal) <= 250),
  check (abs(proposed_protein - current_protein) <= 60),
  check (proposed_kcal <> current_kcal or proposed_protein <> current_protein)
);

create index if not exists target_suggestions_athlete on public.target_suggestions (athlete_id, created_at desc);
create index if not exists target_suggestions_pending on public.target_suggestions (team_id, created_at desc) where status = 'pending';

comment on table public.target_suggestions is
  'Adaptive target suggestions (phase B): filed by the athlete''s device from their weight pace, decided by linked staff with target-edit rights (or by a solo athlete). Deterministic, never signed as Nia. 0253.';

-- ---------------------------------------------------------------- who may decide
create or replace function can_decide_targets_for(p_athlete uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select can_view(p_athlete) and (
    is_trainer_of(p_athlete)
    or exists (
      select 1 from team_members m
      join team_staff s on s.team_id = m.team_id
      where m.athlete_id = p_athlete and m.status = 'active'
        and s.staff_id = auth.uid() and s.status = 'active'
        and s.role::text in ('head_coach', 'coordinator', 'assistant', 'nutritionist', 's_and_c', 'team_admin')
    )
  );
$$;
revoke all on function can_decide_targets_for(uuid) from public, anon;
grant execute on function can_decide_targets_for(uuid) to authenticated;

/* Solo = no active team and no active trainer. The one definition the decide RPC uses. */
create or replace function is_solo_athlete(p_athlete uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select not exists (select 1 from team_members m where m.athlete_id = p_athlete and m.status = 'active')
     and not exists (select 1 from practice_clients pc where pc.client_id = p_athlete and pc.status = 'active');
$$;
revoke all on function is_solo_athlete(uuid) from public, anon;
grant execute on function is_solo_athlete(uuid) to authenticated;

-- ---------------------------------------------------------------- RLS
alter table public.target_suggestions enable row level security;

drop policy if exists ts_own_read on public.target_suggestions;
create policy ts_own_read on public.target_suggestions
  for select using (athlete_id = auth.uid());

drop policy if exists ts_staff_read on public.target_suggestions;
create policy ts_staff_read on public.target_suggestions
  for select using (can_decide_targets_for(athlete_id));

drop policy if exists ts_own_insert on public.target_suggestions;
create policy ts_own_insert on public.target_suggestions
  for insert with check (athlete_id = auth.uid() and status = 'pending');

-- No update or delete policy: every decision goes through decide_target_suggestion.
revoke all on table public.target_suggestions from public, anon, authenticated;
grant select, insert on public.target_suggestions to authenticated;
grant select, insert, update, delete on public.target_suggestions to service_role;

-- ---------------------------------------------------------------- the insert rails
create or replace function target_suggestions_before_insert() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_goal text;
begin
  if is_provable_minor(new.athlete_id) then
    raise exception 'no target suggestions for a minor' using errcode = '42501';
  end if;
  select lower(coalesce(ap.base_goal, '')) into v_goal from athlete_profiles ap where ap.athlete_id = new.athlete_id;
  if coalesce(v_goal, '') not in ('gain', 'build', 'gain_muscle', 'gain_weight', 'lose', 'lose_fat') then
    raise exception 'target suggestions are for a gain or lose goal' using errcode = '23514';
  end if;
  -- Sweep this athlete's stale pending rows first, so the cadence below reads the truth.
  update target_suggestions set status = 'expired'
   where athlete_id = new.athlete_id and status = 'pending' and created_at < now() - interval '14 days';
  if exists (
    select 1 from target_suggestions t
     where t.athlete_id = new.athlete_id
       and greatest(t.created_at, coalesce(t.decided_at, t.created_at)) > now() - interval '14 days'
  ) then
    raise exception 'at most one target suggestion every 14 days' using errcode = '23514';
  end if;
  new.team_id := (select m.team_id from team_members m
                   where m.athlete_id = new.athlete_id and m.status = 'active'
                   order by m.joined_at limit 1);
  new.created_at := now();
  new.status := 'pending';
  new.decided_by := null;
  new.decided_at := null;
  return new;
end $$;
revoke all on function target_suggestions_before_insert() from public, anon, authenticated;

drop trigger if exists trg_target_suggestions_before_insert on public.target_suggestions;
create trigger trg_target_suggestions_before_insert
  before insert on public.target_suggestions
  for each row execute function target_suggestions_before_insert();

-- ---------------------------------------------------------------- the decision
/* Returns the row's status after the call: 'approved', 'declined', or 'expired' when it had
   already run out (nothing else changes then). Raises on anyone who may not decide it. */
create or replace function decide_target_suggestion(p_id uuid, p_decision text) returns text
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  r target_suggestions%rowtype;
  v_self boolean;
  v_t jsonb;
begin
  if v_uid is null then raise exception 'not signed in'; end if;
  if p_decision is null or p_decision not in ('approved', 'declined') then
    raise exception 'unknown decision';
  end if;
  select * into r from target_suggestions where id = p_id for update;
  if not found then raise exception 'suggestion not found' using errcode = '42501'; end if;

  v_self := r.athlete_id = v_uid;
  if v_self then
    if not is_solo_athlete(v_uid) then
      raise exception 'your coach reviews target changes' using errcode = '42501';
    end if;
  elsif not can_decide_targets_for(r.athlete_id) then
    raise exception 'not authorized to decide this suggestion' using errcode = '42501';
  end if;

  if r.status <> 'pending' then raise exception 'already decided'; end if;
  if r.created_at < now() - interval '14 days' then
    update target_suggestions set status = 'expired' where id = p_id;
    return 'expired';
  end if;

  if p_decision = 'approved' then
    if v_self then
      insert into athlete_profiles as ap (athlete_id, targets, updated_at)
      values (v_uid, jsonb_build_object('protein', r.proposed_protein, 'calories', r.proposed_kcal, 'source', 'self'), now())
      on conflict (athlete_id) do update
        set targets = coalesce(ap.targets, '{}'::jsonb)
                      || jsonb_build_object('protein', r.proposed_protein, 'calories', r.proposed_kcal, 'source', 'self'),
            updated_at = now();
    else
      -- Staff approve through coach_set_goals FIRST (roles.coachSetGoals); this only records it.
      select ap.targets into v_t from athlete_profiles ap where ap.athlete_id = r.athlete_id;
      if v_t is null
         or (v_t ->> 'protein') is null or (v_t ->> 'calories') is null
         or round((v_t ->> 'protein')::numeric) <> r.proposed_protein
         or round((v_t ->> 'calories')::numeric) <> r.proposed_kcal then
        raise exception 'set the targets before approving' using errcode = '23514';
      end if;
    end if;
  end if;

  update target_suggestions
     set status = p_decision, decided_by = v_uid, decided_at = now()
   where id = p_id;
  return p_decision;
end $$;
revoke all on function decide_target_suggestion(uuid, text) from public, anon;
grant execute on function decide_target_suggestion(uuid, text) to authenticated;
