-- OnStandard 0254: the targets door checks WHO is at it (review round, phase B, 2026-09-26).
--
-- coach_set_goals (0002 -> 0054 upsert -> 0103 weight guard -> 0142 plan-style checks) authorized
-- `is_team_coach_of(athlete) or is_trainer_of(athlete)`. is_team_coach_of is ANY active staff row on
-- the athlete's team, whatever its role: a view-only staffer, a position coach and an athletic
-- trainer could all rewrite an athlete's protein and calorie targets by calling the RPC directly,
-- although the app never offered them the screen for it (and 0078 had already walled every other
-- coach write behind is_write_staff). Phase B's decide_target_suggestion applies approved numbers
-- through this function, so the hole now had a second way in.
--
-- The gate becomes can_decide_targets_for(athlete) (0253): can_view (the staff scope and the
-- minor-consent gate, 0081) AND either the athlete's trainer, or team staff whose role edits the
-- standard (head coach, coordinator and its legacy 'assistant', nutritionist, S&C, team admin; the
-- proto staff-access.js CREATE_CAPS 'standards' list, pinned by season-phase.test.mjs).
--
-- Everything else is 0142's body VERBATIM: the plan-style validation, the 0103 weight guard (a
-- caller who may not see weight keeps the stored weight), the upsert and its null-arg semantics.
--
-- BEHAVIOUR CHANGE, deliberately: view-only staff, position coaches and athletic trainers are now
-- refused (the client hides Save for them, screens/coach.js), and so is any staffer who cannot
-- view the athlete (out of their scope, or a minor without verified guardian consent: the same
-- athletes can_view already hides from them). A trainer keeps full use for their own clients.
--
-- Apply after 0253 (it calls can_decide_targets_for). Re-runnable.

create or replace function coach_set_goals(athlete uuid, new_targets jsonb, new_season_goal jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_targets jsonb := new_targets;
  v_existing_weight jsonb;
begin
  if not can_decide_targets_for(athlete) then
    raise exception 'not authorized to set goals for this athlete' using errcode = '42501';
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
