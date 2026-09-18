-- 0235: 'sleep_hours' becomes a Connected Standard metric (2026-09-18)
--
-- The coach-assigned Recovery Standard needs somewhere to live, and connected_standards already
-- IS that shape: a metric, a target, a display unit, a period, repeat days, and audience scoping
-- down to a single athlete. A sleep target is one more row in it rather than a second table and a
-- second editor with its own drift.
--
-- Two CHECK constraints are widened and nothing else changes. Both are additive: every existing
-- row still satisfies the new predicate, so this cannot fail on live data and cannot alter a row.
--
-- WHY IT IS NOT AN ACTIVITY METRIC even though it shares the table. The five existing metrics are
-- read from readActivity() (steps, distance, workouts) and describe what an athlete DID. Sleep is
-- read from readRecoverySample() and describes what their night gave them, which is a different
-- pipeline and a different question. It shares storage, an editor and an audience model; it does
-- not share the verifier. src/core/activity.ts progressFromSample deliberately does not answer it.
--
-- SCORING IS ELSEWHERE. This migration stores the target. 0234 is what lets a met target raise a
-- day's evidence ceiling, and both engines split the night's single budget between this and the
-- morning roll call, so adding a sleep target never grows an athlete's total exposure.

alter table connected_standards drop constraint if exists connected_standards_metric_check;
alter table connected_standards add constraint connected_standards_metric_check
  check (metric = any (array['steps', 'distance', 'workouts', 'workout_minutes', 'active_minutes', 'sleep_hours']));

alter table connected_standards drop constraint if exists connected_standards_display_unit_check;
alter table connected_standards add constraint connected_standards_display_unit_check
  check (display_unit = any (array['steps', 'mi', 'km', 'workouts', 'min', 'h']));
