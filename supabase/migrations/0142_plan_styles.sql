-- OnStandard — nutrition PLAN STYLES (Structured / Guided / Intuitive).
--
-- A plan style is HOW MUCH STRUCTURE a person is held to, on one spectrum. It is ORTHOGONAL to
-- the goal-derived scoring profile (athlete/general/gain): the GOAL sets the direction, the STYLE
-- sets the structure. Mirrors src/core/planStyle.ts + proto/redesign-2026-07/js/plan-style.js.
--
-- Resolution precedence (the client's resolvePlanStyle and this file's helpers agree):
--     team standard  ->  professional assignment  ->  self choice  ->  default
--
-- Storage follows the rails that already exist rather than inventing new ones:
--   * a TEAM standard rides requirement_sets.items as a kind:'plan_style' item, so it inherits
--     0055's team/position/athlete scoping and 0085's effective_date versioning for free — which
--     is exactly what makes "Structured preseason, Guided in-season, Intuitive offseason" work
--     with no new machinery.
--   * a PROFESSIONAL assignment rides athlete_profiles.targets (the coach-owned JSONB, written
--     through coach_set_goals) as `style` + `styleOverrides`.
--   * a SELF choice and the always-captured PREFERENCE ride two new profiles columns.
--   * each scored day is STAMPED with the style that governed it (days.plan_style), so a style
--     change never rewrites history, and the new body signals land in days.signals.
--
-- INTEGRITY NOTE: this migration deliberately does NOT touch 0041's evidence ceiling. No plan
-- style may push a component weight above its cap (nutrition .55 / recovery .25 / commitment .15
-- / checkin .10) — src/core/planStyleCaps.test.ts enforces that, so the server anti-tamper bound
-- stays exactly as strong as it is today for every user.
--
-- NO BACKFILL BY DESIGN: existing accounts are grandfathered onto Structured (today's exact
-- formula) by resolvePlanStyle's `hasHistory` rule, not by writing a value that would later read
-- as a deliberate choice they never made. Their columns stay null; their scoring does not move.
--
-- Forward-only and idempotent.
-- GUARDRAIL: authored for founder review — apply with `supabase db push`, then `npm run test:rls`.

-- ---------------------------------------------------------------- 1. columns

-- The athlete's own stated answer to "how much nutrition structure helps you succeed?".
-- ALWAYS writable by the athlete, even when a coach controls the effective style: a locked
-- athlete is never a dead end, and this is the signal the pro's roster surfaces.
alter table profiles add column if not exists plan_style_preference text;
-- The effective style for someone who controls their own plan (an independent adult).
-- IGNORED by resolution whenever a team standard or professional assignment governs — an athlete
-- can never switch style to escape a team standard (set_my_plan_style below refuses the write).
alter table profiles add column if not exists plan_style text;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'profiles_plan_style_valid') then
    alter table profiles add constraint profiles_plan_style_valid
      check (plan_style is null or plan_style in ('structured','guided','intuitive'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'profiles_plan_style_pref_valid') then
    alter table profiles add constraint profiles_plan_style_pref_valid
      check (plan_style_preference is null or plan_style_preference in ('structured','guided','intuitive'));
  end if;
end $$;

-- The per-day stamp: which style graded THIS day. Never rescored when the style later changes.
alter table days add column if not exists plan_style text;
-- Body signals captured today, shaped { slotKey: { hunger, fullness, satisfaction } }; the
-- check-in-scoped signals (digestion, cravings) continue to ride the existing checkin blob.
alter table days add column if not exists signals jsonb not null default '{}'::jsonb;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'days_plan_style_valid') then
    alter table days add constraint days_plan_style_valid
      check (plan_style is null or plan_style in ('structured','guided','intuitive'));
  end if;
end $$;

-- GRANTS GOTCHA (the column-level form of the 0013/0098 lesson): `days` does NOT hold a
-- table-level SELECT grant for `authenticated` — it holds a COLUMN-level grant, one column at a
-- time. INSERT/UPDATE/DELETE are table-level, so writes to a new column work immediately and a
-- write test passes... while every READ of it fails with "permission denied for table days".
-- New columns therefore need their SELECT granted explicitly or the athlete can never read back
-- what they just wrote. (Caught by the 0142 block in supabase/tests/rls_authz_test.sql.)
grant select (plan_style, signals) on days to authenticated;

-- profiles holds ordinary table-level grants, so its two new columns need nothing extra.
-- RLS is unchanged on both tables: days/profiles are athlete-self-write with existing policies.

