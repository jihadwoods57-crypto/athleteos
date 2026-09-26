-- OnStandard 0256: coach-assigned 60-second lessons and team focus challenges (goals and eating
-- plan, phase D, 2026-09-26).
--
-- Founder, 2026-09-26: "Do D park E". Everything here is deterministic: no model call anywhere.
--
-- LESSONS. Twelve lessons live as static content in the app (proto js/lessons-content.js). This
-- file knows only their ids and titles (lesson_ids(), lesson_title(), pinned against the app by
-- proto js/lessons.test.mjs), so a stored row can only ever name a real lesson and a push can quote
-- its title without trusting the caller's text.
--   1. lesson_assignments: a team's editor (0252 can_set_team_phase: head coach, coordinator and
--      its legacy 'assistant', nutritionist, S&C, team admin) assigns a lesson to the whole team or
--      one room, with an optional due date. Every active staffer reads the team's assignments; an
--      active athlete reads the ones that reach them (team-wide, or their own room). Editors insert
--      and delete; nobody updates (pushed_at moves only through claim_teach_push).
--   2. lesson_completions: one row per athlete and lesson (unique), written ONLY through
--      complete_lesson() for the caller themself. Read by the athlete and by the staff of a team
--      they are active on. can_view is deliberately NOT used: a guardian sees none of this.
--
-- CHALLENGES. A coach picks one weekly-focus habit, a range (14 days at most) and a goal.
--   3. team_challenges: one running per team (a partial unique index on ended_at is null), written
--      only through start_team_challenge / end_team_challenge, read by the team's staff and athletes.
--   4. PROGRESS IS COMPUTED HERE, from the stored day rows, so a phone cannot fake it:
--        focus_day_hit       the SQL port of proto weekly-focus-model.js dayFacts + dayHit
--        std_day_ctx         the port of requirements.js stdFromItems + filterItemsByDayType +
--                            plan-today-model slotOrder + day.js slotDeadline/slotGrace
--        athlete_day_ctx     the port of resolveRequirementSet (athlete > room/position > team, the
--                            version in effect on that date) plus the team's weekly pattern
--        protein_target_from the port of state.js nutritionConfigForGoal's protein half (protein
--                            never moves with the season phase, so the phase is not an input)
--      Every JS rounding (Math.round) is mirrored as floor(x + 0.5) in double precision, which is
--      exactly what Math.round does, so the two agree at the .5 boundaries too.
--      proto js/challenge-parity.test.mjs runs the JS on the fixtures embedded in
--      supabase/tests/lessons_challenges_test.sql, which asserts the same answers from this SQL.
--      KNOWN BOUNDARIES, stated rather than hidden: the device also falls back to an onboarding
--      goal/weight not yet saved to athlete_profiles, and to a solo athlete's own meal count when
--      no team standard governs; the server reads only what is stored, the same inputs the coach's
--      reconstruction reads (season-coach.js).
--   5. team_challenge_board (all staff, names included) and my_learning (the athlete: their own
--      days and the team as a COUNT, never a name).
--
-- PUSH ONCE. claim_teach_push stamps pushed_at in one conditional update and hands the send-push
-- function the audience; a second call finds it stamped and returns claimed:false. So an assignment
-- or a challenge is pushed at most once, whatever the client retries.
--
-- Additive and idempotent. The client treats every object here as optional.

-- ================================================================ 1. the lesson list
create or replace function lesson_ids() returns text[]
language sql immutable set search_path = public as $$
  select array[
    'protein-every-meal', 'breakfast-that-holds', 'carbs-are-fuel', 'before-training',
    'recovery-meal', 'hydration-basics', 'eating-on-the-road', 'dining-hall-plate',
    'game-day', 'snacks-that-count', 'nutrition-label', 'food-first-supplements'
  ]::text[];
$$;

create or replace function lesson_title(p text) returns text
language sql immutable set search_path = public as $$
  select case p
    when 'protein-every-meal' then 'Protein at every meal'
    when 'breakfast-that-holds' then 'A breakfast that holds up'
    when 'carbs-are-fuel' then 'Carbs are fuel'
    when 'before-training' then 'Eating before training'
    when 'recovery-meal' then 'The recovery meal'
    when 'hydration-basics' then 'Hydration basics'
    when 'eating-on-the-road' then 'Eating on the road'
    when 'dining-hall-plate' then 'Building a plate at the dining hall'
    when 'game-day' then 'Game-day eating'
    when 'snacks-that-count' then 'Snacks that count'
    when 'nutrition-label' then 'Reading a nutrition label'
    when 'food-first-supplements' then 'Food first: supplements'
  end;
$$;

create or replace function lesson_id_ok(p text) returns boolean
language sql immutable set search_path = public as $$
  select p is not null and p = any(lesson_ids());
$$;

grant execute on function lesson_ids() to authenticated;
grant execute on function lesson_title(text) to authenticated;
grant execute on function lesson_id_ok(text) to authenticated;

/* How a staffer is named to athletes: their own display name (0056) first; a dietitian (by role, or
   a nutrition-run team, 0202) by their own name; otherwise "Coach <last name>", the same handle
   state.js coachIdentity derives. Never an invented honorific. */
