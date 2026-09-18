-- 0234: the coach-assigned Recovery Standard joins the night's scoring slot (2026-09-18)
--
-- A coach can now set a sleep target (checkin -> 'sleepStandard' -> 'targetHours'/'minHours'),
-- judged against a measured reading (checkin ->> 'sleepHours'). It scores the way the morning
-- roll call does, and it SHARES the morning's budget rather than taking a second one.
--
--   ordinary day      nutrition 82 / check-in 18 / night 0
--   night assigned    nutrition 82 / check-in 10 / night 8     (morning, sleep, or both)
--
-- WHY THEY SHARE. The morning and the sleep target are two ends of one behaviour: did this
-- athlete run their night properly. Letting each take 8 out of the check-in's 18 would leave the
-- two check-in slots 2 points between them on a day carrying both, and the check-in is the ONE
-- component every athlete can earn with no hardware at all. Reducing it to two points so a ring
-- owner can be measured twice is backwards. Food's 82 is a founder ruling and never a candidate.
--
-- WHY THERE IS NO NEW CUTOVER DATE, same argument 0232 made and it still holds: no engine that
-- shipped before today writes `checkin -> 'sleepStandard'`, so every historical row reads false
-- at the new gate, takes the identical branch, and is bounded byte-for-byte as it always was.
--
-- A STANDARD WITH NO READING IS NOT ASSIGNED. It cannot shrink a check-in slot and cannot cost a
-- point. Most of a real roster owns no wearable, and none of them may be scored for it.
--
-- ⚠ COPIED FROM 0233, NOT 0232. 0232 was written by copying 0228, which had itself been copied
-- from 0193 and silently carried back the pre-0196 trust_passes gate (granted_date + length_days,
-- columns 0196 had DROPPED). That raised 42703 on every day write and nothing synced for two
-- days. The trust-pass block below is 0233's covers_from/covers_until shape. Do not copy this
-- function forward from anything but the newest migration that touched it.
--
-- Caps, never recomputes. Same shape as 0233.

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
  v_sleep_hours   numeric;
  v_sleep_target  numeric;
  v_sleep_earned   boolean;
  v_sleep_assigned boolean;
  v_night_earned   boolean;
  v_night_assigned boolean;
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

  -- (d) is the 0196 shape, NOT 0193's. 0196 replaced trust_passes' fixed granted_date +
  -- length_days window with a covers_from/covers_until window plus spendable credits, and
  -- rewrote this function to match. 0228 reintroduced the 0193 block, which is what broke it.
  v_nutrition := coalesce(
    exists (select 1 from jsonb_each(new.meals) e where e.value = 'true'::jsonb)
    or (jsonb_typeof(new.checkin -> 'slotMacros') = 'object' and (new.checkin -> 'slotMacros') <> '{}'::jsonb)
    or exists (select 1 from jsonb_array_elements(new.quick_added) q where q.value = 'true'::jsonb)
    or exists (
      select 1 from trust_passes tp
      where tp.athlete_id = new.athlete_id
        and tp.ended_at is null
        and new.date <= tp.expires_on
        and tp.covers_from is not null
        and new.date between tp.covers_from and tp.covers_until
    )
    or exists (
      select 1 from pass_spends ps
      where ps.athlete_id = new.athlete_id and ps.day_date = new.date
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

  -- The Recovery Standard. Absent on every row written before this shipped, exactly as the
  -- morning was: no engine that has already run writes `checkin -> 'sleepStandard'`, so every
  -- historical row reads false here and is bounded precisely as it always has been.
  --
  -- A STANDARD WITH NO READING IS NOT ASSIGNED. A ring on a charger, a watch that did not sync, a
  -- night away from home: none of those are evidence that an athlete slept badly, and none may
  -- shrink a check-in slot or cost a point. It leaves the denominator, exactly as an excused
  -- morning does. This mirrors proto day.js recoveryStandardParts, which is the tested spec.
  v_sleep_target := nullif(new.checkin -> 'sleepStandard' ->> 'targetHours', '')::numeric;
  v_sleep_hours  := nullif(new.checkin ->> 'sleepHours', '')::numeric;
  v_sleep_assigned := coalesce(v_sleep_target > 0 and v_sleep_hours > 0, false);
  -- The ladder's floor is 25, never 0, so any judged night earns part of the slot.
  v_sleep_earned   := v_sleep_assigned;

  -- ONE NIGHT, ONE BUDGET. The morning and the Recovery Standard are two ends of the same
  -- behaviour and share NIGHT_SHIFT between them, so either one assigned shrinks the check-in by
  -- the same 8 and either one earned grants the same 8 back. A day carrying both is bounded
  -- exactly as a day carrying one, which is also what both engines compute for it.
  v_night_earned   := v_wake_earned or v_sleep_earned;
  v_night_assigned := v_wake_assigned or v_sleep_assigned;

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
      + (case when v_checkin then (case when v_night_assigned then 10 else 18 end) else 0 end)
      + (case when v_night_earned then 8 else 0 end)
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