-- ---------------------------------------------------------------- 2. override validation

-- A professional may customize any style knob. This bounds what they can express so a malformed
-- (or hostile) override can widen/narrow a plan but never produce an invalid engine input.
-- Mirrors knobsFor()'s range checks in planStyle.ts — the client re-validates too; this is the
-- rail that holds when the client is not the one writing.
create or replace function validate_plan_style_overrides(o jsonb) returns boolean
language plpgsql immutable as $$
declare
  k text; v jsonb;
begin
  if o is null or o = 'null'::jsonb then return true; end if;            -- absent is valid
  if jsonb_typeof(o) <> 'object' then return false; end if;
  -- only the four known sections
  for k in select jsonb_object_keys(o) loop
    if k not in ('nutrition','parts','signals','surface') then return false; end if;
  end loop;

  if o ? 'nutrition' then
    v := o->'nutrition';
    if jsonb_typeof(v) <> 'object' then return false; end if;
    if v ? 'calorie' and (v->>'calorie') not in ('exact','range','adequacy','off') then return false; end if;
    if v ? 'protein' and (v->>'protein') not in ('exact','range','off') then return false; end if;
    if v ? 'calorieBand' then
      if jsonb_typeof(v->'calorieBand') <> 'number' then return false; end if;
      if (v->>'calorieBand')::numeric not between 0 and 0.5 then return false; end if;
    end if;
    if v ? 'proteinBand' then
      if jsonb_typeof(v->'proteinBand') <> 'number' then return false; end if;
      if (v->>'proteinBand')::numeric not between 0 and 0.5 then return false; end if;
    end if;
    foreach k in array array['timingScored','hydrationScored','qualityScored','awarenessScored'] loop
      if v ? k and jsonb_typeof(v->k) <> 'boolean' then return false; end if;
    end loop;
  end if;

  if o ? 'parts' then
    v := o->'parts';
    if jsonb_typeof(v) <> 'object' then return false; end if;
    for k in select jsonb_object_keys(v) loop
      if k not in ('protein','calorie','timing','hydration','quality','awareness') then return false; end if;
      if jsonb_typeof(v->k) <> 'number' then return false; end if;
      if (v->>k)::numeric not between 0 and 100 then return false; end if;
    end loop;
  end if;

  if o ? 'signals' then
    v := o->'signals';
    if jsonb_typeof(v) <> 'object' then return false; end if;
    for k in select jsonb_object_keys(v) loop
      if k not in ('hunger','fullness','satisfaction','digestion','cravings') then return false; end if;
      if jsonb_typeof(v->k) <> 'boolean' then return false; end if;
    end loop;
  end if;

  if o ? 'surface' then
    v := o->'surface';
    if jsonb_typeof(v) <> 'object' then return false; end if;
    for k in select jsonb_object_keys(v) loop
      if k not in ('showCalories','showMacros','tone') then return false; end if;
    end loop;
    if v ? 'tone' and (v->>'tone') not in ('targets','guidance','signals') then return false; end if;
    if v ? 'showCalories' and jsonb_typeof(v->'showCalories') <> 'boolean' then return false; end if;
    if v ? 'showMacros'   and jsonb_typeof(v->'showMacros')   <> 'boolean' then return false; end if;
  end if;

  return true;
end; $$;
revoke all on function validate_plan_style_overrides(jsonb) from public;
grant execute on function validate_plan_style_overrides(jsonb) to authenticated;

-- ---------------------------------------------------------------- 3. the team-standard item
-- Extends 0055's guard (last replaced by 0086) with an OPTIONAL kind:'plan_style' item, so every
-- existing set validates unchanged. IMMUTABLE with an unchanged signature, so create-or-replace
-- is safe under the requirement_sets_items_valid check constraint (the 0074/0086 pattern).
--
-- Shape: { id, title, kind:'plan_style', proof:'check', style:'guided', overrides?: {...} }
-- A plan_style item does not count toward the meals/lifts rails — it configures the standard
-- rather than being something the athlete executes.
create or replace function validate_requirement_items(items jsonb) returns boolean
language plpgsql immutable as $$
declare
  it jsonb; meals int := 0; lifts int := 0; styles int := 0;
