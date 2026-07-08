-- OnStandard — server-side score-integrity ceiling (closes the gap 0029 left open).
-- Forward-only, idempotent.
--
-- 0029 bounded days.score to the SHAPE [0..100] + a valid letter, but explicitly did NOT
-- stop a PLAUSIBLE-but-fake in-range score (a tampered client POSTing a flat 100 with no
-- logging). It ruled out a server RECOMPUTE because computeDerived() needs inputs the `days`
-- table doesn't persist (targets, ciConfig, mealFoods, scoringProfile) — a partial port
-- would DRIFT and mis-score every athlete.
--
-- This takes the safe path instead: a monotone UPPER BOUND on the score from the evidence a
-- row DOES carry. It is NOT a recompute — it only CLAMPS a score that exceeds what the
-- evidence can justify. A real day's score is always <= its own evidence ceiling (proven by
-- src/core/scoreIntegrity.test.ts, the property test), so this can NEVER lower an honest
-- score; it can only cut a fabricated over-report. Mirrors src/core/scoreIntegrity.ts.
--
-- Ceiling = sum of the slots the evidence unlocks, using the MAX sub-score weight across all
-- scoring profiles (athlete/general/gain) so it holds whatever profile the athlete is on:
--   nutrition 55  — a meal slot logged, OR an active trust pass credits camera-free
--   recovery 25 + check-in 10  — a real check-in backs the week (today, or carried <=6 days)
--   commitment 15 — a plan-commitment answer on the row
-- KEEP THESE WEIGHTS IN SYNC with src/core/scoringProfiles.ts PROFILE_WEIGHTS (max per column).

create or replace function clamp_day_score_to_evidence() returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_nutrition boolean;
  v_checkin   boolean;
  v_commit    boolean;
  v_ceiling   int;
begin
  if new.score is null then
    return new;                                   -- nothing to bound on a fresh/unset day
  end if;

  -- nutrition slot: any meal slot toggled logged (meal-count credit alone makes nutrition
  -- > 0), OR a real plate rode in on the check-in blob, OR an active, date-covering trust
  -- pass (a proven athlete's camera-free credit). Any one keeps the 55 slot unlocked.
  v_nutrition :=
    exists (select 1 from jsonb_each(coalesce(new.meals, '{}'::jsonb)) e where e.value = 'true'::jsonb)
    or (jsonb_typeof(new.checkin -> 'slotMacros') = 'object' and (new.checkin -> 'slotMacros') <> '{}'::jsonb)
    or exists (
      select 1 from trust_passes tp
      where tp.athlete_id = new.athlete_id
        and tp.ended_at is null
        and tp.granted_date <= new.date
        and new.date < tp.granted_date + tp.length_days
    );

  -- recovery + check-in slots: a real check-in backs the week. Any ONE of:
  --   (a) submitted today;
  --   (b) the row's own last-check-in marker (checkin.ciLast) falls in the trailing 6 days —
  --       an honest weekly carry the row SELF-DESCRIBES (mirrors the engine's ciCarryValid).
  --       This is what stops an honest carry day being clamped when the original check-in
  --       day's row never reached Postgres (offline / pre-consent) — the false positive a
  --       cross-row-only check would cause. Cast is CASE-guarded so a malformed/tampered
  --       value can never raise and fail the write.
  --   (c) a prior submitted row is still visible in the trailing 6 days (bonus path).
  v_checkin :=
    (new.checkin ->> 'submitted') = 'true'
    or (case when new.checkin ->> 'ciLast' ~ '^\d{4}-\d{2}-\d{2}$'
             then (new.checkin ->> 'ciLast')::date between new.date - 6 and new.date
             else false end)
    or exists (
      select 1 from days d2
      where d2.athlete_id = new.athlete_id
        and d2.date < new.date
        and d2.date >= new.date - 6
        and (d2.checkin ->> 'submitted') = 'true'
    );

  -- commitment slot: a plan-commitment answer is present on the row.
  v_commit := (new.checkin ->> 'commitment') in ('yes', 'partial', 'no');

  v_ceiling := least(100,
      (case when v_nutrition then 55 else 0 end)
    + (case when v_checkin  then 35 else 0 end)   -- recovery 25 + check-in 10
    + (case when v_commit   then 15 else 0 end)
  );

  if new.score > v_ceiling then
    new.score := v_ceiling;
    -- Recompute the letter to match the clamped score (mirror src/core scoring.ts gradeFor).
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

drop trigger if exists days_score_evidence_ceiling on public.days;
create trigger days_score_evidence_ceiling
  before insert or update on public.days
  for each row execute function clamp_day_score_to_evidence();

-- --------------------------------------------------------------------------------------------
-- SMOKE TEST — run against a staging/local DB BEFORE applying to production. The logic is
-- proven in jest (scoreIntegrity.test.ts); this checks the SQL data-shape (jsonb keys, meals
-- boolean encoding) against real rows. Expected: legit rows unchanged, a fabricated row clamped.
--
--   -- 1. A fabricated "flat 100, no evidence" row must clamp to 0 / 'F':
--   insert into days (athlete_id, date, meals, checkin, score, grade)
--     values ('<a-test-athlete-uuid>', current_date, '{}'::jsonb, '{}'::jsonb, 100, 'A')
--     on conflict (athlete_id, date) do update set score = 100, grade = 'A';
--   select score, grade from days where athlete_id = '<...>' and date = current_date;  -- expect 0 / F
--
--   -- 2. A real logged day must be UNCHANGED (score <= its own ceiling, so no clamp):
--   --    e.g. meals '{"breakfast":true,"lunch":true}', checkin '{"submitted":true,"commitment":"yes"}',
--   --    score 88 -> stays 88 (ceiling 100).
--
--   -- 3. Sanity: no EXISTING live row moves. This must return 0 rows —
--   select athlete_id, date, score from days d
--   where score is not null
--     and score > least(100,
--         (case when exists (select 1 from jsonb_each(coalesce(meals,'{}'::jsonb)) e where e.value='true'::jsonb)
--                 or (jsonb_typeof(checkin->'slotMacros')='object' and (checkin->'slotMacros')<>'{}'::jsonb)
--                 or exists (select 1 from trust_passes tp where tp.athlete_id=d.athlete_id and tp.ended_at is null
--                            and tp.granted_date<=d.date and d.date<tp.granted_date+tp.length_days)
--               then 55 else 0 end)
--       + (case when (checkin->>'submitted')='true'
--                 or (checkin->>'ciLast' ~ '^\d{4}-\d{2}-\d{2}$' and (checkin->>'ciLast')::date between d.date-6 and d.date)
--                 or exists (select 1 from days d2 where d2.athlete_id=d.athlete_id and d2.date<d.date
--                            and d2.date>=d.date-6 and (d2.checkin->>'submitted')='true')
--               then 35 else 0 end)
--       + (case when (checkin->>'commitment') in ('yes','partial','no') then 15 else 0 end));
--   -- If this returns rows, they are days whose stored score exceeds the evidence ceiling
--   -- (either historical fakes, or a gate that needs widening) — investigate before applying.
