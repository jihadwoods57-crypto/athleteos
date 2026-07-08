-- OnStandard — write-side integrity guards (security follow-up to the 0002 note + audit 8.1).
-- Forward-only, idempotent. Two independent hardenings, both additive:
--
--   1. days.score / days.grade shape guard (0002_rls.sql:190 flagged this).
--      The Athlete Score is computed CLIENT-SIDE by src/core computeDerived() and written
--      through upsertDay() (RLS lets an athlete write only their OWN day). A tampered client
--      therefore can't touch anyone else's number, but it could POST garbage for itself —
--      score = 9999, grade = '<script>' — which would poison the coach dashboard that reads
--      these columns. These CHECK constraints bound the SHAPE at the database: score is an
--      integer 0..100, grade is one of the five letters gradeFor() emits (A/B/C/D/F). NULL
--      passes (both columns are nullable and unset on a fresh day).
--
--      SCOPE / HONESTY: this closes out-of-range and junk injection. It does NOT stop an
--      athlete posting a PLAUSIBLE-but-fake in-range score (e.g. a flat 100) — that is a
--      self-report-integrity risk, and the complete fix is a server-side recompute. That
--      recompute is deliberately NOT done here: computeDerived() depends on inputs the `days`
--      table does not persist (mealFoods, mealLoggedAt, per-athlete protein/cal targets,
--      ciConfig, scoringProfile, scoreHistory), so a faithful Postgres port is infeasible
--      today AND a partial one would drift from the canonical TS formula and mis-score every
--      athlete — strictly worse than the low-severity gap it would chase. Persisting the full
--      scoring input state + a recompute trigger is tracked as a separate, larger change.
--      Existing live rows already satisfy these bounds (the engine clamps score to 0..100 and
--      only ever emits A/B/C/D/F), so the constraints validate cleanly on apply.
--
--   2. meal-photos bucket: real server-side upload enforcement (audit 8.1).
--      uploadMealPhoto() (src/store/mealSync.ts) sets contentType 'image/jpeg' on the CLIENT,
--      but nothing server-side enforced type or size — a crafted client could upload any bytes
--      / any size into its own folder. Set the bucket's allowed_mime_types (images only; SVG
--      excluded because it can carry active script) and file_size_limit (8 MB, matching the
--      analyze-meal Edge Function's input cap) so Storage itself rejects a non-image or an
--      oversized object regardless of what the client claims. RLS path-scoping (0003) is
--      unchanged; this adds type/size on top of who-can-write.

-- ---------------------------------------------------------------- 1. days score/grade shape guard
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'days_score_range_chk') then
    alter table public.days add constraint days_score_range_chk
      check (score is null or (score >= 0 and score <= 100));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'days_grade_valid_chk') then
    alter table public.days add constraint days_grade_valid_chk
      check (grade is null or grade in ('A', 'B', 'C', 'D', 'F'));
  end if;
end $$;

-- ---------------------------------------------------------------- 2. meal-photos upload enforcement
update storage.buckets
   set file_size_limit   = 8388608,  -- 8 MB (matches analyze-meal's ~8MB base64 input cap)
       allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp']
 where id = 'meal-photos';