begin
  if items is null or jsonb_typeof(items) <> 'array' then return false; end if;
  if jsonb_array_length(items) < 1 or jsonb_array_length(items) > 24 then return false; end if;
  for it in select * from jsonb_array_elements(items) loop
    if jsonb_typeof(it) <> 'object' then return false; end if;
    if not (it ? 'id' and it ? 'title' and it ? 'kind' and it ? 'proof') then return false; end if;
    if length(it->>'id') > 40 or length(it->>'title') > 80 then return false; end if;
    if (it->>'proof') not in ('photo','form','scale','counter','check') then return false; end if;
    if (it->>'kind') not in ('meal','lift','hydration','recovery','weigh','checkin','custom','plan_style') then return false; end if;
    if (it->>'kind') = 'meal' then meals := meals + 1; end if;
    if (it->>'kind') = 'lift' then lifts := lifts + 1; end if;
    -- plan_style rail: exactly one per set, a known style, and bounded overrides.
    if (it->>'kind') = 'plan_style' then
      styles := styles + 1;
      if (it->>'style') is null or (it->>'style') not in ('structured','guided','intuitive') then return false; end if;
      if it ? 'overrides' and not validate_plan_style_overrides(it->'overrides') then return false; end if;
    end if;
    -- window rail: optional {open,due,label}; open/due minute-of-day 0..1439; due not before open.
    if it ? 'window' then
      if jsonb_typeof(it->'window') <> 'object' then return false; end if;
      if (it->'window') ? 'open' then
        if jsonb_typeof(it->'window'->'open') <> 'number' then return false; end if;
        if (it->'window'->>'open')::numeric not between 0 and 1439 then return false; end if;
      end if;
      if (it->'window') ? 'due' then
        if jsonb_typeof(it->'window'->'due') <> 'number' then return false; end if;
        if (it->'window'->>'due')::numeric not between 0 and 1439 then return false; end if;
      end if;
      if (it->'window') ? 'open' and (it->'window') ? 'due' then
        if (it->'window'->>'due')::numeric < (it->'window'->>'open')::numeric then return false; end if;
      end if;
    end if;
    -- target rail: optional numeric target (hydration oz, weight goal), 1..999.
    if it ? 'target' then
      if jsonb_typeof(it->'target') <> 'number' then return false; end if;
      if (it->>'target')::numeric not between 1 and 999 then return false; end if;
    end if;
    -- grace: minutes past due a log still counts on time, 0..240.
    if it ? 'grace' then
      if jsonb_typeof(it->'grace') <> 'number' then return false; end if;
      if (it->>'grace')::numeric not between 0 and 240 then return false; end if;
    end if;
    -- latePolicy: how a past-grace log scores.
    if it ? 'latePolicy' then
      if (it->>'latePolicy') not in ('half','full','none') then return false; end if;
    end if;
    -- coachReview / snack: booleans.
    if it ? 'coachReview' then
      if jsonb_typeof(it->'coachReview') <> 'boolean' then return false; end if;
    end if;
    if it ? 'snack' then
      if jsonb_typeof(it->'snack') <> 'boolean' then return false; end if;
    end if;
    -- dayType: which day this item applies to.
    if it ? 'dayType' then
      if (it->>'dayType') not in ('any','training','rest') then return false; end if;
    end if;
  end loop;
  return meals between 1 and 6 and lifts between 0 and 7 and styles <= 1;
end; $$;

-- ---------------------------------------------------------------- 4. change log
-- Append-only history of every style change: what moved, who moved it, and from when. Powers the
-- Progress timeline markers ("style changed Mar 3") and the professional's audit trail. Written
-- ONLY through the definer RPCs below — no direct grant, so a client can never forge a row.
create table if not exists plan_style_events (
  id             uuid primary key default gen_random_uuid(),
  athlete_id     uuid not null references profiles(id) on delete cascade,
  from_style     text check (from_style is null or from_style in ('structured','guided','intuitive')),
  to_style       text not null check (to_style in ('structured','guided','intuitive')),
  actor_id       uuid references profiles(id) on delete set null,
  actor_role     text not null default 'self' check (actor_role in ('self','coach','trainer','nutrition','system')),
  effective_date date not null default current_date,
  reason         text check (reason is null or length(reason) <= 280),
  created_at     timestamptz not null default now()
);
create index if not exists plan_style_events_athlete
  on plan_style_events (athlete_id, effective_date desc, created_at desc);

alter table plan_style_events enable row level security;
-- The athlete reads their own; anyone with a view grant on them (coach/trainer/nutrition pro/
-- guardian, per 0081 can_view) reads theirs. No write policy at all — RPC-only, like 0055's
-- requirement_assignments.
drop policy if exists plan_style_events_read on plan_style_events;
create policy plan_style_events_read on plan_style_events
  for select using (athlete_id = auth.uid() or can_view(athlete_id));

