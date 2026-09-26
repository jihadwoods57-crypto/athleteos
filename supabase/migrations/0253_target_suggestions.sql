-- OnStandard 0253: adaptive targets, suggested then approved (goals and eating plan, phase B,
-- 2026-09-26; hardened in the review round the same day).
--
-- Founder, 2026-09-26: target changes need coach approval. The athlete's device looks at their
-- weight pace (at most once every 14 days, deterministic, no model call: proto
-- js/target-suggest-model.js) and, when a gaining or losing adult is off the plan's pace, files ONE
-- suggestion here. It is labelled "Suggested change" and never signed as Nia.
--
-- NOTHING ON THE ROW IS THE ATHLETE'S SAY-SO (review 2026-09-26). The device proposes; the database
-- decides what is true:
--   * current_protein / current_kcal must equal the athlete's STORED targets
--     (athlete_profiles.targets) wherever those exist. A mismatch is REFUSED (23514 stale_targets)
--     rather than silently overwritten: a device holding stale targets also computed its proposal
--     from them, so the honest answer is "refresh and try again", not a row that mixes the two.
--     Where nothing is stored (goal-derived targets, which only the device computes, see 0252's
--     note) the device's numbers stand, inside the table's bounds.
--   * the PACE is the server's own: a least-squares fit over the athlete's days.current_weight in
--     the last 21 days (at least 3 weigh-ins spanning at least 10 days). Whatever pace the client
--     sent is overwritten, and so are the plan, the counts and the bodyweight the row is based on.
--   * there is no free-text reason. The row stores numbers (pace_lb_wk, plan_lb_wk, weigh_ins,
--     span_days, basis_lb) and the client composes the sentence from them.
--   * calories move at most 250 either way, never below the 1500 floor, only when the pace is
--     outside the plan's tolerance, and only TOWARD the plan (gaining slower means more food,
--     losing slower means less, too fast either way goes back toward the plan).
--   * protein stays unless the bodyweight moved the per-pound target (gain 1.0 g/lb, lose 0.9 g/lb,
--     rounded to 5, floor 80: the same rule as state.js goalDerivedTargets) by 10g or more, and then
--     it moves by exactly that much. Never below 80.
--   * never for a provable minor (0050: unknown age is an adult); only for a gain or lose goal;
--   * at most one per athlete per 14 days, counted from the later of when the last one was made and
--     when it was decided, so a decline also buys 14 quiet days. A per-athlete advisory lock makes
--     the check-then-insert atomic, so two devices cannot both slip through.
--   * a pending row older than 14 days is expired: nobody can decide it, and the next insert sweeps
--     it to 'expired'.
--
-- WHO DECIDES (decide_target_suggestion, the ONLY way a row changes)
--   * An athlete on a team, or a trainer's client: linked staff with target-edit rights
--     (can_decide_targets_for: the staff who edit the standard and can view the athlete, or the
--     trainer). APPROVE is one atomic step: the server re-checks the row against the athlete's live
--     stored targets and applies the numbers itself through coach_set_goals (gated the same way by
--     0254), keeping every other target key (plan style, overrides, weight). The client never
--     writes the targets and then marks the row, so the two can never disagree.
--   * A solo athlete (no team, no trainer): themselves. Approving writes ONLY protein, calories and
--     source 'self' into their own targets; every other key is left exactly as it was.
--   * Stale (the stored targets moved since the row was filed): the approval applies nothing,
--     closes the row as expired and answers 'stale'.
--   * 'expire' closes a pending row by hand (a client that saw the targets change).
--   * An athlete on a team or a practice client never self-approves. Guardians see nothing.

create table if not exists public.target_suggestions (
  id               uuid primary key default gen_random_uuid(),
  athlete_id       uuid not null references public.profiles(id) on delete cascade,
  team_id          uuid references public.teams(id) on delete set null,
  created_at       timestamptz not null default now(),
  current_protein  int not null check (current_protein between 0 and 500),
  current_kcal     int not null check (current_kcal between 0 and 9000),
  proposed_protein int not null check (proposed_protein between 0 and 500),
  proposed_kcal    int not null check (proposed_kcal between 1500 and 9000),
  -- The server's own measurements (overwritten on insert; never the client's).
  pace_lb_wk       numeric(4,1) check (pace_lb_wk between -20 and 20),
  plan_lb_wk       numeric(3,1) check (plan_lb_wk in (0.5, -1.0)),
  weigh_ins        int check (weigh_ins between 0 and 100),
  span_days        int check (span_days between 0 and 30),
  basis_lb         numeric(5,1) check (basis_lb between 40 and 1000),
  status           text not null default 'pending' check (status in ('pending', 'approved', 'declined', 'expired')),
  decided_by       uuid references public.profiles(id) on delete set null,
  decided_at       timestamptz,
  check (abs(proposed_kcal - current_kcal) <= 250),
  check (proposed_protein >= 80 or proposed_protein = current_protein),
  check (abs(proposed_protein - current_protein) <= 60),
  check (proposed_kcal <> current_kcal or proposed_protein <> current_protein)
);

