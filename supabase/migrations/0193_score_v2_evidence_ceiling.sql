-- OnStandard — score v2 evidence ceiling, date-guarded. Replaces the 0041 trigger BODY
-- (same function name, same trigger name). Forward-only, idempotent.
--
-- WHY
-- 0041 hardcoded the v1 slots (nutrition 55 / recovery+check-in 35 / commitment 15) and clamps
-- EVERY write to days.score. Score v2 moves the formula to nutrition .76-.78, check-in .12,
-- recovery .12, commitment 0 — so a v2 client that computes an honest perfect-food day at 76
-- would have it stored as 55. No error, no log, just a wrong number in front of a coach. This
-- migration must land in the SAME release as the v2 client engine.
--
-- WHAT IT DOES
-- It is NOT a recompute. computeDerived() needs inputs `days` does not persist (per-athlete
-- protein/calorie targets, ciConfig, mealFoods, scoringProfile) — the 0029 note refused a partial
-- port because it would drift and mis-score every athlete. This is a monotone UPPER BOUND from
-- the evidence the row itself carries. It only ever LOWERS a score that exceeds what the evidence
-- can justify; it never raises one and never computes one.
--
-- WHAT IT DELIBERATELY DOES NOT DO
--   * It does not recompute or validate the score. A plausible in-range score with matching
--     evidence passes through untouched, however wrong it is.
--   * It does not exclude duplicate-flagged plates (see DUP below).
--   * It does not read `tasks`, `hydration_l`, `signals` or `plan_style`. None of them can move
--     a score under v2, so none of them is evidence.
--   * It does not touch rows on its own. Nothing is backfilled; a row only passes through this
--     trigger when something writes to it.
--
-- KEEP IN SYNC with src/core/scoreIntegrity.ts (SCORING_V2_CUTOVER, the ceiling slots, and
-- evidenceFromDayRow's gates) and with proto/redesign-2026-07/js/day.js (hasNutritionEvidence,
-- evidenceCeiling). scoreIntegrity.test.ts is the executable spec for all three.
--
-- ---------------------------------------------------------------------------------------------
-- ROLLOUT CONSTRAINT — READ BEFORE APPLYING.
-- Apply this migration any time BEFORE 2026-08-16. That is genuinely harmless: the pre-cutover
-- ceiling is >= the v1 ceiling for every evidence combination, so no v1 client's honest score can
-- be cut by it.
--
-- But the v2 CLIENT must be fully rolled out BY the cutover date, or the cutover date must move.
-- From 2026-08-16 onward this trigger judges every row under the v2 slots, and any client still on
-- v1 weights has its no-food days silently rewritten:
--   * v1 client, checked in tonight, no food logged: computes 25 + 10 + 15 = 50; v2 ceiling 24
--     -> stored 24.
--   * v1 client, carry-backed check-in + commitment, no food: ~46; v2 ceiling 0 (no submission
--     that day, and the carry no longer counts post-cutover) -> stored 0, grade F.
-- That is this task's own failure mode pointed the other way. The staggering rule is therefore
-- "0193 first, client no later than the cutover" — NOT "0193 is safe to apply alone indefinitely".
--
-- ---------------------------------------------------------------------------------------------
-- THE DATE GUARD
-- Rows dated before 2026-08-16 are judged under the PRE-CUTOVER ceiling; rows on or after it
-- under the v2 ceiling. Without the guard, any later UPDATE that so much as touches a historical
-- row would re-clamp it under v2 rules — a day whose only evidence was a commitment answer had a
-- legitimate v1 ceiling of 15 and would be rewritten to 0, and a carry-backed check-in day would
-- fall from 35 to 24. That is the frozen history the product promised not to move.
--
-- THE PRE-CUTOVER CEILING IS THE UNION OF BOTH ERAS, NOT STRICT v1
--   nutrition        78  = max(v1 55, v2 78)   <- the one slot that widens
--   check-in+recovery 35 = max(v1 35, v2 24)
--   commitment       15  = max(v1 15, v2  0)
-- A ceiling is only safe in the LOOSE direction: too loose clamps less and never touches an
-- honest score, too tight silently corrupts one. Strict v1 would be too tight, because a v2
-- score can legitimately land on a pre-cutover row — an offline backlog draining after the
-- cutover, a 12:05am push whose dateStamp is still yesterday, a re-push of a recent day. Under a
-- strict 55 those days would be cut from 76 to 55: the exact corruption this migration exists to
-- prevent, just moved a few days earlier. The union still grants everything v1 granted, so the
-- guard keeps doing its real job, and it can never move an existing row (it is >= the v1 ceiling
-- for every evidence combination, so anything that did not move under 0041 cannot move now).
--
-- ---------------------------------------------------------------------------------------------
-- HYDRATION IS THIS INVARIANT'S ONE LOAD-BEARING EXTERNAL DEPENDENCY.
-- `knobsFor` (proto/redesign-2026-07/js/plan-style.js:267,272) force-sets hydrationScored = false
-- and zeroes parts.hydration, so hydration currently pays out NOTHING toward nutrition. Every
-- point of the nutrition slot therefore has a logged plate or a quick-add behind it, which is
-- what makes the nutrition gate below a valid bound. IF HYDRATION IS EVER RE-ENABLED it becomes
-- an un-gated nutrition payout with no food evidence behind it, and this trigger will start
-- clamping real days: an athlete who only logged water would score > 0 with v_nutrition false.
-- Re-enabling hydration REQUIRES adding hydration_l to the nutrition gate here, in
-- scoreIntegrity.ts's evidenceFromDayRow, and in the proto's hasNutritionEvidence.
--
-- ---------------------------------------------------------------------------------------------
-- DUP: why duplicate-flagged plates are NOT excluded server-side.
-- The proto's client-side gate routes slots through `mealScored`, which excludes a slot whose
-- `slotMacros[k].flagged = 'dup'` (the 0062 photo-hash anti-cheat wall). That exclusion is
-- deliberately NOT mirrored here, for three reasons:
--   1. `flagged` is written BY THE CLIENT into a client-controlled jsonb. A tampering client —
--      the only threat model this trigger has — simply omits it, so excluding dup buys exactly
--      zero anti-tamper value. (A tamperer who wanted 78 points would set meals.breakfast = true
--      with no plate at all, which the dup check never sees.)
--   2. It is a TIGHTENING, and tightening is the corruption direction. The RN sync path
--      (store/sync.ts mapStateToDayRow) writes slotMacros as macros only and never emits
--      `flagged`; any future writer that sets `flagged` for a non-scoring reason would start
--      clamping honest days.
--   3. It costs nothing to omit. An honest client already self-limits with the TIGHTER proto
--      ceiling (day.js clampedScore) before pushing, so a dup-only day arrives with its
--      nutrition already scored at 0 and lands far under this ceiling regardless.
-- Net: the server ceiling is looser than the client's on this one point, on purpose.