-- Read-only grant (0005 lesson: RLS decides rows, roles still need the table privilege).
-- Deliberately NO insert/update/delete — 0013 already stopped new tables inheriting DML.
grant select on plan_style_events to authenticated;

-- ---------------------------------------------------------------- 5. governing-standard helper
-- Does a TEAM standard govern this athlete's plan style today? Server-side mirror of the client's
-- resolveRequirementSet precedence (athlete > position > team) plus 0085's effective_date
-- versioning. Returns the governing style, or null when no team standard sets one.
--
-- This is what makes "athletes cannot switch modes to avoid required team standards" a SERVER
-- rule rather than a client convention.
create or replace function athlete_governing_plan_style(p_athlete uuid) returns text
language sql stable security definer set search_path = public as $$
  with mine as (
    select tm.team_id, tm.position
      from team_members tm
     where tm.athlete_id = p_athlete and tm.status = 'active'
  ),
  candidates as (
    select rs.items,
           case rs.scope_kind when 'athlete' then 3 when 'position' then 2 else 1 end as tier,
           coalesce(rs.effective_date, '0001-01-01'::date) as eff
      from requirement_sets rs
      join mine m on m.team_id = rs.team_id
     where coalesce(rs.effective_date, '0001-01-01'::date) <= current_date
       and (rs.scope_kind = 'team'
         -- a null position skips the room tier entirely (matches resolveRequirementSet)
         or (rs.scope_kind = 'position'
             and nullif(trim(coalesce(m.position, '')), '') is not null
             and upper(trim(coalesce(rs.scope_value, ''))) = upper(trim(m.position)))
         or (rs.scope_kind = 'athlete' and rs.scope_value = p_athlete::text))
  )
  select it->>'style'
    from candidates c
    cross join lateral jsonb_array_elements(c.items) it
   where it->>'kind' = 'plan_style'
   order by c.tier desc, c.eff desc
   limit 1;
$$;
revoke all on function athlete_governing_plan_style(uuid) from public;
grant execute on function athlete_governing_plan_style(uuid) to authenticated;

-- Is a PROFESSIONAL assignment in force? (athlete_profiles.targets.style, set by a coach/trainer.)
create or replace function athlete_assigned_plan_style(p_athlete uuid) returns text
language sql stable security definer set search_path = public as $$
  select case when ap.targets->>'style' in ('structured','guided','intuitive')
              then ap.targets->>'style' end
    from athlete_profiles ap
   where ap.athlete_id = p_athlete;
$$;
revoke all on function athlete_assigned_plan_style(uuid) from public;
grant execute on function athlete_assigned_plan_style(uuid) to authenticated;

-- ---------------------------------------------------------------- 6. the athlete's own write
-- Sets the caller's stated PREFERENCE (always allowed — it is theirs, and it is the signal their
-- coach sees), and their effective style ONLY when nobody else governs it. A governed athlete's
-- style argument is IGNORED, not rejected: their preference still lands, the UI still shows what
-- they want, and the standard still stands. Returns the effective style after the write.
create or replace function set_my_plan_style(p_style text, p_preference text default null)
returns text
language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := auth.uid();
  v_governed text;
  v_prev text;
  v_next text;
begin
  if v_me is null then raise exception 'not authenticated'; end if;
  if p_style is not null and p_style not in ('structured','guided','intuitive') then
    raise exception 'unknown plan style';
  end if;
  if p_preference is not null and p_preference not in ('structured','guided','intuitive') then
    raise exception 'unknown plan style preference';
  end if;

  -- The preference is always the athlete's to state.
  if p_preference is not null then
    update profiles set plan_style_preference = p_preference where id = v_me;
  end if;

  v_governed := coalesce(athlete_governing_plan_style(v_me), athlete_assigned_plan_style(v_me));
  if v_governed is not null then
    return v_governed;                       -- someone else owns this setting; nothing to change
  end if;

  if p_style is not null then
    select plan_style into v_prev from profiles where id = v_me;
    update profiles set plan_style = p_style where id = v_me;
    if v_prev is distinct from p_style then
      insert into plan_style_events (athlete_id, from_style, to_style, actor_id, actor_role)
      values (v_me, v_prev, p_style, v_me, 'self');
    end if;
  end if;

  select coalesce(plan_style, p_style) into v_next from profiles where id = v_me;
  return v_next;