create or replace function staff_display_label(p_staff uuid, p_team uuid) returns text
language sql stable security definer set search_path = public as $$
  select coalesce((
    select coalesce(
      nullif(btrim(p.coach_display_name), ''),
      case when t.discipline = 'nutrition' or s.role::text = 'nutritionist' then nullif(btrim(p.full_name), '')
           else 'Coach ' || nullif(regexp_replace(btrim(coalesce(p.full_name, '')), '^.*\s', ''), '') end)
    from profiles p
    left join team_staff s on s.staff_id = p.id and s.team_id = p_team
    left join teams t on t.id = p_team
    where p.id = p_staff
  ), 'Your coach');
$$;
revoke all on function staff_display_label(uuid, uuid) from public, anon, authenticated;

-- ================================================================ 2. lesson_assignments
create table if not exists public.lesson_assignments (
  id          uuid primary key default gen_random_uuid(),
  team_id     uuid not null references public.teams(id) on delete cascade,
  lesson_id   text not null check (lesson_id_ok(lesson_id)),
  -- A room audience (0087). A deleted room takes its assignments with it: set null would silently
  -- widen a room's lesson to the whole team.
  room_id     uuid references public.team_rooms(id) on delete cascade,
  due_on      date,
  assigned_by uuid references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now(),
  pushed_at   timestamptz
);
create index if not exists lesson_assignments_team on public.lesson_assignments (team_id, created_at desc);
-- One live assignment of a lesson per audience: assigning it again would only push it again.
create unique index if not exists lesson_assignments_one_per_audience
  on public.lesson_assignments (team_id, lesson_id, coalesce(room_id, '00000000-0000-0000-0000-000000000000'::uuid));

comment on table public.lesson_assignments is
  'A 60-second lesson a team editor (can_set_team_phase) assigned to the team or one room, with an optional due date. Pushed once (claim_teach_push). 0256.';

create or replace function lesson_assignments_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform pg_advisory_xact_lock(hashtextextended('lesson_assignments:' || new.team_id::text, 0));
  if (select count(*) from lesson_assignments a where a.team_id = new.team_id) >= 200 then
    raise exception 'a team has at most 200 lesson assignments' using errcode = '23514';
  end if;
  if new.room_id is not null and not exists (select 1 from team_rooms r where r.id = new.room_id and r.team_id = new.team_id) then
    raise exception 'that room is not on this team' using errcode = '23514';
  end if;
  if new.due_on is not null and (new.due_on < current_date - 1 or new.due_on > current_date + 90) then
    raise exception 'a due date is today or within the next 90 days' using errcode = '23514';
  end if;
  new.assigned_by := coalesce(auth.uid(), new.assigned_by);
  new.created_at := now();
  new.pushed_at := null;              -- only claim_teach_push stamps it
  return new;
end $$;
revoke all on function lesson_assignments_guard() from public, anon, authenticated;

drop trigger if exists trg_lesson_assignments_guard on public.lesson_assignments;
create trigger trg_lesson_assignments_guard
  before insert on public.lesson_assignments
  for each row execute function lesson_assignments_guard();

/* The caller's room on a team (null = none, or not a member). */
create or replace function my_team_room(t uuid) returns uuid
language sql stable security definer set search_path = public as $$
  select m.room_id from team_members m
  where m.team_id = t and m.athlete_id = auth.uid() and m.status = 'active';
$$;
revoke all on function my_team_room(uuid) from public, anon;
grant execute on function my_team_room(uuid) to authenticated;

alter table public.lesson_assignments enable row level security;

drop policy if exists lesson_assignments_read on public.lesson_assignments;
create policy lesson_assignments_read on public.lesson_assignments
  for select using (
    is_staff_of_team(team_id)
    or (is_team_athlete(team_id) and (room_id is null or room_id = my_team_room(team_id)))
  );

drop policy if exists lesson_assignments_insert on public.lesson_assignments;
create policy lesson_assignments_insert on public.lesson_assignments
  for insert with check (can_set_team_phase(team_id));

drop policy if exists lesson_assignments_delete on public.lesson_assignments;
create policy lesson_assignments_delete on public.lesson_assignments
  for delete using (can_set_team_phase(team_id));

revoke all on table public.lesson_assignments from public, anon, authenticated;
grant select, insert, delete on public.lesson_assignments to authenticated;
grant select, insert, update, delete on public.lesson_assignments to service_role;

-- ================================================================ 3. lesson_completions
create table if not exists public.lesson_completions (
  athlete_id   uuid not null references public.profiles(id) on delete cascade,
  lesson_id    text not null check (lesson_id_ok(lesson_id)),
  completed_at timestamptz not null default now(),
  quiz_correct boolean not null default false,
  unique (athlete_id, lesson_id)
);

comment on table public.lesson_completions is
  'A lesson an athlete finished (once per lesson), with whether their quick check was right. Written only by complete_lesson() for the caller; read by the athlete and their team''s staff, never a guardian. 0256.';

/* Is the caller active staff of a team this athlete is active on? (Definer, so the policy below
   does not depend on what team_members the caller may read.) */
create or replace function is_staff_of_athletes_team(p_athlete uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from team_members m
    join team_staff s on s.team_id = m.team_id and s.staff_id = auth.uid() and s.status = 'active'
    where m.athlete_id = p_athlete and m.status = 'active'
  );
$$;
revoke all on function is_staff_of_athletes_team(uuid) from public, anon;
grant execute on function is_staff_of_athletes_team(uuid) to authenticated;

