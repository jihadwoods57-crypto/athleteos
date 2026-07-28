-- OnStandard — per-field staff visibility, slice 1: WEIGHT (founder decision 2026-07-21).
--
-- THE GAP (brief OPEN #5, resolved by the founder): staff gating was per-athlete-scope only
-- (can_view + staff_scope_blocks) with ZERO per-field restriction, so ANY in-scope staff role —
-- position coach, nutritionist, team admin, even view-only — could read an athlete's body weight
-- (days.current_weight, checkins.weight, athlete_profiles.base_weight + targets.weight).
--
-- THE DECISION: deny-by-default; weight is visible to team staff roles
--   head_coach · athletic_trainer · s_and_c
-- only. The nutritionist is deliberately EXCLUDED (founder-confirmed; they keep their
-- protein/calorie-target lane untouched). Trainers (practice lane, is_trainer_of) keep weight —
-- a client's weight goal is the trainer product; the founder's role list governs TEAM staff.
-- Athletes always see their own. Guardians were already fail-closed out of everything (0081).
--
-- THE WALL (three layers, each returns LESS when wrong — the 0081 rule):
--   1. can_view_weight(athlete): the single predicate every layer shares.
--   2. COLUMN-SPLIT SELECT GRANTS: Postgres RLS is row-level and cannot hide a column, so the
--      weight-bearing columns come OUT of the `authenticated` SELECT grant entirely
--      (days.current_weight, checkins.weight, athlete_profiles.base_weight + targets). Nobody —
--      not even the athlete — reads them via direct table SELECT anymore; the RPCs below are the
--      only doors, and they check can_view_weight per caller. INSERT/UPDATE grants are untouched,
--      so the athlete's own writes (pushDay upsert incl. current_weight) keep working unchanged.
--   3. RPC doors: weight_series() and athlete_plan_meta() with explicit column lists; the plan
--      RPC strips the targets 'weight' key for restricted callers but keeps protein/calories
--      (the nutritionist's lane). coach_set_goals() gains a WRITE guard: a restricted role's
--      save silently preserves the existing target weight instead of writing (or reading) it.
--
-- SCOPE (deliberate): weight only. base_height/base_age/dob stay as they were — the founder's
-- directive named weight; extending to other fields is a follow-up decision, not a default.
--
-- ⚠ DEPLOY ORDER (load-bearing, unlike most migrations here):
--   Ship the CLIENT first (the proto that enumerates its `days` columns and reads weight via
--   weight_series — same commit as this file), let the OTA roll out, THEN apply this migration.
--   A pre-0103 client's `select('*')` on days fails with 42501 once the column grant splits —
--   loadDay would degrade to cache-only and a stale device could push a merge-less day.
--   New clients are safe in BOTH orders (RPC-first with a pre-apply fallback select).
--   And per the Tier-1 rule: run `npm run test:rls` against a migrated local stack (needs psql)
--   BEFORE `supabase db push` — this file ships with new cases in rls_authz_test.sql.
--
-- ⚠ COLUMN-LIST GOTCHA (cousin of the 0013 grants gotcha): the SELECT grants below enumerate
--   columns. A future `alter table days|checkins|athlete_profiles add column` is NOT covered by
--   them — the new column will read as permission-denied until it's added to the grant list here.
--   Add the column to the matching GRANT when you add it to the table.
--
-- GUARDRAIL: authored only; NOT applied to live. Founder applies via `supabase db push` after
-- the client OTA + a green local RLS run.

-- ---------------------------------------------------------------- 1. the predicate
-- is_self → always. Otherwise the FULL existing wall first (can_view: link + scope narrowing +
-- minor-consent), then the weight-specific role gate: practice trainers, or team staff holding
-- one of the three allowed roles on a team the athlete is active on.
create or replace function can_view_weight(athlete uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select is_self(athlete)
      or ( can_view(athlete)
           and ( is_trainer_of(athlete)
                 or exists (
                     select 1
                     from team_members m
                     join team_staff s on s.team_id = m.team_id
                     where m.athlete_id = athlete and m.status = 'active'
                       and s.staff_id = auth.uid() and s.status = 'active'
                       and s.role in ('head_coach', 'athletic_trainer', 's_and_c')) ) );
$$;
revoke execute on function can_view_weight(uuid) from public, anon;
grant  execute on function can_view_weight(uuid) to authenticated;

-- ---------------------------------------------------------------- 2. column-split SELECT grants
-- Replace the whole-table SELECT (0005) with an explicit column list minus the weight columns.
-- service_role keeps full access (edge functions: weekly-digest reads days.score, never weight).
-- anon never had row access (RLS) — revoked here too, belt-and-braces.

revoke select on table days from authenticated, anon;
grant select (id, athlete_id, date, meals, hydration_l, tasks, quick_added, checkin,
              score, grade, computed_at, updated_at)
  on table days to authenticated;

revoke select on table checkins from authenticated, anon;
grant select (id, athlete_id, week, energy, recovery, sleep, confidence, soreness,
              motivation, notes, ai_summary, submitted_at)
  on table checkins to authenticated;

revoke select on table athlete_profiles from authenticated, anon;
grant select (athlete_id, level, sport, "position", base_height, base_age, base_goal,
              season_goal, team_code, updated_at, dob, standard)
  on table athlete_profiles to authenticated;

-- ---------------------------------------------------------------- 3. the RPC doors
-- The weight time series (the athlete's own trend + the allowed coach's read). Filter, never
-- raise: a restricted caller gets ZERO rows, not an error — "wrong returns LESS" (0081), and a
-- best-effort client call from a restricted role stays quiet instead of noisy.
create or replace function weight_series(athlete uuid, days_back int default 60)
returns table ("date" date, weight int)
language sql stable security definer set search_path = public as $$
  select d.date, d.current_weight
  from days d
  where d.athlete_id = athlete
    and d.current_weight is not null
    and d.date >= current_date - greatest(0, least(days_back, 366))
    and can_view_weight(athlete)
  order by d.date;
$$;
revoke execute on function weight_series(uuid, int) from public, anon;
grant  execute on function weight_series(uuid, int) to authenticated;

-- The plan meta the grant split removed from direct reads: base_weight + the targets jsonb.
-- Row-gated by the EXISTING wall (self or can_view); the weight PARTS are then conditionally
-- redacted: a restricted staffer gets base_weight = null and targets minus its 'weight' key —
-- protein/calories stay, so the nutritionist's product is untouched.
create or replace function athlete_plan_meta(athlete uuid)
returns table (base_weight int, targets jsonb)
language sql stable security definer set search_path = public as $$
  select case when can_view_weight(athlete) then ap.base_weight else null end,
         case when can_view_weight(athlete) then ap.targets else ap.targets - 'weight' end
  from athlete_profiles ap
  where ap.athlete_id = athlete
    and (is_self(athlete) or can_view(athlete));
$$;
revoke execute on function athlete_plan_meta(uuid) from public, anon;
grant  execute on function athlete_plan_meta(uuid) to authenticated;

-- ---------------------------------------------------------------- 4. the write guard
-- coach_set_goals (0002, upsert semantics from 0054): any staff/trainer may still set protein
-- and calorie targets, but only a weight-allowed caller may set (or implicitly clear) the
-- target weight. A restricted caller's payload has its 'weight' key REPLACED by the athlete's
-- existing stored value — their save works, the weight field simply isn't theirs to move.
-- Null-arg semantics (a null new_targets leaves targets untouched) are preserved from 0054.
create or replace function coach_set_goals(athlete uuid, new_targets jsonb, new_season_goal jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_targets jsonb := new_targets;
  v_existing_weight jsonb;
begin
  if not (is_team_coach_of(athlete) or is_trainer_of(athlete)) then
    raise exception 'not authorized to set goals for this athlete';
  end if;
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