end; $$;
revoke all on function set_my_plan_style(text, text) from public;
grant execute on function set_my_plan_style(text, text) to authenticated;

-- ---------------------------------------------------------------- 7. the professional's write
-- A coach/trainer/nutrition pro assigns a style (and optional knob overrides) to one athlete.
-- Rides athlete_profiles.targets alongside the protein/calorie targets they already own, so the
-- existing can_view / weight-redaction rails in coach_set_goals keep applying to everything else.
create or replace function set_athlete_plan_style(
  p_athlete uuid, p_style text, p_overrides jsonb default null, p_reason text default null
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_prev text;
  v_role text;
begin
  if not (is_team_coach_of(p_athlete) or is_trainer_of(p_athlete)) then
    raise exception 'not authorized to set the plan style for this athlete';
  end if;
  if p_style is null or p_style not in ('structured','guided','intuitive') then
    raise exception 'unknown plan style';
  end if;
  if not validate_plan_style_overrides(p_overrides) then
    raise exception 'invalid plan style overrides';
  end if;

  v_prev := athlete_assigned_plan_style(p_athlete);
  v_role := case when is_team_coach_of(p_athlete) then 'coach' else 'trainer' end;

  insert into athlete_profiles as ap (athlete_id, targets, updated_at)
  values (
    p_athlete,
    jsonb_build_object('style', p_style)
      || case when p_overrides is null then '{}'::jsonb else jsonb_build_object('styleOverrides', p_overrides) end,
    now()
  )
  on conflict (athlete_id) do update
    set targets = (
          case when p_overrides is null then ap.targets - 'styleOverrides'
               else ap.targets || jsonb_build_object('styleOverrides', p_overrides) end
        ) || jsonb_build_object('style', p_style),
        updated_at = now();

  if v_prev is distinct from p_style then
    insert into plan_style_events (athlete_id, from_style, to_style, actor_id, actor_role, reason)
    values (p_athlete, v_prev, p_style, auth.uid(), v_role, nullif(trim(coalesce(p_reason, '')), ''));
  end if;
end; $$;
revoke all on function set_athlete_plan_style(uuid, text, jsonb, text) from public;
grant execute on function set_athlete_plan_style(uuid, text, jsonb, text) to authenticated;

-- ---------------------------------------------------------------- 8. the targets write guard
-- coach_set_goals (0002 -> 0054 upsert -> 0103 weight guard) also carries `style`/`styleOverrides`
-- now that they live in the same JSONB. Everything from 0103 is preserved verbatim; this only
-- adds validation so a malformed style can never reach the engine through the targets door.
create or replace function coach_set_goals(athlete uuid, new_targets jsonb, new_season_goal jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_targets jsonb := new_targets;
  v_existing_weight jsonb;
begin
  if not (is_team_coach_of(athlete) or is_trainer_of(athlete)) then
    raise exception 'not authorized to set goals for this athlete';
  end if;
  -- plan-style keys are optional here; when present they must be valid.
  if v_targets is not null then
    if v_targets ? 'style' and (v_targets->>'style') not in ('structured','guided','intuitive') then
      raise exception 'unknown plan style';
    end if;
    if v_targets ? 'styleOverrides' and not validate_plan_style_overrides(v_targets->'styleOverrides') then
      raise exception 'invalid plan style overrides';
    end if;
  end if;
  -- 0103: only a weight-allowed caller may move the target weight.
  if v_targets is not null and not can_view_weight(athlete) then
    select ap.targets -> 'weight' into v_existing_weight from athlete_profiles ap where ap.athlete_id = athlete;
    v_targets := v_targets - 'weight';
    if v_existing_weight is not null then
      v_targets := v_targets || jsonb_build_object('weight', v_existing_weight);
    end if;
  end if;
  insert into athlete_profiles as ap (athlete_id, targets, season_goal, updated_at)
  values (athlete, coalesce(v_targets, '{}'::jsonb), coalesce(new_season_goal, '{}'::jsonb), now())
  on conflict (athlete_id) do update
    set targets     = coalesce(v_targets, ap.targets),
        season_goal = coalesce(new_season_goal, ap.season_goal),
        updated_at  = now();
end; $$;
revoke all on function coach_set_goals(uuid, jsonb, jsonb) from public;
grant execute on function coach_set_goals(uuid, jsonb, jsonb) to authenticated;