alter table public.lesson_completions enable row level security;

drop policy if exists lesson_completions_read on public.lesson_completions;
create policy lesson_completions_read on public.lesson_completions
  for select using (
    athlete_id = auth.uid()
    or is_staff_of_athletes_team(athlete_id)
  );

revoke all on table public.lesson_completions from public, anon, authenticated;
grant select on public.lesson_completions to authenticated;
grant select, insert, update, delete on public.lesson_completions to service_role;

/* The caller finished a lesson. The first finish keeps its time; a later right answer upgrades a
   wrong one (quiz_correct never goes back to false). Returns the stored row. */
create or replace function complete_lesson(p_lesson text, p_correct boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := auth.uid();
  r lesson_completions;
begin
  if v_me is null then raise exception 'not signed in' using errcode = '42501'; end if;
  if not lesson_id_ok(p_lesson) then raise exception 'unknown lesson' using errcode = '22023'; end if;
  insert into lesson_completions (athlete_id, lesson_id, quiz_correct)
  values (v_me, p_lesson, coalesce(p_correct, false))
  on conflict (athlete_id, lesson_id) do update
    set quiz_correct = lesson_completions.quiz_correct or excluded.quiz_correct
  returning * into r;
  return jsonb_build_object('lesson_id', r.lesson_id, 'completed_at', r.completed_at, 'quiz_correct', r.quiz_correct);
end $$;
revoke all on function complete_lesson(text, boolean) from public, anon;
grant execute on function complete_lesson(text, boolean) to authenticated;

-- ================================================================ 4. the weekly focus, in SQL
/* JavaScript truthiness of a JSON value. */
create or replace function _focus_truthy(v jsonb) returns boolean
language sql immutable set search_path = public as $$
  select case jsonb_typeof(v)
    when 'boolean' then (v #>> '{}')::boolean
    when 'number' then (v #>> '{}')::float8 <> 0
    when 'string' then (v #>> '{}') <> ''
    when 'object' then true
    when 'array' then true
    else false
  end;
$$;

/* weekly-focus-model.js num(): a finite number from a number or a numeric string, else null.
   (Exotic inputs the app never writes, such as hex strings or arrays, are null here.) */
create or replace function _focus_num(v jsonb) returns float8
language plpgsql immutable set search_path = public as $$
declare s text;
begin
  if v is null then return null; end if;
  case jsonb_typeof(v)
    when 'number' then return (v #>> '{}')::float8;
    when 'boolean' then return case when (v #>> '{}')::boolean then 1 else 0 end;
    when 'string' then
      s := v #>> '{}';
      if s = '' then return null; end if;
      s := btrim(s, E' \t\n\r\f\v');
      if s = '' then return 0; end if;                       -- JS Number('  ') is 0
      if s ~ '^[+-]?([0-9]+\.?[0-9]*|\.[0-9]+)([eE][+-]?[0-9]+)?$' then return s::float8; end if;
      return null;
    else return null;
  end case;
end $$;

/* weekly-focus-model slotShare = plan-today-model perMealShare(target, n), 5g steps. */
create or replace function focus_slot_share(p_target numeric, p_n int) returns float8
language sql immutable set search_path = public as $$
  select case
    when p_target is null or not (p_target > 0) then 0::float8
    else (
      select case when g <= 0 then 0::float8 when r <= 1 then g else greatest(5::float8, floor(g / r / 5 + 0.5) * 5) end
      from (select floor(p_target::float8 + 0.5) as g, floor(coalesce(p_n, 0)::float8 + 0.5) as r) x
    )
  end;
$$;

/* weekly-focus-model candidates(order): is this habit part of a day with these required slots? */
create or replace function focus_habit_applies(p_habit text, p_required text[]) returns boolean
language sql immutable set search_path = public as $$
  select case
    when p_habit in ('missed', 'late') then true
    when p_habit = 'snack' then 'snack' = any(coalesce(p_required, '{}'))
    when p_habit like 'protein:%' then substr(p_habit, 9) <> 'snack' and substr(p_habit, 9) = any(coalesce(p_required, '{}'))
    else false
  end;
$$;

/* ONE DAY, JUDGED: weekly-focus-model dayFacts + dayHit. true | false, or null for no evidence (a
   protein read that has not landed) or a habit this day does not have. p_meals / p_checkin are the
   day row's jsonb (null = no row); p_due the minute each slot is due, grace included. */
create or replace function focus_day_hit(
  p_habit text, p_meals jsonb, p_checkin jsonb, p_required text[], p_due jsonb, p_target numeric
) returns boolean
language plpgsql immutable set search_path = public as $$
declare
  ck jsonb := case when jsonb_typeof(p_checkin) = 'object' then p_checkin else '{}'::jsonb end;
  sm jsonb;
  lat jsonb;
  k text;
  p float8;
  t float8;
  any_logged boolean := false;
begin
  if not focus_habit_applies(p_habit, p_required) then return null; end if;
  if p_meals is null or jsonb_typeof(p_meals) <> 'object' then return false; end if;
  sm := case when jsonb_typeof(ck -> 'slotMacros') = 'object' then ck -> 'slotMacros' else '{}'::jsonb end;
  lat := case when jsonb_typeof(ck -> 'mealLoggedAt') = 'object' then ck -> 'mealLoggedAt' else '{}'::jsonb end;

  if p_habit like 'protein:%' then
    k := substr(p_habit, 9);
    -- scored: logged and not a duplicate photo (day.js mealScored)
    if not (_focus_truthy(p_meals -> k) and (sm -> k ->> 'flagged') is distinct from 'dup') then return false; end if;
    if _focus_truthy(sm -> k -> 'pending') or _focus_truthy(sm -> k -> 'analysisFailed') then return null; end if;
    p := _focus_num(sm -> k -> 'protein');
    if p is null then return null; end if;
    return p >= focus_slot_share(p_target, cardinality(p_required)) * 0.9::float8;
  end if;

  if p_habit = 'missed' then
    foreach k in array coalesce(p_required, '{}'::text[]) loop
      if not (_focus_truthy(p_meals -> k) and (sm -> k ->> 'flagged') is distinct from 'dup') then return false; end if;
    end loop;
    return true;
  end if;

  if p_habit = 'late' then
    foreach k in array coalesce(p_required, '{}'::text[]) loop
      if _focus_truthy(p_meals -> k) and (sm -> k ->> 'flagged') is distinct from 'dup' then
        any_logged := true;
        t := _focus_num(lat -> k);
        if t is not null and t > coalesce(_focus_num(p_due -> k), 1440) then return false; end if;
      end if;
    end loop;
    return any_logged;
  end if;

  if p_habit = 'snack' then
    return _focus_truthy(p_meals -> 'snack') and (sm -> 'snack' ->> 'flagged') is distinct from 'dup';
  end if;
  return false;
end $$;

/* A governing set's items -> the day's { required: [slots], due: { slot: minute incl. grace } }.
   No meal items -> the classic day (breakfast, lunch, dinner; the classic windows). */
create or replace function std_day_ctx(p_items jsonb, p_day_type text) returns jsonb
language plpgsql immutable set search_path = public as $$
declare
  items jsonb[];
  slots text[];
  m int;
  i int;
  it jsonb;
  k text;
  dl float8;
  gr float8;
  due jsonb := '{}'::jsonb;
  classic constant jsonb := '{"breakfast":570,"lunch":840,"snack":1020,"dinner":1230}';
  dtype text := case when p_day_type in ('training', 'rest') then p_day_type else 'any' end;
begin
  if p_items is not null and jsonb_typeof(p_items) = 'array' then
    select coalesce(array_agg(e.it order by e.ord), '{}') into items
      from jsonb_array_elements(p_items) with ordinality as e(it, ord)
     where jsonb_typeof(e.it) = 'object'
       and jsonb_typeof(e.it -> 'kind') = 'string' and e.it ->> 'kind' = 'meal'
       and (dtype = 'any'
            or e.it -> 'dayType' is null or e.it -> 'dayType' = 'null'::jsonb
            or (jsonb_typeof(e.it -> 'dayType') = 'string' and e.it ->> 'dayType' in ('any', dtype)));
  end if;
  m := least(6, coalesce(array_length(items, 1), 0));
  if m = 0 then
    return jsonb_build_object('required', to_jsonb(array['breakfast', 'lunch', 'dinner']),
      'due', jsonb_build_object('breakfast', 570, 'lunch', 840, 'dinner', 1230));
  end if;
  slots := case m
    when 1 then array['dinner']
    when 2 then array['breakfast', 'dinner']
    when 3 then array['breakfast', 'lunch', 'dinner']
    when 4 then array['breakfast', 'lunch', 'snack', 'dinner']
    when 5 then array['breakfast', 'lunch', 'snack', 'dinner', 'meal-5']
    else array['breakfast', 'lunch', 'snack', 'dinner', 'meal-5', 'meal-6']
  end;
  for i in 1..m loop
    k := slots[i];
    it := items[i];
    dl := null;
    if jsonb_typeof(it -> 'window') = 'object' and (it -> 'window' -> 'due') is not null and (it -> 'window' -> 'due') <> 'null'::jsonb then
      dl := _focus_num(it -> 'window' -> 'due');
    end if;
    dl := coalesce(dl, (classic ->> k)::float8, 1440);
    gr := case when jsonb_typeof(it -> 'grace') = 'number' and (it ->> 'grace')::float8 >= 0
               then least(240, floor((it ->> 'grace')::float8 + 0.5)) else 0 end;
    due := due || jsonb_build_object(k, dl + gr);
  end loop;
  return jsonb_build_object('required', to_jsonb(slots), 'due', due);
end $$;

/* state.js nutritionConfigForGoal, the protein half, as DAY.proteinTarget holds it. */
create or replace function protein_target_from(p_goal text, p_bw numeric, p_targets jsonb) returns int
language plpgsql immutable set search_path = public as $$
declare
  tp float8;
  bw float8;
  f float8;
begin
  if p_goal is null or p_goal = '' then return 180; end if;           -- no goal: the shipped default
  tp := case when jsonb_typeof(p_targets) = 'object' then _focus_num(p_targets -> 'protein') end;
  if tp > 0 then return floor(tp + 0.5)::int; end if;                  -- a coach number wins
  bw := case when p_bw > 0 then p_bw::float8 else 171 end;
  f := case p_goal
    when 'lose' then 0.9 when 'lose_fat' then 0.9
    when 'gain' then 1.0 when 'build' then 1.0 when 'gain_muscle' then 1.0 when 'gain_weight' then 1.0
    when 'maintain' then 0.8 when 'health' then 0.8
  end;
  if f is null then return 180; end if;                                -- perform and the rest
  return greatest(80::float8, floor(bw * f / 5 + 0.5) * 5)::int;
end $$;

revoke all on function _focus_truthy(jsonb) from public, anon, authenticated;
revoke all on function _focus_num(jsonb) from public, anon, authenticated;
revoke all on function focus_slot_share(numeric, int) from public, anon, authenticated;
revoke all on function focus_habit_applies(text, text[]) from public, anon, authenticated;
revoke all on function focus_day_hit(text, jsonb, jsonb, text[], jsonb, numeric) from public, anon, authenticated;
revoke all on function std_day_ctx(jsonb, text) from public, anon, authenticated;
revoke all on function protein_target_from(text, numeric, jsonb) from public, anon, authenticated;

/* The stored inputs, resolved for one athlete on one team and date. */
create or replace function athlete_day_ctx(p_athlete uuid, p_team uuid, p_date date) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_pos text;
  v_items jsonb;
  v_type text;
begin
  select upper(btrim(coalesce(nullif(r.label, ''), nullif(ap.position, ''), '')))
    into v_pos
    from (select 1) one
    left join team_members tm on tm.team_id = p_team and tm.athlete_id = p_athlete and tm.status = 'active'
    left join team_rooms r on r.id = tm.room_id
    left join athlete_profiles ap on ap.athlete_id = p_athlete;
  select rs.items into v_items
    from requirement_sets rs
   where rs.team_id = p_team
     and coalesce(rs.effective_date, '0001-01-01'::date) <= p_date
     and ((rs.scope_kind = 'athlete' and rs.scope_value = p_athlete::text)
       or (rs.scope_kind = 'position' and coalesce(v_pos, '') <> '' and upper(btrim(coalesce(rs.scope_value, ''))) = v_pos)
       or rs.scope_kind = 'team')
   order by case rs.scope_kind when 'athlete' then 3 when 'position' then 2 else 1 end desc,
            coalesce(rs.effective_date, '0001-01-01'::date) desc, rs.updated_at desc
   limit 1;
  select w.pattern ->> (extract(dow from p_date))::int into v_type
    from team_week_pattern w where w.team_id = p_team;
  return std_day_ctx(v_items, v_type);
end $$;
revoke all on function athlete_day_ctx(uuid, uuid, date) from public, anon, authenticated;

create or replace function athlete_protein_target(p_athlete uuid) returns int
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select protein_target_from(ap.base_goal, ap.base_weight, ap.targets) from athlete_profiles ap where ap.athlete_id = p_athlete),
    180);
$$;
revoke all on function athlete_protein_target(uuid) from public, anon, authenticated;

-- ================================================================ 5. team_challenges
create or replace function challenge_habit_title(p text) returns text
language sql immutable set search_path = public as $$
  select case p
    when 'protein:breakfast' then 'Protein at breakfast'
    when 'protein:lunch' then 'Protein at lunch'
    when 'protein:dinner' then 'Protein at dinner'
    when 'missed' then 'Every meal in'
    when 'late' then 'Meals logged on time'
    when 'snack' then 'The snack, every day'
  end;
$$;
grant execute on function challenge_habit_title(text) to authenticated;

create table if not exists public.team_challenges (
  id          uuid primary key default gen_random_uuid(),
  team_id     uuid not null references public.teams(id) on delete cascade,
  habit       text not null check (challenge_habit_title(habit) is not null),
  starts_on   date not null,
  ends_on     date not null,
  goal_days   int not null default 5,
  created_by  uuid references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now(),
  ended_at    timestamptz,
  ended_by    uuid references public.profiles(id) on delete set null,
  pushed_at   timestamptz,
  check (ends_on >= starts_on and ends_on - starts_on <= 13),
  check (goal_days between 1 and (ends_on - starts_on + 1))
);
create index if not exists team_challenges_team on public.team_challenges (team_id, created_at desc);
create unique index if not exists team_challenges_one_open on public.team_challenges (team_id) where ended_at is null;

comment on table public.team_challenges is
  'A team focus challenge (phase D): one weekly-focus habit, a range of at most 14 days and a goal. One open per team. Written only by start_team_challenge / end_team_challenge; progress computed by team_challenge_board / my_learning from the day rows. 0256.';

alter table public.team_challenges enable row level security;
drop policy if exists team_challenges_read on public.team_challenges;
create policy team_challenges_read on public.team_challenges
  for select using (is_staff_of_team(team_id) or is_team_athlete(team_id));

revoke all on table public.team_challenges from public, anon, authenticated;
grant select on public.team_challenges to authenticated;
grant select, insert, update, delete on public.team_challenges to service_role;

create or replace function start_team_challenge(p_team uuid, p_habit text, p_starts date, p_ends date, p_goal int)
returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if auth.uid() is null or not can_set_team_phase(p_team) then
    raise exception 'only staff who edit the team standard can start a challenge' using errcode = '42501';
  end if;
  if challenge_habit_title(p_habit) is null then raise exception 'unknown habit' using errcode = '22023'; end if;
  if p_starts is null or p_ends is null or p_ends < p_starts or p_ends - p_starts > 13 then
    raise exception 'a challenge runs 1 to 14 days' using errcode = '22023';
  end if;
  if p_starts < current_date - 7 or p_starts > current_date + 14 or p_ends < current_date - 1 then
    raise exception 'start it this week or within the next two weeks' using errcode = '22023';
  end if;
  if p_goal is null or p_goal < 1 or p_goal > p_ends - p_starts + 1 then
    raise exception 'the goal is 1 day up to every day of the range' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('team_challenges:' || p_team::text, 0));
  -- A challenge whose last day has passed (or that ends before this one starts) is over: close it
  -- so the next one can start. An overlapping one is still running and refuses the new one.
  update team_challenges set ended_at = now()
   where team_id = p_team and ended_at is null and (ends_on < current_date - 1 or ends_on < p_starts);
  if exists (select 1 from team_challenges where team_id = p_team and ended_at is null) then
    raise exception 'a team challenge is already running' using errcode = '23505';
  end if;
  insert into team_challenges (team_id, habit, starts_on, ends_on, goal_days, created_by)
  values (p_team, p_habit, p_starts, p_ends, p_goal, auth.uid())
  returning id into v_id;
  return v_id;
end $$;
revoke all on function start_team_challenge(uuid, text, date, date, int) from public, anon;
grant execute on function start_team_challenge(uuid, text, date, date, int) to authenticated;

create or replace function end_team_challenge(p_id uuid) returns boolean
language plpgsql security definer set search_path = public as $$
declare v_team uuid;
begin
  select team_id into v_team from team_challenges where id = p_id;
  if v_team is null then return false; end if;
  if auth.uid() is null or not can_set_team_phase(v_team) then
    raise exception 'only staff who edit the team standard can end a challenge' using errcode = '42501';
  end if;
  update team_challenges set ended_at = now(), ended_by = auth.uid() where id = p_id and ended_at is null;
  return found;
end $$;
revoke all on function end_team_challenge(uuid) from public, anon;
grant execute on function end_team_challenge(uuid) to authenticated;

/* One athlete's record in a challenge, as of p_today: every day in the range with its hit (null
   for no evidence), na for a day the habit is not part of (or before they joined), future days
   unjudged. ON TRACK: reached the goal, or while it runs, at least floor(goal x finished/all)
   (proto js/challenge-model.js onTrack holds the same rule). */
create or replace function challenge_athlete_days(p_challenge uuid, p_athlete uuid, p_joined date, p_today date)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  c team_challenges;
  d date;
  v_ctx jsonb;
  v_req text[];
  v_meals jsonb;
  v_checkin jsonb;
  v_hit boolean;
  v_days jsonb := '[]'::jsonb;
  v_hits int := 0;
  v_applies boolean := false;
  v_elapsed int := 0;
  v_total int;
  v_target int;
  v_over boolean;
begin
  select * into c from team_challenges where id = p_challenge;
  if not found then return null; end if;
  v_target := athlete_protein_target(p_athlete);
  v_total := c.ends_on - c.starts_on + 1;
  v_over := c.ended_at is not null or p_today > c.ends_on;
  for d in select generate_series(c.starts_on, c.ends_on, interval '1 day')::date loop
    if d < p_today then v_elapsed := v_elapsed + 1; end if;
    if d > p_today then
      v_days := v_days || jsonb_build_array(jsonb_build_object('date', d, 'hit', null));
      continue;
    end if;
    if p_joined is not null and d < p_joined then
      v_days := v_days || jsonb_build_array(jsonb_build_object('date', d, 'hit', null, 'na', true));
      continue;
    end if;
    v_ctx := athlete_day_ctx(p_athlete, c.team_id, d);
    v_req := array(select jsonb_array_elements_text(v_ctx -> 'required'));
    if not focus_habit_applies(c.habit, v_req) then
      v_days := v_days || jsonb_build_array(jsonb_build_object('date', d, 'hit', null, 'na', true));
      continue;
    end if;
    v_applies := true;
    v_meals := null; v_checkin := null;
    select dy.meals, dy.checkin into v_meals, v_checkin from days dy where dy.athlete_id = p_athlete and dy.date = d;
    v_hit := focus_day_hit(c.habit, v_meals, v_checkin, v_req, v_ctx -> 'due', v_target);
    if v_hit then v_hits := v_hits + 1; end if;
    v_days := v_days || jsonb_build_array(jsonb_build_object('date', d, 'hit', v_hit));
  end loop;
  return jsonb_build_object(
    'eligible', v_applies,
    'hits', v_hits,
    'reached', v_hits >= c.goal_days,
    'on_track', v_applies and (v_hits >= c.goal_days or (not v_over and v_hits >= (c.goal_days * v_elapsed) / greatest(1, v_total))),
    'days', v_days);
end $$;
revoke all on function challenge_athlete_days(uuid, uuid, date, date) from public, anon, authenticated;

/* The client's "today", held to within a day of the server's (a phone's own calendar date). */
create or replace function _teach_today(p date) returns date
language sql stable set search_path = public as $$
  select least(greatest(coalesce(p, current_date), current_date - 1), current_date + 1);
$$;
revoke all on function _teach_today(date) from public, anon, authenticated;

/* The challenge's shape for a reader (no internals). */
create or replace function _challenge_json(c team_challenges) returns jsonb
language sql stable set search_path = public as $$
  select jsonb_build_object('id', c.id, 'team_id', c.team_id, 'habit', c.habit, 'starts_on', c.starts_on,
    'ends_on', c.ends_on, 'goal_days', c.goal_days, 'created_at', c.created_at, 'ended_at', c.ended_at,
    'from', staff_display_label(c.created_by, c.team_id));
$$;
revoke all on function _challenge_json(team_challenges) from public, anon, authenticated;

/* STAFF: a challenge's progress, every athlete by name (all staff of the team may read it). With
   p_challenge null, the team's latest challenge. */
create or replace function team_challenge_board(p_team uuid, p_challenge uuid, p_today date) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  c team_challenges;
  v_today date := _teach_today(p_today);
  m record;
  r jsonb;
  v_rows jsonb := '[]'::jsonb;
  v_on int := 0;
  v_total int := 0;
begin
  if auth.uid() is null or not is_staff_of_team(p_team) then
    raise exception 'not staff of this team' using errcode = '42501';
  end if;
  if p_challenge is not null then
    select * into c from team_challenges where id = p_challenge and team_id = p_team;
  else
    select * into c from team_challenges where team_id = p_team order by (ended_at is null) desc, created_at desc limit 1;
  end if;
  if not found then return jsonb_build_object('challenge', null); end if;
  for m in
    select tm.athlete_id, tm.joined_at, p.full_name
      from team_members tm join profiles p on p.id = tm.athlete_id
     where tm.team_id = c.team_id and tm.status = 'active'
     order by p.full_name
  loop
    r := challenge_athlete_days(c.id, m.athlete_id, m.joined_at::date, v_today);
    if (r ->> 'eligible')::boolean then
      v_total := v_total + 1;
      if (r ->> 'on_track')::boolean then v_on := v_on + 1; end if;
    end if;
    v_rows := v_rows || jsonb_build_array(r || jsonb_build_object('athlete_id', m.athlete_id, 'name', coalesce(m.full_name, '')));
  end loop;
  return jsonb_build_object('challenge', _challenge_json(c), 'today', v_today,
    'over', c.ended_at is not null or v_today > c.ends_on,
    'on_track', v_on, 'total', v_total, 'athletes', v_rows);
end $$;
revoke all on function team_challenge_board(uuid, uuid, date) from public, anon;
grant execute on function team_challenge_board(uuid, uuid, date) to authenticated;

/* STAFF: the team's lesson assignments, each with how many of its audience have done it. */
create or replace function team_lessons(p_team uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null or not is_staff_of_team(p_team) then
    raise exception 'not staff of this team' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(x order by x ->> 'created_at' desc)
    from (
      select jsonb_build_object(
        'id', a.id, 'lesson_id', a.lesson_id, 'room_id', a.room_id, 'room_label', r.label,
        'due_on', a.due_on, 'created_at', a.created_at, 'from', staff_display_label(a.assigned_by, a.team_id),
        'total', (select count(*) from team_members m where m.team_id = a.team_id and m.status = 'active'
                   and (a.room_id is null or m.room_id = a.room_id)),
        'done', (select count(*) from team_members m join lesson_completions lc
                   on lc.athlete_id = m.athlete_id and lc.lesson_id = a.lesson_id
                  where m.team_id = a.team_id and m.status = 'active'
                   and (a.room_id is null or m.room_id = a.room_id))
      ) as x
      from lesson_assignments a
      left join team_rooms r on r.id = a.room_id
      where a.team_id = p_team
    ) s
  ), '[]'::jsonb);
end $$;
revoke all on function team_lessons(uuid) from public, anon;
grant execute on function team_lessons(uuid) to authenticated;

/* STAFF: one assignment, athlete by athlete (who has finished it and who has not). */
create or replace function lesson_assignment_progress(p_assignment uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare a lesson_assignments;
begin
  select * into a from lesson_assignments where id = p_assignment;
  if not found then return null; end if;
  if auth.uid() is null or not is_staff_of_team(a.team_id) then
    raise exception 'not staff of this team' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'id', a.id, 'lesson_id', a.lesson_id, 'room_id', a.room_id,
    'room_label', (select r.label from team_rooms r where r.id = a.room_id),
    'due_on', a.due_on, 'created_at', a.created_at, 'from', staff_display_label(a.assigned_by, a.team_id),
    'athletes', coalesce((
      select jsonb_agg(jsonb_build_object('athlete_id', m.athlete_id, 'name', coalesce(p.full_name, ''),
               'done', lc.athlete_id is not null, 'completed_at', lc.completed_at, 'quiz_correct', lc.quiz_correct)
             order by (lc.athlete_id is null), p.full_name)
        from team_members m
        join profiles p on p.id = m.athlete_id
        left join lesson_completions lc on lc.athlete_id = m.athlete_id and lc.lesson_id = a.lesson_id
       where m.team_id = a.team_id and m.status = 'active' and (a.room_id is null or m.room_id = a.room_id)
    ), '[]'::jsonb));
end $$;
revoke all on function lesson_assignment_progress(uuid) from public, anon;
grant execute on function lesson_assignment_progress(uuid) to authenticated;

/* THE ATHLETE: what reaches me (assignments for my team and my room), what I have finished, and a
   running team challenge with my own days and the team as a COUNT. Never another athlete's name
   or id. A guardian, a coach or an outsider gets empty lists. */
create or replace function my_learning(p_today date) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_me uuid := auth.uid();
  v_today date := _teach_today(p_today);
  c team_challenges;
  v_joined date;
  mine jsonb;
  v_on int := 0;
  v_total int := 0;
  m record;
  r jsonb;
  v_challenge jsonb := null;
begin
  if v_me is null then raise exception 'not signed in' using errcode = '42501'; end if;

  select ch.* into c
    from team_challenges ch
    join team_members tm on tm.team_id = ch.team_id and tm.athlete_id = v_me and tm.status = 'active'
   where ch.ended_at is null and ch.starts_on <= v_today and v_today <= ch.ends_on
   order by ch.created_at desc limit 1;
  if found then
    select tm.joined_at::date into v_joined from team_members tm where tm.team_id = c.team_id and tm.athlete_id = v_me and tm.status = 'active';
    mine := challenge_athlete_days(c.id, v_me, v_joined, v_today);
    for m in select tm.athlete_id, tm.joined_at from team_members tm where tm.team_id = c.team_id and tm.status = 'active' loop
      r := case when m.athlete_id = v_me then mine else challenge_athlete_days(c.id, m.athlete_id, m.joined_at::date, v_today) end;
      if (r ->> 'eligible')::boolean then
        v_total := v_total + 1;
        if (r ->> 'on_track')::boolean then v_on := v_on + 1; end if;
      end if;
    end loop;
    v_challenge := _challenge_json(c) || jsonb_build_object('mine', mine, 'team_on_track', v_on, 'team_total', v_total);
  end if;

  return jsonb_build_object(
    'today', v_today,
    'assignments', coalesce((
      select jsonb_agg(jsonb_build_object('id', a.id, 'lesson_id', a.lesson_id, 'due_on', a.due_on,
               'created_at', a.created_at, 'from', staff_display_label(a.assigned_by, a.team_id))
             order by a.created_at desc)
        from lesson_assignments a
        join team_members tm on tm.team_id = a.team_id and tm.athlete_id = v_me and tm.status = 'active'
       where a.room_id is null or a.room_id = tm.room_id
    ), '[]'::jsonb),
    'completions', coalesce((
      select jsonb_agg(jsonb_build_object('lesson_id', lc.lesson_id, 'completed_at', lc.completed_at, 'quiz_correct', lc.quiz_correct))
        from lesson_completions lc where lc.athlete_id = v_me
    ), '[]'::jsonb),
    'challenge', v_challenge);
end $$;
revoke all on function my_learning(date) from public, anon;
grant execute on function my_learning(date) to authenticated;

-- ================================================================ 6. push once
/* The creator's client asks send-push to announce a new assignment or challenge; send-push calls
   this with the CALLER's session. It stamps pushed_at in one conditional update (a row already
   stamped, or older than a day, returns claimed:false) and returns the audience and the words.
   Only the team's editors may claim. */
create or replace function claim_teach_push(p_kind text, p_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  a lesson_assignments;
  c team_challenges;
  v_ids uuid[];
  v_from text;
begin
  if auth.uid() is null then raise exception 'not signed in' using errcode = '42501'; end if;
  if p_kind = 'lesson' then
    select * into a from lesson_assignments where id = p_id;
    if not found then return jsonb_build_object('claimed', false); end if;
    if not can_set_team_phase(a.team_id) then raise exception 'not an editor of this team' using errcode = '42501'; end if;
    update lesson_assignments set pushed_at = now()
     where id = p_id and pushed_at is null and created_at > now() - interval '1 day';
    if not found then return jsonb_build_object('claimed', false); end if;
    v_ids := array(select m.athlete_id from team_members m where m.team_id = a.team_id and m.status = 'active'
                    and (a.room_id is null or m.room_id = a.room_id));
    v_from := staff_display_label(a.assigned_by, a.team_id);
    return jsonb_build_object('claimed', true, 'kind', 'lesson', 'ref', a.lesson_id, 'route', 'lesson/' || a.lesson_id,
      'title', 'New lesson', 'body', v_from || ' assigned a 1-minute lesson: ' || lesson_title(a.lesson_id),
      'athlete_ids', to_jsonb(v_ids));
  elsif p_kind = 'challenge' then
    select * into c from team_challenges where id = p_id;
    if not found then return jsonb_build_object('claimed', false); end if;
    if not can_set_team_phase(c.team_id) then raise exception 'not an editor of this team' using errcode = '42501'; end if;
    update team_challenges set pushed_at = now()
     where id = p_id and pushed_at is null and ended_at is null and created_at > now() - interval '1 day';
    if not found then return jsonb_build_object('claimed', false); end if;
    v_ids := array(select m.athlete_id from team_members m where m.team_id = c.team_id and m.status = 'active');
    v_from := staff_display_label(c.created_by, c.team_id);
    return jsonb_build_object('claimed', true, 'kind', 'challenge', 'ref', null, 'route', 'home',
      'title', 'Team challenge',
      'body', v_from || ' started a team challenge: ' || challenge_habit_title(c.habit) || '. Goal: '
              || c.goal_days || ' of ' || (c.ends_on - c.starts_on + 1) || ' days.',
      'athlete_ids', to_jsonb(v_ids));
  end if;
  raise exception 'unknown kind' using errcode = '22023';
end $$;
revoke all on function claim_teach_push(text, uuid) from public, anon;
grant execute on function claim_teach_push(text, uuid) to authenticated;