create or replace function clamp_day_score_to_evidence() returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cutover   constant date := date '2026-08-16';  -- == SCORING_V2_CUTOVER in scoreIntegrity.ts
  v_nutrition boolean;
  v_checkin   boolean;
  v_commit    boolean;
  v_carry     boolean;
  v_ceiling   int;
begin
  if new.score is null then
    return new;                                   -- nothing to bound on a fresh/unset day
  end if;

  -- SHAPE CHECK — deliberately FAIL CLOSED AND LOUD, not fail-open and not a silent clamp.
  --
  -- A draft of this migration typeof-guarded each gate so a malformed value read as "no
  -- evidence". That was wrong: it traded 0041's loud failure (jsonb_each raises on a non-object
  -- and the write is rejected) for a SILENT clamp to 0 or 24 — the precise failure mode this
  -- whole migration exists to eliminate. Fail-open (skip the clamp on an unreadable row) fixes
  -- the silence but surrenders the control: a tampering client is the ONLY threat model here, and
  -- `meals: "x"` would then store a flat 100 unclamped.
  --
  -- Fail-closed is right because there is NO HONEST PATH to these shapes. Both writers build them
  -- structurally -- store/sync.ts from a typed Record/boolean[], day.js from object literals -- so
  -- a malformed row is a tamperer or a code regression, never an athlete's real day. Blocking is
  -- correct for the first and immediately visible for the second. Verified against live prod
  -- 2026-08-09: 0 of 6 rows have a bad shape, so this can never fire on existing data.
  --
  -- "Err loose" governs HOW MUCH ceiling to grant when the evidence is ambiguous. It does not ask
  -- us to accept a structurally invalid row.
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

  -- NUTRITION slot. The union of every way a day can earn food credit. Any ONE unlocks it:
  --   (a) any meal slot toggled logged. Scanned BY VALUE over the whole jsonb, never against a
  --       hardcoded classic-four key list — a room on a 5-/6-meal coach standard scores `meal-5`
  --       and `meal-6` (requirements.js STD_SLOT_MAP), and a key-list check would see nothing and
  --       erase that room's entire score.
  --   (b) a real plate rode in on the check-in blob (`checkin.slotMacros` non-empty).
  --   (c) a QUICK-ADD was tapped. This gate was missing from the TS mirror and is the bug that
  --       erased whole quick-add-only days on the proto side until it was fixed there — a day
  --       with real nutrition credit and a server ceiling of 0.
  --   (d) an active, date-covering trust pass (a proven athlete's camera-free credit).
  -- Shapes are already proven by the check above, so these read the columns directly. The whole
  -- expression is still coalesced: `checkin -> 'slotMacros'` is SQL NULL when the key is absent,
  -- and without the coalesce three-valued logic would leave v_nutrition NULL rather than false.
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

  -- CARRY. A weekly recovery carry is evidence for a PRE-cutover row ONLY. Under v2 the check-in
  -- means TONIGHT: the engine (score.ts / day.js checkinReal) scores recovery and check-in at 0
  -- unless the athlete submitted that day, so dropping the carry for a v2 row can never clamp an
  -- honest score — and it closes the tamper path where a fabricated `ciLast` bought 24 points
  -- with no check-in behind it. Computed only when it can matter, so a v2 write never pays for
  -- the cross-row scan.
  if new.date < v_cutover then
    v_carry := coalesce(
      -- (a) the row's OWN last-check-in marker inside the trailing 6 days — a carry the row
      --     SELF-DESCRIBES, so the server need not reconstruct cross-day history it cannot see.
      --
      --     SCOPE: this branch only ever matches RN-WRITTEN rows. store/sync.ts writes ciLast as a
      --     bare date STRING (`s.ciLast?.date ?? null`), which this regex matches. The proto —
      --     the shipped writer — writes the whole marker OBJECT (`ciLast: DAY.ciLast`, i.e.
      --     {date, recovery}; day.js), whose ->> text is `{"date":...}` and never matches. Live
      --     prod 2026-08-09: 5 of 6 rows carry ciLast as an object, 0 as a string, so in practice
      --     branch (b) is what has been doing the work. Documented rather than "fixed": no engine
      --     carries any more, so widening a pre-cutover gate to accept objects would buy nothing
      --     and only add tamper surface.
      --
      --     The cast is CASE-guarded so a malformed or tampered value can never raise.
      (case when new.checkin ->> 'ciLast' ~ '^\d{4}-\d{2}-\d{2}$'
            then (new.checkin ->> 'ciLast')::date between new.date - 6 and new.date
            else false end)
      -- (b) a prior submitted row still visible in the trailing 6 days. The path that actually
      --     fires for proto-written rows; see the scope note above.
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

  -- COMMITMENT slot: a plan-commitment answer is present on the row. Scores nothing under v2;
  -- still worth 15 on a frozen pre-cutover row, which is the whole reason the date guard exists.
  v_commit := coalesce((new.checkin ->> 'commitment') in ('yes', 'partial', 'no'), false);

  if new.date < v_cutover then
    -- PRE-CUTOVER: the union of both eras, slot by slot. See the header note.
    v_ceiling := least(100,
        (case when v_nutrition then 78 else 0 end)   -- max(v1 55, v2 78)
      + (case when v_checkin  then 35 else 0 end)    -- max(v1 recovery 25 + check-in 10, v2 24)
      + (case when v_commit   then 15 else 0 end)    -- max(v1 15, v2 0)
    );
  else
    -- v2: two pillars. Nutrition 78 (the max nutrition weight across athlete/general/gain), a
    -- real check-in 24 (recovery 12 + check-in 12). A commitment answer unlocks nothing.
    v_ceiling := least(100,
        (case when v_nutrition then 78 else 0 end)
      + (case when v_checkin  then 24 else 0 end)
    );
  end if;

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

-- ---------------------------------------------------------------------------------------------
-- VERIFICATION — read-only, run BEFORE applying. Both were run against linked prod on
-- 2026-08-09; results are recorded in
-- .superpowers/sdd/2026-08-09-score-breakdown-v2/task-4-report.md.
--
-- 1. NO EXISTING ROW MOVES. Every pre-cutover row's stored score must already sit at or under the
--    ceiling this migration would give it. Must return 0. If it does not, the date guard is not
--    protecting history and this migration must NOT be applied.
--
--   select count(*) as would_move from days d
--   where d.score is not null
--     and d.date < date '2026-08-16'
--     and d.score > least(100,
--         (case when exists (select 1 from jsonb_each(coalesce(d.meals,'{}'::jsonb)) e where e.value='true'::jsonb)
--                 or (jsonb_typeof(d.checkin->'slotMacros')='object' and (d.checkin->'slotMacros')<>'{}'::jsonb)
--               then 55 else 0 end)
--       + (case when (d.checkin->>'submitted')='true'
--                 or (d.checkin->>'ciLast' ~ '^\d{4}-\d{2}-\d{2}$' and (d.checkin->>'ciLast')::date between d.date-6 and d.date)
--               then 35 else 0 end)
--       + (case when (d.checkin->>'commitment') in ('yes','partial','no') then 15 else 0 end));
--
--    Note this query uses the STRICT v1 slots and omits the trust-pass and quick-add gates, so it
--    is a strictly TIGHTER bound than the trigger's pre-cutover ceiling. 0 under it therefore
--    proves 0 under the real thing, with margin.
--
-- 2. Rooms whose coach standard has the recovery knob off (Task 8 removes that knob; the founder
--    must notify those coaches before the cutover).
-- ---------------------------------------------------------------------------------------------
