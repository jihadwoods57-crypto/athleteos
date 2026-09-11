-- 0232: the coach-assigned morning becomes a scoring slot (2026-09-11)
--
-- A coach can assign a wake-up roll call (morning_roll_call). On a day one was assigned, the
-- nightly check-in's 18 points are split: the check-in keeps 10 and the morning takes 8. Food's
-- 82 never moves. On every other day -- which is every day for every athlete whose coach has not
-- set a wake-up -- the mix is exactly what 0228 shipped.
--
--   ordinary day     nutrition 82 / check-in 18 / wake-up  0
--   wake-up day      nutrition 82 / check-in 10 / wake-up  8
--
-- WHY THERE IS NO NEW CUTOVER DATE. Every other score era needed one because the weights moved
-- underneath rows that were already written. This one cannot: the morning is only ever scored on
-- a row that CARRIES the evidence for it, and `checkin -> 'wakeup'` is written by no engine that
-- shipped before today. Every historical row has no wake-up key, takes the `else` branch below,
-- and gets byte-for-byte the ceiling it has always had. The dated eras above are untouched.
--
-- WHAT COUNTS AS A DECIDED MORNING. Only 'on_standard', 'late' and 'missed'. This mirrors proto
-- day.js wakeupParts and src/core/scoreIntegrity.ts evidenceFromDayRow, which are the tested
-- spec. A 'pending' morning is still OPEN and docking it at 6:05 for a roll call that closes at
-- 6:30 would be a lie the clock corrects later; 'excused' means the coach told them to skip it;
-- 'review' counts as nothing until a coach resolves it. All three leave the denominator, so the
-- day is bounded exactly as an ordinary day -- 18 for the check-in, nothing for the morning.
--
-- Note the ASYMMETRY between the two wake-up gates, which is the whole safety argument. Being
-- assigned SHRINKS the check-in slot (18 -> 10); only being ANSWERED grants the morning's 8. So a
-- missed morning is bounded at 92, which is what the client computes for it, and an unanswered
-- one can never buy ceiling it did not earn.
--
-- Caps, never recomputes. Same shape as 0228.

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
  v_verdict   text;
  v_wake_earned   boolean;
  v_wake_assigned boolean;
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

  -- The morning. Absent on every row written before this shipped, which is the point.
  v_verdict := case
    when jsonb_typeof(new.checkin -> 'wakeup') = 'object'
     and (new.checkin -> 'wakeup' ->> 'assigned') = 'true'
    then coalesce(new.checkin -> 'wakeup' ->> 'verdict', '')
    else ''
  end;
  v_wake_earned   := v_verdict in ('on_standard', 'late');
  v_wake_assigned := v_wake_earned or v_verdict = 'missed';

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
      -- 18 on an ordinary day; 10 once a decided morning has taken its share of it.
      + (case when v_checkin then (case when v_wake_assigned then 10 else 18 end) else 0 end)
      + (case when v_wake_earned then 8 else 0 end)
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
