-- 0228: score v3 evidence ceiling (2026-09-09)
--
-- Score v3 moves food to 82 of the 100 and the nightly check-in to 18 (9 for submitting it,
-- 9 for answering every question). PROFILE_WEIGHTS in scoringProfiles.ts / plan-style.js are
-- the source; this trigger only mirrors the per-slot MAXIMUM so it can bound a fabricated
-- over-report without knowing the profile. Same shape as 0193, one more dated era:
--
--   date <  2026-08-16 : v1/v2/v3 union  nutrition 82 / check-in 35 / commitment 15
--   date <  2026-09-09 : v2/v3 union     nutrition 82 / check-in 24 / commitment 0
--   date >= 2026-09-09 : v3              nutrition 82 / check-in 18 / commitment 0
--
-- Each era's ceiling is the UNION with every later era because a row dated in an older era can
-- still be written by the newer engine (offline backlog, a re-push) — a ceiling is only safe in
-- the loose direction. scoreIntegrity.ts is the tested spec; its property test proves a real
-- score never exceeds its own ceiling on every side of both cutovers. Caps, never recomputes.

create or replace function clamp_day_score_to_evidence() returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cutover   constant date := date '2026-08-16';  -- == SCORING_V2_CUTOVER in scoreIntegrity.ts
  v_cutover3  constant date := date '2026-09-09';  -- == SCORING_V3_CUTOVER in scoreIntegrity.ts
  v_nutrition boolean;
  v_checkin   boolean;
  v_commit    boolean;
  v_carry     boolean;
  v_ceiling   int;
begin
  if new.score is null then
    return new;                                   -- nothing to bound on a fresh/unset day
  end if;

  if coalesce(jsonb_typeof(new.meals), 'null') <> 'object'
     or coalesce(jsonb_typeof(new.checkin), 'null') <> 'object'
     or coalesce(jsonb_typeof(new.quick_added), 'null') <> 'array' then
    raise exception using
      errcode = '22023',
      message = 'days: unreadable evidence shape; refusing to score this row',
      detail  = format('meals=%s checkin=%s quick_added=%s (expected object/object/array)',
                       coalesce(jsonb_typeof(new.meals), 'null'),
                       coalesce(jsonb_typeof(new.checkin), 'null'),
                       coalesce(jsonb_typeof(new.quick_added), 'null')),
      hint    = 'The evidence ceiling cannot bound a score it cannot read. Fix the writer rather than relaxing this check.';
  end if;

  v_nutrition := coalesce(
    exists (select 1 from jsonb_each(new.meals) e where e.value = 'true'::jsonb)
    or (jsonb_typeof(new.checkin -> 'slotMacros') = 'object' and (new.checkin -> 'slotMacros') <> '{}'::jsonb)
    or exists (select 1 from jsonb_array_elements(new.quick_added) q where q.value = 'true'::jsonb)
    or exists (
      select 1 from trust_passes tp
      where tp.athlete_id = new.athlete_id
        and tp.ended_at is null
        and tp.granted_date <= new.date
        and new.date < tp.granted_date + tp.length_days
    ), false);

  if new.date < v_cutover then
    v_carry := coalesce(
      (case when new.checkin ->> 'ciLast' ~ '^\d{4}-\d{2}-\d{2}$'
            then (new.checkin ->> 'ciLast')::date between new.date - 6 and new.date
            else false end)
      or exists (
        select 1 from days d2
        where d2.athlete_id = new.athlete_id
          and d2.date < new.date
          and d2.date >= new.date - 6
          and (d2.checkin ->> 'submitted') = 'true'
      ), false);
  else
    v_carry := false;
  end if;

  v_checkin := coalesce((new.checkin ->> 'submitted') = 'true', false) or v_carry;
  v_commit := coalesce((new.checkin ->> 'commitment') in ('yes', 'partial', 'no'), false);

  if new.date < v_cutover then
    v_ceiling := least(100,
        (case when v_nutrition then 82 else 0 end)   -- max(v1 55, v2 78, v3 82)
      + (case when v_checkin  then 35 else 0 end)    -- max(v1 25 + 10, v2 24, v3 18)
      + (case when v_commit   then 15 else 0 end)    -- max(v1 15, v2 0, v3 0)
    );
  elsif new.date < v_cutover3 then
    v_ceiling := least(100,
        (case when v_nutrition then 82 else 0 end)   -- max(v2 78, v3 82)
      + (case when v_checkin  then 24 else 0 end)    -- max(v2 24, v3 18)
    );
  else
    v_ceiling := least(100,
        (case when v_nutrition then 82 else 0 end)
      + (case when v_checkin  then 18 else 0 end)
    );
  end if;

  if new.score > v_ceiling then
    new.score := v_ceiling;
    new.grade := case
      when v_ceiling >= 90 then 'A'
      when v_ceiling >= 80 then 'B'
      when v_ceiling >= 70 then 'C'
      when v_ceiling >= 60 then 'D'
      else 'F'
    end;
  end if;
  return new;
end;
$$;