create index if not exists target_suggestions_athlete on public.target_suggestions (athlete_id, created_at desc);
create index if not exists target_suggestions_pending on public.target_suggestions (team_id, created_at desc) where status = 'pending';

comment on table public.target_suggestions is
  'Adaptive target suggestions (phase B): proposed by the athlete''s device, anchored and bounded by the server (stored targets, its own weight pace, per-pound protein, 250 kcal step, floors), decided and applied atomically by decide_target_suggestion. Numbers only, never free text; never signed as Nia. 0253.';

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

/* Solo = no active team and no active trainer. Used only inside the definer functions below, so no
   client may call it (the 0050/0051 is_provable_minor pattern: no membership oracle). */
create or replace function is_solo_athlete(p_athlete uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select not exists (select 1 from team_members m where m.athlete_id = p_athlete and m.status = 'active')
     and not exists (select 1 from practice_clients pc where pc.client_id = p_athlete and pc.status = 'active');
$$;
revoke all on function is_solo_athlete(uuid) from public, anon, authenticated;

/* The per-pound protein target at a bodyweight: state.js goalDerivedTargets' rule (round to 5,
   floor 80). Pinned against target-suggest-model.js PLAN.perLb by target-suggest.test.mjs. */
create or replace function ts_protein_at(p_fam text, p_lb numeric) returns int
language sql immutable set search_path = public as $$
  select greatest(80, (round(p_lb * case when p_fam = 'gain' then 1.0 else 0.9 end / 5) * 5)::int);
$$;
revoke all on function ts_protein_at(text, numeric) from public, anon, authenticated;

/* A stored target figure, or null when it is absent or not a plain number. */
create or replace function ts_num(p jsonb, k text) returns numeric
language sql immutable set search_path = public as $$
  select case when p ? k and (p ->> k) ~ '^[0-9]+(\.[0-9]+)?$' and (p ->> k)::numeric > 0
              then round((p ->> k)::numeric) end;
$$;
revoke all on function ts_num(jsonb, text) from public, anon, authenticated;

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
  v_goal text; v_fam text; v_plan numeric; v_tol numeric;
  v_t jsonb; v_base numeric; v_sp numeric; v_sk numeric;
  v_pace numeric; v_n int; v_span int; v_latest numeric;
  v_dk int; v_dp int; v_expect int;
begin
  -- One athlete's inserts run one at a time: the cadence check below and this insert are atomic.
  perform pg_advisory_xact_lock(hashtextextended('target_suggestions:' || new.athlete_id::text, 0));

  if is_provable_minor(new.athlete_id) then
    raise exception 'no target suggestions for a minor' using errcode = '42501';
  end if;
  select lower(coalesce(ap.base_goal, '')), ap.targets, ap.base_weight into v_goal, v_t, v_base
    from athlete_profiles ap where ap.athlete_id = new.athlete_id;
  v_fam := case when v_goal in ('gain', 'build', 'gain_muscle', 'gain_weight') then 'gain'
                when v_goal in ('lose', 'lose_fat') then 'lose' end;
  if v_fam is null then
    raise exception 'target suggestions are for a gain or lose goal' using errcode = '23514';
  end if;
  v_plan := case v_fam when 'gain' then 0.5 else -1.0 end;
  v_tol  := case v_fam when 'gain' then 0.15 else 0.25 end;

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

  -- Anchored to the stored targets wherever they exist (refused, never silently rewritten).
  v_sp := ts_num(v_t, 'protein'); v_sk := ts_num(v_t, 'calories');
  if (v_sp is not null and new.current_protein <> v_sp) or (v_sk is not null and new.current_kcal <> v_sk) then
    raise exception 'stale_targets: the current values are not the stored targets' using errcode = '23514';
  end if;

  -- The server's own pace.
  select round((regr_slope(d.current_weight::float8, (d.date - date '2000-01-01')::float8) * 7)::numeric, 1),
         count(*)::int, (max(d.date) - min(d.date))::int,
         (array_agg(d.current_weight order by d.date desc))[1]
    into v_pace, v_n, v_span, v_latest
    from days d
   where d.athlete_id = new.athlete_id and d.current_weight is not null
     and d.date >= current_date - 21 and d.date <= current_date + 1;
  if coalesce(v_n, 0) < 3 or coalesce(v_span, 0) < 10 or v_pace is null then
    raise exception 'not enough weigh-ins for a suggestion' using errcode = '23514';
  end if;

  -- Calories: only when off plan, only toward it, never under the floor (table check), <= 250.
  v_dk := new.proposed_kcal - new.current_kcal;
  if v_dk <> 0 then
    if new.current_kcal < 1500 then
      raise exception 'a target under the floor is a coach call; the pace never moves it' using errcode = '23514';
    end if;
    if abs(v_pace - v_plan) <= v_tol then
      raise exception 'on plan: no calorie change is justified' using errcode = '23514';
    end if;
    if sign(v_dk) <> sign(v_plan - v_pace) then
      raise exception 'a calorie change must move toward the plan' using errcode = '23514';
    end if;
  end if;

  -- Protein: unchanged, or moved by exactly what the bodyweight moved the per-pound target.
  v_dp := new.proposed_protein - new.current_protein;
  v_expect := case when v_base is null then 0 else ts_protein_at(v_fam, v_latest) - ts_protein_at(v_fam, v_base) end;
  if v_dp <> 0 and (abs(v_expect) < 10 or v_dp <> v_expect) then
    raise exception 'a protein change must follow the per-pound rule' using errcode = '23514';
  end if;

  new.pace_lb_wk := v_pace;
  new.plan_lb_wk := v_plan;
  new.weigh_ins := v_n;
  new.span_days := v_span;
  new.basis_lb := v_latest;
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
/* p_decision: 'approved' | 'declined' | 'expire'. Returns the outcome:
     'approved'  the numbers are applied (staff: through coach_set_goals; solo: into their own targets)
     'declined'  closed, 14 quiet days
     'expired'   closed: it was older than 14 days, or a decider closed it by hand ('expire')
     'stale'     an approval found the stored targets had moved; nothing applied, row closed
   Raises on anyone who may not decide it, and on a row that is already decided. */
drop function if exists decide_target_suggestion(uuid, text);
create or replace function decide_target_suggestion(p_id uuid, p_decision text) returns text
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  r target_suggestions%rowtype;
  v_self boolean;
  v_t jsonb;
  v_goal text;
  v_sp numeric; v_sk numeric;
begin
  if v_uid is null then raise exception 'not signed in'; end if;
  if p_decision is null or p_decision not in ('approved', 'declined', 'expire') then
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
  if p_decision = 'expire' then
    update target_suggestions set status = 'expired', decided_by = v_uid, decided_at = now() where id = p_id;
    return 'expired';
  end if;

  if p_decision = 'approved' then
    -- Re-check against the LIVE record: still an adult on a gain/lose goal, and the stored targets
    -- are still the ones the row was filed against. Anything else is stale: apply nothing.
    select lower(coalesce(ap.base_goal, '')), ap.targets into v_goal, v_t
      from athlete_profiles ap where ap.athlete_id = r.athlete_id;
    v_sp := ts_num(v_t, 'protein'); v_sk := ts_num(v_t, 'calories');
    if is_provable_minor(r.athlete_id)
       or coalesce(v_goal, '') not in ('gain', 'build', 'gain_muscle', 'gain_weight', 'lose', 'lose_fat')
       or (v_sp is not null and v_sp <> r.current_protein)
       or (v_sk is not null and v_sk <> r.current_kcal)
       -- The table checks hold the bounds relative to current; re-assert the floors on the way out.
       or r.proposed_kcal < 1500
       or (r.proposed_protein < 80 and r.proposed_protein <> r.current_protein) then
      update target_suggestions set status = 'expired', decided_by = v_uid, decided_at = now() where id = p_id;
      return 'stale';
    end if;

    if v_self then
      -- Only the two numbers and the marker. Every other key stays exactly as it was.
      update athlete_profiles
         set targets = coalesce(targets, '{}'::jsonb)
                       || jsonb_build_object('protein', r.proposed_protein, 'calories', r.proposed_kcal, 'source', 'self'),
             updated_at = now()
       where athlete_id = v_uid;
    else
      -- The same gated door a hand edit uses (0254), in this transaction. The stored JSON is kept
      -- whole (style, overrides, weight); a self-accepted marker is dropped: the numbers are theirs now.
      perform coach_set_goals(r.athlete_id,
        (coalesce(v_t, '{}'::jsonb) - 'source') || jsonb_build_object('protein', r.proposed_protein, 'calories', r.proposed_kcal),
        null);
    end if;
  end if;

  update target_suggestions
     set status = case when p_decision = 'approved' then 'approved' else 'declined' end,
         decided_by = v_uid, decided_at = now()
   where id = p_id;
  return p_decision;
end $$;
revoke all on function decide_target_suggestion(uuid, text) from public, anon;
grant execute on function decide_target_suggestion(uuid, text) to authenticated;
