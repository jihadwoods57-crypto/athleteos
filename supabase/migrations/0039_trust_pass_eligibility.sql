-- OnStandard — trust-pass eligibility from photo-backed evidence (audit 2026-07-02, item 15 slice)
--
-- THE GAP: grant_trust_pass gated eligibility on `count(days where score >= 80)`, but days.score is
-- computed CLIENT-side and only shape-checked server-side (0029) — a tampered client can post a flat
-- 85 history and manufacture eligibility for the camera-free reward. This is the near-term slice of
-- "move score authority server-side": base eligibility on evidence the client cannot forge.
--
-- THE FIX: count distinct days on which the athlete actually PHOTO-logged a meal (meals.photo_path
-- not null). A photo is a real upload to the meal-photos bucket, MIME/size-guarded by 0029 — far
-- harder to fake than a score integer, and it is the RIGHT signal for THIS reward: the trust pass is
-- a camera-free privilege earned by proving you reliably photo-log. So eligibility now means "you
-- built the photo-logging habit for >= N days," which the pass literally rewards.
--
-- The full server-side score RECOMPUTE (persisting scoring inputs + recomputing) remains the larger
-- deferred item; this closes the forgeable-eligibility hole without it.
--
-- GUARDRAIL: authored + statically reviewed; NOT applied to live here (next go-live batch). Only the
-- eligibility source changes; the coach-link check, one-active-pass index, and RPC surface are intact.

create or replace function grant_trust_pass(p_athlete uuid, p_length int default 10, p_min_on_standard int default 7)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_photo_days int;
  v_id uuid;
begin
  if not is_team_coach_of(p_athlete) then
    raise exception 'not authorized to grant a trust pass to this athlete';
  end if;
  if p_length < 1 or p_length > 60 then
    raise exception 'invalid pass length';
  end if;
  -- Forgery-resistant eligibility: distinct days the athlete photographed a meal (a real storage
  -- upload), NOT the client-written days.score. Proof the photo-logging habit exists before the
  -- camera-free reward is granted.
  select count(distinct m.day_date) into v_photo_days
    from meals m
    where m.athlete_id = p_athlete and m.photo_path is not null;
  if v_photo_days < p_min_on_standard then
    raise exception 'athlete not eligible: % of % photo-logged days', v_photo_days, p_min_on_standard;
  end if;
  update trust_passes set ended_at = now() where athlete_id = p_athlete and ended_at is null;
  insert into trust_passes (athlete_id, granted_by, length_days)
    values (p_athlete, auth.uid(), p_length)
    returning id into v_id;
  return v_id;
end;
$$;
